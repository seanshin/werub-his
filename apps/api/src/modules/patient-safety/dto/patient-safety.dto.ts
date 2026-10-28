import {
  IsString, IsNumber, IsOptional, IsUUID, IsNotEmpty,
  IsDateString, IsObject, IsBoolean, IsArray, Min, Max, IsIn, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INCIDENT_STATUSES } from '@hospital-run/shared';

// ── 안전 사고 보고 ──

export class ReportIncidentDto {
  @ApiPropertyOptional({ description: '환자 ID' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiProperty({ description: '사고 유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '심각도' })
  @IsString()
  @IsNotEmpty()
  severity: string;

  @ApiProperty({ description: '사고 설명' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ description: '발생 장소' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ description: '발생 일시' })
  @IsDateString()
  occurredAt: string;

  // ── QI 흐름(2026-10-08) — 병동별 사고율·위해 정도·익명 보고
  @ApiPropertyOptional({ description: '발생 병동 id(병동별 사고율 분자)' })
  @IsOptional() @IsUUID()
  wardId?: string;

  @ApiPropertyOptional({ description: '위해 정도 — 설정 safety.harmLevelScale 척도의 값만(미설정이면 받지 않는다)' })
  @IsOptional() @IsString() @MaxLength(20)
  harmLevel?: string;

  @ApiPropertyOptional({ description: '익명 보고 — 설정 safety.incident.anonymous 가 켜졌을 때만' })
  @IsOptional() @IsBoolean()
  anonymous?: boolean;
}

// ── 낙상 위험 평가 ──

export class AssessFallRiskDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '낙상 위험 점수 (Morse 0–125)' })
  @IsNumber()
  @Min(0)
  @Max(125)
  score: number;

  @ApiPropertyOptional({ description: '위험 등급 — 서버가 점수로 재산정(정본)' })
  @IsOptional()
  @IsString()
  riskLevel?: string;

  @ApiProperty({ description: '위험 요인 (JSON)' })
  @IsObject()
  factors: Record<string, any>;

  @ApiPropertyOptional({ description: '예방 중재 (JSON)' })
  @IsOptional()
  @IsObject()
  interventions?: Record<string, any>;
}

// ── NEWS2 조기경보 계산 ──

export class EwsCalculateDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '호흡수 (/min)' })
  @IsNumber() @Min(0) @Max(80)
  respiratoryRate: number;

  @ApiProperty({ description: 'SpO2 (%)' })
  @IsNumber() @Min(0) @Max(100)
  spO2: number;

  // 보충산소는 +2점을 좌우 — 누락 시 undefined→0점(허위-저위험 과소분류) 방지로 필수 지정.
  @ApiProperty({ description: '보충산소 투여 여부' })
  @IsBoolean()
  supplementalO2: boolean;

  @ApiPropertyOptional({ description: 'SpO2 척도 (1 일반 / 2 COPD)' })
  @IsOptional()
  @IsNumber() @Min(1) @Max(2)
  spO2Scale?: number;

  @ApiProperty({ description: '수축기 혈압 (mmHg)' })
  @IsNumber() @Min(0) @Max(300)
  systolicBp: number;

  @ApiProperty({ description: '심박수 (/min)' })
  @IsNumber() @Min(0) @Max(300)
  heartRate: number;

  @ApiProperty({ description: '의식 수준 (ACVPU)' })
  @IsString()
  @IsNotEmpty()
  consciousness: string;

  @ApiProperty({ description: '체온 (℃)' })
  @IsNumber() @Min(25) @Max(45)
  temperature: number;
}

// ── 사고 상태 변경 ──

export class UpdateIncidentStatusDto {
  // 🔴 2026-10-08 — 종전 @IsString 이라 어떤 문자열도 저장됐다. 어휘는 shared INCIDENT_STATUSES 하나.
  @ApiProperty({ description: '상태', enum: INCIDENT_STATUSES })
  @IsIn([...INCIDENT_STATUSES])
  status: string;

  @ApiPropertyOptional({ description: '조치 내용' })
  @IsOptional()
  @IsString()
  actionTaken?: string;
}

// ── 신체보호대 (Restraint) ──

export class CreateRestraintDto {
  @ApiPropertyOptional({ description: '환자 ID' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: '환자번호(MRN)' })
  @IsOptional()
  @IsString()
  mrn?: string;

  @ApiProperty({ description: '보호대 유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '적용 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: '적용 부위', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bodyParts?: string[];

  @ApiPropertyOptional({ description: '재평가 예정 일시(ISO)' })
  @IsOptional()
  @IsDateString()
  plannedUntil?: string;

  @ApiPropertyOptional({ description: '보호자 동의 획득 여부' })
  @IsOptional()
  @IsBoolean()
  consentObtained?: boolean;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;
}

export class RestraintMonitoringDto {
  @ApiPropertyOptional({ description: '순환' })
  @IsOptional()
  @IsString()
  circulation?: string;

  @ApiPropertyOptional({ description: '피부 상태' })
  @IsOptional()
  @IsString()
  skinIntegrity?: string;

  @ApiPropertyOptional({ description: 'ROM 수행' })
  @IsOptional()
  @IsBoolean()
  rangeOfMotion?: boolean;

  @ApiPropertyOptional({ description: '체위 변경' })
  @IsOptional()
  @IsBoolean()
  repositioned?: boolean;

  @ApiPropertyOptional({ description: '행동 관찰' })
  @IsOptional()
  @IsString()
  behavior?: string;

  @ApiPropertyOptional({ description: '지속 필요 여부' })
  @IsOptional()
  @IsBoolean()
  continued?: boolean;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RenewRestraintDto {
  @ApiProperty({ description: '재평가 예정 일시(ISO)' })
  @IsOptional()
  @IsDateString()
  plannedUntil?: string;

  @ApiPropertyOptional({ description: '갱신 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

/** KOPS 직접 보고 기록(2026-10-09) */
export class KopsManualReportDto {
  @ApiProperty({ description: 'KOPS 접수번호(사람이 KOPS 웹에서 받은 번호)' }) @IsString() @MaxLength(60)
  ref!: string;

  @ApiProperty({ description: 'KOPS 에 보고한 시각 ISO 8601' }) @IsString()
  reportedAt!: string;
}
