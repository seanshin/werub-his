import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

vi.mock('../../src/common/util/safe-fetch', () => ({
  safeFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { signatureRequestId: 'req-1', portalUrl: 'https://sign.example.org/portal/x' } }) }),
}));
vi.mock('../../src/common/crypto/field-encryption', () => ({
  decryptField: vi.fn(() => { throw new Error('decrypt fail'); }),
}));

import { SignIntegrationService } from '../../src/modules/sign-integration/sign-integration.service';
import { safeFetch } from '../../src/common/util/safe-fetch';

/** sign e2e 잔여 하드닝 4종 — 멱등가드·PORTAL patientId 가드·SSRF 독립 allowlist·CI 복호 비차단 */
describe('SignIntegrationService hardening', () => {
  let service: SignIntegrationService;
  let mockPrisma: any;
  let mockDocuments: any;
  let configMap: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    configMap = { 'sign.mode': 'EXTERNAL', 'sign.url': 'http://127.0.0.1:4100/v1', 'sign.apiKey': 'KEY' };
    const config = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    mockPrisma = {
      issuedDocument: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      consentForm: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
      patient: { findUnique: vi.fn().mockResolvedValue({ ci: 'enc:xxx', phone: '010', familyName: '김', givenName: '환자' }) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    // 🔴 정본은 제출 뒤 두 바인딩(ConsentForm·IssuedDocument)을 한 트랜잭션에서 쓴다(K1) —
    //    목에 `$transaction` 이 없으면 바인딩이 통째로 실패해 가드가 **결함이 아닌 이유로** 실패한다.
    mockPrisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    mockDocuments = {
      issue: vi.fn().mockResolvedValue({ issueNo: 'WRB-CONSENT-20260722-0001' }),
      generatePdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
    };
    service = new SignIntegrationService(
      config as any, mockPrisma, mockDocuments,
      {} as any, // redis
      {} as any, // keyCustody
      { enqueue: vi.fn() } as any, // outbox
    );
  });

  it('requestDocumentSign — 동일 (type,source,snapshot 해시) 기존 ORIGINAL 재사용(중복 발급 없음·멱등)', async () => {
    mockPrisma.issuedDocument.findFirst.mockResolvedValue({ issueNo: 'WRB-CONSENT-20260722-0001' });
    const submitSpy = vi.spyOn(service, 'submitSignRequest').mockResolvedValue({ signatureRequestId: 'req-1' } as any);
    const r = await service.requestDocumentSign({ documentType: 'CONTRACT', sourceId: 'cf-1', snapshot: { a: 1 }, channel: 'PORTAL', patientId: 'p-1' });
    expect(r.issueNo).toBe('WRB-CONSENT-20260722-0001');
    expect(mockDocuments.issue).not.toHaveBeenCalled(); // 재발급 없음
    expect(submitSpy).toHaveBeenCalledWith(expect.objectContaining({ issueNo: 'WRB-CONSENT-20260722-0001' }));
  });

  it('requestDocumentSign — 기존 없으면 신규 발급(기존 동작 유지)', async () => {
    vi.spyOn(service, 'submitSignRequest').mockResolvedValue({} as any);
    await service.requestDocumentSign({ documentType: 'CONTRACT', sourceId: 'cf-1', snapshot: { a: 1 }, channel: 'PORTAL', patientId: 'p-1' });
    expect(mockDocuments.issue).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 (2026-10-12) 동의서 서명 대상 = 서버가 동결한 동의서 본문 HTML.
   *    종전엔 화면이 보낸 스냅샷(제목·종류·id)을 발급했고 서버 PDF 는 동의서 양식이 없어 "로딩 중…"만 찍혔다 — 그 해시가 서명 대상이었다.
   */
  it('🔴 동의서 — 화면 스냅샷을 쓰지 않고 동의서 정본 HTML 을 동결해 발급한다', async () => {
    const consentPdf = { generateConsentFormPdf: vi.fn(async () => '<html>동의서 본문 — 수술 위험·대안</html>') };
    const svc = new SignIntegrationService({ get: vi.fn(async (k: string) => configMap[k] ?? null) } as any, mockPrisma, mockDocuments, {} as any, {} as any, { enqueue: vi.fn() } as any, consentPdf as any);
    mockPrisma.consentForm.findUnique.mockResolvedValue({ id: 'cf-1', patientId: 'p-9', consentType: 'SURGERY', templateName: '수술 동의서', content: { sections: [{ title: '수술 내용', body: '복강경 담낭절제술' }] }, risks: '출혈', alternatives: null, explanation: null });
    vi.spyOn(svc, 'submitSignRequest').mockResolvedValue({} as any);
    await svc.requestDocumentSign({ documentType: 'CONSENT', sourceId: 'whatever', consentFormId: 'cf-1', snapshot: { title: '화면이 보낸 것' }, channel: 'PORTAL', patientId: 'p-1' });
    const issued = mockDocuments.issue.mock.calls[0][0];
    expect(issued).toMatchObject({ documentType: 'CONSENT', sourceId: 'cf-1', patientId: 'p-9' });
    expect(issued.snapshot).toMatchObject({ html: '<html>동의서 본문 — 수술 위험·대안</html>', consentFormId: 'cf-1', consentType: 'SURGERY' });
    expect(JSON.stringify(issued.snapshot)).not.toContain('화면이 보낸 것');
    expect(consentPdf.generateConsentFormPdf).toHaveBeenCalledWith('cf-1', undefined, { forSigning: true }); // 출력 시각 없는 결정적 HTML
  });
  it('🔴 본문 없는 동의서는 서명 요청을 만들지 않는다', async () => {
    const consentPdf = { generateConsentFormPdf: vi.fn(async () => '<html/>') };
    const svc = new SignIntegrationService({ get: vi.fn(async (k: string) => configMap[k] ?? null) } as any, mockPrisma, mockDocuments, {} as any, {} as any, { enqueue: vi.fn() } as any, consentPdf as any);
    mockPrisma.consentForm.findUnique.mockResolvedValue({ id: 'cf-2', patientId: 'p', consentType: 'GENERAL', templateName: 't', content: {}, risks: '출혈만 있음', alternatives: null, explanation: null });
    await expect(svc.requestDocumentSign({ documentType: 'CONSENT', sourceId: 'cf-2', consentFormId: 'cf-2', channel: 'PORTAL', patientId: 'p' })).rejects.toThrow(/본문이 없는/);
    expect(mockDocuments.issue).not.toHaveBeenCalled();
  });
  it('🔴 동의서 — 동의서 id 가 없거나 본문 생성기가 없으면 발급·서명 요청을 만들지 않는다', async () => {
    await expect(service.requestDocumentSign({ documentType: 'CONSENT', sourceId: 'cf-1', snapshot: { a: 1 }, channel: 'PORTAL', patientId: 'p-1' })).rejects.toThrow(BadRequestException);
    await expect(service.requestDocumentSign({ documentType: 'CONSENT', sourceId: 'cf-1', consentFormId: 'cf-1', channel: 'PORTAL', patientId: 'p-1' })).rejects.toThrow(/본문 생성기/);
    expect(mockDocuments.issue).not.toHaveBeenCalled();
  });

  it('submitSignRequest — PORTAL + patientId 없음(다중봉투/ERP ref도 없음) → 400', async () => {
    await expect(service.submitSignRequest({ issueNo: 'X', signerUserId: 'u-1', channel: 'PORTAL' })).rejects.toThrow(BadRequestException);
    expect(mockDocuments.generatePdf).not.toHaveBeenCalled();
  });

  it('submitSignRequest — CI 복호 실패는 500 대신 CI 생략 제출(비차단)', async () => {
    const r = await service.submitSignRequest({ issueNo: 'X', signerUserId: 'u-1', channel: 'PORTAL', patientId: 'p-1' });
    expect(r.signatureRequestId).toBe('req-1');
    const sentBody = JSON.parse((vi.mocked(safeFetch).mock.calls[0][1] as any).body);
    expect(sentBody.patientSigner.name).toBe('김환자');
    expect(sentBody.patientSigner.ci).toBeUndefined(); // 복호 실패 → 생략
  });

  it('SSRF — sign.url 호스트가 allowlist(기본값) 밖이면 차단(자기참조 allowlist 무력화 봉합)', async () => {
    configMap['sign.url'] = 'http://169.254.169.254/v1'; // 내부 메타데이터 주소로 변조 시도
    await expect(service.submitSignRequest({ issueNo: 'X', signerUserId: 'u-1', channel: 'PORTAL', patientId: 'p-1' })).rejects.toThrow(ForbiddenException);
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled();
  });

  it('SSRF — sign.allowedHosts csv 로 허용 호스트 확장 가능', async () => {
    configMap['sign.url'] = 'http://sign-internal:4100/v1';
    configMap['sign.allowedHosts'] = '127.0.0.1, sign-internal';
    const r = await service.submitSignRequest({ issueNo: 'X', signerUserId: 'u-1', channel: 'PORTAL', patientId: 'p-1' });
    expect(r.signatureRequestId).toBe('req-1');
    const opts = vi.mocked(safeFetch).mock.calls[0][2] as any;
    expect(opts.allowedHosts).toEqual(['127.0.0.1', 'sign-internal']);
  });
});
