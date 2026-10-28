import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 인증 정책 변경이 `Partial<AuthPolicy>` 본문을 `{ ...current, ...patch }` 로 Redis 정책에 그대로 합쳤다 —
 * 모르는 키가 정책 객체에 쌓이고, `maxDevices: 'abc'`·음수가 그대로 저장됐다. 필드는 `DEFAULT_POLICY` 5개 그대로.
 */
export class SetAuthPolicyDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @IsPositive() maxDevices?: number;
  @ApiPropertyOptional({ description: '분' }) @IsOptional() @Type(() => Number) @IsInt() @IsPositive() idleClinicalMin?: number;
  @ApiPropertyOptional({ description: '분' }) @IsOptional() @Type(() => Number) @IsInt() @IsPositive() idleAdminMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) attestation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) syncedPasskey?: string;
}

export class DeprovisionStaffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
