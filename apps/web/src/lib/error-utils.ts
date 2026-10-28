import { ApiError } from './api-client';
import { serverMessageText } from './server-message-text';
import { useUiLocaleStore } from '@/stores/ui-locale-store';

const STATUS_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: '세션이 만료되었습니다. 다시 로그인해주세요.',
  FORBIDDEN: '접근 권한이 없습니다.',
  NOT_FOUND: '요청한 데이터를 찾을 수 없습니다.',
  CONFLICT: '데이터가 이미 존재하거나 충돌이 발생했습니다.',
  VALIDATION_ERROR: '입력 값을 확인해주세요.',
  NETWORK_ERROR: '서버와 연결할 수 없습니다.',
};

/**
 * 🔴 **세션이 끝난 오류인가** — 이 판정이 필요한 이유는 하나다:
 *    세션 만료에 "재시도"를 권하면 **될 수 없는 행동을 권하는 것**이다.
 *    눌러도 같은 401 로 돌아온다(2026-08-28 사람 신고).
 */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNAUTHORIZED';
}

/**
 * 🔴 **권한이 없어 막힌 오류인가** — 세션 만료와 같은 이유로 필요한 판정이다(2026-09-02).
 *    종전엔 403 이 일반 오류로 떨어져 *"잠시 후 다시 시도해주세요"* + **재시도** 버튼이 붙었다.
 *    권한은 기다린다고 생기지 않는다 — 될 수 없는 행동을 권하지 않는다.
 *    이 저장소는 **14역할 중 9역할이 상시 403 배너를 보던** 이력이 있어 노출 빈도가 실제로 높다.
 */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'FORBIDDEN' || error.code === 'Forbidden');
}

/**
 * 오류 문장 — 서버 예외가 `{ k, params }`(`ApiError.msg`)를 실었으면 **지금 화면 언어**로 조립한다(2026-09-15 I4).
 * 🔴 msg 가 없으면 종전 그대로 서버 원문 `message`(하위 호환 — 구 응답·msg 없는 예외).
 * `locale` 을 안 주면 화면 언어 스토어의 현재 값 — 훅 밖(전역 `MutationCache.onError` 토스트)에서도 쓰기 위해서다.
 */
export function extractErrorMessage(error: unknown, locale?: string): string {
  if (error instanceof ApiError) {
    if (error.msg) return serverMessageText(error.msg, locale ?? useUiLocaleStore.getState().locale);
    return error.message || STATUS_MESSAGES[error.code] || '오류가 발생했습니다.';
  }
  if (error instanceof Error) {
    if (error.message === 'Failed to fetch') return '서버와 연결할 수 없습니다.';
    return error.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
