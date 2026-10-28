import { Injectable, Logger, Optional } from '@nestjs/common';
import { billingOutstanding, summarizeStayDays, formatNum } from '@hospital-run/shared';
import { Prisma, InsuranceType, BillingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dayRange, parseLocalDate, todayRange, localDateKey } from '../../common/day-range';
// 🔴 흐름 집합·미래 접수 상한 정본(W8 Q9) — 관제·대시보드와 같은 조건을 본다. 여기서 재정의 금지.
import {
  OPD_WAITING_STAGES as FLOW_OPD_WAITING_STAGES,
  UNPAID_STATUS as FLOW_UNPAID_STATUS,
  notFutureCheckIn,
} from '../journey-console/flow-canon';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 경영·의료품질 대시보드 — **원장이 보는 화면**이고 여기 숫자가 의사결정 문서로 유통된다.
 *
 * 🔴 이 파일의 지배 규약(화면 실사용 점검 W7 · P17 "근거 없이 안심시킴"):
 *  1. **표본이 없으면 0% 도 100% 도 아니라 `null`(산출 불가)** 이다. 초록으로 칠하지 않는다.
 *     - 단, **진짜 0 은 0 이다**. "이번달 수술 0건 / 목표 50건" 은 달성률 0% 가 사실이고,
 *       "이번달 청구 0건" 의 삭감률은 사실이 아니라 **모르는 것**이다. 둘을 뒤바꾸지 않는다.
 *  2. **같은 라벨이면 같은 정의**. '미수납'·'매출'·'미완료 차트'·'대기' 의 기간·집합을
 *     /journey-console 과 맞추고, 다르면 응답에 `scope`/`basis` 로 그 차이를 적는다.
 *  3. 날짜 버킷은 `localDateKey`(로컬=KST 달력). `toISOString().slice(0,10)` 은 **UTC 라 하루가 밀린다**.
 *  4. 조회 실패를 0/[] 으로 흡수하지 않는다 — 실패는 `unavailable` 로 드러낸다.
 *  5. 하드코딩 목록(진료과 등) 대신 **실데이터에서** 축을 만든다.
 */

/**
 * 표본 수를 동반하는 값 — /journey-console `avgWait:{value,n}` 과 같은 규약. n=0 이면 value 는 null.
 *
 * 🔴 `n` 은 **표본 수이지 분자가 아니다.** 가동률처럼 값 자체가 비율인 지표는 `n` 만으로
 *    `n / N (p%)` 를 그릴 수 없다 → 비율 지표는 `numerator`/`denominator` 를 함께 낸다.
 *    (평균·증감률처럼 분자가 없는 지표는 두 필드가 없다 — 없는 것을 0 으로 지어내지 않는다.)
 */
export interface Metric {
  value: number | null;
  n: number;
  numerator?: number;
  denominator?: number;
}

function metric(value: number | null, n: number, ratio?: { numerator: number; denominator: number }): Metric {
  return ratio
    ? { value: n > 0 ? value : null, n, numerator: ratio.numerator, denominator: ratio.denominator }
    : { value: n > 0 ? value : null, n };
}

/**
 * 🔴 '미수납'의 정본 — /journey-console `UNPAID_STATUS` 와 **같은 집합**.
 *    종전 경영 대시보드는 카드=오늘 생성분 PENDING+PARTIAL(금액) / PENDING(건수),
 *    알림=전 기간 PENDING 이라 **한 화면이 0건과 54건을 동시에** 말했다.
 */
const UNPAID_STATUS: BillingStatus[] = FLOW_UNPAID_STATUS;
/** 삭감률 분모 — 심사가 끝난 청구(인정·부분인정·반려·지급) · P4-4 */
const REVIEWED_CLAIM_STATUSES: string[] = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID'];

/**
 * 🔴 외래 '대기'의 정본 — 접수 후 진료 시작 전(호출 포함).
 *    /journey-console `OPD_WAITING_STAGES` 와 동일. 진료중·수납대기는 '대기'가 아니다.
 *    🔴 W8: 두 곳에 같은 배열을 적어두면 조용히 갈라진다 → flow-canon 재수출로 바꾼다.
 */
const OPD_WAITING_STAGES = FLOW_OPD_WAITING_STAGES;

/**
 * 🔴 '미완료 차트'의 정본 — DRAFT 로 24시간 경과.
 *    종전엔 알림=DRAFT 24h(전 작성자) 195건 / 의료진 표=DRAFT 전체(role=DOCTOR) 51건 이라
 *    두 화면이 다른 수를 말했고, 차액 144건의 **담당자는 어느 화면에도 없었다**.
 */
const INCOMPLETE_CHART_AGE_MS = 24 * 60 * 60 * 1000;

/** 🔴 FE 로컬 라벨 Record 는 DB enum(`StaffCategory`) 과 교집합이 0 이라 영문 원문이 노출됐다 → 서버가 라벨을 낸다. */
const STAFF_CATEGORY_LABEL: Record<string, string> = {
  MEDICAL: '의료진',
  TECHNICAL: '의료기사',
  ADMIN: '행정직',
  SUPPORT: '지원직',
};

/** 부서가 비어 있는 것은 '기타'가 아니라 **미지정**이다(분류된 기타와 섞으면 사실이 아니다). */
const DEPT_UNASSIGNED = '부서 미지정';

/**
 * 🔴 MRSA 판정 — `organism` 컬럼에는 **학명**이 들어간다(`Staphylococcus aureus`·`E. coli`…).
 *    `organism === 'MRSA'` 완전일치는 구조적으로 절대 발화하지 않았다(항상 0건).
 *    그렇다고 S. aureus 를 전부 MRSA 로 셀 수는 없다 — 메티실린 내성 여부는 별개 사실이다.
 *    따라서 **내성이 명시된 것만** MRSA 로 세고, 판정 불가는 판정 불가로 남긴다.
 */
const MRSA_PATTERN = /\bMRSA\b|methicillin[-\s]?resistant|메티실린\s*내성|메티실린내성/i;
/** 황색포도알균(내성 표기 없음) — MRSA/MSSA 판정 불가 모집단 */
const S_AUREUS_PATTERN = /staph(ylococcus)?\.?\s*aureus|황색\s*포도(알|상)구?균/i;

@Injectable()
export class ExecutiveService {
  private readonly logger = new Logger(ExecutiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  /**
   * 경영 KPI 목표치 — **원내가 정한 값만** 목표로 인정한다(2026-09-16 J3).
   * `source==='db'` 가 아니면 미설정이다(코드 기본값을 목표로 쓰지 않는다).
   */
  private async kpiTarget(key: string): Promise<number | null> {
    if (!this.configRuntime) return null;
    // 🔴 `.catch(() => null)` 로 삼키지 않는다 — **설정 조회 실패**를 '목표 미설정'으로 번역하면
    //    원내가 정한 목표가 있는데도 화면이 "미설정"이라 말한다(실패와 없음은 다른 사실이다).
    const got = await this.configRuntime.getWithSource(key);
    if (!got || got.source !== 'db') return null;
    const n = typeof got.value === 'number' ? got.value : Number(got.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // ── 경영 대시보드 ──

  async getOverview() {
    const { gte: today, lt: tomorrow } = todayRange();
    const lastWeekStart = new Date(today);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const [
      todayBillingAgg,
      collectedTodayAgg,
      unpaidAgg,
      lastWeekBillingAgg,
      todayEncounters,
      lastWeekEncounters,
      totalBeds,
      occupiedBeds,
      admissions,
      icuBeds,
      icuAdmissions,
    ] = await Promise.all([
      // 오늘 **발생**(발생주의) — 오늘 생성된 청구의 총액
      this.prisma.billing.aggregate({ where: { createdAt: { gte: today, lt: tomorrow } }, _sum: { totalAmount: true }, _count: true }),
      // 오늘 **수납 확정** — /journey-console `revenueToday.confirmed` 와 같은 정의
      this.prisma.billing.aggregate({ where: { status: BillingStatus.PAID, paidAt: { gte: today, lt: tomorrow } }, _sum: { paidAmount: true }, _count: true }),
      // 🔴 미수납은 **전 기간**이다(오늘 생성분이 아니다). 금액·건수의 집합도 하나로 맞춘다.
      // 🔴 (P4-1) 남은 본인부담은 감면을 빼고 행마다 센다(shared billingOutstanding) — 종전 Σ본인부담 − Σ납부는 감면을 무시했다
      this.prisma.billing.findMany({ where: { status: { in: UNPAID_STATUS } }, select: { patientCopay: true, discountAmount: true, paidAmount: true } }),
      this.prisma.billing.aggregate({ where: { createdAt: { gte: lastWeekStart, lt: today } }, _sum: { totalAmount: true }, _count: true }),
      this.prisma.encounter.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      this.prisma.encounter.count({ where: { createdAt: { gte: lastWeekStart, lt: today } } }),
      this.prisma.bed.count(),
      this.prisma.bed.count({ where: { status: 'OCCUPIED' } }),
      this.prisma.admission.count({ where: { status: 'ADMITTED' } }),
      this.prisma.icuBed.count(),
      this.prisma.icuAdmission.count({ where: { status: 'ADMITTED' } }),
    ]);

    const accruedToday = todayBillingAgg._sum.totalAmount ?? 0;
    const accruedN = todayBillingAgg._count;
    const collectedToday = collectedTodayAgg._sum.paidAmount ?? 0;
    const collectedN = collectedTodayAgg._count;

    const unpaidAmount = unpaidAgg.reduce((s, b) => s + (billingOutstanding(b) ?? 0), 0);
    const unpaidCount = unpaidAgg.length;

    // 🔴 표본(지난 7일 청구 건수)이 없으면 "전주比 ▲0%" 라고 단언하지 않는다 — 0 은 값이 아니라 모른다는 뜻.
    const lastWeekN = lastWeekBillingAgg._count;
    const lastWeekAvgRevenue = (lastWeekBillingAgg._sum.totalAmount ?? 0) / 7;
    const revenueChange: Metric = lastWeekN > 0 && lastWeekAvgRevenue > 0
      ? { value: Math.round(((accruedToday - lastWeekAvgRevenue) / lastWeekAvgRevenue) * 100), n: lastWeekN }
      : { value: null, n: lastWeekN };

    const lastWeekAvgEncounters = lastWeekEncounters / 7;
    const patientChange: Metric = lastWeekEncounters > 0 && lastWeekAvgEncounters > 0
      ? { value: Math.round(((todayEncounters - lastWeekAvgEncounters) / lastWeekAvgEncounters) * 100), n: lastWeekEncounters }
      : { value: null, n: lastWeekEncounters };

    // 🔴 등록 병상이 0 이면 가동률은 0% 가 아니라 **산출 불가**.
    const bedOccupancyPct: Metric = metric(
      totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : null,
      totalBeds,
      { numerator: occupiedBeds, denominator: totalBeds },
    );
    const icuOccupancyPct: Metric = metric(
      icuBeds > 0 ? Math.round((icuAdmissions / icuBeds) * 100) : null,
      icuBeds,
      { numerator: icuAdmissions, denominator: icuBeds },
    );

    return {
      asOf: new Date().toISOString(),

      // ── 매출 — 🔴 라벨 '매출'의 정본이 둘이었다(/executive=발생 · /journey-console=수납확정). 둘 다 낸다.
      revenue: {
        accrued: metric(accruedToday, accruedN), // 오늘 발생한 청구 총액(발생주의)
        collected: metric(collectedToday, collectedN), // 오늘 수납 확정(현금주의) — journey-console 과 동일
        basis: '발생=오늘 생성 청구 totalAmount 합 · 수납확정=오늘 paidAt PAID 의 paidAmount 합',
      },
      todayRevenue: accruedToday, // 하위호환(발생 기준) — /admin/analytics 소비
      revenueChange: revenueChange.value, // 하위호환. null=산출 불가(표본 부재)
      revenueChangeMetric: revenueChange,

      // ── 미수납 — 전 기간·본인부담 잔액. 금액과 건수가 **같은 집합**이다.
      unpaid: {
        amount: unpaidAmount,
        count: unpaidCount,
        scope: 'ALL_TIME',
        statuses: UNPAID_STATUS,
        basis: '전 기간 미수납(PENDING·PARTIAL·DEFERRED) 본인부담 잔액 = patientCopay − paidAmount',
      },
      unpaidAmount, // 하위호환 — 같은 정의로 통일
      unpaidCount,

      todayPatients: todayEncounters,
      patientChange: patientChange.value, // 하위호환. null=산출 불가
      patientChangeMetric: patientChange,

      bedOccupancyPct, // 🔴 단위 명시(%) — 필드명이 단위를 말한다
      bedOccupancy: bedOccupancyPct.value, // 하위호환(퍼센트). journey-console 의 동명 필드는 **비율(0~1)** 이라 다른 값이다
      bedOccupancyUnit: 'percent' as const,
      totalBeds,
      occupiedBeds,
      icuTotal: icuBeds,
      icuOccupied: icuAdmissions,
      icuOccupancyPct,
      inpatients: admissions,
    };
  }

  async getWeeklyRevenue() {
    const { gte: today, lt: tomorrow } = todayRange();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);

    const billings = await this.prisma.billing.findMany({
      where: { createdAt: { gte: weekStart, lt: tomorrow } },
      select: { createdAt: true, totalAmount: true },
    });

    // 🔴 종전 `toISOString().slice(0,10)` = UTC 일자. 서버 now 는 KST 라 **오늘 버킷이 루프에 없었고**
    //    09:00 KST 이후 생성된 청구가 전량 사라졌다(실측: 전체 81건 중 26건이 UTC일자 ≠ KST일자).
    const dayMap = new Map<string, { revenue: number; count: number }>();
    for (const b of billings) {
      const key = localDateKey(new Date(b.createdAt));
      const existing = dayMap.get(key);
      if (existing) { existing.revenue += b.totalAmount; existing.count++; }
      else dayMap.set(key, { revenue: b.totalAmount, count: 1 });
    }

    const days: { date: string; revenue: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      const data = dayMap.get(key);
      // 하루치 청구가 0건인 것은 **진짜 0**(그날 청구가 없었다)이므로 0 으로 표시해도 사실이다.
      days.push({ date: key, revenue: data?.revenue ?? 0, count: data?.count ?? 0 });
    }
    return days;
  }

  async getMonthlyTrend() {
    const now = new Date();
    const rangeStart = new Date(now.getFullYear(), now.getMonth() - 4, 1);
    const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [encounters, billings] = await Promise.all([
      this.prisma.encounter.findMany({
        where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
        select: { createdAt: true },
      }),
      this.prisma.billing.findMany({
        where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
        select: { createdAt: true, totalAmount: true },
      }),
    ]);

    const months: { month: string; encounters: number; revenue: number }[] = [];
    for (let i = 4; i >= 0; i--) {
      // 로컬(KST) 달력 기준 월 경계 — Date 산술이라 UTC 밀림 없음
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        month: monthKey,
        encounters: encounters.filter(e => e.createdAt >= start && e.createdAt < end).length,
        revenue: billings.filter(b => b.createdAt >= start && b.createdAt < end).reduce((s, b) => s + b.totalAmount, 0),
      });
    }
    return months;
  }

  async getDepartmentStats() {
    const { gte: today, lt: tomorrow } = todayRange();

    const [todayEncounters, todayBillings] = await Promise.all([
      this.prisma.encounter.findMany({
        where: { createdAt: { gte: today, lt: tomorrow } },
        select: { doctorId: true },
      }),
      this.prisma.billing.findMany({
        where: { createdAt: { gte: today, lt: tomorrow } },
        select: { totalAmount: true, encounter: { select: { doctorId: true } } },
      }),
    ]);

    // 🔴 종전엔 `role=DOCTOR && isActive` 사용자만 부서 지도를 만들어, 그 밖의 작성자(퇴직·행정 계정)의
    //    진료가 통째로 '기타'로 흘러들었다. **실제 작성자 id 에서** 부서를 찾는다.
    const authorIds = Array.from(new Set<string>([
      ...todayEncounters.map(e => e.doctorId),
      ...todayBillings.map(b => b.encounter?.doctorId).filter((v): v is string => !!v),
    ]));
    const authors = authorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, department: true } })
      : [];
    const doctorDeptMap = new Map<string, string>();
    for (const d of authors) doctorDeptMap.set(d.id, d.department?.trim() || DEPT_UNASSIGNED);

    const deptStats = new Map<string, { encounters: number; revenue: number }>();
    for (const e of todayEncounters) {
      const dept = doctorDeptMap.get(e.doctorId) ?? DEPT_UNASSIGNED;
      const s = deptStats.get(dept) ?? { encounters: 0, revenue: 0 };
      s.encounters++;
      deptStats.set(dept, s);
    }
    for (const b of todayBillings) {
      const dept = doctorDeptMap.get(b.encounter?.doctorId ?? '') ?? DEPT_UNASSIGNED;
      const s = deptStats.get(dept) ?? { encounters: 0, revenue: 0 };
      s.revenue += b.totalAmount;
      deptStats.set(dept, s);
    }

    return Array.from(deptStats.entries())
      .map(([department, s]) => ({ department, ...s }))
      .sort((a, b) => b.revenue - a.revenue || b.encounters - a.encounters);
  }

  async getStaffSummary() {
    const staffByCategory = await this.prisma.staff.groupBy({
      by: ['category'],
      where: { status: 'ACTIVE' },
      _count: { id: true },
    });
    const total = staffByCategory.reduce((s, c) => s + c._count.id, 0);
    return {
      total,
      // 🔴 라벨을 서버가 낸다 — FE 로컬 Record 의 키(DOCTOR·NURSE…)는 DB enum(MEDICAL·TECHNICAL·
      //    ADMIN·SUPPORT)과 교집합이 0 이라 화면에 영문 원문이 그대로 찍혔다.
      categories: staffByCategory
        .map(c => ({
          category: c.category as string,
          label: STAFF_CATEGORY_LABEL[c.category as string] ?? (c.category as string),
          count: c._count.id,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async getKpi() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const daysElapsed = now.getDate();

    const [monthlyEncounters, totalBeds, occupiedBeds, admissions, dischargedThisMonth, claimAgg, surgeryCount] = await Promise.all([
      this.prisma.encounter.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } }),
      this.prisma.bed.count(),
      this.prisma.bed.count({ where: { status: 'OCCUPIED' } }),
      this.prisma.admission.count({ where: { status: 'ADMITTED' } }),
      this.prisma.admission.findMany({
        where: { dischargeDate: { gte: monthStart, lt: monthEnd }, status: 'DISCHARGED' },
        select: { admitDate: true, dischargeDate: true },
      }),
      this.prisma.claim.aggregate({
        where: { claimDate: { gte: monthStart, lt: monthEnd } },
        _sum: { claimedAmount: true, reducedAmount: true },
        _count: true,
      }),
      this.prisma.surgery.count({
        where: { scheduledAt: { gte: monthStart, lt: monthEnd } },
      }),
    ]);

    const dailyAvgOutpatients = daysElapsed > 0 ? Math.round(monthlyEncounters / daysElapsed) : 0;
    const bedOccupancy = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : null;

    // 🔴 (2026-10-01) 개별 재원일수는 정본 stayDays(종전 소수 일 — 환자 화면 값과 갈렸다) · 평균 자릿수는 정책 stayDaysMean
    const losSummary = summarizeStayDays(dischargedThisMonth);
    const losSampleN = losSummary.n;
    const avgLosNum = losSummary.meanDays;
    const avgLos = avgLosNum != null ? formatNum(avgLosNum, 'stayDaysMean', { unit: false }) : null;

    const claimN = claimAgg._count;
    const totalClaimed = claimAgg._sum.claimedAmount ?? 0;
    const totalReduced = claimAgg._sum.reducedAmount ?? 0;
    // 🔴 이번달 청구가 0건이면 삭감률은 '0.0%' 가 아니라 **모르는 값**이다.
    //    종전엔 `totalClaimed>0 ? … : '0.0'` → `parseFloat('0.0') <= 3 ? 100` 이라,
    //    청구를 한 건도 안 했는데 "달성률 100%" 가 초록으로 떴다.
    const reductionRateNum = claimN > 0 && totalClaimed > 0 ? (totalReduced / totalClaimed) * 100 : null;
    const reductionRate = reductionRateNum != null ? reductionRateNum.toFixed(1) : null;

    // 🔴 (2026-09-16 J3) 목표치는 **원내가 정한 것만** 쓴다(`exec.target.*`). 종전엔 150명·80%·7일·50건·<3% 가
    //    코드 상수인데 화면은 '목표' 칸에 그리고 달성률까지 냈다 — 아무도 정하지 않은 목표였다.
    //    미설정이면 목표는 '미설정', 달성률은 **만들지 않는다**(rate: null → 화면이 '산출 불가'로 그린다).
    const [tOutpatients, tOccupancy, tLos, tSurgery, tReduction] = await Promise.all([
      this.kpiTarget('exec.target.dailyOutpatients'),
      this.kpiTarget('exec.target.bedOccupancyPct'),
      this.kpiTarget('exec.target.avgLosDays'),
      this.kpiTarget('exec.target.monthlySurgeries'),
      this.kpiTarget('exec.target.claimReductionPct'),
    ]);
    const unset = '미설정';
    const unsetNote = '목표 미설정 — 원내가 정하면 달성률을 냅니다(시스템 설정 exec.target.*)';

    // rate 규약: **비율의 분모가 없으면 null(산출 불가)**. 진짜 0(관측했는데 0)은 0 으로 남긴다.
    return [
      {
        name: '일평균 외래환자', target: tOutpatients != null ? tOutpatients + '명' : unset,
        actual: `${dailyAvgOutpatients}명`,
        // 분모=경과일수(항상 ≥1)라 산출 가능. 진료 0건은 진짜 0 → 달성률 0%.
        rate: tOutpatients != null ? Math.round((dailyAvgOutpatients / tOutpatients) * 100) : null,
        n: monthlyEncounters,
        note: tOutpatients != null ? undefined : unsetNote,
      },
      {
        name: '병상 가동률', target: tOccupancy != null ? tOccupancy + '%' : unset,
        actual: bedOccupancy != null ? `${bedOccupancy}%` : '-',
        rate: bedOccupancy != null && tOccupancy != null ? Math.round((bedOccupancy / tOccupancy) * 100) : null,
        n: totalBeds,
        note: totalBeds > 0 ? (tOccupancy != null ? undefined : unsetNote) : '등록 병상 0 — 산출 불가',
      },
      {
        name: '평균 재원일수', target: tLos != null ? tLos + '일' : unset,
        actual: avgLos != null ? `${avgLos}일` : '-',
        // 🔴 종전엔 actual 은 '-' 로 정직한데 rate 는 0(=미달·빨강) 이라 한 줄에서 양방향으로 틀렸다.
        rate: avgLosNum != null && tLos != null ? (avgLosNum <= tLos ? 100 : Math.round((tLos / avgLosNum) * 100)) : null,
        n: losSampleN,
        note: losSampleN > 0 ? (tLos != null ? undefined : unsetNote) : '이번달 퇴원 0건 — 산출 불가',
      },
      {
        name: '수술건수/월', target: tSurgery != null ? tSurgery + '건' : unset,
        actual: `${surgeryCount}건`,
        // 수술 0건은 **진짜 0** 이다(목표 대비 0%). 표본 부재가 아니다.
        rate: tSurgery != null ? Math.round((surgeryCount / tSurgery) * 100) : null,
        n: surgeryCount,
        note: tSurgery != null ? undefined : unsetNote,
      },
      {
        name: '청구 삭감률', target: tReduction != null ? '<' + tReduction + '%' : unset,
        actual: reductionRate != null ? `${reductionRate}%` : '-',
        rate: reductionRateNum != null && tReduction != null ? (reductionRateNum <= tReduction ? 100 : Math.round((tReduction / reductionRateNum) * 100)) : null,
        n: claimN,
        note: claimN > 0
          ? (totalClaimed > 0 ? (tReduction != null ? undefined : unsetNote) : '청구액 합계 0 — 산출 불가')
          : '이번달 청구 0건 — 산출 불가',
      },
      {
        name: '입원환자', target: '-',
        actual: `${admissions}명`,
        // 목표가 없는 참고 지표 — 달성률은 0% 가 아니라 **해당 없음**.
        rate: null, n: admissions,
        note: '목표 미설정(참고 지표)',
      },
    ] as { name: string; target: string; actual: string; rate: number | null; n: number; note?: string }[];
  }

  async getClaimsSummary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const claims = await this.prisma.claim.findMany({
      where: { claimDate: { gte: monthStart, lt: monthEnd } },
      select: { status: true, claimedAmount: true, reducedAmount: true },
    });

    const draft = claims.filter(c => c.status === 'DRAFT').length;
    const submitted = claims.filter(c => c.status === 'SUBMITTED').length;
    const inReview = claims.filter(c => c.status === 'UNDER_REVIEW').length;
    const approved = claims.filter(c => c.status === 'APPROVED' || c.status === 'PAID').length;
    const totalClaimed = claims.reduce((s, c) => s + c.claimedAmount, 0);
    const totalReduced = claims.reduce((s, c) => s + (c.reducedAmount ?? 0), 0);

    // 🔴 청구 0건의 삭감률은 '0.0' 이 아니라 null(산출 불가). 0.0 은 "삭감이 없었다"로 읽힌다.
    // 🔴 (2026-10-14 수납·청구 결함 발굴 P4-4) 분모는 **심사가 끝난 청구**만 — 종전엔 작성 중·제출(미심사) 청구액까지 분모에 넣어
    //    삭감률이 실제보다 낮게 보였다(심사 전 청구는 삭감될 기회가 없었다).
    const reviewed = claims.filter((c) => REVIEWED_CLAIM_STATUSES.includes(c.status));
    const reviewedClaimed = reviewed.reduce((s, c) => s + c.claimedAmount, 0);
    const reviewedReduced = reviewed.reduce((s, c) => s + (c.reducedAmount ?? 0), 0);
    const reductionRateNum = reviewed.length > 0 && reviewedClaimed > 0 ? (reviewedReduced / reviewedClaimed) * 100 : null;

    return {
      count: claims.length,
      draft,
      submitted: submitted + inReview,
      approved,
      totalClaimed,
      totalReduced,
      reductionRate: reductionRateNum != null ? reductionRateNum.toFixed(1) : null,
      reductionRatePct: metric(reductionRateNum != null ? Math.round(reductionRateNum * 10) / 10 : null, reviewed.length),
      reviewedCount: reviewed.length,
      note: claims.length === 0 ? '이번달 청구 0건 — 삭감률 산출 불가' : reviewed.length === 0 ? '이번달 심사가 끝난 청구 0건 — 삭감률 산출 불가' : undefined,
    };
  }

  /**
   * 경영 알림 — 🔴 종전엔 `.catch(() => 0)` 으로 조회 실패를 "0건"(=문제 없음)으로 흡수했고,
   * 메시지는 전부 정적 텍스트라 **근거 목록으로 갈 방법이 없었다**(P7). 링크와 실패 표시를 붙인다.
   */
  async getAlerts() {
    const alerts: { type: string; message: string; severity: string; href?: string; count?: number }[] = [];

    // 미수납 — /journey-console·KPI 카드와 같은 집합(전 기간 PENDING·PARTIAL·DEFERRED)
    const [unpaid, lowInventory, incompleteCharts, equipMaint] = await Promise.allSettled([
      this.prisma.billing.count({ where: { status: { in: UNPAID_STATUS } } }),
      this.prisma.inventoryItem.count({
        where: { currentStock: { lte: this.prisma.inventoryItem.fields.safetyStock as unknown as number } },
      }),
      this.prisma.encounter.count({
        where: { status: 'DRAFT', createdAt: { lt: new Date(Date.now() - INCOMPLETE_CHART_AGE_MS) } },
      }),
      this.prisma.equipment.count({ where: { status: 'UNDER_MAINTENANCE' } }),
    ]);

    const push = (
      r: PromiseSettledResult<number>,
      type: string,
      label: (n: number) => string,
      severity: string,
      href: string,
      failLabel: string,
    ) => {
      if (r.status === 'rejected') {
        // 실패를 0 으로 흡수하지 않는다 — "문제 없음"과 "확인 못 함"은 다르다.
        this.logger.error(`경영 알림 조회 실패(${type}): ${String((r.reason as Error)?.message ?? r.reason)}`);
        alerts.push({ type: `${type}:error`, message: failLabel, severity: 'error', href });
        return;
      }
      if (r.value > 0) alerts.push({ type, message: label(r.value), severity, href, count: r.value });
    };

    push(unpaid, 'billing', n => `미수납 ${n}건 (전체 기간)`, 'warning', '/billing', '미수납 조회 실패 — 확인 필요');
    push(lowInventory, 'inventory', n => `재고 부족 ${n}품목`, 'warning', '/inventory', '재고 조회 실패 — 확인 필요');
    push(incompleteCharts, 'chart', n => `미완료 차트 ${n}건 (DRAFT 24시간 경과)`, 'info', '/admin/him', '미완료 차트 조회 실패 — 확인 필요');
    push(equipMaint, 'equipment', n => `장비 점검중 ${n}건`, 'info', '/equipment', '장비 조회 실패 — 확인 필요');

    return alerts;
  }

  // ── 의료 품질 대시보드 ──

  async getClinicalOverview() {
    const { gte: today, lt: tomorrow } = todayRange();

    const [todayEncounters, totalAppointments, inpatients, icuPatients, waitingQueue] = await Promise.all([
      this.prisma.encounter.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      this.prisma.appointment.count({ where: { scheduledAt: { gte: today, lt: tomorrow } } }),
      this.prisma.admission.count({ where: { status: 'ADMITTED' } }),
      this.prisma.icuAdmission.count({ where: { status: 'ADMITTED' } }),
      // 🔴 "현재 대기중"에 `createdAt: 오늘` 필터가 걸려 있어, **어제부터 대기 중인 환자가 카드에서 사라졌다**.
      //    '현재'는 오늘 생성분이 아니다. 집합은 /journey-console 대기 정본(WAITING+CALLED)과 맞춘다.
      // 🔴 W8 Q9: `checkedInAt ≤ now` 상한이 **여기만 빠져 있었다**. 아직 오지 않은 2명이
      //    대기 198명에 섞여, 같은 화면군의 /dashboard(196)와 다른 수를 말했다.
      this.prisma.waitingQueue.count({ where: { status: { in: OPD_WAITING_STAGES }, checkedInAt: notFutureCheckIn() } }),
    ]);

    return {
      todayEncounters,
      totalAppointments,
      waitingPatients: waitingQueue,
      waitingBasis: `현재 대기(${OPD_WAITING_STAGES.join('+')}) — 접수일 무관, 미래 접수(checkedInAt>now) 제외`,
      inpatients,
      icuPatients,
    };
  }

  async getDoctorStats() {
    const { gte: today, lt: tomorrow } = todayRange();
    // 🔴 월요일 시작 주 — 종전 `getDate() - getDay() + 1` 은 **일요일에 내일**을 가리켜(getDay()=0)
    //    조회 구간이 비고 주간합계가 전부 0 이 됐다.
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - ((today.getDay() + 6) % 7));
    const draftCutoff = new Date(Date.now() - INCOMPLETE_CHART_AGE_MS);

    const [doctors, todayByDoctor, weekByDoctor, draftByDoctor, waitingByDoctor] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'DOCTOR', isActive: true },
        select: { id: true, familyName: true, givenName: true, department: true, role: true, isActive: true },
      }),
      this.prisma.encounter.groupBy({
        by: ['doctorId'],
        where: { createdAt: { gte: today, lt: tomorrow } },
        _count: true,
      }),
      this.prisma.encounter.groupBy({
        by: ['doctorId'],
        where: { createdAt: { gte: weekStart, lt: tomorrow } },
        _count: true,
      }),
      // 미완료 차트 정본과 동일(DRAFT 24시간 경과) — 알림과 표가 같은 수를 말하게 한다.
      this.prisma.encounter.groupBy({
        by: ['doctorId'],
        where: { status: 'DRAFT', createdAt: { lt: draftCutoff } },
        _count: true,
      }),
      this.prisma.waitingQueue.groupBy({
        by: ['doctorId'],
        // 🔴 미래 접수 제외 — 의료진별 대기 인원도 같은 상한을 쓴다(W8 Q9·전 축 공통).
        where: { status: { in: OPD_WAITING_STAGES }, checkedInAt: notFutureCheckIn() },
        _count: true,
      }),
    ]);

    const todayMap = new Map(todayByDoctor.map(g => [g.doctorId, g._count as unknown as number]));
    const weekMap = new Map(weekByDoctor.map(g => [g.doctorId, g._count as unknown as number]));
    const draftMap = new Map(draftByDoctor.map(g => [g.doctorId, g._count as unknown as number]));
    const waitMap = new Map(waitingByDoctor.map(g => [g.doctorId, g._count as unknown as number]));

    type Author = { id: string; familyName: string | null; givenName: string | null; department: string | null; role: string; isActive: boolean };
    const byId = new Map<string, Author>();
    for (const d of doctors) byId.set(d.id, d as Author);

    // 🔴 표를 `role=DOCTOR` 로만 만들면, 그 밖의 계정이 소유한 미완료 차트 144건은 **행 자체가 없어**
    //    담당자가 어느 화면에도 보이지 않았다. 실적/미완료가 붙은 **모든 작성자**를 표에 올린다.
    const referenced = new Set<string>([...todayMap.keys(), ...weekMap.keys(), ...draftMap.keys(), ...waitMap.keys()]);
    const missingIds = Array.from(referenced).filter(id => !byId.has(id));
    if (missingIds.length) {
      const extras = await this.prisma.user.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, familyName: true, givenName: true, department: true, role: true, isActive: true },
      });
      for (const u of extras) byId.set(u.id, u as Author);
    }

    const ids = new Set<string>([...byId.keys(), ...referenced]);
    const result = Array.from(ids).map(id => {
      const u = byId.get(id);
      const name = u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() : '';
      return {
        id,
        // 이름을 모르면 '알 수 없음'이라고 말한다 — 공백으로 두면 행이 유령이 된다.
        name: name || (u ? `(이름 미상 ${id.slice(0, 8)})` : `(삭제된 계정 ${id.slice(0, 8)})`),
        department: u?.department?.trim() || DEPT_UNASSIGNED,
        role: u?.role ?? 'UNKNOWN',
        isDoctor: u?.role === 'DOCTOR',
        isActive: u?.isActive ?? false,
        todayEncounters: todayMap.get(id) ?? 0,
        weekEncounters: weekMap.get(id) ?? 0,
        waitingPatients: waitMap.get(id) ?? 0,
        incompleteCharts: draftMap.get(id) ?? 0,
      };
    });

    return result.sort((a, b) =>
      b.todayEncounters - a.todayEncounters ||
      b.incompleteCharts - a.incompleteCharts ||
      b.weekEncounters - a.weekEncounters,
    );
  }

  async getSafety() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
      const incidents = await this.prisma.safetyIncident.findMany({
        where: { createdAt: { gte: monthStart } },
        select: { type: true },
      });

      const byType = new Map<string, number>();
      for (const i of incidents) {
        const t = (i.type as string) || 'UNKNOWN';
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      const fallCount = byType.get('FALL') ?? 0;
      const medErrorCount = byType.get('MEDICATION_ERROR') ?? 0;

      return {
        unavailable: false as const,
        since: localDateKey(monthStart),
        totalIncidents: incidents.length,
        falls: fallCount,
        medicationErrors: medErrorCount,
        others: incidents.length - fallCount - medErrorCount,
        // '기타' 를 한 덩어리로 감추지 않는다 — 실데이터에서 유형을 그대로 낸다.
        byType: Array.from(byType.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      };
    } catch (e) {
      // 🔴 종전 `.catch(() => [])` — 조회 실패가 "이번달 안전사고 0건"(=안전함)으로 둔갑했다.
      this.logger.error(`안전사고 조회 실패: ${String((e as Error)?.message ?? e)}`);
      return {
        unavailable: true as const,
        since: localDateKey(monthStart),
        totalIncidents: null,
        falls: null,
        medicationErrors: null,
        others: null,
        byType: [] as { type: string; count: number }[],
      };
    }
  }

  async getInfection() {
    try {
      const infections = await this.prisma.infectionSurveillance.findMany({
        where: { resolvedAt: null },
        select: { organism: true, isolationType: true, infectionType: true },
      });

      const organismCounts = new Map<string, number>();
      let mrsa = 0;
      let sAureusUnclassified = 0;
      let organismUnknown = 0;

      for (const i of infections) {
        const raw = (i.organism ?? '').trim();
        if (!raw) { organismUnknown++; continue; }
        organismCounts.set(raw, (organismCounts.get(raw) ?? 0) + 1);
        if (MRSA_PATTERN.test(raw)) mrsa++;
        else if (S_AUREUS_PATTERN.test(raw)) sAureusUnclassified++;
      }

      const isolated = infections.filter(i => i.isolationType != null).length;

      return {
        unavailable: false as const,
        active: infections.length,
        isolated,
        // 🔴 `organism === 'MRSA'` 완전일치는 학명 컬럼과 절대 만나지 않아 **항상 0** 이었다.
        //    이제는 내성이 명시된 것만 센다 — 그리고 "판정 불가"를 0 으로 숨기지 않는다.
        mrsa,
        mrsaBasis: 'organism 텍스트에 MRSA/메티실린 내성 표기가 있는 건만',
        sAureusUnclassified, // 황색포도알균이나 내성 표기 없음 → MRSA/MSSA 판정 불가
        organismUnknown, // organism 미기재 → 기타균이 아니라 **미상**
        others: Math.max(0, infections.length - mrsa - sAureusUnclassified - organismUnknown),
        // 실데이터에서 만든 균주 분포 — '기타균' 한 덩어리로 지우지 않는다.
        organisms: Array.from(organismCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      };
    } catch (e) {
      this.logger.error(`감염관리 조회 실패: ${String((e as Error)?.message ?? e)}`);
      return {
        unavailable: true as const,
        active: null,
        isolated: null,
        mrsa: null,
        mrsaBasis: 'organism 텍스트에 MRSA/메티실린 내성 표기가 있는 건만',
        sAureusUnclassified: null,
        organismUnknown: null,
        others: null,
        organisms: [] as { name: string; count: number }[],
      };
    }
  }

  async getClinicalWeeklyTrend() {
    const { gte: today, lt: tomorrow } = todayRange();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);

    // 🔴 종전엔 `['내과','외과','소아청소년과','정형외과','산부인과','응급의학과']` 6과를 **하드코딩**하고
    //    where 절로 나머지를 잘라낸 뒤, 그 합계를 총량처럼 표시했다.
    //    실측(7월 이후 진료 153건): 이 6과는 5건뿐이고 나머지 148건은 표에서 소멸했다.
    //    진료과 축은 **조회 구간의 실데이터에서** 만든다.
    const encounters = await this.prisma.encounter.findMany({
      where: { createdAt: { gte: weekStart, lt: tomorrow } },
      select: { createdAt: true, doctor: { select: { department: true } } },
    });

    const deptTotals = new Map<string, number>();
    for (const e of encounters) {
      const dept = e.doctor?.department?.trim() || DEPT_UNASSIGNED;
      deptTotals.set(dept, (deptTotals.get(dept) ?? 0) + 1);
    }
    const departments = Array.from(deptTotals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([d]) => d);

    // 날짜 버킷은 로컬(KST) 달력 — `toISOString().slice(0,10)` 은 UTC 라 하루가 밀린다.
    const dayBuckets = new Map<string, Map<string, number>>();
    for (const e of encounters) {
      const key = localDateKey(new Date(e.createdAt));
      const dept = e.doctor?.department?.trim() || DEPT_UNASSIGNED;
      const m = dayBuckets.get(key) ?? new Map<string, number>();
      m.set(dept, (m.get(dept) ?? 0) + 1);
      dayBuckets.set(key, m);
    }

    const days: Record<string, string | number>[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = localDateKey(d);
      const m = dayBuckets.get(dateKey);
      const dayData: Record<string, string | number> = { date: dateKey };
      let total = 0;
      for (const dept of departments) {
        const c = m?.get(dept) ?? 0;
        dayData[dept] = c;
        total += c;
      }
      dayData.total = total; // 합계는 표시된 열의 합 = 그날 전체(축이 실데이터라 누락 없음)
      days.push(dayData);
    }

    return {
      departments,
      days,
      total: encounters.length,
      basis: '조회 구간(최근 7일) 실데이터에서 진료과 축 생성 — 부서 미기재는 "부서 미지정"',
    };
  }

  async getHourlyDistribution(dateStr?: string) {
    // 🔴 `new Date('YYYY-MM-DD')` 은 TZ 무관 UTC 자정이다 → 로컬(KST) 자정으로 파싱한다.
    //    파싱 불가한 값을 그대로 Prisma 에 넘기면 500 이 난다.
    const base = parseLocalDate(dateStr) ?? new Date();
    const date = new Date(base);
    date.setHours(0, 0, 0, 0);
    const next = new Date(date);
    next.setDate(next.getDate() + 1);

    const encounters = await this.prisma.encounter.findMany({
      where: { createdAt: { gte: date, lt: next } },
      select: { createdAt: true },
    });

    const hours: { hour: number; count: number }[] = [];
    for (let h = 8; h <= 18; h++) {
      hours.push({ hour: h, count: encounters.filter(e => new Date(e.createdAt).getHours() === h).length });
    }
    return hours;
  }

  async getTopDiagnoses(limit = 10, from?: string, to?: string) {
    const where: Prisma.EncounterDiagnosisWhereInput = {};
    // 🔴 종전 `gte: new Date(from)`(UTC 자정) + `lt: new Date(to+'T23:59:59')`(로컬) 은 기준이 섞여 있었다.
    //    정본 `dayRange` 로 통일 — 상한은 '그 날 끝까지'(다음날 자정 미만).
    const range = dayRange(from, to);
    if (range) where.encounter = { createdAt: range };

    const diagnoses = await this.prisma.encounterDiagnosis.findMany({
      where,
      select: { diagnosisCodeId: true, diagnosisCode: { select: { code: true, nameKo: true } } },
    });

    const countMap = new Map<string, { code: string; name: string; count: number }>();
    for (const d of diagnoses) {
      const key = d.diagnosisCode?.code ?? d.diagnosisCodeId;
      const existing = countMap.get(key);
      if (existing) existing.count++;
      else countMap.set(key, { code: key, name: d.diagnosisCode?.nameKo ?? key, count: 1 });
    }

    return Array.from(countMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getInsuranceBreakdown() {
    // 보험유형별 집계 — DB측 aggregate(enum 반복). 기존 전건 materialize+JS 집계 제거.
    // Patient.insuranceType 은 non-null enum(@default NHI) → UNKNOWN 버킷 없음. 결과 동일.
    const types = Object.values(InsuranceType);
    const rows = await Promise.all(
      types.map(async (type) => {
        const agg = await this.prisma.billing.aggregate({
          where: { patient: { insuranceType: type } },
          _sum: { totalAmount: true },
          _count: true,
        });
        return { type: type as string, amount: agg._sum.totalAmount ?? 0, count: agg._count };
      }),
    );
    return rows.filter((r) => r.count > 0).sort((a, b) => b.amount - a.amount);
  }
}
