import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 T2) 마약류 처방 원장 — 종전 `@Body() data: Record<string, unknown>` 라 수량이 문자열·음수여도,
 * 스키마 VarChar 를 넘는 값이어도 검증 없이 Prisma 로 갔다(길이 초과는 500).
 * 길이는 `ControlledSubstanceLog` 스키마 VarChar 그대로다.
 */
export class PrescribeControlledSubstanceDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiPropertyOptional({ description: 'CPOE 처방 링크' }) @IsOptional() @IsUUID() prescriptionId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) drugName!: string;
  @ApiPropertyOptional({ description: 'EDI 코드' }) @IsOptional() @IsString() @MaxLength(30) drugCode?: string;
  @ApiProperty({ description: 'I~V' }) @IsString() @IsNotEmpty() @MaxLength(10) deaSchedule!: string;
  @ApiPropertyOptional({ description: 'NARCOTIC·PSYCHOTROPIC·CANNABIS' }) @IsOptional() @IsString() @MaxLength(20) narcoticType?: string;
  @ApiPropertyOptional({ description: '향정 가·나·다·라' }) @IsOptional() @IsString() @MaxLength(4) psychotropicGroup?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @IsPositive() quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) unit!: string;
  /** 🔴 처방자를 본문으로 받는 계약은 그대로다(인증 사용자로 강제하는 것은 권한 설계 변경 — 보고만) */
  @ApiProperty() @IsUUID() prescribedBy!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

/** 조제/불출 — 종전 `@Body('scanCode')` 원시값 추출은 파이프를 스킵했다 */
export class DispenseControlledSubstanceDto {
  @ApiPropertyOptional({ description: '바코드 스캔 값(있으면 약품 대조)' }) @IsOptional() @IsString() scanCode?: string;
}
