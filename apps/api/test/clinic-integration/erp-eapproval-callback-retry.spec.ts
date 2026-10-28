import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

const safeFetch = vi.fn();
vi.mock('../../src/common/util/safe-fetch', async (orig) => ({
  ...(await orig<typeof import('../../src/common/util/safe-fetch')>()),
  safeFetch: (...a: unknown[]) => safeFetch(...a),
}));

import { ErpEapprovalService } from '../../src/modules/clinic-integration/erp-eapproval.service';
import { IntegrationOutboxService } from '../../src/modules/integration/integration-outbox.service';
import { EAPPROVAL_OUTBOX } from '../../src/modules/clinic-integration/eapproval-callback';

/**
 * 🔴 전자결재 결과 콜백 자동 재시도.
 *
 * 즉시 3회가 실패하면 종전엔 Clinic 이 같은 결과를 다시 보내 줄 때까지 **아무도 다시 보내지 않았다**.
 * 스키마를 늘리지 않고 **기존 연동 아웃박스**(백오프·상한·운영 모드 보류·관리 화면)에 맡긴다 — 옆에 약한 재시도 엔진을 만들지 않는다.
 *  · 재시도는 즉시 전달과 **같은 본문·같은 서명**(봉투 없음 — ERP 가 같은 것을 받는다)
 *  · 발송 직전 확인 — 결과가 바뀌었거나 이미 전달됐으면 보내지 않고 CANCELLED(사유) · SENT 로 적지 않는다
 *  · 발송 성공 → 릴레이 callbackDelivered=true(그 결과일 때만)
 * 재주입: 최종 실패 뒤 적재를 지우면 ① 이, preflight 의 결과 비교를 지우면 ③ 이, EAPPROVAL 분기를 지우면 ⑤ 가 실패한다.
 */
type Relay = { id: string; approvalId: string; refModule: string; refId: string; callbackUrl: string; status: string; result: string | null; callbackDelivered: boolean };

function makeSvc(initial: Partial<Relay> = {}, outbox?: unknown) {
  const relay: Relay = {
    id: 'relay-1', approvalId: 'doc-1', refModule: 'erp.purchase', refId: 'po-1', callbackUrl: 'https://erp.example.com/cb',
    status: 'PENDING', result: null, callbackDelivered: false, ...initial,
  };
  const prisma = {
    eApprovalRelay: {
      findUnique: vi.fn(async () => ({ ...relay })),
      update: vi.fn(async ({ data }: { data: Partial<Relay> }) => { Object.assign(relay, data); return { ...relay }; }),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<Relay>; data: Partial<Relay> }) => {
        const hit = where.id === relay.id && where.result === relay.result && where.callbackDelivered === relay.callbackDelivered;
        if (hit) Object.assign(relay, data);
        return { count: hit ? 1 : 0 };
      }),
    },
  };
  const config = { get: vi.fn((k: string) => (k === 'EAPPROVAL_CALLBACK_SECRET' ? 'cb-secret' : k === 'EAPPROVAL_CALLBACK_HOSTS' ? 'erp.example.com' : '')) };
  const svc = new ErpEapprovalService(prisma as never, {} as never, config as never, undefined, outbox as never);
  return { svc, relay, prisma };
}

async function run(p: Promise<unknown>) {
  const done = p.then(() => 'done');
  for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(5000); }
  return done;
}

describe('전자결재 콜백 — 즉시 3회 실패하면 아웃박스로 자동 재시도', () => {
  beforeEach(() => { vi.useFakeTimers(); safeFetch.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('🔴 ① 3회 실패 → 같은 본문으로 아웃박스 적재(대상 주소·EAPPROVAL 포맷·릴레이·결과 키) · 원장은 미전달', async () => {
    const outbox = { enqueueDirect: vi.fn(async () => 'QUEUED'), registerDomainHooks: vi.fn() };
    const { svc, relay } = makeSvc({}, outbox);
    safeFetch.mockResolvedValue({ ok: false, status: 503 });
    await run(svc.handleWsignResult('doc-1', 'wsign.approved', { eventId: 'evt-1', approvedBy: '김과장' }));
    expect(safeFetch).toHaveBeenCalledTimes(3);
    expect(relay.callbackDelivered).toBe(false);
    expect(outbox.enqueueDirect).toHaveBeenCalledTimes(1);
    const arg = (outbox.enqueueDirect.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg).toMatchObject({ domain: 'eapproval', event: 'eapproval.callback', format: 'EAPPROVAL', ref: 'relay-1:APPROVED', targetUrl: 'https://erp.example.com/cb' });
    // 즉시 전달 때 보낸 본문 그대로(event_id 가 같아야 ERP 가 중복을 가린다)
    expect(arg.payload).toEqual(JSON.parse(safeFetch.mock.calls[0][1].body));
  });

  it('대조군 — 즉시 전달 성공이면 적재하지 않는다 · egress 차단(재시도해도 같음)도 적재하지 않는다', async () => {
    const outbox = { enqueueDirect: vi.fn(async () => 'QUEUED'), registerDomainHooks: vi.fn() };
    const { svc, relay } = makeSvc({}, outbox);
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await run(svc.handleWsignResult('doc-1', 'wsign.approved', { eventId: 'evt-1' }));
    expect(relay.callbackDelivered).toBe(true);
    expect(outbox.enqueueDirect).not.toHaveBeenCalled();

    const { EgressBlockedError } = await import('../../src/common/util/safe-fetch');
    const b = makeSvc({}, outbox);
    safeFetch.mockReset();
    safeFetch.mockRejectedValue(new EgressBlockedError('blocked'));
    await run(b.svc.handleWsignResult('doc-1', 'wsign.rejected', { eventId: 'evt-2' }));
    expect(outbox.enqueueDirect).not.toHaveBeenCalled();
  });

  it('② 아웃박스가 없어도 던지지 않는다(종전 동작 — 재수신 때만 재전달)', async () => {
    const { svc, relay } = makeSvc({});
    safeFetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(run(svc.handleWsignResult('doc-1', 'wsign.approved', { eventId: 'evt-1' }))).resolves.toBe('done');
    expect(relay.callbackDelivered).toBe(false);
  });
});

describe('발송 직전 확인·발송 후 표시', () => {
  const row = (ref: string) => ({ id: 'o1', domain: 'eapproval', event: 'eapproval.callback', ref, payload: {}, attempts: 0 });

  it('🔴 ③ 결과가 바뀌었거나 이미 전달됐으면 보내지 않는다 · 대조군: 같은 결과·미전달이면 보낸다', async () => {
    expect(await makeSvc({ result: 'REJECTED' }).svc.outboxPreflight(row('relay-1:APPROVED'))).toMatchObject({ send: false });
    expect(await makeSvc({ result: 'APPROVED', callbackDelivered: true }).svc.outboxPreflight(row('relay-1:APPROVED'))).toMatchObject({ send: false });
    expect(await makeSvc({ result: 'APPROVED' }).svc.outboxPreflight(row('relay-1:APPROVED'))).toEqual({ send: true });
  });

  it('④ 발송 성공 → 그 결과일 때만 callbackDelivered=true(조건부)', async () => {
    const a = makeSvc({ result: 'APPROVED' });
    await a.svc.outboxOnSent(row('relay-1:APPROVED'));
    expect(a.relay.callbackDelivered).toBe(true);
    const b = makeSvc({ result: 'REJECTED' });
    await b.svc.outboxOnSent(row('relay-1:APPROVED'));
    expect(b.relay.callbackDelivered).toBe(false);
  });
});

describe('아웃박스 디스패처 — EAPPROVAL 포맷', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    safeFetch.mockReset();
    process.env.EAPPROVAL_CALLBACK_SECRET = 'cb-secret';
    process.env.EAPPROVAL_CALLBACK_HOSTS = 'erp.example.com';
  });
  afterEach(() => { process.env = { ...OLD }; });

  function makeOutbox(rows: unknown[]) {
    const prisma = { integrationOutbox: { findMany: vi.fn().mockResolvedValue(rows), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, hisWebhook: { updateMany: vi.fn() } };
    const svc = new IntegrationOutboxService(prisma as never, { get: vi.fn().mockResolvedValue('') } as never, { effective: vi.fn().mockResolvedValue('REAL') } as never);
    return { svc, prisma };
  }
  const body = { approval_id: 'doc-1', result: 'APPROVED', event_id: 'evt-1' };
  const erow = { id: 'o1', domain: EAPPROVAL_OUTBOX.domain, event: EAPPROVAL_OUTBOX.event, ref: 'relay-1:APPROVED', payload: body, format: 'EAPPROVAL', targetUrl: 'https://erp.example.com/cb', secret: null, attempts: 2, maxAttempts: 6 };

  it('🔴 ⑤ 봉투 없이 같은 본문 · 즉시 전달과 같은 X-Signature · 허용 호스트 · 성공이면 SENT + 원장 표시', async () => {
    const { svc, prisma } = makeOutbox([erow]);
    const onSent = vi.fn(async () => {});
    svc.registerDomainHooks('eapproval', { preflight: async () => ({ send: true }), onSent });
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await svc.dispatch();
    const [url, init, opts] = safeFetch.mock.calls[0];
    expect(url).toBe('https://erp.example.com/cb');
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.headers['X-Signature']).toBe(`sha256=${createHmac('sha256', 'cb-secret').update(init.body).digest('hex')}`);
    expect(init.headers['X-Integration-Key']).toBeUndefined();
    expect(opts.allowedHosts).toEqual(['erp.example.com']);
    expect(prisma.integrationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'PENDING' }, data: expect.objectContaining({ status: 'SENT', attempts: 3 }) });
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('🔴 ⑥ 발송 직전 확인이 거절하면 보내지 않고 CANCELLED(사유) — SENT 로 적지 않는다', async () => {
    const { svc, prisma } = makeOutbox([erow]);
    svc.registerDomainHooks('eapproval', { preflight: async () => ({ send: false, reason: '결과가 바뀜' }) });
    await svc.dispatch();
    expect(safeFetch).not.toHaveBeenCalled();
    expect(prisma.integrationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'PENDING' }, data: { status: 'CANCELLED', lastError: '결과가 바뀜' } });
  });

  it('⑦ 실패는 아웃박스 재시도(백오프) · 서명 비밀이 없으면 보내지 않고 재시도 계수', async () => {
    const { svc, prisma } = makeOutbox([erow]);
    svc.registerDomainHooks('eapproval', { preflight: async () => ({ send: true }) });
    safeFetch.mockResolvedValue({ ok: false, status: 502 });
    await svc.dispatch();
    expect(prisma.integrationOutbox.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attempts: 3, lastError: 'HTTP 502' }) }));

    delete process.env.EAPPROVAL_CALLBACK_SECRET;
    safeFetch.mockReset();
    const b = makeOutbox([erow]);
    b.svc.registerDomainHooks('eapproval', { preflight: async () => ({ send: true }) });
    await b.svc.dispatch();
    expect(safeFetch).not.toHaveBeenCalled();
    expect(b.prisma.integrationOutbox.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.stringContaining('EAPPROVAL_CALLBACK_SECRET') }) }));
  });
});

describe('아웃박스 대상 지정 적재(enqueueDirect)', () => {
  function makeTx(existing: { status: string } | null) {
    const tx = {
      integrationOutbox: {
        updateMany: vi.fn(async ({ where }: { where: { status: { in: string[] } } }) => ({ count: existing && where.status.in.includes(existing.status) ? 1 : 0 })),
        findUnique: vi.fn(async () => (existing ? { id: 'o1' } : null)),
        create: vi.fn(async () => ({})),
      },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    const svc = new IntegrationOutboxService(prisma as never, { get: vi.fn() } as never, { effective: vi.fn() } as never);
    return { svc, tx };
  }
  const row = { domain: 'eapproval', event: 'eapproval.callback', ref: 'relay-1:APPROVED', payload: { a: 1 }, targetUrl: 'https://erp/cb', format: 'EAPPROVAL' };

  it('없으면 적재 · FAILED/CANCELLED 는 되살림(조건부) · PENDING/SENT 는 그대로(중복 발송 없음)', async () => {
    const a = makeTx(null);
    expect(await a.svc.enqueueDirect(row)).toBe('QUEUED');
    expect(a.tx.integrationOutbox.create).toHaveBeenCalledTimes(1);
    for (const st of ['FAILED', 'CANCELLED']) {
      const b = makeTx({ status: st });
      expect(await b.svc.enqueueDirect(row), st).toBe('REVIVED');
      expect(b.tx.integrationOutbox.create).not.toHaveBeenCalled();
    }
    for (const st of ['PENDING', 'SENT']) {
      const c = makeTx({ status: st });
      expect(await c.svc.enqueueDirect(row), st).toBe('EXISTS');
      expect(c.tx.integrationOutbox.create).not.toHaveBeenCalled();
    }
  });

  it('동시 적재 경합(유니크 위반)은 이미 있음으로 — 던지지 않는다', async () => {
    const prisma = { $transaction: vi.fn(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); }) };
    const svc = new IntegrationOutboxService(prisma as never, { get: vi.fn() } as never, { effective: vi.fn() } as never);
    expect(await svc.enqueueDirect(row)).toBe('EXISTS');
  });
});
