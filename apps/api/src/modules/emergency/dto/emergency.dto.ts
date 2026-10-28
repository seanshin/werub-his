import { IsString, IsOptional, IsUUID, IsNumber, IsEnum, IsIn, IsNotEmpty, IsObject, IsDateString, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EMERGENCY_VISIT_STATUS_LABEL } from '@hospital-run/shared';

export enum KtasLevel {
  LEVEL_1 = 'LEVEL_1', // 소생 (즉시)
  LEVEL_2 = 'LEVEL_2', // 긴급 (10분)
  LEVEL_3 = 'LEVEL_3', // 응급 (30분)
  LEVEL_4 = 'LEVEL_4', // 준응급 (60분)
  LEVEL_5 = 'LEVEL_5', // 비응급 (120분)
}

export enum EmergencyDisposition {
  DISCHARGE = 'DISCHARGE', // 귀가
  ADMISSION = 'ADMISSION', // 입원
}

export class CreateTriageDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '주호소 (chief complaint)' })
  @IsString()
  chiefComplaint: string;

  @ApiProperty({ description: 'Triage 단계 (KTAS)' })
  @IsEnum(KtasLevel)
  triageLevel: KtasLevel;

  @ApiPropertyOptional({ description: '임상 메모' })
  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * 실제 응급실 도착 시각(ISO). 미전송이면 접수 시각을 쓴다.
   * 🔴 도착과 분류를 같은 순간으로 기록하면 door-to-triage 가 구조적으로 0분이 되어
   *    "전건 목표 달성"이라는 거짓 안심이 된다 — 아는 값이면 받는다.
   */
  @ApiPropertyOptional({ description: '실제 도착 시각(ISO·미전송 시 접수 시각)' })
  @IsOptional()
  @IsDateString()
  arrivalAt?: string;
}

export class UpdateEmergencyStatusDto {
  @ApiProperty({ description: '응급실 처치 결과' })
  @IsEnum(EmergencyDisposition)
  status: EmergencyDisposition;

  @ApiPropertyOptional({ description: '처치 메모' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class TransferToAdmissionDto {
  @ApiProperty({ description: '병상 ID' })
  @IsUUID()
  bedId: string;

  @ApiProperty({ description: '담당 의사 ID' })
  @IsUUID()
  admittingDoctorId: string;
}

export class RecordVitalSignsDto {
  @ApiPropertyOptional({ description: '수축기 혈압 (mmHg)' })
  @IsOptional()
  @IsNumber()
  systolicBP?: number;

  @ApiPropertyOptional({ description: '이완기 혈압 (mmHg)' })
  @IsOptional()
  @IsNumber()
  diastolicBP?: number;

  @ApiPropertyOptional({ description: '심박수 (bpm)' })
  @IsOptional()
  @IsNumber()
  heartRate?: number;

  @ApiPropertyOptional({ description: '호흡수 (breath/min)' })
  @IsOptional()
  @IsNumber()
  respiratoryRate?: number;

  @ApiPropertyOptional({ description: '산소포화도 (%)' })
  @IsOptional()
  @IsNumber()
  spO2?: number;

  @ApiPropertyOptional({ description: '체온 (°C)' })
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @ApiPropertyOptional({ description: '의식수준' })
  @IsOptional()
  @IsString()
  consciousness?: string;
}

export class EmergencyQueueItemDto {
  id: string;
  patientId: string;
  patientName: string;
  /** 🔴 응급실은 동명이인·신원미상이 실제로 발생한다 — 이름만으로 환자를 특정하면 안 된다 */
  mrn: string;
  chiefComplaint: string;
  triageLevel: KtasLevel;
  arrivalAt: Date;
  waitingMinutes: number;
  /**
   * 🔴 이 필드가 없어서 화면이 **처분 완료 환자를 전부 대기로** 분류했다.
   *    화면은 `v.disposition ?? ''` 로 나누는데 서버가 안 주니 모두 빈 문자열이 됐다
   *    — 미종결 4건인데 "대기 96명"으로 보였다(2026-08-12 실측).
   */
  disposition: string | null;
}

/**
 * 🔴 (2026-09-16 I4) 평균·비율은 **표본이 없으면 `null`(산출 불가)** 이다 — `0` 은 측정된 0 과 같은 모양이라
 *    "방문 0건인 기간"을 "0분·0%"로 말했다. 분모(`*SampleN`·`rateDenominator`)를 함께 내보내
 *    화면이 "몇 건 기준"을 말할 수 있게 한다(QI·executive 가 쓰는 같은 규약).
 */
export class EmergencyStatsDto {
  totalPatients: number;
  byTriageLevel: Record<string, number>;
  byDisposition: Record<string, number>;
  /** 도착→진료시작 평균(분) · 진료 시작된 건이 없으면 null */
  avgWaitingTime: number | null;
  waitingSampleN: number;
  /** 도착→처분 평균(분) · 처분된 건이 없으면 null */
  avgTreatmentTime: number | null;
  treatmentSampleN: number;
  /** 기간 내 방문이 0 이면 null */
  dischargeRate: number | null;
  admissionRate: number | null;
  rateDenominator: number;
  unavailableReason: string | null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * 🔴 인라인 @Body 승격(2026-08-18) — 전역 ValidationPipe 는 **DTO 가 있어야** 돈다.
 *    아래 4경로는 `@Body() body: { … }` / `@Body('status') status: string` 인라인이라
 *    파이프를 통째로 건너뛰었고, 그 결과
 *      · KTAS 재분류: `newLevel` 이 자유문자열로 `emergency_reassessments` 에 **먼저 저장**되고
 *        그 다음 `emergency_visits.triageLevel`(Prisma enum) 갱신이 터진다 →
 *        **"등급을 바꿨다"는 재분류 기록만 남고 실제 등급은 그대로**인 유령 행이 생긴다.
 *      · 처분: `disposition` 도 같은 구조(record=VarChar(20) 먼저, visit=enum 나중).
 *      · 상태 전환: `emergency_visits.status` 는 VarChar(25) 라 오타가 **조용히 저장**되고
 *        ER 보드 필터(8상태)에서 그 환자가 사라진다.
 *    → 값 집합은 **정본에서 가져온다**(상태=shared `EMERGENCY_VISIT_STATUS_LABEL`,
 *      등급/처분=Prisma enum). 화면이 보내는 키를 하나도 빠뜨리지 않는다.
 * ────────────────────────────────────────────────────────────────────────── */

/** 처분 정본 — Prisma `EmergencyDisposition` 7종(위 `EmergencyDisposition` 은 2종만 있는 구형이라 쓰지 않는다) */
export enum EmergencyDispositionFull {
  DISCHARGE = 'DISCHARGE',
  ADMISSION = 'ADMISSION',
  TRANSFER = 'TRANSFER',
  DEATH = 'DEATH',
  LEAVE_AMA = 'LEAVE_AMA',
  OBSERVATION = 'OBSERVATION',
  SURGERY = 'SURGERY',
}

/** ER 방문 상태 정본 — shared 라벨 맵의 키(8상태). 라벨과 값이 갈라지지 않도록 여기서 파생한다. */
export const EMERGENCY_VISIT_STATUSES = Object.keys(EMERGENCY_VISIT_STATUS_LABEL);

export class UpdateVisitStatusDto {
  @ApiProperty({ description: 'ER 방문 상태', enum: EMERGENCY_VISIT_STATUSES })
  @IsIn(EMERGENCY_VISIT_STATUSES, { message: `status 는 ${EMERGENCY_VISIT_STATUSES.join('|')} 중 하나여야 합니다` })
  status: string;
}

export class ReassessEmergencyDto {
  @ApiProperty({ description: '재분류 KTAS 등급', enum: KtasLevel })
  @IsEnum(KtasLevel)
  newLevel: KtasLevel;

  @ApiProperty({ description: '변경 사유(필수 — 등급을 올리고 내린 근거는 법정기록이다)' })
  @IsString()
  @IsNotEmpty({ message: '재분류 사유는 필수입니다' })
  reason: string;

  /** 자유 형태 활력(JsonB). 키를 고정하지 않으므로 @IsObject 만 — 배열·문자열은 거부한다. */
  @ApiPropertyOptional({ description: '재분류 시점 활력징후(JSON)' })
  @IsOptional()
  @IsObject()
  vitals?: Record<string, unknown>;
}

export class MakeDispositionDto {
  @ApiProperty({ description: '처분', enum: EmergencyDispositionFull })
  @IsEnum(EmergencyDispositionFull)
  disposition: EmergencyDispositionFull;

  @ApiPropertyOptional({ description: '퇴원 교육/지시' })
  @IsOptional()
  @IsString()
  dischargeInstructions?: string;

  @ApiPropertyOptional({ description: '외래 추적일(ISO 또는 YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'followUpDate 는 날짜여야 합니다' })
  followUpDate?: string;

  @ApiPropertyOptional({ description: '연계 입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiPropertyOptional({ description: '전원 대상 기관' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  transferTo?: string;

  @ApiPropertyOptional({ description: '전원 사유' })
  @IsOptional()
  @IsString()
  transferReason?: string;

  /**
   * 처분 **변경** 사유 — 이미 처분이 있는 방문에 다른 처분을 기록할 때만 의미가 있다.
   * 서버는 필수로 강제하지 않는다(응급 워크스테이션의 퇴원·전원 즉시 버튼이 사유 입력 UI 없이 최초 결정을
   * 만드는 정상 경로다 — 필수화하면 그 경로가 400 이 된다). 사유는 감사 스냅샷에 함께 보존된다.
   */
  @ApiPropertyOptional({ description: '처분 변경 사유(기존 처분을 바꿀 때)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  revisionReason?: string;
}

export class DischargeFromEmergencyDto {
  @ApiProperty({ description: '퇴원 지시(필수)' })
  @IsString()
  @IsNotEmpty()
  instructions: string;

  @ApiPropertyOptional({ description: '추적 진료과' })
  @IsOptional()
  @IsString()
  followUpDepartment?: string;

  @ApiPropertyOptional({ description: '추적 진료일' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional({ description: '처방 요약' })
  @IsOptional()
  @IsString()
  prescriptions?: string;
}

/**
 * 응급 간호 초기평가 — GCS 는 **정의된 범위 밖 값이 존재하지 않는다**(E1-4·V1-5·M1-6).
 * 범위를 안 막으면 총점이 15 를 넘거나 3 미만인 기록이 원장에 남는다.
 */
export class CreateEmergencyNursingAssessmentDto {
  @ApiProperty({ description: '기도(Airway)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  airway: string;

  @ApiProperty({ description: '호흡(Breathing)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  breathing: string;

  @ApiProperty({ description: '순환(Circulation)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  circulation: string;

  @ApiPropertyOptional({ description: 'GCS 개안반응(1~4)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  gcsEye?: number;

  @ApiPropertyOptional({ description: 'GCS 언어반응(1~5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  gcsVerbal?: number;

  @ApiPropertyOptional({ description: 'GCS 운동반응(1~6)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  gcsMotor?: number;

  @ApiPropertyOptional({ description: '통증 점수(NRS 0~10)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScale?: number;

  @ApiPropertyOptional({ description: '통증 부위' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  painLocation?: string;
}
