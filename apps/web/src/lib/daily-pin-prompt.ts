// 데일리 PIN 승인 게이트 — 전역 프롬프트 레지스트리 (단말 제로트러스트 ② Step 2 FE).
// api-client 가 403 DAILY_PIN_REQUIRED 수신 시 promptDailyPin() 으로 PIN 모달을 띄우고,
// DailyPinPrompt 컴포넌트가 registerDailyPinPrompt 로 실제 핸들러를 등록한다.
// (React 비의존 — 'use client' 불필요. 핸들러는 클라이언트 컴포넌트가 마운트 시 등록.)

export interface DailyPinPromptOptions {
  invalid?: boolean; // 직전 시도가 PIN 불일치였는지(재입력 안내)
}

type PromptFn = (opts: DailyPinPromptOptions) => Promise<string | null>;

let handler: PromptFn | null = null;

export function registerDailyPinPrompt(fn: PromptFn | null): void {
  handler = fn;
}

/** PIN 입력 요청. 핸들러 미등록(서버/모달 없음) 시 null → 호출측은 취소 처리. */
export function promptDailyPin(opts: DailyPinPromptOptions = {}): Promise<string | null> {
  if (!handler) return Promise.resolve(null);
  return handler(opts);
}
