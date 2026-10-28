import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsObject, IsNumber, IsIn, IsArray, ValidateNested, IsDateString, IsInt, Min, Max, MaxLength, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HANDOFF_ILLNESS, HANDOFF_ACTION_STATUS, HANDOFF_TYPES, INTERIM_PAYMENT_METHODS } from '@hospital-run/shared';

// ── 입원 처리 ──

export class AdmitPatientDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '병상 ID' })
  @IsUUID()
  bedId: string;

  @ApiPropertyOptional({ description: '담당의 ID' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ description: '입원 사유' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: '식이 유형' })
  @IsOptional()
  @IsString()
  dietType?: string;
}

// ── 퇴원 ──

export class DischargePatientDto {
  @ApiProperty({ description: '퇴원 요약' })
  @IsString()
  @IsNotEmpty()
  summary: string;

  @ApiPropertyOptional({ description: '퇴원 처리 구분: HOME(일반퇴원)|TRANSFER(전원)|DECEASED(사망)' })
  @IsOptional()
  @IsIn(['HOME', 'TRANSFER', 'DECEASED'])
  disposition?: string;
}

// ── 병상 이동 ──

export class TransferPatientDto {
  @ApiProperty({ description: '이동할 병상 ID' })
  @IsUUID()
  newBedId: string;

  @ApiPropertyOptional({ description: '이동 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── 경과기록 ──

export class AddProgressNoteDto {
  @ApiProperty({ description: '기록 내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '활력징후' })
  @IsOptional()
  @IsObject()
  vitalSigns?: Record<string, any>;

  @ApiPropertyOptional({ description: '기록 종류 — PROGRESS(일일 경과기록·기본) | ADMISSION(입원 초진기록·H&P)', enum: ['PROGRESS', 'ADMISSION'] })
  @IsOptional()
  @IsIn(['PROGRESS', 'ADMISSION'])
  noteType?: 'PROGRESS' | 'ADMISSION';
}

// ── 주치의 변경 ──

export class ChangeAttendingDto {
  @ApiProperty({ description: '새 담당의 ID' })
  @IsUUID()
  newDoctorId: string;

  @ApiProperty({ description: '변경 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: '인수인계 노트' })
  @IsOptional()
  @IsString()
  handoffNote?: string;
}

// ── 회진 기록 ──

export class CreateRoundDto {
  @ApiProperty({ description: '회진 유형 (MORNING, EVENING, NIGHT 등)' })
  @IsString()
  @IsNotEmpty()
  roundType: string;

  @ApiPropertyOptional({ description: '회진 노트' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: '평가' })
  @IsOptional()
  @IsString()
  assessment?: string;

  @ApiPropertyOptional({ description: '계획' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ description: '바이탈 사인' })
  @IsOptional()
  @IsObject()
  vitalSigns?: Record<string, any>;
}

// ── 중간 정산 ──

export class PayInterimBillingDto {
  @ApiPropertyOptional({ description: '수납 금액 (미입력 시 본인부담금 전액 · 본인부담금 전액만 받는다)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  /** 🔴 (2026-10-22) 필수 — 종전엔 수단 없이 받아 일마감 시재·카드 대사·ERP 계정 어디에도 그 돈이 수단으로 남지 않았다 */
  @ApiProperty({ description: '결제 수단', enum: INTERIM_PAYMENT_METHODS })
  @IsIn([...INTERIM_PAYMENT_METHODS])
  method: 'CARD' | 'CASH' | 'TRANSFER';

  @ApiPropertyOptional({ description: '카드 승인번호(카드면 필수)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cardApprovalNo?: string;

  @ApiPropertyOptional({ description: '카드사(매입사)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cardCompany?: string;

  @ApiPropertyOptional({ description: '할부 개월(0/1 = 일시불)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  installment?: number;

  @ApiPropertyOptional({ description: '현금영수증 번호' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cashReceiptNo?: string;
}

/** 중간정산 무효(2026-10-22) — 수납 전·마지막 회차만 · 사유 필수 */
export class VoidInterimBillingDto {
  @ApiProperty({ description: '무효 사유(4자 이상)' })
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  reason: string;
}

/** 중간정산 환불(2026-10-22 · ERP 회신 R5) — 수납된 회차만 · 부분 환불 · 누적 ≤ 수납액 · 사유 필수 */
export class RefundInterimBillingDto {
  @ApiProperty({ description: '환불 금액(원 · 1 이상 정수)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ enum: INTERIM_PAYMENT_METHODS, description: '환불 수단' })
  @IsIn([...INTERIM_PAYMENT_METHODS])
  method: 'CARD' | 'CASH' | 'TRANSFER';

  @ApiProperty({ description: '환불 사유(4자 이상)' })
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  reason: string;
}

// ── 인수인계 생성 ──

/** I-PASS 의 A(조치 목록) 한 줄 — 스키마 주석 `[{action, status, deadline}]` 과 같은 모양 */
export class HandoffActionItemDto {
  @ApiProperty({ description: '조치 내용' })
  @IsString()
  @IsNotEmpty()
  action: string;

  @ApiPropertyOptional({ description: '상태 — PENDING·DONE' })
  @IsOptional()
  @IsIn(['PENDING', 'DONE'])
  status?: string;

  @ApiPropertyOptional({ description: '기한(ISO 8601)' })
  @IsOptional()
  @IsString()
  deadline?: string;
}

/**
 * 인계 조치 항목 완료/되돌림(2026-10-04 · 스테이션 보드).
 * `action` = 화면이 본 그 항목의 글자 — 그 사이 목록이 바뀌었으면(다른 사람이 고침) 409 로 다시 보게 한다.
 */
export class SetHandoffActionStatusDto {
  @ApiProperty({ description: '상태 — PENDING·DONE', enum: [...HANDOFF_ACTION_STATUS] })
  @IsIn([...HANDOFF_ACTION_STATUS])
  status: string;

  @ApiProperty({ description: '화면이 본 항목 글자(동시 수정 확인용)' })
  @IsString()
  @IsNotEmpty()
  action: string;
}

export class CreateHandoffDto {
  /** 🔴 (2026-10-26) 종전엔 아무 문자열이나 받았다(같은 간호 교대에 두 단어) — 정본 어휘만 · 교대 인계는 보낸 사람 직종대로(간호사 = NURSING_SHIFT) */
  @ApiProperty({ description: '인수인계 유형', enum: HANDOFF_TYPES })
  @IsIn([...HANDOFF_TYPES])
  type: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  /** 🔴 (2026-09-30) 인계자는 서버가 로그인 사용자로 정한다 — 본문 값은 무시(남의 이름으로 인계를 쓰지 못하게). 구버전 화면 호환으로만 받는다 */
  @ApiPropertyOptional({ description: '인계자 ID — 무시됨(서버가 로그인 사용자로 기록)' })
  @IsOptional()
  @IsUUID()
  fromDoctorId?: string;

  @ApiProperty({ description: '인수자 ID' })
  @IsUUID()
  toDoctorId: string;

  @ApiPropertyOptional({ description: '입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiPropertyOptional({ description: '응급 방문 ID' })
  @IsOptional()
  @IsUUID()
  emergencyVisitId?: string;

  @ApiProperty({ description: '인수인계 요약' })
  @IsString()
  @IsNotEmpty()
  summary: string;

  @ApiPropertyOptional({ description: '바이탈 사인' })
  @IsOptional()
  @IsObject()
  vitalSigns?: Record<string, any>;

  @ApiPropertyOptional({ description: '미결 항목' })
  @IsOptional()
  @IsObject()
  pendingItems?: Record<string, any>;

  // ── I-PASS 구조화 인수인계 (Illness · Patient summary · Action list · Situation awareness · Synthesis) ──
  // 🔴 2026-08-19: 이 다섯 필드가 **DTO 에 없어 전역 whitelist 가 조용히 지우고 있었다.**
  //    화면(`/inpatient/[id]` 인계 폼)은 다섯 칸을 다 받아 보내는데 서버는 200 을 주고 값만 버렸다.
  //    운영 실측: 시드로 직접 삽입된 111건은 채워져 있고, **API 로 만들어진 2건은 전부 NULL**이었다.
  //    (성공 응답 + 데이터 소실 — FE↔DTO 는 기계 대조만이 잡는다.)

  @ApiPropertyOptional({ description: '중증도(I) — STABLE·UNSTABLE·CRITICAL', enum: ['STABLE', 'UNSTABLE', 'CRITICAL'] })
  @IsOptional()
  @IsIn([...HANDOFF_ILLNESS]) // 어휘 정본 shared `handoff.ts`
  illness?: string;

  @ApiPropertyOptional({ description: '환자 요약(P)' })
  @IsOptional()
  @IsString()
  patientSummary?: string;

  @ApiPropertyOptional({ description: '조치 목록(A) — [{action, status, deadline}]', type: [HandoffActionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HandoffActionItemDto)
  actionList?: HandoffActionItemDto[];

  @ApiPropertyOptional({ description: '상황 인식·비상 계획(S)' })
  @IsOptional()
  @IsString()
  situationAwareness?: string;

  @ApiPropertyOptional({ description: '인수자 확인 사항(S)' })
  @IsOptional()
  @IsString()
  synthesis?: string;
}

/** 🔴 (2026-09-15 T2) 입원 취소 — 종전 인라인 @Body(ValidationPipe 스킵). 사유 미입력 기본값('입원 취소')은 컨트롤러가 채운다 */
export class CancelAdmissionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

/** 퇴원 예정일 설정/해제 — null 이면 해제. `expectedDischargeDate` 는 Timestamptz(날짜 문자열은 new Date 로 해석) */
export class SetExpectedDischargeDto {
  @ApiPropertyOptional({ nullable: true, example: '2026-09-20' }) @IsOptional() @IsDateString() date?: string | null;
}
