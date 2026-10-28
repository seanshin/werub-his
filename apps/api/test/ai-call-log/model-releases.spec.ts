import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AiCallLogService } from '../../src/modules/ai-call-log/ai-call-log.service';
import {
  REQUIRED_MODEL_TAGS,
  REQUIRED_MODEL_TAG_LIST,
  NON_REQUESTED_MODEL_LABELS,
  computeMissingTags,
  normalizeModelTag,
} from '../../src/modules/ai-call-log/required-model-tags';
import { clearAiCallLogSink } from '../../src/common/util/ai-call-log-sink';

/**
 * 🔴 모델 정합 판정 가드 — 기획서 §2.2.
 *
 * 태어난 이유(실측 피해): AI 서버 이전 후 `gemma3:12b` 가 상류에 없어 컨시어지가 **상시 FALLBACK** 이었는데
 * 화면 어디에도 "우리가 부르는 모델이 서버에 없다"는 사실이 없었다. 그래서 이 가드가 굳히는 것은
 * "무엇이 없는가"가 아니라 **"모를 때 없다고 말하지 않는가"** 다.
 *
 *  ① `available` 이 null(=물어보지 못함)이면 `missing` 도 null — 0개로도 전부 없음으로도 접지 않는다.
 *  ② 요구 태그 목록이 코드와 갈라지지 않는다(등재한 태그가 실제로 그 파일에 있는지 기계 대조).
 *  ③ 상류 조회 실패·형식 불일치·미설정은 **서로 다른 사유 문자열**로 올라온다(한 덩어리로 뭉치지 않는다).
 *  ④ 호출 분포는 분모(sample)를 함께 낸다 — 표본 0 이면 rows 는 빈 목록이고 비율은 산출 불가다.
 *
 * 재주입 검증(2026-09-09 실행 · 넣고 실패 확인 후 원복):
 *   (1) `computeMissingTags` 의 `if (available == null) return null` → `return REQUIRED_MODEL_TAG_LIST` → ① 실패
 *   (2) `upstreamModels` 의 catch 를 `{ available: [] }` 로 → ①·③ 실패
 *   (3) 요구 목록에 코드에 없는 태그(`llama3:70b`) 추가 → ② 실패
 */

const API_ROOT = join(__dirname, '../..');

describe('① 판정 불가를 "없음"으로 접지 않는다', () => {
  it('available 이 null 이면 missing 도 null 이다', () => {
    expect(computeMissingTags(null)).toBeNull();
  });

  it('available 이 빈 배열이면 그것은 실제 0 이다 — 전부 missing(다른 사실)', () => {
    expect(computeMissingTags([])).toEqual([...REQUIRED_MODEL_TAG_LIST]);
  });

  it('상류 표기 차이(:latest)만 흡수한다 — 이름이 비슷하다고 같은 모델로 치지 않는다', () => {
    expect(normalizeModelTag('qwen2.5:14b:latest')).toBe('qwen2.5:14b');
    expect(computeMissingTags(['qwen2.5:14b:latest', 'qwen2.5:7b', 'gemma3:12b', 'gemma3:4b'])).toEqual([]);
    // 접두어가 붙은 다른 태그는 같은 것이 아니다
    expect(computeMissingTags(['werub/qwen2.5:14b'])).toContain('qwen2.5:14b');
  });

  it('실측 사례 재현 — gemma3:12b 만 없으면 missing 은 그 하나뿐이다', () => {
    expect(computeMissingTags(['qwen2.5:14b', 'qwen2.5:7b', 'gemma3:4b'])).toEqual(['gemma3:12b']);
  });
});

describe('② 요구 태그 목록이 코드와 갈라지지 않는다', () => {
  it('등재한 태그는 등재한 파일에 실제로 있다(사라진 태그를 요구하고 있지 않다)', () => {
    for (const entry of REQUIRED_MODEL_TAGS) {
      expect(entry.sites.length, `${entry.tag} 의 사용처가 비었다`).toBeGreaterThan(0);
      const found = entry.sites.filter((rel) => {
        const abs = join(API_ROOT, rel);
        return existsSync(abs) && readFileSync(abs, 'utf8').includes(entry.tag);
      });
      expect(
        found.length,
        `${entry.tag} 를 등재된 어느 파일에서도 찾지 못했다 — 코드가 바뀌었거나 목록이 틀렸다:\n${entry.sites.join('\n')}`,
      ).toBeGreaterThan(0);
    }
  });

  it('요청 태그가 아닌 표시 문자열은 요구 목록에 넣지 않는다(werub/ 접두어)', () => {
    for (const label of NON_REQUESTED_MODEL_LABELS) {
      expect(REQUIRED_MODEL_TAG_LIST, `${label} 은 상류에 요청하는 태그가 아니다`).not.toContain(label);
    }
  });
});

// ── 서비스 하네스 ─────────────────────────────────────────────────────────────
function newService(prisma: Record<string, unknown>) {
  return new AiCallLogService(prisma as never);
}

const AI_URL = 'https://example.org/ollama';

describe('③ upstream-models — 사유를 구분해 말한다', () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAiCallLogSink();
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); clearAiCallLogSink(); });

  const prismaWith = (url: string | null) => ({
    systemConfig: { findFirst: vi.fn().mockResolvedValue(url == null ? null : { key: 'ai.server.url', value: url }) },
  });

  it('ai.server.url 미설정 — 물어보지 않았다고 말한다(available·missing 둘 다 null)', async () => {
    const out = await newService(prismaWith(null)).upstreamModels();
    expect(out.available).toBeNull();
    expect(out.missing).toBeNull();
    expect(out.reason).toContain('ai.server.url');
    expect(fetchSpy, '미설정인데 나갔다').not.toHaveBeenCalled();
    expect(out.required.map((r) => r.tag)).toEqual([...REQUIRED_MODEL_TAG_LIST]);
  });

  it('상류 200 — 보유 목록과 대조해 missing 을 낸다', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }, { name: 'qwen2.5:7b' }, { model: 'gemma3:4b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as never,
    );
    const out = await newService(prismaWith(AI_URL)).upstreamModels();
    expect(out.available).toEqual(['qwen2.5:14b', 'qwen2.5:7b', 'gemma3:4b']);
    expect(out.missing).toEqual(['gemma3:12b']);
    expect(out.reason).toBeNull();
  });

  it('상류 오류(500) — 0개가 아니라 판정 불가다', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }) as never);
    const out = await newService(prismaWith(AI_URL)).upstreamModels();
    expect(out.available).toBeNull();
    expect(out.missing).toBeNull();
    expect(out.reason).toContain('500');
  });

  it('형식 불일치(models 배열 없음) — 빈 목록으로 읽지 않는다', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }) as never,
    );
    const out = await newService(prismaWith(AI_URL)).upstreamModels();
    expect(out.available).toBeNull();
    expect(out.missing).toBeNull();
    expect(out.reason).toContain('models');
  });

  it('네트워크 실패 — 사유를 그대로 전하고 판정하지 않는다', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    const out = await newService(prismaWith(AI_URL)).upstreamModels();
    expect(out.available).toBeNull();
    expect(out.missing).toBeNull();
    expect(out.reason).toContain('ECONNREFUSED');
  });
});

describe('④ call-stats — 분모를 함께 낸다', () => {
  beforeEach(() => { clearAiCallLogSink(); vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); clearAiCallLogSink(); });

  it('표본 0 — rows 는 빈 목록이고 sample 은 0 이다(비율을 만들어내지 않는다)', async () => {
    const svc = newService({ aiCallLog: { groupBy: vi.fn().mockResolvedValue([]) } });
    const out = await svc.callStats(7);
    expect(out.sample).toBe(0);
    expect(out.rows).toEqual([]);
    expect(out.byStatusClass).toEqual([]);
    expect(out.windowDays).toBe(7);
  });

  it('모델×스킬 건수 · 상태 분류 · 요청↔상류 태그 불일치를 드러낸다', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { skill: 'concierge', requestedModel: 'gemma3:12b', modelRef: 'gemma3:4b', httpStatus: 200, _count: { _all: 7 } },
      { skill: 'concierge', requestedModel: 'gemma3:12b', modelRef: 'gemma3:4b', httpStatus: 500, _count: { _all: 2 } },
      { skill: 'formulary', requestedModel: 'qwen2.5:14b', modelRef: 'qwen2.5:14b', httpStatus: null, _count: { _all: 1 } },
    ]);
    const out = await newService({ aiCallLog: { groupBy } }).callStats(7);
    expect(out.sample).toBe(10);
    expect(out.rows[0]).toMatchObject({
      skill: 'concierge', calls: 9, ok: 7, failed: 2, unknownStatus: 0, mismatch: true,
    });
    expect(out.rows[1]).toMatchObject({ skill: 'formulary', calls: 1, unknownStatus: 1, mismatch: false });
    const labels = out.byStatusClass.map((s) => s.label);
    expect(labels).toContain('2xx');
    expect(labels).toContain('5xx');
    // 🔴 응답이 없던 호출은 5xx 로 뭉치지 않는다(다른 사실이다)
    expect(labels).toContain('응답 없음(전송 실패·타임아웃)');
  });

  it('기간은 1~90일로 잠근다(경계를 벗어난 입력을 조용히 넓히지 않는다)', async () => {
    const svc = newService({ aiCallLog: { groupBy: vi.fn().mockResolvedValue([]) } });
    expect((await svc.callStats(0)).windowDays).toBe(1);
    expect((await svc.callStats(9999)).windowDays).toBe(90);
    expect((await svc.callStats(Number.NaN)).windowDays).toBe(7);
  });
});

describe('릴리즈 원장 — 지우지 않고 폐기한다', () => {
  beforeEach(() => { clearAiCallLogSink(); });
  afterEach(() => { vi.restoreAllMocks(); clearAiCallLogSink(); });

  it('폐기는 retiredAt 을 적는다(delete 를 부르지 않는다)', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'r1', retiredAt: new Date() });
    const del = vi.fn();
    const svc = newService({
      aiModelRelease: {
        findUnique: vi.fn().mockResolvedValue({ id: 'r1', retiredAt: null, notes: '기존' }),
        update,
        delete: del,
      },
    });
    await svc.retireRelease('r1', '상류에서 내려감');
    expect(del).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data.retiredAt).toBeInstanceOf(Date);
    expect(update.mock.calls[0][0].data.notes).toContain('기존'); // 기존 기록을 덮지 않는다
  });

  it('없는 릴리즈·이미 폐기된 릴리즈는 서로 다른 사실로 올라간다', async () => {
    const missing = newService({ aiModelRelease: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(missing.retireRelease('r1')).rejects.toBeInstanceOf(NotFoundException);

    const already = newService({
      aiModelRelease: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', retiredAt: new Date() }) },
    });
    await expect(already.retireRelease('r1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('승인 근거가 없으면 approvalRef 는 null 이다(있는 척하지 않는다)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r1' });
    const svc = newService({ aiModelRelease: { create } });
    await svc.createRelease({ provider: 'WeRU.B', modelTag: 'qwen2.5:14b', approvedBy: 'u1' });
    expect(create.mock.calls[0][0].data.approvalRef).toBeNull();
    expect(create.mock.calls[0][0].data.digest).toBeNull();
    expect(create.mock.calls[0][0].data.deployedAt).toBeInstanceOf(Date);
  });
});
