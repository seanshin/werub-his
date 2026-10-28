import {
  IsString, IsOptional, IsNotEmpty, IsBoolean, IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 진료기록 템플릿 생성 ──

export class CreateEncounterTemplateDto {
  @ApiProperty({ description: '진료과' })
  @IsString()
  @IsNotEmpty()
  department: string;

  @ApiProperty({ description: '템플릿명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'SOAP 섹션 (JSON)' })
  soapSections: Record<string, unknown>;

  @ApiProperty({ description: '버전' })
  @IsString()
  @IsNotEmpty()
  version: string;
}

// ── 진료기록 템플릿 수정 ──

export class UpdateEncounterTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() soapSections?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() version?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
