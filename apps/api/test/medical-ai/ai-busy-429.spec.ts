/**
 * AI 서버 동시 처리 거절.
 *  · 429 는 Retry-After(초 · 못 읽으면 5 · 1~10 으로 자름)만큼 쉬고 최대 2회 다시 보낸다 — 그 밖의 상태는 다시 보내지 않는다(502·503 뜻은 그대로)
 *  · 재시도 뒤에도 바쁘면 HTTP 429 `AI_UPSTREAM_BUSY`(+retryAfter) — 500("고장")으로 바꿔 말하지 않는다
 *  · 3상태 사유 어휘에 AI_UPSTREAM_BUSY
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

const egress = vi.fn();
vi.mock('../../src/common/util/ai-egress-fetch', async (orig) => ({ ...(await orig<object>()), aiEgressFetch: (...a: unknown[]) => egress(...a) }));

import { MedicalAiService, aiRetryAfterMs, AI_BUSY_MAX_RETRIES } from '../../src/modules/medical-ai/medical-ai.service';

const resp = (status: number, retryAfter?: string, body: unknown = { ok: true, answer: 'x', tokens: 10 }) =>
  new Response(JSON.stringify(body), { status, headers: retryAfter ? { 'Retry-After': retryAfter, 'content-type': 'application/json' } : { 'content-type': 'application/json' } });

function svc() {
  const sleeps: number[] = [];
  const s = Object.create(MedicalAiService.prototype) as any;
  s.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
  s.getAiConfig = async () => ({ url: 'http://ai.local', key: 'k', gpuKey: '', enabled: true, timeoutMs: 1000 });
  s.assertAiEgressUrl = () => undefined;
  s.sleep = async (ms: number) => { sleeps.push(ms); };
  return { s, sleeps };
}

beforeEach(() => egress.mockReset());

describe('Retry-After 해석', () => {
  it('초 단위 · 못 읽으면 5초 · 1~10초로 자름', () => {
    expect(aiRetryAfterMs('5')).toBe(5000);
    expect(aiRetryAfterMs('2')).toBe(2000);
    expect(aiRetryAfterMs(null)).toBe(5000);
    expect(aiRetryAfterMs('abc')).toBe(5000);
    expect(aiRetryAfterMs('0')).toBe(5000);
    expect(aiRetryAfterMs('120')).toBe(10000);
  });
});

describe('aiFetch — 429 재시도', () => {
  it('🔴 429 두 번 뒤 성공 — Retry-After 만큼 쉬고 다시 보낸다', async () => {
    egress.mockResolvedValueOnce(resp(429, '5')).mockResolvedValueOnce(resp(429, '3')).mockResolvedValueOnce(resp(200));
    const { s, sleeps } = svc();
    const r = await s.aiFetch('/api/medical/predict/complication', { body: { a: 1 } });
    expect(r.status).toBe(200);
    expect(egress).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([5000, 3000]);
  });

  it('🔴 최대 2회 — 세 번째 429 는 그대로 돌려준다', async () => {
    egress.mockResolvedValue(resp(429, '5'));
    const { s } = svc();
    const r = await s.aiFetch('/api/medical/predict/complication', { body: {} });
    expect(r.status).toBe(429);
    expect(egress).toHaveBeenCalledTimes(AI_BUSY_MAX_RETRIES + 1);
  });

  it('🔴 대조군 — 502·503 은 다시 보내지 않는다(생성 실패·불안정은 뜻이 그대로)', async () => {
    for (const st of [502, 503]) {
      egress.mockReset(); egress.mockResolvedValue(resp(st));
      const { s, sleeps } = svc();
      expect((await s.aiFetch('/api/medical/predict/complication', { body: {} })).status).toBe(st);
      expect(egress).toHaveBeenCalledTimes(1);
      expect(sleeps).toEqual([]);
    }
  });
});

describe('request — 재시도 뒤에도 바쁘면 429 AI_UPSTREAM_BUSY', () => {
  it('🔴 HTTP 429 · code AI_UPSTREAM_BUSY · retryAfter', async () => {
    egress.mockResolvedValue(resp(429, '5', { error: 'server busy', code: 'server_busy', retry_after: 5 }));
    const { s } = svc();
    const err = await s.request('/api/medical/predict/complication', { age: 70 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'AI_UPSTREAM_BUSY', retryAfter: 5 });
  });

  it('대조군 — 502 는 종전대로 상류 오류(AI API error: 502)', async () => {
    egress.mockResolvedValue(resp(502, undefined, { code: 'generation_failed' }));
    const { s } = svc();
    await expect(s.request('/api/medical/predict/complication', {})).rejects.toThrow('AI API error: 502');
  });

  it('🔴 3상태 사유 — 바쁨은 AI_UPSTREAM_BUSY', async () => {
    egress.mockResolvedValue(resp(429, '5'));
    const { s } = svc();
    const r = await (MedicalAiService.prototype as any).medicalAsk.call(s, { symptoms: ['복통'] });
    expect(r).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_BUSY' });
  });
});

describe('스트리밍 — 중간 오류 이벤트(server_busy)', () => {
  const ndjson = (lines: string[]) => new Response(lines.join('\n'), { status: 200 });
  it('🔴 앞부분 내용 뒤 server_busy 이벤트 → 답을 버리고 BUSY(끊긴 앞부분을 완결된 답으로 쓰지 않는다)', async () => {
    egress.mockResolvedValue(ndjson(['{"message":{"content":"두통은 "}}', 'data: {"error":"server busy","code":"server_busy","status":429,"retry_after":5}']));
    const { s } = svc();
    expect(await s.chatWithSession('두통', {})).toMatchObject({ answer: '', failure: 'BUSY' });
  });
  it('바쁨 아닌 오류 이벤트는 ERROR', async () => {
    egress.mockResolvedValue(ndjson(['{"error":"generation_failed","status":502}']));
    const { s } = svc();
    expect(await s.chatWithSession('두통', {})).toMatchObject({ answer: '', failure: 'ERROR' });
  });
  it('대조군 — 오류 없는 스트림은 이어 붙인 답', async () => {
    egress.mockResolvedValue(ndjson(['{"message":{"content":"두통은 "}}', '{"message":{"content":"쉬세요"},"session_id":"s1"}']));
    const { s } = svc();
    const r = await s.chatWithSession('두통', {});
    expect(r).toMatchObject({ answer: '두통은 쉬세요', sessionId: 's1' });
    expect(r.failure).toBeUndefined();
  });
  it('🔴 재시도 뒤에도 429 면 BUSY(고장과 구분)', async () => {
    egress.mockResolvedValue(resp(429, '5'));
    const { s } = svc();
    expect(await s.chatWithSession('두통', {})).toMatchObject({ answer: '', failure: 'BUSY' });
  });
  it('🔴 SOAP 스트림 시작이 429 면 HTTP 429 AI_UPSTREAM_BUSY — 500 이 아니다', async () => {
    egress.mockResolvedValue(resp(429, '5'));
    const { s } = svc();
    const err = await s.summarizeStream('S: 기침').catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'AI_UPSTREAM_BUSY' });
  });
});
