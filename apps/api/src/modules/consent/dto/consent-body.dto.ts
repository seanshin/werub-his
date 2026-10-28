import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** 🔴 (2026-09-15 T2) 인라인 @Body → DTO — 종전 ValidationPipe 스킵 */
export class DispatchConsentToDeviceDto {
  @ApiProperty() @IsUUID() consentId!: string;
}

/** 서명 세션 — 길이는 `ConsentSignSession` 스키마 VarChar(20). 기본값(TABLET·PATIENT)은 서비스가 채운다 */
export class CreateConsentSignSessionDto {
  @ApiPropertyOptional({ description: 'TABLET·PC' }) @IsOptional() @IsString() @MaxLength(20) signMode?: string;
  @ApiPropertyOptional({ description: 'PATIENT·GUARDIAN' }) @IsOptional() @IsString() @MaxLength(20) signerType?: string;
}
