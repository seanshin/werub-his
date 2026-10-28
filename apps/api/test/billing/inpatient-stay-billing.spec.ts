import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BillingService } from '../../src/modules/billing/billing.service';

/** 입원 EDI 청구 P1 — 퇴원 시 입원료 Billing(병상등급 수가코드 × 재원일수·eligibility 급여율·멱등) */
describe('입원료 Billing(createInpatientStayBilling)', () => {
  let service: BillingService;
  let prisma: any;
  let configMap: Record<string, unknown>;

  // 재원일수는 ceil((discharge-admit)/1일)이라 두 시각을 **같은 기준시각**에서 파생해야 한다.
  // (종전 Date.now()/new Date() 2회 호출 사이에 ms가 넘어가면 5일+1ms → days=6 으로 간헐 실패)
  const admission = (over: Record<string, unknown> = {}) => {
    const nowMs = Date.now();
    return {
      id: 'adm-1', patientId: 'p-1',
      admitDate: new Date(nowMs - 5 * 86400_000), dischargeDate: new Date(nowMs), status: 'DISCHARGED',
      bed: { bedClass: 'GENERAL' }, patient: { id: 'p-1', insuranceType: 'NHI' }, ...over,
    };
  };

  beforeEach(() => {
    configMap = {};
    prisma = {
      admission: { findUnique: vi.fn().mockResolvedValue(admission()) },
      encounter: { findFirst: vi.fn().mockResolvedValue({ id: 'enc-9', patientId: 'p-1' }) },
      procedureCode: { findFirst: vi.fn().mockResolvedValue({ id: 'proc-stay', code: 'AB1A0100', nameKo: '입원료', unitPrice: 60000 }) },
      billing: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'bill-new', ...data })),
        update: vi.fn().mockResolvedValue({}),
      },
      // 🔴 (2026-09-16 K2) 정본이 **행을 잠그고 라인을 센다** — 목이 그 모양을 갖지 않으면
      //    테스트는 계약이 아니라 목을 검사한다(이 저장소가 반복해 당한 함정).
      billingItem: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'bill-1' }]),
      $transaction: vi.fn().mockImplementation((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new BillingService(
      prisma,
      {} as any, // medicalAi
      { enqueue: vi.fn() } as any, // outbox
      configRuntime as any,
      { copayRateFor: vi.fn().mockResolvedValue(0.2) } as any, // eligibility — 입원 20%
      {} as any, // document
      {} as any, // voucher
    );
    // resolveCopay 내부 의존 단순화 — 입원 20% 고정 반환
    vi.spyOn(service as any, 'resolveCopay').mockResolvedValue({ rate: 0.2, copayCategory: 'NHI', eligibilityStatus: null, eligibilityCheckId: null, specialCaseType: null });
    vi.spyOn(service as any, 'emitBillingLines').mockResolvedValue(undefined);
  });

  it('신규 생성 — 재원 5일 × 코드 단가 60,000·급여율 eligibility(20%)', async () => {
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r).toEqual(expect.objectContaining({ created: true, code: 'AB1A0100', days: 5, amount: 300000 }));
    const data = prisma.billing.create.mock.calls[0][0].data;
    expect(data.encounterId).toBe('enc-9'); // 퇴원(마지막) encounter 귀속
    expect(data.patientCopay).toBe(60000);  // 20%
    expect(data.insuranceCovered).toBe(240000);
    expect(data.items.create[0]).toEqual(expect.objectContaining({ quantity: 5, unitPrice: 60000, insuranceCategory: 'COVERED' }));
  });

  it('🔴 (P5-4) 이미 수납·취소·환불된 청구에는 입원료를 더하지 않는다 — 사람 검토로 남긴다', async () => {
    for (const st of ['PAID', 'PARTIAL', 'CANCELLED', 'REFUNDED']) {
      prisma.billing.findUnique.mockResolvedValue({ id: 'bill-1', status: st });
      prisma.billingItem.count.mockResolvedValue(0);
      prisma.billingItem.create.mockClear(); prisma.billing.update.mockClear();
      const r: any = await service.createInpatientStayBilling('adm-1');
      expect(r).toMatchObject({ created: false, reason: `BILLING_NOT_OPEN:${st}` });
      expect(prisma.billingItem.create).not.toHaveBeenCalled();
      expect(prisma.billing.update).not.toHaveBeenCalled();
    }
  });

  it('기존(처방) Billing 존재 → 입원료 라인 증분 + 총액/보험/본인부담 increment', async () => {
    prisma.billing.findUnique.mockResolvedValue({ id: 'bill-1', status: 'PENDING' }); // P5-4: 미납(PENDING)일 때만 증분
    prisma.billingItem.count.mockResolvedValue(0);
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r.created).toBe(true);
    expect(r.billingId).toBe('bill-1');
    // 🔴 잠근 **뒤에** 세야 경합 상대가 그 사이 넣은 라인을 본다 — 순서가 뒤집히면 이중 청구가 돌아온다
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.billingItem.count.mock.invocationCallOrder[0]);
    expect(prisma.billingItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ billingId: 'bill-1', amount: 300000 }) }));
    expect(prisma.billing.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { totalAmount: { increment: 300000 }, patientCopay: { increment: 60000 }, insuranceCovered: { increment: 240000 } },
    }));
  });

  it('멱등 — 동일 입원료 코드 라인 존재 시 스킵(ALREADY_BILLED)', async () => {
    prisma.billing.findUnique.mockResolvedValue({ id: 'bill-1' });
    prisma.billingItem.count.mockResolvedValue(1); // 잠근 뒤 읽은 결과 — 이미 입원료 라인이 있다
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r).toEqual({ created: false, reason: 'ALREADY_BILLED' });
    expect(prisma.billingItem.create).not.toHaveBeenCalled();
  });

  it('bedRateCodes 매핑 우선 — 병상등급별 코드 해석', async () => {
    configMap['inpatient.bedRateCodes'] = { GENERAL: 'AB-GEN-1' };
    await service.createInpatientStayBilling('adm-1');
    expect(prisma.procedureCode.findFirst.mock.calls[0][0].where.code).toBe('AB-GEN-1');
  });

  it('코드 단가 0이면 config 일당 폴백(bedRates→dailyRate→50,000)', async () => {
    prisma.procedureCode.findFirst.mockResolvedValue({ id: 'proc-stay', code: 'AB1A0100', nameKo: '입원료', unitPrice: null });
    configMap['inpatient.bedRates'] = { GENERAL: 70000 };
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r.amount).toBe(5 * 70000);
  });

  it('encounter 부재(전원 등) → 스킵(NO_ENCOUNTER)·코드 미해소 → 스킵', async () => {
    prisma.encounter.findFirst.mockResolvedValue(null);
    expect((await service.createInpatientStayBilling('adm-1') as any).reason).toBe('NO_ENCOUNTER');
    prisma.encounter.findFirst.mockResolvedValue({ id: 'enc-9', patientId: 'p-1' });
    prisma.procedureCode.findFirst.mockResolvedValue(null);
    expect((await service.createInpatientStayBilling('adm-1') as any).reason).toMatch(/^CODE_NOT_FOUND/);
  });

  it('입원 기록 없음 → 404', async () => {
    prisma.admission.findUnique.mockResolvedValue(null);
    await expect(service.createInpatientStayBilling('bad')).rejects.toThrow(NotFoundException);
  });
});
