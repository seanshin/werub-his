import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 환자 식별 체크(IPSG.1)가 인라인 본문을 `{ ...data }` create 로 넘겼다 — 본문 키가 그대로 컬럼에 들어가고
 * (`id` 까지), 결과·유형 길이 초과는 500 이었다. 길이는 `PatientIdentificationCheck` 스키마 VarChar 그대로.
 * 유형 어휘는 스키마 주석뿐이라 DTO 가 막지 않는다. 결과는 IPSG.1 통계가 PASS/FAIL 두 값만 세므로 그 둘로 제한한다(2026-09-15).
 */
export class CreateIdentificationCheckDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) checkType!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) method!: string;
  @ApiProperty({ description: '{name: true, dob: true, mrn: true}' }) @IsObject() verifiedItems!: Record<string, boolean>;
  /** 선언일 뿐 — 서버가 대조 항목에서 판정한다(`common/identity-check-verdict.ts`). 통계는 PASS/FAIL 두 값만 센다 */
  @ApiProperty({ enum: ['PASS', 'FAIL'] }) @IsIn(['PASS', 'FAIL']) result!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() failureReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() encounterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() admissionId?: string;
}

/**
 * 🔴 Morse Fall Scale — 인라인 본문이라 `ivTherapy: "false"`(문자열)가 참으로 읽혀 **점수가 20점 부풀었다**
 * (위험도 오판·거짓 경보). 불리언·선택지를 계산 함수의 타입 그대로 강제한다.
 */
export class MorseFallFactorsDto {
  @ApiProperty() @IsBoolean() historyOfFalling!: boolean;
  @ApiProperty() @IsBoolean() secondaryDiagnosis!: boolean;
  @ApiProperty({ enum: ['NONE', 'CRUTCH', 'FURNITURE'] }) @IsIn(['NONE', 'CRUTCH', 'FURNITURE']) ambulatoryAid!: 'NONE' | 'CRUTCH' | 'FURNITURE';
  @ApiProperty() @IsBoolean() ivTherapy!: boolean;
  @ApiProperty({ enum: ['NORMAL', 'WEAK', 'IMPAIRED'] }) @IsIn(['NORMAL', 'WEAK', 'IMPAIRED']) gait!: 'NORMAL' | 'WEAK' | 'IMPAIRED';
  @ApiProperty({ enum: ['ORIENTED', 'OVERESTIMATES'] }) @IsIn(['ORIENTED', 'OVERESTIMATES']) mentalStatus!: 'ORIENTED' | 'OVERESTIMATES';
}

export class AssessMorseFallDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ type: MorseFallFactorsDto }) @ValidateNested() @Type(() => MorseFallFactorsDto) factors!: MorseFallFactorsDto;
}
