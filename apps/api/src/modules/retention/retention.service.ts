import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { ApprovalService } from '../credential-admin/approval.service';
import { LegalHoldService } from '../legal-hold/legal-hold.service';
import { retentionRecordKindsOf, type RetentionCountry, type RetentionRecordSource } from '@hospital-run/shared';

// 데이터 보유/파기 (security-governance G1 / FR-S1·S2)
// ⚠️ 3중 안전장치: ①전역 retention.purgeEnabled ②정책 legalConfirmed ③법정 클램프(legalMinDays).
// 기본은 DRY-RUN 리포트만 — 실제 삭제는 세 조건 모두 충족 시에만.

interface HandlerCount {
  candidates: number;
  oldestAt: Date | null;
  /**
   * 🔴 (2026-09-13 T10) 기산점 두 번째 기준 — **환자 마지막 진료일** 기준 후보 수.
   *    한국은 기록 작성일, UAE 는 마지막 진료일로 보존기간을 센다(2차 출처 · 결정 대기). 어느 쪽인지 정해지기 전이라
   *    **둘 다 보여준다**. 환자에 귀속되지 않는 기록(감사 로그·임시계정)은 이 기준이 성립하지 않아 `null`(0 이 아니다).
   */
  byLastEncounterAt: number | null;
  /** 종류별 부가 집계(보존명령 제외 수·미반영 잔존 등) — 화면이 분모로 그린다. 없으면 없는 것이다 */
  detail?: Record<string, number | null>;
}

/**
 * 보존 기간의 **정본이 정책 행이 아니라 SystemConfig 에 있는** 종류가 선언한다(SCRIBE_TRANSCRIPT).
 * 🔴 `configured=false`(코드 기본값·미설정)는 "기간이 정해진 적 없음"이다 — 집계는 그 값으로 하되 출처를 말하고, **파기는 거부**한다.
 *    기본값을 정책인 척하지 않는다.
 */
export interface RetentionPeriod {
  key: string;
  days: number | null;
  source: string;
  configured: boolean;
}

interface PurgeResult {
  purged: number;
  detail: Record<string, number>;
}

interface ResourceHandler {
  // 파기 후보(보존기간 초과 + 법정클램프 통과) 카운트·최고령
  count(cutoff: Date): Promise<HandlerCount>;
  /**
   * 🔴 (2026-09-13 T10-7) **환자 기록을 건드리는 핸들러인가.** true 면 파기 입구가 법적 보존명령 제외 집합을 조회해 넘기고,
   *    핸들러가 그것을 반영한다고 `honorsLegalHold` 로 선언하지 않았으면 **파기를 거부**한다.
   *    지금 파기 핸들러는 PRE_BOARD_ACCOUNT(직원 임시계정) 하나라 환자 귀속이 없다 — 앞으로 환자 기록 파기·익명화 핸들러가
   *    생길 때 보존명령을 건너뛰는 코드가 **구조적으로 통과하지 못하게** 입구에 둔다.
   */
  patientScoped?: boolean;
  /** 환자 귀속 핸들러가 `ctx.heldPatientIds` 를 WHERE 에서 제외한다고 선언한다(선언 없으면 입구가 거부) */
  honorsLegalHold?: boolean;
  /** 기간 정본이 설정 키인 종류만 — 정책 행의 retentionDays 는 이 종류에서 **쓰이지 않는다**(정본 둘 금지) */
  period?(): Promise<RetentionPeriod>;
  // 실제 파기(게이트 통과 후만 호출) — 안전한 동작만 구현
  purge?(cutoff: Date, ctx: { heldPatientIds: ReadonlySet<string> }): Promise<number | PurgeResult>;
}

/**
 * 스크라이브/앰비언트 세션의 "종료" 상태 — 전사가 더 쓰일 일이 없는 상태만.
 * TRANSCRIBED·DRAFTED 는 의사가 아직 반영하지 않은 대기라 파기 대상이 **아니다**(집계에는 `notTerminal` 로 드러난다).
 * FAILED 는 전사 실패지만 발화·부분 전사가 남을 수 있어 포함. DELETED 는 `scribe.service deleteSession()` 이
 * 오디오만 지우고 **전사·발화는 남긴다**(2026-09-23 코드 실측) — 그래서 포함.
 */
export const SCRIBE_TERMINAL_STATUSES = ['APPLIED', 'FAILED', 'DELETED'] as const;
export const SCRIBE_TRANSCRIPT_RETENTION_KEY = 'scribe.transcript.retention';
export const SCRIBE_AUDIO_RETENTION_KEY = 'scribe.audio.retention';

interface ScribeCountRow {
  retained_total: number | bigint | null;
  eligible: number | bigint | null;
  held_out: number | bigint | null;
  not_terminal: number | bigint | null;
  oldest: Date | null;
}
interface ScribeTargetRow { id: string; patient_id: string; audio_path: string | null }

interface RawCountRow {
  total: number | bigint | null;
  by_created: number | bigint | null;
  oldest_created: Date | null;
  by_last: number | bigint | null;
  oldest_last: Date | null;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly approval: ApprovalService,
    private readonly legalHold: LegalHoldService,
  ) {}

  /** 정책 등록/수정 정본 — 컨트롤러·거버넌스 집행 엔진(P3)이 같은 경로를 쓴다. 파기 실행은 여기 없다(4-eyes 전용·바인딩 제외) */
  async upsertPolicy(body: { resourceType: string; retentionDays: number; legalMinDays?: number; action?: string; legalConfirmed?: boolean; enabled?: boolean; description?: string }) {
    return this.prisma.retentionPolicy.upsert({
      where: { resourceType: body.resourceType },
      update: {
        retentionDays: body.retentionDays,
        legalMinDays: body.legalMinDays ?? undefined,
        action: body.action ?? undefined,
        legalConfirmed: body.legalConfirmed ?? undefined,
        enabled: body.enabled ?? undefined,
        description: body.description ?? undefined,
      },
      create: {
        resourceType: body.resourceType,
        retentionDays: body.retentionDays,
        legalMinDays: body.legalMinDays ?? 0,
        action: body.action ?? 'REPORT_ONLY',
        legalConfirmed: body.legalConfirmed ?? false,
        enabled: body.enabled ?? true,
        description: body.description ?? null,
      },
    });
  }

  // ── 4-eyes 파기 요청/승인/조회 (G6) — purge 전 2인 승인 필수 ──
  async requestPurge(resourceType: string, requestedBy: string, reason?: string) {
    const p = await this.prisma.retentionPolicy.findUnique({ where: { resourceType } });
    if (!p) throw new NotFoundException('정책 없음');
    if (p.action === 'REPORT_ONLY') throw new ForbiddenException('REPORT_ONLY 정책은 파기 요청 불가');
    return this.approval.request('RETENTION_PURGE', 'RETENTION', resourceType, requestedBy, reason);
  }
  listApprovals() {
    return this.approval.list('PENDING');
  }
  approve(id: string, approverId: string) {
    return this.approval.approve(id, approverId); // 요청자≠승인자 강제(엔진 내부)
  }

  // resourceType → 핸들러 레지스트리. 의료기록 등 고위험은 count만(파기 미구현 — 법무·설계 후).
  private handlers(): Record<string, ResourceHandler> {
    return {
      AUDIT_LOG: {
        count: async (cutoff) => ({
          candidates: await this.prisma.auditLog.count({ where: { timestamp: { lt: cutoff } } }),
          oldestAt: (await this.prisma.auditLog.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }))?.timestamp ?? null,
          byLastEncounterAt: null, // 환자 귀속 기록이 아니다
        }),
        // 접속기록은 법정 보존 — 파기 대신 아카이빙(G4) 대상. 여기선 count만.
      },
      // 외부 SMART 앱 접근 기록 — FHIR 요청마다 1행이라 무한 성장한다(LIS·트윈은 상시 폴링).
      // 다만 이것도 **접근 기록**이므로 파기 핸들러는 두지 않는다(AUDIT_LOG 와 같은 취급 — count 만).
      SMART_ACCESS_LOG: {
        count: async (cutoff) => ({
          candidates: await this.prisma.smartAccessLog.count({ where: { at: { lt: cutoff } } }),
          oldestAt: (await this.prisma.smartAccessLog.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }))?.at ?? null,
          byLastEncounterAt: null,
        }),
      },
      PRE_BOARD_ACCOUNT: {
        count: async (cutoff) => ({
          candidates: await this.prisma.user.count({ where: { accountStage: 'PRE_BOARD', isActive: true, createdAt: { lt: cutoff } } }),
          oldestAt: (await this.prisma.user.findFirst({ where: { accountStage: 'PRE_BOARD', isActive: true }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt ?? null,
          byLastEncounterAt: null,
        }),
        // 미활성 임시계정 = 안전한 SOFT_DELETE(비활성화). 하드삭제는 미구현(관계 cascade 위험).
        purge: async (cutoff) => {
          const r = await this.prisma.user.updateMany({
            where: { accountStage: 'PRE_BOARD', isActive: true, createdAt: { lt: cutoff } },
            data: { isActive: false },
          });
          return r.count;
        },
      },
      /**
       * 🔴 (2026-09-13 T10) 임상 기록 3종 — **집계만**. 종전엔 운영에 정책 행(MEDICAL_RECORD·PRESCRIPTION·CONSENT_FORM)이
       *    있는데 핸들러가 없어 **세지도 않았다**. 파기·익명화 핸들러는 만들지 않는다 — 법정 보존·아카이빙 설계(T10) 대상이고
       *    보존기간·기산점·경과 후 처리가 전부 사람 결정 대기다(고위험 — 가드가 purge 부재를 동결한다).
       */
      MEDICAL_RECORD: { count: (cutoff) => this.handlerFromSources(['ENCOUNTER'], cutoff) },
      PRESCRIPTION: { count: (cutoff) => this.handlerFromSources(['PRESCRIPTION'], cutoff) },
      CONSENT_FORM: { count: (cutoff) => this.handlerFromSources(['CONSENT_FORM'], cutoff) },
      /**
       * 🔴 (2026-09-23 VoiceEMR §13 D6) 진료 대화 전사(`voice_utterances`)·세션 `transcript`·(남아 있으면) 원음.
       *    설정 `scribe.transcript.retention` 은 선언만 있고 **읽는 코드가 0건**이라 전사가 영구 보존이었다 — 이 핸들러가 첫 소비처다.
       *    기간 정본은 그 설정 키(정책 행의 retentionDays 는 쓰지 않는다). 파기는 이 엔진의 문(전역 게이트 OFF·법무 확정·
       *    REPORT_ONLY·4-eyes·보존명령 제외)을 **그대로** 지난다 — 옆에 약한 것을 만들지 않는다.
       *    🔴 `draft_snapshot` 은 건드리지 않는다(서명 시 편집거리 `aiEditDistance` 의 유일한 근거).
       */
      SCRIBE_TRANSCRIPT: {
        patientScoped: true,
        honorsLegalHold: true,
        period: () => this.scribePeriod(),
        count: (cutoff) => this.countScribeTranscripts(cutoff),
        purge: (cutoff, ctx) => this.purgeScribeTranscripts(cutoff, ctx.heldPatientIds),
      },
    };
  }

  /** 전사 보존기간 — 설정 키 하나에서만. 숫자가 아니면 `days=null`(지어내지 않는다) */
  private async scribePeriod(): Promise<RetentionPeriod> {
    const r = await this.configRuntime.getWithSource(SCRIBE_TRANSCRIPT_RETENTION_KEY);
    const n = typeof r.value === 'number' ? r.value : typeof r.value === 'string' && r.value.trim() !== '' ? Number(r.value) : NaN;
    const days = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    return { key: SCRIBE_TRANSCRIPT_RETENTION_KEY, days, source: r.source, configured: r.source === 'db' || r.source === 'env' };
  }

  /**
   * 집계 — 종료 세션 중 전사·발화가 남은 것(retainedTotal), 그중 기간을 넘겨 파기 가능한 것(eligible),
   * 넘겼지만 보존명령(세션 legalHold·활성 LegalHold 환자)으로 제외된 것(heldOut), 넘겼는데 미반영 대기라 세지 않은 것(notTerminal).
   * 종료 시각 컬럼이 없어 `updated_at` 으로 근사한다(늦게 세는 쪽 — 안전측). SQL 불변식 72 와 같은 규칙.
   */
  private async countScribeTranscripts(cutoff: Date): Promise<HandlerCount> {
    const rows = await this.prisma.$queryRaw<ScribeCountRow[]>`
      WITH ended AS (
        SELECT s.id, s.patient_id, s.legal_hold, s.updated_at,
               (s.transcript IS NOT NULL OR EXISTS (SELECT 1 FROM voice_utterances u WHERE u.session_id = s.id)) AS retained
          FROM scribe_sessions s
         WHERE s.status IN ('APPLIED', 'FAILED', 'DELETED')
      ), held AS (
        SELECT DISTINCT h.patient_id FROM legal_holds h
          LEFT JOIN legal_hold_releases r ON r.hold_id = h.id
         WHERE r.id IS NULL
      )
      SELECT count(*) FILTER (WHERE e.retained)::int AS retained_total,
             count(*) FILTER (WHERE e.retained AND e.updated_at < ${cutoff} AND e.legal_hold = false AND held.patient_id IS NULL)::int AS eligible,
             count(*) FILTER (WHERE e.retained AND e.updated_at < ${cutoff} AND (e.legal_hold = true OR held.patient_id IS NOT NULL))::int AS held_out,
             min(e.updated_at) FILTER (WHERE e.retained) AS oldest,
             (SELECT count(*)::int FROM scribe_sessions s2
               WHERE s2.status IN ('TRANSCRIBED', 'DRAFTED') AND s2.updated_at < ${cutoff}
                 AND (s2.transcript IS NOT NULL OR EXISTS (SELECT 1 FROM voice_utterances u WHERE u.session_id = s2.id))) AS not_terminal
        FROM ended e LEFT JOIN held ON held.patient_id = e.patient_id`;
    const r = rows[0];
    if (!r) throw new Error('scribe transcript count returned no row');
    return {
      candidates: Number(r.eligible ?? 0),
      oldestAt: r.oldest ?? null,
      byLastEncounterAt: null, // 기산점은 세션 종료다 — 환자 마지막 진료일 기준은 이 기록에 성립하지 않는다
      detail: { retainedTotal: Number(r.retained_total ?? 0), heldOut: Number(r.held_out ?? 0), notTerminal: Number(r.not_terminal ?? 0) },
    };
  }

  /**
   * 파기 — 발화 삭제 + 세션 `transcript=null` (+ `scribe.audio.retention≠keep` 이면 남은 원음 파일·경로).
   * 🔴 게이트는 전부 입구(`purge()`)에 있다 — 여기까지 왔다는 것이 전역 게이트·법무 확정·4-eyes·보존명령 조회 성공을 뜻한다.
   * 🔴 `draftSnapshot`·`status`·`aiModel` 등은 그대로 — 지우는 것은 대화 원문뿐이다.
   */
  private async purgeScribeTranscripts(cutoff: Date, heldPatientIds: ReadonlySet<string>): Promise<PurgeResult> {
    const rows = await this.prisma.$queryRaw<ScribeTargetRow[]>`
      SELECT s.id, s.patient_id, s.audio_path
        FROM scribe_sessions s
       WHERE s.status IN ('APPLIED', 'FAILED', 'DELETED')
         AND s.legal_hold = false
         AND s.updated_at < ${cutoff}
         AND (s.transcript IS NOT NULL OR EXISTS (SELECT 1 FROM voice_utterances u WHERE u.session_id = s.id))`;
    const targets = rows.filter((r) => !heldPatientIds.has(r.patient_id));
    const detail: Record<string, number> = { sessions: 0, utterances: 0, audioFiles: 0, audioUnlinkFailed: 0, heldOut: rows.length - targets.length };
    if (targets.length === 0) return { purged: 0, detail };

    const ids = targets.map((r) => r.id);
    const [utt] = await this.prisma.$transaction([
      this.prisma.voiceUtterance.deleteMany({ where: { sessionId: { in: ids } } }),
      // legalHold 를 한 번 더 건다 — 조회와 삭제 사이에 보존명령이 걸렸으면 그 행은 남는다
      this.prisma.scribeSession.updateMany({ where: { id: { in: ids }, legalHold: false }, data: { transcript: Prisma.DbNull } }),
    ]);
    detail.sessions = ids.length;
    detail.utterances = utt.count;

    // 원음 — 정책 'keep' 이면 남긴다. 파일 삭제가 실패한 세션은 경로를 지우지 않는다(지웠다고 말하지 않는다).
    const audioPolicy = await this.configRuntime.get(SCRIBE_AUDIO_RETENTION_KEY);
    if (audioPolicy !== 'keep') {
      for (const t of targets) {
        if (!t.audio_path) continue;
        try {
          await unlink(join(process.cwd(), t.audio_path));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            detail.audioUnlinkFailed += 1;
            continue;
          }
        }
        await this.prisma.scribeSession.updateMany({ where: { id: t.id, legalHold: false }, data: { audioPath: null, audioDeletedAt: new Date() } });
        detail.audioFiles += 1;
      }
    }
    return { purged: ids.length, detail };
  }

  /**
   * 기록 소스별 집계 SQL 조각 — 날짜 열과 환자 귀속 경로. 🔴 사용자 입력이 섞이지 않는 **정적 조각**만 둔다(cutoff 는 파라미터).
   * 환자 귀속이 선택적인 기록(발급 원장)은 환자가 없으면 기록 자신의 날짜로 센다.
   */
  private static readonly SOURCE_SQL: Record<RetentionRecordSource, { from: string; date: string; pid: string }> = {
    PATIENT: { from: 'patients r', date: 'r.created_at', pid: 'r.id' },
    ENCOUNTER: { from: 'encounters r', date: 'r.created_at', pid: 'r.patient_id' },
    PRESCRIPTION: { from: 'prescriptions r JOIN encounters e ON e.id = r.encounter_id', date: 'r.created_at', pid: 'e.patient_id' },
    SURGERY: { from: 'surgeries r', date: 'r.created_at', pid: 'r.patient_id' },
    LAB_RESULT: { from: 'lab_results r', date: 'r.created_at', pid: 'r.patient_id' },
    IMAGING_RESULT: { from: 'imaging_results r', date: 'r.created_at', pid: 'r.patient_id' },
    NURSING_NOTE: { from: 'nursing_notes r JOIN admissions a ON a.id = r.admission_id', date: 'r.created_at', pid: 'a.patient_id' },
    UNIVERSAL_NURSING_NOTE: { from: 'universal_nursing_notes r', date: 'r.created_at', pid: 'r.patient_id' },
    DELIVERY_RECORD: { from: 'delivery_records r', date: 'r.created_at', pid: 'r.patient_id' },
    ISSUED_DOCUMENT: { from: 'issued_documents r', date: 'r.issued_at', pid: 'r.patient_id' },
    CONSENT_FORM: { from: 'consent_forms r', date: 'r.created_at', pid: 'r.patient_id' },
  };

  /**
   * 한 소스를 두 기산점으로 센다.
   *  - 작성일 기준: 기록 자신의 날짜 < cutoff
   *  - 마지막 진료일 기준: GREATEST(환자의 마지막 진료일(encounters 최대 created_at), 기록 자신의 날짜) < cutoff
   *    — 🔴 근사다: "마지막 보건 절차"를 진료(encounters)로만 본다(검사·수술만 있고 진료 행이 없는 환자는 기록 날짜로 떨어진다).
   * `cutoff` 가 없으면(보존기간 미확정) 후보 수는 산출하지 않고 **총량과 가장 오래된 날짜만** 돌려준다 — 기간을 지어내지 않는다.
   */
  private async countSource(source: RetentionRecordSource, cutoff: Date | null): Promise<{
    total: number; byCreatedAt: number | null; oldestCreatedAt: Date | null; byLastEncounterAt: number | null; oldestLastEncounterAt: Date | null;
  }> {
    const f = RetentionService.SOURCE_SQL[source];
    const basis = `GREATEST(COALESCE(le.last_at, x.r_date), x.r_date)`;
    const sql = `WITH le AS (SELECT patient_id, MAX(created_at) AS last_at FROM encounters GROUP BY patient_id)
      SELECT COUNT(*)::int AS total,
             ${cutoff ? `COUNT(*) FILTER (WHERE x.r_date < $1)::int` : 'NULL::int'} AS by_created,
             MIN(x.r_date) AS oldest_created,
             ${cutoff ? `COUNT(*) FILTER (WHERE ${basis} < $1)::int` : 'NULL::int'} AS by_last,
             MIN(${basis}) AS oldest_last
        FROM (SELECT ${f.date} AS r_date, ${f.pid} AS pid FROM ${f.from}) x
        LEFT JOIN le ON le.patient_id = x.pid`;
    const rows = cutoff
      ? await this.prisma.$queryRawUnsafe<RawCountRow[]>(sql, cutoff)
      : await this.prisma.$queryRawUnsafe<RawCountRow[]>(sql);
    const r = rows[0] ?? { total: 0, by_created: null, oldest_created: null, by_last: null, oldest_last: null };
    return {
      total: Number(r.total ?? 0),
      byCreatedAt: r.by_created == null ? null : Number(r.by_created),
      oldestCreatedAt: r.oldest_created ?? null,
      byLastEncounterAt: r.by_last == null ? null : Number(r.by_last),
      oldestLastEncounterAt: r.oldest_last ?? null,
    };
  }

  /** 여러 소스 합산 → 핸들러 반환 모양. 🔴 합산 중 하나라도 null 이면 그 기준은 null(부분 합을 전체로 말하지 않는다) */
  private async handlerFromSources(sources: RetentionRecordSource[], cutoff: Date): Promise<HandlerCount> {
    const parts = await Promise.all(sources.map((s) => this.countSource(s, cutoff)));
    const sum = (k: 'byCreatedAt' | 'byLastEncounterAt') => (parts.some((p) => p[k] == null) ? null : parts.reduce((a, p) => a + (p[k] as number), 0));
    const oldest = parts.map((p) => p.oldestCreatedAt).filter((d): d is Date => d != null).sort((a, b) => +a - +b)[0] ?? null;
    return { candidates: sum('byCreatedAt') ?? 0, oldestAt: oldest, byLastEncounterAt: sum('byLastEncounterAt') };
  }

  /**
   * 🔴 (2026-09-13 T10) 국가별 **법정 기록 종류** 보유 현황 — 보존기간이 확정되지 않았으므로 **후보 수는 산출하지 않는다.**
   *    종류별 총량과, 두 기산점(작성일·마지막 진료일)으로 본 가장 오래된 날짜만 보여준다 — 결정자가 기산점 차이를 보고 고르게.
   *    매핑이 `UNMAPPED` 인 종류는 세지 않는다(`counted:false` — 0 이 아니다).
   */
  async legalKinds(country: RetentionCountry) {
    const kinds = retentionRecordKindsOf(country);
    const rows = [];
    for (const k of kinds) {
      if (!k.sources.length) {
        rows.push({ ...k, counted: false, total: null, oldestCreatedAt: null, oldestLastEncounterAt: null });
        continue;
      }
      const parts = await Promise.all(k.sources.map((s) => this.countSource(s, null)));
      const minDate = (sel: (p: (typeof parts)[number]) => Date | null) =>
        parts.map(sel).filter((d): d is Date => d != null).sort((a, b) => +a - +b)[0] ?? null;
      rows.push({
        ...k,
        counted: true,
        total: parts.reduce((a, p) => a + p.total, 0),
        oldestCreatedAt: minDate((p) => p.oldestCreatedAt)?.toISOString() ?? null,
        oldestLastEncounterAt: minDate((p) => p.oldestLastEncounterAt)?.toISOString() ?? null,
      });
    }
    return {
      country,
      generatedAt: new Date().toISOString(),
      // 기간·기산점 미확정 사실과 근사 설명은 화면 문구(카탈로그)가 말한다 — 서버는 한국어 문장을 조립하지 않는다
      periodsConfirmed: false,
      kinds: rows,
    };
  }

  // 보존기간/법정클램프 적용 cutoff — 둘 중 더 오래된 기준(법정 안쪽은 절대 파기 금지)
  private cutoffFor(retentionDays: number, legalMinDays: number): Date {
    const days = Math.max(retentionDays, legalMinDays);
    return new Date(Date.now() - days * 86_400_000);
  }

  /**
   * 정책 목록 — 기간 정본이 설정 키인 종류는 **그 값과 출처**를 붙여 준다(정책 행의 retentionDays 는 그 종류에서 쓰이지 않는다).
   * `retentionDaysSource:'POLICY'` 가 아니면 화면은 행의 숫자 대신 설정 출처를 그린다.
   */
  async listPolicies() {
    const rows = await this.prisma.retentionPolicy.findMany({ orderBy: { resourceType: 'asc' } });
    const handlers = this.handlers();
    return Promise.all(rows.map(async (p) => {
      const period = handlers[p.resourceType]?.period;
      if (!period) return { ...p, retentionDaysSource: 'POLICY' as string, periodSource: null as string | null, periodConfigured: true };
      const per = await period();
      return { ...p, retentionDays: per.days, retentionDaysSource: per.key, periodSource: per.source, periodConfigured: per.configured };
    }));
  }

  // ── DRY-RUN 리포트 (삭제 없음) ──
  async report() {
    const policies = await this.prisma.retentionPolicy.findMany({ where: { enabled: true } });
    const handlers = this.handlers();
    const rows = [];
    for (const p of policies) {
      const h = handlers[p.resourceType];
      // 기간 정본이 설정 키인 종류는 그 값으로 센다 — 값이 없으면(숫자 아님) 후보를 산출하지 않는다(cutoff=null)
      const period = h?.period ? await h.period() : null;
      const days = period ? period.days : p.retentionDays;
      const cutoff = days == null ? null : this.cutoffFor(days, p.legalMinDays);
      // 🔴 (2026-09-13 T10-10) 핸들러가 없으면 **세지 않은 것**이다 — 종전엔 0 을 저장해 정책 목록이 "후보 0건"이라 말했다
      //    (운영 5행 전부 0). 미지원은 null 로 저장하고 응답도 null 로 준다.
      let candidates: number | null = null;
      let byLastEncounterAt: number | null = null;
      let oldestAt: Date | null = null;
      let supported = false;
      let detail: Record<string, number | null> | null = null;
      if (h && cutoff) {
        supported = true;
        const c = await h.count(cutoff);
        candidates = c.candidates;
        oldestAt = c.oldestAt;
        byLastEncounterAt = c.byLastEncounterAt;
        detail = c.detail ?? null;
      }
      await this.prisma.retentionPolicy.update({ where: { id: p.id }, data: { lastRunAt: new Date(), lastCandidates: candidates } });
      rows.push({
        resourceType: p.resourceType,
        action: p.action,
        retentionDays: days,
        retentionDaysSource: period ? period.key : 'POLICY',
        periodSource: period ? period.source : null,
        periodConfigured: period ? period.configured : true,
        legalMinDays: p.legalMinDays,
        legalConfirmed: p.legalConfirmed,
        cutoff: cutoff ? cutoff.toISOString() : null,
        candidates,
        candidatesByLastEncounterAt: byLastEncounterAt,
        oldestAt: oldestAt?.toISOString() ?? null,
        detail,
        supported,
        wouldPurge: false, // DRY-RUN — 절대 삭제 안 함
      });
    }
    return { dryRun: true, generatedAt: new Date().toISOString(), policies: rows };
  }

  // ── 실제 파기 (3중 게이트) ──
  async purge(resourceType: string, actorId: string) {
    const globalEnabled = (await this.configRuntime.get('retention.purgeEnabled')) === true;
    if (!globalEnabled) throw new ForbiddenException('파기 비활성(retention.purgeEnabled=false) — DRY-RUN만 가능');

    const p = await this.prisma.retentionPolicy.findUnique({ where: { resourceType } });
    if (!p) throw new NotFoundException('정책 없음');
    if (!p.enabled) throw new ForbiddenException('비활성 정책');
    if (!p.legalConfirmed) throw new ForbiddenException('법무 보존기간 미확정(legalConfirmed=false) — 파기 거부');
    if (p.action === 'REPORT_ONLY') throw new ForbiddenException('REPORT_ONLY 정책은 파기 불가');

    const h = this.handlers()[resourceType];
    if (!h?.purge) throw new ForbiddenException(`${resourceType} 파기 핸들러 미구현(고위험 — 별도 설계 필요)`);

    // 기간 정본이 설정 키인 종류 — 🔴 코드 기본값·미설정으로는 파기하지 않는다(기본값은 정책이 아니다). 고정 문장.
    let days = p.retentionDays;
    if (h.period) {
      const per = await h.period();
      if (per.days == null) throw new ForbiddenException('보존기간 설정값이 숫자가 아니다 — 파기 거부');
      if (!per.configured) throw new ForbiddenException('보존기간이 설정된 적 없다(코드 기본값은 정책이 아니다) — 파기 거부');
      days = per.days;
    }

    // ⑤ 법적 보존명령(T10-7) — 환자 귀속 핸들러는 제외 집합 없이는 파기하지 않는다(승인 소비 **전에** 판정해 승인을 헛되이 쓰지 않는다)
    let heldPatientIds: ReadonlySet<string> = new Set();
    if (h.patientScoped) {
      // 🔴 고정 문장 — 서버 조립 한국어 문장 기준선을 늘리지 않는다(대상 종류는 요청 경로·감사에 이미 있다)
      if (!h.honorsLegalHold) throw new ForbiddenException('환자 기록 파기 핸들러가 법적 보존명령 제외를 구현하지 않았다 — 파기 거부');
      try {
        heldPatientIds = await this.legalHold.heldPatientIds();
      } catch {
        throw new ForbiddenException('법적 보존명령 조회 실패 — 보존 대상이 섞일 수 있어 파기 거부');
      }
    }

    // ④ 4-eyes(G6) — 승인된(요청자≠승인자) 파기 요청을 consume. 없으면 거부.
    await this.approval.consume('RETENTION_PURGE', resourceType, actorId);

    const cutoff = this.cutoffFor(days, p.legalMinDays);
    const res = await h.purge(cutoff, { heldPatientIds });
    const purged = typeof res === 'number' ? res : res.purged;
    const detail = typeof res === 'number' ? null : res.detail;

    // 🔴 파기했는데 기록이 없으면 그것도 결함이다 — 무엇을(종류·세부) 몇 건·어느 기간(cutoff·일수)인지 남긴다
    await this.audit.log({
      userId: actorId,
      action: AuditAction.DELETE,
      resourceType: 'RETENTION_PURGE',
      resourceId: p.id,
      changes: {
        resourceType: { old: null, new: resourceType },
        purged: { old: null, new: purged },
        action: { old: null, new: p.action },
        cutoff: { old: null, new: cutoff.toISOString() },
        retentionDays: { old: null, new: days },
        ...(detail ? { detail: { old: null, new: detail } } : {}),
      },
    });
    this.logger.warn(`Retention purge ${resourceType} action=${p.action} purged=${purged} by=${actorId}`);
    return { resourceType, action: p.action, purged, cutoff: cutoff.toISOString() };
  }
}
