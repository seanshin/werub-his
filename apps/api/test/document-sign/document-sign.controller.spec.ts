import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentSignController } from '../../src/modules/document-sign/document-sign.controller';

describe('DocumentSignController', () => {
  let controller: DocumentSignController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      sign: vi.fn(),
      verify: vi.fn(),
      getSignedDocument: vi.fn(),
      getSignHistory: vi.fn(),
      initMultiSign: vi.fn(),
      getMultiSignStatus: vi.fn(),
      getEnvelope: vi.fn(),
    };
    controller = new DocumentSignController(mockService);
  });

  it('sign should return { data: result }', async () => {
    const signResult = { signedDocument: { id: 'sdoc-1' }, signature: { id: 'sig-1' } };
    mockService.sign.mockResolvedValue(signResult);

    const body = {
      documentType: 'CONSENT', documentId: 'doc-1', certificateId: 'cert-1', documentHash: 'h', signatureValue: 'v',
      signatureAlgorithm: 'ECDSA_P256', signerRole: 'PRIMARY', signerType: 'STAFF' as const, signerUserId: 'forged-user',
    };
    const result = await controller.sign(body, 'caller-1', { ip: '10.0.0.9', headers: { 'user-agent': 'ua' } });

    expect(result).toEqual({ data: signResult });
    // 🔴 (B7) 본문 signerUserId 는 서비스에 가지 않는다 — 서명자·증빙은 인증 주체·요청 연결
    const [data, actor] = mockService.sign.mock.calls[0];
    expect(data).not.toHaveProperty('signerUserId');
    expect(actor).toEqual({ userId: 'caller-1', ipAddress: '10.0.0.9', userAgent: 'ua' });
  });

  it('verify should return { data: result }', async () => {
    const verifyResult = { documentId: 'sdoc-1', allSignaturesValid: true };
    mockService.verify.mockResolvedValue(verifyResult);

    const result = await controller.verify({ signedDocumentId: 'sdoc-1' });

    expect(result).toEqual({ data: verifyResult });
    expect(mockService.verify).toHaveBeenCalledWith('sdoc-1');
  });

  it('getSignedDocument should return { data: result }', async () => {
    const doc = { id: 'sdoc-1', documentType: 'CONSENT' };
    mockService.getSignedDocument.mockResolvedValue(doc);

    const result = await controller.getSignedDocument('CONSENT', 'doc-1');

    expect(result).toEqual({ data: doc });
    expect(mockService.getSignedDocument).toHaveBeenCalledWith('CONSENT', 'doc-1');
  });

  describe('getSignHistory — self-scope IDOR 봉합(v3.96)', () => {
    it('ADMIN 은 userId 로 타인 이력 조회 가능(감사 업무)', async () => {
      const history = [{ id: 'sig-1' }];
      mockService.getSignHistory.mockResolvedValue(history);

      const result = await controller.getSignHistory('caller-1', 'ADMIN', 'other-user', 'patient-1');

      expect(result).toEqual({ data: history });
      expect(mockService.getSignHistory).toHaveBeenCalledWith('other-user', 'patient-1');
    });

    it('🔴 비ADMIN 이 타인 userId 를 넘겨도 본인으로 고정 — 타인 문서·인증서 일련번호 훑기 차단', async () => {
      mockService.getSignHistory.mockResolvedValue([]);

      await controller.getSignHistory('caller-1', 'DOCTOR', 'other-user', undefined);

      expect(mockService.getSignHistory).toHaveBeenCalledWith('caller-1', undefined);
    });

    it('비ADMIN 이 userId 없이 부르면 사용자 스코프 없음(환자 문맥 조회는 유지)', async () => {
      mockService.getSignHistory.mockResolvedValue([]);

      await controller.getSignHistory('caller-1', 'NURSE', undefined, 'patient-1');

      expect(mockService.getSignHistory).toHaveBeenCalledWith(undefined, 'patient-1');
    });
  });

  it('initMultiSign should return { data: result }', async () => {
    const multiDoc = { id: 'sdoc-1', requiredSigners: 3 };
    mockService.initMultiSign.mockResolvedValue(multiDoc);

    const body = { documentType: 'CONSENT', documentId: 'doc-2', documentHash: 'hash', requiredSigners: 3 };
    const result = await controller.initMultiSign(body);

    expect(result).toEqual({ data: multiDoc });
    expect(mockService.initMultiSign).toHaveBeenCalledWith(body);
  });

  it('getMultiSignStatus should return { data: result }', async () => {
    const status = { id: 'sdoc-1', remaining: 2, isTimedOut: false };
    mockService.getMultiSignStatus.mockResolvedValue(status);

    const result = await controller.getMultiSignStatus('sdoc-1');

    expect(result).toEqual({ data: status });
    expect(mockService.getMultiSignStatus).toHaveBeenCalledWith('sdoc-1');
  });

  it('getEnvelope should return { data: result }', async () => {
    const envelope = { envelope: { documentId: 'doc-1' } };
    mockService.getEnvelope.mockResolvedValue(envelope);

    const result = await controller.getEnvelope('sdoc-1');

    expect(result).toEqual({ data: envelope });
    expect(mockService.getEnvelope).toHaveBeenCalledWith('sdoc-1');
  });

  it('checkTimeouts is not exposed via controller (internal cron)', async () => {
    // checkTimeouts is a service-only method, not exposed as an endpoint
    expect((controller as any).checkTimeouts).toBeUndefined();
  });
});
