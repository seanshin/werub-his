import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PrescriptionType } from '@prisma/client';

/**
 * 🔴 (2026-09-15 T2) 종전 인라인 `@Body() body: {...}` 는 런타임 metatype 이 Object 라 ValidationPipe 가 통째로 스킵됐다.
 * 필드·제약은 서비스가 실제로 읽는 것과 `CreatePrescriptionDto`(같은 처방 본문) 에 맞춘다 — 위임 승인 bodyHash 는
 * 이후 실제 저장 본문(CreatePrescriptionDto 가 변환한 값)과 같아야 하므로 duration·quantity 변환 규칙을 동일하게 둔다.
 */
export class PrescriberDelegateRequestDto {
  @ApiProperty() @IsUUID() prescriberId!: string;
  @ApiPropertyOptional({ enum: PrescriptionType }) @IsOptional() @IsEnum(PrescriptionType) type?: PrescriptionType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() medicationCodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() procedureCodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() frequency?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) duration?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() route?: string;
}

export class AddDesignatedDoctorDto {
  @ApiProperty() @IsUUID() doctorId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

/** 처방의 지정 규칙 — 서비스가 부분 병합(없는 키는 기존 유지)·allowedRoles 화이트리스트를 그대로 수행한다 */
export class PrescriberRulesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowDelegate?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireDelegateAuth?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) allowedRoles?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireSpecialtyMatch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireAttending?: boolean;
  @ApiPropertyOptional({ description: '진료과 → 가이드라인 문장' }) @IsOptional() @IsObject() departmentGuidelines?: Record<string, string>;
}

/** DUR 무시 — 사유 필수 판정은 서비스가 도메인 코드(DUR_OVERRIDE_REASON_REQUIRED)로 한다(여기서 막으면 코드가 사라진다) */
export class DurOverrideDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

/** 처방 중단 — 사유 비어 있음 판정은 서비스가 도메인 코드(DISCONTINUE_REASON_REQUIRED)로 한다(여기서 막으면 코드가 사라진다) */
export class DiscontinuePrescriptionDto {
  @ApiPropertyOptional({ description: '중단 사유(필수 — 비면 400 DISCONTINUE_REASON_REQUIRED)' }) @IsOptional() @IsString() reason?: string;
}

/** 처방 갱신 — 일수·총량은 의사가 정한다(비면 서비스가 400 RENEW_DAYS_REQUIRED/RENEW_QUANTITY_REQUIRED · 원처방 복사 금지) */
export class RenewPrescriptionDto {
  @ApiPropertyOptional({ description: '갱신 일수(1 이상 정수)' }) @IsOptional() @IsInt() @Min(1) days?: number;
  @ApiPropertyOptional({ description: '총량(1 이상 정수)' }) @IsOptional() @IsInt() @Min(1) quantity?: number;
  @ApiPropertyOptional({ description: '갱신 메모(선택)' }) @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() overrideDur?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() overrideReason?: string;
}
