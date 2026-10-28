import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 호스피스 쓰기가 인라인·`Record<string, unknown>` 본문을 서비스의 `{ ...data }` create 로 넘겼다.
 *  - ESAS 평가: 점수가 문자열이면 `totalScore` 가 **문자열 이어붙이기**가 되고(`'7'+'3'…`), `pain >= 7` 심한 통증 경보가 기준대로 돌지 않았다.
 *    범위 0~10 은 스키마 주석(0=좋음·10=최악)과 ESAS 척도 그대로.
 *  - 사전의료의향서(연명의료): 본문에 `status`·`revokedAt`·서명 시각을 넣으면 그대로 저장됐다(대량 할당).
 *  - 등록: 본문에 `status: 'DECEASED'`·`dischargedAt` 등이 들어갔다. PPS 0~100 은 스키마 주석 그대로.
 * 길이는 스키마 VarChar 그대로.
 */
export class RegisterHospiceDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ description: 'PPS 0~100' }) @Type(() => Number) @IsInt() @Min(0) @Max(100) ppsScore!: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) primaryDiagnosis!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) prognosis?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) hospiceType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() goals?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dnrStatus?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() admissionId?: string;
}

/** 완화의료 오피오이드 — 마약류 원장 정본(PrescribeControlledSubstanceDto)과 같은 제약(처방자는 인증 주체) */
export class PrescribeHospiceOpioidDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) drugName!: string;
  @ApiProperty({ description: 'I~V' }) @IsString() @IsNotEmpty() @MaxLength(10) deaSchedule!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) narcoticType?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @IsPositive() quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) unit!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) drugCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateHospiceAssessmentDto {
  @ApiProperty() @IsUUID() registrationId!: string;
  @ApiProperty({ description: 'ESAS 0~10' }) @Type(() => Number) @IsInt() @Min(0) @Max(10) pain!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) tiredness!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) nausea!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) depression!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) anxiety!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) drowsiness!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) appetite!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) wellbeing!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) shortnessOfBreath!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) otherSymptom?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) otherScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) painType?: string;
  @ApiPropertyOptional({ description: 'WHO 3단계' }) @IsOptional() @Type(() => Number) @IsIn([1, 2, 3]) whoStep?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) painMedication?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateAdvanceDirectiveDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ description: 'AD·POLST' }) @IsIn(['AD', 'POLST']) documentType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) cprDecision?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) ventilatorDecision?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) dialysisDecision?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) transfusionDecision?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) chemotherapyDecision?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hospiceConsent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() organDonation?: boolean;
  /** 🔴 (2026-10-10) 받지 않는다 — 연명의료계획서(POLST) 작성 의사는 로그인한 의사로 서버가 정한다(남의 이름으로 등록하지 않게) */
  @ApiPropertyOptional({ deprecated: true }) @IsOptional() @IsUUID() doctorId?: string;
}

/** 사전연명의료 철회 — 🔴 (2026-10-10) 사유 필수 · 기록자는 로그인한 사람(본문으로 받지 않는다) */
export class RevokeAdvanceDirectiveDto {
  @ApiProperty({ description: '철회 사유(환자 본인 의사 표시·방법 등)' }) @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class CreateHospiceConferenceDto {
  @ApiProperty() @IsUUID() registrationId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) conferenceType!: string;
  @ApiProperty({ description: '[{role, name}]' }) @IsArray() @ArrayNotEmpty() attendees!: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() currentStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() careGoals?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() painManagement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() psychosocial?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() spiritual?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() familyConcerns?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() actionItems?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() nextConferenceDate?: string;
}

/**
 * (2026-09-15 B10) 상태 변경 — `@Body('status')` 원시 추출이었다. 어휘 검사는 서비스에 이미 있었고(400) 여기로 옮겨 입구에서 막는다.
 * 어휘는 서비스 정본(ACTIVE·DISCHARGED·DECEASED) 그대로 — 서비스 검사는 내부 호출 대비로 남긴다.
 */
export class UpdateHospiceStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISCHARGED', 'DECEASED'] })
  @IsIn(['ACTIVE', 'DISCHARGED', 'DECEASED'])
  status: 'ACTIVE' | 'DISCHARGED' | 'DECEASED';
  /** 퇴원·사망 시각(ISO-8601) — 🔴 (2026-10-10) 필수. 종전엔 버튼을 누른 시각이 사망 시각으로 박혔다 */
  @ApiPropertyOptional() @IsOptional() @IsISO8601() occurredAt?: string;
}
