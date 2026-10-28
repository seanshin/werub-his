import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

// 의무기록 사본 발급 승인(P2·A그룹) — 행정 기안 → 담당의 발급 승인(issue), 반려=reject. §21 대리 자격검증 선행.
describe('EssService 의무기록 사본 발급 승인', () => {
  let service: EssService;
  let configMap: Record<string, unknown>;
  let prisma: any;
  let issuance: { issue: any; reject: any };

  const REQ = { type: 'MEDICAL_RECORD', status: 'IN_REVIEW', issuedDocumentId: null, requesterType: 'SELF', proxyVerifyStatus: 'NONE' };

  beforeEach(() => {
    configMap = { 'approval.recordCopy.enabled': true };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    issuance = { issue: vi.fn().mockResolvedValue({ issueNo: 'ISS-9' }), reject: vi.fn().mockResolvedValue({ ok: true }) };
    prisma = {
      documentRequest: { findUnique: vi.fn(async () => ({ ...REQ })), update: vi.fn(async () => ({})) },
      eApprovalRelay: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'relay-1', title: '의무기록 사본 발급 승인 요청' })), update: vi.fn(async () => ({})) },
      user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
      staff: { findUnique: vi.fn(async () => ({ id: 'staff-doc-1', familyName: '김', givenName: '의사' })) },
      notification: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const config = { get: vi.fn(() => 'https://his.example.org') };
    service = new EssService(prisma, { enqueue: vi.fn() } as any, config as any, configRuntime as any, issuance as any, {} as any);
  });

  const submit = (dto: any) => service.submitRecordCopyApproval('admin-1', dto);
  const confirm = (refId: string, d: 'APPROVED' | 'REJECTED', approver?: string, c?: string) =>
    (service as any).confirmRecordCopy(refId, d, approver, c);
  const OK = { requestId: 'req-1', approverUserId: 'doc-1' };

  it('게이트 OFF면 상신 차단', async () => {
    configMap = { 'approval.recordCopy.enabled': false };
    await expect(submit(OK)).rejects.toThrow(/비활성화/);
  });

  it('증명서(B그룹) 타입은 사본 승인 대상 아님', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...REQ, type: 'DIAGNOSIS_CERT' }));
    await expect(submit(OK)).rejects.toThrow(/clinical-approvals/);
  });

  it('이미 발급된 요청은 차단', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...REQ, issuedDocumentId: 'ISS-0' }));
    await expect(submit(OK)).rejects.toThrow(/발급/);
  });

  it('스냅샷 미동결(IN_REVIEW 아님)이면 차단', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...REQ, status: 'REQUESTED' }));
    await expect(submit(OK)).rejects.toThrow(/IN_REVIEW/);
  });

  it('대리(PROXY) 요청은 자격검증(VERIFIED) 선행 필수 — §21', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...REQ, requesterType: 'PROXY', proxyVerifyStatus: 'PENDING' }));
    await expect(submit(OK)).rejects.toThrow(/대리인 자격 검증/);
  });

  it('대리(PROXY)라도 VERIFIED면 상신 가능', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...REQ, requesterType: 'PROXY', proxyVerifyStatus: 'VERIFIED' }));
    const res = await submit(OK);
    expect(res.status).toBe('PENDING');
  });

  it('상신 — 지정 승인 의사로 결재선 PENDING + 기안자 기록', async () => {
    const res = await submit(OK);
    expect(res.status).toBe('PENDING');
    expect(res.approverUserId).toBe('doc-1');
    expect(prisma.documentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { draftedBy: 'admin-1' } }));
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('승인 의사 미지정이면 차단', async () => {
    await expect(submit({ requestId: 'req-1', approverUserId: '' })).rejects.toThrow(/담당 의사를 지정/);
  });

  it('승인자가 의사가 아니면 차단', async () => {
    prisma.user.findUnique = vi.fn(async () => ({ role: 'NURSE' }));
    await expect(submit(OK)).rejects.toThrow(/의사/);
  });

  it('중복 상신 차단', async () => {
    prisma.eApprovalRelay.findFirst = vi.fn(async () => ({ id: 'relay-0' }));
    await expect(submit(OK)).rejects.toThrow(/진행 중/);
  });

  it('확약 승인 — issue(발급) 호출', async () => {
    await confirm('req-1', 'APPROVED', 'doc-1');
    expect(issuance.issue).toHaveBeenCalledWith('req-1', 'doc-1');
    expect(issuance.reject).not.toHaveBeenCalled();
  });

  it('확약 승인 — 이미 발급이면 멱등 스킵', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ issuedDocumentId: 'ISS-0' }));
    const r = await confirm('req-1', 'APPROVED', 'doc-1');
    expect(r).toEqual({ idempotent: true, issued: 'ISS-0' });
    expect(issuance.issue).not.toHaveBeenCalled();
  });

  it('확약 반려 — reject(OTHER, 사유) 호출', async () => {
    await confirm('req-1', 'REJECTED', 'doc-1', '발급 범위 재확인 필요');
    expect(issuance.reject).toHaveBeenCalledWith('req-1', 'OTHER', '발급 범위 재확인 필요', 'doc-1');
  });
});
