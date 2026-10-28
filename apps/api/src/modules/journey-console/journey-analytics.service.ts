import { Injectable, Optional } from '@nestjs/common';
import { summarizeStayDays } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
// 🔴 날짜 정본(읽기 전용) — `new Date('YYYY-MM-DD')` 은 TZ 무관 **항상 UTC 자정**이다.
import { dayRange } from '../../common/day-range';
// 🔴 목표·상한 정본 — 관제 보드와 같은 값을 본다(W8 Q10).
import { FlowTargets, notFutureCheckIn, resolveFlowTargets } from './flow-canon';

// 환자여정 이탈/지연 분석 — 이력 집계(읽기 전용, 신규 모델 0).
// 소스: WaitingQueue(외래 단계 타임스탬프)·EmergencyVisit(ER door-to-triage)·Admission(입원 LOS).

const MIN = 60_000;
const DAY = 86_400_000;

/**
 * 🔴 `breachRate` 만 내보내면 화면은 분모 없는 퍼센트를 그린다 — "위반 50%"가 2건 중 1건인지
 *    200건 중 100건인지 알 수 없다. **분자(`breachCount`)를 함께 낸다.** 분모는 `count` 다.
 *    목표(`target`)가 없으면 위반 판정 자체를 하지 않으므로 분자도 `null`(0 이 아니다).
 */
type Stat = { count: number; avg: number; p50: number; p90: number; max: number; breachRate: number | null; breachCount: number | null; target: number | null };

// 분포 통계(nearest-rank percentile·목표 위반율). 단위 테스트 대상으로 export.
export function stats(values: number[], target: number | null = null): Stat {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return { count: 0, avg: 0, p50: 0, p90: 0, max: 0, breachRate: null, breachCount: null, target };
  const pct = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]; // nearest-rank
  const avg = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
  const breachCount = target != null ? v.filter((x) => x > target).length : null;
  const breachRate = breachCount != null ? Math.round((breachCount / v.length) * 100) : null;
  return { count: v.length, avg, p50: Math.round(pct(50)), p90: Math.round(pct(90)), max: Math.round(v[v.length - 1]), breachRate, breachCount, target };
}

@Injectable()
export class JourneyAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  async getFlowAnalytics(params: { from?: string; to?: string } = {}) {
    /**
     * 🔴 날짜 정본 `dayRange` 로 통일 — W8 Q8.
     *    종전: `from = new Date('2026-08-13')` = **UTC 자정 = KST 09:00**, `to` 는 로컬 endOfDay.
     *    한쪽만 UTC 라 조회 구간이 **KST 00:00~09:00 을 전량 잃었다**(같은 응답 안에서 기준이 둘).
     *    `dayRange` 는 `{ gte: 로컬자정, lt: 다음날 로컬자정 }` — 상한은 **배타(lt)** 다.
     */
    const range = dayRange(params.from, params.to);
    const to = range?.lt ?? new Date();
    const from = range?.gte ?? new Date(to.getTime() - 7 * DAY);
    const targets = await resolveFlowTargets(this.config);
    const [opd, er, ipd] = await Promise.all([this.opd(from, to, targets), this.er(from, to, targets), this.ipd(from, to)]);

    // 병목 랭킹 — SLA 목표가 있는 단계 중 위반율·평균 기준 상위
    const cand: { track: string; stage: string; avg: number; breachRate: number | null; breachCount: number | null; count: number }[] = [
      { track: 'OPD', stage: '접수→호출 대기', avg: opd.waitToCall.avg, breachRate: opd.waitToCall.breachRate, breachCount: opd.waitToCall.breachCount, count: opd.waitToCall.count },
      { track: 'OPD', stage: '접수→진료 대기', avg: opd.waitToConsult.avg, breachRate: opd.waitToConsult.breachRate, breachCount: opd.waitToConsult.breachCount, count: opd.waitToConsult.count },
      { track: 'ER', stage: '도착→트리아지', avg: er.doorToTriage.avg, breachRate: er.doorToTriage.breachRate, breachCount: er.doorToTriage.breachCount, count: er.doorToTriage.count },
      { track: 'ER', stage: '트리아지→처치', avg: er.triageToTreatment.avg, breachRate: er.triageToTreatment.breachRate, breachCount: er.triageToTreatment.breachCount, count: er.triageToTreatment.count },
    ];
    // 🔴 자르면 **잘랐다고 말한다**(W8 Q4 원칙) — 조용한 truncation 금지.
    const bottleneckAll = cand
      .filter((c) => c.count > 0)
      .sort((a, b) => (b.breachRate ?? 0) - (a.breachRate ?? 0) || b.avg - a.avg);
    const BOTTLENECK_LIMIT = 5;
    const bottlenecks = bottleneckAll.slice(0, BOTTLENECK_LIMIT);
    const bottlenecksTruncated = bottleneckAll.length - bottlenecks.length;

    return {
      // 상한은 **배타**다 — 화면이 "어디까지 봤는지" 오해하지 않게 이름으로 말한다.
      period: { from: from.toISOString(), toExclusive: to.toISOString() },
      targets: { opdWaitMin: targets.opdWaitMin, callDelayMin: targets.callDelayMin, doorToTriage: targets.doorToTriage },
      opd, er, ipd, bottlenecks,
      /** 잘린 항목 수(0 이면 전량) — 화면이 "외 N건"을 표시할 수 있게 */
      bottlenecksTotal: bottleneckAll.length,
      bottlenecksTruncated,
    };
  }

  // ── 외래: 접수→호출→진료→완료 단계 소요(완료 건 기준) ──
  private async opd(from: Date, to: Date, targets: FlowTargets) {
    /**
     * 🔴 `startedAt: { not: null }` 을 **where 에서** 걸면 안 된다 — W8 Q11.
     *    실측(최근 7일): 완료 외래 436건 중 `startedAt` 보유는 5건(1.1%)뿐이라
     *    "외래 완료 436건"이 화면에서 **5건**으로 보였다. 진료 시작 시각이 없는 것은
     *    그 단계 통계의 표본이 아닐 뿐, **완료 건이 아닌 것은 아니다**.
     *    → 모집단은 완료 전량으로 두고, 단계별 결측은 각 `stats().count` 가 스스로 말한다.
     */
    const rows = await this.prisma.waitingQueue.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: from, lt: to },
        // 미래 접수는 어떤 축에서도 표본이 아니다(전 축 공통 상한 — W8 Q9)
        checkedInAt: notFutureCheckIn(),
      },
      select: { checkedInAt: true, calledAt: true, startedAt: true, completedAt: true, departmentName: true },
      take: 20000,
    });
    const waitToConsult: number[] = [], consult: number[] = [], total: number[] = [], waitToCall: number[] = [];
    const byDept = new Map<string, { wait: number[]; consult: number[] }>();
    for (const r of rows) {
      const ci = r.checkedInAt?.getTime(), st = r.startedAt?.getTime(), cp = r.completedAt?.getTime(), ca = r.calledAt?.getTime();
      if (ci && st) { const w = (st - ci) / MIN; waitToConsult.push(w); this.deptPush(byDept, r.departmentName, 'wait', w); }
      if (st && cp) { const c = (cp - st) / MIN; consult.push(c); this.deptPush(byDept, r.departmentName, 'consult', c); }
      if (ci && ca && ca >= ci) waitToCall.push((ca - ci) / MIN); // 접수→호출(대기열 호출까지)
      if (ci && cp) total.push((cp - ci) / MIN);
    }

    const deptAll = [...byDept.entries()].map(([dept, d]) => ({
      dept: dept || '미지정', count: d.wait.length,
      avgWaitMin: d.wait.length ? Math.round(d.wait.reduce((a, b) => a + b, 0) / d.wait.length) : 0,
      // 🔴 (2026-09-17 L4) 아래 filter 는 **대기 표본(count)** 만 보므로, 대기는 있고 진료 완료가 0 인 과가 남는다 —
      //    그 과의 '평균 진료 0 분'은 표본 부재이지 실적이 아니다.
      avgConsultMin: d.consult.length ? Math.round(d.consult.reduce((a, b) => a + b, 0) / d.consult.length) : null,
    })).filter((d) => d.count > 0).sort((a, b) => b.avgWaitMin - a.avgWaitMin);
    // 🔴 조용한 truncation 금지 — 몇 개를 감췄는지 응답이 말한다(W8 Q4 원칙).
    const depts = deptAll.slice(0, 12);

    /**
     * 🔴 '접수→호출 대기'의 목표는 **호출 지연 목표**(`callDelayMinutes` 10분)다 — W8 Q10.
     *    종전엔 `cashierWaitMinutes`(수납 대기 30분)를 걸어, 같은 호출 지연을
     *    관제는 10분·분석은 30분으로 판정했다. 목표 해석은 `flow-canon` 하나에서만 나온다.
     */
    return {
      count: rows.length,
      countBasis: '조회 구간 내 완료(COMPLETED) 외래 전량 — 단계별 표본 수는 각 항목의 count',
      waitToCall: stats(waitToCall, targets.callDelayMin),
      waitToConsult: stats(waitToConsult, targets.opdWaitMin),
      consult: stats(consult, null),
      total: stats(total, null),
      byDept: depts,
      byDeptTotal: deptAll.length,
      byDeptTruncated: deptAll.length - depts.length,
    };
  }

  private deptPush(m: Map<string, { wait: number[]; consult: number[] }>, dept: string | null, k: 'wait' | 'consult', v: number) {
    const key = dept || '미지정';
    const e = m.get(key) ?? { wait: [], consult: [] };
    e[k].push(v); m.set(key, e);
  }

  // ── 응급: 도착→트리아지→처치→disposition (KTAS 목표 대비) ──
  private async er(from: Date, to: Date, targets: FlowTargets) {
    const rows = await this.prisma.emergencyVisit.findMany({
      where: { arrivalAt: { gte: from, lt: to } },
      select: { arrivalAt: true, triagedAt: true, treatmentStartedAt: true, dispositionAt: true, triageLevel: true },
      take: 20000,
    });
    const ktasTarget = targets.doorToTriage;
    const doorToTriage: number[] = [], triageToTreatment: number[] = [], totalLos: number[] = [];
    const byKtas = new Map<string, number[]>();
    let dttBreach = 0; // 집계 위반: 각 행의 자기 KTAS 목표 기준
    // 🔴 접수 화면이 도착 시각을 따로 받지 못한 건은 도착=분류가 **같은 순간**으로 기록된다.
    //    그 0분을 성적으로 읽으면 "전건 목표 달성"이라는 거짓 안심이 된다(P17) —
    //    산출에서 빼고 **몇 건을 뺐는지 함께** 낸다. 0 은 다른 사실이다.
    let sameStampCount = 0;
    for (const r of rows) {
      const ar = r.arrivalAt?.getTime(), tr = r.triagedAt?.getTime(), tx = r.treatmentStartedAt?.getTime(), dp = r.dispositionAt?.getTime();
      if (ar && tr && ar === tr) sameStampCount++;
      else if (ar && tr) { const d = (tr - ar) / MIN; doorToTriage.push(d); const arr = byKtas.get(r.triageLevel) ?? []; arr.push(d); byKtas.set(r.triageLevel, arr); if (d > (ktasTarget[r.triageLevel] ?? 30)) dttBreach++; }
      if (tr && tx) triageToTreatment.push((tx - tr) / MIN);
      if (ar && dp) totalLos.push((dp - ar) / MIN);
    }
    const ktas = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'].map((lv) => {
      const arr = byKtas.get(lv) ?? [];
      const s = stats(arr, ktasTarget[lv]);
      // 🔴 등급별 위반율의 **분자**(`breachCount`)를 함께 낸다 — 분모는 `count`. 화면이 `n / N (p%)` 로 그린다.
      return { level: lv, count: s.count, avgDoorToTriageMin: s.avg, target: ktasTarget[lv], breachRate: s.breachRate, breachCount: s.breachCount };
    }).filter((k) => k.count > 0);

    // 집계 위반율은 단일 목표가 아닌 각 행의 KTAS 목표 기준(등급 혼합 왜곡 방지)
    const dtt = stats(doorToTriage, null);
    dtt.breachCount = doorToTriage.length ? dttBreach : null;
    dtt.breachRate = doorToTriage.length ? Math.round((dttBreach / doorToTriage.length) * 100) : null;
    return {
      count: rows.length,
      doorToTriage: dtt,
      // 도착 시각 미기록(도착=분류 동시 기록)이라 door-to-triage 를 산출할 수 없는 건수.
      // 화면은 이 수를 "산출 불가 n건"으로 밝힌다 — 조용히 빼면 분모가 거짓말한다.
      doorToTriageUnmeasurable: sameStampCount,
      // 트리아지 자체가 원장에 없는 건수(등급은 있는데 분류 시각 없음) — 분모 밖으로 빠지는 다른 이유
      triageActMissing: rows.filter((r) => !r.triagedAt).length,
      triageToTreatment: stats(triageToTreatment, null),
      totalLosMin: stats(totalLos, null),
      byKtas: ktas,
    };
  }

  // ── 입원: 재원일수(LOS) — 기간 내 퇴원 기준 ──
  private async ipd(from: Date, to: Date) {
    const rows = await this.prisma.admission.findMany({
      where: { status: 'DISCHARGED', dischargeDate: { gte: from, lt: to } },
      select: { admitDate: true, dischargeDate: true, bed: { select: { ward: { select: { name: true } } } } },
      take: 20000,
    });
    // 🔴 (2026-10-01) 개별 재원일수는 정본 stayDays(종전 소수 일 — 환자 화면 값과 갈렸다) · 퇴원<입원은 빼고 센다
    const all = summarizeStayDays(rows);
    const los = all.values;
    const byWardRows = new Map<string, typeof rows>();
    for (const r of rows) { const w = r.bed?.ward?.name || '미지정'; byWardRows.set(w, [...(byWardRows.get(w) ?? []), r]); }
    const sorted = [...los].sort((a, b) => a - b);
    const round1 = (x: number) => Math.round(x * 10) / 10;
    const pct = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : 0; // nearest-rank
    const wardAll = [...byWardRows.entries()]
      .map(([ward, rs]) => { const s = summarizeStayDays(rs); return { ward, count: s.n, avgLosDays: s.meanDays }; })
      .filter((w) => w.count > 0)
      .sort((a, b) => (b.avgLosDays ?? 0) - (a.avgLosDays ?? 0));
    const wards = wardAll.slice(0, 12); // 🔴 자르면 잘랐다고 말한다(아래 byWardTruncated)
    return {
      count: los.length,
      // 🔴 (2026-09-17 L4) 퇴원 표본 0 이면 평균 재원일수는 산출 불가(count 를 분모로 함께 낸다)
      avgLosDays: all.meanDays,
      losExcluded: all.excluded,
      p50Days: round1(pct(50)), p90Days: round1(pct(90)),
      byWard: wards,
      byWardTotal: wardAll.length,
      byWardTruncated: wardAll.length - wards.length,
    };
  }
}
