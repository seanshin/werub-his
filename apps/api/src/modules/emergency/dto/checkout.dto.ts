import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/** 응급 퇴실 확정(2026-10-03 결정 D9) — 퇴실 시각을 남긴다. 비우면 지금(처리 시각) · 넣으면 직원이 입력한 시각(USER_CLAIMED) */
export class CheckoutEmergencyDto {
  @ApiPropertyOptional({ description: '실제 퇴실 시각(ISO) — 지금과 다를 때만. 도착 이전·미래는 거부' })
  @IsOptional() @IsISO8601()
  departedAt?: string;
}
