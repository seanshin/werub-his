import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

// 간호기록 의사 공동서명(P1) — 간호 기안 → 담당의 co-sign 확약. 원 기록 불변(별도 필드).
describe('EssService 간호기록 의사 공동서명', () => {
  let service: EssService;
  let configMap: Record<string, unknown>;
  let prisma: any;

  const NOTE = { status: 'SIGNED', cosignStatus: null, admissionId: 'adm-1' };

  beforeEach(() => {
    configMap = { 'approval.clinicalNote.enabled': true };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    prisma = {
      nursingNote: { findUnique: vi.fn(async () => ({ ...NOTE })), update: vi.fn(async () => ({})) },
      admission: { findUnique: vi.fn(async () => ({ attendingDoctorId: 'doc-att', admittingDoctorId: 'doc-adm' })) },
      eApprovalRelay: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'relay-1', title: '간호기록 의사 공동서명 요청' })), update: vi.fn(async () => ({})) },
      user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
      staff: { findUnique: vi.fn(async () => ({ id: 'staff-doc-1', familyName: '김', givenName: '의사' })) },
      notification: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const config = { get: vi.fn(() => 'https://his.example.org') };
    service = new EssService(prisma, { enqueue: vi.fn() } as any, config as any, configRuntime as any, {} as any, {} as any);
  });

  const submit = (dto: any) => service.submitNoteCosign('nurse-1', dto);
  const confirm = (refId: string, d: 'APPROVED' | 'REJECTED', approver?: string) =>
    (service as any).confirmNoteCosign(refId, d, approver);

  it('게이트 OFF면 상신 차단', async () => {
    configMap = { 'approval.clinicalNote.enabled': false };
    await expect(submit({ noteId: 'n-1' })).rejects.toThrow(/비활성화/);
  });

  it('서명 미완료(DRAFT) 간호기록은 차단', async () => {
    prisma.nursingNote.findUnique = vi.fn(async () => ({ ...NOTE, status: 'DRAFT' }));
    await expect(submit({ noteId: 'n-1' })).rejects.toThrow(/서명 완료된/);
  });

  it('이미 공동서명 완료(COSIGNED)면 차단', async () => {
    prisma.nursingNote.findUnique = vi.fn(async () => ({ ...NOTE, cosignStatus: 'COSIGNED' }));
    await expect(submit({ noteId: 'n-1' })).rejects.toThrow(/이미 의사 공동서명/);
  });

  it('상신 — 담당의(attending) 자동 해소로 PENDING + cosignStatus PENDING', async () => {
    const res = await submit({ noteId: 'n-1' });
    expect(res.status).toBe('PENDING');
    expect(res.approverUserId).toBe('doc-att');
    expect(prisma.nursingNote.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cosignStatus: 'PENDING' } }));
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('attending 없으면 admitting으로 폴백', async () => {
    prisma.admission.findUnique = vi.fn(async () => ({ attendingDoctorId: null, admittingDoctorId: 'doc-adm' }));
    const res = await submit({ noteId: 'n-1' });
    expect(res.approverUserId).toBe('doc-adm');
  });

  it('담당의 전무면 차단', async () => {
    prisma.admission.findUnique = vi.fn(async () => ({ attendingDoctorId: null, admittingDoctorId: null }));
    await expect(submit({ noteId: 'n-1' })).rejects.toThrow(/담당 의사를 지정/);
  });

  it('확약자가 의사가 아니면 차단', async () => {
    prisma.user.findUnique = vi.fn(async () => ({ role: 'NURSE' }));
    await expect(submit({ noteId: 'n-1', approverUserId: 'nurse-x' })).rejects.toThrow(/의사/);
  });

  it('중복 상신 차단', async () => {
    prisma.eApprovalRelay.findFirst = vi.fn(async () => ({ id: 'relay-0' }));
    await expect(submit({ noteId: 'n-1' })).rejects.toThrow(/진행 중/);
  });

  it('확약 승인 — cosignStatus COSIGNED + 확약자 기록', async () => {
    const r = await confirm('n-1', 'APPROVED', 'doc-att');
    expect(r).toEqual({ cosignStatus: 'COSIGNED' });
    expect(prisma.nursingNote.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cosignStatus: 'COSIGNED', cosignedBy: 'doc-att' }) }));
  });

  it('확약 반려 — cosignStatus REJECTED', async () => {
    const r = await confirm('n-1', 'REJECTED', 'doc-att');
    expect(r).toEqual({ cosignStatus: 'REJECTED' });
  });

  it('확약 — 이미 COSIGNED면 멱등 스킵', async () => {
    prisma.nursingNote.findUnique = vi.fn(async () => ({ cosignStatus: 'COSIGNED' }));
    const r = await confirm('n-1', 'APPROVED', 'doc-att');
    expect(r).toEqual({ idempotent: true });
    expect(prisma.nursingNote.update).not.toHaveBeenCalled();
  });
});
