import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

/**
 * 🔴 AI 전송 정본 단일화 가드(2026-08-20).
 *
 * 원 상태: AI 전송 정본이 **둘**이었다.
 *   ① `medical-ai.service.ts` 의 private `aiFetch` — 검증 + 감사 + 타임아웃 + raw `fetch` 를 자기가 다 했다.
 *   ② `common/util/ai-egress-fetch.ts` — 2026-08-20 G3 에서 신설, 다른 12개 클라이언트가 이리로 이관.
 *   실측: medical-ai 는 ②를 **한 번도 import 하지 않았다(0건)**. 방치하면 차단 규칙·감사 형식·
 *   타임아웃이 갈라진다(같은 사실에 정본이 둘이면 갈라진다 — 이 저장소에서 반복된 P12).
 *
 * 이 스펙이 굳히는 사실 5가지(각 항목은 결함을 재주입하면 실패한다):
 *  ① `src/modules/medical-ai/**` 의 raw `fetch(` 는 **정확히 0**(여유 없음 — 여유를 두면 신규 위반을 흡수한다).
 *  ② 타임아웃이 사라지지 않는다 — 조회 15s / LLM 120s / 스트림 180s 가 실제 전송에 걸린다.
 *  ③ `EgressBlockedError` 가 성공(빈 결과·`{}`)으로 둔갑하지 않는다 — 스트리밍 경로 포함.
 *  ④ 감사 로그에 **본문이 실리지 않는다**(PHI) — 메타 8키만(2026-09-09 `mode` 추가).
 *  ⑤ 두 정본이 다시 갈라지지 않는다 — medical-ai 안에 정본을 거치지 않는 AI 전송/자체 감사 로그가 생기면 실패.
 *
 * 재주입 검증(2026-08-20 실행 — 아래 각각을 실제로 넣고 이 스펙이 실패하는 것을 확인한 뒤 원복):
 *   (1) `aiEgressFetch(...)` → `fetch(\`${cfg.url}${path}\`, {...})` 복귀        → ①·⑤ 실패
 *   (2) `timeoutMs` 를 정본에 넘기지 않음(`{ client: 'medical-ai' }`)             → ② 실패
 *   (3) 차단을 빈 결과로 삼킴(`catch { return {} }` in orchestratorWorkflows)     → ③ 실패
 *   (4) 감사 라인에 `body` 추가                                                    → ④ 실패
 *   (5) medical-ai 에 `Logger('AiEgressAudit')` 재도입                             → ⑤ 실패
 */

const API_ROOT = join(__dirname, '../..');
const MEDICAL_AI_DIR = join(API_ROOT, 'src/modules/medical-ai');
const SERVICE_PATH = join(MEDICAL_AI_DIR, 'medical-ai.service.ts');

/** 전역 `fetch(` 호출만 — `aiEgressFetch(`/`this.aiFetch(`/`safeFetch(` 등 래퍼는 대문자라 제외된다. */
const RAW_FETCH_RE = /(?<![A-Za-z0-9_$.])fetch\s*\(/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

// ── ① · ⑤ 구조 가드 ──────────────────────────────────────────────────────────
describe('① medical-ai 는 정본을 우회하지 않는다(구조 가드 · 여유 0)', () => {
  const files = walk(MEDICAL_AI_DIR);

  it('src/modules/medical-ai/** 의 raw fetch 는 정확히 0 이다', () => {
    const offenders = files
      .map((f) => [f.slice(API_ROOT.length + 1), (readFileSync(f, 'utf8').match(RAW_FETCH_RE) ?? []).length] as const)
      .filter(([, n]) => n > 0);
    expect(
      offenders,
      `AI 목적지로 나가는 호출은 common/util/ai-egress-fetch 정본만 쓴다:\n${offenders
        .map(([f, n]) => `${f}: ${n}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('medical-ai.service.ts 가 정본을 import 한다', () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    expect(src).toContain("from '../../common/util/ai-egress-fetch'");
    expect(src).toContain('aiEgressFetch(');
  });

  it('⑤ 감사 로그를 medical-ai 가 자기 형식으로 다시 남기지 않는다(정본이 둘이면 갈라진다)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // 주석 안의 설명 문구는 허용 — 실제 Logger 생성/로그 방출만 잡는다.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${f.slice(API_ROOT.length + 1)} 이 AiEgressAudit 로거를 다시 만듭니다`).not.toMatch(
        /new Logger\(\s*['"`]AiEgressAudit/,
      );
      expect(code, `${f.slice(API_ROOT.length + 1)} 이 AI_EGRESS 감사 라인을 직접 방출합니다`).not.toMatch(
        /t:\s*['"`]AI_EGRESS['"`]/,
      );
    }
  });
});

// ── 하니스 ────────────────────────────────────────────────────────────────────
const AI_URL = 'https://example.org/ollama';

function newService(url: string = AI_URL) {
  const cfg = { get: vi.fn((_k: string, d?: any) => d ?? '') };
  const rt = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
  const prisma = {
    systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'ai.server.url', value: url }]) },
  };
  return new MedicalAiService(cfg as any, rt as any, prisma as any);
}

const okRes = (body: any) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue(body),
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

/** 감사 라인만 뽑는다(다른 로그와 섞이지 않게). */
function egressLines(logSpy: { mock: { calls: any[][] } }): any[] {
  return logSpy.mock.calls
    .map((c) => c[0])
    .filter((m): m is string => typeof m === 'string' && m.includes('"t":"AI_EGRESS"'))
    .map((m) => JSON.parse(m));
}

describe('② 타임아웃이 사라지지 않는다 · ④ 감사 로그에 본문이 실리지 않는다', () => {
  let fetchSpy: any;
  let logSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue(okRes({ ok: true }) as never);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('조회성 기본 15s — 감사 라인의 timeoutMs 와 실제 signal 이 함께 살아 있다', async () => {
    const svc = newService();
    await svc.orchestratorWorkflows();
    const lines = egressLines(logSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      t: 'AI_EGRESS',
      client: 'medical-ai',
      host: 'example.org',
      path: '/api/orchestrator/workflows',
      method: 'GET',
      timeoutMs: 15_000,
    });
    const init = fetchSpy.mock.calls[0][1];
    expect(init.signal, '타임아웃 signal 이 사라졌습니다').toBeInstanceOf(AbortSignal);
    // 정본은 base 를 정규화해 붙인다(중복 슬래시 방지) — 목적지 자체는 바뀌지 않는다.
    expect(fetchSpy.mock.calls[0][0]).toBe(`${AI_URL}/api/orchestrator/workflows`);
  });

  it('LLM 생성형 120s · API 키 헤더가 그대로 실린다', async () => {
    const svc = newService();
    await svc.meetingAnalyze({ file_url: 'https://x.example/a.mp4' });
    const lines = egressLines(logSpy);
    expect(lines[0].timeoutMs).toBe(120_000);
    const init = fetchSpy.mock.calls[0][1];
    expect(init.headers['X-Medical-Key'], 'X-Medical-Key 헤더가 사라졌습니다').toBeDefined();
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.method).toBe('POST');
  });

  it('스트리밍 180s — Response 원본이 그대로 돌아온다(소비하지 않는다)', async () => {
    const streamRes = { ok: true, status: 200, body: 'NDJSON-STREAM', json: vi.fn(), text: vi.fn() };
    fetchSpy.mockResolvedValue(streamRes as never);
    const svc = newService();
    const out = await svc.summarizeStream('환자 주소');
    expect(out).toBe(streamRes); // 정본이 Response 를 감싸거나 바꾸지 않는다
    expect(egressLines(logSpy)[0].timeoutMs).toBe(180_000);
  });

  it('④ 감사 라인은 메타 8키뿐(mode 포함) — 전송 본문이 한 조각도 남지 않는다(PHI)', async () => {
    const PHI = '검종단 환자 흉통 2시간 전 발생';
    const svc = newService();
    await svc.meetingAnalyze({ file_url: 'https://x.example/a.mp4', metadata: { note: PHI } });
    const line = egressLines(logSpy)[0];
    expect(Object.keys(line).sort()).toEqual(
      ['bytes', 'client', 'host', 'method', 'mode', 'path', 't', 'timeoutMs'].sort(),
    );
    // 로그 전체(감사 외 라인 포함)에도 본문이 없어야 한다.
    const all = logSpy.mock.calls.map((c: any[]) => String(c[0])).join('\n');
    expect(all, '감사/로그에 전송 본문이 실렸습니다').not.toContain(PHI);
    expect(line.bytes).toBeGreaterThan(0); // 크기는 남긴다(내용은 남기지 않는다)
  });
});

describe('③ EgressBlockedError 는 성공이 되지 않는다', () => {
  const ALLOWED = 'ai.allowed.example';
  let fetchSpy: any;
  let logSpy: any;
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.AI_EGRESS_ALLOWED_HOSTS;
    process.env.AI_EGRESS_ALLOWED_HOSTS = ALLOWED;
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue(okRes({ ok: true }) as never);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    logSpy.mockRestore();
    if (prev === undefined) delete process.env.AI_EGRESS_ALLOWED_HOSTS;
    else process.env.AI_EGRESS_ALLOWED_HOSTS = prev;
  });

  it('조회 경로 — 허용 밖 호스트는 나가지 않고 503(AI_EGRESS_BLOCKED)으로 올라간다', async () => {
    const svc = newService('https://attacker.example/ollama');
    await expect(svc.orchestratorWorkflows()).rejects.toMatchObject({
      response: { code: 'AI_EGRESS_BLOCKED' },
    });
    expect(fetchSpy, '한 바이트도 나가면 안 된다').not.toHaveBeenCalled();
    expect(egressLines(logSpy), '나가지 않은 전송을 감사에 적지 않는다').toEqual([]);
  });

  it('스트리밍 경로 — 차단이 빈 스트림/빈 초안으로 둔갑하지 않는다', async () => {
    const svc = newService('https://attacker.example/ollama');
    await expect(svc.autoRecordStream({ conversation: '흉통 2시간' })).rejects.toMatchObject({
      response: { code: 'AI_EGRESS_BLOCKED' },
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // 진료 대화가 나가지 않았다
  });

  it('kill switch 와 미설정은 차단과 다른 사실로 구분되어 올라간다', async () => {
    const svc = newService('');
    await expect(svc.orchestratorWorkflows()).rejects.toMatchObject({
      response: { code: 'AI_SERVER_URL_UNSET' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 3단계: 없는 통제를 있다고 말하지 않는다 ────────────────────────────────────
describe('AI_EGRESS_ALLOWED_HOSTS 미설정 사실을 감추지 않는다(1회 경고)', () => {
  let warnSpy: any;
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.AI_EGRESS_ALLOWED_HOSTS;
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.resetModules(); // 모듈 스코프 1회 플래그를 초기화
  });
  afterEach(() => {
    warnSpy.mockRestore();
    if (prev === undefined) delete process.env.AI_EGRESS_ALLOWED_HOSTS;
    else process.env.AI_EGRESS_ALLOWED_HOSTS = prev;
  });

  it('🔴 미설정이면 공개 호스트 전송은 차단된다(fail-closed · 2026-09-09) — 경고만 하고 통과하던 종전 동작은 재주입 대상이다', async () => {
    delete process.env.AI_EGRESS_ALLOWED_HOSTS;
    const { assertAiServerUrl, AI_EGRESS_HOSTS_UNSET_CODE } = await import('../../src/common/util/ai-egress-url');
    let err: unknown;
    try { assertAiServerUrl(AI_URL); } catch (e) { err = e; }
    expect(err, '허용 목록이 비었는데 공개 호스트가 통과했다 — 없는 통제를 있다고 말하는 것이다').toBeTruthy();
    expect((err as { code?: string }).code).toBe(AI_EGRESS_HOSTS_UNSET_CODE);
    expect(String((err as Error).message)).toContain('AI_EGRESS_ALLOWED_HOSTS');
  });

  it('설정돼 있으면 경고하지 않는다(거짓 경보는 진짜 경보를 죽인다)', async () => {
    process.env.AI_EGRESS_ALLOWED_HOSTS = 'example.org';
    const { assertAiServerUrl } = await import('../../src/common/util/ai-egress-url');
    assertAiServerUrl(AI_URL);
    const warns = warnSpy.mock.calls.map((c: any[]) => String(c[0])).filter((m: string) => m.includes('AI_EGRESS_ALLOWED_HOSTS'));
    expect(warns).toHaveLength(0);
  });
});
