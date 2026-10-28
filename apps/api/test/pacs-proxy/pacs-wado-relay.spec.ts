import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ServiceUnavailableException, BadGatewayException } from '@nestjs/common';
import { PacsProxyService } from '../../src/modules/pacs-proxy/pacs-proxy.service';

/**
 * WADO 바이너리 중계 가드 (2026-08-18 · PACS 직접 호출 이관).
 *
 * 🔴 이 서비스의 JSON 경로는 실패를 `null` 로 돌려주는 관례가 있다 — 그 관례를 바이너리에
 *    그대로 가져오면 판독 화면이 "영상 없음"으로 위장한다(간호 영상 조회에서 이미 겪은 결함).
 *    아래 단언은 그 관례를 되살리면 반드시 깨진다.
 */
describe('PacsProxyService.fetchWadoImage', () => {
  let service: PacsProxyService;
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
    const config = {
      get: vi.fn((key: string, def?: string) => ({
        OPENPACS_API_URL: 'http://127.0.0.1:8000',
        PACS_SSO_ENABLED: 'true',
      } as Record<string, string>)[key] ?? def),
    };
    service = new PacsProxyService(config as unknown as ConfigService);
  });
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); });

  const sso = { hisUserId: 'u1', hisUserEmail: 'd@x.example', hisUserRole: 'DOCTOR', hisJwt: 'jwt-1' };

  it('SSO 컨텍스트를 그대로 실어 /wado 를 부르고 바이트+Content-Type 을 돌려준다', async () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff]);
    let seen: { url?: string; headers?: Record<string, string> } = {};
    global.fetch = vi.fn(async (url: never, init: never) => {
      seen = { url: String(url), headers: (init as { headers: Record<string, string> }).headers };
      return {
        ok: true, status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength),
      } as never;
    }) as never;

    const out = await service.fetchWadoImage({ studyUID: '1.2.3', seriesUID: '4.5.6' }, sso);
    expect(seen.url).toContain('http://127.0.0.1:8000/wado?studyUID=1.2.3&seriesUID=4.5.6');
    expect(seen.headers?.Authorization).toBe('Bearer jwt-1');
    expect(seen.headers?.['X-HIS-User-Role']).toBe('DOCTOR');
    expect(out.contentType).toBe('image/jpeg');
    expect(out.body).toEqual(jpg);
  });

  it('🔴 PACS 오류를 null 로 삼키지 않는다 — 503 으로 올린다', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'ISE', headers: { get: () => null } }) as never) as never;
    await expect(service.fetchWadoImage({ studyUID: '1.2.3' }, sso)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('🔴 PACS 에 닿지 못해도 조용히 빈 값을 주지 않는다', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as never;
    await expect(service.fetchWadoImage({ studyUID: '1.2.3' }, sso)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('진짜 없는 영상(404)은 404 로 — 장애와 섞지 않는다', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'NF', headers: { get: () => null } }) as never) as never;
    await expect(service.fetchWadoImage({ studyUID: '1.2.3' }, sso)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('이미지가 아닌 응답(오류 HTML)은 그대로 흘리지 않는다', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: (k: string) => (k === 'content-type' ? 'text/html' : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as never) as never;
    await expect(service.fetchWadoImage({ studyUID: '1.2.3' }, sso)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
