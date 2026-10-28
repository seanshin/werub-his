import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { aiEgressFetch } from '../../src/common/util/ai-egress-fetch';
import {
  AI_EGRESS_HOSTS_UNSET_CODE,
  AiEgressHostsUnsetError,
  assertAiServerUrl,
} from '../../src/common/util/ai-egress-url';
import { EgressBlockedError } from '../../src/common/util/safe-fetch';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

/**
 * 🔴 P0-A — AI egress 허용 호스트 fail-closed(2026-09-09).
 *
 * 원 상태(실측): `AI_EGRESS_ALLOWED_HOSTS` 가 비어 있으면 호스트 제한이 **걸리지 않았고**
 *   경고 1회만 남겼다. 운영 `.env` 에는 이 키가 없다 → 즉 임상 텍스트·진료 녹취 원음이 나갈 수 있는
 *   목적지가 코드로 한정돼 있지 않았다(`ai.server.url` 은 DB 값이다).
 *
 * 이 스펙이 굳히는 사실 4가지:
 *  ① 목록이 비면 **외부(공개) 호스트로는 한 바이트도 나가지 않는다** — 코드 `AI_EGRESS_HOSTS_UNSET`.
 *  ② 대조군: 목록에 있으면 그대로 나간다(성공을 실패라 말하지 않는다 — 기능을 없앤 게 아니다).
 *  ③ 대조군: 원내 사설망/loopback 목적지는 목록 없이도 나간다(폐쇄망·원내 GPU 전환을 막지 않는다).
 *  ④ 감사 라인에 `mode`(운영 모드 빌드 상한)가 실린다 — 미설정은 가장 제한적인 `REAL` 로 적는다.
 *
 * 재주입 검증(2026-09-09 실행): `assertAiServerUrl` 의 fail-closed 분기를
 *   `reportNoAiEgressAllowlist()` 호출만 남기고 throw 를 지운 상태(=종전 "경고만")로 되돌리면
 *   ①의 4개 테스트가 실패한다. 복원 후 전부 통과하는 것까지 확인했다.
 */

const EXTERNAL = 'https://example.org/ollama';
const okRes = () => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}), text: vi.fn().mockResolvedValue('{}') });

/** env 를 만지는 스펙은 반드시 원복한다 — 다른 스펙이 이 값을 보고 판정한다. */
function envKeeper(keys: string[]) {
  const prev: Record<string, string | undefined> = {};
  return {
    save: () => keys.forEach((k) => { prev[k] = process.env[k]; }),
    restore: () => keys.forEach((k) => {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k] as string;
    }),
  };
}

const env = envKeeper(['AI_EGRESS_ALLOWED_HOSTS', 'HIS_MODE']);

describe('① 허용 목록이 비면 외부 호스트로 나가지 않는다(fail-closed)', () => {
  let fetchSpy: any;

  beforeEach(() => {
    env.save();
    delete process.env.AI_EGRESS_ALLOWED_HOSTS; // 운영의 실제 상태(키 없음)를 그대로 재현
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue(okRes() as never);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.restore();
  });

  it('검증 정본이 차단하고, 무엇을 설정해야 하는지 말한다', () => {
    let caught: unknown;
    try { assertAiServerUrl(EXTERNAL); } catch (e) { caught = e; }
    expect(caught, '미설정인데 통과시키면 호스트 제한이 없는 것과 같다').toBeInstanceOf(AiEgressHostsUnsetError);
    expect((caught as AiEgressHostsUnsetError).code).toBe(AI_EGRESS_HOSTS_UNSET_CODE);
    // 기존 계약 유지 — 이미 EgressBlockedError 를 잡는 9개 클라이언트가 그대로 fail-closed 된다.
    expect(caught).toBeInstanceOf(EgressBlockedError);
    // 사용자(운영자)가 무엇을 해야 하는지 그 자리에서 말한다.
    expect((caught as Error).message).toContain('AI_EGRESS_ALLOWED_HOSTS');
    expect((caught as Error).message).toContain('재기동');
    expect((caught as Error).message).toContain('example.org'); // 지금 목적지 호스트가 예시로 들어 있다
  });

  it('전송 정본(aiEgressFetch)도 나가기 전에 멈춘다 — fetch 미호출·감사 라인 없음', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    await expect(
      aiEgressFetch(EXTERNAL, '/api/generate', { method: 'POST', body: '{"x":1}' }, { client: 'test' }),
    ).rejects.toBeInstanceOf(AiEgressHostsUnsetError);
    expect(fetchSpy, '한 바이트도 나가면 안 된다').not.toHaveBeenCalled();
    const audit = logSpy.mock.calls.map((c: any[]) => String(c[0])).filter((m: string) => m.includes('"t":"AI_EGRESS"'));
    expect(audit, '나가지 않은 전송을 감사에 적지 않는다').toEqual([]);
  });

  it('IP 리터럴이어도 공개 대역이면 막는다(사설 예외를 넓혀 쓰지 않는다)', () => {
    expect(() => assertAiServerUrl('http://8.8.8.8:11434')).toThrow(AiEgressHostsUnsetError);
  });

  it('AI 클라이언트는 이것을 3상태(503 AI_EGRESS_BLOCKED)로 접는다 — 빈 결과로 덮지 않는다', async () => {
    const cfg = { get: vi.fn((_k: string, d?: any) => d ?? '') };
    const rt = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'ai.server.url', value: EXTERNAL }]) } };
    const svc = new MedicalAiService(cfg as any, rt as any, prisma as any);
    await expect(svc.orchestratorWorkflows()).rejects.toMatchObject({
      response: { code: 'AI_EGRESS_BLOCKED' }, // 사용자에게 나가는 계약은 종전과 같다
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('② 대조군 — 목록에 있으면 그대로 나간다(기능을 없앤 게 아니다)', () => {
  let fetchSpy: any;

  beforeEach(() => {
    env.save();
    process.env.AI_EGRESS_ALLOWED_HOSTS = 'example.org';
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue(okRes() as never);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.restore();
  });

  it('허용 호스트는 통과하고 실제로 전송된다', async () => {
    expect(() => assertAiServerUrl(EXTERNAL)).not.toThrow();
    await aiEgressFetch(EXTERNAL, '/api/generate', { method: 'POST', body: '{}' }, { client: 'test' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${EXTERNAL}/api/generate`);
  });

  it('목록 밖 호스트는 여전히 차단이고, 그것은 "미설정"과 다른 사실이다', () => {
    let caught: unknown;
    try { assertAiServerUrl('https://attacker.example/ollama'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(EgressBlockedError);
    expect(caught).not.toBeInstanceOf(AiEgressHostsUnsetError); // 사유를 뭉개지 않는다
    expect((caught as Error).message).toContain('not in allowlist');
  });
});

describe('③ 대조군 — 원내 사설망/loopback 은 목록 없이도 나간다(폐쇄망 전환을 막지 않는다)', () => {
  beforeEach(() => {
    env.save();
    delete process.env.AI_EGRESS_ALLOWED_HOSTS;
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.restore();
  });

  it.each([
    'http://10.0.0.5:11434',          // 원내 GPU(사설 A)
    'http://192.168.10.7:11434',      // 사설 C
    'http://172.16.3.9:11434',        // 사설 B
    'http://127.0.0.1:11434',         // loopback
    'http://localhost:11434',         // loopback(이름)
    'http://[fd00::1]:11434',         // IPv6 ULA
  ])('%s — 통과한다', (url) => {
    expect(() => assertAiServerUrl(url)).not.toThrow();
  });

  it('사설 예외는 목적지 종류에만 적용된다 — 같은 조건에서 공개 호스트는 막힌다(대조)', () => {
    expect(() => assertAiServerUrl('http://10.0.0.5:11434')).not.toThrow();
    expect(() => assertAiServerUrl(EXTERNAL)).toThrow(AiEgressHostsUnsetError);
  });

  it('프로토콜·자격증명 검사는 사설 경로에서도 그대로다(예외가 구멍이 되지 않는다)', () => {
    expect(() => assertAiServerUrl('file:///etc/passwd')).toThrow();
    expect(() => assertAiServerUrl('http://user:pw@10.0.0.5:11434')).toThrow(/credentials/);
  });
});

describe('④ 감사 라인에 운영 모드(mode)가 실린다', () => {
  let fetchSpy: any;
  let logSpy: any;

  const lines = () =>
    logSpy.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: unknown): m is string => typeof m === 'string' && m.includes('"t":"AI_EGRESS"'))
      .map((m: string) => JSON.parse(m));

  beforeEach(() => {
    env.save();
    process.env.AI_EGRESS_ALLOWED_HOSTS = 'example.org';
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue(okRes() as never);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.restore();
  });

  it('HIS_MODE 를 설정하면 그 값이 실린다', async () => {
    process.env.HIS_MODE = 'REHEARSAL';
    await aiEgressFetch(EXTERNAL, '/api/generate', { method: 'POST', body: '{}' }, { client: 'test', timeoutMs: 15_000 });
    expect(lines()[0].mode).toBe('REHEARSAL');
  });

  it('🔴 미설정·해석 불가는 지어내지 않고 가장 제한적인 REAL 로 적는다(shared 정본과 같은 판정)', async () => {
    delete process.env.HIS_MODE;
    await aiEgressFetch(EXTERNAL, '/api/generate', {}, { client: 'test' });
    expect(lines()[0].mode).toBe('REAL');

    logSpy.mockClear();
    process.env.HIS_MODE = 'PRODUCTION'; // HisMode 어휘에 없는 값
    await aiEgressFetch(EXTERNAL, '/api/generate', {}, { client: 'test' });
    expect(lines()[0].mode).toBe('REAL');
  });

  it('키 집합은 메타 8키뿐 — 본문(PHI)은 여전히 한 조각도 남지 않는다', async () => {
    process.env.HIS_MODE = 'DEV';
    const PHI = '검종단 환자 흉통 2시간 전 발생';
    await aiEgressFetch(EXTERNAL, '/api/generate', { method: 'POST', body: JSON.stringify({ prompt: PHI }) }, { client: 'test', timeoutMs: 15_000 });
    const line = lines()[0];
    expect(Object.keys(line).sort()).toEqual(
      ['bytes', 'client', 'host', 'method', 'mode', 'path', 't', 'timeoutMs'].sort(),
    );
    expect(logSpy.mock.calls.map((c: any[]) => String(c[0])).join('\n')).not.toContain(PHI);
    expect(line.bytes).toBeGreaterThan(0); // 크기는 남긴다(내용은 남기지 않는다)
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('부팅 보고 — 미설정 사실을 침묵하지 않는다(1회 ERROR)', () => {
  let errSpy: any;

  beforeEach(() => {
    env.save();
    errSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.resetModules(); // 모듈 스코프 1회 플래그 초기화
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.restore();
  });

  const reported = () =>
    errSpy.mock.calls.map((c: any[]) => String(c[0])).filter((m: string) => m.includes('AI_EGRESS_ALLOWED_HOSTS'));

  it('미설정이면 ERROR 로 1회 — 배포 직후 "AI 가 전부 안 되는데 이유를 모르는" 상황을 만들지 않는다', async () => {
    delete process.env.AI_EGRESS_ALLOWED_HOSTS;
    const m = await import('../../src/common/util/ai-egress-url');
    m.reportNoAiEgressAllowlist();
    m.reportNoAiEgressAllowlist();
    m.reportNoAiEgressAllowlist();
    const msgs = reported();
    expect(msgs, '미설정인데 아무 말도 하지 않으면 왜 막혔는지 알 수 없다').toHaveLength(1);
    expect(msgs[0]).toContain('전송하지 않습니다');
    expect(msgs[0]).toContain('재기동');
  });

  it('설정돼 있으면 침묵한다(거짓 경보는 진짜 경보를 죽인다)', async () => {
    process.env.AI_EGRESS_ALLOWED_HOSTS = 'example.org';
    const m = await import('../../src/common/util/ai-egress-url');
    m.reportNoAiEgressAllowlist();
    expect(reported()).toHaveLength(0);
  });

  // 🔴 만든 것 ≠ 부르는 것 — 부팅 경로가 실제로 이 보고를 부르는지까지가 한 벌이다.
  //    (env.validation 을 여기서 실행하면 검증 실패 시 process.exit(1) 이라 구조로 확인한다.)
  it('부팅 경로가 실제로 부른다 — main.ts → validateEnv → reportNoAiEgressAllowlist', () => {
    const envSrc = readFileSync(join(__dirname, '../../src/common/env.validation.ts'), 'utf8');
    const mainSrc = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8');
    expect(mainSrc, 'main.ts 가 validateEnv 를 부르지 않습니다').toMatch(/validateEnv\(\)/);
    const fn = envSrc.slice(envSrc.indexOf('export function validateEnv'));
    expect(fn, 'validateEnv 안에서 미설정 보고를 부르지 않습니다').toContain('reportNoAiEgressAllowlist()');
    // 키가 스키마에 등재돼 있어야 .env 문서 역할을 한다(있는 척하는 주석이 아니라 실제 선언)
    expect(envSrc).toMatch(/AI_EGRESS_ALLOWED_HOSTS:\s*z\.string\(\)/);
  });
});
