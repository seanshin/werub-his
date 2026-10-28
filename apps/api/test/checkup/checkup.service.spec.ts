import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CheckupService } from '../../src/modules/checkup/checkup.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CheckupService', () => {
  let service: CheckupService;
  let mockPrisma: any;
  let mockAdapter: any;

  const mockProgram = {
    id: 'prog-1', code: 'CK-A01', name: '종합검진A', category: 'GENERAL',
    price: 500000, discountRate: 0, isActive: true, duration: 180,
    items: [
      { seq: 1, category: 'LAB', name: '혈액검사', codes: ['L001'] },
      { seq: 2, category: 'IMAGING', name: '흉부 X-ray', codes: ['I001'] },
      { seq: 3, category: 'PHYSICAL', name: '신체계측', codes: ['P001'] },
      { seq: 4, category: 'CONSULT', name: '의사 상담', codes: ['C001'] },
    ],
    options: [
      { id: 'opt-1', name: '초음파', category: 'IMAGING', price: 80000 },
    ],
  };

  const mockVisit = {
    id: 'visit-1', patientId: 'pat-1', programId: 'prog-1', status: 'RESERVED',
    scheduledDate: new Date(), totalPrice: 500000, selectedOptions: [],
    checkedInAt: null, completedAt: null,
    program: mockProgram,
    patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자', gender: 'MALE', dateOfBirth: new Date('1990-01-01') },
    items: [],
    summary: null, interpretations: [], referrals: [], followUps: [],
  };

  beforeEach(() => {
    mockPrisma = {
      // 트랜잭션 도입(2026-07 tx 경계 전수) — 콜백에 같은 목을 넘겨 기존 검증을 유지
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
      checkupProgram: { findUnique: vi.fn() },
      checkupContract: { findUnique: vi.fn() },
      checkupVisit: {
        create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
        count: vi.fn(), update: vi.fn(),
      },
      checkupResultItem: {
        create: vi.fn(), createMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn(), findMany: vi.fn(),
        update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn().mockResolvedValue(0),
      },
      checkupSummary: {
        create: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
      },
      checkupInterpretation: {
        create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
        update: vi.fn(),
      },
      checkupFollowUp: {
        create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
        update: vi.fn(),
      },
      checkupReferral: { create: vi.fn() },
      // 🔴 목에 없는 모델이 결함을 숨긴다 — `resolveAnalytes` 가 검사항목 마스터를 읽는다.
      //    정본의 select 모양(code·name·unit·referenceRange)을 그대로 돌려준다.
      checkupTestMaster: {
        findMany: vi.fn().mockResolvedValue([
          { code: 'L001', name: '혈액검사', unit: null, referenceRange: null },
          { code: 'I001', name: '흉부 X-ray', unit: null, referenceRange: null },
          { code: 'P001', name: '신체계측', unit: null, referenceRange: null },
          { code: 'C001', name: '의사 상담', unit: null, referenceRange: null },
        ]),
      },
      encounter: { create: vi.fn() },
      user: { findFirst: vi.fn(), findUnique: vi.fn() },
      billing: { create: vi.fn() },
      labResult: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      imagingResult: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    };
    mockAdapter = {};
    const mockEventEmitter = { emit: vi.fn() } as any;
    service = new CheckupService(mockPrisma, mockAdapter, mockEventEmitter);
  });

  // ═══════════════════════════════════════════
  // createVisit
  // ═══════════════════════════════════════════

  describe('createVisit', () => {
    it('should create visit with calculated price', async () => {
      mockPrisma.checkupProgram.findUnique.mockResolvedValue(mockProgram);
      mockPrisma.checkupVisit.create.mockResolvedValue({
        id: 'visit-1', totalPrice: 500000, ...mockVisit,
      });

      const result = await service.createVisit({
        patientId: 'pat-1', programId: 'prog-1',
        scheduledDate: '2026-06-01',
      });

      expect(mockPrisma.checkupVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalPrice: 500000 }),
        }),
      );
      expect(result.id).toBe('visit-1');
    });

    it('should apply discount rate', async () => {
      mockPrisma.checkupProgram.findUnique.mockResolvedValue({
        ...mockProgram, discountRate: 10,
      });
      mockPrisma.checkupVisit.create.mockResolvedValue({ id: 'v-2', totalPrice: 450000 });

      await service.createVisit({
        patientId: 'pat-1', programId: 'prog-1', scheduledDate: '2026-06-01',
      });

      expect(mockPrisma.checkupVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalPrice: 450000 }),
        }),
      );
    });

    it('should add selected option prices', async () => {
      mockPrisma.checkupProgram.findUnique.mockResolvedValue(mockProgram);
      mockPrisma.checkupVisit.create.mockResolvedValue({ id: 'v-3', totalPrice: 580000 });

      await service.createVisit({
        patientId: 'pat-1', programId: 'prog-1',
        scheduledDate: '2026-06-01', selectedOptions: ['opt-1'],
      });

      expect(mockPrisma.checkupVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalPrice: 580000 }),
        }),
      );
    });

    it('should apply contract discount', async () => {
      mockPrisma.checkupProgram.findUnique.mockResolvedValue(mockProgram);
      mockPrisma.checkupContract.findUnique.mockResolvedValue({
        id: 'ct-1', discountRate: 20,
      });
      mockPrisma.checkupVisit.create.mockResolvedValue({ id: 'v-4', totalPrice: 400000 });

      await service.createVisit({
        patientId: 'pat-1', programId: 'prog-1',
        scheduledDate: '2026-06-01', contractId: 'ct-1',
      });

      expect(mockPrisma.checkupVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalPrice: 400000 }),
        }),
      );
    });

    it('should throw NotFoundException for missing program', async () => {
      mockPrisma.checkupProgram.findUnique.mockResolvedValue(null);
      await expect(service.createVisit({
        patientId: 'pat-1', programId: 'bad', scheduledDate: '2026-06-01',
      })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for inactive program', async () => {
      mockPrisma.checkupProgram.findUnique.mockResolvedValue({
        ...mockProgram, isActive: false,
      });
      await expect(service.createVisit({
        patientId: 'pat-1', programId: 'prog-1', scheduledDate: '2026-06-01',
      })).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════
  // findVisits
  // ═══════════════════════════════════════════

  describe('findVisits', () => {
    it('should return paginated visits', async () => {
      mockPrisma.checkupVisit.findMany.mockResolvedValue([mockVisit]);
      mockPrisma.checkupVisit.count.mockResolvedValue(1);

      const result = await service.findVisits({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({ total: 1, page: 1, limit: 10, hasMore: false });
    });

    it('should filter by date and status', async () => {
      mockPrisma.checkupVisit.findMany.mockResolvedValue([]);
      mockPrisma.checkupVisit.count.mockResolvedValue(0);

      await service.findVisits({ date: '2026-06-01', status: 'RESERVED' });

      expect(mockPrisma.checkupVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scheduledDate: new Date('2026-06-01'),
            status: 'RESERVED',
          }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════
  // findVisit
  // ═══════════════════════════════════════════

  describe('findVisit', () => {
    it('should return visit with details', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      const result = await service.findVisit('visit-1');
      expect(result.id).toBe('visit-1');
    });

    it('should throw NotFoundException for missing visit', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(null);
      await expect(service.findVisit('bad')).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // checkIn
  // ═══════════════════════════════════════════

  describe('checkIn', () => {
    it('should check in a RESERVED visit', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });
      mockPrisma.encounter.create.mockResolvedValue({ id: 'enc-1' });
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([{ id: 'ri-1' }]); // createMany 후 ID 조회
      mockPrisma.billing.create.mockResolvedValue({ id: 'bill-1' });
      mockPrisma.checkupVisit.update.mockResolvedValue({
        ...mockVisit, status: 'CHECKED_IN',
        items: [{ id: 'ri-1' }],
      });

      const result = await service.checkIn('visit-1');

      expect(result.status).toBe('CHECKED_IN');
      expect(mockPrisma.encounter.create).toHaveBeenCalled();
      expect(mockPrisma.billing.create).toHaveBeenCalled();
    });

    it('should reject non-RESERVED visit', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue({
        ...mockVisit, status: 'CHECKED_IN',
      });
      await expect(service.checkIn('visit-1')).rejects.toThrow(BadRequestException);
    });

    it('should create result items for non-CONSULT/AI items', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });
      mockPrisma.encounter.create.mockResolvedValue({ id: 'enc-1' });
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([{ id: 'ri-1' }, { id: 'ri-2' }, { id: 'ri-3' }]);
      mockPrisma.billing.create.mockResolvedValue({});
      mockPrisma.checkupVisit.update.mockResolvedValue({ ...mockVisit, status: 'CHECKED_IN', items: [] });

      await service.checkIn('visit-1');

      // LAB + IMAGING + PHYSICAL = 3 items (CONSULT/AI 제외) — createMany 1회에 3건(create 개별호출→createMany 리팩터)
      expect(mockPrisma.checkupResultItem.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.checkupResultItem.createMany.mock.calls[0][0].data).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════════
  // updateStatus
  // ═══════════════════════════════════════════

  describe('updateStatus', () => {
    it('should allow valid status transition', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue({ id: 'v-1', status: 'CHECKED_IN' });
      mockPrisma.checkupVisit.update.mockResolvedValue({ id: 'v-1', status: 'IN_PROGRESS' });

      const result = await service.updateStatus('v-1', { status: 'IN_PROGRESS' });
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should reject invalid status transition', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue({ id: 'v-1', status: 'RESERVED' });
      await expect(service.updateStatus('v-1', { status: 'COMPLETED' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing visit', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus('bad', { status: 'CHECKED_IN' }))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // getRouteSheet
  // ═══════════════════════════════════════════

  describe('getRouteSheet', () => {
    it('should return sorted route sheet', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);

      const result = await service.getRouteSheet('visit-1');

      // LAB(혈액검사) → PHYSICAL → IMAGING → CONSULT
      expect(result[0].name).toBe('혈액검사');
      expect(result[result.length - 1].name).toBe('의사 상담');
    });
  });

  // ═══════════════════════════════════════════
  // addResult
  // ═══════════════════════════════════════════

  describe('addResult', () => {
    it('should create new result item', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.checkupResultItem.findFirst.mockResolvedValue(null);
      mockPrisma.checkupResultItem.create.mockResolvedValue({
        id: 'ri-1', testName: '혈당', value: '95', finding: 'NORMAL',
      });

      const result = await service.addResult('visit-1', {
        category: 'LAB', testName: '혈당', value: '95', finding: 'NORMAL',
      });
      expect(result.testName).toBe('혈당');
    });

    it('should update existing result item', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.checkupResultItem.findFirst.mockResolvedValue({
        id: 'ri-1', finding: 'PENDING',
      });
      mockPrisma.checkupResultItem.update.mockResolvedValue({
        id: 'ri-1', value: '120', finding: 'ABNORMAL',
      });

      const result = await service.addResult('visit-1', {
        category: 'LAB', testName: '혈당', value: '120', finding: 'ABNORMAL',
      });
      expect(result.finding).toBe('ABNORMAL');
    });

    it('should throw NotFoundException for missing visit', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(null);
      await expect(service.addResult('bad', { category: 'LAB', testName: 't' }))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // autoCollectResults
  // ═══════════════════════════════════════════

  describe('autoCollectResults', () => {
    it('should collect completed lab results (NORMAL when no abnormal flags)', async () => {
      const visitWithItems = {
        ...mockVisit, status: 'IN_PROGRESS',
        items: [
          { id: 'ri-1', finding: 'PENDING', sourceType: 'LAB_RESULT', sourceId: 'lr-1' },
        ],
      };
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(visitWithItems);
      mockPrisma.labResult.findMany.mockResolvedValue([{ id: 'lr-1', status: 'COMPLETED', items: [{ flag: null }, { flag: '' }] }]);
      mockPrisma.checkupInterpretation.findMany.mockResolvedValue([]);
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([{ id: 'ri-1', finding: 'NORMAL' }]);
      mockPrisma.checkupVisit.update.mockResolvedValue({});

      const result = await service.autoCollectResults('visit-1');
      expect(result.collected).toBe(1);
      expect(mockPrisma.checkupResultItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['ri-1'] } }, data: expect.objectContaining({ finding: 'NORMAL' }) }),
      );
    });

    it('should derive ABNORMAL/CRITICAL finding from lab flags (은폐 방지)', async () => {
      const visitWithItems = {
        ...mockVisit, status: 'IN_PROGRESS',
        items: [
          { id: 'ri-hi', finding: 'PENDING', sourceType: 'LAB_RESULT', sourceId: 'lr-hi' },
          { id: 'ri-crit', finding: 'PENDING', sourceType: 'LAB_RESULT', sourceId: 'lr-crit' },
        ],
      };
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(visitWithItems);
      mockPrisma.labResult.findMany.mockResolvedValue([
        { id: 'lr-hi', status: 'COMPLETED', items: [{ flag: 'H' }] },
        { id: 'lr-crit', status: 'COMPLETED', items: [{ flag: 'H*' }] },
      ]);
      mockPrisma.checkupInterpretation.findMany.mockResolvedValue([]);
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([{ finding: 'ABNORMAL' }, { finding: 'CRITICAL' }]);
      mockPrisma.checkupVisit.update.mockResolvedValue({});

      await service.autoCollectResults('visit-1');

      const calls = mockPrisma.checkupResultItem.updateMany.mock.calls;
      const abnormal = calls.find((c: any[]) => c[0].data.finding === 'ABNORMAL');
      const critical = calls.find((c: any[]) => c[0].data.finding === 'CRITICAL');
      expect(abnormal[0].where.id.in).toEqual(['ri-hi']);
      expect(critical[0].where.id.in).toEqual(['ri-crit']);
    });

    it('should auto-transition to EXAM_COMPLETE when all done', async () => {
      const visitWithItems = {
        ...mockVisit, status: 'IN_PROGRESS',
        items: [{ id: 'ri-1', finding: 'PENDING', sourceType: 'LAB_RESULT', sourceId: 'lr-1' }],
      };
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(visitWithItems);
      mockPrisma.labResult.findMany.mockResolvedValue([{ id: 'lr-1', status: 'COMPLETED', items: [{ flag: null }] }]);
      mockPrisma.checkupInterpretation.findMany.mockResolvedValue([]);
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([{ finding: 'NORMAL' }]);
      mockPrisma.checkupVisit.update.mockResolvedValue({});

      await service.autoCollectResults('visit-1');

      expect(mockPrisma.checkupVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'EXAM_COMPLETE' },
        }),
      );
    });
  });

  // ═══════════════════════════════════════════
  // generateGradeSummary
  // ═══════════════════════════════════════════

  describe('generateGradeSummary', () => {
    it('should return A grade for all normal results', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: 'LAB', testName: '혈액검사 CBC', finding: 'NORMAL', value: null },
        { category: 'IMAGING', testName: '흉부 X-ray', finding: 'NORMAL', value: null },
      ]);

      const result = await service.generateGradeSummary('visit-1');
      expect(result.overallGrade).toBe('A');
    });

    it('should return C1 for critical findings', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: 'LAB', testName: '혈액검사 CBC', finding: 'NORMAL', value: null },
        { category: 'IMAGING', testName: '흉부 X-ray', finding: 'CRITICAL', value: '폐결절 의심' },
      ]);

      const result = await service.generateGradeSummary('visit-1');
      expect(result.overallGrade).toBe('C1');
      expect(result.sections.some((s: any) => s.grade === 'C1')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  // completeInterpretation
  // ═══════════════════════════════════════════

  describe('completeInterpretation', () => {
    it('should complete interpretation and update result item', async () => {
      mockPrisma.checkupInterpretation.findUnique.mockResolvedValue({
        id: 'interp-1', resultItemId: 'ri-1',
      });
      mockPrisma.checkupInterpretation.update.mockResolvedValue({
        id: 'interp-1', status: 'COMPLETED', grade: 'B',
      });
      mockPrisma.checkupResultItem.update.mockResolvedValue({});

      const result = await service.completeInterpretation(
        'interp-1', { finding: '경미한 이상', grade: 'B' }, 'doc-1',
      );

      expect(result.status).toBe('COMPLETED');
      expect(mockPrisma.checkupResultItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ finding: 'ABNORMAL' }),
        }),
      );
    });

    it('should map grade A to NORMAL finding', async () => {
      mockPrisma.checkupInterpretation.findUnique.mockResolvedValue({
        id: 'interp-1', resultItemId: 'ri-1',
      });
      mockPrisma.checkupInterpretation.update.mockResolvedValue({
        id: 'interp-1', status: 'COMPLETED',
      });
      mockPrisma.checkupResultItem.update.mockResolvedValue({});

      await service.completeInterpretation(
        'interp-1', { finding: '정상', grade: 'A' }, 'doc-1',
      );

      expect(mockPrisma.checkupResultItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ finding: 'NORMAL' }),
        }),
      );
    });

    it('should map grade D1 to CRITICAL finding', async () => {
      mockPrisma.checkupInterpretation.findUnique.mockResolvedValue({
        id: 'interp-1', resultItemId: 'ri-1',
      });
      mockPrisma.checkupInterpretation.update.mockResolvedValue({ id: 'interp-1', status: 'COMPLETED' });
      mockPrisma.checkupResultItem.update.mockResolvedValue({});

      await service.completeInterpretation(
        'interp-1', { finding: '악성 의심', grade: 'D1' }, 'doc-1',
      );

      expect(mockPrisma.checkupResultItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ finding: 'CRITICAL' }),
        }),
      );
    });

    it('should throw NotFoundException for missing interpretation', async () => {
      mockPrisma.checkupInterpretation.findUnique.mockResolvedValue(null);
      await expect(service.completeInterpretation('bad', { finding: '', grade: 'A' }, 'u'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // createSummary / signSummary
  // ═══════════════════════════════════════════

  describe('createSummary', () => {
    it('should create new summary', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.checkupSummary.findUnique.mockResolvedValue(null);
      mockPrisma.checkupSummary.create.mockResolvedValue({
        visitId: 'visit-1', overallGrade: 'B',
      });

      const result = await service.createSummary('visit-1', {
        overallGrade: 'B', sections: [], doctorOpinion: '경과 관찰', recommendations: [],
      }, 'doc-1');

      expect(result.overallGrade).toBe('B');
    });

    it('should update existing summary', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.checkupSummary.findUnique.mockResolvedValue({ visitId: 'visit-1' });
      mockPrisma.checkupSummary.update.mockResolvedValue({
        visitId: 'visit-1', overallGrade: 'A',
      });

      const result = await service.createSummary('visit-1', {
        overallGrade: 'A', sections: [], doctorOpinion: '정상', recommendations: [],
      }, 'doc-1');

      expect(result.overallGrade).toBe('A');
      expect(mockPrisma.checkupSummary.update).toHaveBeenCalled();
    });

    it('should reject update of an already-signed summary (SUMMARY_ALREADY_SIGNED)', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.checkupSummary.findUnique.mockResolvedValue({ visitId: 'visit-1', signedAt: new Date() });

      await expect(service.createSummary('visit-1', {
        overallGrade: 'A', sections: [], doctorOpinion: '변조 시도', recommendations: [],
      }, 'doc-1')).rejects.toMatchObject({ response: { code: 'SUMMARY_ALREADY_SIGNED' } });
      expect(mockPrisma.checkupSummary.update).not.toHaveBeenCalled();
    });
  });

  describe('signSummary', () => {
    it('should sign summary and complete visit (ADMIN force bypasses readiness gate)', async () => {
      mockPrisma.checkupSummary.findUnique.mockResolvedValue({ visitId: 'visit-1' });
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
      mockPrisma.checkupSummary.update.mockResolvedValue({});
      // encounterId 없음 → syncCheckupToHIS 조기 반환(HIS 역동기 스킵)
      mockPrisma.checkupVisit.update.mockResolvedValue({ patientId: 'pat-1', summary: {}, items: [], program: {} });

      const result = await service.signSummary('visit-1', 'doc-1', true);
      expect(result.signed).toBe(true);
      expect(mockPrisma.checkupVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('should throw NotFoundException if no summary', async () => {
      mockPrisma.checkupSummary.findUnique.mockResolvedValue(null);
      await expect(service.signSummary('bad', 'doc-1'))
        .rejects.toThrow(NotFoundException);
    });

    it('should reject force=true from non-ADMIN (FORCE_REQUIRES_ADMIN)', async () => {
      mockPrisma.checkupSummary.findUnique.mockResolvedValue({ visitId: 'visit-1' });
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
      await expect(service.signSummary('visit-1', 'doc-1', true))
        .rejects.toMatchObject({ response: { code: 'FORCE_REQUIRES_ADMIN' } });
    });
  });

  // ═══════════════════════════════════════════
  // createFollowUp / completeFollowUp
  // ═══════════════════════════════════════════

  describe('createFollowUp', () => {
    it('should create follow-up', async () => {
      mockPrisma.checkupVisit.findUnique.mockResolvedValue(mockVisit);
      mockPrisma.checkupFollowUp.create.mockResolvedValue({
        id: 'fu-1', followUpType: 'RECHECK',
      });

      const result = await service.createFollowUp('visit-1', {
        followUpType: 'RECHECK', description: '3개월 후 재검', dueDate: '2026-09-01',
      });
      expect(result.followUpType).toBe('RECHECK');
    });
  });

  describe('completeFollowUp', () => {
    it('should mark follow-up as completed', async () => {
      mockPrisma.checkupFollowUp.findUnique.mockResolvedValue({ id: 'fu-1' });
      mockPrisma.checkupFollowUp.update.mockResolvedValue({
        id: 'fu-1', completedAt: new Date(),
      });

      const result = await service.completeFollowUp('fu-1');
      expect(result.completedAt).toBeTruthy();
    });

    it('should throw NotFoundException for missing follow-up', async () => {
      mockPrisma.checkupFollowUp.findUnique.mockResolvedValue(null);
      await expect(service.completeFollowUp('bad')).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // createReferral
  // ═══════════════════════════════════════════

  describe('createReferral', () => {
    it('should create referral', async () => {
      mockPrisma.checkupReferral.create.mockResolvedValue({
        id: 'ref-1', toDepartment: '소화기내과',
      });

      const result = await service.createReferral('visit-1', {
        toDepartment: '소화기내과', reason: '위장 이상 발견',
      });
      expect(result.toDepartment).toBe('소화기내과');
    });
  });

  // ═══════════════════════════════════════════
  // getTodayStats
  // ═══════════════════════════════════════════

  describe('getTodayStats', () => {
    it('should return status counts', async () => {
      mockPrisma.checkupVisit.count
        .mockResolvedValueOnce(5)  // reserved
        .mockResolvedValueOnce(3)  // checkedIn
        .mockResolvedValueOnce(2)  // inProgress
        .mockResolvedValueOnce(1)  // examComplete
        .mockResolvedValueOnce(0)  // review
        .mockResolvedValueOnce(4); // completed

      const result = await service.getTodayStats();

      expect(result.total).toBe(15);
      expect(result.reserved).toBe(5);
      expect(result.completed).toBe(4);
    });
  });

  // ═══════════════════════════════════════════
  // getStationQueue
  // ═══════════════════════════════════════════

  describe('getStationQueue', () => {
    it('should throw BadRequestException for unknown station', async () => {
      await expect(service.getStationQueue('unknown-station'))
        .rejects.toThrow(BadRequestException);
    });

    it('should return queue for blood station', async () => {
      mockPrisma.checkupVisit.findMany.mockResolvedValue([{
        id: 'v-1',
        patient: { id: 'p-1', mrn: 'MR001', familyName: '김', givenName: '환자', gender: 'MALE', dateOfBirth: new Date('1990-01-01') },
        program: { code: 'CK-A01', name: '종합검진', items: [{ seq: 1, category: 'LAB', name: '혈액검사' }] },
        checkedInAt: new Date(),
        items: [{ testName: '혈액검사', finding: 'PENDING' }],
      }]);

      const result = await service.getStationQueue('blood');

      expect(result).toHaveLength(1);
      expect(result[0].items[0].finding).toBe('PENDING');
    });
  });

  // ═══════════════════════════════════════════
  // stationCompleteItem
  // ═══════════════════════════════════════════

  describe('stationCompleteItem', () => {
    it('should update existing result item', async () => {
      mockPrisma.checkupResultItem.findFirst.mockResolvedValue({ id: 'ri-1' });
      mockPrisma.checkupResultItem.update.mockResolvedValue({
        id: 'ri-1', finding: 'NORMAL', completedAt: new Date(),
      });
      mockPrisma.checkupVisit.findUnique.mockResolvedValue({
        id: 'v-1', status: 'CHECKED_IN',
      });
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { finding: 'NORMAL' }, { finding: 'PENDING' },
      ]);
      mockPrisma.checkupVisit.update.mockResolvedValue({});

      const result = await service.stationCompleteItem('v-1', {
        testName: '혈액검사', finding: 'NORMAL',
      });

      expect(result.finding).toBe('NORMAL');
    });
  });
});
