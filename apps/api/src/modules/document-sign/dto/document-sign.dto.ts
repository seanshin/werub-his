import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 B7) 문서 서명 3 핸들러가 `Record<string, unknown>`·`@Body('signedDocumentId')` 원시 추출이었다.
 *  - 서명자(`signerUserId`)·서명 증빙(`ipAddress`·`userAgent`)을 **본문이 정했다** → 남의 이름·위조 IP 로 서명 행이 남았다.
 *    이제 DTO 에 없어 지워지고, 서명자는 인증 주체·증빙은 요청 연결에서 온다(컨트롤러).
 *  - 인증서 소유 확인이 없었다 — 남의 인증서 id 로 서명할 수 있었다(서비스가 소유를 대조한다).
 * 길이는 스키마 VarChar 그대로. 문서 종류·서명 역할 어휘는 지어내지 않는다(길이만). 서명자 유형만 스키마 두 값.
 */
export const SIGNER_TYPES = ['STAFF', 'PATIENT'] as const;

export class SignDocumentDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) documentType!: string;
  @ApiProperty() @IsUUID() documentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64) documentHash!: string;
  @ApiProperty() @IsUUID() certificateId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() signatureValue!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) signatureAlgorithm!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) signerRole!: string;
  @ApiProperty({ enum: SIGNER_TYPES }) @IsIn(SIGNER_TYPES) signerType!: (typeof SIGNER_TYPES)[number];
  /** 화면이 보내지만 서버는 쓰지 않는다 — 직원 서명자는 인증 주체다(키를 알아야 whitelist 가 조용히 지우지 않고 대조된다) */
  @ApiPropertyOptional() @IsOptional() @IsUUID() signerUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() signerPatientId?: string;
}

export class VerifySignedDocumentDto {
  @ApiProperty() @IsUUID() signedDocumentId!: string;
}

export class InitMultiSignDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) documentType!: string;
  @ApiProperty() @IsUUID() documentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64) documentHash!: string;
  @ApiProperty() @IsInt() @Min(2) requiredSigners!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) timeoutMinutes?: number;
}
