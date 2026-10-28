import { describe, it, expect, vi } from 'vitest';

/**
 * 🔴 I4(2026-09-16) — 표본 부재를 `0` 으로 말하지 않는다. **건마다 "진짜 0" 대조군을 둔다.**
 *    (관측했는데 0 인 것과, 관측 자체가 없는 것은 다른 사실이다 — 전자는 0, 후자는 null+사유)
 */

const nowMinus = (min: number) => new Date(Date.now() - min * 60_000);

describe('응급 분석 — 평균·비율의 표본 부재', () => {
  const load = async (visits: unknown[]) => {
    const { EmergencyService } = await import('../../src/modules/emergency/emergency.service');
    const prisma = { emergencyVisit: { findMany: vi.fn().mockResolvedValue(visits) } };
    const svc = new EmergencyService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    return svc.getEmergencyAnalytics();
  };

  it('🔴 방문 0건이면 평균·비율은 0 이 아니라 null + 사유', async () => {
    const r = await load([]);
    expect(r.avgWaitingTime).toBeNull();
    expect(r.avgTreatmentTime).toBeNull();
    expect(r.dischargeRate).toBeNull();
    expect(r.admissionRate).toBeNull();
    expect(r.rateDenominator).toBe(0);
    expect(r.unavailableReason).toContain('0건');
  });

  it('🔴 `avgWaitingTime` 은 상수 0 이 아니라 도착→진료시작으로 실제로 잰다', async () => {
    const r = await load([
      { arrivalAt: nowMinus(60), treatmentStartedAt: nowMinus(40), dispositionAt: null, disposition: null, triageLevel: 'KTAS3', admissionId: null },
      { arrivalAt: nowMinus(30), treatmentStartedAt: nowMinus(20), dispositionAt: null, disposition: null, triageLevel: 'KTAS3', admissionId: null },
    ]);
    expect(r.avgWaitingTime).toBe(15); // (20 + 10) / 2
    expect(r.waitingSampleN).toBe(2);
  });

  it('대조군 — 진료가 시작된 건이 없으면(전원 대기 중) 대기 평균만 null, 방문 수는 그대로', async () => {
    const r = await load([
      { arrivalAt: nowMinus(10), treatmentStartedAt: null, dispositionAt: null, disposition: null, triageLevel: 'KTAS4', admissionId: null },
    ]);
    expect(r.avgWaitingTime).toBeNull();
    expect(r.waitingSampleN).toBe(0);
    expect(r.totalPatients).toBe(1);
  });

  it('대조군 — 관측된 0%(퇴원 0건이지만 방문은 있음)는 null 이 아니라 0 이다', async () => {
    const r = await load([
      { arrivalAt: nowMinus(90), treatmentStartedAt: nowMinus(60), dispositionAt: nowMinus(30), disposition: 'TRANSFER', triageLevel: 'KTAS2', admissionId: null },
    ]);
    expect(r.dischargeRate).toBe(0);
    expect(r.rateDenominator).toBe(1);
    expect(r.unavailableReason).toBeNull();
  });
});

describe('컨시어지 만족도 — 평가 0건', () => {
  const load = async (sessions: unknown[]) => {
    const { ConciergeService } = await import('../../src/modules/concierge/concierge.service');
    const prisma = { conciergeSession: { findMany: vi.fn().mockResolvedValue(sessions) } };
    const svc = Object.create(ConciergeService.prototype) as { prisma: unknown; getRatingStats: () => Promise<{ average: number | null; count: number; unavailableReason?: string | null }> };
    (svc as { prisma: unknown }).prisma = prisma;
    return svc.getRatingStats();
  };

  it('🔴 평가가 없으면 평균은 0(=최악)이 아니라 null + 사유 — 척도는 1~5 다', async () => {
    const r = await load([]);
    expect(r.average).toBeNull();
    expect(r.count).toBe(0);
    expect(r.unavailableReason).toContain('표본 0');
  });

  it('대조군 — 평가가 있으면 평균을 낸다', async () => {
    const r = await load([{ rating: 4 }, { rating: 5 }]);
    expect(r.average).toBe(4.5);
    expect(r.count).toBe(2);
    expect(r.unavailableReason).toBeNull();
  });
});

describe('EPA 달성률 — 목표 정본이 없으면 만들지 않는다', () => {
  const load = async (rows: unknown[]) => {
    const { EducationService } = await import('../../src/modules/education/education.service');
    const prisma = { epaAssessment: { findMany: vi.fn().mockResolvedValue(rows) } };
    const svc = Object.create(EducationService.prototype) as {
      prisma: unknown;
      getEpaStatus: (u: string) => Promise<{ overallProgress: number | null; overallProgressUnavailableReason: string; epas: Record<string, unknown>[] }>;
    };
    (svc as { prisma: unknown }).prisma = prisma;
    return svc.getEpaStatus('u1');
  };

  it('🔴 목표 레벨은 스키마에 없다 — 지어낸 목표(5)로 달성률을 만들지 않는다', async () => {
    const r = await load([{ epaNumber: 'EPA-1', epaTitle: '입원 관리', entrustmentLevel: 3 }]);
    expect(r.overallProgress).toBeNull();
    expect(r.overallProgressUnavailableReason).toContain('목표');
    // 지어낸 목표 필드가 응답에 실리지 않는다
    expect(r.epas[0]).not.toHaveProperty('targetLevel');
  });

  it('대조군 — 기록된 사실(현재 레벨·평가 횟수)은 그대로 낸다', async () => {
    const r = await load([
      { epaNumber: 'EPA-1', epaTitle: '입원 관리', entrustmentLevel: 2 },
      { epaNumber: 'EPA-1', epaTitle: '입원 관리', entrustmentLevel: 4 },
    ]);
    expect(r.epas[0].currentLevel).toBe(4);
    expect(r.epas[0].assessmentCount).toBe(2);
  });

  it('평가가 0건인 것과 목표가 없는 것을 사유로 구분한다', async () => {
    const r = await load([]);
    expect(r.overallProgress).toBeNull();
    expect(r.overallProgressUnavailableReason).toContain('표본 0');
  });
});
