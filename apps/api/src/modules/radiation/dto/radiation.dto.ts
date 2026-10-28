import {
  IsString, IsOptional, IsNotEmpty, IsNumber, IsBoolean, IsObject, IsPositive, Min, Max, IsIn, IsISO8601, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 방사선 치료 계획 생성 ──

export class CreateRadiationPlanDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiPropertyOptional({ description: '진단 코드' })
  @IsOptional()
  @IsString()
  diagnosisCode?: string;

  @ApiProperty({ description: '치료 의도 (curative, palliative 등)' })
  @IsString()
  @IsNotEmpty()
  intent: string;

  @ApiProperty({ description: '치료 기법 (IMRT, VMAT, 3D-CRT 등)' })
  @IsString()
  @IsNotEmpty()
  technique: string;

  @ApiProperty({ description: '조사 부위' })
  @IsString()
  @IsNotEmpty()
  site: string;

  @ApiProperty({ description: '총 선량 (Gy)' })
  @IsNumber() @IsPositive() @Max(120)
  totalDose: number;

  @ApiProperty({ description: '분할 선량 (Gy)' })
  @IsNumber() @IsPositive() @Max(30)
  fractionDose: number;

  @ApiProperty({ description: '총 분할 횟수' })
  @IsNumber() @Min(1) @Max(60)
  totalFractions: number;

  @ApiPropertyOptional({ description: '에너지' })
  @IsOptional()
  @IsString()
  energy?: string;

  @ApiPropertyOptional({ description: '치료기' })
  @IsOptional()
  @IsString()
  machine?: string;

  @ApiPropertyOptional({ description: '시뮬레이션 일자' })
  @IsOptional()
  @IsString()
  simulationDate?: string;

  @ApiPropertyOptional({ description: '치료 시작일' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 상태 변경 ──

export class UpdatePlanStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}

// ── 치료 완료 기록 ──

export class DeliverFractionDto {
  @ApiProperty({ description: '전달 선량 (Gy)' })
  @IsNumber() @IsPositive() @Max(30)
  deliveredDose: number;

  @ApiPropertyOptional({ description: '셋업 검증 여부' })
  @IsOptional()
  @IsBoolean()
  setupVerified?: boolean;

  @ApiPropertyOptional({ description: 'CBCT 촬영 여부' })
  @IsOptional()
  @IsBoolean()
  coneBeamCT?: boolean;

  @ApiPropertyOptional({ description: '치료사 ID' })
  @IsOptional()
  @IsString()
  therapistId?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 치료 취소 ──

export class CancelFractionDto {
  @ApiPropertyOptional({ description: '취소 사유' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── '조사 중' 고착 분할 정리(2026-10-10) ──
// 조사 중(DELIVERING)은 서버가 한 트랜잭션 안에서만 거치는 상태다 — 남아 있다면 조사 기록이 끊긴 것이다.
// 기존 조사 기록·취소는 예정(SCHEDULED)만 받아 이 분할은 어떤 경로로도 닫히지 않았다(계획 완료도 막힌다).
export class ResolveStuckFractionDto {
  @ApiProperty({ enum: ['DELIVERED', 'NOT_DELIVERED'], description: '실제로 조사됐는가(치료기 기록 확인) — 조사됨이면 선량·시각 필수' })
  @IsIn(['DELIVERED', 'NOT_DELIVERED'])
  outcome: 'DELIVERED' | 'NOT_DELIVERED';

  @ApiProperty({ description: '정리 사유·근거(치료기 기록 등) — 필수' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: '치료기 기록의 조사선량(Gy) — outcome DELIVERED 일 때 필수' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  deliveredDose?: number;

  @ApiPropertyOptional({ description: '치료기 기록의 조사 시각 — outcome DELIVERED 일 때 필수(지금 시각으로 채우지 않는다)' })
  @IsOptional()
  @IsISO8601()
  deliveredAt?: string;
}

// ── 부작용 기록 ──

export class AddToxicityDto {
  @ApiProperty({ description: '치료 주차' })
  @IsNumber()
  week: number;

  @ApiPropertyOptional({ description: '피부 부작용 등급 (0-5)' })
  @IsOptional()
  @IsNumber()
  skinGrade?: number;

  @ApiPropertyOptional({ description: '점막염 등급' })
  @IsOptional()
  @IsNumber()
  mucositisGrade?: number;

  @ApiPropertyOptional({ description: '피로 등급' })
  @IsOptional()
  @IsNumber()
  fatigueGrade?: number;

  @ApiPropertyOptional({ description: '오심 등급' })
  @IsOptional()
  @IsNumber()
  nauseaGrade?: number;

  @ApiPropertyOptional({ description: '통증 등급' })
  @IsOptional()
  @IsNumber()
  painGrade?: number;

  @ApiPropertyOptional({ description: '기타 부작용' })
  @IsOptional()
  @IsObject()
  otherToxicity?: unknown;

  @ApiPropertyOptional({ description: '체중 (kg)' })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ description: 'ECOG 점수' })
  @IsOptional()
  @IsNumber()
  ecog?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}
