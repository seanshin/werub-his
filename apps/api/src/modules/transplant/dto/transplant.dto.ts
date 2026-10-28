import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 이식 쓰기가 `Record<string, unknown>`·인라인 본문을 서비스의 `{ ...data }` create 로 그대로 넘겼다(대량 할당).
 *  - 기증자 등록 본문에 `status: 'APPROVED'`·`crossmatchResult: 'NEGATIVE'` 를 넣으면 **승인·교차시험 절차를 건너뛴 기증자**가 만들어졌다
 *    (이식 기록 생성은 APPROVED 기증자를 DONATED 로 원자 전이하는 것만 확인한다).
 *  - 대기자 등록에 `status`·`matchedAt`, 이식 기록에 `outcome`·`graftFunction`, 거부반응에 `outcome` 이 본문으로 들어갔다.
 * 길이는 스키마 VarChar 그대로. 상태·결과 필드는 등록 DTO 에 두지 않는다(각자 전용 전이 EP 소관).
 */
export class AddTransplantWaitlistDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) organType!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(5) bloodType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) urgency?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() hlaTyping?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) pra?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) konosId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateTransplantWaitlistStatusDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(15) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) removeReason?: string;
}

export class RegisterTransplantDonorDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(15) donorType!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() donorPatientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) donorName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) relationship?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(5) bloodType!: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() hlaTyping?: Record<string, unknown>;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) organType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() evaluationNotes?: string;
}

export class CreateTransplantRecordDto {
  @ApiProperty() @IsUUID() recipientId!: string;
  @ApiProperty() @IsUUID() donorId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() waitlistId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() surgeryId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) organType!: string;
  @ApiProperty({ description: 'ISO8601' }) @IsISO8601() transplantDate!: string;
  @ApiProperty() @IsUUID() surgeonId!: string;
  @ApiPropertyOptional({ description: '분' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) coldIschemiaTime?: number;
  @ApiPropertyOptional({ description: '분' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) warmIschemiaTime?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() inductionRegimen?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() maintenanceRegimen?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ReportTransplantRejectionDto {
  @ApiProperty() @IsUUID() transplantId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) rejectionType!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10) severity!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() biopsyResult?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() treatment?: string;
}

/**
 * 🔴 (2026-09-15 B6) 남은 이식 쓰기 7 핸들러가 `Record<string, unknown>`·`@Body('key')` 원시 추출이라 검증이 통째로 스킵됐다.
 *  - 상세 교차시험은 `finalResult` 가 비면 서비스가 `COMPATIBLE` 로 채워 결과 `NEGATIVE` 를 저장했다 —
 *    이식 적합성 게이트(`xm.result !== 'NEGATIVE'` 차단)가 **판정하지 않은 교차시험으로 열렸다**. 이제 판정은 필수다.
 *  - 교차시험 결과·거부반응 결과는 스키마 주석 어휘(NEGATIVE/POSITIVE · RESOLVED/ONGOING/GRAFT_LOSS) 밖을 거부한다
 *    (게이트는 대문자 `NEGATIVE` 만 음성으로 본다).
 *  - PRA 는 스키마 `Int` — 소수는 종전 Prisma 500.
 * 기록자(`recordedBy`)는 본문에서 받지 않는다(컨트롤러가 로그인 사용자를 넘긴다).
 */
export const CROSSMATCH_RESULTS = ['NEGATIVE', 'POSITIVE'] as const;
export const CROSSMATCH_FINAL_RESULTS = ['COMPATIBLE', 'INCOMPATIBLE'] as const;
export const REJECTION_OUTCOMES = ['RESOLVED', 'ONGOING', 'GRAFT_LOSS'] as const;

export class UpdateTransplantCrossmatchDto {
  @ApiProperty({ enum: CROSSMATCH_RESULTS }) @IsIn(CROSSMATCH_RESULTS) result!: (typeof CROSSMATCH_RESULTS)[number];
  @ApiPropertyOptional({ description: '수혈자 — 있으면 교차시험 이력에 결속 저장' }) @IsOptional() @IsUUID() recipientId?: string;
}

export class UpdateTransplantRejectionOutcomeDto {
  @ApiProperty({ enum: REJECTION_OUTCOMES }) @IsIn(REJECTION_OUTCOMES) outcome!: (typeof REJECTION_OUTCOMES)[number];
}

export class RegisterKonosDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) urgency?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() medicalInfo?: Record<string, unknown>;
}

export class RecordTransplantHlaDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) hlaA?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) hlaB?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) hlaC?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) hlaDR?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) hlaDQ?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) hlaDP?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) method?: string;
  @ApiPropertyOptional({ description: '%' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) pra?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() antibodies?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lab?: string;
  @ApiPropertyOptional({ description: 'ISO8601' }) @IsOptional() @IsISO8601() testedAt?: string;
}

export class RecordTransplantCrossmatchDto {
  @ApiProperty() @IsUUID() recipientId!: string;
  @ApiProperty({ enum: CROSSMATCH_FINAL_RESULTS, description: '판정 — 비우면 음성으로 저장되던 자리(필수)' })
  @IsIn(CROSSMATCH_FINAL_RESULTS) finalResult!: (typeof CROSSMATCH_FINAL_RESULTS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) cdcTCell?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) cdcBCell?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) fcxmTCell?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) fcxmBCell?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) mfi?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) virtualCrossmatch?: string;
}

export class RecordTransplantTdmDto {
  // 🔴 (2026-09-15 T1) 필수 — 종전 비우면 서비스가 'tacrolimus' 로 채웠다(약물을 추정해 기록).
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60) drug!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) troughLevel?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) peakLevel?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) targetLow?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) targetHigh?: number;
  @ApiPropertyOptional({ description: '{min,max} — targetLow/High 가 우선' }) @IsOptional() @IsObject() targetRange?: { min?: number; max?: number };
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) doseAdjustment?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() sideEffects?: unknown[];
  /**
   * 채혈 시각 — 🔴 (2026-10-10) 필수. 종전엔 비우면 서버가 지금 시각을 박았다 — trough 는 투약 직전 채혈이라
   *    채혈 시각이 해석의 일부인데, 모르는 시각을 관측 시각처럼 원장에 남겼다.
   */
  @ApiProperty({ description: 'ISO8601 — 채혈 시각(필수)' }) @IsISO8601() sampledAt!: string;
}

export class RecordTransplantFollowUpDto {
  @ApiPropertyOptional({ description: 'ISO8601' }) @IsOptional() @IsISO8601() visitDate?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) postOpDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) graftFunction?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() labResults?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() immunosuppressionRegimen?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsArray() complications?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() biopsyResult?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() infections?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() rejectionSigns?: boolean;
  @ApiPropertyOptional({ description: 'ISO8601' }) @IsOptional() @IsISO8601() nextFollowUp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
