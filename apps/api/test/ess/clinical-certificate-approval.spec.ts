import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

// 임상 기록지 전자결재(파일럿: 증명서) — 간호/행정 기안 → 담당의 확약(승인=서명·발급, 반려=reject)
describe('EssService 증명서 전자결재 확약', () => {
  let service: EssService;
  let configMap: Record<string, unknown>;
  let prisma: any;
  let issuance: { signCertificate: any; issue: any; reject: any };

  const DOC_REQ = {
    id: 'req-1', type: 'DIAGNOSIS_CERT', encounterId: 'enc-1', issuedDocumentId: null, draftedBy: null, patientId: 'pat-1',
  };

  beforeEach(() => {
    configMap = { 'approval.clinicalCertificate.enabled': true };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    issuance = { signCertificate: vi.fn().mockResolvedValue({ ok: true }), issue: vi.fn().mockResolvedValue({ issueNo: 'ISS-1' }), reject: vi.fn().mockResolvedValue({ ok: true }) };
    prisma = {
      documentRequest: {
        findUnique: vi.fn(async () => ({ ...DOC_REQ })),
        update: vi.fn(async () => ({})),
      },
      eApprovalRelay: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'relay-1', title: '진단서 전자결재 확약 요청' })),
        update: vi.fn(async () => ({})),
      },
      encounter: { findUnique: vi.fn(async () => ({ doctorId: 'doc-1' })) },
      user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
      staff: { findUnique: vi.fn(async () => ({ id: 'staff-doc-1', familyName: '김', givenName: '의사' })) },
      notification: { create: vi.fn(async () => ({})) },
      issuanceArtifact: { findFirst: vi.fn(async () => ({ createdBy: 'doc-1', authoredJson: { diagnoses: [] } })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const config = { get: vi.fn(() => 'https://his.example.org') };
    service = new EssService(prisma, { enqueue: vi.fn() } as any, config as any, configRuntime as any, issuance as any);
  });

  const submit = (dto: any) => service.submitClinicalApproval('nurse-1', dto);
  const confirm = (refId: string, d: 'APPROVED' | 'REJECTED', approver?: string, c?: string) =>
    (service as any).confirmCertificate(refId, d, approver, c);

  it('게이트 OFF면 상신 차단', async () => {
    configMap = { 'approval.clinicalCertificate.enabled': false };
    await expect(submit({ requestId: 'req-1' })).rejects.toThrow(/비활성화/);
  });

  it('증명서(B그룹)가 아니면 차단', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...DOC_REQ, type: 'MEDICAL_RECORD' }));
    await expect(submit({ requestId: 'req-1' })).rejects.toThrow(/증명서/);
  });

  it('이미 발급된 요청은 차단', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...DOC_REQ, issuedDocumentId: 'ISS-0' }));
    await expect(submit({ requestId: 'req-1' })).rejects.toThrow(/발급/);
  });

  it('상신 — 담당의 자동 해소(encounter.doctorId)로 결재선 PENDING 생성', async () => {
    const res = await submit({ requestId: 'req-1' });
    expect(res.status).toBe('PENDING');
    expect(res.approverUserId).toBe('doc-1');
    // 기안자(draftedBy) 기록
    expect(prisma.documentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { draftedBy: 'nurse-1' } }));
    // 담당의 결재선 1단 + 알림
    expect(prisma.eApprovalRelay.update).toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('근거 진료도 지정 담당의도 없으면 차단', async () => {
    prisma.documentRequest.findUnique = vi.fn(async () => ({ ...DOC_REQ, encounterId: null }));
    await expect(submit({ requestId: 'req-1' })).rejects.toThrow(/담당 의사를 지정/);
  });

  it('확약자가 의사가 아니면 차단', async () => {
    prisma.user.findUnique = vi.fn(async () => ({ role: 'NURSE' }));
    await expect(submit({ requestId: 'req-1', approverUserId: 'nurse-x' })).rejects.toThrow(/의사/);
  });

  it('중복 상신 차단(진행 중 PENDING 존재)', async () => {
    prisma.eApprovalRelay.findFirst = vi.fn(async () => ({ id: 'relay-0' }));
    await expect(submit({ requestId: 'req-1' })).rejects.toThrow(/진행 중/);
  });

  it('확약 승인 — 작성 담당의(createdBy)로 서명+발급(결재자 아님·§17)', async () => {
    await confirm('req-1', 'APPROVED', 'reviewer-x');
    expect(issuance.signCertificate).toHaveBeenCalledWith('req-1', 'doc-1'); // createdBy로 서명
    expect(issuance.issue).toHaveBeenCalledWith('req-1', 'doc-1');
    expect(issuance.reject).not.toHaveBeenCalled();
  });

  it('확약 승인 — 작성 내용 없으면 차단', async () => {
    prisma.issuanceArtifact.findFirst = vi.fn(async () => ({ createdBy: null, authoredJson: null }));
    await expect(confirm('req-1', 'APPROVED')).rejects.toThrow(/작성된 증명서/);
  });

  it('확약 반려 — issuance.reject(OTHER, 사유) 호출', async () => {
    await confirm('req-1', 'REJECTED', 'reviewer-x', '진단 근거 불충분');
    expect(issuance.reject).toHaveBeenCalledWith('req-1', 'OTHER', '진단 근거 불충분', 'reviewer-x');
    expect(issuance.signCertificate).not.toHaveBeenCalled();
  });
});
