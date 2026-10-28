import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, IsDateString, IsEmail, Min, Max, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetPolicyDto {
  @ApiPropertyOptional({ example: ['PROGRAM', 'AMOUNT'] })
  @IsOptional() @IsArray() @IsIn(['PROGRAM', 'AMOUNT'], { each: true })
  enabledForms?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Z]{2,5}$/)
  serialPrefix?: string;

  @ApiProperty() @IsInt() @Min(1) @Max(120) validityMonths: number;
  @ApiProperty() @IsInt() @Min(1) @Max(120) refundWindowMonths: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) balanceRefundRate: number;
  @ApiProperty({ description: '해외 딜러 수수료율 상한(%)' }) @IsInt() @Min(0) @Max(100) maxCommissionRate: number;
  @ApiPropertyOptional({ description: '국내 유치업자 수수료율 상한(%) — 해외 이하·법정 상한 이하' }) @IsOptional() @IsInt() @Min(0) @Max(100) domesticMaxCommissionRate?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) maxHierarchyDepth?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() prepaymentRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) allowedCategories?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) anchorChainType?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) anchorIntervalMin?: number;
  @ApiPropertyOptional({ enum: ['RESIDUAL_VOUCHER', 'REFUND_DIFF', 'FORFEIT'] })
  @IsOptional() @IsIn(['RESIDUAL_VOUCHER', 'REFUND_DIFF', 'FORFEIT']) diffPolicy?: string;
}

export class IssueBatchDto {
  @ApiProperty({ enum: ['PROGRAM', 'AMOUNT'] }) @IsIn(['PROGRAM', 'AMOUNT']) form: string;

  @ApiPropertyOptional({ description: 'PROGRAM형 필수' })
  @IsOptional() @IsUUID() programId?: string;

  @ApiPropertyOptional({ description: 'AMOUNT형 액면가(원). PROGRAM형은 정가 스냅샷' })
  @IsOptional() @IsInt() @Min(1) faceValue?: number;

  @ApiProperty({ description: '발행 수량' }) @IsInt() @Min(1) @Max(1000000) quantity: number;

  @ApiProperty({ description: '발행 공급단가(원)' }) @IsInt() @Min(0) supplyPrice: number;

  @ApiProperty({ description: '멱등키(중복 발행 방지)' }) @IsString() @MaxLength(64) idempotencyKey: string;
}

export class ActivateVoucherDto {
  @ApiProperty({ description: '활성화코드(원문)' }) @IsString() @MaxLength(20) activationCode: string;
  @ApiProperty({ description: '바인딩 환자 ID(외국인환자)' }) @IsUUID() patientId: string;
  @ApiProperty({ description: '국외이전·약관 동의(L8)' }) @IsBoolean() consent: boolean;
}

export class ActivateSelfDto {
  @ApiProperty({ description: '활성화코드(원문)' }) @IsString() @MaxLength(20) activationCode: string;
  @ApiProperty({ description: '국외이전·약관 동의(L8)' }) @IsBoolean() consent: boolean;
}

export class RedeemVoucherDto {
  @ApiPropertyOptional({ description: '검진 방문 ID(검진센터 경로) — billingId와 XOR' }) @IsOptional() @IsUUID() visitId?: string;
  @ApiPropertyOptional({ description: '수납 ID(원무 수납 경로·A1) — visitId와 XOR' }) @IsOptional() @IsUUID() billingId?: string;
  @ApiProperty({ description: '실 검진가/충당액(원)' }) @IsInt() @Min(0) actualPrice: number;
  @ApiProperty({ description: '멱등키' }) @IsString() @MaxLength(64) idempotencyKey: string;
}

// 외국인 구매자 셀프 claim(무인증·G1+G2) — 코드+신원+포털계정 1화면
export class ClaimVoucherDto {
  @ApiProperty({ description: '검진권 시리얼' }) @IsString() @MaxLength(40) serial: string;
  @ApiProperty({ description: '활성화코드(원문)' }) @IsString() @MaxLength(20) activationCode: string;
  @ApiProperty({ description: '국외이전·약관 동의(L8)' }) @IsBoolean() consent: boolean;

  // 신원(D1: 여권번호 자기기입)
  @ApiProperty({ description: '성(passport family name)' }) @IsString() @MaxLength(100) familyName: string;
  @ApiPropertyOptional({ description: '이름(given name)' }) @IsOptional() @IsString() @MaxLength(100) givenName?: string;
  @ApiProperty({ description: '국적(ISO, 비KR)' }) @IsString() @MaxLength(3) nationality: string;
  @ApiProperty({ description: '여권번호(=로그인ID)' }) @IsString() @MaxLength(20) passportNo: string;
  @ApiProperty({ description: '생년월일(YYYY-MM-DD)' }) @IsDateString() birthDate: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'] }) @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']) gender?: string;
  @ApiPropertyOptional({ description: '연락처(전화)' }) @IsOptional() @IsString() @MaxLength(20) contact?: string;
  @ApiPropertyOptional({ description: '이메일' }) @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ description: '선호언어' }) @IsOptional() @IsString() @MaxLength(10) lang?: string;

  // 포털 계정
  @ApiProperty({ description: '비밀번호(8자+)' }) @IsString() @MinLength(8) @MaxLength(72) password: string;
  @ApiPropertyOptional({ description: 'PIN(6자리)' }) @IsOptional() @IsString() @Matches(/^\d{6}$/) pin?: string;
}
