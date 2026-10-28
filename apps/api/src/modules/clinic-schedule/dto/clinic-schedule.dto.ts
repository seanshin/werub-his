import { IsString, IsNumber, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClinicScheduleDto {
  @ApiProperty({ description: '의사 ID' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: '진료과명' })
  @IsString()
  departmentName: string;

  @ApiProperty({ description: '진료실명' })
  @IsString()
  roomName: string;

  @ApiProperty({ description: '요일 (0=일, 1=월, ...)' })
  @IsNumber()
  dayOfWeek: number;

  @ApiProperty({ description: '시간대 (AM/PM/FULL)' })
  @IsString()
  period: string;

  @ApiProperty({ description: '시작 시간', example: '09:00' })
  @IsString()
  startTime: string;

  @ApiProperty({ description: '종료 시간', example: '12:00' })
  @IsString()
  endTime: string;

  @ApiPropertyOptional({ description: '최대 환자 수' })
  @IsOptional()
  @IsNumber()
  maxPatients?: number;
}

export class UpdateClinicScheduleDto {
  @ApiPropertyOptional({ description: '진료과명' })
  @IsOptional()
  @IsString()
  departmentName?: string;

  @ApiPropertyOptional({ description: '진료실명' })
  @IsOptional()
  @IsString()
  roomName?: string;

  @ApiPropertyOptional({ description: '시작 시간' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ description: '종료 시간' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ description: '최대 환자 수' })
  @IsOptional()
  @IsNumber()
  maxPatients?: number;

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateClinicClosureDto {
  @ApiProperty({ description: '의사 ID' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: '휴진 날짜', example: '2026-01-15' })
  @IsString()
  date: string;

  @ApiPropertyOptional({ description: '시간대 (AM/PM)' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiProperty({ description: '휴진 사유' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ description: '대진 의사 ID' })
  @IsOptional()
  @IsUUID()
  substituteId?: string;
}
