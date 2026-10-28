import { IsObject, IsOptional, IsString } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export class StepUpVerifyDto {
  @IsObject()
  response!: AuthenticationResponseJSON;

  /** 행위 식별 (예: PRESCRIPTION_SIGN) */
  @IsString()
  action!: string;

  /** 대상 리소스 id (예: 처방 id) */
  @IsOptional()
  @IsString()
  resourceId?: string;

  /** 요청 본문 해시(sha256 hex) — 리플레이 방지(FR-09) */
  @IsOptional()
  @IsString()
  bodyHash?: string;
}
