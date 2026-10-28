import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwinController } from '../../src/modules/twin/twin.controller';

/**
 * 🔴 r3 B2 — 트윈 CDS 실패가 "위험 카드 0장"과 같은 모양이었다.
 *
 * 401(고정 Bearer 불일치)·5xx·타임아웃·미설정이 전부 `{cards:[]}` → 차트는 철회 링크만 그렸고,
 * 의료진은 "ASCVD/eGFR 경보 없음"과 "트윈 응답 없음"을 가를 수 없었다(P17).
 * 못박는 것: 실패는 `status≠'OK'` 로 실리고, 트윈이 실제로 답한 0장만 `status:'OK'` 다(대조군).
 */

const PID = '11111111-1111-4111-8111-111111111111';
const URL = 'http://93.184.216.34:8080'; // 공인 IP 리터럴 — safeFetch 해석 검사를 지난다(fetch 는 가로챈다)

function ctrlWith(env: Record<string, string>, consented = true) {
  const config = { get: vi.fn((k: string) => env[k] ?? '') };
  const prisma = {
    patientAiConsent: { findUnique: vi.fn().mockResolvedValue(consented ? { consented: true, revokedAt: null } : null) },
  };
  return new TwinController(config as never, prisma as never, {} as never, {} as never);
}
const configured = { TWIN_LAUNCH_SECRET: 'sec', TWIN_BASE_URL: URL };

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => fetchSpy.mockRestore());

describe('트윈 CDS — 실패는 "카드 0장"이 아니다', () => {
  it('🔴 상류 401 → UNAVAILABLE · upstreamStatus 401', async () => {
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const { data } = await ctrlWith(configured).cdsPatientView(PID);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(data).toMatchObject({ cards: [], status: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR', upstreamStatus: 401 });
  });

  it('🔴 상류 503 → UNAVAILABLE', async () => {
    fetchSpy.mockResolvedValue(new Response('down', { status: 503 }));
    const { data } = await ctrlWith(configured).cdsPatientView(PID);
    expect(data.status).toBe('UNAVAILABLE');
    expect(data.upstreamStatus).toBe(503);
  });

  it('🔴 네트워크 실패·타임아웃 → UNAVAILABLE(NETWORK)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    const { data } = await ctrlWith(configured).cdsPatientView(PID);
    expect(data).toMatchObject({ cards: [], status: 'UNAVAILABLE', reason: 'NETWORK' });
  });

  it('🔴 응답에 cards 배열이 없으면 0장으로 읽지 않는다(BAD_RESPONSE)', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 200 }));
    const { data } = await ctrlWith(configured).cdsPatientView(PID);
    expect(data).toMatchObject({ status: 'UNAVAILABLE', reason: 'BAD_RESPONSE' });
  });

  it('🔴 미설정 → UNCONFIGURED(보내지 않음)', async () => {
    const a = await ctrlWith({ TWIN_LAUNCH_SECRET: 'sec' }).cdsPatientView(PID);
    const b = await ctrlWith({ TWIN_BASE_URL: URL }).cdsPatientView(PID);
    expect(a.data).toMatchObject({ status: 'UNCONFIGURED', reason: 'BASE_URL_UNSET' });
    expect(b.data).toMatchObject({ status: 'UNCONFIGURED', reason: 'SECRET_UNSET' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('🔴 egress 차단 → UNAVAILABLE(EGRESS_BLOCKED) · 보내지 않음', async () => {
    const { data } = await ctrlWith({ TWIN_LAUNCH_SECRET: 'sec', TWIN_BASE_URL: 'http://127.0.0.1:8080' }).cdsPatientView(PID);
    expect(data).toMatchObject({ cards: [], status: 'UNAVAILABLE', reason: 'EGRESS_BLOCKED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('동의 없음 → NO_CONSENT(보내지 않음)', async () => {
    const { data } = await ctrlWith(configured, false).cdsPatientView(PID);
    expect(data).toMatchObject({ cards: [], status: 'NO_CONSENT' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('대조군 — 트윈이 답하면 OK(성공을 실패로 말하지 않는다)', () => {
  it('진짜 0장은 status OK · cards []', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ cards: [] }), { status: 200 }));
    const { data } = await ctrlWith(configured).cdsPatientView(PID);
    expect(data).toEqual({ cards: [], status: 'OK', reason: null });
  });

  it('카드가 있으면 그대로 싣고 OK', async () => {
    const cards = [{ summary: 'ASCVD 10년 위험 22%', indicator: 'warning' }];
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ cards }), { status: 200 }));
    const { data } = await ctrlWith(configured).cdsPatientView(PID);
    expect(data).toEqual({ cards, status: 'OK', reason: null });
  });
});
