import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurgeryAdvancedService } from '../../src/modules/surgery/surgery-advanced.service';

describe('마취전평가 게이트 (R2-2)', () => {
  let service: SurgeryAdvancedService;
  let mockPrisma: any;

  const fullEval = {
    id: 'pa-1', surgeryId: 's-1', status: 'DRAFT',
    asaClass: '2', airwayMallampati: 'II', npoConfirmed: true,
    labsReviewed: true, anesthesiaConsent: true, plan: 'GENERAL',
  };

  beforeEach(() => {
    mockPrisma = {
      surgery: { findUnique: vi.fn().mockResolvedValue({ id: 's-1', patientId: 'p-1' }) },
      preAnesthesiaEvaluation: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
      },
      surgicalChecklist: {
        findUnique: vi.fn().mockResolvedValue({ id: 'cl-1', surgeryId: 's-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    service = new SurgeryAdvancedService(mockPrisma, { get: vi.fn().mockResolvedValue('true') } as any);
  });

  it('완료된 평가는 수정 불가', async () => {
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue({ ...fullEval, status: 'COMPLETED' });
    await expect(service.upsertPreAnesthesia('s-1', {}, 'dr-1')).rejects.toThrow(/수정할 수 없습니다/);
  });

  it('필수 6요소 미완이면 완료 거부 (PRE_ANES_INCOMPLETE + 누락 목록)', async () => {
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue({ ...fullEval, npoConfirmed: false, plan: null });
    await expect(service.completePreAnesthesia('s-1', 'dr-1')).rejects.toMatchObject({
      response: { code: 'PRE_ANES_INCOMPLETE', missing: expect.arrayContaining(['금식(NPO) 확인', '마취 계획']) },
    });
  });

  it('필수 충족 시 COMPLETED 전환', async () => {
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue(fullEval);
    await service.completePreAnesthesia('s-1', 'dr-1');
    expect(mockPrisma.preAnesthesiaEvaluation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
    }));
  });

  it('게이트 ON: 평가 미완이면 sign-in 차단 (PRE_ANESTHESIA_REQUIRED)', async () => {
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue({ status: 'DRAFT' });
    await expect(service.updateChecklist('s-1', 'signIn', { signInPatientId: true }, 'u-1')).rejects.toMatchObject({
      response: { code: 'PRE_ANESTHESIA_REQUIRED' },
    });
  });

  it('게이트 ON: 평가 COMPLETED면 sign-in 진행', async () => {
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue({ status: 'COMPLETED' });
    await service.updateChecklist('s-1', 'signIn', { signInPatientId: true }, 'u-1');
    expect(mockPrisma.surgicalChecklist.update).toHaveBeenCalled();
  });

  it('게이트 OFF(기본): 평가 없어도 sign-in 진행 (하위호환)', async () => {
    const offSvc = new SurgeryAdvancedService(mockPrisma, { get: vi.fn().mockResolvedValue(null) } as any);
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue(null);
    await offSvc.updateChecklist('s-1', 'signIn', { signInPatientId: true }, 'u-1');
    expect(mockPrisma.surgicalChecklist.update).toHaveBeenCalled();
  });

  it('timeOut 단계는 게이트 미적용', async () => {
    mockPrisma.preAnesthesiaEvaluation.findUnique.mockResolvedValue(null);
    await service.updateChecklist('s-1', 'timeOut', { timeOutTeamIntro: true }, 'u-1');
    expect(mockPrisma.surgicalChecklist.update).toHaveBeenCalled();
  });
});
