import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STAFF_EXPOSURE_TYPES, STAFF_EXPOSURE_FOLLOW_UP_STATUSES } from '../staff-exposure';

export enum InfectionStatus {
  SUSPECTED = 'SUSPECTED',
  CONFIRMED = 'CONFIRMED',
  RESOLVED = 'RESOLVED',
  DECEASED = 'DECEASED',
}

export enum IsolationType {
  STANDARD = 'STANDARD',
  DROPLET = 'DROPLET',
  AIRBORNE = 'AIRBORNE',
  CONTACT = 'CONTACT',
  STRICT = 'STRICT',
}

export enum RelationshipType {
  FAMILY = 'FAMILY',
  HEALTHCARE_WORKER = 'HEALTHCARE_WORKER',
  PATIENT = 'PATIENT',
  VISITOR = 'VISITOR',
  ROOMMATE = 'ROOMMATE',
  OTHER = 'OTHER',
}

export class CreateInfectionReportDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '감염병명' })
  @IsString()
  diseaseName: string;

  @ApiPropertyOptional({ description: '감염병코드' })
  @IsOptional()
  @IsString()
  diseaseCode?: string;

  @ApiProperty({ description: '감염 확인일' })
  @IsDateString()
  confirmationDate: string;

  @ApiPropertyOptional({ description: '증상 발현일' })
  @IsOptional()
  @IsDateString()
  symptomOnsetDate?: string;

  @ApiProperty({ description: '격리 유형' })
  @IsEnum(IsolationType)
  isolationType: IsolationType;

  @ApiPropertyOptional({ description: '격리 시작일' })
  @IsOptional()
  @IsDateString()
  isolationStartDate?: string;

  @ApiPropertyOptional({ description: '격리 종료일' })
  @IsOptional()
  @IsDateString()
  isolationEndDate?: string;

  @ApiPropertyOptional({ description: '임상 증상' })
  @IsOptional()
  @IsString()
  clinicalSymptoms?: string;

  @ApiPropertyOptional({ description: '감염 경로' })
  @IsOptional()
  @IsString()
  transmissionRoute?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ description: '보고자 ID' })
  @IsOptional()
  @IsUUID()
  reportedBy?: string;
}

export class UpdateInfectionStatusDto {
  @ApiProperty({ description: '상태' })
  @IsEnum(InfectionStatus)
  status: InfectionStatus;

  @ApiPropertyOptional({ description: '격리 유형' })
  @IsOptional()
  @IsEnum(IsolationType)
  isolationType?: IsolationType;

  @ApiPropertyOptional({ description: '격리 종료일' })
  @IsOptional()
  @IsDateString()
  isolationEndDate?: string;

  @ApiPropertyOptional({ description: '해제 사유' })
  @IsOptional()
  @IsString()
  resolutionNotes?: string;

  @ApiPropertyOptional({ description: '업데이트 메모' })
  @IsOptional()
  @IsString()
  updateNotes?: string;
}

export class ContactTracingDto {
  @ApiProperty({ description: '원래 환자 ID' })
  @IsUUID()
  sourcePatientId: string;

  @ApiProperty({ description: '접촉 대상자 ID' })
  @IsUUID()
  contactPersonId: string;

  @ApiProperty({ description: '관계 유형' })
  @IsEnum(RelationshipType)
  relationshipType: RelationshipType;

  @ApiPropertyOptional({ description: '접촉 시작일' })
  @IsOptional()
  @IsDateString()
  contactStartDate?: string;

  @ApiPropertyOptional({ description: '접촉 종료일' })
  @IsOptional()
  @IsDateString()
  contactEndDate?: string;

  @ApiPropertyOptional({ description: '접촉 시간 (분)' })
  @IsOptional()
  @IsNumber()
  contactDurationMinutes?: number;

  @ApiPropertyOptional({ description: '위험 수준' })
  @IsOptional()
  @IsString()
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';

  @ApiPropertyOptional({ description: '보호 장비 착용' })
  @IsOptional()
  @IsBoolean()
  wearingPPE?: boolean;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkContactTracingDto {
  @ApiProperty({ description: '원래 환자 ID' })
  @IsUUID()
  sourcePatientId: string;

  @ApiProperty({ description: '접촉자 ID 배열' })
  @IsArray()
  contactPersonIds: string[];

  @ApiProperty({ description: '관계 유형' })
  @IsEnum(RelationshipType)
  relationshipType: RelationshipType;

  @ApiPropertyOptional({ description: '위험 수준' })
  @IsOptional()
  @IsString()
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class InfectionQueueItemDto {
  id: string;
  patientId: string;
  patientName: string;
  diseaseName: string;
  status: 'CONFIRMED' | 'RESOLVED';
  confirmationDate: Date;
  isolationType: IsolationType;
  contactCount: number;
  isolationEndDate?: Date;
}

export class InfectionStatsDto {
  totalCases: number;
  suspectedCases: number;
  confirmedCases: number;
  resolvedCases: number;
  activeIsolations: number;
  /** 🔴 접촉자 추적 레코드 수 — 종전엔 activeIsolations 의 무고지 별칭이었다(P12) */
  totalContacts: number;
  /** 🔴 접촉자 중 고위험 — 종전엔 전체 감시 레코드의 격리유형을 셌다 */
  highRiskContacts: number;
  contactBasis: string;
  byDisease: Record<string, number>;
  /** 🔴 종전 하드코딩 `{}` — 감지 시점 재원 병동으로 실집계 */
  byWard: Record<string, number>;
  /** 병동을 알 수 없는 건수(외래·응급 감지 등) — 0 으로 접지 않는다 */
  byWardUnknown: number;
  byWardBasis: string;
  byIsolationType: Record<string, number>;
  /** 🔴 종전 하드코딩 `[]` — detectedAt(KST 일자)으로 실집계 */
  dailyTrend: Array<{ date: string; count: number }>;
  dailyTrendBasis: string;
}

export class InfectionAlertDto {
  type: 'CLUSTER' | 'OUTBREAK' | 'HEALTHCARE_WORKER' | 'HIGH_RISK';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  affectedCount: number;
  diseaseNames: string[];
  recommendedActions: string[];
}

// ── 보강(P1~P3) ──

export class CreateHaiCaseDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ enum: ['CLABSI', 'CAUTI', 'VAP', 'SSI', 'CDI', 'OTHER'] }) @IsIn(['CLABSI', 'CAUTI', 'VAP', 'SSI', 'CDI', 'OTHER']) haiType: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) organism?: string;
  @ApiPropertyOptional({ enum: ['CENTRAL_LINE', 'FOLEY', 'VENTILATOR', 'SURGICAL'] }) @IsOptional() @IsIn(['CENTRAL_LINE', 'FOLEY', 'VENTILATOR', 'SURGICAL']) deviceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() deviceInsertedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) deviceDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) site?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() onsetAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) ward?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) criteriaMet?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) notes?: string;
}

export class CreateMdroDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty() @IsString() @Length(1, 200) organism: string;
  @ApiProperty({ enum: ['MRSA', 'VRE', 'CRE', 'CRAB', 'CPE', 'MRPA', 'CDIFF', 'OTHER'] }) @IsIn(['MRSA', 'VRE', 'CRE', 'CRAB', 'CPE', 'MRPA', 'CDIFF', 'OTHER']) mdroType: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) mechanism?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) specimen?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) ward?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() detectedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) isolationType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) notes?: string;
}

/**
 * HAI 종결 + KONIS 보고 표시.
 * 🔴 `reportedToKonis:true` 만으로는 '보고완료'가 되지 않는다 — KONIS 전송 연동이 없기 때문에,
 * 사람이 KONIS 웹에 수기 보고하고 받은 근거번호(`konisManualRef`)를 함께 보낼 때만 기록된다.
 */
export class ResolveHaiCaseDto {
  @ApiPropertyOptional({ description: 'KONIS 보고 요청(연동 미구축 시 미전송으로 기록됨)' })
  @IsOptional() @IsBoolean() reportedToKonis?: boolean;

  @ApiPropertyOptional({ description: 'KONIS 수기 보고 근거번호 — 있으면 보고완료로 기록' })
  @IsOptional() @IsString() @Length(1, 50) konisManualRef?: string;
}

export class CreateNotifiableDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty() @IsString() @Length(1, 100) diseaseName: string;
  @ApiPropertyOptional({ enum: ['1', '2', '3', '4'] }) @IsOptional() @IsIn(['1', '2', '3', '4']) diseaseGrade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20) kcdcCode?: string;
  @ApiPropertyOptional({ enum: ['SUSPECT', 'CONFIRMED', 'CARRIER'] }) @IsOptional() @IsIn(['SUSPECT', 'CONFIRMED', 'CARRIER']) diagnosisType?: string;
}



/** 격리 프로토콜 개정(P0-a④·감염관리위) — 인라인 @Body 금지 규약 */
export class UpsertIsolationProtocolDto {
  @IsInt() @Min(0)
  standardDurationDays!: number;

  @IsArray() @IsString({ each: true })
  requiredPPE!: string[];

  @IsArray() @IsString({ each: true })
  environmentalMeasures!: string[];

  @IsString() @MaxLength(100)
  visitationPolicy!: string;

  @IsBoolean()
  staffEducationRequired!: boolean;

  @IsOptional() @IsString() @MaxLength(40)
  source?: string; // 위원회 의결번호(GOV-…) 자리

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

/**
 * 직원 혈액·체액 노출 사고 접수 — 🔴 인라인 `@Body() Record<string, unknown>` 은
 * ValidationPipe 를 스킵한다(전수검토 축 실측). 법정기록이므로 DTO 로 받는다.
 *
 * 🔴 `sourceHbv/Hcv/Hiv` 는 **보내지 않으면 null(미상)** 이다. 모르면 보내지 마라 —
 *    `false` 를 보내면 '음성'으로 원장에 박힌다.
 */
export class RecordStaffExposureDto {
  @ApiPropertyOptional({ description: '피노출 직원(Staff.id) — 생략 시 로그인 사용자의 직원 원장 레코드' })
  @IsOptional() @IsUUID() staffId?: string;

  @ApiProperty({ enum: STAFF_EXPOSURE_TYPES })
  @IsIn(STAFF_EXPOSURE_TYPES as unknown as string[]) exposureType: string;

  @ApiPropertyOptional({ description: '발생 시각(ISO) — 생략 시 접수 시각' })
  @IsOptional() @IsDateString() occurredAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) bodyPart?: string;
  @ApiPropertyOptional({ description: '원인 기구(예: 18G 주사바늘)' }) @IsOptional() @IsString() @MaxLength(60) deviceType?: string;
  @ApiPropertyOptional({ description: '발생 장소(병동·수술실 등)' }) @IsOptional() @IsString() @MaxLength(60) place?: string;
  @ApiPropertyOptional({ description: '원환자 ID — 무명 노출이면 생략' }) @IsOptional() @IsUUID() sourcePatientId?: string;

  @ApiPropertyOptional({ description: '원환자 HBsAg — 모르면 보내지 말 것(null=미상)' })
  @IsOptional() @IsBoolean() sourceHbv?: boolean;
  @ApiPropertyOptional({ description: '원환자 anti-HCV — 모르면 보내지 말 것(null=미상)' })
  @IsOptional() @IsBoolean() sourceHcv?: boolean;
  @ApiPropertyOptional({ description: '원환자 HIV — 모르면 보내지 말 것(null=미상)' })
  @IsOptional() @IsBoolean() sourceHiv?: boolean;

  @ApiPropertyOptional({ description: '착용 PPE' }) @IsOptional() @IsString() @MaxLength(100) ppeUsed?: string;
  @ApiPropertyOptional({ description: '즉시 조치(세척·압출 등)' }) @IsOptional() @IsString() @MaxLength(2000) immediateAction?: string;
  @ApiPropertyOptional({ description: '예방조치(PEP·백신 등)' }) @IsOptional() @IsString() @MaxLength(2000) prophylaxis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) followUpNotes?: string;
}

/** 노출 사고 추적관찰 갱신 — 종결(CLOSED)일 때만 closedAt 이 박힌다. */
export class UpdateStaffExposureFollowUpDto {
  @ApiProperty({ enum: STAFF_EXPOSURE_FOLLOW_UP_STATUSES })
  @IsIn(STAFF_EXPOSURE_FOLLOW_UP_STATUSES as unknown as string[]) followUpStatus: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) followUpNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) prophylaxis?: string;

  /** 🔴 뒤늦게 원환자 검사 결과가 나온 경우에만 보낸다. 보내지 않으면 기존 값(미상 포함)을 유지한다. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sourceHbv?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sourceHcv?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sourceHiv?: boolean;
}
