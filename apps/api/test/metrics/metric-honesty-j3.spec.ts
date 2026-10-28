import { describe, it, expect, vi } from 'vitest';

/**
 * 🔴 J3(2026-09-16) — 지표 정직성 2차. I4 와 같은 규약을 지킨다:
 *    **표본 부재는 `0` 이 아니라 null + 사유**, 그리고 **건마다 "진짜 0" 대조군**을 둔다.
 *    (관측했는데 0 인 것과 관측 자체가 없는 것은 다른 사실이다)
 *
 * 이번 라운드가 고친 자리:
 *   ① 산부인과 제왕절개율 — 분만 0건인 달에 `0%`(= 인증·QI 지표에서 **최고 성적**으로 읽힌다)
 *   ② 영양 일일요약 — 식이처방에 목표 열량이 없으면 **2000kcal 를 지어내** 분모로 썼다
 *   ③ 만족도 추이 — 점수 문항 응답 0건 분기에 평균 `0`(척도 1~5 라 어떤 실제 평가보다 나쁜 값)
 *   ④ 예약 통계 노쇼율 — 대상 0건에 `0%`
 *   ⑤ AI 도구 병상 가동률 — 등록 병상 0 에 `0%`(가동률 정본의 **세 번째** 사본이었다)
 *   (사유는 한국어 문장이 아니라 **코드**로 내려보낸다 — 서버 조립 문장 기준선 규약)
 *   ⑥ 경영 KPI 목표 — `150명`·`80%`·`7일`·`50건`·`<3%` 가 코드 상수인데 화면은 병원 목표로 그렸다
 */

describe('① 산부인과 제왕절개율 — 분만 표본', () => {
  const load = async (deliveredThisMonth: number, cesarean: number) => {
    const { ObGynService } = await import('../../src/modules/obgyn/obgyn.service');
    const prisma = {
      obGynExam: { count: vi.fn().mockResolvedValue(0) },
      deliveryRecord: {
        count: vi.fn().mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
          Promise.resolve(where?.status === 'IN_LABOR' ? 0 : deliveredThisMonth)),
        groupBy: vi.fn().mockResolvedValue(cesarean > 0 ? [{ deliveryType: 'CESAREAN', _count: { id: cesarean } }] : []),
      },
      newbornRecord: { count: vi.fn().mockResolvedValue(0) },
      // specialtyTodayStats 가 실제로 부르는 것(목은 정본의 실제 호출 모양을 쓴다)
      appointment: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new ObGynService(prisma as never);
    return svc.getStats() as Promise<Record<string, unknown>>;
  };

  it('🔴 이번달 분만 0건이면 제왕절개율은 0% 가 아니라 null + 사유', async () => {
    const r = await load(0, 0);
    expect(r.cesareanRate).toBeNull();
    expect(r.cesareanRateUnavailableReason).toBe('NO_DELIVERIES');
  });

  it('대조군 — 분만은 있고 제왕절개가 0건이면 **진짜 0%** 다(사유 없음)', async () => {
    const r = await load(10, 0);
    expect(r.cesareanRate).toBe(0);
    expect(r.cesareanRateUnavailableReason).toBeNull();
  });

  it('대조군 — 실제 비율은 그대로 계산한다', async () => {
    const r = await load(10, 3);
    expect(r.cesareanRate).toBe(30);
  });
});

describe('② 영양 일일요약 — 지어낸 목표 열량(2000kcal)', () => {
  const load = async (calorieTarget: number | null) => {
    const { NutritionAdvancedService } = await import('../../src/modules/nutrition/nutrition-advanced.service');
    const prisma = {
      dietOrder: { findFirst: vi.fn().mockResolvedValue(calorieTarget != null ? { dietType: '일반식', calorieTarget, proteinTarget: null, fluidLimit: null } : null) },
      mealOrder: { findMany: vi.fn().mockResolvedValue([{ mealType: 'LUNCH', status: 'SERVED', intakePercent: 50 }]) },
      intakeOutput: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new NutritionAdvancedService(prisma as never, {} as never);
    return svc.getDailyNutritionSummary('adm-1') as Promise<Record<string, Record<string, unknown>>>;
  };

  it('🔴 식이처방에 목표 열량이 없으면 2000kcal 를 지어내지 않는다 — 목표·추정열량·달성률 모두 null', async () => {
    const r = await load(null);
    expect(r.targets.calories).toBeNull();
    expect(r.actual.estimatedCalories).toBeNull();
    expect(r.actual.calorieRate).toBeNull();
    expect(r.actual.calorieRateUnavailableReason).toBe('NO_CALORIE_TARGET');
  });

  it('대조군 — 목표가 기재돼 있으면 그 목표로 추정·달성률을 낸다', async () => {
    const r = await load(1600);
    expect(r.targets.calories).toBe(1600);
    // LUNCH ratio 0.35 × 섭취 50% × 1600 = 280
    expect(r.actual.estimatedCalories).toBe(280);
    expect(r.actual.calorieRate).toBe(18);
    expect(r.actual.calorieRateUnavailableReason).toBeNull();
  });
});

describe('③ 만족도 추이 — 점수 문항 표본', () => {
  const load = async (rows: unknown[]) => {
    const { SatisfactionService } = await import('../../src/modules/satisfaction/satisfaction.service');
    const prisma = { surveyDispatch: { findMany: vi.fn().mockResolvedValue(rows) } };
    const svc = new SatisfactionService({} as never, prisma as never);
    return svc.getTrend('monthly');
  };

  it('🔴 응답은 있는데 점수 문항이 하나도 없으면 평균은 0 이 아니라 null', async () => {
    const r = await load([{ submittedAt: new Date('2026-05-10T00:00:00Z'), npsScore: 8, avgScore: null }]);
    expect(r[0].avgScore).toBeNull();
    expect(r[0].responseCount).toBe(1);
    expect(r[0].scoredCount).toBe(0);
  });

  it('대조군 — 점수가 있으면 평균과 분모(scoredCount)를 함께 낸다', async () => {
    const r = await load([
      { submittedAt: new Date('2026-05-10T00:00:00Z'), npsScore: 9, avgScore: 4 },
      { submittedAt: new Date('2026-05-11T00:00:00Z'), npsScore: 7, avgScore: 5 },
    ]);
    expect(r[0].avgScore).toBe(4.5);
    expect(r[0].scoredCount).toBe(2);
  });
});

describe('④ 예약 통계 노쇼율 — 내원 대상 표본', () => {
  const load = async (grouped: { status: string; n: number }[]) => {
    const { ScheduleService } = await import('../../src/modules/schedule/schedule.service');
    const prisma = {
      appointment: {
        groupBy: vi.fn().mockImplementation(({ by }: { by: string[] }) =>
          Promise.resolve(by[0] === 'status'
            ? grouped.map((g) => ({ status: g.status, _count: { _all: g.n } }))
            : [])),
      },
    };
    const svc = new ScheduleService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const r = await svc.getStats({});
    return r.data as Record<string, unknown>;
  };

  it('🔴 내원 대상이 0건(전건 취소 포함)이면 노쇼율은 0% 가 아니라 null + 사유', async () => {
    const r = await load([{ status: 'CANCELLED', n: 3 }]);
    expect(r.noShowRate).toBeNull();
    expect(r.noShowDenominator).toBe(0);
    expect(r.noShowRateUnavailableReason).toBe('NO_VISIT_TARGET');
  });

  it('대조군 — 대상이 있고 노쇼가 0건이면 **진짜 0%**', async () => {
    const r = await load([{ status: 'COMPLETED', n: 10 }]);
    expect(r.noShowRate).toBe(0);
    expect(r.noShowRateUnavailableReason).toBeNull();
  });

  it('대조군 — 실제 노쇼율은 취소를 분모에서 뺀 값으로 낸다', async () => {
    const r = await load([{ status: 'COMPLETED', n: 6 }, { status: 'NO_SHOW', n: 2 }, { status: 'CANCELLED', n: 2 }]);
    expect(r.noShowRate).toBe(25); // 2 / (10-2)
    expect(r.noShowDenominator).toBe(8);
  });
});

describe('⑤ AI 도구 병상 가동률 — 등록 병상 표본(가동률 정본의 세 번째 사본이었다)', () => {
  const run = async (beds: { status: string }[]) => {
    const { createEnterpriseTools } = await import('../../src/modules/orchestrator/enterprise-tools');
    const prisma = {
      encounter: { count: vi.fn().mockResolvedValue(3) },
      bed: { findMany: vi.fn().mockResolvedValue(beds) },
      admission: { count: vi.fn().mockResolvedValue(1) },
      icuAdmission: { count: vi.fn().mockResolvedValue(0) },
    };
    const tool = createEnterpriseTools(prisma as never).find((t) => t.name === 'KPI_DASHBOARD');
    expect(tool, 'KPI_DASHBOARD 도구를 찾지 못했다').toBeTruthy();
    return tool!.execute({}, {} as never);
  };

  it('🔴 등록 병상 0 이면 가동률은 0% 가 아니라 null — 요약 문장도 0% 라 말하지 않는다', async () => {
    const r = await run([]);
    expect((r.data as Record<string, unknown>).rate).toBeNull();
    expect(r.summary).toContain('산출 불가');
    expect(r.summary).not.toContain('(0%)');
  });

  it('대조군 — 병상이 있고 아무도 안 쓰면 **진짜 0%**', async () => {
    const r = await run([{ status: 'AVAILABLE' }, { status: 'AVAILABLE' }]);
    expect((r.data as Record<string, unknown>).rate).toBe(0);
    expect(r.summary).toContain('(0%)');
  });
});

describe('⑥ 경영 KPI 목표 — 코드 상수를 병원 목표로 그리지 않는다', () => {
  const load = async (targets: Record<string, unknown> | null) => {
    const { ExecutiveService } = await import('../../src/modules/executive/executive.service');
    const prisma = {
      encounter: { count: vi.fn().mockResolvedValue(30) },
      bed: { count: vi.fn().mockResolvedValue(10) },
      admission: { count: vi.fn().mockResolvedValue(4), findMany: vi.fn().mockResolvedValue([]) },
      surgery: { count: vi.fn().mockResolvedValue(7) },
      claim: { aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { claimedAmount: 0, reducedAmount: 0 } }) },
    };
    const configRuntime = targets
      ? { getWithSource: vi.fn().mockImplementation((k: string) => Promise.resolve(
          targets[k] != null ? { value: targets[k], source: 'db', registered: true } : { value: null, source: 'default', registered: true })) }
      : undefined;
    const svc = new ExecutiveService(prisma as never, configRuntime as never);
    return svc.getKpi();
  };

  it('🔴 목표가 설정돼 있지 않으면 목표는 "미설정"이고 달성률을 만들지 않는다', async () => {
    const kpis = await load(null);
    const outpatient = kpis.find((k) => k.name === '일평균 외래환자')!;
    expect(outpatient.target).toBe('미설정');
    expect(outpatient.rate).toBeNull();
    expect(String(outpatient.note)).toContain('목표 미설정');
    // 종전 상수들이 화면에 남아 있지 않다
    expect(kpis.map((k) => k.target)).not.toContain('150명');
    expect(kpis.map((k) => k.target)).not.toContain('80%');
  });

  it('🔴 코드 기본값(source!=="db")은 목표로 인정하지 않는다', async () => {
    const kpis = await load({}); // 전 키가 source:'default'
    expect(kpis.every((k) => k.name === '입원환자' || k.target === '미설정')).toBe(true);
  });

  it('대조군 — 원내가 정한 목표가 있으면 그 목표로 달성률을 낸다', async () => {
    const kpis = await load({ 'exec.target.monthlySurgeries': 10 });
    const surgery = kpis.find((k) => k.name === '수술건수/월')!;
    expect(surgery.target).toBe('10건');
    expect(surgery.rate).toBe(70); // 7 / 10
    expect(surgery.note).toBeUndefined();
  });
});
