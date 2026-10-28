import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 간호과정 NIC·NOC 추가가 인라인 본문이라 `name` 이 없거나 300자를 넘으면 Prisma 500 이었다.
 * 길이는 `NursingIntervention`·`NursingOutcome` 스키마 VarChar 그대로, 점수 0~100 은 같은 모듈 평가 정본(evaluateOutcome)과 같다.
 */
export class AddNursingInterventionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) nicCode?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() detail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) frequency?: string;
}

export class AddNursingOutcomeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) nocCode?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) baselineScore?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) targetScore?: number;
}
