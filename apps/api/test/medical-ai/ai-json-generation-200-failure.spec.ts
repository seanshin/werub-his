import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

/**
 * 🔴 R43(200 인데 실패) 봉합이 닿지 않은 자리 — `aiJson` 을 지나는 **생성형** 호출(2026-09-28 a18ec 재판정).
 *
 * 1c6e7cd98 은 `request()/requestGet()` 에만 `assertUpstreamOk` 를 걸었다. 영상 판독·번역·회의 분석 접수는
 * `aiJson` 을 지나므로 상류가 **200 + `success:false`/`error`/토큰 0** 으로 답해도 그대로 결과가 됐다.
 * 판정은 같은 정본(`assertUpstreamOk` — 구조로만, 본문 텍스트 패턴 금지)을 쓴다. 두 번째 판정기를 만들지 않는다.
 *
 * 대조군:
 *   · 정상 응답(임상 문장에 `error` 낱말 포함)은 통과한다
 *   · 상태·작업 조회는 판정하지 않는다 — 실패한 작업의 `error` 필드는 **조회된 사실**이다
 *   · 상담 대화는 판정하지 않는다 — 위기 정형 응답이 토큰 0 이어도 위기 배너가 살아 있어야 한다
 */

const okRes = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

function makeService(body: unknown) {
  const svc = Object.create(MedicalAiService.prototype) as any;
  svc.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  svc.llmTimeoutMs = 1000;
  svc.aiFetch = vi.fn(async () => okRes(body));
  return svc as MedicalAiService & { aiFetch: ReturnType<typeof vi.fn> };
}

const vision = (svc: MedicalAiService) =>
  svc.visionMedicalAnalyze({ imageBase64: Buffer.from('x').toString('base64'), modality: 'CR', bodyPart: 'CHEST' });

describe('🔴 aiJson 생성형 호출 — 200 으로 돌려준 실패를 결과로 넘기지 않는다', () => {
  it('영상 판독: success:false 는 503 AI_UPSTREAM_FAILED', async () => {
    const p = vision(makeService({ success: false, findings: '' }));
    await expect(p).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(vision(makeService({ success: false }))).rejects.toMatchObject({ response: { error: 'AI_UPSTREAM_FAILED' } });
  });

  it('번역: error 문자열이 실려 오면 실패다', async () => {
    await expect(makeService({ error: 'model not loaded', translated: '' }).translate('두통', 'en'))
      .rejects.toMatchObject({ response: { error: 'AI_UPSTREAM_FAILED' } });
  });

  it('번역: 토큰 0(생성 없음)은 실패다 — hallucination_check.passed:true 가 있어도', async () => {
    await expect(
      makeService({ translated: '', tokens: 0, hallucination_check: { passed: true } }).translate('두통', 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('회의 분석 접수: success:false 는 "접수됨"이 아니다', async () => {
    await expect(makeService({ success: false, error: 'queue full' }).meetingAnalyze({ file_url: 'https://x/y.mp4' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('대조군 — 성공·조회된 사실·안전측은 실패로 말하지 않는다', () => {
  it('정상 판독(소견에 "error" 낱말 포함)은 그대로 통과한다', async () => {
    const r: any = await vision(makeService({ findings: 'motion artifact — no acquisition error', tokens: 120 }));
    expect(r.findings).toContain('no acquisition error');
  });

  it('정상 번역은 그대로 통과한다', async () => {
    const r: any = await makeService({ translated: 'headache', tokens: 5 }).translate('두통', 'en');
    expect(r.translated).toBe('headache');
  });

  it('회의 시스템 상태 조회는 판정하지 않는다(error 필드는 상태 보고다)', async () => {
    const r: any = await makeService({ gpu: 'busy', error: 'whisper warming up' }).meetingStatus();
    expect(r.error).toBe('whisper warming up');
  });

  it('🔴 상담 대화: 위기 정형 응답(토큰 0)은 503 이 아니라 위기 판정을 그대로 싣는다', async () => {
    const r: any = await makeService({ response: '지금 바로 1393 에 연락하세요', is_crisis: true, tokens: 0 }).counselingChat('죽고 싶어요');
    expect(r.is_crisis).toBe(true);
    expect(r.crisis_assessed).toBe(true);
  });
});
