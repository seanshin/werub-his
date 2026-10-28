import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

// 동의서 의사 확약(P1b) — 간호 기안 → 담당의 전자결재 doctorSign(§24-2), 반려=revoke
describe('EssService 동의서 의사 확약', () => {
  let service: EssService;
  let configMap: Record<string, unknown>;
  let prisma: any;
  let consent: { doctorSign: any; revoke: any };

  const FORM = { status: 'PENDING', doctorSignedAt: null, doctorId: 'doc-1', consentType: 'SURGERY', patientSignedAt: null };

  beforeEach(() => {
    configMap = { 'approval.consent.enabled': true };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    consent = { doctorSign: vi.fn().mockResolvedValue({ status: 'SIGNED' }), revoke: vi.fn().mockResolvedValue({ status: 'REVOKED' }) };
    prisma = {
      consentForm: {
        findUnique: vi.fn(async () => ({ ...FORM })),
        update: vi.fn(async () => ({})),
      },
      eApprovalRelay: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'relay-1', title: '수술 동의서 의사 확약 요청' })), update: vi.fn(async () => ({})) },
      user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
      staff: { findUnique: vi.fn(async () => ({ id: 'staff-doc-1', familyName: '김', givenName: '의사' })) },
      notification: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    // 🔴 (2026-09-16 J1) 상신은 relay 생성·동의서 연결·결재선이 한 트랜잭션이다 —
    //    목이 콜백을 돌리지 않으면 정본의 실제 호출 모양이 아니다.
    prisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    const config = { get: vi.fn(() => 'https://his.example.org') };
    service = new EssService(prisma, { enqueue: vi.fn() } as any, config as any, configRuntime as any, {} as any, consent as any);
  });

  const submit = (dto: any) => service.submitConsentApproval('nurse-1', dto);
  const confirm = (refId: string, d: 'APPROVED' | 'REJECTED', approver?: string, c?: string) =>
    (service as any).confirmConsent(refId, d, approver, c);

  it('게이트 OFF면 상신 차단', async () => {
    configMap = { 'approval.consent.enabled': false };
    await expect(submit({ consentId: 'c-1' })).rejects.toThrow(/비활성화/);
  });

  it('의사 서명 불필요 유형(TREATMENT)은 차단', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ ...FORM, consentType: 'TREATMENT' }));
    await expect(submit({ consentId: 'c-1' })).rejects.toThrow(/의사 서명이 필요한/);
  });

  it('이미 서명 완료(SIGNED)면 차단', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ ...FORM, status: 'SIGNED' }));
    await expect(submit({ consentId: 'c-1' })).rejects.toThrow(/이미 서명/);
  });

  it('이미 의사 서명(doctorSignedAt)이면 차단', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ ...FORM, doctorSignedAt: new Date() }));
    await expect(submit({ consentId: 'c-1' })).rejects.toThrow(/의사 서명이 완료/);
  });

  it('상신 — 담당의(doctorId) 자동 해소로 결재선 PENDING + 기안자 기록', async () => {
    const res = await submit({ consentId: 'c-1' });
    expect(res.status).toBe('PENDING');
    expect(res.approverUserId).toBe('doc-1');
    expect(prisma.consentForm.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requestedBy: 'nurse-1' }) }));
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('담당의 미지정·doctorId 없으면 차단', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ ...FORM, doctorId: null }));
    await expect(submit({ consentId: 'c-1' })).rejects.toThrow(/담당 의사를 지정/);
  });

  it('확약자가 의사가 아니면 차단', async () => {
    prisma.user.findUnique = vi.fn(async () => ({ role: 'NURSE' }));
    await expect(submit({ consentId: 'c-1', approverUserId: 'nurse-x' })).rejects.toThrow(/의사/);
  });

  it('중복 상신 차단', async () => {
    prisma.eApprovalRelay.findFirst = vi.fn(async () => ({ id: 'relay-0' }));
    await expect(submit({ consentId: 'c-1' })).rejects.toThrow(/진행 중/);
  });

  it('확약 승인 — 담당의(doctorId)로 doctorSign', async () => {
    await confirm('c-1', 'APPROVED', 'reviewer-x');
    expect(consent.doctorSign).toHaveBeenCalledWith('c-1', 'doc-1');
    expect(consent.revoke).not.toHaveBeenCalled();
  });

  it('확약 승인 — 이미 의사 서명이면 멱등 스킵(doctorSign 미호출)', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ ...FORM, doctorSignedAt: new Date() }));
    const r = await confirm('c-1', 'APPROVED');
    expect(r).toEqual({ idempotent: true });
    expect(consent.doctorSign).not.toHaveBeenCalled();
  });

  it('확약 반려 — 동의서 revoke(사유)', async () => {
    await confirm('c-1', 'REJECTED', 'reviewer-x', '위험 설명 보완 필요');
    expect(consent.revoke).toHaveBeenCalledWith('c-1', '위험 설명 보완 필요');
    expect(consent.doctorSign).not.toHaveBeenCalled();
  });
});
