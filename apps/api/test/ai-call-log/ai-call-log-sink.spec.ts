import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { aiEgressFetch } from '../../src/common/util/ai-egress-fetch';
import {
  clearAiCallLogSink,
  registerAiCallLogSink,
  hasAiCallLogSink,
  type AiCallLogRecord,
} from '../../src/common/util/ai-call-log-sink';

/**
 * 🔴 AI 호출 원장 계측 가드 — 기획서 `ai-judgment-governance.plan.md` §2.2.
 *
 * 굳히는 사실:
 *  ① 싱크가 없으면 **조용히 건너뛴다**(호출은 절대 막지 않는다) — 단, 프로세스당 1회 warn 은 남는다
 *     (원장의 0행을 "호출 없음"으로 읽지 않게 하는 유일한 흔적이다).
 *  ② 싱크가 있으면 호출마다 **정확히 1행**이고, 요청 태그(`model`)와 상류 보고 태그(`model`/`model_used`)를
 *     각각 다른 칸에 적는다(요청 태그로 상류 태그를 대신 채우지 않는다).
 *  ③ 🔴 **본문이 한 조각도 저장되지 않는다**(PHI) — 기록 객체 어디에도 프롬프트·응답 문자열이 없다.
 *  ④ 비 JSON·스트리밍 응답은 **건드리지 않는다** → `modelRef` 는 null(모르는 것을 지어내지 않는다).
 *  ⑤ `res.clone()` 으로 읽으므로 호출부가 받는 Response 는 **소비되지 않는다**(이걸 어기면 모든 AI 기능이 죽는다).
 *  ⑥ 기록이 실패해도(싱크가 던지거나 reject 해도) AI 호출은 성공한 채로 돌아간다.
 *  ⑦ 전송 자체가 실패해도 "무엇을 부르려다 실패했는가"는 남고(httpStatus=null), 에러는 그대로 전파된다.
 *
 * 재주입 검증(2026-09-09 실행 · 치환 `count==1` 확인 → 스펙 실패 확인 → 원복 → 복원 확인):
 *   (1) `clone = res.clone()` → `clone = res`(원본 소비)                 → ④·⑤·구조 실패
 *   (2) 비 JSON 분기 `modelRef: null` → `modelRef: base.requestedModel`   → ④ 실패
 *   (3) 미등록 warn 을 `if (true)` 로(매번 경고)                          → ① 실패
 *   (아직 안 해본 것: 기록 객체에 본문 필드 추가 — 타입에 필드가 없어 tsc 가 먼저 막는다)
 *
 * 🔴 **이 파일은 재주입 중에 두 번 스스로 틀렸다**(가드도 점검 대상이다):
 *   · (1) 을 넣었는데 구조 검사가 통과했다 — 파일 **주석 안의** `res.clone()` 이 대신 통과시켰다.
 *     → 주석을 지우고 보도록 고쳤다.
 *   · ④ 가 "JSON 파싱 실패라서 null" 이라는 **다른 이유로** 통과하고 있었다. 실제로는
 *     `/json/i` 가 `application/x-ndjson` 에 걸려 **스트리밍 응답을 clone·버퍼링**하고 있었다(실결함).
 *     → 정본을 `isJsonMime` 로 고치고, 여기서는 `clone` 호출 자체를 spy 로 막았다.
 */

// 🔴 목적지는 테스트 하네스의 허용 호스트(`test/setup-env.ts`)를 쓴다 — fetch 는 목이라 나가지 않는다.
//    여기서 보는 것은 목적지 정책이 아니라 **계측**이다(정책 가드는 ai-egress-hosts-failclosed 몫).
const AI_BASE = 'https://example.org/ollama';
const PHI = '검증종단 환자 흉통 2시간 전 발생';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AiCallLog 싱크 — aiEgressFetch 계측', () => {
  let fetchSpy: any;
  let logSpy: any;
  let warnSpy: any;
  let rows: AiCallLogRecord[];

  beforeEach(() => {
    rows = [];
    clearAiCallLogSink();
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    clearAiCallLogSink();
    vi.restoreAllMocks();
  });

  it('① 싱크 미등록 — 호출은 그대로 성공하고, 미기록 경고는 프로세스당 1회뿐이다', async () => {
    fetchSpy.mockImplementation(async () => jsonRes({ model: 'qwen2.5:14b', response: 'ok' }));
    expect(hasAiCallLogSink()).toBe(false);

    const r1 = await aiEgressFetch(AI_BASE, '/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt: PHI }),
      headers: { 'Content-Type': 'application/json' },
    }, { client: 'unit-test' });
    const r2 = await aiEgressFetch(AI_BASE, '/api/tags', { method: 'GET' }, { client: 'unit-test' });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    await vi.waitFor(() => {
      const warns = warnSpy.mock.calls.map((c: any[]) => String(c[0])).filter((m: string) => m.includes('AiCallLog 싱크'));
      expect(warns.length, '미등록 경고는 1회만(로그를 도배하지 않는다)').toBe(1);
    });
  });

  it('② ③ 등록 시 호출마다 1행 — 요청 태그·상류 태그를 각각 적고 본문은 담지 않는다', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    fetchSpy.mockImplementation(async () =>
      jsonRes({ model: 'qwen2.5:7b', response: `${PHI} 에 대한 소견` }),
    );

    await aiEgressFetch(AI_BASE, '/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt: PHI }),
      headers: { 'Content-Type': 'application/json' },
    }, { client: 'concierge' });

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    const row = rows[0];
    expect(row.skill).toBe('concierge');
    expect(row.client).toBe('concierge');
    expect(row.requestedModel, '우리가 요청한 태그').toBe('qwen2.5:14b');
    // 🔴 상류가 다른 모델로 답했다 — 그것이 사실이고, 요청 태그로 덮지 않는다
    expect(row.modelRef, '상류가 보고한 태그').toBe('qwen2.5:7b');
    expect(row.httpStatus).toBe(200);
    expect(typeof row.latencyMs).toBe('number');
    expect(row.mode).toBeTruthy();

    // ③ 기록 어디에도 본문이 없다(직렬화 전체를 훑는다 — 필드를 늘려도 이 단언이 잡는다)
    const dump = JSON.stringify(row);
    expect(dump, '기록에 프롬프트/응답 본문이 실렸습니다(PHI)').not.toContain(PHI);
    expect(dump).not.toContain('소견');
    expect(Object.keys(row).sort()).toEqual(
      ['bytes', 'client', 'httpStatus', 'latencyMs', 'mode', 'modelRef', 'requestedModel', 'skill'].sort(),
    );
  });

  it('② 상류가 `model_used` 로 보고해도 읽는다 · 요청 본문이 JSON 이 아니면 requestedModel 은 null', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    fetchSpy.mockImplementation(async () => jsonRes({ model_used: 'gemma3:4b', answer: 'x' }));

    await aiEgressFetch(AI_BASE, '/api/chat', {
      method: 'POST',
      body: 'not-json',
    }, { client: 'medical-ai/auto-soap' });

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0].requestedModel, 'JSON 이 아니면 모른다 — 추측하지 않는다').toBeNull();
    expect(rows[0].modelRef).toBe('gemma3:4b');
    expect(rows[0].skill).toBe('medical-ai/auto-soap');
  });

  it('④ 스트리밍(x-ndjson)은 clone 조차 하지 않는다 — modelRef 는 null 이고 스트림은 살아 있다', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    const streamBody = '{"model":"qwen2.5:14b","response":"a"}\n{"done":true}\n';
    const streamRes = new Response(streamBody, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
    // 🔴 "JSON 파싱이 실패해서 null" 로는 부족하다 — **만지지 않았다**는 것이 이 단언의 요지다.
    //    (첫 구현은 `/json/i` 라 x-ndjson 이 JSON 으로 걸렸고, 이 테스트가 다른 이유로 통과했다)
    const cloneSpy = vi.spyOn(streamRes, 'clone');
    fetchSpy.mockImplementation(async () => streamRes);

    const res = await aiEgressFetch(AI_BASE, '/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt: PHI }),
    }, { client: 'scribe' });

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(cloneSpy, '스트리밍 응답을 clone 해 버퍼링했습니다').not.toHaveBeenCalled();
    // 🔴 스트림 본문에 model 문자열이 있어도 읽지 않는다(읽으면 스트림이 죽는다)
    expect(rows[0].modelRef).toBeNull();
    expect(rows[0].requestedModel).toBe('qwen2.5:14b');
    expect(await res.text(), '스트림이 소비되어 호출부가 빈 손이 되었습니다').toBe(streamBody);
  });

  it('④ 대조군 — 진짜 JSON(charset 포함)은 정상적으로 읽는다(가드가 성공을 실패로 말하지 않는다)', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    fetchSpy.mockImplementation(async () =>
      new Response(JSON.stringify({ model: 'qwen2.5:14b' }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );
    await aiEgressFetch(AI_BASE, '/api/tags', { method: 'GET' }, { client: 'unit-test' });
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0].modelRef).toBe('qwen2.5:14b');
  });

  it('⑤ clone 으로 읽는다 — 호출부가 받는 Response 는 소비되지 않는다', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    const payload = { model: 'qwen2.5:14b', response: PHI };
    fetchSpy.mockImplementation(async () => jsonRes(payload));

    const res = await aiEgressFetch(AI_BASE, '/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt: PHI }),
    }, { client: 'formulary' });

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(res.bodyUsed, '원 응답이 이미 소비되었습니다').toBe(false);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it('⑥ 기록이 실패해도 AI 호출은 막히지 않는다(동기 throw · 비동기 reject 둘 다)', async () => {
    fetchSpy.mockImplementation(async () => jsonRes({ model: 'qwen2.5:14b' }));

    registerAiCallLogSink(() => { throw new Error('DB down'); });
    await expect(
      aiEgressFetch(AI_BASE, '/api/tags', { method: 'GET' }, { client: 'unit-test' }),
    ).resolves.toMatchObject({ ok: true });

    registerAiCallLogSink(() => Promise.reject(new Error('DB down (async)')));
    await expect(
      aiEgressFetch(AI_BASE, '/api/tags', { method: 'GET' }, { client: 'unit-test' }),
    ).resolves.toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 10)); // unhandled rejection 이 나면 여기서 터진다
  });

  it('⑦ 전송 실패도 한 행으로 남는다 — httpStatus 는 null(0·500 으로 지어내지 않는다) · 에러는 전파', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    fetchSpy.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

    await expect(
      aiEgressFetch(AI_BASE, '/api/generate', {
        method: 'POST',
        body: JSON.stringify({ model: 'gemma3:12b', prompt: PHI }),
      }, { client: 'concierge' }),
    ).rejects.toThrow('ECONNREFUSED');

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0].httpStatus).toBeNull();
    expect(rows[0].requestedModel).toBe('gemma3:12b');
    expect(rows[0].modelRef).toBeNull();
    expect(rows[0].bytes, '재지 못한 것을 -1·0 으로 적지 않는다').toBeNull();
  });

  it('🔴 감사 로그 라인(8키)은 그대로다 — 원장은 별개이고 로그 파서를 깨지 않는다', async () => {
    registerAiCallLogSink((r) => { rows.push(r); });
    fetchSpy.mockImplementation(async () => jsonRes({ model: 'qwen2.5:14b' }));
    await aiEgressFetch(AI_BASE, '/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt: PHI }),
    }, { client: 'unit-test' });

    const lines = logSpy.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: unknown): m is string => typeof m === 'string' && m.includes('"t":"AI_EGRESS"'))
      .map((m: string) => JSON.parse(m));
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual(
      ['bytes', 'client', 'host', 'method', 'mode', 'path', 't', 'timeoutMs'].sort(),
    );
  });
});

describe('구조 — 계측이 정본 한 곳에만 있다', () => {
  const API_ROOT = join(__dirname, '../..');
  const RAW = readFileSync(join(API_ROOT, 'src/common/util/ai-egress-fetch.ts'), 'utf8');
  /**
   * 🔴 **주석을 지우고 본다.** 재주입(`res.clone()` → `res`)을 실제로 넣었을 때(2026-09-09)
   *    이 파일 상단 주석의 `res.clone()` 한 조각이 검사를 **대신 통과**시켰다 — 통과했지만
   *    아무것도 보증하지 않는 가드였다. 같은 함정이 v4.11.0 에서만 9건 나왔다.
   */
  const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('원장 기록은 aiEgressFetch 안에서만 일어난다(옆에 약한 것을 만들지 않는다)', () => {
    expect(CODE).toContain("from './ai-call-log-sink'");
    expect(CODE).toContain('emitAiCallLog(');
    // 🔴 응답 본문은 clone 으로만 만진다 — 원본을 읽는 코드가 생기면 여기서 잡힌다
    expect(CODE, '주석이 아니라 코드에 res.clone() 이 있어야 한다').toMatch(/clone\s*=\s*res\.clone\(\)/);
    expect(CODE, '원 응답을 직접 소비하면 호출부가 빈 손이 된다').not.toMatch(
      /await\s+res\.(json|text)\(\)/,
    );
  });

  it('싱크는 DI 를 요구하지 않는다(순수 함수 경로를 지킨다)', () => {
    const sink = readFileSync(join(API_ROOT, 'src/common/util/ai-call-log-sink.ts'), 'utf8');
    expect(sink).not.toMatch(/@Injectable|PrismaService/);
  });
});
