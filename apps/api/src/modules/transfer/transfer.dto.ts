import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** 🔴 (2026-09-15 T2) 전원 요청 — 종전 인라인 @Body. 길이는 `TransferRecord` 스키마 VarChar 그대로(초과 시 종전엔 500) */
export class CreateTransferDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsUUID() toOrgId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10) urgency!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) transferType!: string;
}

export class RejectTransferDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
