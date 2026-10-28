import {
  IsString, IsOptional, IsNotEmpty, IsNumber, IsInt, IsBoolean, Min, Max,
  IsIn, IsArray, MinLength, MaxLength, IsDateString, IsUUID, ArrayMaxSize, ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ══════════════════════════════════════════
//  비대면 진료 (Remote Consultation)
// ══════════════════════════════════════════

const REMOTE_CHANNELS = ['TEXT', 'VIDEO', 'RESULT_REVIEW', 'HYBRID'];
const PAYMENT_METHODS = ['CARD', 'KAKAOPAY', 'DEFERRED'];

// ══════════════════════════════════════════
//  PACS 영상/판독 내보내기 (Imaging Export)
// ══════════════════════════════════════════

const EXPORT_PURPOSES = ['SELF_VIEW', 'SECOND_OPINION', 'TRANSFER', 'PERSONAL_ARCHIVE'];

export class ImagingExportRequestDto {
  @ApiProperty({ enum: EXPORT_PURPOSES, description: '내보내기 목적(감사 기록용)' })
  @IsString() @IsIn(EXPORT_PURPOSES)
  purpose!: string;

  @ApiPropertyOptional({ description: '특정 검사만 내보낼 경우 study UID 목록(미지정 시 전체)', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  studyUids?: string[];
}

export class CreateRemoteConsultDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  doctorId: string;

  @ApiProperty({ enum: REMOTE_CHANNELS }) @IsString() @IsIn(REMOTE_CHANNELS)
  channel: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30)
  category?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200)
  subject: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  chiefComplaint?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  symptomDuration?: string;

  @ApiPropertyOptional() @IsOptional() @IsArray()
  attachments?: unknown[];

  @ApiPropertyOptional() @IsOptional() @IsString()
  priorLabResultId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  videoScheduledAt?: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS)
  paymentMethod?: string;
}

export class RemoteConsultMessageDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000)
  content: string;

  @ApiPropertyOptional() @IsOptional() @IsArray()
  attachments?: unknown[];
}

export class PayConsultDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS)
  paymentMethod: string;
}

export class CancelConsultDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

export class RateConsultDto {
  @ApiProperty() @IsInt() @Min(1) @Max(5)
  rating: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  feedback?: string;
}

export class VideoEscalationDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString()
  scheduledAt?: string;
}

export class RemoteConsentDto {
  @ApiProperty() @IsBoolean() remoteService: boolean;
  @ApiProperty() @IsBoolean() feeAgreement: boolean;
  @ApiProperty() @IsBoolean() healthInfoConsent: boolean;
  @ApiProperty() @IsBoolean() recordRetention: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() videoRecording?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) signatureData?: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: string;
}

// ══════════════════════════════════════════
//  보호자 위임 (Guardian Proxy)
// ══════════════════════════════════════════

export class GuardianRequestDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50)
  dependentMrn: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30)
  relationship: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50)
  legalBasis: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  documentUrl?: string;
}

export class BreakTheGlassDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50)
  dependentMrn: string;

  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500)
  reason: string;
}

// ── 환자 본인 인증 ──

export class PortalAuthDto {
  @ApiProperty({ description: 'MRN (등록번호)' })
  @IsString()
  @IsNotEmpty()
  mrn: string;

  @ApiProperty({ description: '생년월일 (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  dateOfBirth: string;
}

// ── 예약 변경 ──

export class RescheduleAppointmentDto {
  @ApiProperty({ description: '변경할 일시 (ISO 8601)' })
  @IsString()
  @IsNotEmpty()
  scheduledAt: string;
}

// ── 예약 취소 ──

export class CancelAppointmentDto {
  @ApiPropertyOptional({ description: '취소 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── 내 정보 변경 ──

/**
 * 🔴 (2026-09-15 U4) 환자가 직접 고치는 연락처·주소를 서비스가 slice 로 **조용히 잘라** 저장했다 — 잘린 전화번호·주소로 연락이 닿지 않는다.
 *    전화번호는 slice 30 인데 컬럼이 VarChar(20) 이라 21~30자는 500 이었다. 저장 길이 그대로 400 으로 알린다(포털 입력칸 maxLength 동반).
 */
export class UpdatePortalProfileDto {
  @ApiPropertyOptional({ description: '전화번호' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: '이메일' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ description: '주소' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ description: '비상연락처 이름' })
  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @ApiPropertyOptional({ description: '비상연락처 전화번호' })
  @IsOptional()
  @IsString()
  emergencyPhone?: string;

  @ApiPropertyOptional({ description: '직업' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  occupation?: string;

  @ApiPropertyOptional({ description: '결혼여부(SINGLE/MARRIED/DIVORCED/WIDOWED)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  maritalStatus?: string;

  @ApiPropertyOptional({ description: '종교' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  religion?: string;

  @ApiPropertyOptional({ description: '선호언어' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  preferredLanguage?: string;
}

// ── 서류 발급 신청 ──

export class RequestDocumentDto {
  @ApiProperty({ description: '서류 종류 (진단서, 소견서, 진료확인서 등)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: '용도' })
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiPropertyOptional({ description: '기간 시작일' })
  @IsOptional()
  @IsString()
  periodFrom?: string;

  @ApiPropertyOptional({ description: '기간 종료일' })
  @IsOptional()
  @IsString()
  periodTo?: string;

  @ApiPropertyOptional({ description: '수령 방법' })
  @IsOptional()
  @IsIn(['PORTAL', 'VISIT', 'MAIL', 'FAX'])
  deliveryMethod?: string;

  @ApiPropertyOptional({ description: '부수(1~10)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  copies?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  note?: string;
}

// ── 건강 메모 ──

export class CreateHealthMemoDto {
  @ApiProperty({ description: '메모 내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;
}

// ── 만족도 평가 ──

export class SubmitSatisfactionDto {
  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsString()
  encounterId?: string;

  @ApiProperty({ description: '전체 만족도 (1~5)' })
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating: number;

  @ApiPropertyOptional({ description: '대기시간 만족도 (1~5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  waitRating?: number;

  @ApiPropertyOptional({ description: '직원 친절도 (1~5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  staffRating?: number;

  @ApiPropertyOptional({ description: '시설 만족도 (1~5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  facilityRating?: number;

  @ApiPropertyOptional({ description: '코멘트' })
  @IsOptional()
  @IsString()
  comment?: string;
}

// ── 담당의 메시지 ──

export class SendPortalMessageDto {
  @ApiProperty({ description: '메시지 내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '담당의 ID' })
  @IsOptional()
  @IsString()
  doctorId?: string;
}

// ── 동의서 전자 서명 ──

export class SignConsentDto {
  @ApiProperty({ description: '서명 데이터 (base64 이미지 등)' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}

// ── 복약 체크 ──

export class MedicationCheckDto {
  @ApiProperty({ description: '처방 ID' })
  @IsUUID() // 비UUID가 Prisma P2023 500으로 새는 것 방지
  prescriptionId: string;

  @ApiProperty({ description: '복약 시간대 (아침 식후, 점심 식후, 저녁 식후 등)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20) // DB VarChar(20) — 초과 시 P2000 500 방지
  slot: string;

  @ApiProperty({ description: '복용 여부' })
  @IsBoolean()
  taken: boolean;
}

// ── F-7/P2: 포털 약물 상호작용 확인(WeRU.B 프록시) ──
// ⚠️ 전역 whitelist ValidationPipe — 데코레이터 없는 필드는 strip되므로 전 필드 명시

export class PortalDrugInteractionsDto {
  @ApiProperty({ description: '약품명 배열(제품명 — 2종 이상)', type: [String] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  drugs: string[];
}

// ── 가족 계정 전환 ──

export class SwitchFamilyDto {
  @ApiProperty({ description: '전환할 가족 환자 ID' })
  @IsString()
  @IsNotEmpty()
  linkedPatientId: string;
}

// ── 메시지 답장 ──

export class ReplyMessageDto {
  @ApiProperty({ description: '원본 메시지 ID' })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ description: '답장 내용' })
  @IsString()
  @IsNotEmpty()
  content: string;
}

// ── 인증서 발급 요청 ──

export class RequestCertificateDto {
  @ApiProperty({ description: '공개키 (Base64)' })
  @IsString()
  @IsNotEmpty()
  publicKey: string;

  @ApiProperty({ description: '알고리즘 (ECDSA, RSA 등)' })
  @IsString()
  @IsNotEmpty()
  algorithm: string;
}

// ── 서류 상태 변경 (관리자) ──

export class UpdateDocumentStatusDto {
  @ApiProperty({ description: '변경할 상태' })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional({ description: '반려 사유' })
  @IsOptional()
  @IsString()
  rejectReason?: string;
}

// ══════════════════════════════════════════
//  검진 자가 예약 (Checkup Self-Reserve)
// ══════════════════════════════════════════

/**
 * 🔴 환자 셀프 검진 예약 — `interface`/인라인 `@Body(){...}` → class 승격(2026-09-01 포털 쓰기 프로브).
 *    종전엔 인라인 리터럴이라 ValidationPipe 스킵 → 빈/오염 바디의 `programId` 가 undefined 로
 *    `checkupProgram.findUnique({where:{id:undefined}})` 에 들어가 **환자에게 500**(자기 입력 문제인데
 *    서버 오류로 읽힌다). scheduledDate 도 `new Date(undefined)`=Invalid Date. 이제 400 으로 말한다.
 */
export class CheckupReserveDto {
  @ApiProperty({ description: '검진 프로그램 ID' })
  @IsString() @IsNotEmpty({ message: '검진 프로그램을 선택하세요' })
  programId!: string;

  @ApiProperty({ description: '희망 검진일 (YYYY-MM-DD)' })
  @IsDateString({}, { message: '검진일은 날짜 형식(YYYY-MM-DD)이어야 합니다' })
  scheduledDate!: string;

  @ApiPropertyOptional({ description: '선택 옵션 코드 목록' })
  @IsOptional() @IsArray() @IsString({ each: true })
  selectedOptions?: string[];
}
