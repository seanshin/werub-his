import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

describe('퇴원 게이트 (R3-1)', () => {
  let mockPrisma: any;

  const admission = { id: 'adm-1', patientId: 'p-1', bedId: 'bed-1', status: 'ADMITTED' };

  const build = (gateOn: boolean) => {
    mockPrisma = {
      admission: {
        findUnique: vi.fn().mockResolvedValue(admission),
        update: vi.fn().mockResolvedValue({ ...admission, status: 'DISCHARGED' }),
      },
      dischargeSummary: { findUnique: vi.fn().mockResolvedValue({ status: 'SIGNED', signedAt: new Date() }) },
      encounter: { findMany: vi.fn().mockResolvedValue([]) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
      interimBilling: { findMany: vi.fn().mockResolvedValue([]) },
      order: { count: vi.fn().mockResolvedValue(0) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) }, // 퇴원약(2026-09-30)
      patientEducationRecord: { count: vi.fn().mockResolvedValue(0) }, // 환자 교육 기록(2026-09-30)
      bed: { update: vi.fn().mockResolvedValue({}) },
      chargeOfCare: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      bedAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      dietOrder: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
    };
    return new InpatientService(mockPrisma, undefined, { get: vi.fn(async (k: string) => (k === 'inpatient.dischargeGate' ? 'true' : gateOn ? null : null)) } as any);
  };
  const buildOff = () => {
    const svc = build(false);
    (svc as any).config = { get: vi.fn(async () => null) };
    return svc;
  };

  it('게이트 ON: 퇴원요약 미작성 차단 (DISCHARGE_SUMMARY_UNSIGNED)', async () => {
    const svc = build(true);
    mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);
    await expect(svc.discharge('adm-1', '요약')).rejects.toMatchObject({ response: { code: 'DISCHARGE_SUMMARY_UNSIGNED' } });
  });

  it('게이트 ON: DRAFT 요약 차단', async () => {
    const svc = build(true);
    mockPrisma.dischargeSummary.findUnique.mockResolvedValue({ status: 'DRAFT' });
    await expect(svc.discharge('adm-1', '요약')).rejects.toMatchObject({ response: { code: 'DISCHARGE_SUMMARY_UNSIGNED' } });
  });

  /**
   * 🔴 2026-08-21: 이 목(mock)은 종전에 `{ balanceDue }` 를 **감싸지 않고** 돌려줬다. 그런데 정본
   *    `getDischargeSettlement` 는 `{ data: { …, balanceDue } }` 로 감싸 반환한다 —
   *    즉 **이 가드는 코드가 가정한 모양을 테스트해 통과**했고, 실제 파이프에서 미납 차단은
   *    `undefined ?? 0` 이 되어 **게이트가 ON(운영 실측 `inpatient.dischargeGate=true`)인데도
   *    한 번도 발동하지 않았다.** 목은 반드시 정본의 실제 반환 모양을 쓴다.
   */
  it('게이트 ON: 정산 잔액 미납 차단 (DISCHARGE_BALANCE_DUE·잔액 명시)', async () => {
    const svc = build(true);
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 152000 } } as any);
    await expect(svc.discharge('adm-1', '요약')).rejects.toMatchObject({
      response: { code: 'DISCHARGE_BALANCE_DUE', balanceDue: 152000 },
    });
  });

  it('게이트 ON이어도 전원(TRANSFER)은 미적용 — 이송 지연 방지', async () => {
    const svc = build(true);
    mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);
    const r = await svc.discharge('adm-1', '전원', 'TRANSFER');
    expect(mockPrisma.admission.update).toHaveBeenCalled();
    expect((r as any).status).toBe('DISCHARGED');
  });

  it('게이트 충족 + 미결 오더 → 퇴원 진행 + 경고 동봉(차단 아님)', async () => {
    const svc = build(true);
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 0 } } as any);
    mockPrisma.order.count.mockResolvedValue(3);
    const r = await svc.discharge('adm-1', '요약');
    expect((r as any).warnings?.[0]).toContain('미결 오더 3건');
  });

  it('게이트 OFF(기본): 요약 없어도 퇴원(하위호환)', async () => {
    const svc = buildOff();
    mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);
    await svc.discharge('adm-1', '요약');
    expect(mockPrisma.admission.update).toHaveBeenCalled();
  });

  it('getDischargeReadiness — 체크리스트 서버 정본', async () => {
    const svc = build(true);
    mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', status: 'ADMITTED', expectedDischargeDate: null });
    mockPrisma.dischargeSummary.findUnique.mockResolvedValue({ status: 'SIGNED', signedAt: new Date(), followUpDate: new Date(), dischargeMedications: [{ name: 'x' }], patientEducation: '교육함' });
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 0 } } as any);
    mockPrisma.order.count.mockResolvedValue(1);
    const r = await svc.getDischargeReadiness('adm-1');
    expect(r).toMatchObject({
      summary: { exists: true, status: 'SIGNED' },
      settlement: { settled: true },
      openOrders: 1,
      followUpPlanned: true,
      dischargeMedsPrepared: true,
      educationDone: true,
      readyToDischarge: true,
    });
  });
});
