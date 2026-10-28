import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { radiationDoseSummary } from '../../src/modules/radiation/radiation-dose';
import { RadiationService } from '../../src/modules/radiation/radiation.service';

/**
 * 누적선량 요약(2026-10-10) — 🔴 목록에 선량이 없고 계획 상세 EP 를 부르는 화면이 0 이라
 * 처방 대비 얼마나 조사됐는지 볼 곳이 없었다. 화면이 더하지 않게 서버가 조사 경로와 같은 규칙으로 센다.
 */
describe('radiationDoseSummary', () => {
  it('🔴 상태가 아니라 기록된 조사선량을 더한다(시드 COMPLETED 도 포함) · 기록 없는 분할은 빼고 센다', () => {
    const s = radiationDoseSummary([
      { deliveredDose: new Prisma.Decimal('1.8') }, { deliveredDose: '1.80' }, { deliveredDose: null },
    ], new Prisma.Decimal('50.40'));
    expect(s).toEqual({ deliveredGy: 3.6, recordedFractions: 2, prescribedGy: 50.4 });
  });
  it('Decimal 합 — 1.8 × 25 가 44.999… 가 아니다', () => {
    const s = radiationDoseSummary(Array.from({ length: 25 }, () => ({ deliveredDose: '1.8' })), '45');
    expect(s.deliveredGy).toBe(45);
  });
  it('🔴 처방 총선량 0/없음 → prescribedGy null(비율 산출 불가 · 0% 아님) · 조사 0건은 0Gy(사실)', () => {
    expect(radiationDoseSummary([], 0)).toEqual({ deliveredGy: 0, recordedFractions: 0, prescribedGy: null });
    expect(radiationDoseSummary([], null).prescribedGy).toBeNull();
  });
});

describe('RadiationService — 오늘 분할에 계획별 누적', () => {
  it('계획별 기록된 조사선량만 그 계획에 붙인다', async () => {
    const prisma: any = {
      radiationFraction: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { id: 'f1', planId: 'pA', plan: { totalDose: '10' } },
            { id: 'f2', planId: 'pB', plan: { totalDose: '0' } },
          ])
          .mockResolvedValueOnce([{ planId: 'pA', deliveredDose: '2' }, { planId: 'pA', deliveredDose: '2' }, { planId: 'pB', deliveredDose: '3' }]),
      },
    };
    const svc = new RadiationService(prisma);
    const r: any[] = await svc.getTodayFractions();
    expect(r[0].doseSummary).toEqual({ deliveredGy: 4, recordedFractions: 2, prescribedGy: 10 });
    expect(r[1].doseSummary).toEqual({ deliveredGy: 3, recordedFractions: 1, prescribedGy: null });
    expect(prisma.radiationFraction.findMany.mock.calls[1][0].where).toEqual({ planId: { in: ['pA', 'pB'] }, deliveredDose: { not: null } });
  });
});
