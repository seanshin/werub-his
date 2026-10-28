import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PacsProxyService } from '../../src/modules/pacs-proxy/pacs-proxy.service';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';

/**
 * 🔴 r1 11-5 — PACS 조회 실패가 상류 상태를 싣지 않고 401·403 을 한 문장으로 말했다.
 *
 * 회신 G절 C3(`docs/04-report/ecosystem-notice-reply-2026-09-21.md`)은 상대에게
 * "503(`details.upstreamStatus=401`)이면 미설정(또는 값 불일치)"으로 가르라고 안내했는데 **그 필드가 코드에 없었다.**
 * 못박는 것: 필드가 **응답 본문까지**(전역 예외 필터를 지나) 살아남는다 — 과거 필터가 `details=res.message` 만 뽑아
 * payload 를 버린 적이 있다(같은 피해 54개소).
 */

function makeService() {
  const config = {
    get: vi.fn((k: string, d?: string) => ({ OPENPACS_API_URL: 'http://127.0.0.1:8000', OPENPACS_USER: 'u', OPENPACS_PASS: 'p' } as Record<string, string>)[k] ?? d),
  };
  return new PacsProxyService(config as unknown as ConfigService);
}

/** 토큰 발급은 성공 · 조회만 주어진 상태로 실패 */
function upstream(status: number | 'network') {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
    .mockImplementation(async () => {
      if (status === 'network') throw new Error('ECONNREFUSED');
      return { ok: false, status, json: async () => ({}) };
    }) as never;
}

/** 전역 예외 필터를 지난 실제 응답 본문 */
function throughFilter(e: unknown) {
  const json = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ headersSent: false, status: statusFn }),
      getRequest: () => ({ headers: {}, method: 'GET', url: '/api/v1/pacs/studies' }),
    }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(e, host);
  return { status: statusFn.mock.calls[0][0] as number, body: json.mock.calls[0][0] as { error: { code: string; message: string; details: any } } };
}

async function failureOf(status: number | 'network') {
  upstream(status);
  return makeService().getStudies({}).then(() => null, (e: unknown) => e);
}

describe('PACS 조회 실패 — details.upstreamStatus', () => {
  it('🔴 401 → 503 · 응답 본문 error.details.upstreamStatus = 401 (회신 C3 이 안내한 필드)', async () => {
    const { status, body } = throughFilter(await failureOf(401));
    expect(status).toBe(503);
    expect(body.error.code).toBe('PACS_UNAVAILABLE');
    expect(body.error.details).toEqual({ upstreamStatus: 401 });
  });

  it('🔴 403 → upstreamStatus 403 · 401 과 다른 문장(인증 실패 ≠ 권한 거부)', async () => {
    const r401 = throughFilter(await failureOf(401)).body;
    const r403 = throughFilter(await failureOf(403)).body;
    expect(r403.error.details).toEqual({ upstreamStatus: 403 });
    expect(r403.error.message).not.toBe(r401.error.message);
    expect(r403.error.message).toMatch(/권한/);
    expect(r401.error.message).toMatch(/인증/);
  });

  it('5xx → upstreamStatus 그대로', async () => {
    expect(throughFilter(await failureOf(502)).body.error.details).toEqual({ upstreamStatus: 502 });
  });

  it('연결 실패는 상태를 지어내지 않는다(upstreamStatus null)', async () => {
    const { status, body } = throughFilter(await failureOf('network'));
    expect(status).toBe(503);
    expect(body.error.details).toEqual({ upstreamStatus: null });
  });

  it('대조군 — 404 는 "없다"(사실)로 종전 그대로(503 으로 바꾸지 않는다)', async () => {
    const { status, body } = throughFilter(await failureOf(404));
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
