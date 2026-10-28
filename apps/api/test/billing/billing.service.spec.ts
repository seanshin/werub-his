import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';
import { NotFoundException, BadRequestException, HttpException } from '@nestjs/common';

describe('BillingService', () => {
  let service: BillingService;
  let mockPrisma: any;

  const mockEncounter = {
    id: 'e-1',
    patient: { id: 'p-1', insuranceType: 'NHI' },
    appointment: { type: 'INITIAL' },
    prescriptions: [
      {
        type: 'MEDICATION',
        medicationCode: { code: 'M001', nameKo: '아스피린', unitPrice: 500 },
        medicationCodeId: 'mc-1',
        procedureCode: null,
        procedureCodeId: null,
        quantity: 30,
        duration: 30,
        status: 'ACTIVE',
      },
      {
        type: 'LAB',
        medicationCode: null,
        medicationCodeId: null,
        procedureCode: { code: 'L001', nameKo: 'CBC', unitPrice: 5000, copayRate: 0.3 },
        procedureCodeId: 'pc-1',
        quantity: 1,
        status: 'ACTIVE',
      },
    ],
  };

  const mockBilling = {
    id: 'b-1',
    encounterId: 'e-1',
    patientId: 'p-1',
    totalAmount: 35000,
    insuranceCovered: 24500,
    patientCopay: 10500,
    paidAmount: null,
    status: 'PENDING',
  };

  beforeEach(() => {
    mockPrisma = {
      integrationOutbox: { findMany: vi.fn().mockResolvedValue([]) },
      encounter: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      billing: {
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn(),
        aggregate: vi.fn(),
      },
      // createFromEncounter는 진찰료 코드를 procedureCode.findFirst(유효기간 temporal)로 조회
      procedureCode: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      // resolveCopay: 자격조회(미보유 시 null → 정적 폴백 copay)
      eligibilityCheck: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      billingPayment: { create: vi.fn().mockResolvedValue({ id: 'pay-1' }), findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }), },
      // 2026-10-22 입원 중간정산 수납 원장(일마감 별도 칸)
      interimBillingPayment: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBillingRefund: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBilling: { aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { paidAmount: null } }) },

      claim: { findMany: vi.fn().mockResolvedValue([]) }, // P5-5 환불·취소 뒤 청구 검토
      checkupVoucher: { findUnique: vi.fn() },
      staff: { findUnique: vi.fn().mockResolvedValue(null) },
      admission: { findUnique: vi.fn().mockResolvedValue(null) },
      waitingQueue: { updateMany: vi.fn(), findFirst: vi.fn() },
      patientJourneyEvent: {
        create: vi.fn(), findMany: vi.fn(),
        // 🔴 검토 큐 총계는 목록(take:50)과 **다른 경로**로 센다 — 잘려도 총계는 안 줄어야 한다
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      billingItem: { createMany: vi.fn(), findMany: vi.fn() },
      deposit: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { balance: null } }),
      },
      $transaction: vi.fn((cb: any) => cb(mockPrisma)),
    };
    // BillingService 의존성 전체 주입(prisma·medicalAi·outbox·configRuntime·eligibility·document·voucher)
    const mockOutbox = { enqueue: vi.fn() };
    const mockConfig = { get: vi.fn().mockResolvedValue(undefined) };
    // 🔴 W8 R3 C3 — 본인부담률 정본은 EligibilityService.resolveCopayRate 하나다(billing 의 정적표 제거).
    //   자격조회 기록이 없을 때의 폴백도 그 함수에서만 나오므로 mock 도 정본과 같은 값을 돌려준다.
    const FALLBACK: Record<string, number> = { NHI: 0.3, MEDICAID: 0, INDUSTRIAL: 0, AUTO: 0, SELF_PAY: 1 };
    const mockEligibility = {
      copayRateFor: vi.fn().mockResolvedValue(0.3),
      resolveCopayRate: vi.fn(async (_pid: string, insuranceType: string) => ({
        rate: FALLBACK[insuranceType] ?? 0.3,
        copayCategory: insuranceType,
      })),
    };
    const mockDocument = { issue: vi.fn() };
    const mockVoucher = {
      redeem: vi.fn().mockResolvedValue({ lineAmount: 0, redemptionId: null }),
      reverseRedemption: vi.fn().mockResolvedValue({ count: 0, reversed: [], totalRestored: 0 }),
    };
    const mockMedicalAi = {};
    service = new BillingService(
      mockPrisma,
      mockMedicalAi as any,
      mockOutbox as any,
      mockConfig as any,
      mockEligibility as any,
      mockDocument as any,
      mockVoucher as any,
    );
    // ERP 라인 발행(emitBillingLines)은 fire-and-forget·단위테스트 범위 밖 → 무력화
    vi.spyOn(service as any, 'emitBillingLines').mockResolvedValue([]);
    vi.spyOn(service as any, 'emitAccrualLine').mockResolvedValue({});
  });

  // ─── recalcFromEncounter (백로그 #2 — 정정 후 추가 처방 자동 청구 재계산) ─────────────
  describe('recalcFromEncounter', () => {
    // 기존 청구: 진찰료(이미 청구·sourcePrescriptionId 없음) + 약 mc-1만 청구됨. lab pc-1은 미청구(정정 후 추가분 가정)
    const existingItems = [
      { sourcePrescriptionId: null }, // 진찰료
      { sourcePrescriptionId: 'rx-med' }, // 기청구 약
    ];
    const encounterWithNewRx = {
      id: 'e-1',
      visitType: 'OUTPATIENT',
      patient: { id: 'p-1', insuranceType: 'NHI' },
      prescriptions: [
        { id: 'rx-med', type: 'MEDICATION', medicationCodeId: 'mc-1', procedureCodeId: null, quantity: 30, status: 'ACTIVE',
          medicationCode: { code: 'M001', nameKo: '아스피린', unitPrice: 500 }, procedureCode: null },
        { id: 'rx-lab', type: 'LAB', medicationCodeId: null, procedureCodeId: 'pc-1', quantity: 1, status: 'ACTIVE',
          medicationCode: null, procedureCode: { code: 'L001', nameKo: 'CBC', unitPrice: 5000, copayRate: 0.3 } },
      ],
    };

    it('청구 없으면 createFromEncounter 경로(status=created)', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      const createSpy = vi.spyOn(service, 'createFromEncounter').mockResolvedValue({ id: 'b-new' } as any);

      const r = await service.recalcFromEncounter('e-1');

      expect(r.status).toBe('created');
      expect(createSpy).toHaveBeenCalledWith('e-1');
    });

    it('납부 진행(PAID) 청구는 자동 변경 안 함(status=skipped)', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ id: 'b-1', status: 'PAID', items: existingItems });

      const r = await service.recalcFromEncounter('e-1');

      expect(r.status).toBe('skipped');
      expect(mockPrisma.billingItem.createMany).not.toHaveBeenCalled();
    });

    it('추가 처방 없으면 no-op(status=skipped·이중청구 0)', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        id: 'b-1', status: 'PENDING',
        items: [{ sourcePrescriptionId: 'rx-med' }, { sourcePrescriptionId: 'rx-lab' }], // 둘 다 이미 청구됨
      });
      mockPrisma.encounter.findUnique.mockResolvedValue(encounterWithNewRx);

      const r = await service.recalcFromEncounter('e-1');

      expect(r.status).toBe('skipped');
      expect(mockPrisma.billingItem.createMany).not.toHaveBeenCalled();
    });

    it('PENDING 청구 + 미청구 처방 → 신규 라인만 증분 추가·전체 재계산', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ id: 'b-1', status: 'PENDING', items: existingItems });
      mockPrisma.encounter.findUnique.mockResolvedValue(encounterWithNewRx);
      // 증분 후 전체 라인(진찰료 15000 + 약 15000 + 신규 lab 5000)
      mockPrisma.billingItem.findMany.mockResolvedValue([
        { amount: 15000, copayRate: 0.3 },
        { amount: 15000, copayRate: 0.3 },
        { amount: 5000, copayRate: 0.3 },
      ]);
      mockPrisma.billing.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'b-1', ...data }));

      const r = await service.recalcFromEncounter('e-1');

      expect(r.status).toBe('recalculated');
      expect(r.addedLines).toBe(1); // lab만 신규
      // 신규 라인은 lab(pc-1)만
      expect(mockPrisma.billingItem.createMany).toHaveBeenCalledTimes(1);
      const createArg = mockPrisma.billingItem.createMany.mock.calls[0][0];
      expect(createArg.data).toHaveLength(1);
      expect(createArg.data[0]).toMatchObject({ billingId: 'b-1', codeId: 'pc-1', sourcePrescriptionId: 'rx-lab' });
      // 전체 재계산: total 35000, copay = round(35000*0.3)=10500
      const updArg = mockPrisma.billing.update.mock.calls[0][0];
      expect(updArg.data.totalAmount).toBe(35000);
      expect(updArg.data.patientCopay).toBe(10500);
      expect(updArg.data.insuranceCovered).toBe(24500);
      // 신규 처방분만 ERP accrual
      expect((service as any).emitAccrualLine).toHaveBeenCalledWith('rx-lab');
      expect((service as any).emitAccrualLine).not.toHaveBeenCalledWith('rx-med');
    });
  });

  // ─── getReviewQueue (백로그 #7 응급청구실패 · #2 정정검토 통합 큐) ──────────────
  describe('getReviewQueue', () => {
    it('청구 검토 대기 사건 3종을 환자명과 함께 집계', async () => {
      mockPrisma.patientJourneyEvent.findMany.mockResolvedValue([
        { id: 'j1', eventType: 'ER_BILLING_FAILED', eventAt: new Date('2026-06-28'), title: '응급 청구 실패', description: 'x', refType: 'ER', refId: 'v1', patient: { familyName: '김', givenName: '환자', mrn: 'P1' } },
        { id: 'j2', eventType: 'BILLING_AMEND_REVIEW', eventAt: new Date('2026-06-27'), title: '정정 검토', description: 'y', refType: 'ENCOUNTER', refId: 'e1', patient: { familyName: '이', givenName: '정정', mrn: 'P2' } },
      ]);
      mockPrisma.patientJourneyEvent.count.mockResolvedValue(2);
      mockPrisma.patientJourneyEvent.groupBy.mockResolvedValue([
        { eventType: 'ER_BILLING_FAILED', _count: { _all: 1 } },
        { eventType: 'BILLING_AMEND_REVIEW', _count: { _all: 1 } },
      ]);

      const { data } = await service.getReviewQueue(7);

      expect(data.count).toBe(2);
      expect(data.emergencyFailed).toBe(1);
      expect(data.amendReview).toBe(1);
      expect(data.truncated).toBe(false);
      expect(data.items[0]).toMatchObject({ kind: 'ER_BILLING_FAILED', kindLabel: '응급청구 실패', patientName: '김환자', mrn: 'P1' });
      // 최근 N일 window 필터
      const arg = mockPrisma.patientJourneyEvent.findMany.mock.calls[0][0];
      // 어휘 정본 = BillingService.REVIEW_QUEUE_KINDS. 여기 없는 종류는 기록돼도 화면에 안 뜬다
      expect(arg.where.eventType.in).toEqual(['ER_BILLING_FAILED', 'BILLING_AMEND_REVIEW', 'BILLING_CREATE_FAILED']);
      expect(arg.where.eventAt.gte).toBeInstanceOf(Date);
    });

    it('항목 없으면 count 0', async () => {
      mockPrisma.patientJourneyEvent.findMany.mockResolvedValue([]);
      mockPrisma.patientJourneyEvent.count.mockResolvedValue(0);
      mockPrisma.patientJourneyEvent.groupBy.mockResolvedValue([]);
      const { data } = await service.getReviewQueue();
      expect(data.count).toBe(0);
      expect(data.items).toEqual([]);
      expect(data.truncated).toBe(false);
    });

    /**
     * 🔴 원 결함(W8 이연·2026-08-14 회수): `take:50` 으로 말없이 자르고 `count = items.length` 를
     *    총계로 냈다 — 51번째 미검토 청구부터는 화면 어디에도 없고, 화면은 영원히 "50건"이라 말한다.
     *    **자르면 잘랐다고 말한다.**
     */
    it('🔴 목록이 잘려도 총계는 전수다 — 잘랐다고 말한다(역검증)', async () => {
      const many = Array.from({ length: 50 }, (_, i) => ({
        id: `j${i}`, eventType: 'ER_BILLING_FAILED', eventAt: new Date('2026-06-28'),
        title: 't', description: 'd', refType: 'ER', refId: 'v',
        patient: { familyName: '김', givenName: '환자', mrn: 'P1' },
      }));
      mockPrisma.patientJourneyEvent.findMany.mockResolvedValue(many);
      mockPrisma.patientJourneyEvent.count.mockResolvedValue(137);
      mockPrisma.patientJourneyEvent.groupBy.mockResolvedValue([
        { eventType: 'ER_BILLING_FAILED', _count: { _all: 120 } },
        { eventType: 'BILLING_AMEND_REVIEW', _count: { _all: 17 } },
      ]);

      const { data } = await service.getReviewQueue(7);

      expect(data.count).toBe(137);          // 종전 결함이면 50 이 나온다
      expect(data.count).not.toBe(data.items.length);
      expect(data.returned).toBe(50);
      expect(data.limit).toBe(50);
      expect(data.truncated).toBe(true);
      // 분류 집계도 잘린 목록이 아니라 전수에서 나온다
      expect(data.emergencyFailed).toBe(120);
      expect(data.amendReview).toBe(17);
      // 총계·집계 조회는 목록과 **같은 where** 를 쓴다(창이 갈라지면 또 다른 수가 된다)
      const listWhere = mockPrisma.patientJourneyEvent.findMany.mock.calls.at(-1)[0].where;
      const countWhere = mockPrisma.patientJourneyEvent.count.mock.calls.at(-1)[0].where;
      expect(countWhere).toEqual(listWhere);
    });
  });

  // ─── createFromEncounter 외 ───────────────────────────────

  // ─── createFromEncounter ───────────────────────────────

  describe('createFromEncounter', () => {
    it('should create billing with items from prescriptions', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        id: 'pc-consult',
        code: 'AA157',
        nameKo: '초진 진찰료',
        unitPrice: 15000,
        copayRate: 0.3,
      });
      mockPrisma.billing.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'b-1', ...data, items: data.items.create }),
      );

      const result = await service.createFromEncounter('e-1');

      expect(result.items).toHaveLength(3); // consult + med + lab
      expect(result.totalAmount).toBe(15000 + 15000 + 5000);
      expect(result.patientCopay).toBeLessThan(result.totalAmount);
    });

    it('should derive insuranceCategory per line (급여/비급여 구분)', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          { ...mockEncounter.prescriptions[0], medicationCode: { code: 'M001', nameKo: '급여약', unitPrice: 500, insuranceCode: '123456789' } },
          { ...mockEncounter.prescriptions[0], medicationCode: { code: 'M002', nameKo: '비급여약', unitPrice: 800, insuranceCode: null } },
          { ...mockEncounter.prescriptions[1], procedureCode: { code: 'L001', nameKo: 'CBC', unitPrice: 5000, copayRate: 0.3, insuranceCovered: true } },
          { ...mockEncounter.prescriptions[1], procedureCode: { code: 'N001', nameKo: '비급여검사', unitPrice: 30000, copayRate: 1, insuranceCovered: false } },
        ],
      });
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        id: 'pc-consult', code: 'AA157', nameKo: '초진 진찰료', unitPrice: 15000, copayRate: 0.3,
      });
      mockPrisma.billing.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'b-1', ...data, items: data.items.create }),
      );

      const result = await service.createFromEncounter('e-1');

      const cats = result.items.map((i: any) => i.insuranceCategory);
      expect(cats[0]).toBe('COVERED');       // 진찰료 고정 급여
      expect(cats[1]).toBe('COVERED');       // 보험코드 등재약
      expect(cats[2]).toBe('NON_COVERED');   // 보험코드 미등재약
      expect(cats[3]).toBe('COVERED');       // insuranceCovered=true 행위
      expect(cats[4]).toBe('NON_COVERED');   // insuranceCovered=false 행위
    });

    it('should throw NotFoundException for missing encounter', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(service.createFromEncounter('e-x')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if billing already exists', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);
      mockPrisma.billing.findUnique.mockResolvedValue({ id: 'b-existing' });

      await expect(service.createFromEncounter('e-1')).rejects.toThrow(BadRequestException);
    });

    it('should apply MEDICAID reduced copay (0%)', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        patient: { id: 'p-2', insuranceType: 'MEDICAID' },
        prescriptions: [],
      });
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        id: 'pc-c',
        code: 'AA157',
        nameKo: '초진',
        unitPrice: 15000,
      });
      mockPrisma.billing.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'b-2', ...data, items: data.items.create }),
      );

      const result = await service.createFromEncounter('e-1');

      expect(result.patientCopay).toBe(0);
      expect(result.insuranceCovered).toBe(result.totalAmount);
    });

    it('should apply SELF_PAY 100% copay', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        patient: { id: 'p-3', insuranceType: 'SELF_PAY' },
        prescriptions: [],
      });
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        id: 'pc-c',
        code: 'AA157',
        nameKo: '초진',
        unitPrice: 15000,
      });
      mockPrisma.billing.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'b-3', ...data, items: data.items.create }),
      );

      const result = await service.createFromEncounter('e-1');

      expect(result.patientCopay).toBe(result.totalAmount);
      expect(result.insuranceCovered).toBe(0);
    });

    it('재진 — 종별 미설정이면 의원 재진 AA254 (🔴 종전 종별 무시 상급종합 AA257)', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        appointment: { type: 'FOLLOW_UP' },
        prescriptions: [],
      });
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);
      mockPrisma.billing.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'b-4', ...data, items: data.items.create }),
      );

      await service.createFromEncounter('e-1');

      // 재진 진찰료 코드를 temporal 유효성 조건과 함께 findFirst로 조회 — 종별 정본(billing.institution.grade · 미설정 = 의원)
      expect(mockPrisma.procedureCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ code: 'AA254' }) }),
      );
    });

    it('should handle procedure with custom copayRate', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          {
            type: 'PROCEDURE',
            medicationCode: null,
            medicationCodeId: null,
            procedureCode: { code: 'P001', nameKo: '특수시술', unitPrice: 100000, copayRate: 0.5 },
            procedureCodeId: 'pc-2',
            quantity: 1,
            status: 'ACTIVE',
          },
        ],
      });
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);
      mockPrisma.billing.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'b-5', ...data, items: data.items.create }),
      );

      const result = await service.createFromEncounter('e-1');

      // copayRate from procedure (0.5) should override default NHI (0.3)
      const procItem = result.items.find((i: any) => i.codeName === '특수시술');
      expect(procItem.copayRate).toBe(0.5);
    });
  });

  // ─── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated billings', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([{ id: 'b-1' }]);
      mockPrisma.billing.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter by status', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([]);
      mockPrisma.billing.count.mockResolvedValue(0);

      await service.findAll({ status: 'PAID' });

      expect(mockPrisma.billing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PAID' } }),
      );
    });

    it('should use defaults for page=1 limit=20', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([]);
      mockPrisma.billing.count.mockResolvedValue(0);

      await service.findAll({});

      expect(mockPrisma.billing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should set hasMore=true when more pages exist', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([{ id: 'b-1' }]);
      mockPrisma.billing.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.pagination.hasMore).toBe(true);
    });

    it('should set hasMore=false on last page', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([{ id: 'b-1' }]);
      mockPrisma.billing.count.mockResolvedValue(5);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.pagination.hasMore).toBe(false);
    });
  });

  // ─── findById ──────────────────────────────────────────

  describe('findById', () => {
    it('should return billing with items', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ id: 'b-1', items: [] });

      const result = await service.findById('b-1');

      expect(result.id).toBe('b-1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);

      await expect(service.findById('b-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── pay ───────────────────────────────────────────────

  describe('pay', () => {
    it('should mark as PAID when full amount', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        paidAmount: 10000,
        encounter: { id: 'e-1', prescriptions: [] },
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({});

      const result = await service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' });

      expect(result.status).toBe('PAID');
    });

    it('should mark as PARTIAL when underpaid', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PARTIAL',
        paidAmount: 5000,
      });

      const result = await service.pay('b-1', { amount: 5000, paymentMethod: 'CASH' });

      expect(result.status).toBe('PARTIAL');
    });

    it('should consume deposits FIFO and mark PAID on DEPOSIT payment', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling, patientCopay: 10000, status: 'PENDING',
      });
      mockPrisma.deposit.findMany.mockResolvedValue([
        { id: 'd-1', balance: 6000 },
        { id: 'd-2', balance: 10000 },
      ]);
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling, status: 'PAID', paidAmount: 10000,
        encounter: { id: 'e-1', prescriptions: [] },
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({});

      const result = await service.pay('b-1', { amount: 10000, paymentMethod: 'DEPOSIT' });

      expect(result.status).toBe('PAID');
      // FIFO: d-1 전액(6000) + d-2 잔여(4000), 조건부 감산(balance gte)
      expect(mockPrisma.deposit.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'd-1', refundedAt: null, balance: { gte: 6000 } },
        data: { balance: { decrement: 6000 } },
      });
      expect(mockPrisma.deposit.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'd-2', refundedAt: null, balance: { gte: 4000 } },
        data: { balance: { decrement: 4000 } },
      });
    });

    it('should cap DEPOSIT use at available balance (partial payment)', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling, patientCopay: 10000, status: 'PENDING',
      });
      mockPrisma.deposit.findMany.mockResolvedValue([{ id: 'd-1', balance: 3000 }]);
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling, status: 'PARTIAL', paidAmount: 3000,
      });

      const result = await service.pay('b-1', { amount: 10000, paymentMethod: 'DEPOSIT' });

      expect(result.status).toBe('PARTIAL');
      expect(mockPrisma.billingPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ method: 'DEPOSIT', amount: 3000 }) }),
      );
    });

    it('should throw when no deposit balance available', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling, patientCopay: 10000, status: 'PENDING',
      });
      mockPrisma.deposit.findMany.mockResolvedValue([]);

      await expect(
        service.pay('b-1', { amount: 10000, paymentMethod: 'DEPOSIT' }),
      ).rejects.toThrow(HttpException);
      expect(mockPrisma.billingPayment.create).not.toHaveBeenCalled();
    });

    it('should roll back when deposit balance changed concurrently', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling, patientCopay: 10000, status: 'PENDING',
      });
      mockPrisma.deposit.findMany.mockResolvedValue([{ id: 'd-1', balance: 10000 }]);
      mockPrisma.deposit.updateMany.mockResolvedValue({ count: 0 }); // 레이스: 조건부 감산 실패

      await expect(
        service.pay('b-1', { amount: 10000, paymentMethod: 'DEPOSIT' }),
      ).rejects.toThrow(HttpException);
      expect(mockPrisma.billingPayment.create).not.toHaveBeenCalled();
    });

    it('should throw if not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);

      await expect(
        service.pay('b-x', { amount: 10000, paymentMethod: 'CARD' }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if already paid', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PAID' });

      await expect(
        service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if cancelled', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'CANCELLED' });

      await expect(
        service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' }),
      ).rejects.toThrow(HttpException);
    });

    it('should update waiting queue to PHARMACY_WAITING when prescriptions exist', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
        encounter: { id: 'e-1', prescriptions: [{ id: 'rx-1' }] }, // 진입 include에서 prescriptions 판정
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        encounter: { id: 'e-1', prescriptions: [{ id: 'rx-1' }] },
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({});

      await service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' });

      expect(mockPrisma.waitingQueue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PHARMACY_WAITING' },
        }),
      );
    });

    it('should update waiting queue to VISIT_COMPLETED when no prescriptions', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        encounter: { id: 'e-1', prescriptions: [] },
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({});

      await service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' });

      expect(mockPrisma.waitingQueue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'VISIT_COMPLETED' },
        }),
      );
    });

    it('should store card approval number', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({});

      await service.pay('b-1', {
        amount: 10000,
        paymentMethod: 'CARD',
        cardApprovalNo: 'APPR-12345',
      });

      // §6: 수납 갱신은 낙관적 락 updateMany로 수행
      expect(mockPrisma.billing.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cardApprovalNo: 'APPR-12345' }),
        }),
      );
    });

    it('should create journey event on full payment', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        encounter: { id: 'e-1', prescriptions: [] },
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 1 });
      // 여정은 정본 발행기로(2026-10-01 여정 P0-6) · 어느 수납 건인지 귀속(P0-5 — 종전 refId 없음)
      const journey = { emit: vi.fn() };
      (service as unknown as { journey: unknown }).journey = journey;

      await service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' });

      expect(journey.emit).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 'p-1', eventType: 'BILLING_PAID', refType: 'Billing', refId: mockBilling.id }),
      );
      expect(mockPrisma.patientJourneyEvent.create).not.toHaveBeenCalled();
    });

    it('should not fail if journey event creation throws', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        patientCopay: 10000,
        status: 'PENDING',
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        encounter: { id: 'e-1', prescriptions: [] },
      });
      mockPrisma.waitingQueue.updateMany.mockResolvedValue({ count: 1 });
      (service as unknown as { journey: unknown }).journey = { emit: vi.fn(() => { throw new Error('emit failed'); }) };

      // Should not throw
      const result = await service.pay('b-1', { amount: 10000, paymentMethod: 'CARD' });

      expect(result.status).toBe('PAID');
    });
  });

  // ─── cancel ────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel PENDING billing', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PENDING' });
      mockPrisma.billing.update.mockResolvedValue({ ...mockBilling, status: 'CANCELLED' });

      const result = await service.cancel('b-1', '환자 요청');

      expect(result.status).toBe('CANCELLED');
      // (P1-5) 읽은 상태·납부액 그대로일 때만 갱신(조건부)
      expect(mockPrisma.billing.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b-1', status: 'PENDING' }),
          data: expect.objectContaining({ status: 'CANCELLED', cashierNote: '환자 요청' }),
        }),
      );
    });

    it('should cancel PARTIAL billing', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PARTIAL' });
      mockPrisma.billing.update.mockResolvedValue({ ...mockBilling, status: 'CANCELLED' });

      const result = await service.cancel('b-1', '취소 사유');

      expect(result.status).toBe('CANCELLED');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);

      await expect(service.cancel('b-x', 'reason')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if PAID', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PAID' });

      await expect(service.cancel('b-1', 'reason')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if CANCELLED', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'CANCELLED' });

      await expect(service.cancel('b-1', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── refund ────────────────────────────────────────────

  describe('refund', () => {
    it('should process full refund and set REFUNDED status', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        paidAmount: 9000,
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'REFUNDED',
        refundAmount: 9000,
      });

      const result = await service.refund('b-1', { amount: 9000, reason: '전액 환불' });

      expect(result.status).toBe('REFUNDED');
    });

    it('should process partial refund and keep PAID status', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        paidAmount: 9000,
      });
      mockPrisma.billing.update.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        refundAmount: 3000,
      });

      const result = await service.refund('b-1', { amount: 3000, reason: '일부 환불' });

      expect(result.status).toBe('PAID');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);

      await expect(
        service.refund('b-x', { amount: 1000, reason: 'r' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if not PAID', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PENDING' });

      await expect(
        service.refund('b-1', { amount: 1000, reason: 'r' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if refund exceeds paid amount', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        paidAmount: 5000,
      });

      await expect(
        service.refund('b-1', { amount: 6000, reason: 'r' }),
      ).rejects.toThrow(HttpException);
    });

    it('should store refund reason and processedBy', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        ...mockBilling,
        status: 'PAID',
        paidAmount: 9000,
      });
      mockPrisma.billing.update.mockResolvedValue({ ...mockBilling, status: 'REFUNDED' });

      await service.refund('b-1', {
        amount: 9000,
        reason: '검사 취소',
        processedBy: 'staff-1',
      });

      // (P1-5) 읽은 누적 환불액 그대로일 때만(조건부) · 환불 원장 라인(음수·처리자)
      expect(mockPrisma.billing.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b-1', status: 'PAID' }),
          data: expect.objectContaining({
            refundReason: '검사 취소',
            processedBy: 'staff-1',
          }),
        }),
      );
      expect(mockPrisma.billingPayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ method: 'REFUND', amount: -9000, processedBy: 'staff-1' }) });
    });
  });

  // ─── defer ─────────────────────────────────────────────

  describe('defer', () => {
    it('should defer PENDING billing', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PENDING' });
      mockPrisma.billing.update.mockResolvedValue({ ...mockBilling, status: 'DEFERRED' });

      const result = await service.defer('b-1', { reason: '보험 확인 중' });

      expect(result.status).toBe('DEFERRED');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);

      await expect(service.defer('b-x', { reason: 'r' })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if not PENDING', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PAID' });

      await expect(service.defer('b-1', { reason: 'r' })).rejects.toThrow(BadRequestException);
    });

    it('should store deferredReason and processedBy', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({ ...mockBilling, status: 'PENDING' });
      mockPrisma.billing.update.mockResolvedValue({ ...mockBilling, status: 'DEFERRED' });

      await service.defer('b-1', { reason: '서류 미비', processedBy: 'staff-1' });

      expect(mockPrisma.billing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deferredReason: '서류 미비',
            processedBy: 'staff-1',
          }),
        }),
      );
    });
  });

  // ─── getCashierQueue ──────────────────────────────────

  describe('getCashierQueue', () => {
    it('should return pending billings ordered by createdAt', async () => {
      const queue = [
        { id: 'b-1', status: 'PENDING' },
        { id: 'b-2', status: 'PENDING' },
      ];
      mockPrisma.billing.findMany.mockResolvedValue(queue);

      const result = await service.getCashierQueue();

      expect(result.data).toEqual(queue);
      expect(mockPrisma.billing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('should return empty data when no pending billings', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([]);

      const result = await service.getCashierQueue();

      expect(result.data).toEqual([]);
    });
  });

  // ─── getCashierStats ──────────────────────────────────

  describe('getCashierStats', () => {
    it('should return today stats', async () => {
      mockPrisma.billing.count
        .mockResolvedValueOnce(5)   // pending
        .mockResolvedValueOnce(10)  // completed
        .mockResolvedValueOnce(2)   // deferred
        .mockResolvedValueOnce(9);  // unpaid(정본 집합)
      mockPrisma.billing.aggregate.mockResolvedValue({ _sum: { paidAmount: 500000 } });

      const result = await service.getCashierStats();

      expect(result.data.pendingCount).toBe(5);
      expect(result.data.completedCount).toBe(10);
      expect(result.data.deferredCount).toBe(2);
      expect(result.data.totalRevenue).toBe(500000);
    });

    /**
     * 🔴 원 결함(W8 이연 회수·2026-08-14): 이 EP 에 '미수납' 정본이 없어 화면마다 다른 집합을
     *    '미수납'이라 불렀다 — `/billing` 은 DEFERRED 만, 위젯은 PENDING 만, `/executive` 정본은
     *    PENDING+PARTIAL+DEFERRED. 같은 라벨이 세 가지 수를 말했다(P12).
     */
    it('🔴 미수납 정본은 PENDING+PARTIAL+DEFERRED — PENDING/DEFERRED 단독이 아니다(역검증)', async () => {
      mockPrisma.billing.count
        .mockResolvedValueOnce(54)  // pending
        .mockResolvedValueOnce(26)  // completed
        .mockResolvedValueOnce(3)   // deferred
        .mockResolvedValueOnce(61); // unpaid = 54 + PARTIAL 4 + DEFERRED 3
      mockPrisma.billing.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

      const result = await service.getCashierStats();

      expect(result.data.unpaidCount).toBe(61);
      expect(result.data.unpaidCount).not.toBe(result.data.pendingCount);
      expect(result.data.unpaidCount).not.toBe(result.data.deferredCount);
      expect(result.data.unpaidStatuses).toEqual(['PENDING', 'PARTIAL', 'DEFERRED']);

      // 정본 집합을 그대로 쿼리에 썼는지 — 새 계산식을 만들면 여기서 걸린다
      const unpaidWhere = mockPrisma.billing.count.mock.calls[3][0].where;
      expect(unpaidWhere).toEqual({ status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } });
    });

    it('🔴 미수납 **금액**은 이 EP 가 만들지 않는다 — 금액 정본은 /executive 하나다', async () => {
      mockPrisma.billing.count.mockResolvedValue(0);
      mockPrisma.billing.aggregate.mockResolvedValue({ _sum: { paidAmount: null } });

      const result = await service.getCashierStats();

      expect(Object.keys(result.data)).not.toContain('unpaidAmount');
    });

    it('should return 0 revenue when no payments', async () => {
      mockPrisma.billing.count.mockResolvedValue(0);
      mockPrisma.billing.aggregate.mockResolvedValue({ _count: 0, _sum: {} });
      mockPrisma.billing.aggregate.mockResolvedValue({ _sum: { paidAmount: null } });

      const result = await service.getCashierStats();

      expect(result.data.totalRevenue).toBe(0);
    });
  });

  // ─── getDailySummary ──────────────────────────────────

  describe('getDailySummary', () => {
    it('should return daily summary with provided date', async () => {
      // 🔴 수단별은 **수납 원장** 기준이다(요약 라벨 group by 아님). 목에 원장이 없으면
      //    "회차 납부·복합결제가 집계에서 빠진다"는 결함을 이 테스트가 잡을 수 없다.
      mockPrisma.billingPayment = {
        groupBy: vi.fn().mockResolvedValue([{ method: 'CARD', _sum: { amount: 300000 }, _count: 3 }]),
        aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { amount: 0 } }), // (P1-5) 그 날 환불 원장
      };
      mockPrisma.billing.findMany.mockResolvedValue([
        { paidAmount: 100000, patient: { insuranceType: 'NHI' } },
        { paidAmount: 200000, patient: { insuranceType: 'NHI' } },
      ]);
      mockPrisma.billing.count.mockResolvedValue(0); // cancel
      mockPrisma.billing.aggregate
        .mockResolvedValueOnce({ _count: 0, _sum: { paidAmount: 0 } })        // 원장 없는 수납
        .mockResolvedValueOnce({ _count: 3, _sum: { paidAmount: 300000 } })   // 수납 기준 합계
        .mockResolvedValueOnce({ _count: 1, _sum: { refundAmount: 5000 } })   // refund
        .mockResolvedValueOnce({ _count: 2, _sum: { patientCopay: 30000 } }); // deferred

      const result = await service.getDailySummary('2026-05-20');

      expect(result.data.date).toBe('2026-05-20');
      expect(result.data.byInsuranceType['NHI'].count).toBe(2);
      expect(result.data.byInsuranceType['NHI'].totalAmount).toBe(300000);
      expect(result.data.refundCount).toBe(1);
      expect(result.data.refundAmount).toBe(5000);
      expect(result.data.cancelCount).toBe(0);
      expect(result.data.deferredCount).toBe(2);
      expect(result.data.byPaymentMethod['card']).toBe(300000);
      expect(result.data.totalRevenue).toBe(300000);
    });

    it('should use today date when no date provided', async () => {
      mockPrisma.billingPayment = { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { amount: 0 } }) };
      mockPrisma.billing.findMany.mockResolvedValue([]);
      mockPrisma.billing.count.mockResolvedValue(0);
      mockPrisma.billing.aggregate.mockResolvedValue({ _count: 0, _sum: {} });

      const result = await service.getDailySummary();

      // date should be a valid YYYY-MM-DD string representing today
      expect(result.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should aggregate multiple insurance types', async () => {
      mockPrisma.billingPayment = { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { amount: 0 } }) };
      mockPrisma.billing.findMany.mockResolvedValue([
        { paidAmount: 100000, patient: { insuranceType: 'NHI' } },
        { paidAmount: 50000, patient: { insuranceType: 'SELF_PAY' } },
        { paidAmount: 200000, patient: { insuranceType: 'NHI' } },
      ]);
      mockPrisma.billing.count.mockResolvedValue(0);
      mockPrisma.billing.aggregate.mockResolvedValue({ _count: 0, _sum: {} });

      const result = await service.getDailySummary('2026-05-20');

      expect(result.data.byInsuranceType['NHI'].count).toBe(2);
      expect(result.data.byInsuranceType['SELF_PAY'].count).toBe(1);
    });
  });

  // ─── getDeferred ──────────────────────────────────────

  describe('getDeferred', () => {
    it('should return deferred billings', async () => {
      const deferred = [{ id: 'b-2', status: 'DEFERRED' }];
      mockPrisma.billing.findMany.mockResolvedValue(deferred);

      const result = await service.getDeferred();

      expect(result.data).toEqual(deferred);
      expect(mockPrisma.billing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'DEFERRED' } }),
      );
    });

    it('should return empty data when no deferred billings', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([]);

      const result = await service.getDeferred();

      expect(result.data).toEqual([]);
    });
  });
});
