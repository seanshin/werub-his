import { IsUUID, IsDateString, IsInt, IsEnum, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentType } from '@prisma/client';

export class CreateAppointmentDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '의사 ID (미지정 + departmentName 시 부하분산 자동배정)' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ description: '진료과 (자동배정·기록용)' })
  @IsOptional()
  @IsString()
  departmentName?: string;

  @ApiPropertyOptional({ description: '예약 경로', enum: ['STAFF', 'PORTAL', 'AI'] })
  @IsOptional()
  @IsString()
  bookedVia?: string;

  @ApiProperty({ example: '2026-05-10T09:00:00Z' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ default: 30, description: '진료 시간(분)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(240)
  duration?: number = 30;

  @ApiProperty({ enum: AppointmentType, default: 'INITIAL' })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiPropertyOptional({ description: '방문 사유' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: '반복 예약 주간 회차(1~12, 매주 동일 시각)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  repeatWeeks?: number;
}
