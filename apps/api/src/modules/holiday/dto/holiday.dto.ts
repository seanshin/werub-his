import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncHolidayDto {
  @ApiPropertyOptional({ description: '동기화 대상 연도' })
  @IsOptional()
  @IsNumber()
  year?: number;
}

export class AddHospitalHolidayDto {
  @ApiProperty({ description: '휴무 날짜', example: '2026-01-01' })
  @IsString()
  date: string;

  @ApiProperty({ description: '휴무명', example: '개원기념일' })
  @IsString()
  name: string;
}
