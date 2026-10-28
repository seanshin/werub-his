import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const safeFetch = vi.fn();
vi.mock('../../src/common/util/safe-fetch', async (orig) => ({
  ...(await orig<typeof import('../../src/common/util/safe-fetch')>()),
  safeFetch: (...a: unknown[]) => safeFetch(...a),
}));

import { ErpEapprovalService } from '../../src/modules/clinic-integration/erp-eapproval.service';

/**
 * 🔴 전자결재 결과 콜백 영구 유실 — 외부 점검.
 *
 * 상태를 **전달 전에** 종결로 바꾸고, ERP 콜백이 3회 실패하면 로그 한 줄로 끝났다. Clinic 이 같은 결과를
 * 다시 보내도 "같은 결과 = 멱등 생략"에 걸려 **ERP 는 결재 결과를 영영 받지 못했다.**
 * 목은 Prisma `EApprovalRelay` 모델의 실제 컬럼 모양(`callbackDelivered` 포함)을 쓰고, update 를 실제로 반영한다.
 */
type Relay = {
  id: string; approvalId: string; docType: string; refModule: string; refId: string; callbackUrl: string;
  status: string; result: string | null; callbackDelivered: boolean; decidedAt: Date | null;
};

function make(initial: Partial<Relay> = {}) {
  const relay: Relay = {
    id: 'relay-1', approvalId: 'doc-1', docType: 'HR_PURCHASE', refModule: 'erp.purchase', refId: 'po-1',
    callbackUrl: 'https://erp.example.com/cb', status: 'PENDING', result: null, callbackDelivered: false, decidedAt: null,
    ...initial,
  };
  const prisma = {
    eApprovalRelay: {
      findUnique: vi.fn(async () => ({ ...relay })),
      update: vi.fn(async ({ data }: { data: Partial<Relay> }) => { Object.assign(relay, data); return { ...relay }; }),
    },
  };
  const config = { get: vi.fn((k: string) => (k === 'EAPPROVAL_CALLBACK_SECRET' ? 'cb-secret' : k === 'EAPPROVAL_CALLBACK_HOSTS' ? 'erp.example.com' : '')) };
  const svc = new ErpEapprovalService(prisma as never, {} as never, config as never);
  return { svc, relay, prisma };
}

/** deliverCallback 의 백오프(1·2·4초)를 기다리지 않게 타이머를 돌리며 끝까지 실행 */
async function run(p: Promise<unknown>) {
  const done = p.then(() => 'done');
  for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(5000); }
  return done;
}

describe('전자결재 결과 콜백 — 미전달은 재수신 때 다시 보낸다', () => {
  beforeEach(() => { vi.useFakeTimers(); safeFetch.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('🔴 ERP 콜백이 3회 실패한 뒤 같은 결과가 다시 오면 재전달한다(종전: 멱등 생략으로 영구 유실)', async () => {
    const { svc, relay } = make();
    safeFetch.mockResolvedValue({ ok: false, status: 503 });
    await run(svc.handleWsignResult('doc-1', 'wsign.approved', { eventId: 'evt-1', approvedBy: '김과장' }));
    expect(safeFetch).toHaveBeenCalledTimes(3);
    expect(relay.status).toBe('APPROVED');
    expect(relay.callbackDelivered, '실패했는데 전달로 적혔다').toBe(false);

    safeFetch.mockReset();
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await run(svc.handleWsignResult('doc-1', 'wsign.approved', { eventId: 'evt-1', approvedBy: '김과장' }));
    expect(safeFetch, '미전달인데 재수신을 멱등으로 삼켰다').toHaveBeenCalledTimes(1);
    const body = JSON.parse(safeFetch.mock.calls[0][1].body);
    expect(body).toEqual(expect.objectContaining({ approval_id: 'doc-1', result: 'APPROVED', event_id: 'evt-1', approved_by: '김과장' }));
    expect(relay.callbackDelivered).toBe(true);
  });

  it('대조군 — 이미 전달된 결과의 재수신은 멱등 생략(ERP 중복 수신을 만들지 않는다)', async () => {
    const { svc } = make({ status: 'APPROVED', result: 'APPROVED', callbackDelivered: true });
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await run(svc.handleWsignResult('doc-1', 'wsign.approved', { eventId: 'evt-1' }));
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('대조군 — 첫 전달이 성공하면 한 번만 보내고 전달로 적는다', async () => {
    const { svc, relay } = make();
    safeFetch.mockResolvedValue({ ok: true, status: 200 });
    await run(svc.handleWsignResult('doc-1', 'wsign.rejected', { eventId: 'evt-2' }));
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(relay).toEqual(expect.objectContaining({ status: 'REJECTED', result: 'REJECTED', callbackDelivered: true }));
  });

  it('🔴 결과가 바뀌면 원장은 "미전달"부터 — 이전 결과의 전달 표시를 물려받지 않는다', async () => {
    const { svc, prisma } = make({ status: 'APPROVED', result: 'APPROVED', callbackDelivered: true });
    safeFetch.mockResolvedValue({ ok: false, status: 500 });
    await run(svc.handleWsignResult('doc-1', 'wsign.withdrawn', { eventId: 'evt-3' }));
    expect(prisma.eApprovalRelay.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'WITHDRAWN', callbackDelivered: false }),
    }));
  });
});
