import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * 원무 창구 동의 쓰기 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 ValidationPipe 가 통째로 건너뛰었다.
 *  - `signMethod` 를 **본문이 정했다** — 창구 경로에서 `BLOCKCHAIN` 같은 일어나지 않은 서명 방식을 기록할 수 있었고,
 *    개별 수정 EP 는 본문이 비면 `PORTAL`(환자 포털 서명)로 적었다(창구에서 한 일을 포털 서명이라 기록).
 *    이제 창구 두 EP 는 서명 방식을 받지 않는다 — 컨트롤러가 `HIS` 로 정한다(T2 포털 경로와 같은 원칙: 방식은 서버가 정한다).
 *  - `agreed` 에 문자열 `"false"` 가 오면 동의로 저장됐다.
 * `signedBy` 는 서명한 사람(환자·보호자)의 이름이라 본문에서 받는다(행위자 계정이 아니다 — 수집 직원은 `collectedBy` 로 서버가 남긴다).
 */
export const HIS_CONSENT_SIGN_METHOD = 'HIS' as const;

export class RegistrationConsentItemDto {
  @ApiProperty({ description: '동의 유형(서비스 CONSENT_TYPES — 모르는 유형은 서비스가 건너뛴다)' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty() @IsBoolean() agreed!: boolean;
  @ApiPropertyOptional({ description: '서명한 사람 이름(환자·보호자)' }) @IsOptional() @IsString() signedBy?: string;
  @ApiPropertyOptional({ description: '서명 이미지(data URL 등)' }) @IsOptional() @IsString() signatureData?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guardianName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guardianRelation?: string;
}

export class CreateRegistrationConsentsDto {
  @ApiProperty({ type: [RegistrationConsentItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RegistrationConsentItemDto)
  consents!: RegistrationConsentItemDto[];
}

export class UpdateRegistrationConsentDto {
  @ApiProperty() @IsBoolean() agreed!: boolean;
  @ApiPropertyOptional({ description: '서명한 사람 이름(환자·보호자)' }) @IsOptional() @IsString() signedBy?: string;
  @ApiPropertyOptional({ description: '서명 이미지(data URL 등)' }) @IsOptional() @IsString() signatureData?: string;
}
