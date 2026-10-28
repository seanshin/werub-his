import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * 🔴 (2026-09-15 B6) 전자인증서 쓰기 8 핸들러가 `Record<string, unknown>`·`@Body('key')` 원시 추출이라 검증이 통째로 스킵됐다.
 *  - 반려·폐기 사유가 비어도 저장됐다(`revokeReason` VarChar(200) — 초과는 Prisma 500).
 *  - PIN 실패/성공·갱신의 `certId`·`publicKey` 가 비면 소유 검증이 Prisma 오류(500)로 떨어졌다.
 *  - 정책 저장(`PUT policy`)은 필드 형을 보지 않고 config 에 그대로 썼다(`pinLength: "abc"` 가 저장된다).
 * 발급(issue)은 명의를 토큰에서만 취한다(W7) — 본문은 공개키·알고리즘뿐.
 */
export class IssueMyCertificateDto {
  /** 정본 키 — 종전 FE 의 `publicKeyPem` 도 흡수한다(P11 호환) */
  @ApiPropertyOptional() @ValidateIf((o: IssueMyCertificateDto) => !o.publicKeyPem) @IsString() @IsNotEmpty() publicKey?: string;
  @ApiPropertyOptional({ deprecated: true }) @IsOptional() @IsString() publicKeyPem?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) algorithm!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) keyCustody?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) attestationRef?: string;
}

/** 반려·폐기 사유 — `BlockchainCertificate.revokeReason` VarChar(200) · 화면은 빈 사유를 보내지 않는다 */
export class CertReasonDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) reason!: string;
}

export class RenewCertificateDto {
  @ApiProperty() @IsString() @IsNotEmpty() publicKey!: string;
}

export class CertPinEventDto {
  @ApiProperty() @IsUUID() certId!: string;
}

/** 관리 화면 정책 저장 — 보낸 필드만 반영(서버 `keyMap` 과 한 벌) */
export class BlockchainCertPolicyDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) allowedAlgorithms?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pinLength?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pinLockAttempts?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pinLockMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pinAutoSuspendAttempts?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) anchorInterval?: string;
  /** config 설명 어휘(manual|auto-verified|auto-email|auto-all)와 화면 선택지가 같다 */
  @ApiPropertyOptional() @IsOptional() @IsIn(['manual', 'auto-verified', 'auto-email', 'auto-all']) patientCertPolicy?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() autoIssuePolicy?: Record<string, boolean>;
}
