import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 U2) 손위생 관찰 기록 — 종전 인라인 타입 `{observedRole; moment; action…}` 은 런타임 metatype 이 Object 라
 *    ValidationPipe 가 스킵됐다. `observedRole` 누락·VarChar(20) 초과·`moment:'abc'` 가 Prisma 500 이었다.
 *    필수 3개는 스키마 NOT NULL · moment 1~5 와 action 2값은 **서비스가 이미 400 으로 강제하던 것**을 옮겨 적은 것이다(새 제약 아님).
 *    직군·방법 어휘는 스키마 주석뿐이라 막지 않는다(길이만). 화면(infection/page.tsx) 키: observedRole·moment·method·action.
 */
export class RecordHandHygieneDto {
  @ApiPropertyOptional({ description: '관찰 부서/병동' }) @IsOptional() @IsString() @MaxLength(50) department?: string;
  @ApiProperty({ description: '피관찰 직군 DOCTOR/NURSE/…' }) @IsString() @MaxLength(20) observedRole!: string;
  @ApiProperty({ minimum: 1, maximum: 5, description: 'WHO 5 Moments' }) @Type(() => Number) @IsInt() @Min(1) @Max(5) moment!: number;
  @ApiProperty({ enum: ['PERFORMED', 'MISSED'] }) @IsIn(['PERFORMED', 'MISSED']) action!: 'PERFORMED' | 'MISSED';
  @ApiPropertyOptional({ description: 'SOAP/SANITIZER/GLOVE_ONLY (스키마 주석)' }) @IsOptional() @IsString() @MaxLength(20) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

/** 🔴 (2026-09-15 U2) 격리 해제 사유 — 종전 인라인 `{reason?}` · 스키마 `discontinue_reason` VarChar(500) 초과가 500 이었다 */
export class ReleaseIsolationDto {
  @ApiPropertyOptional({ description: '해제 사유' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
