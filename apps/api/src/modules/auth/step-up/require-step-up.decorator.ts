import { SetMetadata } from '@nestjs/common';
import { createHash } from 'crypto';

export const STEP_UP_ACTION = 'step_up_action';

/**
 * 고위험 엔드포인트에 step-up 재인증을 요구 (FR-10).
 * 사용: @UseGuards(JwtAuthGuard, StepUpGuard) @RequireStepUp('PRESCRIPTION_SIGN')
 * 클라이언트는 헤더 `x-step-up-token` 으로 step-up 토큰 전달.
 */
export const RequireStepUp = (action: string) => SetMetadata(STEP_UP_ACTION, action);

/** 요청 본문 → 정규 해시 (FR-09 bodyHash 바인딩 검증용 공용 유틸) */
export function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}
