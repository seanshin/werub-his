import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  toFullScanSql, parseIntegrityRows, readIntegritySql, INTEGRITY_DRILLDOWN,
  type IntegrityRow, type IntegrityCheck,
} from './integrity-sweep';
import { PIPE_CHECKS } from './pipe-registry';
import { FLOW_STAGES } from './flow-registry';
import { PULSE_METRICS, PULSE_BASELINE_MINUTES } from './pulse-registry';
import { judgePulse, judgeSample, type PulseVerdict } from './pulse-anomaly';
import {
  probeFileAge, probeCronInactive, probeCronRegistered, probeUnconsumedEvents,
  probePublicSite, probeBackupStatus, probeOutboxIdle, probeOutboxStuck,
  repoApiSrc, unobservable, type ProbeResult, type CronSnapshot, type OutboxSnapshot,
} from './pipe-sweep';

export type SentinelAxis = 'DATA' | 'FLOW' | 'CONTRACT' | 'PIPE';

/**
 * 상시 감시자 — 축 A(데이터 정합성) 스윕.
 *
 * 🔴 **감시자 자신이 정직해야 한다.** 이건 가정이 아니다 — 같은 저장소의 품질 일일 스냅샷이
 *    저장 실패분까지 성공으로 세고 "저장 N건"이라 남기고 있었다(2026-09-02 수정).
 *    추이를 보는 도구가 그러면 추이 전체를 믿을 수 없다.
 *    그래서 여기서는 **시도/성공/실패를 따로 세고**, 실패 사유를 원장에 남긴다.
 *
 * 🔴 **감시자는 임상 데이터를 고치지 않는다.** 읽고, 자기 두 테이블에만 쓴다.
 */
@Injectable()
export class SentinelService {
  private readonly logger = new Logger(SentinelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 🔴 **신규 발생만 알린다.** 기존 항목을 매 스윕 다시 알리면 소음이 되고,
   *    소음은 진짜 경보를 죽인다(기획 §5 · P4 완료 판정 "기존 항목 재알림 0").
   *
   * 알림 대상이 되는 두 경우:
   *   ① 이 행을 **처음 만들 때**(create) — 단, 처음부터 위반이 아닌 것은 제외
   *   ② **해결됐다가 재발**할 때(이전에 resolvedAt 이 있었는데 지금 다시 위반)
   *
   * 🔴 관측 불가는 알리지 않는다 — "확인 못 함"으로 사람을 깨우면 그게 소음이다.
   *    화면에는 남고, 알림은 가지 않는다.
   */
  private notifyOnCreate(isViolation: boolean): boolean {
    return isViolation;
  }

  private notifyOnUpdate(prev: { resolvedAt: Date | null } | null, isViolation: boolean): boolean {
    return isViolation && prev?.resolvedAt != null;
  }

  /**
   * 축 A 스윕 1회.
   * @param repoRoot 정합성 SQL 을 읽을 저장소 루트(감시자 프로세스의 cwd 기준)
   */
  async sweepData(repoRoot: string): Promise<{ runId: string; attempted: number; succeeded: number; failed: number; ok: boolean }> {
    const started = Date.now();
    const run = await this.prisma.sentinelRun.create({ data: { axis: 'DATA', startedAt: new Date() } });

    let checks: IntegrityCheck[];
    try {
      const sql = toFullScanSql(readIntegritySql(repoRoot));
      const rows = await this.prisma.$queryRawUnsafe<IntegrityRow[]>(sql);
      checks = parseIntegrityRows(rows.map((r) => ({
        // psql 별칭이 한글이라 키가 '구분'·'점검 항목'·'건수' 로 온다
        sev: (r as unknown as Record<string, unknown>)['구분'] as string ?? r.sev,
        chk: (r as unknown as Record<string, unknown>)['점검 항목'] as string ?? r.chk,
        n: Number((r as unknown as Record<string, unknown>)['건수'] ?? r.n),
      })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 🔴 스윕이 통째로 실패하면 **이전 결과를 그대로 두고** 실패를 기록한다.
      //    지우면 "위반 0건"으로 보이고, 그것이 이 감시자가 가장 피해야 할 거짓말이다.
      await this.prisma.sentinelRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: false, error: msg, durationMs: Date.now() - started },
      });
      this.logger.error(`축 A 스윕 실패: ${msg}`);
      throw e;
    }

    if (checks.length === 0) {
      // 🔴 0개는 "전부 정상"이 아니라 **추출이 깨졌다**는 뜻이다. 성공으로 적지 않는다.
      const msg = '정합성 스캔이 0행을 반환했습니다 — 스캔이 깨졌거나 DB 에 닿지 못했습니다(전부 정상이 아닙니다)';
      await this.prisma.sentinelRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: false, error: msg, durationMs: Date.now() - started },
      });
      throw new Error(msg);
    }

    const failed: string[] = [];
    let succeeded = 0;
    const now = new Date();

    for (const c of checks) {
      try {
        const prev = await this.prisma.sentinelFinding.findUnique({
          where: { axis_checkKey: { axis: 'DATA', checkKey: c.key } },
        });
        await this.prisma.sentinelFinding.upsert({
          where: { axis_checkKey: { axis: 'DATA', checkKey: c.key } },
          create: {
            axis: 'DATA', checkKey: c.key, severity: c.severity, label: c.label,
            value: c.value, prevValue: null, lastSeenAt: now,
            // 처음 봤는데 이미 0이면 해결된 상태로 둔다(없던 문제를 새로 만들지 않는다)
            resolvedAt: c.value === 0 ? now : null,
            drillDown: INTEGRITY_DRILLDOWN[c.key] ?? null,
            notifyPending: this.notifyOnCreate(c.value > 0),
          },
          update: {
            severity: c.severity, label: c.label,
            value: c.value, prevValue: prev?.value ?? null, lastSeenAt: now,
            // 🔴 0 이 되면 **지우지 않고** 해결 표시만 한다 — 지우면 추이가 사라진다
            resolvedAt: c.value === 0 ? (prev?.resolvedAt ?? now) : null,
            drillDown: INTEGRITY_DRILLDOWN[c.key] ?? null,
            ...(this.notifyOnUpdate(prev, c.value > 0) ? { notifyPending: true } : {}),
          },
        });
        succeeded += 1;
      } catch (e) {
        failed.push(`${c.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const ok = failed.length === 0;
    await this.prisma.sentinelRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok,
        attempted: checks.length, succeeded, failed: failed.length,
        error: failed.length ? failed.slice(0, 10).join(' | ') : null,
        durationMs: Date.now() - started,
      },
    });

    const open = checks.filter((c) => c.value > 0).length;
    this.logger.log(
      `축 A 스윕 완료 — 평가 ${checks.length} · 위반 ${open} · 저장 성공 ${succeeded}` +
      (failed.length ? ` · 저장 실패 ${failed.length}` : ''),
    );
    return { runId: run.id, attempted: checks.length, succeeded, failed: failed.length, ok };
  }

  /**
   * 축 D — 파이프 생존 스윕.
   *
   * 🔴 **관측 불가를 위반 0 으로 접지 않는다.** 프로브가 실패하면 `unobservable: true` 로 남기고
   *    화면이 그것을 0 과 다르게 그린다. 백업 경로가 틀렸을 때 "백업 정상"이라 말하는 것이
   *    이 축에서 가장 위험한 거짓말이다.
   *
   * @param deps API 프로브 결과(감시자가 HTTP 로 받아온다). 닿지 못했으면 null 을 넘긴다 —
   *             그러면 크론·공개사이트 항목이 **관측 불가**가 된다(정상이라 말하지 않는다).
   */
  /**
   * outbox 관측 스냅샷 — 조회 실패는 `null`(관측 불가)로 돌린다.
   * 🔴 실패를 `{failed:0}` 으로 접으면 이 감시자가 잡으려는 결함(근거 없이 안심시킴)을 스스로 저지른다.
   */
  private async outboxSnapshot(): Promise<OutboxSnapshot | null> {
    try {
      const now = new Date();
      const [last, failed, overduePending, subs, erpEnabled, erpUrl] = await Promise.all([
        this.prisma.integrationOutbox.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
        this.prisma.integrationOutbox.count({ where: { status: 'FAILED' } }),
        this.prisma.integrationOutbox.count({ where: { status: 'PENDING', nextAttemptAt: { lt: new Date(now.getTime() - 3_600_000) } } }),
        this.prisma.hisWebhook.count({ where: { isActive: true } }),
        this.prisma.systemConfig.findUnique({ where: { key: 'erp.webhookEnabled' }, select: { value: true } }),
        this.prisma.systemConfig.findUnique({ where: { key: 'erp.webhookUrl' }, select: { value: true } }),
      ]);
      const erpOn = String(erpEnabled?.value ?? '').includes('true') && Boolean(erpUrl?.value);
      return {
        enabled: erpOn || subs > 0,
        lastEnqueuedAt: last?.createdAt ?? null,
        failed,
        overduePending,
      };
    } catch (e) {
      this.logger.warn(`outbox 관측 실패: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async sweepPipe(
    repoRoot: string,
    deps: {
      cron: CronSnapshot | null;
      publicSite: { checked: boolean; fresh: boolean | null; detail: string } | null;
      expectedCrons: number;
      /** 프로브가 없을 때의 사유 — 없으면 "확인하지 못했습니다"만 남아 원인을 알 수 없다 */
      cronReason?: string | null;
      publicSiteReason?: string | null;
    },
  ): Promise<{ runId: string; attempted: number; succeeded: number; failed: number; ok: boolean }> {
    const started = Date.now();
    const run = await this.prisma.sentinelRun.create({ data: { axis: 'PIPE', startedAt: new Date() } });

    const results = new Map<string, ProbeResult>();
    for (const c of PIPE_CHECKS) {
      try {
        switch (c.key) {
          case 'pipe.backup':
            results.set(c.key, probeFileAge(c.target!, c.maxAgeHours!, {
              pattern: c.filePattern ? new RegExp(c.filePattern) : undefined,
            }));
            break;
          case 'pipe.backup.secondCopy':
            results.set(c.key, probeBackupStatus(c.target!, 'secondCopy'));
            break;
          case 'pipe.backup.filesArchive':
            results.set(c.key, probeBackupStatus(c.target!, 'filesArchive'));
            break;
          case 'pipe.backup.restoreVerify':
            results.set(c.key, probeBackupStatus(c.target!, 'restoreVerify', { maxAgeHours: c.maxAgeHours }));
            break;
          case 'pipe.cron.inactive':
            results.set(c.key, deps.cron ? probeCronInactive(deps.cron) : unobservable(deps.cronReason ?? 'API 프로브가 없습니다'));
            break;
          case 'pipe.cron.registered':
            results.set(c.key, deps.cron ? probeCronRegistered(deps.cron, deps.expectedCrons) : unobservable(deps.cronReason ?? 'API 프로브가 없습니다'));
            break;
          case 'pipe.publicSite':
            results.set(c.key, deps.publicSite ? probePublicSite(deps.publicSite) : unobservable(deps.publicSiteReason ?? 'API 프로브가 없습니다'));
            break;
          case 'pipe.outbox.idle': {
            const snap = await this.outboxSnapshot();
            results.set(c.key, probeOutboxIdle(snap, c.maxAgeHours ?? 24 * 14));
            break;
          }
          case 'pipe.outbox.stuck': {
            const snap = await this.outboxSnapshot();
            results.set(c.key, probeOutboxStuck(snap));
            break;
          }
          case 'pipe.event.unconsumed':
            results.set(c.key, probeUnconsumedEvents(repoApiSrc(repoRoot)));
            break;
          default:
            // 🔴 등록부에 있는데 프로브가 없으면 조용히 빠지지 않게 관측 불가로 남긴다
            results.set(c.key, unobservable('이 항목의 프로브가 구현되지 않았습니다'));
        }
      } catch (e) {
        results.set(c.key, unobservable(`프로브 실패: ${e instanceof Error ? e.message : e}`));
      }
    }

    const failed: string[] = [];
    let succeeded = 0;
    const now = new Date();
    for (const c of PIPE_CHECKS) {
      const r = results.get(c.key)!;
      try {
        const prev = await this.prisma.sentinelFinding.findUnique({
          where: { axis_checkKey: { axis: 'PIPE', checkKey: c.key } },
        });
        // 관측 불가는 '해결됨'이 아니다 — resolvedAt 을 붙이지 않는다
        const resolved = r.observable && r.value === 0;
        await this.prisma.sentinelFinding.upsert({
          where: { axis_checkKey: { axis: 'PIPE', checkKey: c.key } },
          create: {
            axis: 'PIPE', checkKey: c.key, severity: c.severity, label: c.label,
            value: r.value, prevValue: null, lastSeenAt: now,
            resolvedAt: resolved ? now : null,
            drillDown: c.drillDown ?? null,
            unobservable: !r.observable, detail: r.detail,
            notifyPending: this.notifyOnCreate(r.observable && r.value > 0),
          },
          update: {
            severity: c.severity, label: c.label,
            value: r.value, prevValue: prev?.value ?? null, lastSeenAt: now,
            resolvedAt: resolved ? (prev?.resolvedAt ?? now) : null,
            drillDown: c.drillDown ?? null,
            unobservable: !r.observable, detail: r.detail,
            ...(this.notifyOnUpdate(prev, r.observable && r.value > 0) ? { notifyPending: true } : {}),
          },
        });
        succeeded += 1;
      } catch (e) {
        failed.push(`${c.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const unobs = PIPE_CHECKS.filter((c) => !results.get(c.key)!.observable).length;
    const open = PIPE_CHECKS.filter((c) => { const r = results.get(c.key)!; return r.observable && r.value > 0; }).length;
    const ok = failed.length === 0;
    await this.prisma.sentinelRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok,
        attempted: PIPE_CHECKS.length, succeeded, failed: failed.length,
        error: failed.length ? failed.slice(0, 10).join(' | ') : null,
        durationMs: Date.now() - started,
      },
    });
    this.logger.log(
      `축 D 스윕 완료 — 평가 ${PIPE_CHECKS.length} · 위반 ${open} · 관측 불가 ${unobs} · 저장 성공 ${succeeded}` +
      (failed.length ? ` · 저장 실패 ${failed.length}` : ''),
    );
    return { runId: run.id, attempted: PIPE_CHECKS.length, succeeded, failed: failed.length, ok };
  }

  /**
   * 축 C — 계약 드리프트 스윕.
   *
   * 🔴 런타임 신호는 **API 가 적고 감시자가 판정한다**(기획 §2.1). 여기서는 원장을 읽어
   *    발견으로 승격할 뿐, 요청 경로를 건드리지 않는다.
   * 🔴 신호가 **하나도 없는 것은 "드리프트 0"이 아니다** — 그 자리를 지나는 요청이 없었을 수도 있다.
   *    그래서 최근 관측 창(`sinceHours`) 안에 신호가 없으면 **관측 불가**로 남긴다.
   *
   * @param staleHours 이보다 오래 안 보인 신호는 '해결됨'으로 접는다(고쳐졌을 수 있다)
   */
  async sweepContract(opts: { staleHours?: number } = {}): Promise<{ runId: string; attempted: number; succeeded: number; failed: number; ok: boolean }> {
    const started = Date.now();
    const staleHours = opts.staleHours ?? 24;
    const run = await this.prisma.sentinelRun.create({ data: { axis: 'CONTRACT', startedAt: new Date() } });

    let signals: { kind: string; producer: string; consumer: string; detail: string; hitCount: number; lastSeenAt: Date; firstSeenAt: Date }[];
    try {
      signals = await this.prisma.sentinelRuntimeSignal.findMany({ orderBy: { hitCount: 'desc' } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.sentinelRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: false, error: msg, durationMs: Date.now() - started },
      });
      this.logger.error(`축 C 스윕 실패: ${msg}`);
      throw e;
    }

    const now = new Date();
    const staleMs = staleHours * 3_600_000;
    const failed: string[] = [];
    let succeeded = 0;

    for (const sig of signals) {
      const key = `drift.${sig.kind}.${sig.consumer}`;
      // 🔴 최근에 안 보였다고 '고쳐졌다'고 단정하지 않는다 — 그 경로를 아무도 안 지났을 수도 있다.
      //    그래서 해결 표시에 그 사실을 함께 적는다(사람이 확인할 근거를 남긴다).
      const stale = now.getTime() - sig.lastSeenAt.getTime() > staleMs;
      try {
        const prev = await this.prisma.sentinelFinding.findUnique({
          where: { axis_checkKey: { axis: 'CONTRACT', checkKey: key } },
        });
        await this.prisma.sentinelFinding.upsert({
          where: { axis_checkKey: { axis: 'CONTRACT', checkKey: key } },
          create: {
            axis: 'CONTRACT', checkKey: key, severity: 'RED',
            label: `${sig.consumer} 가 ${sig.producer} 의 값을 잃습니다`,
            value: sig.hitCount, prevValue: null, lastSeenAt: now,
            resolvedAt: stale ? now : null,
            detail: stale
              ? `${staleHours}시간 넘게 재관측되지 않았습니다(고쳐졌거나 그 경로를 아무도 지나지 않았습니다) — ${sig.detail}`
              : sig.detail,
            notifyPending: this.notifyOnCreate(!stale),
          },
          update: {
            severity: 'RED',
            label: `${sig.consumer} 가 ${sig.producer} 의 값을 잃습니다`,
            value: sig.hitCount, prevValue: prev?.value ?? null, lastSeenAt: now,
            resolvedAt: stale ? (prev?.resolvedAt ?? now) : null,
            detail: stale
              ? `${staleHours}시간 넘게 재관측되지 않았습니다(고쳐졌거나 그 경로를 아무도 지나지 않았습니다) — ${sig.detail}`
              : sig.detail,
            ...(this.notifyOnUpdate(prev, !stale) ? { notifyPending: true } : {}),
          },
        });
        succeeded += 1;
      } catch (e) {
        failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const ok = failed.length === 0;
    await this.prisma.sentinelRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok,
        attempted: signals.length, succeeded, failed: failed.length,
        error: failed.length ? failed.slice(0, 10).join(' | ') : null,
        durationMs: Date.now() - started,
      },
    });
    this.logger.log(`축 C 스윕 완료 — 신호 ${signals.length} · 저장 성공 ${succeeded}` + (failed.length ? ` · 실패 ${failed.length}` : ''));
    return { runId: run.id, attempted: signals.length, succeeded, failed: failed.length, ok };
  }

  /**
   * 축 B — 흐름 완결성 스윕.
   *
   * 🔴 **임계를 지어내지 않는다.** 표본이 `minSample` 미만이면 임계를 만들지 않고
   *    관측 불가로 남기며, 화면이 "표본 N건 — 임계 산출에 M건 필요"라고 말한다.
   *    2026-09-02 운영 실측 표본은 12~16건이었다(외래 완료 총 4건) —
   *    그 표본으로 뽑은 p95(564분)는 이상치 하나가 만든 값이다.
   *
   * 🔴 임계가 서면 그때 **지금 진행 중인 건** 중 임계를 넘긴 수를 센다.
   *    "조건이 참인가"가 아니라 "얼마나 참인가"를 재야 아티팩트와 사실이 갈린다.
   */
  async sweepFlow(): Promise<{ runId: string; attempted: number; succeeded: number; failed: number; ok: boolean }> {
    const started = Date.now();
    const run = await this.prisma.sentinelRun.create({ data: { axis: 'FLOW', startedAt: new Date() } });

    const failed: string[] = [];
    let succeeded = 0;
    const now = new Date();

    for (const st of FLOW_STAGES) {
      let observable = false;
      let value = 0;
      let detail = '';
      try {
        const [dist] = await this.prisma.$queryRawUnsafe<{ n: number; p50: number | null; p95: number | null }[]>(st.distSql);
        const n = Number(dist?.n ?? 0);
        const p95 = dist?.p95 == null ? null : Number(dist.p95);

        if (n < st.minSample || p95 == null) {
          // 🔴 표본 부족은 '지연 0건'이 아니다 — 임계를 만들지 않고 그 사실을 말한다
          detail = `표본 ${n}건 — 임계 산출에 최소 ${st.minSample}건이 필요합니다(임계를 지어내지 않습니다).`;
        } else {
          const threshold = Math.round(p95 * 2);
          const [pend] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(st.pendingSql, threshold);
          observable = true;
          value = Number(pend?.n ?? 0);
          const p50 = dist?.p50 == null ? null : Math.round(Number(dist.p50));
          detail = `임계 ${threshold}분(표본 ${n}건 · p95 ${Math.round(p95)}분 × 2` +
            (p50 == null ? '' : ` · 중앙값 ${p50}분`) + ') 초과 진행 건';
        }
      } catch (e) {
        detail = `분포 조회 실패: ${e instanceof Error ? e.message : e}`;
      }

      try {
        const prev = await this.prisma.sentinelFinding.findUnique({
          where: { axis_checkKey: { axis: 'FLOW', checkKey: st.key } },
        });
        const resolved = observable && value === 0;
        await this.prisma.sentinelFinding.upsert({
          where: { axis_checkKey: { axis: 'FLOW', checkKey: st.key } },
          create: {
            axis: 'FLOW', checkKey: st.key, severity: st.severity, label: st.label,
            value, prevValue: null, lastSeenAt: now,
            resolvedAt: resolved ? now : null,
            drillDown: st.drillDown ?? null,
            unobservable: !observable, detail,
            notifyPending: this.notifyOnCreate(observable && value > 0),
          },
          update: {
            severity: st.severity, label: st.label,
            value, prevValue: prev?.value ?? null, lastSeenAt: now,
            resolvedAt: resolved ? (prev?.resolvedAt ?? now) : null,
            drillDown: st.drillDown ?? null,
            unobservable: !observable, detail,
            ...(this.notifyOnUpdate(prev, observable && value > 0) ? { notifyPending: true } : {}),
          },
        });
        succeeded += 1;
      } catch (e) {
        failed.push(`${st.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const ok = failed.length === 0;
    await this.prisma.sentinelRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok,
        attempted: FLOW_STAGES.length, succeeded, failed: failed.length,
        error: failed.length ? failed.slice(0, 10).join(' | ') : null,
        durationMs: Date.now() - started,
      },
    });
    this.logger.log(`축 B 스윕 완료 — 단계 ${FLOW_STAGES.length} · 저장 성공 ${succeeded}` + (failed.length ? ` · 실패 ${failed.length}` : ''));
    return { runId: run.id, attempted: FLOW_STAGES.length, succeeded, failed: failed.length, ok };
  }

  /**
   * 실시간 틱 — **1분마다** 값싼 지표를 재서 시계열에 쌓고 급변을 판정한다.
   *
   * 🔴 딥 스윕과 다른 층이다. 여기서는 인덱스를 타는 카운트만 본다(실측 1~12ms).
   * 🔴 판정할 수 없으면 판정하지 않는다 — baseline 부족(WARMING)·변동 없음(FLAT)은
   *    이상이 아니다. 그 구분을 잃으면 이 축이 거짓 경보 공장이 된다.
   * 🔴 **틱은 조용하다.** 급변을 찾아도 알림을 만들지 않는다(P4 알림 경로를 타지 않는다) —
   *    거짓 경보율을 사람이 눈으로 본 뒤 켜는 것이 순서다. 화면에는 즉시 뜬다.
   */
  async tickPulse(): Promise<{ measured: number; failed: number; notComputable: string[]; anomalies: string[] }> {
    const now = new Date();
    const since = new Date(now.getTime() - PULSE_BASELINE_MINUTES * 60_000);
    const anomalies: string[] = [];
    let measured = 0;
    const failures: string[] = [];
    /** 🔴 실패가 아니다 — 표본이 모자라 **값을 낼 수 없었던** 지표. 0 을 쌓지 않는다 */
    const notComputable: string[] = [];

    for (const m of PULSE_METRICS) {
      let value: number;
      let gated = false;
      try {
        const [row] = await this.prisma.$queryRawUnsafe<{ n: number; d?: number }[]>(m.sql);
        // 🔴 표본 게이트를 **값보다 먼저** 본다. 분모가 모자라면 값은 잡음이라 볼 필요가 없다.
        //    분모를 읽지 못하는 것은 다른 사실이다(게이트를 확인할 수 없다) → 실패로 던진다.
        if (m.minSample != null) {
          const rawD = row?.d;
          if (rawD === null || rawD === undefined) {
            throw new Error('표본(d)이 비어 있습니다 — 표본 게이트를 확인할 수 없습니다(0 으로 접지 않습니다)');
          }
          const d = Number(rawD);
          if (!Number.isFinite(d)) throw new Error(`숫자가 아닌 표본(d): ${String(rawD)}`);
          const short = judgeSample(m, d);
          if (short) {
            notComputable.push(`${m.key}: ${short.detail}`);
            gated = true;
          }
        }
        if (gated) continue;
        // 🔴 `?? 0` 을 쓰면 **NULL·행 없음이 조용히 0 이 된다** — 그게 이 틱이 막으려는 바로 그것이다.
        //    (처음에 그렇게 써 놓고 테스트가 잡았다)
        const raw = row?.n;
        if (raw === null || raw === undefined) throw new Error('결과가 비어 있습니다(0 으로 접지 않습니다)');
        value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`숫자가 아닌 결과: ${String(raw)}`);
      } catch (e) {
        // 🔴 잴 수 없으면 **0 을 쌓지 않는다** — 0 을 쌓으면 baseline 이 오염되고
        //    다음 정상 값이 급변으로 잡힌다(감시자가 스스로 거짓 경보를 만든다).
        // 🔴 Prisma raw 오류는 message 가 비어 있을 수 있다 — 사유가 빈 채로 남으면
        //    "실패했다"만 알고 **왜인지 모른다**(실제로 그렇게 로그가 잘렸다).
        const why = e instanceof Error ? (e.message || e.name || String(e)) : String(e);
        failures.push(`${m.key}: ${why.split('\n')[0].slice(0, 200) || '사유 미상'}`);
        continue;
      }

      try {
        const prior = await this.prisma.sentinelPulse.findMany({
          where: { metric: m.key, at: { gte: since } },
          select: { value: true },
          orderBy: { at: 'desc' },
          take: PULSE_BASELINE_MINUTES,
        });
        const verdict: PulseVerdict = judgePulse(m, prior.map((p) => p.value), value);
        if (verdict.kind === 'ANOMALY') anomalies.push(`${m.key}: ${verdict.detail}`);

        await this.prisma.sentinelPulse.create({ data: { metric: m.key, value, at: now } });
        measured += 1;
      } catch (e) {
        failures.push(`${m.key}(저장): ${e instanceof Error ? e.message : e}`);
      }
    }

    if (failures.length) {
      this.logger.warn(`펄스 틱 부분 실패 ${failures.length}/${PULSE_METRICS.length}: ${failures.slice(0, 3).join(' | ')}`);
    }
    // 🔴 표본 부족은 실패가 아니다 — 경고로 올리면 진짜 실패가 묻힌다(정상적으로 흔한 상태다)
    if (notComputable.length) {
      this.logger.debug(`펄스 산출 불가(표본 부족) ${notComputable.length}건 — ${notComputable.slice(0, 3).join(' | ')}`);
    }
    if (anomalies.length) {
      this.logger.warn(`펄스 급변 ${anomalies.length}건 — ${anomalies.slice(0, 3).join(' | ')}`);
    }
    return { measured, failed: failures.length, notComputable, anomalies };
  }

  /** 오래된 펄스 정리 — 보존은 baseline 창의 2배(48시간)면 충분하다 */
  async prunePulse(): Promise<number> {
    const cutoff = new Date(Date.now() - PULSE_BASELINE_MINUTES * 2 * 60_000);
    const r = await this.prisma.sentinelPulse.deleteMany({ where: { at: { lt: cutoff } } });
    return r.count;
  }
}
