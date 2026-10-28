import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';
import { NotFoundException } from '@nestjs/common';

describe('ClaimService', () => {
  let service: ClaimService;
  let mockPrisma: any;
  let mockOutbox: any;
  let mockNotification: any;

  beforeEach(() => {
    mockPrisma = {
      claim: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        // 상태 조건부 갱신(P2-3) — 기본은 1건 바뀜
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn(),
        groupBy: vi.fn(),
      },
      billing: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      // 청구 항목 마스터 코드 해석(P2-2 · 정본 resolveEdiCodes) — 기본은 못 찾음
      procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
      patientJourneyEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
      // 🔴 청구 XML/EDI 의 기관 식별은 정본 `system_configs hospital.*` **DB 행**만 읽는다.
      //    목은 정본의 실제 반환 모양: findMany({where:{key:{in}},select:{key,value}}) → [{key, value}]
      systemConfig: {
        findMany: vi.fn(async ({ where }: any) =>
          [{ key: 'hospital.code', value: '99887766' }, { key: 'hospital.name', value: '위루비병원' }]
            .filter((r) => (where?.key?.in as string[] | undefined)?.includes(r.key)),
        ),
      },
      // $transaction — 배열 형태와 콜백(interactive) 형태를 둘 다 받는다. `generateClaims` 는 정본 `withAdvisoryLock` 을
      // 지나가므로 `$transaction(cb)` → `tx.$executeRaw`(advisory lock) → `tx.claim.count` → `tx.claim.create` 순서로 돈다.
      // 🔴 목이 콜백을 부르지 않으면 "청구를 만들지 않았다"가 아니라 테스트가 정본을 안 지나간 것이다.
      $transaction: vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    mockOutbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    mockNotification = {
      create: vi.fn().mockResolvedValue(undefined),
    };

    service = new ClaimService(mockPrisma, mockOutbox, mockNotification);
  });

  describe('findAll', () => {
    it('should find all claims with pagination', async () => {
      const mockClaims = [
        { id: 'claim-1', status: 'SUBMITTED', claimedAmount: 1000000 },
        { id: 'claim-2', status: 'APPROVED', claimedAmount: 500000 },
      ];

      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue(mockClaims);
      vi.mocked(mockPrisma.claim.count).mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.hasMore).toBe(false);
      expect(mockPrisma.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should filter claims by status', async () => {
      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue([
        { status: 'SUBMITTED' },
      ]);
      vi.mocked(mockPrisma.claim.count).mockResolvedValue(1);

      const result = await service.findAll({ status: 'SUBMITTED', page: 1 });

      expect(mockPrisma.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'SUBMITTED' },
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.claim.count).mockResolvedValue(100);

      const result = await service.findAll({ page: 3, limit: 20 });

      expect(result.pagination.page).toBe(3);
      expect(result.pagination.hasMore).toBe(true);
      expect(mockPrisma.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40,
        }),
      );
    });

    it('should use default pagination values', async () => {
      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.claim.count).mockResolvedValue(0);

      await service.findAll({});

      expect(mockPrisma.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('generateClaims', () => {
    it('should generate claims from PAID billings', async () => {
      const mockBillings = [
        {
          id: 'bill-1',
          patientId: 'p-1',
          totalAmount: 1000000,
          insuranceCovered: 700000,
          patientCopay: 300000,
          patient: { id: 'p-1', insuranceType: 'NHI' },
          items: [{ codeId: 'code-1', codeName: 'Service A', amount: 1000000 }],
        },
      ];

      const mockCreatedClaim = {
        id: 'claim-1',
        billingId: 'bill-1',
        claimedAmount: 700000,
        status: 'DRAFT',
      };

      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue(mockBillings);
      vi.mocked(mockPrisma.claim.create).mockResolvedValue(mockCreatedClaim);

      const result = await service.generateClaims();

      expect(result.generated).toBe(1);
      expect(result.claims).toHaveLength(1);
      expect(mockPrisma.claim.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billingId: 'bill-1',
            patientId: 'p-1',
            claimedAmount: 700000,
          }),
        }),
      );
    });

    it('should skip SELF_PAY insurance type', async () => {
      const mockBillings = [
        {
          id: 'bill-1',
          patientId: 'p-1',
          patient: { id: 'p-1', insuranceType: 'SELF_PAY' },
          items: [],
        },
      ];

      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue(mockBillings);

      const result = await service.generateClaims();

      expect(result.generated).toBe(0);
      // 🔴 (2026-09-30) 자비 제외를 센다 — 세지 않으면 화면이 "대상 없음"과 "자비라 뺐다"를 가를 수 없다
      expect(result.excludedSelfPay).toBe(1);
      expect(result.skipped).toBe(0);
      expect(mockPrisma.claim.create).not.toHaveBeenCalled();
    });

    it('should generate claims with claimData', async () => {
      const mockBilling = {
        id: 'bill-1',
        patientId: 'p-1',
        totalAmount: 1000000,
        insuranceCovered: 700000,
        patientCopay: 300000,
        patient: { insuranceType: 'NHI' },
        items: [{ codeId: 'code-1', codeName: 'Service', amount: 1000000, quantity: 1 }],
      };

      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue([mockBilling]);
      vi.mocked(mockPrisma.claim.create).mockResolvedValue({ id: 'claim-1' });

      await service.generateClaims();

      expect(mockPrisma.claim.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            claimData: expect.objectContaining({
              totalAmount: 1000000,
              insuranceClaimed: 700000,
              patientCopay: 300000,
              items: expect.any(Array),
            }),
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should find claim by ID with patient and billing', async () => {
      const mockClaim = {
        id: 'claim-1',
        billingId: 'bill-1',
        claimedAmount: 700000,
        status: 'SUBMITTED',
        patient: {
          id: 'p-1',
          mrn: '00001',
          familyName: '김',
          givenName: '철수',
          insuranceNumber: 'INS-123',
        },
        billing: {
          items: [{ codeId: 'code-1', amount: 700000 }],
        },
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(mockClaim);

      const result = await service.findById('claim-1');

      expect(result.claimedAmount).toBe(700000);
      expect(result.patient.familyName).toBe('김');
      expect(result.billing.items).toHaveLength(1);
    });

    it('should throw NotFoundException if claim not found', async () => {
      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submit', () => {
    it('should submit claim and set status to SUBMITTED', async () => {
      const mockUpdated = {
        id: 'claim-1',
        status: 'SUBMITTED',
        submittedAt: new Date(),
        claimNumber: 'CLM-1715606400000',
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue({ status: 'DRAFT', claimData: null, claimNumber: null });
      vi.mocked(mockPrisma.claim.findUniqueOrThrow).mockResolvedValue(mockUpdated);

      const result = await service.submit('claim-1');

      expect(result.status).toBe('SUBMITTED');
      expect(result.claimNumber).toContain('CLM-');
      expect(mockPrisma.claim.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'claim-1', status: 'DRAFT' },
          data: expect.objectContaining({
            status: 'SUBMITTED',
          }),
        }),
      );
    });
  });

  describe('review', () => {
    it('should approve claim', async () => {
      const mockUpdated = {
        id: 'claim-1',
        status: 'APPROVED',
        approvedAmount: 700000,
        reviewedAt: new Date(),
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue({
        billingId: 'bill-1',
        claimedAmount: 700000,
        patientId: 'p-1',
        status: 'SUBMITTED',
      });
      vi.mocked(mockPrisma.claim.findUniqueOrThrow).mockResolvedValue(mockUpdated);
      vi.mocked(mockPrisma.billing.update).mockResolvedValue({});

      const result = await service.review('claim-1', { approvedAmount: 700000 });

      expect(result.status).toBe('APPROVED');
      expect(result.approvedAmount).toBe(700000);
    });

    it('should partially approve claim with reduced amount', async () => {
      const mockUpdated = {
        id: 'claim-1',
        status: 'PARTIALLY_APPROVED',
        approvedAmount: 600000,
        reducedAmount: 100000,
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue({
        billingId: 'bill-1',
        claimedAmount: 700000,
        patientId: 'p-1',
        status: 'SUBMITTED',
      });
      vi.mocked(mockPrisma.claim.findUniqueOrThrow).mockResolvedValue(mockUpdated);
      vi.mocked(mockPrisma.billing.update).mockResolvedValue({});

      const result = await service.review('claim-1', {
        approvedAmount: 600000,
        reducedAmount: 100000,
      });

      expect(result.status).toBe('PARTIALLY_APPROVED');
      expect(result.reducedAmount).toBe(100000);
    });

    it('should reject claim with reason', async () => {
      const mockUpdated = {
        id: 'claim-1',
        status: 'REJECTED',
        rejectReason: 'Invalid diagnosis code',
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue({
        billingId: 'bill-1',
        claimedAmount: 700000,
        patientId: 'p-1',
        status: 'SUBMITTED',
      });
      vi.mocked(mockPrisma.claim.findUniqueOrThrow).mockResolvedValue(mockUpdated);
      vi.mocked(mockPrisma.billing.update).mockResolvedValue({});

      const result = await service.review('claim-1', {
        approvedAmount: 0,
        rejectReason: 'Invalid diagnosis code',
      });

      expect(result.status).toBe('REJECTED');
      expect(result.rejectReason).toBe('Invalid diagnosis code');
    });
  });

  describe('getSummary', () => {
    it('should get claim summary grouped by status', async () => {
      const mockSummary = [
        {
          status: 'SUBMITTED',
          _count: 5,
          _sum: {
            claimedAmount: 5000000,
            approvedAmount: null,
            reducedAmount: null,
            paidAmount: null,
          },
        },
        {
          status: 'APPROVED',
          _count: 3,
          _sum: {
            claimedAmount: 3000000,
            approvedAmount: 2800000,
            reducedAmount: 200000,
            paidAmount: 2800000,
          },
        },
      ];

      vi.mocked(mockPrisma.claim.groupBy).mockResolvedValue(mockSummary);

      const result = await service.getSummary();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('SUBMITTED');
      expect(result[0]._count).toBe(5);
      expect(result[1]._sum.approvedAmount).toBe(2800000);
    });

    it('should handle empty claims', async () => {
      vi.mocked(mockPrisma.claim.groupBy).mockResolvedValue([]);

      const result = await service.getSummary();

      expect(result).toHaveLength(0);
    });
  });

  describe('generateHiraXml', () => {
    it('should generate HIRA XML for single claim', async () => {
      const mockClaim = {
        id: 'claim-1',
        claimNumber: 'CLM-202605001',
        claimDate: new Date('2026-05-13'),
        claimedAmount: 700000,
        claimData: {
          totalAmount: 1000000,
          insuranceClaimed: 700000,
          patientCopay: 300000,
          claimYearMonth: '202605',
          items: [{ code: 'code-1', name: 'Service', amount: 1000000, quantity: 1 }],
        },
        patient: {
          insuranceType: 'NHI', mrn: '00001',
          familyName: '김',
          givenName: '철수',
          insuranceNumber: 'INS-123',
        },
        billing: {
          encounter: { createdAt: new Date('2026-05-13T01:00:00Z') },
          items: [],
        },
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(mockClaim);

      const xml = await service.generateHiraXml('claim-1');

      expect(xml).toContain('<?xml version');
      expect(xml).toContain('<청구서');
      expect(xml).toContain('CLM-202605001');
      expect(xml).toContain('김철수');
      expect(xml).toContain('700000');
    });

    it('should escape XML special characters', async () => {
      const mockClaim = {
        id: 'claim-1',
        claimNumber: 'CLM-1',
        claimDate: new Date(),
        claimedAmount: 100000,
        claimData: { items: [{ code: 'A<B>C&D', name: 'Service "Test"' }] },
        patient: { insuranceType: 'NHI', mrn: '00001', familyName: 'Kim\'s', givenName: 'Test' },
        billing: { encounter: { createdAt: new Date('2026-05-13T01:00:00Z') }, items: [] },
      };

      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(mockClaim);

      const xml = await service.generateHiraXml('claim-1');

      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&quot;');
      expect(xml).toContain('&apos;');
    });
  });

  describe('generateBatchHiraXml', () => {
    it('should generate batch HIRA XML for multiple claims', async () => {
      const mockClaim1 = {
        id: 'claim-1',
        claimNumber: 'CLM-1',
        claimDate: new Date(),
        claimedAmount: 700000,
        claimData: { items: [] },
        patient: { insuranceType: 'NHI', mrn: '00001', familyName: '김', givenName: '철수' },
        billing: { encounter: { createdAt: new Date('2026-05-13T01:00:00Z') }, items: [] },
      };

      const mockClaim2 = {
        id: 'claim-2',
        claimNumber: 'CLM-2',
        claimDate: new Date(),
        claimedAmount: 500000,
        claimData: { items: [] },
        patient: { insuranceType: 'NHI', mrn: '00002', familyName: '이', givenName: '영희' },
        billing: { encounter: { createdAt: new Date('2026-05-13T01:00:00Z') }, items: [] },
      };

      vi.mocked(mockPrisma.claim.findUnique)
        .mockResolvedValueOnce(mockClaim1)
        .mockResolvedValueOnce(mockClaim2);

      const xml = await service.generateBatchHiraXml(['claim-1', 'claim-2']);

      expect(xml).toContain('<?xml version');
      expect(xml).toContain('<일괄청구서');
      expect(xml).toContain('<총건수>2</총건수>');
      expect(xml).toContain('CLM-1');
      expect(xml).toContain('CLM-2');
    });

    /**
     * 🔴 종전 이 테스트는 `<청구기관코드>12345678`·`<청구기관명>Hospital RUN` 을 **기대**했다 —
     *    코드에 박힌 날조값을 가드가 지키고 있었던 셈이다(설정을 읽지도 않았다).
     *    이제 기관 식별은 정본 DB 행에서 오고, **비어 있으면 청구 파일을 만들지 않는다**(422).
     */
    const oneClaim = {
      id: 'claim-1', claimNumber: 'CLM-1', claimDate: new Date(), claimedAmount: 100000,
      claimData: { items: [] },
      patient: { insuranceType: 'NHI', mrn: '00001', familyName: 'Kim', givenName: 'Test' },
      billing: { encounter: { createdAt: new Date('2026-05-13T01:00:00Z') }, items: [] },
    };

    it('기관 헤더는 설정 정본(DB 행)에서 온다 — 코드에 박힌 값이 아니다', async () => {
      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(oneClaim);

      const xml = await service.generateBatchHiraXml(['claim-1']);

      expect(xml).toContain('<청구기관코드>99887766</청구기관코드>');
      expect(xml).toContain('<청구기관명>위루비병원</청구기관명>');
      expect(xml).not.toContain('12345678');
      expect(xml).not.toContain('Hospital RUN');
    });

    it('🔴 기관 식별이 미설정이면 청구 파일을 만들지 않는다 — 지어낸 기관명으로 대외 제출물을 내보내지 않는다(422)', async () => {
      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(oneClaim);
      // 설정 행 없음(=사람이 아직 입력하지 않음)
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);

      await expect(service.generateBatchHiraXml(['claim-1'])).rejects.toMatchObject({ status: 422 });
      await expect(service.generateHiraXml('claim-1')).rejects.toMatchObject({ status: 422 });
      // EDI 파이프 파일도 같다(헤더 레코드에 요양기관기호가 들어간다)
      await expect(service.generateEdi('claim-1')).rejects.toMatchObject({ status: 422 });

      const err = await service.generateHiraXml('claim-1').catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'HOSPITAL_IDENTITY_UNSET', missing: ['hospital.code', 'hospital.name'] });
    });

    it('🔴 EDI 파이프 파일은 **싣는 키만** 요구한다 — 기관명이 비어도 요양기관기호가 있으면 만든다', async () => {
      vi.mocked(mockPrisma.claim.findUnique).mockResolvedValue(oneClaim);
      mockPrisma.systemConfig.findMany.mockResolvedValue([{ key: 'hospital.code', value: '99887766' }]);

      await expect(service.generateEdi('claim-1')).resolves.toContain('|99887766|');
      // 반대로 XML 헤더는 기관명 칸이 있으므로 만들지 않는다
      await expect(service.generateHiraXml('claim-1')).rejects.toMatchObject({ status: 422 });
    });
  });
});
