import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { summarizeStayDays } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
// 🔴 목표 달성 판정·단위는 정본 하나에서만 나온다(질 지표 정책). 여기서 다시 만들지 말 것.
import { achievementPercent, evaluateMeetTarget, normalizeIndicatorKey, resolveIndicatorPolicy } from '../quality/indicator-policy';
import { ACTIVE_MEASUREMENT, primaryPerPeriod, readQiPrecedence } from '../quality/measurement-read';
import { ConfigRuntimeService } from '../config/config-runtime.service';
// 🔴 날짜 정본 — `new Date('YYYY-MM-DD')` 은 TZ 무관 항상 UTC 자정이다(수정 금지·읽기 전용).
import { dayRange, localDateKey } from '../../common/day-range';
// 🔴 미래 접수 상한은 전 축 공통 정본에서 온다(W8 Q9).
import { checkInWindow } from '../journey-console/flow-canon';

/** 대기 초과 판정 기준(분) — QI 화면의 '30분 초과' 라벨과 같은 값 */
const OPD_WAIT_OVER_MIN = 30;

@Injectable()
export class QiService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  async getMetrics(from?: string, to?: string, department?: string) {
    const now = new Date();
    /**
     * 🔴 날짜 정본 `dayRange` 로 통일 — W8 Q8.
     *    종전: `new Date(from)` = UTC 자정 / `new Date(to + 'T23:59:59Z')` = UTC 23:59
     *    → KST 서버에서 **이번 달 1일 00:00~09:00 이 통째로 빠지고**, 상한도 하루가 밀렸다.
     */
    const defaultFrom = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const defaultTo = localDateKey(now);
    const range = dayRange(from || defaultFrom, to || defaultTo)!;
    const dateFrom = range.gte!;
    const dateTo = range.lt!; // 배타 상한(다음날 로컬 자정)

    const [outpatient, emergency, inpatient, surgery, safety] = await Promise.all([
      this.getOutpatientMetrics(dateFrom, dateTo, department),
      this.getEmergencyMetrics(dateFrom, dateTo),
      this.getInpatientMetrics(dateFrom, dateTo, department),
      this.getSurgeryMetrics(dateFrom, dateTo),
      this.getSafetyMetrics(dateFrom, dateTo),
    ]);

    return {
      data: {
        period: { from, to, resolvedFrom: dateFrom.toISOString(), resolvedToExclusive: dateTo.toISOString() },
        outpatient, emergency, inpatient, surgery, safety,
      },
    };
  }

  private async getOutpatientMetrics(from: Date, to: Date, department?: string) {
    // 상한: 조회 구간의 끝과 '지금' 중 이른 쪽 — 아직 오지 않은 사람은 '접수 실적'이 아니다(W8 Q9).
    const where: Prisma.WaitingQueueWhereInput = { checkedInAt: checkInWindow(from, to) };
    if (department) where.departmentName = department;

    const queues = await this.prisma.waitingQueue.findMany({
      where,
      select: { checkedInAt: true, startedAt: true, status: true },
    });

    /**
     * 🔴 분자와 분모는 **같은 모집단**이어야 한다 — W8 Q3.
     *
     *    종전: 분자 `over30` 은 `startedAt` 이 있는 건에서만 나오는데(진료 시작 시각이 있어야
     *    대기시간이 계산된다) 분모는 접수 전량이었다. 실측 2026-08:
     *      접수 672건 · startedAt 보유 13건 · 30분 초과 1건
     *      → 표시 1/672 = **0.1%** (실제 1/13 = **7.7%**, 77배 축소)
     *    QI 화면의 경고 임계는 10% 라서, 이 분모로는 **경고가 구조적으로 영원히 뜨지 않는다**.
     *    → 대기 관련 비율의 분모는 '대기시간을 알 수 있는 건'(startedAt 보유)이다.
     *      표본이 없으면 0% 가 아니라 **null(산출 불가)**.
     */
    const measurable = queues.filter(q => q.startedAt);
    const waitTimes = measurable.map(q => (q.startedAt!.getTime() - q.checkedInAt.getTime()) / 60000);
    const waitSampleN = waitTimes.length;
    const avgWait = waitSampleN > 0 ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitSampleN) : null;
    const maxWait = waitSampleN > 0 ? Math.round(Math.max(...waitTimes)) : null;
    const over30 = waitTimes.filter(t => t > OPD_WAIT_OVER_MIN).length;

    const encounters = await this.prisma.encounter.count({ where: { createdAt: { gte: from, lt: to } } });
    const signed = await this.prisma.encounter.count({ where: { createdAt: { gte: from, lt: to }, status: 'SIGNED' } });

    return {
      totalVisits: queues.length,
      avgWaitMinutes: avgWait,
      maxWaitMinutes: maxWait,
      waitOver30Min: waitSampleN > 0 ? over30 : null,
      waitOver30MinRate: waitSampleN > 0 ? Math.round((over30 / waitSampleN) * 1000) / 10 : null,
      /** 대기 비율의 **분모** — 화면이 "몇 건 중 몇 건"인지 말할 수 있게 함께 낸다 */
      waitSampleN,
      waitUnmeasuredN: queues.length - waitSampleN,
      waitBasis: waitSampleN > 0
        ? `진료 시작 시각(startedAt) 보유 ${waitSampleN}건 기준(접수 ${queues.length}건 중 ${queues.length - waitSampleN}건은 대기시간 산출 불가)`
        : `대기시간을 산출할 수 있는 건 없음(접수 ${queues.length}건 전부 startedAt 미기록) — 대기 지표 산출 불가`,
      // 진료 0건은 진짜 0 이 아니라 분모 부재 — 서명률도 null 이 정직하다.
      encounterSignRate: encounters > 0 ? Math.round((signed / encounters) * 1000) / 10 : null,
      encounterN: encounters,
      /** 🔴 서명률의 **분자** — 없으면 화면이 `n / N` 을 그릴 수 없어 영원히 분모 없는 퍼센트가 된다 */
      encounterSignNumerator: signed,
      encounterSignDenominator: encounters,
    };
  }

  private async getEmergencyMetrics(from: Date, to: Date) {
    const visits = await this.prisma.emergencyVisit.findMany({
      where: { arrivalAt: { gte: from, lt: to } },
      select: { arrivalAt: true, treatmentStartedAt: true, dispositionAt: true, disposition: true, triageLevel: true },
    });

    const withDisposition = visits.filter(v => v.dispositionAt);
    const stayHours = withDisposition.map(v => (v.dispositionAt!.getTime() - v.arrivalAt.getTime()) / 3600000);
    // 🔴 (2026-09-16 J3) 표본이 없으면 평균은 `0` 이 아니라 산출 불가다 — QI 화면은 '평균 체류 0분'을 실적으로 읽는다.
    const avgStay = stayHours.length > 0 ? Math.round(stayHours.reduce((a, b) => a + b, 0) / stayHours.length * 10) / 10 : null;
    const over6h = stayHours.filter(h => h > 6).length;

    const withDoctor = visits.filter(v => v.treatmentStartedAt);
    const d2d = withDoctor.map(v => (v.treatmentStartedAt!.getTime() - v.arrivalAt.getTime()) / 60000);
    const avgD2D = d2d.length > 0 ? Math.round(d2d.reduce((a, b) => a + b, 0) / d2d.length) : null;

    const admissions = visits.filter(v => v.disposition === 'ADMISSION').length;

    const ktasDist: Record<string, number> = {};
    visits.forEach(v => { ktasDist[v.triageLevel] = (ktasDist[v.triageLevel] ?? 0) + 1; });

    /**
     * 🔴 **분모 0에서 `0` 을 돌려주던 것을 `null` 로 봉합한다.**
     *    기간 내 응급 방문이 하나도 없으면 "6시간 초과 체류율 0% · 입원 전환율 0%"가 나가는데,
     *    이건 "전부 6시간 안에 나갔고 아무도 입원하지 않았다"는 **다른 사실**이다(P1·P17).
     *    표본 부재의 정답은 폴백이 아니라 `null`(산출 불가)이고, 분자·분모를 함께 낸다.
     */
    return {
      totalVisits: visits.length,
      avgStayHours: avgStay,
      stayOver6Hours: over6h,
      stayOver6HoursRate: visits.length > 0 ? Math.round((over6h / visits.length) * 1000) / 10 : null,
      stayOver6HoursNumerator: over6h,
      stayOver6HoursDenominator: visits.length,
      admissionRate: visits.length > 0 ? Math.round((admissions / visits.length) * 1000) / 10 : null,
      /** 입원 전환 **건수**(분자) — disposition === 'ADMISSION' */
      admissionNumerator: admissions,
      admissionDenominator: visits.length,
      doorToDoctor: avgD2D,
      ktasDistribution: ktasDist,
    };
  }

  private async getInpatientMetrics(from: Date, to: Date, department?: string) {
    const admissions = await this.prisma.admission.findMany({
      where: { admitDate: { gte: from, lt: to } },
      select: { id: true, patientId: true, admitDate: true, dischargeDate: true, status: true },
    });

    const discharged = admissions.filter(a => a.dischargeDate);
    // 🔴 (2026-10-01) 개별 재원일수는 정본 stayDays — 종전 소수 일 계산은 환자 화면 값과 갈렸다(summarizeStayDays 주석)
    const losSummary = summarizeStayDays(discharged);
    const los = losSummary.values;
    // 🔴 (2026-09-16 J3) 표본이 없으면 평균은 `0` 이 아니라 산출 불가다 — QI 화면은 '평균 체류 0분'을 실적으로 읽는다.
    const avgLos = losSummary.meanDays;
    const longStay = los.filter(d => d > 14).length;

    // 30일 재입원
    let readmission30 = 0;
    for (const a of discharged) {
      if (!a.dischargeDate) continue;
      const readmit = await this.prisma.admission.count({
        where: {
          patientId: a.patientId,
          admitDate: { gt: a.dischargeDate, lte: new Date(a.dischargeDate.getTime() + 30 * 86400000) },
          id: { not: a.id },
        },
      });
      if (readmit > 0) readmission30++;
    }

    const totalBeds = await this.prisma.bed.count();
    const occupiedBeds = await this.prisma.bed.count({ where: { status: 'OCCUPIED' } });

    return {
      totalAdmissions: admissions.length,
      avgLengthOfStay: avgLos,
      longStay,
      readmission30Days: readmission30,
      /**
       * 🔴 분모 0에서 `0` 을 돌려주던 것을 `null` 로 봉합.
       *    재입원율의 분모는 **기간 내 퇴원 건**이지 입원 전량이 아니다 — 화면이 `totalAdmissions` 로
       *    나누고 있어 정본이 둘이었다. 분모를 서버가 직접 낸다.
       */
      readmissionRate: discharged.length > 0 ? Math.round((readmission30 / discharged.length) * 1000) / 10 : null,
      readmissionNumerator: readmission30,
      readmissionDenominator: discharged.length,
      dischargedCount: discharged.length,
      bedOccupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : null,
      /** 재원(OCCUPIED) 병상 = 분자 · 등록 병상 = 분모. 등록 0이면 가동률은 0%가 아니라 산출 불가 */
      bedOccupancyNumerator: occupiedBeds,
      bedOccupancyDenominator: totalBeds,
    };
  }

  private async getSurgeryMetrics(from: Date, to: Date) {
    const surgeries = await this.prisma.surgery.findMany({
      where: { scheduledAt: { gte: from, lt: to } },
      select: { status: true, scheduledAt: true, startedAt: true, endedAt: true },
    });

    const completed = surgeries.filter(s => s.startedAt && s.endedAt);
    const opTimes = completed.map(s => (s.endedAt!.getTime() - s.startedAt!.getTime()) / 60000);
    // 🔴 (2026-09-16 J3) 표본이 없으면 평균은 `0` 이 아니라 산출 불가다 — QI 화면은 '평균 체류 0분'을 실적으로 읽는다.
    const avgOp = opTimes.length > 0 ? Math.round(opTimes.reduce((a, b) => a + b, 0) / opTimes.length) : null;
    const cancelled = surgeries.filter(s => s.status === 'CANCELLED').length;

    return {
      totalSurgeries: surgeries.length,
      avgOpTimeMinutes: avgOp,
      cancelledSurgeries: cancelled,
      // 🔴 기간 내 수술이 0건이면 취소율은 0%(=취소 없음)가 아니라 산출 불가다.
      cancellationRate: surgeries.length > 0 ? Math.round((cancelled / surgeries.length) * 1000) / 10 : null,
      cancellationNumerator: cancelled,
      cancellationDenominator: surgeries.length,
    };
  }

  /**
   * 처방 안전 지표.
   *
   * 🔴 DUR 경고 건수가 **2배**로 부풀어 있었다 — W8 Q2.
   *    종전: `durWarnings: { not: undefined }`.
   *    **Prisma 는 값이 `undefined` 인 필터를 통째로 벗겨낸다**(`{ not: undefined }` 는 조건 없음과 같다).
   *    남은 조건은 `durChecked: true` 하나뿐이라, 실제로 센 것은 "DUR **검사한** 처방 수"였다.
   *    실측: durChecked 8건 vs durWarnings 보유 4건(그중 2건은 JSON `null`) → **진짜 경고 2건**.
   *    "DUR 경고 8건"은 없는 경고 6건을 안전 화면에 만든 것이다.
   *
   *    Json 컬럼은 SQL NULL 과 JSON `null` 이 다르고 빈 배열도 '경고 없음'이라, DB 필터만으로는
   *    "경고가 실제로 담긴 행"을 가릴 수 없다 → SQL NULL 만 1차로 걸러 좁힌 뒤 내용으로 판정한다.
   */
  private async getSafetyMetrics(from: Date, to: Date) {
    const range = { gte: from, lt: to };
    const [prescriptions, durCheckedCount, durWarnRows, durOverridden, statOrders] = await Promise.all([
      this.prisma.prescription.count({ where: { createdAt: range } }),
      this.prisma.prescription.count({ where: { createdAt: range, durChecked: true } }),
      this.prisma.prescription.findMany({
        where: { createdAt: range, durWarnings: { not: Prisma.DbNull } },
        select: { durWarnings: true },
      }),
      this.prisma.prescription.count({ where: { createdAt: range, durOverridden: true } }),
      this.prisma.order.count({ where: { createdAt: range, priority: 'STAT' } }),
    ]);

    const durAlerts = durWarnRows.filter((r) => QiService.hasDurWarning(r.durWarnings)).length;

    return {
      totalPrescriptions: prescriptions,
      /** DUR **검사를 수행한** 처방 수 — 경고 수와 다른 사실이다(라벨을 분리한다) */
      durChecked: durCheckedCount,
      /** DUR 경고가 **실제로 담긴** 처방 수 */
      durAlerts,
      durAlertsBasis: 'durWarnings 에 항목이 1개 이상 담긴 처방 수(JSON null·빈 배열 제외) — durChecked 와 다른 사실',
      durOverridden,
      statOrders,
    };
  }

  /** durWarnings(Json) 에 경고가 실제로 담겼는가 — JSON `null`·빈 배열·빈 객체는 '경고 없음' */
  private static hasDurWarning(v: unknown): boolean {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    return true;
  }

  // ─── C4. 의료 질 지표 관리 고도화 (10 endpoints) ───────────────────

  /**
   * HIRA 적정성 평가 지표.
   *
   * 🔴 원래 결함(P15-b): 8지표의 값·목표·**등급**이 전부 하드코딩 상수였다. 심평원 적정성평가는
   *    기관이 제출하고 심평원이 등급을 부여하는 **외부 평가 결과**라 우리 DB 에서 산출될 수 없다.
   *    "제왕절개 분만율 42.1% 4등급" 같은 문장이 근거 있는 평가 결과로 읽혔다.
   *    → 결과 원천(심평원 공표자료 등재)이 생기기 전까지 표시하지 않는다.
   */
  /**
   * 적정성 평가(2026-10-09) — 산출하지 않고 **등재된 것을 보인다**(결정 qi.hiraIndicatorSet).
   * 질 지표 원장에서 분류가 '적정성 평가'인 지표와 그 최신 정본 측정(출처 함께 — 외부 통보 결과는 EXTERNAL).
   * 🔴 등재된 지표가 없으면 종전대로 산출 불가 + 이유(값·등급을 지어내지 않는다).
   */
  async getAdequacyIndicators(_diseaseGroup?: string) {
    const rows = await this.prisma.qualityIndicator.findMany({
      where: { isActive: true },
      include: { measurements: { where: ACTIVE_MEASUREMENT, orderBy: { period: 'desc' }, take: 6 } },
    });
    const adequacy = rows.filter((r) => (r.category ?? '').replace(/\s+/g, '').includes('적정성'));
    if (!adequacy.length) {
      return {
        available: false,
        reason: '적정성 평가 분류로 등재된 질 지표가 없습니다(결정 qi.hiraIndicatorSet) — 외부 평가 결과는 산출 대상이 아니라 등재 대상입니다. 출처 없는 값·등급은 표시하지 않습니다.',
        indicators: [] as Array<Record<string, unknown>>,
        totalCount: 0,
      };
    }
    const precedence = await readQiPrecedence(this.config);
    const indicators = adequacy.map((i) => {
      const head = primaryPerPeriod(i.measurements, precedence)[0] ?? null;
      const policy = resolveIndicatorPolicy(i);
      const value = head ? Number(head.primary.value) : null;
      return {
        indicatorId: i.id, name: i.name, category: i.category, unit: policy.unit,
        period: head?.period ?? null, value, source: head?.primary.source ?? null,
        target: Number(i.targetValue), achieved: evaluateMeetTarget(value, Number(i.targetValue), policy.direction),
      };
    });
    return { available: true, indicators, totalCount: indicators.length };
  }

  /**
   * Patient Safety Indicators.
   *
   * 🔴 원래 결함: `source:'ESTIMATED'` 주석은 달려 있었지만 8개 PSI 값·벤치마크가 그대로 상수였다.
   *    (욕창 1.2·수술후사망 0.8 …) 라벨을 붙였다고 지어낸 값이 사실이 되지는 않는다.
   *    PSI 는 AHRQ 정의의 분자·분모(진단코드 조합)를 집계해야 하며 그 로직이 없다.
   *    → 집계 로직이 생길 때까지 값을 만들지 않는다. 실집계인 기초 건수만 내려준다.
   */
  async calculatePsi() {
    const admissions = await this.prisma.admission.count();
    const surgeries = await this.prisma.surgery.count();

    /**
     * 🔴 B6(2026-08-31): PSI 실산출을 검토했으나 **막는 전제가 있어 산출하지 않는다** — 기획이 데이터에
     *    졌다("실측이 기획을 이긴다"). AHRQ PSI 는 거의 전 지표가 **POA(present-on-admission·입원 시 존재)
     *    플래그**로 병원발생과 기존질환을 가른다(예: PSI-03 욕창·PSI-08 낙상 골절은 "입원 시 없었던" 것만
     *    분자). 우리 `EncounterDiagnosis`·`Admission` 에는 **POA 플래그가 없다** → POA 없이 진단코드만으로
     *    세면 기존 질환을 **병원발생 안전사건으로 오분류**한다(안전 신호 날조 — 이 모듈이 상수 제거로 피한
     *    바로 그 함정). 관찰된 안전사건(낙상 등)은 이미 `safety-board`/`patient-safety` 가 별도로 낸다
     *    (여기서 PSI 로 재라벨하면 정본이 둘이 되어 갈라진다).
     *
     *    🔴 활성화 전제(사람/스키마): ① 진단에 POA 플래그 도입(입력·EDI 수신 양쪽) ② AHRQ 지표별 코드셋
     *    등재(검증 가능한 출처) ③ 제외기준(모집단) 확정. 그 전엔 available:false 를 유지한다.
     */
    return {
      calculatedAt: new Date().toISOString(),
      available: false,
      reason: 'PSI 산출 불가 — AHRQ 정의의 핵심 전제인 POA(입원 시 존재) 플래그가 데이터에 없어, 병원발생과 기존질환을 가를 수 없습니다(POA 없이 세면 안전 신호를 날조하게 됩니다). 활성화엔 POA 플래그·지표별 코드셋·제외기준이 선행합니다.',
      blockers: ['POA_FLAG_ABSENT', 'AHRQ_CODESET_UNREGISTERED', 'EXCLUSION_CRITERIA_UNDEFINED'],
      indicators: [] as Array<Record<string, unknown>>,
      baseCounts: { admissions, surgeries },
    };
  }

  /**
   * HSMR (Hospital Standardized Mortality Ratio).
   *
   * 🔴 원래 결함: 관찰사망 = 입원 × 1.5%, 기대사망 = 입원 × 1.8% 라는 **임의 계수**로 사망자 수를
   *    만들어 HSMR·95% 신뢰구간·3개월 추이(hsmr+5, hsmr+2)까지 그렸다. 아무도 죽지 않은 달에도
   *    "관찰사망 N명"이 나왔고, 신뢰구간은 통계가 아니라 ±15 상수였다.
   *    실제로는 사망 원천 자체가 없다 — `AdmissionStatus` 는 ADMITTED/TRANSFERRED/DISCHARGED/CANCELLED
   *    뿐이고 퇴원 유형(사망)·중증도 보정 모델이 모두 부재하다.
   *    → 사망비는 산출하지 않는다. 실집계인 입원 건수만 내려준다.
   */
  async calculateHsmr(period?: string) {
    const now = new Date();
    const year = period ? parseInt(period.slice(0, 4), 10) : now.getFullYear();
    const month = period ? parseInt(period.slice(5, 7), 10) : now.getMonth() + 1;
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const totalAdmissions = await this.prisma.admission.count({
      where: { admitDate: { gte: from, lte: to } },
    });

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      available: false,
      reason: '원내 사망 원천(퇴원 유형=사망) 부재 + 중증도 보정(기대사망) 모델 미구현 — 관찰/기대 사망을 계수로 추정하지 않습니다.',
      totalAdmissions,
      observedDeaths: null,
      expectedDeaths: null,
      hsmr: null,
      interpretation: null,
      confidence95: null,
      trend: [] as Array<{ month: string; hsmr: number }>,
    };
  }

  /** 30일 재입원율 추적 */
  /** 30일 재입원율 목표 — 질 지표 원장(이름 정규화 일치) 하나. 없으면 null */
  private async readmissionTarget(): Promise<{ value: number; direction: ReturnType<typeof resolveIndicatorPolicy>['direction']; indicatorName: string } | null> {
    const rows = await this.prisma.qualityIndicator.findMany({ where: { isActive: true } });
    const hit = rows.find((r) => normalizeIndicatorKey(r.name) === '30일내재입원율');
    if (!hit) return null;
    return { value: Number(hit.targetValue), direction: resolveIndicatorPolicy(hit).direction, indicatorName: hit.name };
  }

  async getReadmissionRate(period?: string) {
    const now = new Date();
    const year = period ? parseInt(period.slice(0, 4), 10) : now.getFullYear();
    const month = period ? parseInt(period.slice(5, 7), 10) : now.getMonth() + 1;
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const discharged = await this.prisma.admission.findMany({
      where: { dischargeDate: { gte: from, lte: to } },
      // 🔴 B5(2026-08-31): 부서는 **파생**한다 — Admission 에 컬럼을 늘리지 않고 주치의(없으면 입원의)의
      //    진료과를 쓴다(attendingDoctor → admittingDoctor 폴백). 미지정은 지어내지 않고 '미지정'.
      select: {
        id: true, patientId: true, dischargeDate: true,
        attendingDoctor: { select: { department: true } },
        admittingDoctor: { select: { department: true } },
      },
    });

    // 부서별 분모/분자 누적(분모 병기)
    const byDept = new Map<string, { discharges: number; readmissions: number }>();
    const deptOf = (d: (typeof discharged)[number]) =>
      d.attendingDoctor?.department ?? d.admittingDoctor?.department ?? '미지정';

    let readmissions = 0;
    for (const d of discharged) {
      if (!d.dischargeDate) continue;
      const dept = deptOf(d);
      const slot = byDept.get(dept) ?? { discharges: 0, readmissions: 0 };
      slot.discharges += 1;
      const count = await this.prisma.admission.count({
        where: {
          patientId: d.patientId,
          admitDate: { gt: d.dischargeDate, lte: new Date(d.dischargeDate.getTime() + 30 * 86400000) },
          id: { not: d.id },
        },
      });
      if (count > 0) { readmissions++; slot.readmissions += 1; }
      byDept.set(dept, slot);
    }

    const rate = discharged.length > 0 ? Math.round((readmissions / discharged.length) * 1000) / 10 : 0;

    // 표본이 없으면 비율은 0 이 아니라 '산출 불가'다(P1).
    const rateOrNull = discharged.length > 0 ? rate : null;

    // 🔴 2026-10-08 — 목표가 `5.0` 상수였다(지표 원장 목표를 바꿔도 이 화면은 5.0 으로 판정). 목표는 원장 하나 —
    //    지표가 등록돼 있지 않으면 목표도 판정도 없다(지어내지 않는다). 방향은 원장 정본(indicator-policy).
    const target = await this.readmissionTarget();
    const met = target ? evaluateMeetTarget(rateOrNull, target.value, target.direction) : null;

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      totalDischarges: discharged.length,
      readmissions,
      rate: rateOrNull,
      target: target?.value ?? null,
      targetSource: target ? target.indicatorName : null,
      // 🔴 표본이 없는 달을 'ACHIEVED' 로 적지 않는다(0% ≤ 목표).
      achievement: met === null ? null : met ? 'ACHIEVED' : 'NOT_ACHIEVED',
      /**
       * 🔴 B5(2026-08-31): 부서별 분해를 **주치의 진료과 파생**으로 실산출한다(종전엔 컬럼 부재로 빈 배열).
       *    종전 결함이었던 임의 배분/상수 재입원율은 되살리지 않는다 — 분자/분모는 실제로 센 값이고,
       *    부서별 rate 도 그 부서의 분모가 0 이면 만들지 않는다(전체와 같은 정직성).
       *    '미지정'은 주치의·입원의 진료과가 모두 비어 있는 건(지어내지 않는다).
       */
      byDepartment: [...byDept.entries()]
        .map(([department, s]) => ({
          department,
          discharges: s.discharges,
          readmissions: s.readmissions,
          rate: s.discharges > 0 ? Math.round((s.readmissions / s.discharges) * 1000) / 10 : null,
        }))
        .sort((a, b) => b.discharges - a.discharges),
      byDepartmentBasis: '주치의(없으면 입원의) 진료과 파생 — Admission 컬럼 신설 없이 집계',
    };
  }

  /**
   * 인증 체크리스트 **기준 항목 카탈로그**(참조용 — 코드가 DB 에 쓰지 않는다).
   *
   * 🔴 원래 결함(가장 위험): 항목마다 적합 여부(status)와 **근거 문구(evidence)** 가 하드코딩돼 있었고
   *    그대로 DB 에 영속됐다 — '환자 식별 밴드 100% 착용', '**손위생 준수율 95%**',
   *    'LASA 약물 분리 보관 완료'. 아무도 관측한 적이 없는 문장이다(손위생 관측 실측 0건).
   *    인증 실사에 제출되면 허위 근거가 된다.
   *    → 항목의 **뼈대(기준 코드·챕터·명칭)만** 남기고 판정과 근거는 비운다.
   *       status 는 스키마 기본값 'PENDING'(미작성)이며, 근거는 사람이 `PUT /qi/accreditation/:id` 로
   *       작성할 때만 생긴다(작성자 reviewedBy 기록).
   *
   * 🔴 이미 배포된 DB 에는 종전 문구가 남아 있다 — 코드로 지우지 않는다(데이터 교정은 별도 판단).
   *    교정 필요: `UPDATE accreditation_items SET evidence = NULL, status = 'PENDING'
   *               WHERE evidence IN (...종전 8문구...) AND reviewed_by IS NULL;`
   *
   * 🔴 W8 Q1 — **조회(GET)가 DB 를 쓰고 있었다**. `GET /qi/accreditation` 이 테이블이 비면
   *    이 8행을 `createMany` 로 만들었다(실측: 2026-08-14 13:19:40 감사 중 GET 한 번에 8행 생성).
   *    감사·규제 대응 화면에서 **읽기가 기록을 만드는 것**은 그 자체로 결함이다
   *    (읽기 전용 복제본에서 500, 감사 로그의 인과가 뒤집힘, GET 재시도가 데이터를 만듦).
   *    → self-seed 제거. 등재가 없으면 만들지 않고 **'산출 불가'** 를 낸다.
   *    등재는 마이그레이션/시드(사람 판단)로 한다 — 이 배열은 그때 쓰는 **참조 목록**이다.
   */
  /**
   * 🔴 B3(2026-08-31) — 인증 항목에 **실측 근거 원천을 병기**한다. 이 저장소는 이미 근거를 내는
   *    축(환자식별 오류율·수술안전 체크리스트·낙상평가·사고보고·기록 완전성)을 **가지고 있는데**
   *    인증 체크리스트와 이어져 있지 않아 근거가 전량 수기였다. `evidence` 는 사람이 그 숫자를 보러
   *    가는 **링크와 라벨**일 뿐 — 🔴 자동으로 COMPLIANT 판정하지 않는다(판정은 심사자 몫).
   *    근거 원천이 실재하는 항목에만 단다(없으면 지어내지 않는다 → evidence 없음).
   */
  static readonly DEFAULT_ACCREDITATION = [
    { id: 'JCI-IPSG-1', standard: 'JCI', chapter: 'IPSG', name: '환자 확인', evidenceSource: { label: '환자 식별 오류율(IPSG.1)', link: '/safety', source: '/api/v1/safety/identification-check/stats' } },
    { id: 'JCI-IPSG-2', standard: 'JCI', chapter: 'IPSG', name: '효과적 의사소통', evidenceSource: { label: '구두처방 read-back 기록', link: '/safety', source: '/api/v1/safety/verbal-order' } },
    { id: 'JCI-IPSG-3', standard: 'JCI', chapter: 'IPSG', name: '고위험 약물 관리' },
    /**
     * 🔴 2026-08-18 추가 — IPSG.4 가 카탈로그에서 통째로 빠져 있었다.
     *    "다른 환자·부위의 수술"은 **환자안전법 의무보고 4유형** 중 하나이고(과태료 100/200/300만원),
     *    이 저장소는 이미 좌우 게이트·WHO 체크리스트·계수 대조를 **가지고 있는데** 관제 목록에만 없었다.
     *    등재해도 판정(status)은 스키마 기본값 'PENDING'(미작성)이다 — 근거 없는 값을 만들지 않는다.
     *    실측 근거는 `GET /api/v1/qi/surgery-safety/summary`(체크리스트 이행률·좌우 확인 갭, 분모 포함)에서
     *    나오며, 사람이 그 숫자를 보고 `PUT /qi/accreditation/:id` 로 판정·근거를 적는다.
     */
    { id: 'JCI-IPSG-4', standard: 'JCI', chapter: 'IPSG', name: '정확한 환자·부위·술식 확인(오부위수술 방지)', evidenceSource: { label: '수술안전 체크리스트 이행률·좌우/부위 확인 갭', link: '/admin/qi', source: '/api/v1/qi/surgery-safety/summary' } },
    { id: 'JCI-IPSG-5', standard: 'JCI', chapter: 'IPSG', name: '의료관련감염 예방', evidenceSource: { label: '활성 감염·손위생 준수율', link: '/safety-quality-board', source: '/api/v1/qi/safety-board/summary' } },
    { id: 'JCI-IPSG-6', standard: 'JCI', chapter: 'IPSG', name: '낙상 예방', evidenceSource: { label: '낙상위험평가(Morse)', link: '/safety', source: '/api/v1/safety/fall-risk' } },
    { id: 'KOHIAS-1.1', standard: 'KoHIAS', chapter: '안전보장', name: '환자안전 보고체계', evidenceSource: { label: '안전사고 보고·중대사고 RCA 미완료', link: '/admin/data-quality', source: 'safety.rcaMissingForSevere' } },
    { id: 'KOHIAS-2.1', standard: 'KoHIAS', chapter: '진료체계', name: '진료지침 관리' },
    { id: 'KOHIAS-3.1', standard: 'KoHIAS', chapter: '경영관리', name: '인력 관리' },
  ];

  /** JCI/KoHIAS 인증 체크리스트 — 영속(P3). 🔴 읽기 전용: 이 경로는 절대 쓰지 않는다(W8 Q1). */
  async getAccreditationChecklist(standard?: string) {
    const filtered = await this.prisma.accreditationItem.findMany({ where: standard ? { standard } : {}, orderBy: { id: 'asc' } });
    if (filtered.length === 0) {
      // 표본 부재의 정답은 폴백(자동 생성)이 아니라 빈 목록 + 산출 불가다.
      return {
        available: false as const,
        reason: standard
          ? `인증 기준 '${standard}' 항목이 등재돼 있지 않습니다 — 조회는 항목을 만들지 않습니다(등재는 시드/마이그레이션).`
          : '인증 체크리스트 항목 미등재 — 조회는 항목을 만들지 않습니다(등재는 시드/마이그레이션).',
        items: [] as typeof filtered,
        summary: { total: 0, compliant: 0, partial: 0, nonCompliant: 0, pending: 0 },
        complianceRate: null,
        complianceRateBasis: '등재 항목 없음 — 적합률 산출 불가',
        /** 등재 시 참조할 기준 항목 목록(표시용 — DB 에 쓰지 않는다) */
        catalog: QiService.DEFAULT_ACCREDITATION,
      };
    }
    /**
     * 🔴 등재된 것만 보여주면 **빠진 기준이 보이지 않는다** — 8개가 다 초록이어도 IPSG.4 가
     *    아예 없다는 사실은 화면 어디에도 없었다(안전 화면의 초록은 분모를 묻는다·P17).
     *    카탈로그에 있는데 DB 에 없는 항목을 함께 낸다. 코드가 만들어 넣지는 않는다(GET 은 쓰지 않는다).
     */
    const registered = new Set(filtered.map(i => i.id));
    const unregisteredCatalog = QiService.DEFAULT_ACCREDITATION.filter(c => !registered.has(c.id));

    const compliant = filtered.filter(i => i.status === 'COMPLIANT').length;
    const partial = filtered.filter(i => i.status === 'PARTIAL').length;
    const nonCompliant = filtered.filter(i => i.status === 'NON_COMPLIANT').length;
    // 🔴 미작성(PENDING)은 '부적합'도 '적합'도 아니다 — 분모에 섞어 적합률을 만들지 않는다.
    const reviewed = compliant + partial + nonCompliant;
    const pending = filtered.length - reviewed;
    // 🔴 B3: 등재 항목에 카탈로그의 실측 근거 원천(링크·라벨)을 조인해 병기 — 판정은 사람이 그 근거를 보고.
    const evidenceById = new Map(
      QiService.DEFAULT_ACCREDITATION.map((c) => [c.id, (c as { evidenceSource?: unknown }).evidenceSource] as const),
    );
    // 🔴 DB `evidence`(사람이 쓴 근거 텍스트)는 보존하고, 실측 근거 원천은 `evidenceSource` 로 별도 병기.
    const itemsWithEvidence = filtered.map((i) => ({ ...i, evidenceSource: evidenceById.get(i.id) ?? null }));

    return {
      available: true as const,
      items: itemsWithEvidence,
      summary: { total: filtered.length, compliant, partial, nonCompliant, pending },
      // 판정된 항목이 없으면 적합률은 0% 가 아니라 '산출 불가'(null)다.
      complianceRate: reviewed > 0 ? Math.round((compliant / reviewed) * 1000) / 10 : null,
      complianceRateBasis: reviewed > 0 ? `판정 완료 ${reviewed}건 기준(미작성 ${pending}건 제외)` : '판정 완료 항목 없음 — 적합률 산출 불가',
      unregisteredCatalog,
      unregisteredNote: unregisteredCatalog.length > 0
        ? `기준 항목 ${unregisteredCatalog.length}건이 등재돼 있지 않습니다 — 위 적합률의 분모에 들어 있지 않습니다(등재는 시드/마이그레이션·사람 판단).`
        : null,
    };
  }

  /** 인증 항목 상태 어휘 — 화면 라벨표·운영 저장값과 동일 집합(§6 회수 2026-08-25).
   *  종전엔 String(data.status) 무검증이라 오타·임의 문자열이 그대로 상태가 됐다(어휘 오염 — 판정·집계가 조용히 빠진다).
   *  지어낸 어휘가 아니다: FE ACC_STATUS 4종 + 운영 실측(PENDING 8/8 ⊂ 집합)을 선언한 것. */
  private static readonly ACCREDITATION_STATUSES = ['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'PENDING'] as const;

  /** 인증 체크리스트 항목 업데이트 — 영속·감사(reviewedBy) */
  async updateAccreditationItem(id: string, data: Record<string, unknown>, userId?: string) {
    const existing = await this.prisma.accreditationItem.findUnique({ where: { id } });
    if (!existing) return null;
    if (data.status !== undefined && !(QiService.ACCREDITATION_STATUSES as readonly string[]).includes(String(data.status))) {
      throw new BadRequestException(`허용되지 않는 인증 상태: ${String(data.status)} (허용: ${QiService.ACCREDITATION_STATUSES.join(', ')})`);
    }
    return this.prisma.accreditationItem.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: String(data.status) } : {}),
        ...(data.evidence !== undefined ? { evidence: data.evidence ? String(data.evidence) : null } : {}),
        ...(data.name !== undefined ? { name: String(data.name) } : {}),
        lastReviewed: new Date(),
        reviewedBy: userId,
      },
    });
  }

  /**
   * 월별 지표 대시보드 (실측 + 추이 + 목표).
   *
   * 🔴 원래 결함: 8지표의 current/target/benchmark/trend 가 전부 하드코딩이었다. 같은 화면·같은 병원인데
   *    `/quality/dashboard`(DB 실측 25지표)와 값이 달랐고(P12), 존재하지 않는 지표('적시 투약률')도 있었다.
   *    → `QualityIndicator`/`QiMeasurement` 실측에서 만든다. **요청한 달에 측정이 없으면 폴백하지 않는다**
   *      (최신값으로 대신 채우면 3개월 전 값이 이번 달 실적으로 읽힌다).
   */
  async getIndicatorDashboard(period?: string) {
    const now = new Date();
    const year = period ? parseInt(period.slice(0, 4), 10) : now.getFullYear();
    const month = period ? parseInt(period.slice(5, 7), 10) : now.getMonth() + 1;
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;

    const rows = await this.prisma.qualityIndicator.findMany({
      where: { isActive: true },
      // 🔴 2026-10-08 — 무효 처리한 측정을 거르지 않아 달성률·추이·보고서에 남았다(`/quality` 만 걸렀다)
      include: { measurements: { where: ACTIVE_MEASUREMENT, orderBy: { period: 'desc' }, take: 12 } },
    });

    // 같은 달 수기·자동 행 → 기간별 정본 한 행(결정 qi.autoManual.precedence · 기본 수기 정본)
    const precedence = await readQiPrecedence(this.config);
    const indicators = rows.map((raw) => {
      const i = { ...raw, measurements: primaryPerPeriod(raw.measurements, precedence).map((x) => x.primary) };
      const policy = resolveIndicatorPolicy(i);
      const target = Number(i.targetValue);
      const measured = i.measurements.find((m) => m.period === periodStr) ?? null;
      const current = measured ? Number(measured.value) : null;
      // 추이: 요청 달까지의 최근 3개월(과거→현재). 없는 달은 만들어 넣지 않는다.
      const trend = i.measurements
        .filter((m) => m.period <= periodStr)
        .slice(0, 3)
        .reverse()
        .map((m) => ({ period: m.period, value: Number(m.value) }));
      /**
       * 🔴 요청 달에 측정이 없을 때 **폴백하지 않는다**(그대로 유지). 다만 "언제 것이 마지막인지"는
       *    말해준다 — 이 값이 없어서 다른 화면(보드)이 몰래 옛 값을 오늘로 쓰고 있었다(W8 Q6).
       */
      const latestAvailable = i.measurements.filter((m) => m.period <= periodStr)[0] ?? null;
      return {
        indicatorId: i.id,
        name: i.name,
        category: i.category,
        current,
        // 2026-10-08 — 그 달 정본 값의 출처(수기·자동·시드) · 보고서가 출처를 함께 찍는다
        currentSource: (measured as { source?: string | null } | null)?.source ?? null,
        target,
        unit: policy.unit,
        direction: policy.direction,
        achieved: evaluateMeetTarget(current, target, policy.direction),
        achievementPercent: achievementPercent(current, target, policy.direction),
        trend,
        /** 요청 달 이전(포함) 마지막 측정 시점 — 폴백값이 아니라 **참고 시점**이다 */
        latestAvailablePeriod: latestAvailable?.period ?? null,
        latestAvailableValue: latestAvailable ? Number(latestAvailable.value) : null,
        // 🔴 전국 벤치마크는 출처가 등재돼야 숫자가 된다 — 상수로 채우지 않는다.
        benchmark: null as number | null,
      };
    });

    const latestPeriods = indicators.map((i) => i.latestAvailablePeriod).filter((p): p is string => !!p);
    const latestAvailablePeriod = latestPeriods.length ? latestPeriods.slice().sort().pop()! : null;
    const measuredCount = indicators.filter((i) => i.current !== null).length;

    return {
      period: periodStr,
      indicators,
      measuredCount,
      /**
       * 🔴 표본 창을 응답이 스스로 말한다(W8 Q6) — `/admin/qi` 보드가 3개월 묵은 2026-05 값을
       *    오늘의 사실처럼 내는 동안 `/qi/target-achievement` 는 '산출 불가'였다. 같은 사실에
       *    두 화면이 다른 답을 낸 원인은 판정 함수가 아니라 **표본 창**이었다.
       */
      periodHasMeasurements: measuredCount > 0,
      latestAvailablePeriod,
      sampleWindowNote: measuredCount > 0
        ? `${periodStr} 측정 ${measuredCount}건 기준`
        : `${periodStr} 측정 없음 — 산출 불가(가장 최근 측정: ${latestAvailablePeriod ?? '없음'}). 옛 값을 이번 달 실적으로 대체하지 않습니다.`,
      benchmarkAvailable: false,
      benchmarkReason: '전국 비교 기준(심평원 공표자료 등) 미등재 — 출처 없는 벤치마크는 표시하지 않습니다.',
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 전국 벤치마크 비교.
   *
   * 🔴 원래 결함(P15-b): 6지표의 우리 병원 값·전국 평균·상위10% ·백분위·등급이 전부 상수였다.
   *    "응급실 체류시간 4.2 (전국 5.8) — EXCELLENT" 가 경영 보고에 그대로 쓰이면 없는 우위를
   *    있다고 말하게 된다. 만족도 축에서 같은 문제를 `available:false` 로 정리했다
   *    (`satisfaction.service.ts#getBenchmark`).
   */
  async getBenchmarkComparison(_indicator?: string) {
    return {
      available: false,
      reason: '전국 비교 기준(심평원 공표자료 등) 미등재 — 출처 없는 전국 평균·백분위·등급은 표시하지 않습니다.',
      benchmarks: [] as Array<Record<string, unknown>>,
      comparedAt: new Date().toISOString(),
    };
  }

  /**
   * 목표 달성률 조회.
   *
   * 🔴 원래 결함: 달성 판정이 여기서 **네 번째 규칙**으로 또 만들어졌다
   *    (`!['손위생 준수율','적시 투약률'].includes(name)` → 나머지는 전부 '낮을수록 좋음').
   *    판정은 정본(`quality/indicator-policy`) 하나에서만 나온다.
   *    미측정은 '미달'이 아니라 분모 밖이다.
   */
  async getTargetAchievement(period?: string) {
    const dashboard = await this.getIndicatorDashboard(period);
    const items = dashboard.indicators.map((ind) => ({
      name: ind.name,
      current: ind.current,
      target: ind.target,
      unit: ind.unit,
      direction: ind.direction,
      achieved: ind.achieved,
      achievementRate: ind.achievementPercent,
    }));

    const judged = items.filter((i) => i.achieved !== null);
    const achievedCount = judged.filter((i) => i.achieved === true).length;
    return {
      period: dashboard.period,
      // 🔴 표본 창을 함께 낸다 — 보드(`/safety-quality-board`)와 이 화면이 다른 답을 낼 때
      //    그 차이가 '판정'이 아니라 '기간'임을 화면이 스스로 설명할 수 있어야 한다(W8 Q6).
      periodHasMeasurements: dashboard.periodHasMeasurements,
      latestAvailablePeriod: dashboard.latestAvailablePeriod,
      sampleWindowNote: dashboard.sampleWindowNote,
      items,
      summary: {
        total: items.length,
        judged: judged.length,
        achieved: achievedCount,
        notAchieved: judged.length - achievedCount,
        unmeasured: items.filter((i) => i.current === null).length,
        undetermined: items.filter((i) => i.current !== null && i.achieved === null).length,
        // 판정된 지표가 없으면 달성률은 0% 가 아니라 '산출 불가'다.
        overallRate: judged.length > 0 ? Math.round((achievedCount / judged.length) * 1000) / 10 : null,
      },
    };
  }

  /** QI 보고서 생성 */
  async generateQiReport(period: string) {
    const [metrics, adequacy, psi, hsmr, readmission, accreditation, dashboard, benchmark, achievement] =
      await Promise.all([
        this.getMetrics(period + '-01', period + '-28'),
        this.getAdequacyIndicators(),
        this.calculatePsi(),
        this.calculateHsmr(period),
        this.getReadmissionRate(period),
        this.getAccreditationChecklist(),
        this.getIndicatorDashboard(period),
        this.getBenchmarkComparison(),
        this.getTargetAchievement(period),
      ]);

    return {
      reportId: `QI-RPT-${period}-${Date.now()}`,
      period,
      generatedAt: new Date().toISOString(),
      sections: {
        operationalMetrics: metrics,
        adequacyEvaluation: adequacy,
        patientSafetyIndicators: psi,
        mortalityRatio: hsmr,
        readmission,
        accreditationStatus: accreditation,
        indicatorDashboard: dashboard,
        benchmarkComparison: benchmark,
        targetAchievement: achievement,
      },
      summary: {
        overallComplianceRate: accreditation.complianceRate,
        targetAchievementRate: achievement.summary.overallRate,
        hsmr: hsmr.hsmr,
        readmissionRate: readmission.rate,
        // 🔴 산출 불가(null)를 숫자처럼 적지 않는다 — 종전에는 "HSMR 83.3 — 기대 사망률 이하"처럼
        //    추정 상수가 보고서 결론 문장이 됐다.
        keyFindings: [
          hsmr.hsmr === null
            ? `HSMR 산출 불가 — ${hsmr.reason}`
            : hsmr.hsmr < 100
              ? `HSMR ${hsmr.hsmr} — 기대 사망률 이하`
              : `HSMR ${hsmr.hsmr} — 주의 필요`,
          accreditation.complianceRate === null
            ? '인증 적합률 산출 불가 — 판정 완료 항목 없음'
            : `인증 적합률 ${accreditation.complianceRate}% (${accreditation.complianceRateBasis})`,
          achievement.summary.overallRate === null
            ? '목표 달성률 산출 불가 — 해당 기간 측정 없음'
            : `목표 달성률 ${achievement.summary.overallRate}% (판정 ${achievement.summary.judged}/${achievement.summary.total}지표)`,
          readmission.rate === null
            ? '30일 재입원율 산출 불가 — 해당 기간 퇴원 없음'
            : `30일 재입원율 ${readmission.rate}%`,
        ],
      },
    };
  }
}
