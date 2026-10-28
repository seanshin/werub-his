import { IsString, IsNumber, IsOptional, IsUUID, IsIn, Min, Max, IsInt, IsNotEmpty, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePsychiatryExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() appearance?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() behavior?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() speech?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mood?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() affect?: string;
  @ApiPropertyOptional() @IsOptional() thoughtContent?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() thoughtProcess?: string;
  @ApiPropertyOptional() @IsOptional() perception?: unknown;
  @ApiPropertyOptional() @IsOptional() cognition?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() insight?: string;
  @ApiPropertyOptional({ description: 'PHQ-9 총점 0–27' }) @IsOptional() @IsInt() @Min(0) @Max(27) phq9?: number;
  @ApiPropertyOptional({ description: 'PHQ-9 문항9(자살 사고) 0–3 — 양성(≥1) 시 자살위험 에스컬레이션' }) @IsOptional() @IsInt() @Min(0) @Max(3) phq9Item9?: number;
  @ApiPropertyOptional({ description: 'GAD-7 총점 0–21' }) @IsOptional() @IsInt() @Min(0) @Max(21) gad7?: number;
  @ApiPropertyOptional({ description: 'MMSE 0–30' }) @IsOptional() @IsInt() @Min(0) @Max(30) mmse?: number;
  @ApiPropertyOptional({ description: 'AUDIT 0–40' }) @IsOptional() @IsInt() @Min(0) @Max(40) audit?: number;
  // cssrs·safetyPlan은 스키마상 JsonB(구조화 도구/안전계획). 과거 @IsNumber/@IsBoolean이라
  // 구조화 값이 전역 ValidationPipe에서 거부(400)/불리언 강제되어 실제 내용이 저장 불가였음.
  @ApiPropertyOptional({ description: 'C-SSRS (구조화 JSON)' }) @IsOptional() cssrs?: unknown;
  @ApiPropertyOptional() @IsOptional() customScales?: unknown;
  @ApiPropertyOptional({ description: '자살위험 등급' }) @IsOptional() @IsIn(['LOW', 'MODERATE', 'HIGH']) suicideRisk?: string;
  @ApiPropertyOptional({ description: '안전계획 (구조화 JSON)' }) @IsOptional() safetyPlan?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
}

// ── 비자의입원(정신건강복지법) ──
import { IsEnum } from 'class-validator';
import { AdmissionLegalType } from '@prisma/client';

export class CreatePsychAdmissionDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '연결 입원(Admission) ID' })
  @IsOptional() @IsUUID()
  admissionId?: string;

  @ApiProperty({ enum: AdmissionLegalType, description: '입원유형(자의/동의/보호/행정/응급)' })
  @IsEnum(AdmissionLegalType)
  legalType: AdmissionLegalType;

  @ApiPropertyOptional({ description: '진단명' })
  @IsOptional() @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: '진단 전문의 ID' })
  @IsOptional() @IsUUID()
  psychiatrist1Id?: string;

  @ApiPropertyOptional({ description: '계속입원 다른기관 전문의 ID' })
  @IsOptional() @IsUUID()
  psychiatrist2Id?: string;

  @ApiPropertyOptional({ description: '보호의무자1 성명' })
  @IsOptional() @IsString()
  guardian1Name?: string;

  @ApiPropertyOptional({ description: '보호의무자1 관계' })
  @IsOptional() @IsString()
  guardian1Relation?: string;

  @ApiPropertyOptional({ description: '보호의무자2 성명' })
  @IsOptional() @IsString()
  guardian2Name?: string;

  @ApiPropertyOptional({ description: '보호의무자2 관계' })
  @IsOptional() @IsString()
  guardian2Relation?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional() @IsString()
  notes?: string;
}

export class SuitabilityReviewDto {
  @ApiProperty({ description: '적합성심사 결과', enum: ['적합', '부적합', '퇴원명령'] })
  @IsIn(['적합', '부적합', '퇴원명령'])
  result: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

/**
 * 계속입원심사 결과(2026-10-07) — 종전 EP 는 바디 없이 눌리기만 하면 법정 입원기간을 3개월 연장했다
 * (결과·심사 근거 없이 · 응급입원 72시간도 3개월로). 결과를 고르게 하고, 결과대로만 반영한다.
 */
export class ContinuationReviewDto {
  @ApiProperty({ description: '계속입원심사 결과', enum: ['계속입원', '퇴원'] })
  @IsIn(['계속입원', '퇴원'])
  result: string;

  @ApiPropertyOptional({ description: '계속입원 진단 전문의(다른 전문의) ID' })
  @IsOptional() @IsUUID()
  psychiatrist2Id?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

export class ConvertPsychTypeDto {
  @ApiProperty({ enum: AdmissionLegalType, description: '전환할 입원유형' })
  @IsEnum(AdmissionLegalType)
  legalType: AdmissionLegalType;

  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

export class DischargePsychAdmissionDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

// ── §75 격리·강박 ──

export class CreateSeclusionDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '정신과 입원 ID(PsychiatricAdmission)' })
  @IsOptional() @IsUUID()
  admissionId?: string;

  @ApiProperty({ enum: ['SECLUSION', 'RESTRAINT'], description: 'SECLUSION=격리(최대 12h)·RESTRAINT=강박(최대 4h)' })
  @IsIn(['SECLUSION', 'RESTRAINT'])
  type: string;

  @ApiProperty({ description: '법정 사유 — 자·타해 위험이 뚜렷하고 다른 방법으로 위험 회피가 어려운 경우' })
  @IsString() @IsNotEmpty()
  reason: string;

  @ApiProperty({ enum: ['SELF_HARM', 'HARM_OTHERS', 'BOTH'] })
  @IsIn(['SELF_HARM', 'HARM_OTHERS', 'BOTH'])
  riskType: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

export class SeclusionMonitoringDto {
  @ApiPropertyOptional({ description: '관찰 소견' })
  @IsOptional() @IsString()
  observation?: string;

  @ApiPropertyOptional({ description: '활력징후 {bp, hr, ...}' })
  @IsOptional()
  @IsObject()
  vitalSigns?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'false=지속 불필요 → 자동 해제', default: true })
  @IsOptional() @IsBoolean()
  continued?: boolean;
}

export class ExtendSeclusionDto {
  @ApiProperty({ description: '연장 사유(전문의 대면진찰 소견)' })
  @IsString() @IsNotEmpty()
  reason: string;
}

export class ReleaseSeclusionDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

// ── ECT ──

export class CreateEctDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '서명된 동의서 ID — 게이트 BLOCK(기본)이면 필수' })
  @IsOptional() @IsUUID()
  consentFormId?: string;

  @ApiPropertyOptional({ description: '시행 예정일시(ISO)' })
  @IsOptional() @IsString()
  scheduledAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  anesthesiaNote?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

export class CompleteEctDto {
  @ApiPropertyOptional({ description: '발작 지속시간(초)' })
  @IsOptional() @IsNumber()
  seizureDurationSec?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  complications?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  notes?: string;
}

export class CancelEctDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  reason?: string;
}
