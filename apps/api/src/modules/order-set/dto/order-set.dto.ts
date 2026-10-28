import {
  IsString, IsOptional, IsBoolean, IsNotEmpty, IsInt, Min, IsArray, ValidateNested, Allow, MinLength, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 약속처방 항목 ──
// ※ 전역 whitelist ValidationPipe — 데코레이터 없는 필드는 strip됨.
//    items를 검증(ValidateNested)하려면 모든 하위 필드를 데코레이트해야 유실 안 됨.
//    (미데코레이트 시 items 자체가 strip → 필수 JsonB 저장 실패로 생성 에러)
export class OrderSetItemDto {
  @IsString() @IsNotEmpty() type!: string; // MEDICATION|LAB|IMAGING|THERAPY|DIET|ACTIVITY|NURSING|ORDER|DOCUMENT
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() codeId?: string; // 해석 확정된 코드 UUID(med/procedure) — 🔴미데코레이트 시 whitelist가 strip해 확정 유실
  @IsOptional() @IsString() resolvedNote?: string; // 해석 근거 표기(데모확정 등)
  @IsOptional() @IsString() medicationCodeId?: string;
  @IsOptional() @IsString() procedureCodeId?: string;
  @IsOptional() @IsString() dosage?: string;
  @IsOptional() @IsString() frequency?: string;
  @Allow() duration?: unknown;  // string(빌더 입력)|number(시드/적용) 혼재 허용
  @Allow() quantity?: unknown;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsString() certType?: string; // DOCUMENT: DIAGNOSIS_CERT|OPINION|ADMISSION_CERT
  @IsOptional() @IsBoolean() required?: boolean; // 필수 항목 — 적용 검토 모달에서 해제 불가
  @IsOptional() @IsBoolean() isDefault?: boolean; // 기본형 — 적용 검토 모달에서 자동 체크
  @IsOptional() @IsBoolean() cdssCheck?: boolean; // CDSS 검증 대상
}

// ── 약속처방 생성 ──

export class CreateOrderSetDto {
  @ApiProperty({ description: '약속처방명' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'CP 코드 (자동생성 가능)' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({ description: '분류 (CP, MEDICATION_SET, LAB_SET 등)' })
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiPropertyOptional({ description: '진단코드' })
  @IsOptional()
  @IsString()
  diagnosisCode?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '적용 시점 (ADMISSION, DISEASE, PRE_OP, POST_OP, DISCHARGE)' })
  @IsOptional()
  @IsString()
  applicableTo?: string;

  @ApiPropertyOptional({ description: '대상 연령군 (ALL, ADULT, PEDIATRIC, GERIATRIC)' })
  @IsOptional()
  @IsString()
  ageGroup?: string;

  @ApiPropertyOptional({ description: '금기 조건 배열' })
  @IsOptional()
  @IsArray()
  contraindications?: unknown[];

  @ApiPropertyOptional({ description: '근거 수준 (A, B, C, D)' })
  @IsOptional()
  @IsString()
  evidenceLevel?: string;

  @ApiPropertyOptional({ description: '가이드라인 참조' })
  @IsOptional()
  @IsString()
  guidelineRef?: string;

  @ApiProperty({ description: '처방 항목 목록', type: [OrderSetItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderSetItemDto)
  items!: OrderSetItemDto[];

  @ApiPropertyOptional({ description: '공유 여부' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}

// ── 약속처방 수정 ──

export class UpdateOrderSetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosisCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() applicableTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ageGroup?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() contraindications?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() evidenceLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guidelineRef?: string;
  @ApiPropertyOptional({ type: [OrderSetItemDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderSetItemDto)
  items?: OrderSetItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isShared?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── 상태 변경 ──

export class ChangeStatusDto {
  @ApiProperty({ description: '변경할 상태 (DRAFT, PENDING_APPROVAL, APPROVED, ACTIVE, DEPRECATED)' })
  @IsString()
  @IsNotEmpty()
  status!: string;
}

// ── 사용 기록 ──

export class RecordUsageDto {
  @ApiProperty({ description: '진료 ID' })
  @IsString()
  @IsNotEmpty()
  encounterId!: string;

  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId!: string;

  @ApiProperty({ description: '적용된 항목 수' })
  @IsInt()
  @Min(0)
  itemsApplied!: number;

  @ApiProperty({ description: '수정된 항목 수' })
  @IsInt()
  @Min(0)
  itemsModified!: number;
}

// ── 즐겨찾기 저장 ──

export class CreateFavoriteOrderDto {
  @ApiProperty({ description: '즐겨찾기명' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: '처방 항목 목록', type: [OrderSetItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderSetItemDto)
  items!: OrderSetItemDto[];
}

/** 승인 기록 근거(2026-10-21 P2) — 위원회 의결 번호·승인 문서 등 · 감사 기록에 남는다(약속처방·치료일정 템플릿 공용) */
export class ApprovalRecordDto {
  @ApiProperty({ description: '승인 근거(위원회 의결 번호·문서 번호 등)' }) @IsString() @MinLength(4) @MaxLength(400)
  basis!: string;
}
