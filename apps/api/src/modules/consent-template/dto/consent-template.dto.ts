import {
  IsString, IsOptional, IsNotEmpty, IsObject, IsBoolean, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 동의서 템플릿 생성 ──

export class CreateConsentTemplateDto {
  @ApiProperty({ description: '동의서 유형 (수술, 시술, 마취 등)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '템플릿 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '버전 (예: 1.0)' })
  @IsString()
  @IsNotEmpty()
  version: string;

  @ApiPropertyOptional({ description: '언어 코드(patient.supportedLanguages) — 기본 ko' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ description: '동의서 본문 콘텐츠 (JSON)' })
  @IsObject()
  content: Record<string, any>;

  @ApiProperty({ description: '필수 입력 필드 목록 (JSON)' })
  @IsObject()
  requiredFields: Record<string, any>;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '구성 요소 (JSON)' })
  @IsOptional()
  @IsObject()
  components?: Record<string, any>;

  @ApiPropertyOptional({ description: '변수 정의 (JSON)' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;
}

// ── 동의서 템플릿 수정 ──

export class UpdateConsentTemplateDto {
  @ApiPropertyOptional({ description: '동의서 유형' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '템플릿 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '동의서 본문 콘텐츠 (JSON)' })
  @IsOptional()
  @IsObject()
  content?: Record<string, any>;

  @ApiPropertyOptional({ description: '필수 입력 필드 목록 (JSON)' })
  @IsOptional()
  @IsObject()
  requiredFields?: Record<string, any>;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '구성 요소 (JSON)' })
  @IsOptional()
  @IsObject()
  components?: Record<string, any>;

  @ApiPropertyOptional({ description: '변수 정의 (JSON)' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;
}

// ── 동의서 템플릿 가져오기 ──

export class ImportConsentTemplateDto {
  @ApiProperty({ description: '동의서 유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '템플릿 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '버전' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({ description: '동의서 본문 콘텐츠 (JSON)' })
  @IsObject()
  content: Record<string, any>;

  @ApiProperty({ description: '필수 입력 필드 목록 (JSON)' })
  @IsObject()
  requiredFields: Record<string, any>;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '구성 요소 (JSON)' })
  @IsOptional()
  @IsObject()
  components?: Record<string, any>;

  @ApiPropertyOptional({ description: '변수 정의 (JSON)' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @ApiPropertyOptional({ description: '법적 요구사항 검증 결과 (JSON)' })
  @IsOptional()
  @IsObject()
  legalChecks?: Record<string, any>;

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '최신 버전 여부' })
  @IsOptional()
  @IsBoolean()
  isLatest?: boolean;

  @ApiPropertyOptional({ description: '변경 이력' })
  @IsOptional()
  @IsString()
  changeLog?: string;

  @ApiPropertyOptional({ description: '부모 템플릿 ID' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: '마지막 편집자' })
  @IsOptional()
  @IsString()
  lastEditedBy?: string;
}
