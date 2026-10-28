/**
 * 🔴 상담실 AI 자동응답 게이트 — **안전한 쪽이 기본**.
 *
 * 원 결함: `ConsultSession.aiMode` 의 스키마 기본값이 `AUTO` 이고, 애플리케이션도 팀 미지정 시
 * `'AUTO'` 를 그대로 썼다. 그 결과 `/portal/consult/:id/message` 의 LLM 출력이 **사람 검토 없이
 * 저장되고 환자에게 즉시 전송**됐다(운영 실측: AUTO 6세션·AI 메시지 11건).
 * `SUGGEST`(초안만 만들고 직원이 검토 후 전송)·`OFF` 라는 안전 모드가 **이미 구현되어 있는데**
 * 기본값이 아니었다.
 *
 * 여기서 고치는 방식과 그 이유:
 *  - **스키마 기본값은 건드리지 않는다**(마이그레이션 소유권이 다르다). 대신 **쓰기·실행 두 지점 모두에서
 *    애플리케이션이 clamp** 한다 — 그래야 ① 새 세션이 AUTO 로 태어나지 않고 ② **이미 AUTO 인 기존 행도**
 *    자동 전송되지 않는다(DB 를 고치지 않고 위험이 멈춘다).
 *  - 자동응답을 정말 원하는 병원은 SystemConfig `consult.ai.autoReply = true` 로 **명시 선택**한다.
 *    미설정·조회 실패는 전부 차단(fail-closed) — "폴백 있음 ≠ 안 쓰임"의 반대 방향으로만 실패한다.
 *  - clamp 가 걸렸는데 화면이 "AUTO" 라고 말하면 그것도 거짓말이다 → 조회 응답은 **유효 모드**를 돌려주고,
 *    저장값이 다르면 `aiModeGateOff` 로 사실을 밝힌다. AUTO 로 **바꾸려는 시도**는 조용히 강등하지 않고
 *    거절한다(무엇이 막고 있는지 화면이 말해야 한다).
 */

export const CONSULT_AUTO_REPLY_KEY = 'consult.ai.autoReply';

export type ConsultAiMode = 'AUTO' | 'SUGGEST' | 'OFF';

/** 모드 미상·미지정일 때의 정답 — `AUTO` 가 아니라 사람 검토가 끼는 `SUGGEST`. */
export const SAFE_DEFAULT_AI_MODE: ConsultAiMode = 'SUGGEST';

type SystemConfigReader = { systemConfig: { findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null> } };

/**
 * 환자에게 **사람 검토 없이** AI 답변을 보내도 되는가.
 * 명시적으로 `true` 일 때만 허용 — 미설정/오류/타입불일치는 전부 false.
 */
export async function isConsultAutoReplyAllowed(prisma: SystemConfigReader): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONSULT_AUTO_REPLY_KEY } });
    const v = row?.value;
    return v === true || v === 'true';
  } catch {
    return false; // 설정을 못 읽으면 자동 전송하지 않는다(fail-closed)
  }
}

/** 저장·실행 직전 clamp. 게이트가 꺼져 있으면 AUTO 는 SUGGEST 로 내려간다. */
export function clampAiMode(mode: string | null | undefined, autoAllowed: boolean): ConsultAiMode {
  const m = String(mode ?? '').toUpperCase();
  if (m === 'OFF') return 'OFF';
  if (m === 'SUGGEST') return 'SUGGEST';
  if (m === 'AUTO') return autoAllowed ? 'AUTO' : SAFE_DEFAULT_AI_MODE;
  return SAFE_DEFAULT_AI_MODE; // 알 수 없는 값 = 안전한 쪽
}
