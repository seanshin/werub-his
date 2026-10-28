import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { MedicalAiService, MEDICAL_ASK_UNAVAILABLE_REASONS } from '../../src/modules/medical-ai/medical-ai.service';

/**
 * 🔴 `medicalAsk` 3상태 + 컨시어지 접속 정본 — 외부 점검.
 *
 * 종전 `medicalAsk` 는 실패를 `catch → null` 로 삼켰다. 호출부는 그 `null` 로 '참고 안내' 블록을 **통째로 생략**했고,
 * 상류가 401/404 로 늘 실패해도 화면에는 "못 얻었다"가 한 글자도 없었다. 없는 것과 못 얻은 것은 다른 사실이다.
 *
 * 이 가드가 못박는 것:
 *   ① 성공은 `{source:'AI', data}` · 실패는 `{source:'UNAVAILABLE', reason:<코드>}` — **`null` 을 돌려주지 않는다**
 *   ② 사유는 우리 예외 봉투의 `code`/상태코드에서만 온다 — 🔴 상류 **본문** 텍스트를 패턴으로 판정하지 않는다
 *   ③ `resolveAiServerTarget` — 다른 클라이언트(컨시어지)가 같은 상류를 부를 때의 URL·인증 정본. 키가 비면 헤더를 붙이지 않는다
 */

const logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
const callAsk = (request: (...a: unknown[]) => Promise<unknown>) =>
  (MedicalAiService.prototype as any).medicalAsk.call({ logger, request }, { symptoms: ['복통'] });

describe('① medicalAsk 는 3상태로 말한다 — null 을 돌려주지 않는다', () => {
  it('상류가 답하면 source=AI 에 본문을 싣는다', async () => {
    const r = await callAsk(async () => ({ answer: '수분 섭취를 권합니다', category: 'general' }));
    expect(r).toEqual({ source: 'AI', data: { answer: '수분 섭취를 권합니다', category: 'general' } });
  });

  it('🔴 401 은 키 인증 실패다 — UNAVAILABLE/AI_UPSTREAM_AUTH(재시도로 안 풀린다)', async () => {
    const r = await callAsk(async () => { throw new Error('AI API error: 401'); });
    expect(r).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_AUTH' });
  });

  it('예외 봉투의 code 를 그대로 사유로 쓴다(URL 미설정·egress 차단·kill switch·200 실패)', async () => {
    for (const code of ['AI_SERVER_URL_UNSET', 'AI_EGRESS_BLOCKED', 'AI_DISABLED'] as const) {
      const r = await callAsk(async () => { throw new ServiceUnavailableException({ code, message: 'x' }); });
      expect(r).toEqual({ source: 'UNAVAILABLE', reason: code });
    }
    const r = await callAsk(async () => { throw new ServiceUnavailableException({ error: 'AI_UPSTREAM_FAILED', message: 'x' }); });
    expect(r).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_FAILED' });
  });

  it('5xx 는 상류 오류, 모르는 실패는 AI_REQUEST_FAILED — 어느 경우도 null·빈 answer 를 지어내지 않는다', async () => {
    expect(await callAsk(async () => { throw new Error('AI API error: 503'); })).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_ERROR' });
    expect(await callAsk(async () => { throw new TypeError('fetch failed'); })).toEqual({ source: 'UNAVAILABLE', reason: 'AI_REQUEST_FAILED' });
  });

  it('🔴 대조군 — 상류 본문에 "error"·"medication error" 가 들어 있어도 AI 답변이다(본문 텍스트 패턴 판정 금지)', async () => {
    const r = await callAsk(async () => ({ answer: 'medication error 로 인한 저혈당 의심 — 투약 오류 보고 권장', tokens: 812 }));
    expect(r.source).toBe('AI');
  });

  it('사유 어휘는 코드만이다(한국어 문장이 없다) — 화면이 카탈로그로 말한다', () => {
    for (const reason of MEDICAL_ASK_UNAVAILABLE_REASONS) expect(reason).toMatch(/^[A-Z_]+$/);
  });

  it('🔴 구조 — medicalAsk 본문에 `return null` 이 없다(삼킴 경로가 되살아나지 않았다)', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/medical-ai/medical-ai.service.ts'), 'utf8');
    const body = src.slice(src.indexOf('async medicalAsk('), src.indexOf('private static upstreamFailureReason'));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(/return null/);
    expect(body).toMatch(/source: 'UNAVAILABLE'/);
  });
});

describe('③ resolveAiServerTarget — 컨시어지가 지나는 접속 정본', () => {
  const resolve = (cfg: { url: string; key: string; gpuKey: string; enabled: boolean }) =>
    (MedicalAiService.prototype as any).resolveAiServerTarget.call({ getAiConfig: vi.fn(async () => cfg) });

  it('URL·X-Medical-Key(apiKey)·Bearer(gpuKey)·kill switch 를 한 번에 낸다', async () => {
    const t = await resolve({ url: 'https://ai.example', key: 'mk', gpuKey: 'gk', enabled: true });
    expect(t).toEqual({ url: 'https://ai.example', headers: { 'X-Medical-Key': 'mk', Authorization: 'Bearer gk' }, enabled: true });
  });

  it('🔴 키가 비어 있으면 헤더를 붙이지 않는다 — 빈 Bearer 를 지어내지 않는다', async () => {
    const t = await resolve({ url: 'https://ai.example', key: '', gpuKey: '', enabled: false });
    expect(t.headers).toEqual({});
    expect(t.enabled).toBe(false);
  });

  it('🔴 구조 — 컨시어지는 env·DB 를 직접 읽지 않고 이 정본만 부른다(정본이 둘이면 갈라진다)', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/concierge/concierge.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/process\.env\.MEDICAL_AI_URL/);
    expect(src).not.toMatch(/systemConfig\./);
    expect(src).toMatch(/resolveAiServerTarget\(\)/);
    // 정본이 돌려준 헤더를 실제 호출에 싣는다(이름만 있고 안 쓰는 것을 통과시키지 않는다)
    expect((src.match(/headers: target[!]?\.headers/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
