/**
 * 🔴 퇴원 준비 판정 — 정산 조회 실패를 "정산 완료"로 말하지 않는다.
 *
 * 종전: `getDischargeSettlement(...).catch(() => null)` → `balanceDue = settlement?.balanceDue ?? 0`
 *       → 미납이 있어도 `settled: true` · `readyToDischarge: true`.
 *       **조회 장애가 곧 퇴원 허가**였고, 화면은 초록 '퇴원 가능' 배지를 띄웠다.
 * 재주입: `?? 0` 폴백을 되살리면 첫 케이스가 실패한다.
 *
 * 🔴 2026-08-21 운영 실증에서 더 큰 것이 나왔다 — `getDischargeSettlement` 는 `{ data: { …, balanceDue } }` 로
 *    **감싸서** 반환하는데 두 호출부가 최상위에서 `settlement.balanceDue` 를 읽고 있었다(항상 undefined).
 *    그래서 `?? 0` 시절에는 **전 입원이 '정산 완료'** 였고 **미납 차단 게이트가 개통 이래 한 번도 발동하지 않았다**.
 *    이 스펙의 목(mock)은 반드시 **실제 래핑 모양**을 쓴다 — 내가 가정한 모양을 테스트하면 가드가 헛돈다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

const ADM = 'adm-1';
const mk = () => {
  const prisma: any = {
    admission: { findUnique: vi.fn().mockResolvedValue({ id: ADM, status: 'ADMITTED', expectedDischargeDate: null }) },
    dischargeSummary: { findUnique: vi.fn().mockResolvedValue({ status: 'SIGNED', signedAt: new Date(), followUpDate: new Date(), dischargeMedications: [{ name: 'a' }], patientEducation: '교육함' }) },
    order: { count: vi.fn().mockResolvedValue(0) },
    prescription: { findMany: vi.fn().mockResolvedValue([]) }, // 퇴원약(2026-09-30)
    patientEducationRecord: { count: vi.fn().mockResolvedValue(0) }, // 환자 교육 기록(2026-09-30)
  };
  // 🔴 목은 정본이 실제로 부르는 모양을 쓴다 — 위치인자 `{}` 로 채우면 새로 주입된 협력자가
  //    "truthy 인데 메서드가 없는 것"이 되어 결함이 아닌 곳에서 TypeError 가 난다(2026-08-26 실측).
  const gates = { record: vi.fn().mockResolvedValue(undefined) };
  const svc = new InpatientService(
    prisma,
    {} as any, // journey
    {} as any, // config(테스트가 개별로 덮는다)
    {} as any, // outbox
    {} as any, // billing
    {} as any, // notifications
    {} as any, // events
    gates as any, // 게이트 위반·면제 원장
  );
  vi.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  return { svc, prisma, gates };
};

describe('퇴원 준비 — 정산 조회 실패', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('🔴 정산 조회가 실패하면 잔액 null · settled null · readyToDischarge false (0원·정산완료 아님)', async () => {
    const { svc } = mk();
    vi.spyOn(svc, 'getDischargeSettlement').mockRejectedValue(new Error('DB down'));
    const r: any = await svc.getDischargeReadiness(ADM);
    expect(r.settlement.balanceDue).toBeNull();
    expect(r.settlement.settled).toBeNull();
    expect(r.settlement.unavailable).toBe(true);
    expect(r.settlement.reason).toContain('확인하지 못했');
    expect(r.readyToDischarge).toBe(false); // 다른 조건은 전부 충족인데도 — 모르면 주장하지 않는다
  });

  it('정산이 조회되고 잔액 0 이면 종전대로 퇴원 가능 — 거짓 경보를 만들지 않는다', async () => {
    const { svc } = mk();
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 0 } } as any);
    const r: any = await svc.getDischargeReadiness(ADM);
    expect(r.settlement).toMatchObject({ balanceDue: 0, settled: true, unavailable: false, reason: null });
    expect(r.readyToDischarge).toBe(true);
  });

  it('미납이 있으면 settled false · readyToDischarge false', async () => {
    const { svc } = mk();
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 35000 } } as any);
    const r: any = await svc.getDischargeReadiness(ADM);
    expect(r.settlement).toMatchObject({ balanceDue: 35000, settled: false, unavailable: false });
    expect(r.readyToDischarge).toBe(false);
  });

  /**
   * 🔴 미납 차단 게이트(`discharge`) — 래핑을 벗기지 않아 **게이트를 켜도 발동하지 않던 것**.
   *    재주입: `settlement.data?.balanceDue` 를 `(settlement as any).balanceDue` 로 되돌리면 실패한다.
   */
  it('🔴 게이트 ON·미납이면 퇴원이 차단된다 — 래핑(`{data:{balanceDue}}`)을 벗겨 읽는다', async () => {
    const { svc, prisma } = mk();
    prisma.admission.findUnique.mockResolvedValue({ id: ADM, status: 'ADMITTED', bedId: 'bed-1', patientId: 'pat-1' });
    prisma.dischargeSummary.findUnique.mockResolvedValue({ status: 'SIGNED' });
    (svc as any).config = { get: vi.fn().mockResolvedValue('true') };
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 35000 } } as any);
    await expect(svc.discharge(ADM, '요약', 'HOME', new Date()))
      .rejects.toMatchObject({ response: { code: 'DISCHARGE_BALANCE_DUE', balanceDue: 35000 } });
  });

  /**
   * 🔴 2026-08-26 — 차단은 하는데 **아무 데도 남지 않던 것**. 관제(`/admin/safety-gates`)가
   *    이 게이트의 "위반 0건"을 준수인지 미평가인지 영영 구분할 수 없었다.
   *    재주입: `discharge()` 의 `this.gates?.record(...)` 두 줄을 지우면 이 케이스가 실패한다.
   */
  it('🔴 차단이 위반 원장에 남는다 — 관제의 0건이 준수인지 미평가인지 구분되게', async () => {
    const { svc, prisma, gates } = mk();
    prisma.admission.findUnique.mockResolvedValue({ id: ADM, status: 'ADMITTED', bedId: 'bed-1', patientId: 'pat-1' });
    prisma.dischargeSummary.findUnique.mockResolvedValue({ status: 'SIGNED' });
    (svc as any).config = { get: vi.fn().mockResolvedValue('true') };
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 35000 } } as any);
    await svc.discharge(ADM, '요약', 'HOME', new Date()).catch(() => undefined);
    expect(gates.record).toHaveBeenCalledWith('inpatient.dischargeGate', 'BLOCK', expect.stringContaining('35,000'), 'Admission', ADM);
  });

  /**
   * 🔴 사망·전원은 **면제**다 — 막지 않는다. 다만 면제로 통과한 사실은 남는다(severity=EXEMPT).
   *    막으면 현장이 멈추고, 남기지 않으면 관제의 "0건"이 거짓말한다.
   *    재주입: `GATE_EXEMPT_DISPOSITIONS` 에서 `DECEASED` 를 지우면 미납으로 차단되어 실패한다.
   */
  it.each(['TRANSFER', 'DECEASED'])('게이트 ON·미납이어도 %s 는 막지 않고 면제로 기록한다', async (disposition) => {
    const { svc, prisma, gates } = mk();
    prisma.admission.findUnique.mockResolvedValue({ id: ADM, status: 'ADMITTED', bedId: 'bed-1', patientId: 'pat-1' });
    prisma.dischargeSummary.findUnique.mockResolvedValue({ status: 'DRAFT' }); // 미서명이기도 하다
    (svc as any).config = { get: vi.fn().mockResolvedValue('true') };
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 35000 } } as any);
    const err = await svc.discharge(ADM, '요약', disposition, new Date()).catch((e) => e);
    // 게이트 사유로는 막히지 않는다(이후 tx 는 목 밖이라 다른 이유로 던질 수 있다)
    expect(err?.response?.code).not.toBe('DISCHARGE_BALANCE_DUE');
    expect(err?.response?.code).not.toBe('DISCHARGE_SUMMARY_UNSIGNED');
    expect(gates.record).toHaveBeenCalledWith('inpatient.dischargeGate', 'EXEMPT', expect.stringContaining(disposition), 'Admission', ADM);
  });

  it('게이트 ON·잔액 0 이면 차단하지 않는다 — 거짓 차단을 만들지 않는다', async () => {
    const { svc, prisma } = mk();
    prisma.admission.findUnique.mockResolvedValue({ id: ADM, status: 'ADMITTED', bedId: 'bed-1', patientId: 'pat-1' });
    prisma.dischargeSummary.findUnique.mockResolvedValue({ status: 'SIGNED' });
    (svc as any).config = { get: vi.fn().mockResolvedValue('true') };
    vi.spyOn(svc, 'getDischargeSettlement').mockResolvedValue({ data: { balanceDue: 0 } } as any);
    await expect(svc.discharge(ADM, '요약', 'HOME', new Date()))
      .rejects.not.toMatchObject({ response: { code: 'DISCHARGE_BALANCE_DUE' } }); // 잔액 차단은 아니다(이후 tx 는 목 밖)
  });
});
