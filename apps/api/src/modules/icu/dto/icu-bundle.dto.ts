import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';

/**
 * 🔴 (2026-09-15 B7) ICU 퇴실·번들 기록 7 핸들러가 `Record<string, unknown>`·인라인 타입이라 ValidationPipe 가 스킵됐다.
 *  - 번들 서비스는 **빠진 판정을 그럴듯한 값으로 채워** 돌려준다(SBT `result ?? 'PASS'` · RASS `?? 0` · 준수율 `?? 100`).
 *    판정 없는 요청이 "통과·안정·100% 준수"로 기록된 것처럼 응답됐다. 판정 필드는 필수로 받는다(B6 교차시험과 같은 원칙).
 *  - 어휘는 서비스 주석에 이미 적힌 것만(번들 1H·3H · VAP·CLABSI·CAUTI · ECMO VV·VA · SBT PASS·FAIL).
 *    수치 범위는 척도 정의(RASS −5~+4 · BPS 3~12 · FiO2 21~100)만 — 설정값(유량 등)은 음수만 막는다(임상 상한을 지어내지 않는다).
 */
export class IcuDischargeDto {
  /** 병동 전동 인수의 — 지정 시 ICU→병동 핸드오프 생성 */
  @ApiPropertyOptional() @IsOptional() @IsUUID() toDoctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) toWard?: string;
}

export class IcuSepsisBundleDto {
  @ApiProperty({ enum: ['1H', '3H'] }) @IsIn(['1H', '3H']) bundleType!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() lactateOrdered?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bloodCultureBeforeAbx?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() broadSpectrumAbx?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() fluidBolus30ml?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vasopressorsIfNeeded?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() repeatLactateIf4?: boolean;
}

export class IcuInfectionBundleDto {
  @ApiProperty({ enum: ['VAP', 'CLABSI', 'CAUTI'] }) @IsIn(['VAP', 'CLABSI', 'CAUTI']) bundleType!: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() checklist?: Record<string, unknown>;
  /** 🔴 준수율은 필수 — 종전 기본값 100 은 "전부 지켰다"를 지어냈다 */
  @ApiProperty() @IsNumber() @Min(0) @Max(100) complianceRate!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class IcuSedationDto {
  /** 🔴 RASS 는 필수 — 종전 기본값 0 은 "명료·안정"을 지어냈다 */
  @ApiProperty() @IsInt() @Min(-5) @Max(4) rass!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(3) @Max(12) bps?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() camIcu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) sedationTarget?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) currentAgent?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) doseRate?: string;
}

export class IcuCrrtDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) mode?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) bloodFlowRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) dialysateRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) replacementRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) ultrafiltrationRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) anticoagulation?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) filterLife?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) accessType?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) complications?: string[];
}

export class IcuEcmoDto {
  @ApiProperty({ enum: ['VV', 'VA'] }) @IsIn(['VV', 'VA']) ecmoType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) cannulationSite?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) bloodFlowRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) sweepGasFlow?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(21) @Max(100) fio2?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) rpm?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() circuitPressures?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) complications?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) anticoagulationType?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) act?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) ptt?: number;
}

export class IcuWeaningTrialDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) trialType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() preTrialVitals?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() postTrialVitals?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) rsbi?: number;
  /** 🔴 SBT 결과는 필수 — 종전 기본값 'PASS' 는 이탈 시도 성공을 지어냈다 */
  @ApiProperty({ enum: ['PASS', 'FAIL'] }) @IsIn(['PASS', 'FAIL']) result!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) failureReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) weaningDecision?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() extubationPlanned?: boolean;
}
