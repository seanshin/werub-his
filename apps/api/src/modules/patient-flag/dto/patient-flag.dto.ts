import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 U4) 인라인 `@Body` 라 검증이 없었고, 서비스가 마킹 사유를 `slice(0, 1000)` 으로 **조용히 잘랐다**(컬럼은 Text).
 *    환자 안전 마킹 근거라 자르지 않고 1000자 초과를 400 으로 알린다(화면 ReasonInput maxLength 동반).
 *    유형 어휘(MALICIOUS·VIP·ACQUAINTANCE) 판정은 서비스가 맡는다 — 길이만 스키마(VarChar 20·30) 근거.
 */
export class CreatePatientFlagDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsString() @MaxLength(20) flagType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000, { message: '마킹 사유는 1000자 이내로 입력하세요' }) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() relatedUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) relation?: string;
}
