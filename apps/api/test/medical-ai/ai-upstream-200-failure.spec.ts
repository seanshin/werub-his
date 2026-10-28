import { describe, it, expect } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

/**
 * 🔴 외부 점검 — AI 서버가 오류를 본문에 담아 **200 으로** 답하면,
 * HIS 는 그대로 201 로 넘겼고 화면은 상류가 붙인 `hallucination_check.passed: true` 까지 그렸다.
 * 실패가 "검증을 통과한 요약"이 되는 자리다.
 *
 * 판정은 **구조로만** 한다 — 🔴 본문 텍스트를 패턴으로 읽지 않는다.
 * 임상 문장에는 `medication error`·`투약 오류` 같은 정당한 말이 들어오기 때문이다(그것을 오류로 읽으면
 * 진짜 요약을 버린다). 아래 대조군이 그 사실을 지킨다.
 */
const assertUpstreamOk = (json: unknown) =>
  (MedicalAiService.prototype as any).assertUpstreamOk.call(
    { logger: { error: () => undefined } },
    '/api/medical/summarize',
    json,
  );

describe('🔴 AI 상류가 200 으로 돌려준 실패 — 성공으로 넘기지 않는다', () => {
  it('success:false 는 실패다', () => {
    expect(() => assertUpstreamOk({ success: false, raw: 'upstream failure' })).toThrow(ServiceUnavailableException);
  });

  it('error 문자열이 실려 있으면 실패다', () => {
    expect(() => assertUpstreamOk({ error: 'model timeout', raw: '' })).toThrow(ServiceUnavailableException);
  });

  it('토큰 사용량이 명시적으로 0 이면 생성이 없었던 것이다', () => {
    expect(() => assertUpstreamOk({ raw: '...', tokens: 0 })).toThrow(ServiceUnavailableException);
    expect(() => assertUpstreamOk({ raw: '...', usage: { total_tokens: 0 } })).toThrow(ServiceUnavailableException);
  });

  it('🔴 대조군 — 임상 문장에 error 가 들어 있어도 버리지 않는다(medication error·투약 오류)', () => {
    expect(() =>
      assertUpstreamOk({
        summary: { assessment: 'medication error 로 인한 저혈당 의심', plan: '투약 오류 보고' },
        tokens: 812,
      }),
    ).not.toThrow();
  });

  it('대조군 — 모양을 모르면 판정하지 않는다(배열·문자열·토큰 미표기)', () => {
    expect(() => assertUpstreamOk([{ a: 1 }])).not.toThrow();
    expect(() => assertUpstreamOk('plain')).not.toThrow();
    expect(() => assertUpstreamOk({ summary: { plan: '경과 관찰' } })).not.toThrow();
  });
});
