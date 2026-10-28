/**
 * 🔴 비율 EP 는 **분자·분모를 함께 낸다** — 가드 (2026-08-20)
 *
 * 배경: FE 실측에서 화면을 `<Ratio numerator denominator>` 정본으로 수렴하려다,
 *       **서버가 분자(때로는 분모까지) 를 안 줘서 고칠 수 없는 지점 9개**가 나왔다.
 *       서버 내부에는 이미 그 값이 있는데 비율만 계산해 내보낸다 →
 *       화면은 영원히 **분모 없는 퍼센트**를 그린다("SLA 100%"가 1건 중 1건인지 400건 중 400건인지 모른다).
 *
 * 이 가드가 못박는 두 가지:
 *   ① 각 EP 응답에 분자·분모 필드가 **함께** 있다(하나만 있으면 화면은 여전히 못 그린다)
 *   ② 🔴 **분모 0이면 비율은 `null`** 이다 — `0` 도 `100` 도 아니다.
 *      `0` 은 "관측했는데 없었다", `100` 은 "전건 달성"이라는 **다른 사실**이다(P1·P17).
 *
 * 재주입 역검증(가드가 가드인지 확인한 방법 — 하나씩 되돌리면 아래가 실패한다):
 *   · `xxxRate: ... : 0` 복귀        → "분모 0이면 null" 단언이 실패
 *   · `xxxNumerator` 필드 제거       → "분자·분모가 함께 나온다" 단언이 실패
 *   · 분모 0에서 100 반환            → "0도 100도 아니다" 단언이 실패
 */
import { describe, it, expect, vi } from 'vitest';
import { QiService } from '../../src/modules/qi/qi.service';
import { ExecutiveService } from '../../src/modules/executive/executive.service';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { ClinicalPathwayService } from '../../src/modules/clinical-pathway/clinical-pathway.service';
import { JourneyAnalyticsService, stats } from '../../src/modules/journey-console/journey-analytics.service';
import { IcuService } from '../../src/modules/icu/icu.service';
import { VocAdminService } from '../../src/modules/voc/voc-admin.service';
import { RemoteConsultationService } from '../../src/modules/remote-consultation/remote-consultation.service';

/** 분모 0에서 허용되는 유일한 값 — 0 도 100 도 아니다 */
function expectUnavailable(rate: unknown, label: string) {
  expect(rate, `${label}: 분모 0이면 비율은 null 이다(0 은 "관측했는데 없었다", 100 은 "전건 달성")`).toBeNull();
}

/** 분자·분모가 **함께** 나오는가 — 하나만 있으면 화면은 `n / N` 을 못 그린다 */
function expectPair(n: unknown, d: unknown, label: string) {
  expect(typeof n, `${label}: 분자가 응답에 없다`).toBe('number');
  expect(typeof d, `${label}: 분모가 응답에 없다`).toBe('number');
}

// ────────────────────────────────────────────────────────────────
describe('① safety/ipsg-summary — 손위생 준수율(분자·분모 둘 다 없었다)', () => {
  const svc = (hhTotal: number, hhPerformed: number) => {
    const prisma: any = {
      criticalValueAlert: { count: vi.fn().mockResolvedValue(0) },
      infectionSurveillance: { count: vi.fn().mockResolvedValue(0) },
      handHygieneObservation: {
        count: vi.fn()
          .mockResolvedValueOnce(hhTotal)      // 전체 관찰
          .mockResolvedValueOnce(hhPerformed), // 수행
      },
      fallRiskAssessment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return new PatientSafetyService(prisma, { emit: vi.fn() } as any);
  };

  it('분자(hhPerformed)·분모(hhTotal)가 함께 나온다', async () => {
    const { data } = await svc(40, 30).getIpsgSummary();
    const hh = data.ipsg5_infectionControl;
    expectPair(hh.handHygieneNumerator, hh.handHygieneDenominator, '손위생');
    expect(hh.handHygieneNumerator).toBe(30);
    expect(hh.handHygieneDenominator).toBe(40);
    expect(hh.handHygieneCompliancePct).toBe(75);
  });

  it('🔴 관찰 0건이면 준수율은 null 이고, 분자·분모는 0 으로 함께 나온다', async () => {
    const { data } = await svc(0, 0).getIpsgSummary();
    const hh = data.ipsg5_infectionControl;
    expectUnavailable(hh.handHygieneCompliancePct, '손위생 준수율');
    expectPair(hh.handHygieneNumerator, hh.handHygieneDenominator, '손위생');
  });
});

// ────────────────────────────────────────────────────────────────
describe('② qi/metrics — 입원전환율·병상가동률·진료서명률', () => {
  const svc = (over: Partial<Record<string, any>> = {}) => {
    const prisma: any = {
      waitingQueue: { findMany: vi.fn().mockResolvedValue([]) },
      encounter: { count: vi.fn().mockResolvedValue(0) },
      emergencyVisit: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      bed: { count: vi.fn().mockResolvedValue(0) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      order: { count: vi.fn().mockResolvedValue(0) },
      ...over,
    };
    return new QiService(prisma);
  };

  it('🔴 표본 0에서 모든 비율이 null 이고, 분자·분모는 함께 나온다', async () => {
    const { data } = await svc().getMetrics();
    expectUnavailable(data.emergency.admissionRate, 'ER 입원 전환율');
    expectUnavailable(data.emergency.stayOver6HoursRate, 'ER 6시간 초과 체류율');
    expectUnavailable(data.inpatient.bedOccupancyRate, '병상 가동률');
    expectUnavailable(data.inpatient.readmissionRate, '30일 재입원율');
    expectUnavailable(data.outpatient.encounterSignRate, '진료 서명률');
    expectUnavailable(data.surgery.cancellationRate, '수술 취소율');

    expectPair(data.emergency.admissionNumerator, data.emergency.admissionDenominator, '입원 전환');
    expectPair(data.emergency.stayOver6HoursNumerator, data.emergency.stayOver6HoursDenominator, '6h 초과');
    expectPair(data.inpatient.bedOccupancyNumerator, data.inpatient.bedOccupancyDenominator, '병상 가동');
    expectPair(data.inpatient.readmissionNumerator, data.inpatient.readmissionDenominator, '재입원');
    expectPair(data.outpatient.encounterSignNumerator, data.outpatient.encounterSignDenominator, '진료 서명');
    expectPair(data.surgery.cancellationNumerator, data.surgery.cancellationDenominator, '수술 취소');
  });

  it('입원 전환 분자는 disposition=ADMISSION 건수다(비율과 같은 모집단)', async () => {
    const arrival = new Date();
    const { data } = await svc({
      emergencyVisit: {
        findMany: vi.fn().mockResolvedValue([
          { arrivalAt: arrival, treatmentStartedAt: null, dispositionAt: null, disposition: 'ADMISSION', triageLevel: 'LEVEL_3' },
          { arrivalAt: arrival, treatmentStartedAt: null, dispositionAt: null, disposition: 'DISCHARGE', triageLevel: 'LEVEL_4' },
          { arrivalAt: arrival, treatmentStartedAt: null, dispositionAt: null, disposition: 'DISCHARGE', triageLevel: 'LEVEL_4' },
          { arrivalAt: arrival, treatmentStartedAt: null, dispositionAt: null, disposition: 'DISCHARGE', triageLevel: 'LEVEL_4' },
        ]),
      },
    }).getMetrics();
    expect(data.emergency.admissionNumerator).toBe(1);
    expect(data.emergency.admissionDenominator).toBe(4);
    expect(data.emergency.admissionRate).toBe(25);
  });

  it('병상 가동률의 분자는 OCCUPIED 병상 수다', async () => {
    const count = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    const { data } = await svc({ bed: { count } }).getMetrics();
    expect(data.inpatient.bedOccupancyNumerator).toBe(7);
    expect(data.inpatient.bedOccupancyDenominator).toBe(10);
    expect(data.inpatient.bedOccupancyRate).toBe(70);
  });

  it('진료 서명률의 분자는 SIGNED 건수·분모는 encounterN 과 같다', async () => {
    const count = vi.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(9);
    const { data } = await svc({ encounter: { count } }).getMetrics();
    expect(data.outpatient.encounterSignNumerator).toBe(9);
    expect(data.outpatient.encounterSignDenominator).toBe(20);
    expect(data.outpatient.encounterSignDenominator).toBe(data.outpatient.encounterN);
  });
});

// ────────────────────────────────────────────────────────────────
describe('③ flow-analytics — er.byKtas[].breachRate 의 분자', () => {
  it('stats() 는 위반 **건수**를 함께 낸다 — 목표가 없으면 분자도 null(0 이 아니다)', () => {
    const withTarget = stats([5, 10, 40, 50], 30);
    expect(withTarget.breachCount).toBe(2);
    expect(withTarget.count).toBe(4);
    expect(withTarget.breachRate).toBe(50);

    const noTarget = stats([5, 10], null);
    expect(noTarget.breachRate).toBeNull();
    expect(noTarget.breachCount, '목표가 없으면 위반 판정 자체를 하지 않는다 — 0 이 아니라 null').toBeNull();

    const empty = stats([], 30);
    expect(empty.count).toBe(0);
    expectUnavailable(empty.breachRate, '표본 0 위반율');
    expectUnavailable(empty.breachCount, '표본 0 위반건수');
  });

  it('byKtas 각 등급이 분자(breachCount)·분모(count)를 함께 낸다', async () => {
    const ar = new Date('2026-08-01T00:00:00Z');
    const prisma: any = {
      waitingQueue: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]) },
      emergencyVisit: {
        findMany: vi.fn().mockResolvedValue([
          // LEVEL_1 목표(=1분) 초과 1건 · 준수 1건
          // 🔴 준수 표본을 `+0`(도착=분류 동시 기록)으로 두지 않는다 — 그것은 "빨랐다"가 아니라
          //    **"잴 수 없다"**이고, 5단계부터 door-to-triage 분모에서 갈라진다
          //    (가드 `journey/er-door-to-triage-honesty.spec.ts`). 여기서 재는 것은 분자·분모 병기다.
          { arrivalAt: ar, triagedAt: new Date(ar.getTime() + 60 * 60000), treatmentStartedAt: null, dispositionAt: null, triageLevel: 'LEVEL_1' },
          { arrivalAt: ar, triagedAt: new Date(ar.getTime() + 30_000), treatmentStartedAt: null, dispositionAt: null, triageLevel: 'LEVEL_1' },
        ]),
      },
    };
    const res = await new JourneyAnalyticsService(prisma).getFlowAnalytics({ from: '2026-08-01', to: '2026-08-01' });
    const lv1 = res.er.byKtas.find((k) => k.level === 'LEVEL_1')!;
    expect(lv1.count).toBe(2);
    expectPair(lv1.breachCount, lv1.count, 'KTAS-1 도착→트리아지 위반');
    expect(lv1.breachCount).toBe(1);
    expect(res.er.doorToTriage.breachCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
describe('④ clinical-pathway/analytics — deviationRate 의 분자', () => {
  const svc = (assignments: any[]) => {
    const prisma: any = {
      clinicalPathway: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'CP', code: 'C1', department: '내과', totalDays: 5 }]) },
      pathwayAssignment: { findMany: vi.fn().mockResolvedValue(assignments) },
    };
    return new ClinicalPathwayService(prisma);
  };

  it('이탈률의 분자(이탈 있는 완료)·분모(완료)가 함께 나온다 — 완료율의 분모와 다르다', async () => {
    const [row] = await svc([
      { status: 'COMPLETED', deviations: 2, actualDays: 5 },
      { status: 'COMPLETED', deviations: 0, actualDays: 4 },
      { status: 'ACTIVE', deviations: 0, actualDays: null },
      { status: 'ACTIVE', deviations: 0, actualDays: null },
    ]).getAnalytics();
    expectPair(row.deviationNumerator, row.deviationDenominator, '경로 이탈');
    expect(row.deviationNumerator).toBe(1);
    expect(row.deviationDenominator).toBe(2);
    expect(row.deviationRate).toBe(50);
    // 🔴 두 비율의 분모가 다르다는 사실이 응답에 드러나야 한다
    expect(row.completionDenominator).toBe(4);
    expect(row.completionDenominator).not.toBe(row.deviationDenominator);
  });

  it('🔴 완료 표본이 없으면 이탈률은 null 이고 분자·분모는 0 으로 나온다', async () => {
    const [row] = await svc([{ status: 'ACTIVE', deviations: 0, actualDays: null }]).getAnalytics();
    expectUnavailable(row.deviationRate, '경로 이탈률');
    expectPair(row.deviationNumerator, row.deviationDenominator, '경로 이탈');
    expect(row.deviationDenominator).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
describe('⑤ executive — bedOccupancyPct/icuOccupancyPct 의 n 은 분자가 아니다', () => {
  const svc = (beds: number, occ: number, icuBeds: number, icuOcc: number) => {
    const agg = { _sum: { totalAmount: 0, paidAmount: 0, patientCopay: 0 }, _count: 0 };
    const prisma: any = {
      billing: { aggregate: vi.fn().mockResolvedValue(agg), findMany: vi.fn().mockResolvedValue([]) }, // P4-1 미수는 행 단위
      encounter: { count: vi.fn().mockResolvedValue(0) },
      bed: { count: vi.fn().mockResolvedValueOnce(beds).mockResolvedValueOnce(occ) },
      admission: { count: vi.fn().mockResolvedValue(0) },
      icuBed: { count: vi.fn().mockResolvedValue(icuBeds) },
      icuAdmission: { count: vi.fn().mockResolvedValue(icuOcc) },
    };
    return new ExecutiveService(prisma);
  };

  it('가동률 Metric 이 numerator/denominator 를 함께 낸다', async () => {
    const r = await svc(10, 8, 4, 1).getOverview();
    expectPair(r.bedOccupancyPct.numerator, r.bedOccupancyPct.denominator, '병상 가동률');
    expect(r.bedOccupancyPct).toMatchObject({ value: 80, n: 10, numerator: 8, denominator: 10 });
    expect(r.icuOccupancyPct).toMatchObject({ value: 25, n: 4, numerator: 1, denominator: 4 });
  });

  it('🔴 등록 병상 0 이면 value 는 null 이고 분자·분모는 0 으로 나온다', async () => {
    const r = await svc(0, 0, 0, 0).getOverview();
    expectUnavailable(r.bedOccupancyPct.value, '병상 가동률');
    expectUnavailable(r.icuOccupancyPct.value, 'ICU 가동률');
    expectPair(r.bedOccupancyPct.numerator, r.bedOccupancyPct.denominator, '병상 가동률');
    expectPair(r.icuOccupancyPct.numerator, r.icuOccupancyPct.denominator, 'ICU 가동률');
  });
});

// ────────────────────────────────────────────────────────────────
describe('⑥ icu/dashboard — 가동률(위젯이 읽는 값)', () => {
  const svc = (beds: { status: string }[]) => {
    const prisma: any = {
      icuBed: { findMany: vi.fn().mockResolvedValue(beds) },
      icuAdmission: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    };
    return new IcuService(prisma, {} as any);
  };

  it('🔴 등록 ICU 병상 0 이면 가동률은 0 이 아니라 null 이다', async () => {
    const r = await svc([]).getDashboard();
    expectUnavailable(r.occupancyRate, 'ICU 가동률');
    expectPair(r.occupied, r.totalBeds, 'ICU 가동률');
  });

  it('분자(occupied)·분모(totalBeds)가 응답에 함께 있다', async () => {
    const r = await svc([{ status: 'OCCUPIED' }, { status: 'AVAILABLE' }]).getDashboard();
    expect(r.occupied).toBe(1);
    expect(r.totalBeds).toBe(2);
    expect(r.occupancyRate).toBe(50);
  });
});

// ────────────────────────────────────────────────────────────────
describe('⑦ remote-consultation/stats — slaComplianceRate 의 분자', () => {
  const svc = (replied: { createdAt: Date; doctorRepliedAt: Date }[]) => {
    const prisma: any = {
      remoteConsultation: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { feeAmount: 0 } }),
        findMany: vi.fn().mockResolvedValue(replied),
      },
    };
    return new RemoteConsultationService(prisma, {} as any);
  };

  it('내부 within24h / repliedConsults.length 를 분자·분모로 노출한다', async () => {
    const t0 = new Date('2026-08-01T00:00:00Z');
    const r = await svc([
      { createdAt: t0, doctorRepliedAt: new Date(t0.getTime() + 3600_000) },       // 준수
      { createdAt: t0, doctorRepliedAt: new Date(t0.getTime() + 48 * 3600_000) },  // 위반
    ]).getDoctorStats('d1');
    expectPair(r.slaNumerator, r.slaDenominator, 'SLA 준수');
    expect(r.slaNumerator).toBe(1);
    expect(r.slaDenominator).toBe(2);
    expect(r.slaComplianceRate).toBe(50);
  });

  it('🔴 답변 표본 0 이면 준수율은 null(=100% 가 아니다)이고 분자·분모는 0 이다', async () => {
    const r = await svc([]).getDoctorStats('d1');
    expectUnavailable(r.slaComplianceRate, 'SLA 준수율');
    expect(r.slaNumerator).toBe(0);
    expect(r.slaDenominator).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
describe('⑧ voc — slaComplianceRate·reopenRate 의 분자', () => {
  const svc = (tickets: any[]) => {
    const prisma: any = {
      vocTicket: { findMany: vi.fn().mockResolvedValue(tickets) },
      consultSession: { count: vi.fn().mockResolvedValue(0) },
    };
    return new VocAdminService(prisma);
  };
  const t = (over: Partial<Record<string, any>> = {}) => ({
    type: 'COMPLAINT', status: 'OPEN', channel: 'WEB', department: null,
    dueAt: null, firstResponseAt: null, closedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'), reopenCount: 0, ratingScore: null,
    ...over,
  });

  it('내부 slaMet / slaN 을 분자·분모로 노출한다', async () => {
    const due = new Date('2026-08-02T00:00:00Z');
    const r = await svc([
      t({ dueAt: due, firstResponseAt: new Date('2026-08-01T06:00:00Z') }), // 준수
      t({ dueAt: due, firstResponseAt: new Date('2026-08-03T00:00:00Z') }), // 위반
      t({ dueAt: null }),                                                   // 기한 없음 = 분모 밖
    ]).analytics();
    expectPair(r.slaNumerator, r.slaDenominator, 'VoC SLA');
    expect(r.slaNumerator).toBe(1);
    expect(r.slaDenominator).toBe(2);
    expect(r.slaComplianceRate).toBe(50);
  });

  it('🔴 티켓 0건이면 SLA 준수율·재오픈율 둘 다 null 이고 분자·분모가 함께 나온다', async () => {
    const r = await svc([]).analytics();
    expectUnavailable(r.slaComplianceRate, 'VoC SLA 준수율');
    expectUnavailable(r.reopenRate, 'VoC 재오픈율');
    expectPair(r.slaNumerator, r.slaDenominator, 'VoC SLA');
    expectPair(r.reopenNumerator, r.reopenDenominator, 'VoC 재오픈');
  });
});
