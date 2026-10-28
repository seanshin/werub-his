import { ServiceUnavailableException } from '@nestjs/common';

/**
 * 🔴 AI kill switch(`ai.server.enabled`) 판정·거절의 정본.
 *
 * 외부 점검 r3 B6: `ai.server.enabled=false` 를 **읽지 않는 AI 클라이언트 4곳**
 * (portal/drug-explain · formulary · gld/governance · i18n/translation)이 있었다 — 관리자가 AI 를 꺼도
 * 이 넷은 `ai.server.url` 로 프롬프트를 계속 보냈다("끄면 안 나간다"는 약속이 깨짐).
 * 게이트를 거는 쪽(medical-ai·scribe·stt-chunk·voc·data-quality·concierge)은 각자 같은 규칙을 적고 있었다.
 *
 * 규칙: **명시적 `false`(불리언 또는 문자열 'false')만 꺼짐** — 미설정·기본값은 켜짐(코드 기본 true).
 * 꺼져 있으면 요청을 **보내지 않고** 503 `AI_DISABLED` 로 말한다(조용히 폴백하지 않는다 — 호출부는
 * 출처 3상태의 `UNAVAILABLE` 로 접는다).
 */
export function isAiServerEnabled(raw: unknown): boolean {
  return !(raw === false || raw === 'false');
}

export const AI_DISABLED_CODE = 'AI_DISABLED' as const;

/** kill switch 거절 — 문구는 medical-ai 정본(`aiFetch`)과 같은 한 문장. */
export function aiDisabledException(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: AI_DISABLED_CODE,
    message: 'WeRU.B 보조가 관리자에 의해 비활성화되어 있습니다',
  });
}

/** 예외가 kill switch 거절인가 — 호출부가 "실패"와 "꺼짐"을 가를 때 쓴다. */
export function isAiDisabledError(e: unknown): boolean {
  if (!(e instanceof ServiceUnavailableException)) return false;
  const r = e.getResponse();
  return typeof r === 'object' && r !== null && (r as { code?: unknown }).code === AI_DISABLED_CODE;
}
