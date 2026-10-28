import { IsOptional, IsString, IsUUID, IsInt, IsNumber, Min, Max, IsBoolean, IsEnum } from 'class-validator';
import { ShiftType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RecordVitalsDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(300)
  @Type(() => Number)
  systolicBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(200)
  @Type(() => Number)
  diastolicBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  @Type(() => Number)
  heartRate?: number;

  @ApiPropertyOptional({ description: '체온 (°C)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  temperature?: number;

  @ApiPropertyOptional({ description: 'SpO2 (%)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  spo2?: number;

  @ApiPropertyOptional({ description: '체중 (kg)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional({ description: '신장 (cm)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  height?: number;

  @ApiPropertyOptional({ description: '통증 점수 (0-10)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  @Type(() => Number)
  painScore?: number;

  @ApiPropertyOptional({ description: '호흡수 (회/분)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  @Type(() => Number)
  respiratoryRate?: number;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class EducatePatientDto {
  @ApiProperty({ description: '교육 주제' })
  @IsString()
  topic: string;

  @ApiProperty({ description: '교육 내용' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '교육 자료 (파일명/URL)' })
  @IsOptional()
  @IsString()
  materials?: string;
}

export class SkipTaskDto {
  @ApiProperty({ description: '건너뛰기 사유' })
  @IsString()
  reason: string;
}

/**
 * 🔴 (2026-09-15 B10) 담당환자 배정 — 인라인 본문이었다.
 *  - `isPrimary: "false"`(문자열)·`shiftType` 오타·uuid 아닌 id 가 Prisma 까지 가서 500 이었다(Boolean·VarChar(10)·Uuid 컬럼).
 *  - 근무조 어휘는 스키마 enum `ShiftType`(DAY·EVENING·NIGHT) 정본 그대로. 배정자(`assignedBy`)는 본문이 아니라 로그인 사용자다.
 */
export class AssignNursePatientDto {
  @ApiProperty({ description: '배정할 간호사 사용자 ID' })
  @IsUUID()
  nurseId: string;

  @ApiProperty({ description: '입원 ID' })
  @IsUUID()
  admissionId: string;

  @ApiPropertyOptional({ enum: ShiftType })
  @IsOptional()
  @IsEnum(ShiftType)
  shiftType?: ShiftType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** 상번 인수(2026-09-30) — 인수자는 로그인 사용자 */
export class TakeOverAssignmentDto {
  @ApiProperty({ description: '입원 ID' })
  @IsUUID()
  admissionId: string;

  /** 필수 — 기본값(DAY)으로 떨어뜨리지 않는다(야간 인수가 DAY 로 저장되던 배정 결함과 같은 자리) */
  @ApiProperty({ enum: ShiftType, description: '인수하는 근무조(화면이 교대 경계 설정으로 판정)' })
  @IsEnum(ShiftType)
  shiftType: ShiftType;
}
