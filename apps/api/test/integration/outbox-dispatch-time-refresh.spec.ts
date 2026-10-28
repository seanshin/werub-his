import { describe, it, expect, vi, beforeEach } from 'vitest';

const safeFetch = vi.fn();
vi.mock('../../src/common/util/safe-fetch', async (orig) => ({
  ...(await orig<typeof import('../../src/common/util/safe-fetch')>()),
  safeFetch: (...a: unknown[]) => safeFetch(...a),
}));

import { IntegrationOutboxService } from '../../src/modules/integration/integration-outbox.service';
import { refreshSignCompletedDocument, SignIntegrationService } from '../../src/modules/sign-integration/sign-integration.service';

/**
 * 🔴 `sign.completed` 완료본 URL 토큰(24h)을 **적재 시점**에 만들던 것 — 외부 점검.
 * 리허설 보류·FAILED 후 수동 재시도로 하루 넘게 지나 나가면 ERP 가 만료된 URL 을 받았다.
 * 디스패처가 발송 직전에 갱신기를 불러 새 토큰으로 보내는지 본다.
 */
const STALE = { issueNo: 'DOC-1', contentType: 'application/pdf', url: 'https://his/api/v1/documents/dl/DOC-1?t=OLD', expiresAt: '2026-09-01T00:00:00.000Z' };

function make(rows: any[]) {
  const prisma = {
    integrationOutbox: {
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
    },
    hisWebhook: { updateMany: vi.fn().mockResolvedValue({}) },
  } as any;
  const config = { get: vi.fn().mockResolvedValue('') } as any;
  const hisMode = { effective: vi.fn().mockResolvedValue('REAL') } as any;
  return { svc: new IntegrationOutboxService(prisma, config, hisMode), prisma };
}

const row = (event: string, payload: object) => ({
  id: `o-${event}`, ref: `ref-${event}`, event, payload, format: null, targetUrl: 'https://erp.example/hook',
  secret: null, attempts: 0, maxAttempts: 6,
});

const sentPayload = (callIdx = 0) => JSON.parse(safeFetch.mock.calls[callIdx][1].body).payload;

describe('outbox — 발송 시점 갱신(sign.completed 완료본 URL)', () => {
  beforeEach(() => { safeFetch.mockReset(); safeFetch.mockResolvedValue({ ok: true, status: 200 }); });

  it('🔴 늦게 나가는 sign.completed 는 발송 시점에 새 토큰으로 나간다', async () => {
    const { svc, prisma } = make([row('sign.completed', { signatureRequestId: 'sr-1', document: STALE })]);
    const mint = vi.fn(() => ({ url: 'https://his/api/v1/documents/dl/DOC-1?t=NEW', expiresAt: '2026-09-29T10:00:00.000Z' }));
    svc.registerPayloadRefresher('sign.completed', (p) => refreshSignCompletedDocument(p, mint));

    await svc.dispatch();

    expect(mint).toHaveBeenCalledWith('DOC-1');
    expect(sentPayload().document.url).toContain('t=NEW');
    expect(sentPayload().document.expiresAt).toBe('2026-09-29T10:00:00.000Z');
    expect(sentPayload().document.issueNo).toBe('DOC-1');
    // 원장(저장된 페이로드)은 바꾸지 않는다 — 상태만 SENT
    expect(prisma.integrationOutbox.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ payload: expect.anything() }) }));
  });

  it('대조군 — 다른 이벤트는 손대지 않는다', async () => {
    const { svc } = make([row('stock.changed', { sku: 'A', document: STALE })]);
    svc.registerPayloadRefresher('sign.completed', (p) => refreshSignCompletedDocument(p, () => ({ url: 'NEW', expiresAt: 'x' })));
    await svc.dispatch();
    expect(sentPayload().document.url).toContain('t=OLD');
  });

  it('대조군 — 완료본이 없는 sign.completed 는 그대로(지어내지 않는다)', async () => {
    const { svc } = make([row('sign.completed', { signatureRequestId: 'sr-2', auditCertUri: 'https://sign/cert' })]);
    const mint = vi.fn(() => ({ url: 'NEW', expiresAt: 'x' }));
    svc.registerPayloadRefresher('sign.completed', (p) => refreshSignCompletedDocument(p, mint));
    await svc.dispatch();
    expect(mint).not.toHaveBeenCalled();
    expect(sentPayload()).toEqual({ signatureRequestId: 'sr-2', auditCertUri: 'https://sign/cert' });
  });

  it('갱신 실패는 발송을 막지 않고 적재 시점 값으로 보낸다(성공은 성공으로)', async () => {
    const { svc, prisma } = make([row('sign.completed', { document: STALE })]);
    svc.registerPayloadRefresher('sign.completed', () => { throw new Error('kms down'); });
    await svc.dispatch();
    expect(sentPayload().document.url).toContain('t=OLD');
    expect(prisma.integrationOutbox.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }));
  });

  it('배선 — sign 모듈이 기동 시 sign.completed 갱신기를 등록하고, 그 갱신기는 DocumentService.downloadUrl 로 만든다', () => {
    const outbox = { registerPayloadRefresher: vi.fn() };
    const documents = { downloadUrl: vi.fn(() => ({ url: 'https://his/dl/DOC-9?t=FRESH', expiresAt: 'e' })) };
    const svc = new SignIntegrationService({} as never, {} as never, documents as never, {} as never, {} as never, outbox as never);
    svc.onModuleInit();
    expect(outbox.registerPayloadRefresher).toHaveBeenCalledWith('sign.completed', expect.any(Function));
    const fn = outbox.registerPayloadRefresher.mock.calls[0][1];
    expect(fn({ document: { issueNo: 'DOC-9', url: 'old' } }).document.url).toContain('t=FRESH');
    expect(documents.downloadUrl).toHaveBeenCalledWith('DOC-9');
  });
});
