import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsNumber, IsObject, IsBoolean, IsDateString, IsInt, Min, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 재활 평가 생성 ──

export class CreateRehabAssessmentDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiProperty({ description: '평가 유형' })
  @IsString()
  @IsNotEmpty()
  assessmentType: string;

  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiPropertyOptional({ description: '발병일' })
  @IsOptional()
  @IsString()
  onsetDate?: string;

  @ApiPropertyOptional({ description: 'Barthel Index' })
  @IsOptional()
  @IsNumber()
  barthel?: number;

  @ApiPropertyOptional({ description: 'FIM 점수' })
  @IsOptional()
  @IsNumber()
  fim?: number;

  @ApiPropertyOptional({ description: 'MMT (도수근력검사)' })
  @IsOptional()
  @IsObject()
  mmt?: unknown;

  @ApiPropertyOptional({ description: 'ROM (관절가동범위)' })
  @IsOptional()
  @IsObject()
  rom?: unknown;

  @ApiPropertyOptional({ description: 'Berg Balance Scale' })
  @IsOptional()
  @IsNumber()
  berg?: number;

  @ApiPropertyOptional({ description: 'MMSE 점수' })
  @IsOptional()
  @IsNumber()
  mmse?: number;

  @ApiPropertyOptional({ description: 'VAS 통증 척도' })
  @IsOptional()
  @IsNumber()
  vas?: number;

  @ApiPropertyOptional({ description: '보행 상태' })
  @IsOptional()
  @IsString()
  gait?: string;

  @ApiPropertyOptional({ description: '연하 상태' })
  @IsOptional()
  @IsString()
  swallow?: string;

  @ApiPropertyOptional({ description: '재활 목표' })
  @IsOptional()
  @IsObject()
  goals?: unknown;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 치료 계획 생성 ──

export class CreateRehabPlanDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiProperty({ description: '시작일' })
  @IsString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({ description: '치료 빈도' })
  @IsString()
  @IsNotEmpty()
  frequency: string;

  @ApiProperty({ description: '치료 종류' })
  @IsObject()
  therapies: unknown;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 계획 수정 ──

export class UpdateRehabPlanDto {
  @ApiPropertyOptional({ description: '상태' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: '치료 빈도' })
  @IsOptional()
  @IsString()
  frequency?: string;
}

// ── 세션 예약 ──

export class CreateRehabSessionDto {
  @ApiProperty({ description: '계획 ID' })
  @IsUUID()
  planId: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '치료 유형' })
  @IsString()
  @IsNotEmpty()
  therapyType: string;

  @ApiProperty({ description: '치료사 ID' })
  @IsUUID()
  therapistId: string;

  @ApiProperty({ description: '예약 일시' })
  @IsString()
  @IsNotEmpty()
  scheduledAt: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 세션 완료 ──

export class CompleteRehabSessionDto {
  @ApiPropertyOptional({ description: '활동 내역' })
  @IsOptional()
  @IsObject()
  activities?: unknown;

  @ApiPropertyOptional({ description: '활력징후' })
  @IsOptional()
  @IsObject()
  vitals?: unknown;

  @ApiPropertyOptional({ description: '경과' })
  @IsOptional()
  @IsString()
  progress?: string;

  @ApiPropertyOptional({ description: '치료 시간 (분)' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 세션 자동 생성 · 세션 시작(안전게이트) — 2026-09-15 B9 인라인 @Body 승격 ──

/** 계획 기반 세션 일괄 생성 — 🔴 종전 인라인 타입은 검증되지 않아 `weeks` 가 문자열·0·음수여도 반복문이 돌았다 */
export class GenerateRehabSessionsDto {
  @IsUUID() planId: string;
  @IsDateString() startDate: string;
  @IsInt() @Min(1) weeks: number;
  /** 🔴 (2026-09-15 P3) 필수 — 세션 컬럼이 NOT NULL 이라 미지정은 저장될 수 없다(종전 선택 필드 → 500) */
  @IsUUID() therapistId: string;
}

/**
 * 세션 시작 — 안전게이트 강제 시행.
 * 🔴 종전 `overrideGate: "false"`(문자열)는 **참**으로 읽혀 BLOCK 모드 보류(낙상 Berg·활력 hold)를 우회했다.
 *    진짜 불리언만 받는다. 사유를 필수로 강제할지는 게이트 정책(사람 결정)이라 여기서 바꾸지 않는다.
 */
export class StartRehabSessionDto {
  @IsOptional() @IsBoolean() overrideGate?: boolean;
  @IsOptional() @IsString() @MaxLength(500) overrideReason?: string;
}
