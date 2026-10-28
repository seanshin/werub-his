import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PacsProxyService } from '../../src/modules/pacs-proxy/pacs-proxy.service';

/**
 * 🔴 외부 점검 — PACS 서비스 계정이 미설정이면 **저장소에 적힌 자격으로 로그인하지 않는다**.
 *
 * 종전: `config.get('OPENPACS_USER', 'admin')` · `config.get('OPENPACS_PASS', 'pacs1234!')`.
 * 판매본은 그 자격을 그대로 들고 나가고, 설치 기관이 값을 넣지 않아도 "동작하는 것처럼" 보인다.
 * 지금: REAL 빌드는 폴백하지 않고 **서비스 계정을 비활성**하며, 그 사실을 503 으로 말한다
 * (빈 헤더로 부르면 PACS 401 이 오는데, 그 401 은 "설치가 덜 됐다"는 사실을 가린다).
 *
 * DEV·REHEARSAL 은 종전 동작 그대로다 — 운영 `his.example.org`(REHEARSAL)이 이 폴백으로 돌고 있다(실측 2026-09-22).
 */
function makeService(env: Record<string, string>) {
  const config = {
    get: vi.fn((key: string, defaultVal?: string) => env[key] ?? defaultVal),
  } as unknown as ConfigService;
  return new PacsProxyService(config);
}

describe('🔴 PACS 서비스 계정 — 미설정이면 개발 자격으로 로그인하지 않는다', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 't' }) });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('REAL 빌드 · 자격 미설정 — 로그인 시도조차 하지 않고 503 으로 말한다', async () => {
    vi.stubEnv('HIS_MODE', 'REAL');
    const service = makeService({ OPENPACS_API_URL: 'http://pacs.test' });

    await expect((service as any).getServiceToken()).rejects.toThrow(ServiceUnavailableException);
    await expect((service as any).getServiceToken()).rejects.toMatchObject({
      response: { error: 'PACS_SERVICE_ACCOUNT_UNCONFIGURED' },
    });
    expect(global.fetch, '자격이 없는데 로그인을 시도했다').not.toHaveBeenCalled();
  });

  it('대조군 — REAL 이라도 자격이 설정돼 있으면 종전대로 로그인한다', async () => {
    vi.stubEnv('HIS_MODE', 'REAL');
    const service = makeService({
      OPENPACS_API_URL: 'http://pacs.test',
      OPENPACS_USER: 'svc-his',
      OPENPACS_PASS: 'set-by-institution',
    });

    await expect((service as any).getServiceToken()).resolves.toBe('t');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toEqual({ username: 'svc-his', password: 'set-by-institution' });
  });

  it('대조군 — DEV·REHEARSAL 은 종전 동작 그대로다(운영이 이 경로로 돈다)', async () => {
    vi.stubEnv('HIS_MODE', 'REHEARSAL');
    const service = makeService({ OPENPACS_API_URL: 'http://pacs.test' });

    await expect((service as any).getServiceToken()).resolves.toBe('t');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
