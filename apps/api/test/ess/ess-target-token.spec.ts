import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { EssService } from '../../src/modules/ess/ess.service';

// ESS 대상 토큰 (ERP #4) — 단일키 전 직원 열거 차단
describe('EssService 대상 토큰 발급', () => {
  let service: EssService;
  let configMap: Record<string, unknown>;

  beforeEach(() => {
    configMap = { 'ess.targetTokenSecret': 'test-target-secret' };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new EssService({} as any, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, configRuntime as any);
  });

  const issue = (emp: string) => (service as any).issueTargetToken(emp) as Promise<string | undefined>;

  const decode = (jwt: string) => {
    const [h, b] = jwt.split('.');
    return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), body: JSON.parse(Buffer.from(b, 'base64url').toString()) };
  };

  it('JWT HS256 — sub=employeeNumber·purpose=ess-target·60초 exp', async () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = (await issue('EMP-2020-001'))!;
    const { header, body } = decode(jwt);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(body.sub).toBe('EMP-2020-001');
    expect(body.purpose).toBe('ess-target');
    expect(body.exp - body.iat).toBe(60); // 단명
    expect(body.iat).toBeGreaterThanOrEqual(before);
  });

  it('서명 검증 — 시크릿으로 재계산 시 일치', async () => {
    const jwt = (await issue('EMP-1'))!;
    const [h, b, sig] = jwt.split('.');
    const expected = createHmac('sha256', 'test-target-secret').update(`${h}.${b}`).digest('base64url');
    expect(sig).toBe(expected);
  });

  it('시크릿 없으면 미발급(undefined) — ERP 관측모드 무중단', async () => {
    configMap = {};
    const saved = process.env.ESS_TARGET_TOKEN_SECRET;
    delete process.env.ESS_TARGET_TOKEN_SECRET;
    expect(await issue('EMP-1')).toBeUndefined();
    if (saved) process.env.ESS_TARGET_TOKEN_SECRET = saved;
  });

  it('employeeNumber 없으면 미발급', async () => {
    expect(await issue('')).toBeUndefined();
  });

  it('직원별 토큰 sub 격리 — 서로 다른 직원은 다른 sub', async () => {
    const a = decode((await issue('EMP-A'))!).body.sub;
    const b = decode((await issue('EMP-B'))!).body.sub;
    expect(a).toBe('EMP-A');
    expect(b).toBe('EMP-B');
    expect(a).not.toBe(b);
  });
});
