import {
  IsString, IsOptional, IsNotEmpty, IsBoolean, IsArray, ArrayMaxSize, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHART_TEMPLATE_ROLES, CHART_TEMPLATE_CATEGORIES } from '../chart-template.service';

// 🔴 E10 — 한글 역할('의사')·카테고리('초진')로 저장되면 진료 화면 목록(getForMe, 영문 enum 조회)에
//    영원히 안 뜨는데 관리자 목록에는 보여 "만들어졌다"고 착각한다. DTO 에서 먼저 막는다(서비스가 최종 게이트).

// ── 차트 템플릿 생성 ──

export class CreateChartTemplateDto {
  @ApiProperty({ description: '템플릿 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: '역할 (DOCTOR, NURSE 등 시스템 역할 코드)', default: 'DOCTOR', enum: CHART_TEMPLATE_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(CHART_TEMPLATE_ROLES, { message: '역할은 시스템 역할 코드여야 합니다(한글 역할명 불가)' })
  role?: string;

  @ApiPropertyOptional({ description: '카테고리 (OUTPATIENT, INPATIENT, SURGERY 등)', default: 'OUTPATIENT', enum: CHART_TEMPLATE_CATEGORIES })
  @IsOptional()
  @IsString()
  @IsIn(CHART_TEMPLATE_CATEGORIES as unknown as string[], { message: '카테고리 코드가 올바르지 않습니다(한글 카테고리 불가)' })
  category?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '레이아웃 (tabs, single-page, accordion)', default: 'tabs' })
  @IsOptional()
  @IsString()
  layout?: string;

  @ApiPropertyOptional({ description: '섹션 구성 (JSON 배열)' })
  @IsOptional()
  @IsArray()
  sections?: object[];

  @ApiPropertyOptional({ description: '기본 템플릿 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: '개인 템플릿 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isPersonal?: boolean;

  @ApiPropertyOptional({ description: '소유자 ID' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ description: '버전', default: '1.0' })
  @IsOptional()
  @IsString()
  version?: string;
}

// ── 차트 템플릿 수정 ──

// ── 프리셋에서 생성 ──

export class CreateFromPresetDto {
  @ApiProperty({ description: '프리셋 키' })
  @IsString()
  @IsNotEmpty()
  presetKey: string;

  @ApiPropertyOptional({ description: '템플릿 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional()
  @IsString()
  department?: string;
}

// ── 기본 템플릿 설정 ──

export class SetDefaultTemplateDto {
  @ApiProperty({ description: '템플릿 ID' })
  @IsString()
  @IsNotEmpty()
  templateId: string;
}

// ── 즐겨찾기 토글 ──

export class ToggleFavoriteDto {
  @ApiProperty({ description: '템플릿 ID' })
  @IsString()
  @IsNotEmpty()
  templateId: string;
}

// ── 개인 템플릿 복제 ──

export class PersonalizeTemplateDto {
  @ApiPropertyOptional({ description: '템플릿 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '섹션 구성 (JSON)' })
  @IsOptional()
  sections?: object[];
}

// ── 차트 템플릿 수정 ──

export class UpdateChartTemplateDto {
  @ApiPropertyOptional({ description: '템플릿 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: '역할 (시스템 역할 코드)', enum: CHART_TEMPLATE_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(CHART_TEMPLATE_ROLES, { message: '역할은 시스템 역할 코드여야 합니다(한글 역할명 불가)' })
  role?: string;

  @ApiPropertyOptional({ description: '카테고리', enum: CHART_TEMPLATE_CATEGORIES })
  @IsOptional()
  @IsString()
  @IsIn(CHART_TEMPLATE_CATEGORIES as unknown as string[], { message: '카테고리 코드가 올바르지 않습니다(한글 카테고리 불가)' })
  category?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '레이아웃' })
  @IsOptional()
  @IsString()
  layout?: string;

  @ApiPropertyOptional({ description: '섹션 구성 (JSON 배열)' })
  @IsOptional()
  @IsArray()
  sections?: object[];

  @ApiPropertyOptional({ description: '기본 템플릿 여부' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: '변경 노트 (버전 히스토리에 기록)' })
  @IsOptional()
  @IsString()
  changeNote?: string;
}

export class SetBoardLayoutDto {
  @ApiPropertyOptional({ description: '큰 화면 보기 패널 키 순서 배열 (null/생략=역할 기본으로 초기화)', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30) // 레지스트리 패널 수 상한 — JsonB 비대 방지(검토 P2)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  panels?: string[] | null;

  @ApiPropertyOptional({ description: '핀 고정 패널 키(항상 상단 배치). 생략=기존 핀 보존, []=전체 해제', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  pinned?: string[] | null;
}
