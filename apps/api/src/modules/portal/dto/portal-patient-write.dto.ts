import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 B6) 환자 포털 쓰기 10 핸들러가 인라인 본문(`{ ... }`)이라 ValidationPipe 가 통째로 스킵됐다.
 *  - 접수 동의서 서명은 본문을 `{ ...body }` 로 서비스에 펼쳤다 — 환자가 **`ipAddress`(서명 증빙)를 본문으로 지정**할 수 있었다.
 *  - 문진표 제출의 컨트롤러 타입은 `{appointmentId, responses}` 였지만 서비스·모바일 앱은 `{tokenId, formSchemaId, responses}` 를 쓴다
 *    (타입이 거짓이었다 — DTO 는 실제 소비 키로 만든다. 그렇지 않으면 whitelist 가 tokenId 를 지워 제출이 400 이 된다).
 *  - 평점은 스키마 `Int` — 소수·문자열은 종전 Prisma 500 · 화면 선택지 1~5.
 * 화면(web 포털·모바일)이 보내는 키를 기계 대조했다(`test/architecture/portal-patient-write-dto-contract.spec.ts`).
 */

/** 자가측정 — 허용 지표 목록은 컨트롤러 `ALLOWED` 가 정본(여기서 중복하지 않는다) */
export class RecordSmbgDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() value!: number;
  @ApiPropertyOptional({ description: 'ISO8601' }) @IsOptional() @IsISO8601() measuredAt?: string;
}

export class PortalSelfCheckInDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) departmentName!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) visitType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

/**
 * 접수 동의서 전자서명 — `ipAddress` 는 받지 않는다(증빙은 서버가 남긴다 — 컨트롤러가 요청 IP 를 기록).
 * `signMethod`·`blockchainSignature` 는 옛 화면 호환으로 받기만 하고 **쓰지 않는다** — 방식은 서버가 `PORTAL` 로 정한다
 * (환자용 블록체인 서명 경로가 없다 · `registration-consent/consent-sign-evidence.ts`).
 */
export class PortalSignRegistrationConsentDto {
  @ApiProperty({ description: '서명자 이름' }) @IsString() @IsNotEmpty() @MaxLength(100) signedBy!: string;
  @ApiPropertyOptional({ description: '무시됨 — 서버가 PORTAL 로 기록' }) @IsOptional() @IsString() @MaxLength(20) signMethod?: string;
  @ApiPropertyOptional({ description: 'Base64 서명 이미지' }) @IsOptional() @IsString() signatureData?: string;
  @ApiPropertyOptional({ description: '무시됨 — 옛 화면 호환(서비스 미저장)' }) @IsOptional() @IsObject() blockchainSignature?: Record<string, unknown>;
}

export class PortalRevokeRegistrationConsentDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) reason!: string;
}

export class PortalCheckupQuestionnaireDto {
  @ApiProperty() @IsUUID() questionnaireId!: string;
  @ApiProperty({ description: '문항 응답(JSON)' }) @IsObject() answers!: Record<string, unknown>;
}

export class PortalTelehealthMessageDto {
  @ApiProperty() @IsString() @IsNotEmpty() message!: string;
}

export class PortalTelehealthRateDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() feedback?: string;
}

export class PortalTelehealthBookDto {
  @ApiProperty() @IsUUID() doctorId!: string;
  @ApiProperty({ description: 'ISO8601' }) @IsISO8601() scheduledAt!: string;
  @ApiProperty({ description: 'VIDEO · AUDIO · ASYNC(스키마 주석)' }) @IsIn(['VIDEO', 'AUDIO', 'ASYNC']) sessionType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() chiefComplaint?: string;
}

export class PortalAiAskDto {
  @ApiProperty() @IsString() @IsNotEmpty() question!: string;
}

/** 문진표 제출 — 토큰 기반(tokenId) 또는 직접(formSchemaId) · 둘 다 없으면 서비스가 400 */
export class PortalSubmitQuestionnaireDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() tokenId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() formSchemaId?: string;
  @ApiProperty() @IsObject() responses!: Record<string, unknown>;
}
