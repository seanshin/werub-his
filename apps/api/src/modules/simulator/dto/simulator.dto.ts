import {
  IsString, IsOptional, IsNotEmpty, IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 시뮬레이션 시작 ──

export class StartSimulatorDto {
  @ApiPropertyOptional({ description: '시뮬레이션 속도 배수' })
  @IsOptional()
  @IsNumber()
  speed?: number;

  @ApiPropertyOptional({ description: '시작 시각 (ISO)' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ description: '종료 시각 (ISO)' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ description: '환자 발생률' })
  @IsOptional()
  @IsNumber()
  patientRate?: number;

  @ApiPropertyOptional({ description: '응급 발생률' })
  @IsOptional()
  @IsNumber()
  emergencyRate?: number;

  @ApiPropertyOptional({ description: '목표 외래 환자 수(기간 내 도착) — durationMinutes와 함께 patientRate 산출' })
  @IsOptional()
  @IsNumber()
  patientCount?: number;

  @ApiPropertyOptional({ description: '시뮬 기간(분) — 종료=시작+기간' })
  @IsOptional()
  @IsNumber()
  durationMinutes?: number;
}

// ── 속도 변경 ──

export class SetSpeedDto {
  @ApiProperty({ description: '시뮬레이션 속도 배수' })
  @IsNumber()
  speed: number;
}

// ── 이벤트 수동 주입 ──

export class InjectEventDto {
  @ApiProperty({ description: '이벤트 유형 (emergency 등)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: '중증도 (KTAS 1-5)' })
  @IsOptional()
  @IsString()
  triageLevel?: string;

  @ApiPropertyOptional({ description: '주호소' })
  @IsOptional()
  @IsString()
  complaint?: string;
}
