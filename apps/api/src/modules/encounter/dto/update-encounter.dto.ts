import { IsOptional, IsString, IsArray, IsIn, ValidateNested, MaxLength, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

class DiagnosisDto {
  @IsUUID() diagnosisCodeId: string;
  @IsOptional() @IsIn(['PRIMARY', 'SECONDARY', 'DIFFERENTIAL']) type?: string;
  @IsOptional() @IsIn(['CONFIRMED', 'PROVISIONAL', 'RULE_OUT', 'EXCLUDED']) certainty?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateEncounterDto {
  /** 정정 사유(2026-10-03 · 선택) — 서명본을 정정(SIGNED→AMENDED)하는 순간에만 보존본에 남는다 · 정정 항목이 아니다 */
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) amendmentReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subjective?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() objective?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;

  /**
   * 구조화 문진(2026-10-03) — 🔴 진료 작성 화면 '구조화 저장'이 이 일곱 칸을 보냈는데 DTO 에 없어 전역 whitelist 가 **조용히 지웠다**.
   *    서버는 아무것도 쓰지 않고 200 · 화면은 "저장되었습니다"(운영 778건 중 현병력·계통문진 저장 0건 — 개통 이래).
   */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) chiefComplaint?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) historyPresentIllness?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) pastMedicalHistory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) familyHistory?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() socialHistory?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() reviewOfSystems?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() physicalExamination?: Record<string, unknown>;

  // DUR 임부금기 라인레벨(#3) — 진료 시점 임신상태
  @ApiPropertyOptional({ enum: ['NONE', 'PREGNANT', 'LACTATING', 'UNKNOWN'] })
  @IsOptional() @IsString() @IsIn(['NONE', 'PREGNANT', 'LACTATING', 'UNKNOWN'])
  pregnancyStatus?: string;

  @ApiPropertyOptional({ type: [DiagnosisDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagnosisDto)
  diagnoses?: DiagnosisDto[];
}
