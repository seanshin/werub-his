import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreAuthService } from '../../src/modules/pre-auth/pre-auth.service';

// 사전승인 서비스 — 마약류 처방 상신·확약(승인=발행, 반려=REJECTED, 멱등)
describe('PreAuthService 마약류 처방 사전승인', () => {
  let service: PreAuthService;
  let prisma: any;
  let prescription: { create: any };

  const PA = { id: 'pa-1', type: 'NARCOTIC_RX', status: 'PENDING', encounterId: 'enc-1', patientId: 'pat-1', requestedByUserId: 'doc-1', fulfilledRef: null, payload: { dto: { type: 'MEDICATION', medicationCodeId: 'med-1' }, prescriberId: null } };

  beforeEach(() => {
    prescription = { create: vi.fn().mockResolvedValue({ prescription: { id: 'rx-1' }, orderId: 'ord-1' }) };
    prisma = {
      encounter: { findUnique: vi.fn(async () => ({ patientId: 'pat-1', doctorId: 'doc-1' })) },
      staff: { findUnique: vi.fn(async () => ({ id: 'staff-chief', familyName: '박', givenName: '과장', manager: { userId: 'chief-1' } })) },
      user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
      preAuthRequest: { create: vi.fn(async () => ({ id: 'pa-1', title: '' })), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ ...PA })) },
      eApprovalRelay: { create: vi.fn(async () => ({ id: 'relay-1', refId: 'pa-1' })), updateMany: vi.fn(async () => ({})) },
      notification: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const config = { get: vi.fn(() => 'https://his.example.org') };
    const configRuntime = { get: vi.fn(async () => null) };
    const moduleRef = { get: vi.fn(() => prescription) };
    service = new PreAuthService(prisma, config as any, configRuntime as any, moduleRef as any);
    // 런타임 getter는 require('.js')로 발행 서비스를 lazy resolve — 테스트(ESM)에선 getter를 직접 stub
    vi.spyOn(service as any, 'prescription', 'get').mockReturnValue(prescription);
  });

  const submit = (dto: any) => service.submitOrderPreAuth('doc-1', dto);
  const confirm = (refId: string, d: 'APPROVED' | 'REJECTED', approver?: string, c?: string) =>
    service.confirmPreAuth(refId, d, approver, c);
  const DRAFT = { encounterId: 'enc-1', type: 'NARCOTIC_RX', draft: { type: 'MEDICATION', medicationCodeId: 'med-1' } };

  it('지원하지 않는 오더 유형은 차단', async () => {
    await expect(submit({ ...DRAFT, type: 'FOO_BAR' })).rejects.toThrow(/지원하지 않는/);
  });

  it('고가검사(HIGH_COST_IMAGING)도 상신 가능', async () => {
    const res = await submit({ ...DRAFT, type: 'HIGH_COST_IMAGING' });
    expect(res.status).toBe('PENDING');
    expect(prisma.preAuthRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'HIGH_COST_IMAGING' }) }));
  });

  it('확약 승인(고가검사) — IMAGING 오더 발행 + FULFILLED', async () => {
    prisma.preAuthRequest.findUnique = vi.fn(async () => ({ ...PA, type: 'HIGH_COST_IMAGING', payload: { dto: { type: 'IMAGING', procedureCodeId: 'proc-1' } } }));
    const r = await confirm('pa-1', 'APPROVED', 'chief-1');
    expect(prescription.create).toHaveBeenCalledWith('enc-1', { type: 'IMAGING', procedureCodeId: 'proc-1' }, 'doc-1', undefined, expect.objectContaining({ preAuthRef: 'pa-1' }));
    expect(r.status).toBe('FULFILLED');
  });

  it('상신 — 승인권자 자동해소(처방의 관리자)로 PENDING relay 생성', async () => {
    const res = await submit(DRAFT);
    expect(res.status).toBe('PENDING');
    expect(res.approverUserId).toBe('chief-1');
    expect(prisma.eApprovalRelay.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ docType: 'PRE_AUTH' }) }));
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('승인권자 미해소(관리자 없음)면 차단', async () => {
    prisma.staff.findUnique = vi.fn(async () => ({ id: 's', manager: null }));
    await expect(submit(DRAFT)).rejects.toThrow(/승인 책임의/);
  });

  it('승인자가 의사가 아니면 차단', async () => {
    prisma.user.findUnique = vi.fn(async () => ({ role: 'NURSE' }));
    await expect(submit({ ...DRAFT, approverUserId: 'nurse-x' })).rejects.toThrow(/의사/);
  });

  it('M1 자기결재 차단 — 요청자 본인을 승인권자로 지정 불가', async () => {
    await expect(service.submitOrderPreAuth('doc-1', { ...DRAFT, approverUserId: 'doc-1' })).rejects.toThrow(/본인.*승인할 수 없습니다/);
  });

  it('M1 자기결재 차단 — 처방의 본인이 승인권자면 거부', async () => {
    await expect(service.submitOrderPreAuth('nurse-1', { ...DRAFT, approverUserId: 'doc-x', prescriberId: 'doc-x' })).rejects.toThrow(/처방의 본인/);
  });

  it('확약 승인 — preAuthRef 동반해 처방 발행 + FULFILLED', async () => {
    const r = await confirm('pa-1', 'APPROVED', 'chief-1');
    expect(prescription.create).toHaveBeenCalledWith('enc-1', PA.payload.dto, 'doc-1', undefined, expect.objectContaining({ preAuthRef: 'pa-1' }));
    expect(r.status).toBe('FULFILLED');
    expect(r.prescriptionId).toBe('rx-1');
    expect(prisma.preAuthRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FULFILLED', fulfilledRef: 'rx-1' }) }));
  });

  it('확약 반려 — 발행 없이 REJECTED', async () => {
    const r = await confirm('pa-1', 'REJECTED', 'chief-1', '용량 재검토');
    expect(r.status).toBe('REJECTED');
    expect(prescription.create).not.toHaveBeenCalled();
  });

  it('확약 승인 — 이미 발행(FULFILLED)이면 멱등 스킵', async () => {
    prisma.preAuthRequest.findUnique = vi.fn(async () => ({ ...PA, status: 'FULFILLED', fulfilledRef: 'rx-0' }));
    const r = await confirm('pa-1', 'APPROVED', 'chief-1');
    expect(r).toEqual({ idempotent: true, fulfilledRef: 'rx-0' });
    expect(prescription.create).not.toHaveBeenCalled();
  });
});
