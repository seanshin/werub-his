import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min, Max, Matches, MaxLength, MinLength, IsEmail, IsDateString, IsObject, IsArray, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDistributorDto {
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiPropertyOptional({ description: '상위 딜러(계층)' }) @IsOptional() @IsUUID() parentId?: string;
  @ApiProperty({ enum: ['MASTER', 'AGENT'] }) @IsIn(['MASTER', 'AGENT']) tier: string;
  @ApiProperty({ enum: ['DOMESTIC', 'OVERSEAS'], description: '국내 유치업자 | 해외 딜러' }) @IsIn(['DOMESTIC', 'OVERSEAS']) dealerType: string;
  @ApiPropertyOptional({ description: 'ISO 국가 2자 (DOMESTIC=KR 강제)' }) @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional({ description: 'ISO 통화 3자 (DOMESTIC=KRW 강제)' }) @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional({ description: '유치업 등록번호(L3) — DOMESTIC 필수' }) @IsOptional() @IsString() @MaxLength(80) licenseNumber?: string;
  @ApiPropertyOptional({ description: '병원 제휴계약 참조 — OVERSEAS 필수(한국 유치업 등록 면제)' }) @IsOptional() @IsString() @MaxLength(120) contractRef?: string;
  @ApiPropertyOptional({ description: '사업자번호(국내)/TIN(해외) — ERP 원천징수·세금계산서' }) @IsOptional() @IsString() @MaxLength(40) taxId?: string;
  @ApiPropertyOptional({ description: '송금정보(국내 계좌 / 해외 SWIFT·IBAN) — ERP AP 지급', type: Object }) @IsOptional() @IsObject() bankInfo?: Record<string, unknown>;
  @ApiPropertyOptional({ description: '등록/계약 만료' }) @IsOptional() @IsDateString() licenseExpiry?: string;
  @ApiProperty({ description: '수수료율(%)' }) @IsInt() @Min(0) @Max(100) commissionRate: number;
  // 포털 계정 — email 필수, password 선택(생략 시 시스템 랜덤 비번 + 인증코드 이메일 → 딜러가 등록)
  @ApiProperty() @IsEmail() email: string;
  @ApiPropertyOptional({ description: '생략 시 인증코드 이메일로 딜러가 직접 비밀번호 등록' }) @IsOptional() @IsString() @MinLength(8) @MaxLength(72) password?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5) locale?: string;
}

export class SetDistributorStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'] }) @IsIn(['ACTIVE', 'SUSPENDED', 'TERMINATED']) status: string;
}

export class AllocateDto {
  @ApiProperty() @IsUUID() toDistributorId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) quantity: number;
  @ApiProperty({ description: '공급단가(원)' }) @IsInt() @Min(0) supplyPrice: number;
  @ApiPropertyOptional({ description: '선결제 결제 ref(prepaymentRequired 시 필수)' }) @IsOptional() @IsString() @MaxLength(80) paymentRef?: string;
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey: string;
}

export class SellDto {
  @ApiProperty() @IsString() @MaxLength(40) serial: string;
  @ApiProperty({ enum: ['PATIENT', 'DISTRIBUTOR'] }) @IsIn(['PATIENT', 'DISTRIBUTOR']) buyerType: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() buyerId?: string;
  @ApiPropertyOptional({ description: '구매자(외국인환자) 이름' }) @IsOptional() @IsString() @MaxLength(120) buyerName?: string;
  @ApiPropertyOptional({ description: '연락처/이메일' }) @IsOptional() @IsString() @MaxLength(120) buyerContact?: string;
  @ApiProperty({ description: '판매가(외화)' }) @IsInt() @Min(0) salePrice: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) paymentRef?: string;
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey: string;
}

export class DistributorLoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(72) password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(72) oldPassword: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(72) newPassword: string;
}

// 딜러 정보 수정(관리자) — 구조 필드(email/dealerType/tier) 제외, 변경분만 감사
export class UpdateDealerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ description: '수수료율(%)' }) @IsOptional() @IsInt() @Min(0) @Max(100) commissionRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @ApiPropertyOptional({ description: '국내=유치업 등록번호' }) @IsOptional() @IsString() @MaxLength(100) licenseNumber?: string;
  @ApiPropertyOptional({ description: '해외=제휴계약 참조' }) @IsOptional() @IsString() @MaxLength(100) contractRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() licenseExpiry?: string;
  @ApiPropertyOptional({ description: '은행/송금 정보' }) @IsOptional() @IsObject() bankInfo?: Record<string, unknown>;
}

// 딜러 초기설정(무인증) — 이메일로 받은 인증코드로 비밀번호 등록
export class SetupAccountDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(20) code: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class MfaLoginDto {
  @ApiProperty() @IsString() @MaxLength(800) mfaToken: string;
  @ApiProperty() @IsString() @MaxLength(6) code: string;
}

export class MfaCodeDto {
  @ApiProperty() @IsString() @MaxLength(6) code: string;
}

/**
 * 🔴 (2026-09-15 B10) 발행 배치 딜러 발송 — 인라인 본문이었다.
 *    `supplyPrice` 음수·소수가 그대로 배분 원장(`voucher_allocations.supply_price`)과 **해시 체인 원장 페이로드**에 박혔다
 *    (append-only 라 지울 수 없다). 같은 금액 필드의 정본 규칙 `AllocateDto`(정수·0 이상)와 맞춘다.
 *    받는 이메일은 활성화코드(판매 게이트 해제 비밀)가 나가는 곳이라 형식을 본다.
 */
export class SendBatchToDealerDto {
  @ApiProperty() @IsUUID() distributorId: string;
  @ApiPropertyOptional({ description: '공급단가(원) — 미지정 0' }) @IsOptional() @IsInt() @Min(0) supplyPrice?: number;
  @ApiPropertyOptional({ description: '미지정 시 딜러 계정 이메일' }) @IsOptional() @IsEmail() @MaxLength(200) recipientEmail?: string;
  // 🔴 AllocateDto 의 64자를 그대로 쓰면 안 된다 — 화면 키가 `send-<batchId>-<dealerId>`(uuid 둘 = 78자)라 **발송이 전부 400** 이 된다
  //    (계약 스펙이 잡았다). 컬럼은 길이 제한 없는 unique text — 화면 모양을 담는 상한만 둔다.
  @ApiProperty() @IsString() @MaxLength(128) idempotencyKey: string;
}

/**
 * (2026-09-15 B10) 딜러 수령확인 — 인라인 본문이었다. 배열이 아니면(문자열 한 줄) 서비스가 **글자 단위로** 코드 조회를 돌았다.
 * 코드 1건당 조회 1회라 상한을 둔다(수령확인 대기 목록 상한 1000 과 같게).
 */
export class ConfirmReceiptDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  activationCodes: string[];
}
