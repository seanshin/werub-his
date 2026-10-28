// 스마트폰 푸시 생체승인 — 전역 프롬프트 레지스트리 (단말 제로트러스트 ② Tier2 Step C).
// api-client 가 403 STEPUP_REQUIRED 수신 시 promptStepUp({action,resourceId}) 호출 →
// StepUpApprovalPrompt 컴포넌트가 push/request + status polling 으로 승인 대기 후 step-up 토큰 반환.

export interface StepUpPromptOptions {
  action: string;
  resourceId?: string;
}

// resolve: 승인 완료 시 step-up 토큰, 취소/만료/거부 시 null
type PromptFn = (opts: StepUpPromptOptions) => Promise<string | null>;

let handler: PromptFn | null = null;

export function registerStepUpPrompt(fn: PromptFn | null): void {
  handler = fn;
}

export function promptStepUp(opts: StepUpPromptOptions): Promise<string | null> {
  if (!handler) return Promise.resolve(null);
  return handler(opts);
}
