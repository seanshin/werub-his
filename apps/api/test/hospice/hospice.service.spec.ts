import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { HospiceService } from '../../src/modules/hospice/hospice.service';

describe('HospiceService', () => {
  let service: HospiceService;
  let mockPrisma: any;

  const mockReg = { id: 'hr-1', patientId: 'p-1', status: 'ACTIVE', ppsScore: 40 };

  beforeEach(() => {
    mockPrisma = {
      hospiceRegistration: {
        create: vi.fn().mockResolvedValue(mockReg),
        findMany: vi.fn().mockResolvedValue([mockReg]),
        findUnique: vi.fn().mockResolvedValue(mockReg),
        update: vi.fn().mockResolvedValue({ ...mockReg, status: 'DISCHARGED' }),
        // 🔴 (D1) 상태 전이는 조건부 updateMany(where status=현재)로 쓴다 — 목도 그 모양을 따른다
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(10),
      },
      hospiceSymptomAssessment: {
        create: vi.fn().mockResolvedValue({ id: 'ha-1', totalScore: 30 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      advanceDirective: {
        create: vi.fn().mockResolvedValue({ id: 'ad-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'ad-1', status: 'ACTIVE' }),
        update: vi.fn().mockResolvedValue({ id: 'ad-1', status: 'REVOKED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hospiceCareConference: {
        create: vi.fn().mockResolvedValue({ id: 'hc-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    service = new HospiceService(mockPrisma);
  });

  describe('register', () => {
    it('호스피스 등록', async () => {
      const result = await service.register({
        patientId: 'p-1', registeredBy: 'doc-1', ppsScore: 40,
        primaryDiagnosis: '폐암 말기', hospiceType: 'INPATIENT',
      });
      expect(result.ppsScore).toBe(40);
    });
  });

  describe('getRegistration', () => {
    it('등록 상세 조회', async () => {
      await service.getRegistration('hr-1');
      expect(mockPrisma.hospiceRegistration.findUnique).toHaveBeenCalled();
    });

    it('존재하지 않는 등록', async () => {
      mockPrisma.hospiceRegistration.findUnique.mockResolvedValue(null);
      await expect(service.getRegistration('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('DISCHARGED 시 dischargedAt = 입력한 퇴원 시각', async () => {
      await service.updateStatus('hr-1', 'DISCHARGED', '2026-10-09T03:00:00Z');
      expect(mockPrisma.hospiceRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'hr-1', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'DISCHARGED', dischargedAt: new Date('2026-10-09T03:00:00Z') }),
      }));
    });

    it('DECEASED 시 deceasedAt = 입력한 사망 시각', async () => {
      await service.updateStatus('hr-1', 'DECEASED', '2026-10-09T03:00:00Z');
      expect(mockPrisma.hospiceRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'DECEASED', deceasedAt: new Date('2026-10-09T03:00:00Z') }),
      }));
    });

    it('🔴 사망·퇴원 시각을 모르면 기록하지 않는다 · 미래·등록 이전 거절(2026-10-10 — 종전 버튼 누른 시각)', async () => {
      await expect(service.updateStatus('hr-1', 'DECEASED')).rejects.toMatchObject({ response: { code: 'HOSPICE_OCCURRED_AT_REQUIRED' } });
      await expect(service.updateStatus('hr-1', 'DECEASED', new Date(Date.now() + 3_600_000).toISOString())).rejects.toMatchObject({ response: { code: 'HOSPICE_OCCURRED_AT_FUTURE' } });
      mockPrisma.hospiceRegistration.findUnique.mockResolvedValue({ status: 'ACTIVE', registeredAt: new Date('2026-10-05T00:00:00Z') });
      await expect(service.updateStatus('hr-1', 'DISCHARGED', '2026-10-01T00:00:00Z')).rejects.toMatchObject({ response: { code: 'HOSPICE_OCCURRED_AT_BEFORE_REGISTRATION' } });
      expect(mockPrisma.hospiceRegistration.updateMany).not.toHaveBeenCalled();
    });

    it('🔴 연명의료계획서는 의사만 · 작성 의사는 로그인한 의사(본문 doctorId 무시) · 의향서는 의사를 붙이지 않는다', async () => {
      mockPrisma.advanceDirective = { create: vi.fn(async (a: any) => a.data) };
      await expect(service.createDirective({ patientId: 'p1', documentType: 'POLST' }, { id: 'n1', role: 'NURSE' })).rejects.toMatchObject({ response: { code: 'POLST_DOCTOR_ONLY' } });
      const polst: any = await service.createDirective({ patientId: 'p1', documentType: 'POLST', doctorId: 'someone' }, { id: 'd1', role: 'DOCTOR' });
      expect(polst.doctorId).toBe('d1');
      const ad: any = await service.createDirective({ patientId: 'p1', documentType: 'AD', doctorId: 'someone' }, { id: 'n1', role: 'NURSE' });
      expect(ad.doctorId).toBeNull();
    });
  });

  describe('createAssessment', () => {
    it('ESAS 증상 평가 — 총점 자동 계산', async () => {
      await service.createAssessment({
        registrationId: 'hr-1', assessorId: 'nurse-1',
        pain: 5, tiredness: 3, nausea: 2, depression: 4,
        anxiety: 3, drowsiness: 2, appetite: 6, wellbeing: 4,
        shortnessOfBreath: 3, otherScore: 2,
      });
      expect(mockPrisma.hospiceSymptomAssessment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ totalScore: 34 }),
      }));
    });
  });

  describe('사전의료의향서', () => {
    it('의향서 생성', async () => {
      await service.createDirective({ patientId: 'p-1', documentType: 'AD', cprDecision: 'DNR' });
      expect(mockPrisma.advanceDirective.create).toHaveBeenCalled();
    });

    it('의향서 철회', async () => {
      await service.revokeDirective('ad-1', '환자 본인 철회', 'u-1');
      expect(mockPrisma.advanceDirective.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'REVOKED', revokedAt: expect.any(Date) }),
      }));
    });
  });

  describe('돌봄 회의', () => {
    it('회의 기록', async () => {
      await service.createConference({
        registrationId: 'hr-1', facilitatorId: 'doc-1',
        conferenceType: 'INITIAL', attendees: ['doc-1', 'nurse-1'],
        careGoals: '통증 관리',
      });
      expect(mockPrisma.hospiceCareConference.create).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('통계 반환', async () => {
      mockPrisma.hospiceRegistration.count
        .mockResolvedValueOnce(5)  // active
        .mockResolvedValueOnce(20) // total
        .mockResolvedValueOnce(3); // deceased
      const result = await service.getStats();
      expect(result).toEqual({ active: 5, total: 20, deceased: 3, discharged: 12 });
    });
  });
});
