import {
  IsString, IsOptional, IsNumber, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 혈액제제 입고 ──

export class AddBloodProductDto {
  @ApiProperty({ description: '단위번호' })
  @IsString()
  @IsNotEmpty()
  unitNumber: string;

  @ApiProperty({ description: '제품 유형 (pRBC, FFP, PC 등)' })
  @IsString()
  @IsNotEmpty()
  productType: string;

  @ApiProperty({ description: '혈액형 (A, B, O, AB)' })
  @IsString()
  @IsNotEmpty()
  bloodType: string;

  @ApiProperty({ description: 'Rh 인자 (+, -)' })
  @IsString()
  @IsNotEmpty()
  rhFactor: string;

  @ApiProperty({ description: '용량 (mL)' })
  @IsNumber()
  volume: number;

  @ApiProperty({ description: '채혈일' })
  @IsString()
  @IsNotEmpty()
  collectedAt: string;

  @ApiProperty({ description: '유효기한' })
  @IsString()
  @IsNotEmpty()
  expiresAt: string;

  @ApiPropertyOptional({ description: '공혈자 ID' })
  @IsOptional()
  @IsString()
  donorId?: string;

  @ApiPropertyOptional({ description: '공급처명' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ description: '보관 위치' })
  @IsOptional()
  @IsString()
  storageLocation?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 혈액제제 상태 변경 ──

export class UpdateProductStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}

// ── 교차시험 요청 ──

export class RequestCrossmatchDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '혈액제제 ID' })
  @IsUUID()
  bloodProductId: string;

  @ApiPropertyOptional({ description: '교차시험 방법' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 교차시험 결과 ──

export class SubmitCrossmatchResultDto {
  @ApiProperty({ description: '결과 (COMPATIBLE, INCOMPATIBLE)' })
  @IsString()
  @IsNotEmpty()
  result: string;

  @ApiPropertyOptional({ description: '항체 스크리닝' })
  @IsOptional()
  @IsString()
  antibodyScreen?: string;

  @ApiPropertyOptional({ description: '시험 방법' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 수혈 오더 ──

export class CreateTransfusionOrderDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '제품 유형' })
  @IsString()
  @IsNotEmpty()
  productType: string;

  @ApiProperty({ description: '단위 수' })
  @IsNumber()
  units: number;

  @ApiPropertyOptional({ description: '긴급도' })
  @IsOptional()
  @IsString()
  urgency?: string;

  @ApiPropertyOptional({ description: '적응증' })
  @IsOptional()
  @IsString()
  indication?: string;

  @ApiPropertyOptional({ description: '특수 요청 사항' })
  @IsOptional()
  specialReqs?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '수혈 전 Hb' })
  @IsOptional()
  @IsNumber()
  preTransfusionHb?: number;
}

// ── 혈액 출고 ──

export class IssueBloodDto {
  @ApiProperty({ description: '혈액제제 ID' })
  @IsUUID()
  bloodProductId: string;
}

// ── 2인 확인 ──

export class VerifyTransfusionDto {
  @ApiProperty({ description: '간호사1 ID' })
  @IsUUID()
  nurse1Id: string;

  @ApiProperty({ description: '간호사2 ID' })
  @IsUUID()
  nurse2Id: string;

  @ApiPropertyOptional({ description: '환자 손목밴드 스캔값(MRN) — bedside 대조(2026-07 R2)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  patientBandScan?: string;

  @ApiPropertyOptional({ description: '혈액백 바코드 스캔값(unitNumber)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  bloodUnitScan?: string;
}

// ── 수혈 완료 ──

export class CompleteTransfusionDto {
  @ApiProperty({ description: '수혈량 (mL)' })
  @IsNumber()
  volumeTransfused: number;
}

// ── 수혈 부작용 ──

export class ReportReactionDto {
  @ApiProperty({ description: '부작용 유형' })
  @IsString()
  @IsNotEmpty()
  reactionType: string;

  @ApiProperty({ description: '부작용 심각도' })
  @IsString()
  @IsNotEmpty()
  reactionSeverity: string;

  @ApiPropertyOptional({ description: '조치' })
  @IsOptional()
  @IsString()
  reactionAction?: string;
}

// ── 보강(P1~P3) ──

import { IsIn, IsBoolean, IsInt, Min, Max, Length } from 'class-validator';

// P1: 환자 혈액형
export class SetBloodTypingDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ enum: ['A', 'B', 'O', 'AB'] }) @IsIn(['A', 'B', 'O', 'AB']) abo: string;
  @ApiProperty({ enum: ['POS', 'NEG'] }) @IsIn(['POS', 'NEG']) rh: string;
  @ApiPropertyOptional({ enum: ['A', 'B', 'O', 'AB'], description: '2차 재검(불일치 감지)' }) @IsOptional() @IsIn(['A', 'B', 'O', 'AB']) aboConfirm?: string;
  @ApiPropertyOptional({ enum: ['POS', 'NEG'] }) @IsOptional() @IsIn(['POS', 'NEG']) antibodyScreen?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) notes?: string;
}

// P1: 불규칙항체
export class AddAntibodyDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ description: 'anti-E, anti-K 등' }) @IsString() @Length(1, 30) antibody: string;
  @ApiPropertyOptional({ enum: ['SIGNIFICANT', 'INSIGNIFICANT'] }) @IsOptional() @IsIn(['SIGNIFICANT', 'INSIGNIFICANT']) significance?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) notes?: string;
}

// P1: 대량수혈 프로토콜
export class ActivateMtpDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ enum: ['TRAUMA', 'OB_HEMORRHAGE', 'GI_BLEED', 'SURGICAL', 'OTHER'] }) @IsIn(['TRAUMA', 'OB_HEMORRHAGE', 'GI_BLEED', 'SURGICAL', 'OTHER']) indication: string;
  @ApiPropertyOptional({ description: '비율 예 1:1:1' }) @IsOptional() @IsString() @Length(1, 20) ratio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) notes?: string;
}
export class UpdateMtpDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) packsIssued?: number;
  @ApiPropertyOptional({ description: 'true면 해제' }) @IsOptional() @IsBoolean() deactivate?: boolean;
}

// P1: 긴급 출고(비교차)
export class IssueEmergencyDto {
  @ApiProperty() @IsUUID() bloodProductId: string;
  @ApiProperty({ description: '긴급 사유(마취/응급의)' }) @IsString() @Length(1, 300) reason: string;
}

// P2: 수혈반응 상세 보고
export class ReactionReportDto {
  @ApiProperty({ enum: ['FEBRILE', 'ALLERGIC', 'HEMOLYTIC_ACUTE', 'HEMOLYTIC_DELAYED', 'TRALI', 'TACO', 'SEPSIS', 'OTHER'] })
  @IsIn(['FEBRILE', 'ALLERGIC', 'HEMOLYTIC_ACUTE', 'HEMOLYTIC_DELAYED', 'TRALI', 'TACO', 'SEPSIS', 'OTHER']) reactionType: string;
  @ApiProperty({ enum: ['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING'] }) @IsIn(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']) severity: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) signs?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() workup?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) managementNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) outcome?: string;
  @ApiPropertyOptional({ description: '혈액원 신고 여부' }) @IsOptional() @IsBoolean() reportedToBloodCenter?: boolean;
}

// P2: 특수제제 속성
export class ProductAttributesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() irradiated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() leukoreduced?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cmvNegative?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() washed?: boolean;
}

// P2: 반납/폐기
export class DisposeProductDto {
  @ApiProperty({ enum: ['RETURN', 'DISCARD'] }) @IsIn(['RETURN', 'DISCARD']) action: string;
  @ApiProperty({ description: '사유' }) @IsString() @Length(1, 200) reason: string;
}

// P3: 발주
export class ReorderDto {
  @ApiProperty() @IsString() @Length(1, 30) productType: string;
  @ApiProperty() @IsString() @Length(1, 5) bloodType: string;
  @ApiProperty() @IsInt() @Min(1) units: number;
  @ApiPropertyOptional({ enum: ['ROUTINE', 'URGENT', 'STAT'] }) @IsOptional() @IsIn(['ROUTINE', 'URGENT', 'STAT']) urgency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) supplierName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) notes?: string;
}

export class UpdateReorderStatusDto {
  @ApiProperty({ enum: ['REQUESTED', 'ORDERED', 'RECEIVED', 'CANCELLED'] }) @IsIn(['REQUESTED', 'ORDERED', 'RECEIVED', 'CANCELLED']) status: string;
}

/**
 * 수혈 중 활력징후 — 🔴 인라인 @Body 승격(2026-08-18)
 *
 * `PATCH /blood-bank/transfusions/:id/vitals` 는 `Record<string, unknown>` 이라
 * **아무 키·아무 타입이 그대로 `blood_transfusions.vital_signs`(JsonB) 배열에 append** 됐다.
 * 수혈 중 활력은 급성 용혈·TRALI 를 잡아내는 감시 기록이다 — 원장에 문자열 "고열"이
 * 체온 자리에 들어가면 그 뒤 어떤 판독도 못 한다.
 *
 * 🔴 남는 사실: **이 EP 를 호출하는 화면이 아직 없다**(web·mobile 전수 grep 0건).
 *    즉 수혈 중 활력 감시는 지금 **기록 경로가 열려 있지 않다** — 화면 후속 과제로 보고했다.
 */
export class RecordTransfusionVitalsDto {
  @ApiPropertyOptional({ description: '측정 시점(PRE/15MIN/30MIN/HOURLY/END/REACTION)' })
  @IsOptional()
  @IsIn(['PRE', '15MIN', '30MIN', 'HOURLY', 'END', 'REACTION'])
  timing?: string;

  @ApiPropertyOptional({ description: '수축기 혈압(mmHg)' })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(300)
  systolicBP?: number;

  @ApiPropertyOptional({ description: '이완기 혈압(mmHg)' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(200)
  diastolicBP?: number;

  @ApiPropertyOptional({ description: '심박수(bpm)' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  heartRate?: number;

  @ApiPropertyOptional({ description: '호흡수(/min)' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(80)
  respiratoryRate?: number;

  @ApiPropertyOptional({ description: '체온(℃)' })
  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(45)
  temperature?: number;

  @ApiPropertyOptional({ description: '산소포화도(%)' })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(100)
  spO2?: number;

  @ApiPropertyOptional({ description: '관찰 소견' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
