import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { SentinelAxis } from './sentinel.service';
import { CONTRACT_OBSERVATION_POINTS, contractCoverageNote } from './contract-observation';
import { PULSE_METRICS, PULSE_BASELINE_MINUTES } from './pulse-registry';
import { judgePulse, judgeSample, type PulseVerdict } from './pulse-anomaly';

/** P0 에서 실제로 도는 축. 나머지는 **미구현이라고 말한다**(0건이라 말하지 않는다) */
export const SENTINEL_AXES: { key: SentinelAxis; label: string; implemented: boolean }[] = [
  { key: 'DATA', label: '데이터 정합성', implemented: true },
  { key: 'FLOW', label: '흐름 완결성', implemented: true },
  { key: 'CONTRACT', label: '계약 드리프트', implemented: true },
  { key: 'PIPE', label: '파이프 생존', implemented: true },
];

/**
 * 스윕 주기(분) — 이보다 **두 배** 지나도록 성공한 스윕이 없으면 화면이 '감시자 정지'라고 말한다.
 * 🔴 운영 값이지 임상 정책이 아니라 상수로 둔다. 바꾸려면 여기와 pm2 크론을 함께 본다.
 */
export const SENTINEL_INTERVAL_MIN = 60;

export interface AxisView {
  key: SentinelAxis;
  label: string;
  implemented: boolean;
  /** 🔴 null = **미판정**. 0 과 다른 사실이다 — 스윕이 한 번도 성공하지 않았다는 뜻 */
  open: number | null;
  bySeverity: { RED: number; AMBER: number; INFO: number } | null;
  resolved: number | null;
  /** 🔴 관측하지 못한 항목 수 — '위반 0건'과 섞으면 안 된다 */
  unobservable: number | null;
  lastRun: {
    at: Date; ok: boolean; attempted: number; succeeded: number; failed: number;
    error: string | null; durationMs: number | null;
  } | null;
  /** 마지막 성공이 주기의 2배를 넘겼다 — 감시자가 멈춰 있을 수 있다 */
  stale: boolean;
  /** 화면이 그대로 쓸 한 줄. 왜 숫자가 없는지를 말한다 */
  unavailableReason: string | null;
  /**
   * 🔴 **무엇까지 보고 있는가.** 이 축의 '0건'이 어디까지의 0인지 밝힌다 —
   *    밝히지 않으면 "관측하지 않음"을 "위반 없음"으로 말하게 된다.
   */
  coverageNote: string | null;
}

/**
 * 관제 화면이 읽는 쪽. **판정하지 않고 사실만 전달한다.**
 *
 * 🔴 이 서비스의 유일한 임무는 "모르는 것을 0 으로 만들지 않는 것"이다.
 *    스윕이 안 돌았으면 `open: null` 이고 `unavailableReason` 이 그 이유를 말한다.
 */
@Injectable()
export class SentinelReadService {
  private readonly logger = new Logger(SentinelReadService.name);
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<{ axes: AxisView[]; generatedAt: string; intervalMin: number }> {
    const axes: AxisView[] = [];

    for (const a of SENTINEL_AXES) {
      const lastRun = await this.prisma.sentinelRun.findFirst({
        where: { axis: a.key },
        orderBy: { startedAt: 'desc' },
      });
      const lastOk = await this.prisma.sentinelRun.findFirst({
        where: { axis: a.key, ok: true },
        orderBy: { startedAt: 'desc' },
      });

      // 🔴 성공한 스윕이 한 번도 없으면 숫자를 내지 않는다. 저장된 findings 가 있어도
      //    그것이 "지금"을 말한다고 보장할 수 없다 — 다만 있다면 언제 것인지 함께 말한다.
      const everSucceeded = !!lastOk;
      const stale = everSucceeded
        ? Date.now() - lastOk!.startedAt.getTime() > SENTINEL_INTERVAL_MIN * 2 * 60_000
        : false;

      let open: number | null = null;
      let bySeverity: AxisView['bySeverity'] = null;
      let resolved: number | null = null;
      let unobs: number | null = null;
      let reason: string | null = null;
      let coverage: string | null = null;

      if (!a.implemented) {
        reason = '이 축은 아직 구현되지 않았습니다(P0 범위 밖) — 위반이 없다는 뜻이 아닙니다.';
      } else if (!everSucceeded) {
        reason = lastRun
          ? `스윕이 성공한 적이 없습니다(마지막 시도 실패: ${lastRun.error ?? '사유 미기록'}).`
          : '스윕이 아직 한 번도 실행되지 않았습니다.';
      } else {
        const rows = await this.prisma.sentinelFinding.findMany({
          where: { axis: a.key },
          select: { severity: true, resolvedAt: true, unobservable: true },
        });
        // 🔴 관측하지 못한 항목은 위반도 해결도 아니다 — 세 번째 칸으로 뺀다
        unobs = rows.filter((r) => r.unobservable).length;
        const judged = rows.filter((r) => !r.unobservable);
        const live = judged.filter((r) => !r.resolvedAt);
        open = live.length;
        resolved = judged.length - live.length;
        bySeverity = {
          RED: live.filter((r) => r.severity === 'RED').length,
          AMBER: live.filter((r) => r.severity === 'AMBER').length,
          INFO: live.filter((r) => r.severity === 'INFO').length,
        };
        if (stale) {
          reason = `마지막 성공 스윕이 ${SENTINEL_INTERVAL_MIN * 2}분을 넘겼습니다 — 아래 숫자는 그 시점의 것입니다.`;
        }
        // 🔴 계약 축의 0 은 "관측점 안에서의 0" 이다. 그 범위를 함께 말한다.
        if (a.key === 'CONTRACT') coverage = contractCoverageNote();
      }

      axes.push({
        key: a.key, label: a.label, implemented: a.implemented,
        open, bySeverity, resolved, unobservable: unobs, coverageNote: coverage,
        lastRun: lastRun
          ? {
            at: lastRun.startedAt, ok: lastRun.ok, attempted: lastRun.attempted,
            succeeded: lastRun.succeeded, failed: lastRun.failed,
            error: lastRun.error, durationMs: lastRun.durationMs,
          }
          : null,
        stale,
        unavailableReason: reason,
      });
    }

    return { axes, generatedAt: new Date().toISOString(), intervalMin: SENTINEL_INTERVAL_MIN };
  }

  /**
   * 감시 운영 대시보드 — 판정 커버리지·체류일·스윕 건강·해결 이력·알림.
   *
   * 🔴 전부 **사실**만 낸다: 비율 대신 분자/분모, 표본 없으면 null(산출 불가),
   *    체류일은 사실이고 "지연" 판정은 하지 않는다(임계를 지어내지 않는다).
   */
  async dashboard() {
    const now = Date.now();
    const since24h = new Date(now - 24 * 3_600_000);
    const since7d = new Date(now - 7 * 86_400_000);

    // 스윕 건강 24h — 축별 시도/성공/실패·소요(표본 없으면 null)
    const runs24 = await this.prisma.sentinelRun.findMany({
      where: { startedAt: { gte: since24h } },
      orderBy: { startedAt: 'desc' },
    });
    const sweep24h = SENTINEL_AXES.map((a) => {
      const rs = runs24.filter((r) => r.axis === a.key);
      const durations = rs
        .map((r) => r.durationMs)
        .filter((d): d is number => d != null)
        .sort((x, y) => x - y);
      return {
        axis: a.key,
        label: a.label,
        runs: rs.length,
        ok: rs.filter((r) => r.ok).length,
        failedRuns: rs.filter((r) => !r.ok).length,
        durationMsP50: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null,
        durationMsMax: durations.length ? durations[durations.length - 1] : null,
      };
    });

    // 발견→해결 — 전 기간 해결 표본. 표본 수를 항상 병기한다.
    //
    // 🔴 첫 스윕이 0 을 보고 행을 만들며 **생성과 동시에 해결**로 적은 행(born-resolved)은
    //    "열렸다가 해결된 발견"이 아니라 표본이 아니다 — 운영 실측(2026-09-04)에서 53건 중
    //    47건이 이 부류였고(같은 초·now() 두 번의 마이크로초 역전으로 음수까지 나옴)
    //    이를 섞으면 중앙값이 -0.1일 같은 거짓을 낸다. 해결은 다음 스윕에서만 관측되므로
    //    진짜 표본의 최솟값은 스윕 주기(60분)다 — 1분 미만은 전부 동시 생성 부류다.
    //    제외하되 버리지 않는다: bornResolvedN 으로 함께 내 화면이 분모를 밝힌다.
    const resolvedRows = await this.prisma.sentinelFinding.findMany({
      where: { resolvedAt: { not: null } },
      select: { firstSeenAt: true, resolvedAt: true },
    });
    const diffsMs = resolvedRows.map((r) => r.resolvedAt!.getTime() - r.firstSeenAt.getTime());
    const diffs = diffsMs
      .filter((ms) => ms >= 60_000)
      .map((ms) => ms / 86_400_000)
      .sort((a, b) => a - b);
    const resolution = {
      sampleN: diffs.length,
      bornResolvedN: diffsMs.length - diffs.length,
      // 내부 계산 절단(소수 1자리) — 표시 정책 대상 아님. 표본 0 이면 산출 불가.
      medianDays: diffs.length ? Math.floor(diffs[Math.floor((diffs.length - 1) / 2)] * 10) / 10 : null,
    };

    // 알림 — 최근 7일에 실제 발신된 건수(발신 시도가 아니라 notifiedAt 이 찍힌 것)
    const notified7d = await this.prisma.sentinelFinding.count({
      where: { notifiedAt: { gte: since7d } },
    });

    return {
      sweep24h,
      resolution,
      notified7d,
      runs: runs24.slice(0, 40).map((r) => ({
        axis: r.axis, startedAt: r.startedAt, ok: r.ok,
        attempted: r.attempted, succeeded: r.succeeded, failed: r.failed,
        error: r.error, durationMs: r.durationMs,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** 발견 목록 — 기본은 미해결만(줄어드는 목록). `includeResolved` 로 추이도 본다 */
  async findings(opts: { axis?: SentinelAxis; includeResolved?: boolean } = {}) {
    const rows = await this.prisma.sentinelFinding.findMany({
      where: {
        ...(opts.axis ? { axis: opts.axis } : {}),
        ...(opts.includeResolved ? {} : { resolvedAt: null }),
      },
      orderBy: [{ severity: 'asc' }, { value: 'desc' }],
    });
    // severity 정렬은 문자열이라 RED/AMBER/INFO 순서가 아니다 — 명시 순서로 다시 세운다
    const rank: Record<string, number> = { RED: 0, AMBER: 1, INFO: 2 };
    return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.value - a.value);
  }

  /**
   * 실시간 축 — 지표별 최근 시계열 + 지금 판정.
   *
   * 🔴 **판정을 다시 계산한다**(저장하지 않는다). 틱이 판정을 저장해 두면 화면이 낡은 판정을
   *    보게 되고, 그 사이 baseline 이 바뀐 것을 반영하지 못한다. 계산은 값싸다.
   * 🔴 마지막 관측 시각을 함께 준다 — 틱이 멈추면 화면이 그것을 먼저 말해야 한다.
   */
  async pulses(windowMinutes = 120): Promise<{
    metrics: {
      key: string; label: string; unit: string | null; severity: string; drillDown: string | null; why: string;
      current: number | null; lastAt: string | null; stale: boolean;
      series: { at: string; v: number }[];
      verdict: PulseVerdict | null;
    }[];
    tickIntervalSec: number;
    generatedAt: string;
  }> {
    const now = Date.now();
    const seriesSince = new Date(now - windowMinutes * 60_000);
    const baseSince = new Date(now - PULSE_BASELINE_MINUTES * 60_000);
    const out = [];

    for (const m of PULSE_METRICS) {
      const rows = await this.prisma.sentinelPulse.findMany({
        where: { metric: m.key, at: { gte: baseSince } },
        select: { value: true, at: true },
        orderBy: { at: 'asc' },
      });
      const latest = rows.at(-1) ?? null;
      // 🔴 마지막 관측이 3분을 넘겼으면 틱이 멈춘 것이다 — 값을 '지금'이라 말하지 않는다
      const stale = latest ? now - latest.at.getTime() > 3 * 60_000 : true;
      const baseline = rows.slice(0, -1).map((r) => r.value);
      let verdict: PulseVerdict | null = latest ? judgePulse(m, baseline, latest.value) : null;
      let current = latest ? latest.value : null;

      /**
       * 🔴 표본 게이트가 걸린 지표는 **지금** 산출 가능한지를 여기서 다시 본다.
       *    틱은 표본이 모자라면 아무것도 쌓지 않는다 → 화면은 그것을 '낡음(감시자 정지 의심)'으로
       *    읽게 되는데, 그건 **틀린 진단**이다. 정지한 것이 아니라 낼 값이 없는 것이다.
       *    분모를 못 읽으면 `NOT_COMPUTABLE` 이라 단정하지 않는다(모르는 것은 모른다고 둔다).
       */
      if (m.minSample != null) {
        try {
          const [row] = await this.prisma.$queryRawUnsafe<{ n: number; d?: number }[]>(m.sql);
          const d = row?.d == null ? null : Number(row.d);
          if (d != null && Number.isFinite(d)) {
            const short = judgeSample(m, d);
            if (short) {
              verdict = short;
              // 🔴 낼 수 없는 값 자리에 지난 값을 두면 화면이 그것을 '지금'으로 읽는다
              current = null;
            }
          }
        } catch (e) {
          this.logger.warn(`펄스 표본 게이트 확인 실패(${m.key}) — 산출 불가라 단정하지 않습니다: ${e instanceof Error ? e.message : e}`);
        }
      }

      out.push({
        key: m.key, label: m.label, unit: m.unit ?? null, severity: m.severity,
        drillDown: m.drillDown ?? null, why: m.why,
        current,
        lastAt: latest ? latest.at.toISOString() : null,
        stale,
        series: rows.filter((r) => r.at >= seriesSince).map((r) => ({ at: r.at.toISOString(), v: r.value })),
        verdict,
      });
    }
    return { metrics: out, tickIntervalSec: 60, generatedAt: new Date().toISOString() };
  }
}
