import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** CRM 예약 대행 — 🔴 (2026-09-14) 종전 인라인 `@Body` 라 ValidationPipe 가 통째로 스킵됐다 */
export class CrmProxyCreateAppointmentDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsUUID() doctorId!: string;
  @ApiProperty({ description: 'ISO8601' }) @IsISO8601() scheduledAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CrmProxyRescheduleDto {
  @ApiProperty({ description: 'ISO8601' }) @IsISO8601() scheduledAt!: string;
}

export class CrmProxyCancelDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) cancelReason!: string;
}
