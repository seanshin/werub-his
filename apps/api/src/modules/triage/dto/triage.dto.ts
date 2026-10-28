import {
  IsString, IsNumber, IsOptional, IsBoolean, IsUUID,
  IsNotEmpty, Min, Max, MaxLength, IsArray, ValidateNested, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 증상 ──

export class CreateSymptomDto {
  @ApiProperty({ description: '증상명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '분류' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '응급 여부' })
  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;

  @ApiPropertyOptional({ description: '응급 메시지' })
  @IsOptional()
  @IsString()
  emergencyMsg?: string;
}

export class UpdateSymptomDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isEmergency?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyMsg?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── 규칙 ──

export class CreateRuleDto {
  @ApiProperty({ description: '증상 ID' })
  @IsUUID()
  symptomId: string;

  @ApiProperty({ description: '진료과명' })
  @IsString()
  @IsNotEmpty()
  departmentName: string;

  @ApiPropertyOptional({ description: '우선순위' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  priority?: number;

  @ApiPropertyOptional({ description: '신뢰도 (0~100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  confidence?: number;

  @ApiPropertyOptional({ description: '사유' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: '조건' })
  @IsOptional()
  @IsString()
  condition?: string;
}

export class UpdateRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() departmentName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) confidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() condition?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── 별칭 ──

export class CreateAliasDto {
  @ApiProperty({ description: '증상 ID' })
  @IsUUID()
  symptomId: string;

  @ApiProperty({ description: '별칭' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50) // TriageAlias.alias VarChar(50) — 종전 Prisma 500(일괄 경로는 '중복'으로 조용히 건너뜀)
  alias: string;
}

// ── 별칭 일괄 (2026-09-15 B5) — 종전 `@Body('items')` 원시 추출이 원소를 그대로 `triageAlias.create({ data: item })` 로 보냈다 ──

export class BulkCreateAliasesDto {
  @ApiProperty({ type: [CreateAliasDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAliasDto)
  items: CreateAliasDto[];
}

// ── 평가 (2026-09-15 B5) ──

export class TriagePatientInfoDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() age?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() sex?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() duration?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() severity?: string;
}

export class EvaluateTriageDto {
  @ApiProperty({ description: '증상 서술' }) @IsString() text: string;
  @ApiPropertyOptional({ type: TriagePatientInfoDto })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => TriagePatientInfoDto)
  patientInfo?: TriagePatientInfoDto;
}
