import { IsOptional, IsUUID, IsEnum, IsDateString, IsInt, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@prisma/client';

export class AppointmentQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional({ enum: AppointmentStatus }) @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
  @ApiPropertyOptional({ description: '다중 상태(콤마 구분) — 예: SCHEDULED,CONFIRMED' }) @IsOptional() @IsString() statuses?: string;
  @ApiPropertyOptional({ enum: AppointmentType }) @IsOptional() @IsEnum(AppointmentType) type?: AppointmentType;
  @ApiPropertyOptional({ description: 'today 또는 YYYY-MM-DD' }) @IsOptional() @IsString() date?: string;
  @ApiPropertyOptional({ example: '2026-05-06' }) @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional({ example: '2026-05-12' }) @IsOptional() @IsDateString() dateTo?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

export class CalendarQueryDto {
  @ApiPropertyOptional({ enum: ['week', 'month'], default: 'week' })
  @IsOptional()
  @IsString()
  view?: 'week' | 'month' = 'week';

  @ApiPropertyOptional({ description: '기준 날짜 (기본 오늘)', example: '2026-05-06' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() doctorId?: string;

  @ApiPropertyOptional({ description: "'true' 면 취소·노쇼 포함(사후 조회용) — 기본은 활성 예약만(달력 용도)" })
  @IsOptional()
  @IsString()
  includeInactive?: string;
}

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ description: '의사 ID (미지정 시 과 전체)' }) @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional({ description: '진료과' }) @IsOptional() @IsString() departmentName?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD', example: '2026-07-08' }) @IsDateString() date!: string;
  @ApiPropertyOptional({ default: 30, description: '슬롯 단위(분)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) duration?: number = 30;
}
