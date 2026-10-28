import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';

/** 보존명령 범위 — 법정 분류 키가 확정되기 전(T10-3)에는 환자 전체만 받는다(지어낸 분류를 강제하지 않는다) */
export const LEGAL_HOLD_SCOPES = ['ALL'] as const;

export class SetLegalHoldDto {
  @ApiProperty({ description: '보존 사유(소송·분쟁·수사 등)' })
  @IsString()
  @Length(1, 2000)
  reason!: string;

  @ApiPropertyOptional({ description: '근거(사건번호·요청 기관 등 자유 기재 — 검증하지 않는다)' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  basis?: string;

  @ApiPropertyOptional({ enum: LEGAL_HOLD_SCOPES, description: '범위 — 현재는 ALL(환자 전체)만' })
  @IsOptional()
  @IsIn([...LEGAL_HOLD_SCOPES])
  scope?: string;
}

export class RequestLegalHoldReleaseDto {
  @ApiProperty({ description: '해제 사유(필수 · 5자 이상)' })
  @IsString()
  @MinLength(5)
  @Length(5, 2000)
  reason!: string;
}
