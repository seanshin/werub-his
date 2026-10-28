import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TransplantService } from '../../src/modules/transplant/transplant.service';

describe('TransplantService', () => {
  let service: TransplantService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      transplantWaitlist: {
        create: vi.fn().mockResolvedValue({ id: 'wl-1', organType: 'KIDNEY', status: 'WAITING' }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'wl-1', patientId: 'p-1', organType: 'KIDNEY', bloodType: 'A' }),
        update: vi.fn().mockResolvedValue({ id: 'wl-1', status: 'MATCHED' }),
      },
      transplantDonor: {
        create: vi.fn().mockResolvedValue({ id: 'td-1', donorType: 'LIVING' }),
        findMany: vi.fn().mockResolvedValue([]),
        // 기본 적합 기증자: 승인·KIDNEY·A형·교차 음성
        findUnique: vi.fn().mockResolvedValue({ id: 'td-1', status: 'APPROVED', organType: 'KIDNEY', bloodType: 'A', crossmatchResult: 'NEGATIVE' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'td-1', crossmatchResult: 'NEGATIVE' }),
      },
      transplantRecord: {
        create: vi.fn().mockResolvedValue({ id: 'tr-1', organType: 'KIDNEY' }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'tr-1', organType: 'KIDNEY', rejectionEvents: [] }),
      },
      transplantRejection: {
        create: vi.fn().mockResolvedValue({ id: 're-1' }),
        update: vi.fn().mockResolvedValue({ id: 're-1' }),
      },
      patientBloodTyping: { findUnique: vi.fn().mockResolvedValue({ abo: 'A' }) },
      // 기본: 수혈자 결속 교차시험 NEGATIVE·유효기간 내
      transplantCrossmatch: {
        findFirst: vi.fn().mockResolvedValue({ result: 'NEGATIVE', validUntil: new Date('2099-01-01') }),
        create: vi.fn().mockResolvedValue({ id: 'xm-1', validUntil: new Date('2099-01-01') }),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(mockPrisma)),
    };
    service = new TransplantService(mockPrisma);
  });

  describe('addToWaitlist', () => {
    it('대기자 등록', async () => {
      const result = await service.addToWaitlist({ patientId: 'p-1', organType: 'KIDNEY', bloodType: 'A' });
      expect(result.organType).toBe('KIDNEY');
    });
  });

  describe('getWaitlist', () => {
    it('필터 적용', async () => {
      await service.getWaitlist('KIDNEY', 'WAITING');
      expect(mockPrisma.transplantWaitlist.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organType: 'KIDNEY', status: 'WAITING' },
      }));
    });
  });

  describe('updateWaitlistStatus', () => {
    it('MATCHED 시 matchedAt 기록', async () => {
      await service.updateWaitlistStatus('wl-1', 'MATCHED');
      expect(mockPrisma.transplantWaitlist.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'MATCHED', matchedAt: expect.any(Date) }),
      }));
    });

    it('REMOVED 시 removedAt + 사유', async () => {
      await service.updateWaitlistStatus('wl-1', 'REMOVED', '환자 사망');
      expect(mockPrisma.transplantWaitlist.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'REMOVED', removedAt: expect.any(Date), removeReason: '환자 사망' }),
      }));
    });
  });

  describe('registerDonor', () => {
    it('기증자 등록', async () => {
      const result = await service.registerDonor({
        donorType: 'LIVING', bloodType: 'A', organType: 'KIDNEY', donorName: '김기증',
      });
      expect(result.donorType).toBe('LIVING');
    });
  });

  describe('updateCrossmatch', () => {
    it('교차시험 결과 저장', async () => {
      await service.updateCrossmatch('td-1', 'NEGATIVE');
      expect(mockPrisma.transplantDonor.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ crossmatchResult: 'NEGATIVE', crossmatchDate: expect.any(Date) }),
      }));
    });
    it('recipientId 지정 시 수혈자 결속 기록 생성', async () => {
      await service.updateCrossmatch('td-1', 'NEGATIVE', 'p-1');
      expect(mockPrisma.transplantCrossmatch.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ donorId: 'td-1', recipientId: 'p-1', result: 'NEGATIVE', validUntil: expect.any(Date) }),
      }));
    });
  });

  describe('recordCrossmatch', () => {
    it('recipientId 없으면 거부', async () => {
      await expect(service.recordCrossmatch('td-1', {})).rejects.toThrow();
    });
    it('finalResult INCOMPATIBLE → POSITIVE 결속 저장', async () => {
      await service.recordCrossmatch('td-1', { recipientId: 'p-1', finalResult: 'INCOMPATIBLE' }, 'doc-1');
      expect(mockPrisma.transplantCrossmatch.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ donorId: 'td-1', recipientId: 'p-1', result: 'POSITIVE' }),
      }));
    });
    // 🔴 (2026-09-15 B6) 종전 `finalResult ?? 'COMPATIBLE'` → 판정 없는 기록이 NEGATIVE 로 저장돼 이식 적합성 게이트를 열었다
    it('🔴 판정(finalResult) 없으면 400 — 음성으로 저장하지 않는다(교차시험·기증자 둘 다 쓰지 않음)', async () => {
      await expect(service.recordCrossmatch('td-1', { recipientId: 'p-1' }, 'doc-1')).rejects.toThrow(/finalResult/);
      expect(mockPrisma.transplantCrossmatch.create).not.toHaveBeenCalled();
      expect(mockPrisma.transplantDonor.update).not.toHaveBeenCalled();
    });
    it('대조군 — COMPATIBLE 판정은 NEGATIVE 로 저장된다', async () => {
      await service.recordCrossmatch('td-1', { recipientId: 'p-1', finalResult: 'COMPATIBLE' }, 'doc-1');
      expect(mockPrisma.transplantCrossmatch.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: 'NEGATIVE' }),
      }));
    });
  });

  describe('createTransplant', () => {
    const args = { recipientId: 'p-1', donorId: 'td-1', waitlistId: 'wl-1', organType: 'KIDNEY', transplantDate: '2026-05-29', surgeonId: 'doc-1' };

    it('적합 시나리오 — 이식 기록 생성 + 대기자 TRANSPLANTED + 기증자 원자 전이', async () => {
      await service.createTransplant(args);
      expect(mockPrisma.transplantRecord.create).toHaveBeenCalled();
      expect(mockPrisma.transplantWaitlist.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'TRANSPLANTED' }) }));
      expect(mockPrisma.transplantDonor.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'td-1', status: 'APPROVED' }, data: { status: 'DONATED' } }));
    });

    it('[P0] ABO 부적합 차단(O 수혈자 ← A 기증)', async () => {
      mockPrisma.transplantWaitlist.findUnique.mockResolvedValue({ id: 'wl-1', patientId: 'p-1', bloodType: 'O', organType: 'KIDNEY' });
      mockPrisma.patientBloodTyping.findUnique.mockResolvedValue({ abo: 'O' });
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });

    it('[P1] wrong-patient 결속 차단(waitlist 환자≠recipientId)', async () => {
      // 다른 환자의 waitlist(AB형)로 O 수혈자에 AB 기증을 통과시키려는 시도 차단
      mockPrisma.transplantWaitlist.findUnique.mockResolvedValue({ id: 'wl-1', patientId: 'OTHER', bloodType: 'AB', organType: 'KIDNEY' });
      mockPrisma.patientBloodTyping.findUnique.mockResolvedValue({ abo: 'O' });
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });

    it('[P1] 대기자·환자 혈액형 불일치 차단', async () => {
      mockPrisma.transplantWaitlist.findUnique.mockResolvedValue({ id: 'wl-1', patientId: 'p-1', bloodType: 'AB', organType: 'KIDNEY' });
      mockPrisma.patientBloodTyping.findUnique.mockResolvedValue({ abo: 'O' });
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });

    it('[P0] 교차시험 양성 차단(수혈자 결속 기록)', async () => {
      mockPrisma.transplantCrossmatch.findFirst.mockResolvedValue({ result: 'POSITIVE', validUntil: new Date('2099-01-01') });
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });

    it('[P1] 수혈자 결속 교차시험 없으면 차단(donor 전역 NEGATIVE 무시)', async () => {
      mockPrisma.transplantCrossmatch.findFirst.mockResolvedValue(null);
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });

    it('[P1] 교차시험 유효기간 경과 차단', async () => {
      mockPrisma.transplantCrossmatch.findFirst.mockResolvedValue({ result: 'NEGATIVE', validUntil: new Date('2000-01-01') });
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });

    it('[P0] 장기 유형 불일치·미승인 기증자 차단', async () => {
      mockPrisma.transplantDonor.findUnique.mockResolvedValue({ id: 'td-1', status: 'REGISTERED', organType: 'LIVER', bloodType: 'A', crossmatchResult: 'NEGATIVE' });
      await expect(service.createTransplant(args)).rejects.toMatchObject({ response: { code: 'TRANSPLANT_INCOMPATIBLE' } });
    });
  });

  describe('getTransplantDetail', () => {
    it('이식 상세 조회', async () => {
      const result = await service.getTransplantDetail('tr-1');
      expect(result.organType).toBe('KIDNEY');
    });

    it('존재하지 않는 기록', async () => {
      mockPrisma.transplantRecord.findUnique.mockResolvedValue(null);
      await expect(service.getTransplantDetail('x')).rejects.toThrow(NotFoundException);
    });
  });
});
