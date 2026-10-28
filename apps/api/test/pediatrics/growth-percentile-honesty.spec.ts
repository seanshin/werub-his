import { describe, it, expect, vi } from 'vitest';
import { PediatricsService, growthPercentileBasis } from '../../src/modules/pediatrics/pediatrics.service';

/**
 * 🔴 성장 백분위(2026-10-10) — 서버는 호출자가 보낸 백분위를 근거 확인 없이 그대로 저장했다.
 *    저장소에 출처가 확인된 성장 기준표(LMS)가 없어 서버가 계산할 수 없다 → 입력을 받지 않고(400), 기존 값은 근거 미확인으로 밝힌다.
 */
const prisma = () => ({
  patient: { findUnique: vi.fn(async () => ({ dateOfBirth: null })) },
  pediatricGrowth: {
    create: vi.fn(async (a: any) => ({ id: 'g1', ...a.data })),
    findMany: vi.fn(async () => [
      { id: 'g1', weightPercentile: 55, heightPercentile: null, bmiPercentile: null },
      { id: 'g2', weightPercentile: null, heightPercentile: null, bmiPercentile: null },
    ]),
  },
});

describe('성장 백분위 — 입력받지 않는다', () => {
  it('🔴 백분위를 보내면 400 GROWTH_PERCENTILE_NOT_ACCEPTED · 저장하지 않는다(조용히 지우지도 않는다)', async () => {
    const p = prisma();
    const s = new PediatricsService(p as never);
    await expect(s.createGrowth({ patientId: 'p1', ageMonths: 12, weight: 10, weightPercentile: 50, measuredBy: 'd1' }))
      .rejects.toMatchObject({ response: { code: 'GROWTH_PERCENTILE_NOT_ACCEPTED', details: { fields: ['weightPercentile'] } } });
    await expect(s.createGrowth({ patientId: 'p1', ageMonths: 12, weight: 10, heightPercentile: 0, measuredBy: 'd1' }))
      .rejects.toMatchObject({ response: { details: { fields: ['heightPercentile'] } } });
    expect(p.pediatricGrowth.create).not.toHaveBeenCalled();
  });

  it('대조군 — 계측값만 보내면 저장 · 백분위 칸은 쓰지 않는다', async () => {
    const p = prisma();
    await new PediatricsService(p as never).createGrowth({ patientId: 'p1', ageMonths: 12, weight: 10, height: 75, measuredBy: 'd1' });
    const data = p.pediatricGrowth.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ weight: 10, height: 75 });
    expect('weightPercentile' in data || 'heightPercentile' in data || 'bmiPercentile' in data).toBe(false);
  });

  it('조회 — 저장된 백분위는 근거 미확인(UNVERIFIED) · 없으면 null', async () => {
    const rows = await new PediatricsService(prisma() as never).getGrowth('p1');
    expect(rows.map((r: any) => r.percentileBasis)).toEqual(['UNVERIFIED', null]);
    expect(growthPercentileBasis({ bmiPercentile: 0 })).toBe('UNVERIFIED'); // 0 도 값이다
  });
});

describe('BMI·월령 — 서버가 계측값과 생년월일로 대조(2026-10-10)', () => {
  const svc = (dob: Date | null) => {
    const p: any = prisma();
    p.patient.findUnique = vi.fn(async () => ({ dateOfBirth: dob }));
    return { s: new PediatricsService(p), p };
  };
  it('🔴 BMI 는 체중·신장에서 계산해 저장 — 화면이 안 보내도', async () => {
    const { s, p } = svc(null);
    await s.createGrowth({ patientId: 'p1', ageMonths: 24, weight: 12, height: 85, measuredBy: 'd' });
    expect(p.pediatricGrowth.create.mock.calls[0][0].data.bmi).toBe(16.6);
  });
  it('🔴 계측과 다른 BMI·신장 없이 온 BMI 는 거절(덮어쓰지 않는다)', async () => {
    const { s, p } = svc(null);
    await expect(s.createGrowth({ patientId: 'p1', ageMonths: 24, weight: 12, height: 85, bmi: 20, measuredBy: 'd' })).rejects.toMatchObject({ response: { code: 'GROWTH_BMI_MISMATCH' } });
    await expect(s.createGrowth({ patientId: 'p1', ageMonths: 24, weight: 12, bmi: 16, measuredBy: 'd' })).rejects.toMatchObject({ response: { code: 'GROWTH_BMI_MISMATCH' } });
    expect(p.pediatricGrowth.create).not.toHaveBeenCalled();
  });
  it('🔴 월령이 생년월일과 1개월 넘게 다르면 거절 · 대조군 맞으면 저장', async () => {
    const dob = new Date(Date.now() - 365.25 * 2 * 86_400_000); // 약 24개월
    const { s, p } = svc(dob);
    await expect(s.createGrowth({ patientId: 'p1', ageMonths: 12, weight: 12, measuredBy: 'd' })).rejects.toMatchObject({ response: { code: 'GROWTH_AGE_MISMATCH' } });
    await s.createGrowth({ patientId: 'p1', ageMonths: 24, weight: 12, measuredBy: 'd' });
    expect(p.pediatricGrowth.create).toHaveBeenCalledTimes(1);
  });
});
