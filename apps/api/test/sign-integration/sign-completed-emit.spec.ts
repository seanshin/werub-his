import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignIntegrationService } from '../../src/modules/sign-integration/sign-integration.service';

// e-sign #6 — handleWebhook 완료 시 sign.completed ERP 발행(동의서/ERP 계약 공통).
describe('SignIntegrationService.handleWebhook → sign.completed 발행', () => {
  let enqueue: ReturnType<typeof vi.fn>;
  let consentFindFirst: ReturnType<typeof vi.fn>;
  let issuedFindFirst: ReturnType<typeof vi.fn>;
  let svc: SignIntegrationService;

  beforeEach(() => {
    enqueue = vi.fn().mockResolvedValue(undefined);
    consentFindFirst = vi.fn();
    issuedFindFirst = vi.fn();
    const prisma: any = {
      consentForm: { findFirst: consentFindFirst, update: vi.fn() },
      issuedDocument: { findFirst: issuedFindFirst, updateMany: vi.fn() },
      user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patient: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const documents: any = { downloadUrl: (issueNo: string) => ({ url: `https://his.example.org/api/v1/documents/dl/${issueNo}?t=TOK`, expiresAt: '2026-06-29T00:00:00.000Z' }) };
    const redis: any = { set: vi.fn().mockResolvedValue('1') }; // NX fresh
    const outbox: any = { enqueue };
    svc = new SignIntegrationService({} as any, prisma, documents, redis, {} as any, outbox);
  });

  const completed = (reqId: string, eventId = 'evt-1') => ({ eventId, eventType: 'request.completed', signatureRequestId: reqId, occurredAt: '2026-06-28T02:00:00.000Z', signCertSerial: '5B:1A', auditCertUri: 'https://sign/audit.p7s', assuranceLevel: 'HSM_ANCHORED' });

  it('ERP 계약(documentType ERP_*): erpContractId + externalSignerRef + 완료본 URL 동봉', async () => {
    consentFindFirst.mockResolvedValue(null); // ConsentForm 없음
    issuedFindFirst.mockResolvedValue({ issueNo: 'WRB-ERP-20260628-1', documentType: 'ERP_MEDICAL_CONTRACT', sourceId: 'CONTRACT-123' });
    const r = await svc.handleWebhook(completed('SR-1'));
    expect(r).toMatchObject({ ok: true, matched: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [domain, event, ref, payload] = enqueue.mock.calls[0];
    expect(domain).toBe('sign');
    expect(event).toBe('sign.completed');
    expect(ref).toBe('signcomplete:SR-1');
    expect(payload).toMatchObject({
      signatureRequestId: 'SR-1',
      consentFormId: null,
      erpContractId: 'CONTRACT-123',
      externalSignerRef: 'erpcontract:medical:CONTRACT-123',
      documentType: 'ERP_MEDICAL_CONTRACT',
      status: 'COMPLETED',
      certSerial: '5B:1A',
      auditCertUri: 'https://sign/audit.p7s',
      assuranceLevel: 'HSM_ANCHORED',
    });
    expect(payload.document.url).toContain('/documents/dl/WRB-ERP-20260628-1?t=');
  });

  it('동의서(CONSENT): erpContractId/externalSignerRef = null (ERP 미러 no-op 대상)', async () => {
    consentFindFirst.mockResolvedValue({ id: 'cf-1', signStatus: 'REQUESTED', patientId: 'pt-1', type: 'SURGERY', consentType: 'SURGERY' });
    issuedFindFirst.mockResolvedValue({ issueNo: 'WRB-CONSENT-20260628-1', documentType: 'CONSENT', sourceId: 'cf-1' });
    await svc.handleWebhook(completed('SR-2'));
    const payload = enqueue.mock.calls[0][3];
    expect(payload.erpContractId).toBeNull();
    expect(payload.externalSignerRef).toBeNull();
    expect(payload.consentFormId).toBe('cf-1');
    expect(payload.patientId).toBe('pt-1');
  });

  it('매칭 문서 없음(ConsentForm·IssuedDocument 모두 없음): matched=false·발행 안 함', async () => {
    consentFindFirst.mockResolvedValue(null);
    issuedFindFirst.mockResolvedValue(null);
    const r = await svc.handleWebhook(completed('SR-3'));
    expect(r).toMatchObject({ matched: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('완료가 아닌 이벤트(withdrawn): 발행 안 함', async () => {
    consentFindFirst.mockResolvedValue(null);
    issuedFindFirst.mockResolvedValue({ issueNo: 'WRB-ERP-20260628-2', documentType: 'ERP_MEDICAL_CONTRACT', sourceId: 'C-9' });
    await svc.handleWebhook({ eventId: 'e2', eventType: 'request.withdrawn', signatureRequestId: 'SR-4' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('eventId 재수신(replay): 멱등 차단·발행 안 함', async () => {
    const redisSet = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce(null); // 2회차 중복
    (svc as any).redis = { set: redisSet };
    consentFindFirst.mockResolvedValue(null);
    issuedFindFirst.mockResolvedValue({ issueNo: 'WRB-ERP-X', documentType: 'ERP_MEDICAL_CONTRACT', sourceId: 'C-1' });
    await svc.handleWebhook(completed('SR-5', 'dup'));
    await svc.handleWebhook(completed('SR-5', 'dup'));
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
