import { Injectable, Optional } from '@nestjs/common';
import { foldSeverityCounts } from '@hospital-run/shared';
import { evaluateMeetTarget, resolveIndicatorPolicy } from '../quality/indicator-policy';
import { ACTIVE_MEASUREMENT, primaryPerPeriod, readQiPrecedence } from '../quality/measurement-read';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 감염·질·안전 보드(D9) — 환자안전 사건·활성 감염(격리)·손위생 준수율·QI 지표 달성.
 * raw SQL 미사용(Prisma ORM).
 */
@Injectable()
export class SafetyQualityBoardService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  async getBoard() {
    const now = new Date();
    const last30 = new Date(now.getTime() - 30 * 86400000);

    const [incidents, infectionsActive, hygiene, qiRows] = await Promise.all([
      this.prisma.safetyIncident.findMany({
        where: { occurredAt: { gte: last30 } },
        select: { severity: true, type: true, status: true, occurredAt: true },
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.infectionSurveillance.count({ where: { resolvedAt: null } }), // 활성 감염/격리
      this.prisma.handHygieneObservation.findMany({ where: { observedAt: { gte: last30 } }, select: { action: true } }),
      // 🔴 저장된 `meetTarget` 을 믿지 않는다 — 아래 주석 참조
      this.prisma.qiMeasurement.findMany({
        // 🔴 2026-10-08 — 무효 처리한 측정이 보드·상황판 달성률에 섞였다
        where: ACTIVE_MEASUREMENT,
        // 기간 최신 순 — 같은 달 수기·자동은 아래에서 정본 하나만(결정 qi.autoManual.precedence)
        orderBy: [{ period: 'desc' }, { measuredAt: 'desc' }],
        take: 300,
        // 🔴 `direction` 컬럼을 뽑지 않으면 관리자가 등재한 방향을 **이 보드에서만** 무시한다(P12 재발).
        //    우선순위 정본은 컬럼 → 등재표 → 미등재이며, 그 판단은 resolveIndicatorPolicy 한 곳에서만 한다.
        select: { indicatorId: true, meetTarget: true, value: true, period: true, measuredAt: true, sourceKey: true, indicator: { select: { name: true, targetValue: true, direction: true } } },
      }),
    ]);

    /**
     * 🔴 미종결 사건은 **기간 창 밖에서도 세야 한다** — 2026-08-14(W7).
     *
     * 종전에는 `occurredAt >= now-30d` 로 먼저 자른 뒤 그 안에서 미종결을 셌다.
     * 실측 미종결 3건은 2026-05-23~27 발생 = **79~83일 방치**라 전부 창 밖이었고,
     * 화면은 "미종결 사건 **0건**"이라고 말했다. **오래 방치될수록 지표에서 사라지는**
     * 역방향 동작이다(라벨은 '미종결'인데 기간 한정이 드러나지 않았다).
     */
    const openAllTime = await this.prisma.safetyIncident.count({
      where: { status: { notIn: ['CLOSED', 'RESOLVED'] } },
    });
    const oldestOpen = await this.prisma.safetyIncident.findFirst({
      where: { status: { notIn: ['CLOSED', 'RESOLVED'] } },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });

    /**
     * 안전사건 심각도 분포 — 🔴 저장값이 자유 문자열이라 화면 하드코딩 키와 어긋났다.
     * 실측 `LOW` 2건이 화면 5개 막대 어디에도 속하지 못해 "총 사고 3"인데 막대 합이 1 이었다.
     * shared 정본으로 접어서 보낸다(저장값은 변형하지 않는다).
     */
    const rawSeverity = new Map<string, number>();
    let incidentsOpen30d = 0;
    for (const i of incidents) {
      rawSeverity.set(i.severity, (rawSeverity.get(i.severity) ?? 0) + 1);
      if (i.status !== 'CLOSED' && i.status !== 'RESOLVED') incidentsOpen30d += 1;
    }
    const severityFolded = foldSeverityCounts(
      [...rawSeverity.entries()].map(([severity, count]) => ({ severity, count })),
    );
    const bySeverity: Record<string, number> = Object.fromEntries(
      severityFolded.map((r) => [r.severity, r.count]),
    );

    // 손위생 준수율
    const hygieneTotal = hygiene.length;
    const hygienePerformed = hygiene.filter((h) => h.action === 'PERFORMED').length;
    const handHygieneRate = hygieneTotal ? Math.round((hygienePerformed / hygieneTotal) * 100) : null;

    /**
     * QI 지표: 지표별 최신 측정 → 달성 비율.
     *
     * 🔴 종전에는 **저장된 `meetTarget` 을 그대로** 읽었다. 그 값은 시드가 지표명 키워드로
     * 판정한 것이라 방향이 틀린 행이 섞여 있다(예: 인공호흡기 관련 폐렴 1.51 / 목표 2.0 →
     * '미달'로 저장). 같은 '달성' 하나를 두고 이 보드와 `/quality` 가 다른 답을 냈다(P12).
     * → 판정 정본(`indicator-policy`)으로 **읽는 시점에 재판정**한다. 방향을 모르면
     *   달성도 미달도 아닌 **판정 불가**로 두고 분모에서 뺀다(모르는 것을 미달로 뭉개지 않는다).
     */
    /**
     * 🔴 **묵은 값을 오늘의 사실처럼 내지 않는다** — W8 Q6.
     *
     * 이 보드는 기간 제한 없이 '지표별 최신 측정'을 쓴다. 그 자체는 보드의 성격상 타당하지만,
     * 그 사실이 응답 어디에도 없어서 화면은 달성률 88% 를 **오늘의 상태**처럼 표시했다.
     * 실측(2026-08-14): `qi_measurements` 의 최신 period 는 **2026-05** — 3개월 묵은 값이다.
     * 같은 순간 `/qi/target-achievement`(요청 달=2026-08)는 '산출 불가'를 냈다.
     * 판정 함수는 W7 에서 이미 정본으로 수렴했고, 갈라진 것은 **표본 창**이었다.
     * → 어느 시점의 측정으로 만든 값인지 응답이 스스로 말한다(기준 시점 동반).
     */
    const latestByIndicator = new Map<string, boolean | null>();
    const periodByIndicator = new Map<string, string | null>();
    const precedence = await readQiPrecedence(this.config);
    const byIndicator = new Map<string, typeof qiRows>();
    for (const q of qiRows) byIndicator.set(q.indicatorId, [...(byIndicator.get(q.indicatorId) ?? []), q]);
    const latestRows = [...byIndicator.values()].map((rows) => primaryPerPeriod(rows, precedence)[0]?.primary).filter((q): q is (typeof qiRows)[number] => !!q);
    for (const q of latestRows) {
      if (latestByIndicator.has(q.indicatorId)) continue;
      const direction = resolveIndicatorPolicy({ name: q.indicator?.name ?? '', direction: q.indicator?.direction ?? null }).direction;
      // targetValue 는 Prisma Decimal — 비교 전 수치로 (표시가 아니라 판정용이라 반올림하지 않는다)
      const target = q.indicator?.targetValue == null ? null : Number(q.indicator.targetValue);
      latestByIndicator.set(q.indicatorId, evaluateMeetTarget(Number(q.value), target, direction));
      periodByIndicator.set(q.indicatorId, q.period ?? null);
    }
    const judged = [...latestByIndicator.values()].filter((v) => v !== null) as boolean[];
    const qiTotal = latestByIndicator.size;
    const qiJudged = judged.length;
    const qiMet = judged.filter(Boolean).length;

    const usedPeriods = [...periodByIndicator.values()].filter((p): p is string => !!p).sort();
    const qiLatestPeriod = usedPeriods.length ? usedPeriods[usedPeriods.length - 1] : null;
    const qiOldestPeriod = usedPeriods.length ? usedPeriods[0] : null;
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    /** 최신 측정이 이번 달 것인가 — 아니면 화면은 '기준 2026-05' 를 함께 표시해야 한다 */
    const qiIsCurrentPeriod = qiLatestPeriod === currentPeriod;
    const qiStaleMonths = qiLatestPeriod
      ? (now.getFullYear() - Number(qiLatestPeriod.slice(0, 4))) * 12 + (now.getMonth() + 1 - Number(qiLatestPeriod.slice(5, 7)))
      : null;

    return {
      summary: {
        incidents30d: incidents.length,
        /** 🔴 기간 무관 전체 미종결 — 방치될수록 사라지던 것 */
        incidentsOpen: openAllTime,
        incidentsOpen30d,
        oldestOpenAt: oldestOpen?.occurredAt ?? null,
        infectionsActive,
        handHygieneRate,        // % (null=관찰 없음)
        /** 🔴 비율은 분모와 함께 — 관찰 0건의 `null` 을 화면이 `-` 로 접던 것(P1) */
        handHygieneObserved: hygieneTotal,
        handHygienePerformed: hygienePerformed,
        qiIndicators: qiTotal,
        qiJudged,               // 방향을 알아 판정한 지표 수(달성률 분모)
        qiMet,
        // 판정된 것이 없으면 비율은 0 이 아니라 '산출 불가'
        qiRate: qiJudged ? Math.round((qiMet / qiJudged) * 100) : null,
        /** 🔴 표본 창 — 이 달성률이 **언제 것인지**. 화면은 이 시점을 값과 함께 표시해야 한다. */
        qiLatestPeriod,
        qiOldestPeriod,
        qiIsCurrentPeriod,
        qiStaleMonths,
        /**
         * 🔴 **표시 문장을 서버가 조립하지 않는다**(2026-09-10). 종전엔 `qiBasis` 라는 한국어 문장을
         *    만들어 내려줬고, 서버는 로케일을 모르므로 화면 언어를 무엇으로 바꿔도 그 줄만 한국어였다.
         *    카탈로그로도 못 고친다 — 값이 문장 안에 녹아 있기 때문이다.
         *    조각(`qiLatestPeriod`·`qiIsCurrentPeriod`·`qiStaleMonths`)은 위에 그대로 있고,
         *    **조립은 화면이 한다**(`command-center-view.ts` `boardNote`).
         */
      },
      incidentsBySeverity: bySeverity,
      recentIncidents: incidents.slice(0, 20).map((i) => ({ type: i.type, severity: i.severity, status: i.status, occurredAt: i.occurredAt })),
      // 🔴 자르면 잘랐다고 말한다 — 안전 사건 목록이 20건에서 조용히 끊기면 "이게 전부"로 읽힌다.
      recentIncidentsTotal: incidents.length,
      recentIncidentsTruncated: Math.max(0, incidents.length - 20),
    };
  }
}
