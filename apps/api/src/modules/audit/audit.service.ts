import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { BlockchainAnchorService } from '../blockchain-anchor/blockchain-anchor.service';
import type { SmartAccessEntry } from './smart-access-entry';
import { UUID_RE, ZERO_UUID } from './audit-routes';

const UUID_FULL = new RegExp(`^${UUID_RE}$`, 'i');

// 감사 영속 실패 시 유실 방지 버퍼(Redis 리스트). 플러셔가 DB 회복 시 복원.
const AUDIT_PENDING_KEY = 'audit:pending';
const AUDIT_PENDING_MAX = 50000; // 폭주 상한
const READ_DEDUPE_TTL_SEC = 300; // 동일 열람 억제 창(5분)
const AUDIT_FLUSH_MAX_TRIES = 5; // 버퍼 항목 재시도 상한(초과 시 격리)

interface AuditEntry {
  userId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private lastHash = '0000000000000000000000000000000000000000000000000000000000000000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly anchorService?: BlockchainAnchorService,
  ) {}

  /** 비UUID resourceId 경고를 resourceType 당 한 번만(호출부를 찾게 하되 로그를 오염시키지 않는다) */
  private readonly warnedNonUuidTypes = new Set<string>();

  /**
   * 🔴 `audit_logs.resource_id` 는 `@db.Uuid` 다. 발급번호(`WRB-…`)·시리얼·결정 키처럼 UUID 가 아닌 식별자를
   * 그대로 넣으면 저장이 실패하고, 재시도 소진 → 버퍼 → 5회 폐기로 **감사가 조용히 유실**된다
   * (2026-09-09 운영 실측: `DocumentPdf/WRB-MEDICAL_RECORD_COPY-…` 폐기). 인터셉터의 extractResourceId 규약
   * (비UUID→ZERO_UUID·"귀속 실패를 원장이 말한다")을 **모든 호출부**에 적용한다 — 원래 키는 changes.resourceKey 에 남긴다.
   */
  private normalizeEntry(entry: AuditEntry): AuditEntry {
    if (UUID_FULL.test(entry.resourceId)) return entry;
    if (!this.warnedNonUuidTypes.has(entry.resourceType)) {
      this.warnedNonUuidTypes.add(entry.resourceType);
      this.logger.warn(`audit resourceId 가 UUID 가 아니라 ZERO_UUID 로 귀속 ${entry.resourceType}/${entry.resourceId} — 호출부가 환자·행 id 를 넘겨야 귀속된다`);
    }
    return {
      ...entry,
      resourceId: ZERO_UUID,
      changes: { ...(entry.changes ?? {}), resourceKey: { old: null, new: entry.resourceId } },
    };
  }

  private auditData(raw: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    const entry = this.normalizeEntry(raw);
    return {
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      changes: entry.changes ? (entry.changes as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    };
  }

  /**
   * 감사 기록 — EMR 인증 감사추적 신뢰성 강화.
   * 일시적 DB 실패는 재시도(3회·백오프)로 흡수, 재시도 소진 시 Redis 버퍼에 적재(유실 방지) →
   * 플러셔가 DB 회복 시 복원. (변조탐지는 blockchain-anchor 가 행 필드로 수행 — 해시체인은 in-memory 보조.)
   */
  async log(entry: AuditEntry) {
    // 🔴 userId 는 User FK(@db.Uuid) — 'system' 같은 문자열은 어떤 재시도로도 저장되지 않는다.
    //    지어낼 행위자가 없으므로 "담지 못했다"를 로그로 남기고 스킵한다(버퍼에 넣으면 5회 뒤 같은 폐기다).
    if (!UUID_FULL.test(entry.userId)) {
      this.logger.error(`audit 기록 불가 — userId 가 UUID 가 아님(${entry.userId}) ${entry.resourceType}/${entry.resourceId}`);
      return null;
    }
    const dataStr = JSON.stringify({ ...entry, prevHash: this.lastHash, ts: Date.now() });
    const entryHash = createHash('sha256').update(dataStr).digest('hex');
    try {
      const created = await this.persistWithRetry(entry);
      this.lastHash = entryHash; // 저장 성공 후에만 체인 전진
      return created;
    } catch (e) {
      // DB 영속 실패(재시도 소진) → 유실 방지 버퍼 적재. 요청 비차단(throw 안 함).
      if (await this.bufferAudit(entry)) {
        this.logger.warn(`audit DB 실패 → 버퍼 적재(복구 대기) ${entry.resourceType}/${entry.resourceId}`);
        return null;
      }
      throw e; // 버퍼도 실패 시에만 전파(기존 caller 계약 유지)
    }
  }

  private async persistWithRetry(entry: AuditEntry, attempts = 3) {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.prisma.auditLog.create({ data: this.auditData(entry) });
      } catch (e) {
        lastErr = e;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 50 * (i + 1)));
      }
    }
    throw lastErr;
  }

  private async bufferAudit(entry: AuditEntry): Promise<boolean> {
    try {
      await this.redis.rpush(AUDIT_PENDING_KEY, JSON.stringify(entry));
      await this.redis.ltrim(AUDIT_PENDING_KEY, -AUDIT_PENDING_MAX, -1);
      return true;
    } catch {
      return false; // Redis 도 불가 — 최후로 caller 에 전파
    }
  }

  /**
   * 감사 로그 블록체인 앵커링 스케줄 — 변조탐지(tamper-evidence) 자동 적용. EMR 인증 감사 무결성.
   * 기존엔 수동 ADMIN 엔드포인트만 있어 앵커링이 미적용이었음 → 매시간 자동화(단일 fork·중복 없음).
   * anchorService 미구성 시 no-op(@Optional). try/catch 로 cron 비중단.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'audit-anchor' })
  async scheduledAnchor() {
    try {
      const r = await this.anchorAuditLogs();
      if (r.anchored > 0) {
        this.logger.log(`audit 앵커링 ${r.anchored}건 merkleRoot=${r.merkleRoot?.slice(0, 12) ?? '-'}`);
      }
    } catch (e) {
      this.logger.error(`audit 앵커링 실패: ${(e as Error).message}`);
    }
  }

  /**
   * 버퍼 → DB 복구 플러시(30초·단일 fork). DB 회복 시 유실분 복원.
   * ⚠️ 되돌리기만 하면 **영구 실패 항목 1건이 큐 전체를 막는다**(poison message — 예: resourceId 가 비UUID라
   * 스키마상 절대 저장 불가). 재시도 횟수를 항목에 누적해 상한 초과 시 격리(폐기+에러 로그)한다.
   */
  @Cron('*/30 * * * * *', { name: 'audit-buffer-flush' })
  async flushPendingAudit() {
    let flushed = 0;
    for (let i = 0; i < 200; i++) {
      const item = await this.redis.lpop(AUDIT_PENDING_KEY).catch(() => null);
      if (!item) break;
      let parsed: (AuditEntry & { _tries?: number }) | null = null;
      try {
        parsed = JSON.parse(item);
        await this.prisma.auditLog.create({ data: this.auditData(parsed as AuditEntry) });
        flushed++;
      } catch (e) {
        const tries = (parsed?._tries ?? 0) + 1;
        if (!parsed || tries >= AUDIT_FLUSH_MAX_TRIES) {
          // 영구 실패 — 큐를 막지 않도록 격리. 유실 사실 자체는 에러 로그로 보존.
          this.logger.error(
            `audit 버퍼 항목 폐기(${tries}회 실패) ${parsed?.resourceType ?? '?'}/${parsed?.resourceId ?? '?'}: ${(e as Error).message}`,
          );
          continue;
        }
        await this.redis
          .rpush(AUDIT_PENDING_KEY, JSON.stringify({ ...parsed, _tries: tries }))
          .catch(() => undefined); // 뒤로 되돌리고 다음 주기 재시도
        break; // DB 아직 불안정 → 중단
      }
    }
    if (flushed) this.logger.log(`audit 버퍼 복구 ${flushed}건 → DB`);
  }

  /**
   * 부가(관찰) 감사용 — 본 트랜잭션을 절대 깨뜨리지 않음(best-effort, throw 안 함).
   * 감사 저장소 장애가 PIN 검증·단말 등록 등 핵심 기능을 막는 DoS를 방지.
   * ⚠️ 파기·법정 기록처럼 "기록 자체가 게이트"인 경로에는 log()(throw)를 사용할 것.
   */
  async safeLog(entry: AuditEntry): Promise<void> {
    try {
      await this.log(entry);
    } catch (e) {
      this.logger.error(
        `audit safeLog 실패(무시) ${entry.resourceType}/${entry.resourceId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 열람(READ) 감사 — 동일 (actor·리소스) 반복 열람을 TTL 창 안에서 1건으로 억제.
   * 차트 탭 재방문·폴링이 감사 테이블을 밀어내 정작 '누가 언제 봤나'를 못 찾게 되는 것을 방지.
   * Redis 불가 시에는 억제 없이 그대로 기록(감사 누락보다 중복이 낫다).
   */
  async logReadOnce(entry: AuditEntry, ttlSec = READ_DEDUPE_TTL_SEC): Promise<void> {
    const key = `audit:read:${entry.userId}:${entry.resourceType}:${entry.resourceId}`;
    try {
      const first = await this.redis.set(key, '1', 'EX', ttlSec, 'NX');
      if (first === null) return; // TTL 창 내 중복
    } catch {
      // Redis 장애 — 억제 없이 기록
    }
    await this.safeLog(entry);
  }

  /**
   * 외부 SMART 앱 접근 기록 — 실패해도 요청을 막지 않는다(감사 실패 ≠ 서비스 중단).
   * AuditLog 와 분리 저장하는 이유는 주체가 사용자가 아닐 수 있기 때문(smart-access-entry.ts 주석).
   */
  async logSmartAccess(entry: SmartAccessEntry & { ipAddress?: string; userAgent?: string }): Promise<void> {
    try {
      await this.prisma.smartAccessLog.create({
        data: {
          clientId: entry.clientId,
          clientName: entry.clientName,
          userId: entry.userId,
          patientId: entry.patientId,
          resourceType: entry.resourceType,
          action: entry.action,
          path: entry.path,
          scope: entry.scope,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (e) {
      this.logger.warn(`SMART 접근 기록 실패(${entry.clientId} ${entry.resourceType}): ${(e as Error).message}`);
    }
  }

  async findByResource(resourceType: string, resourceId: string) {
    // 감사 로그는 무한 성장 — 최근 300건 상한 (2026-07 전체검토 D-2)
    return this.prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { timestamp: 'desc' },
      take: 300,
      include: {
        user: { select: { id: true, familyName: true, givenName: true, role: true } },
      },
    });
  }

  // ── 앵커 해시 정본 ────────────────────────────────────────────────────────────
  //
  // 🔴 왜 버전이 있는가(2026-09-09 P0-C R5): v1 해시는 `{id,userId,action,resourceType,resourceId,timestamp}`
  //    **6필드만** 덮었다 — 감사 로그의 알맹이인 `changes`(무엇이 어떻게 바뀌었나)를 통째로 바꿔도
  //    앵커 검증이 "무결"이라고 답했다. 변조탐지를 한다면서 변조를 탐지하지 못했다.
  // v2 = 6필드 + `changes`(키 정렬 결정론 직렬화). 스키마는 건드리지 않고 **anchorType 에 버전을 실어**
  //    저장 레코드가 스스로 어느 버전인지 말하게 한다(BlockchainAnchor 에는 metadata 컬럼이 없다).
  // 🔴 기존 v1 앵커는 그대로 검증된다 — 다만 그 앵커가 `changes` 를 덮지 않는다는 사실을 결과가 **말한다**
  //    (덮지 않은 것을 덮은 척하지 않는다).
  private static readonly ANCHOR_TYPE_V1 = 'AUDIT_LOG';
  private static readonly ANCHOR_TYPE_V2 = 'AUDIT_LOG_V2';

  /**
   * 결정론 직렬화 — 키를 정렬해 같은 내용이면 항상 같은 문자열이 나오게 한다.
   * (`JSON.stringify` 는 키 삽입 순서를 따른다 — Prisma JSONB 왕복에서 순서가 바뀌면 해시가 달라져
   *  변조가 아닌데 "변조"라 말하게 된다.)
   */
  private static canonicalJson(v: unknown): string {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return `[${v.map((x) => AuditService.canonicalJson(x)).join(',')}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${AuditService.canonicalJson(o[k])}`)
      .join(',')}}`;
  }

  /** 앵커 대상 해시 — version 1(종전 6필드) / 2(+changes). 검증도 **이 함수 하나**를 쓴다(정본이 둘이면 갈라진다). */
  private auditDataHash(
    log: { id: string; userId: string | null; action: string; resourceType: string; resourceId: string | null; timestamp: Date; changes?: unknown },
    version: 1 | 2,
  ): string {
    const base = {
      id: log.id,
      userId: log.userId,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      timestamp: log.timestamp.toISOString(),
    };
    const payload = version === 1
      ? JSON.stringify(base)
      : AuditService.canonicalJson({ ...base, hashVersion: 2, changes: log.changes ?? null });
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * 감사 로그 블록체인 앵커링 (변조 방지)
   * - 최근 미앵커 로그를 배치로 수집
   * - SHA-256 해시(v2 — `changes` 포함) → Merkle 트리 → 블록체인 앵커
   * - cron: 매 1시간 실행 권장
   */
  async anchorAuditLogs(): Promise<{ anchored: number; merkleRoot: string | null }> {
    if (!this.anchorService) {
      return { anchored: 0, merkleRoot: null };
    }

    // 최근 1시간 내 감사 로그 수집
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentLogs = await this.prisma.auditLog.findMany({
      where: { timestamp: { gte: oneHourAgo } },
      orderBy: { timestamp: 'asc' },
      take: 500,
    });

    if (recentLogs.length === 0) return { anchored: 0, merkleRoot: null };

    // 각 로그의 해시 생성 — v2(= changes 포함)
    for (const log of recentLogs) {
      await this.anchorService.createAnchor({
        anchorType: AuditService.ANCHOR_TYPE_V2,
        referenceId: log.id,
        dataHash: this.auditDataHash(log, 2),
        chainType: 'INTERNAL',
      });
    }

    // 배치 앵커링 실행 (Merkle 트리 생성)
    const result = await this.anchorService.batchAnchor();
    this.logger.log(`Audit logs anchored: ${result.anchored} entries, merkleRoot: ${result.merkleRoot}`);

    return { anchored: result.anchored, merkleRoot: result.merkleRoot ?? null };
  }

  /**
   * 감사 로그 무결성 검증 — v2(= changes 포함) 먼저, 없으면 v1(종전 6필드) 앵커로.
   *
   * 🔴 세 결과를 **다른 사실로** 말한다:
   *   · v2 앵커 일치 → `hashVersion: 2, coversChanges: true` (changes 변조까지 탐지된 상태)
   *   · v1 앵커 일치 → `hashVersion: 1, coversChanges: false` — 그 앵커는 `changes` 를 덮지 않는다.
   *     "무결"이라 말하되 **무엇까지 무결인지**를 함께 말한다(덮지 않은 것을 덮은 척하지 않는다).
   *   · 둘 다 없음 → `verified: false` — 다만 **미앵커인지 변조인지 이 함수는 모른다**. 둘 중 하나로 단정하지 않는다.
   */
  async verifyIntegrity(logId: string): Promise<{
    verified: boolean; message?: string; anchor?: unknown; hashVersion?: 1 | 2 | null; coversChanges?: boolean;
  }> {
    const log = await this.prisma.auditLog.findUnique({ where: { id: logId } });
    if (!log) return { verified: false, message: '로그를 찾을 수 없습니다.' };

    if (!this.anchorService) {
      return { verified: false, message: '블록체인 앵커 서비스가 비활성화되어 있습니다.' };
    }

    const r2 = await this.anchorService.verifyByDataHash(this.auditDataHash(log, 2));
    if ((r2 as { anchor?: unknown }).anchor) {
      return { ...r2, hashVersion: 2, coversChanges: true };
    }

    // 하위호환 — v2 도입 이전에 찍힌 앵커(v1)
    const r1 = await this.anchorService.verifyByDataHash(this.auditDataHash(log, 1));
    if ((r1 as { anchor?: unknown }).anchor) {
      return {
        ...r1,
        hashVersion: 1,
        coversChanges: false,
        message: '앵커 v1 — 이 앵커는 changes(변경 내용)를 덮지 않습니다. changes 변조는 이 검증으로 탐지되지 않습니다(v2 앵커부터 탐지).',
      };
    }

    return {
      verified: false,
      hashVersion: null,
      coversChanges: false,
      message: '해당 로그의 앵커를 찾지 못했습니다 — 아직 앵커링되지 않았거나, 로그가 변조되었습니다(둘을 구분할 수 없습니다).',
    };
  }
}
