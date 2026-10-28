import {
  IsString, IsOptional, IsNotEmpty, IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 투약 완료 기록 ──

export class AdministerMedicationDto {
  @ApiProperty({ description: '투약자 ID' })
  @IsString()
  @IsNotEmpty()
  administeredBy: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── AI 당직 자동 배정 ──

export class AutoAssignDutyDto {
  @ApiProperty({ description: '대상 월 (YYYY-MM)' })
  @IsString()
  @IsNotEmpty()
  month: string;
}

// ── 당직 교대 요청 ──

export class RequestDutySwapDto {
  @ApiProperty({ description: '요청자 ID' })
  @IsString()
  @IsNotEmpty()
  requesterId: string;

  @ApiProperty({ description: '대상자 ID' })
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @ApiProperty({ description: '원래 근무일' })
  @IsString()
  @IsNotEmpty()
  originalDate: string;

  @ApiProperty({ description: '원래 근무조' })
  @IsString()
  @IsNotEmpty()
  originalShift: string;

  @ApiProperty({ description: '교대 희망일' })
  @IsString()
  @IsNotEmpty()
  swapDate: string;

  @ApiProperty({ description: '교대 희망 근무조' })
  @IsString()
  @IsNotEmpty()
  swapShift: string;

  @ApiProperty({ description: '사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

// ── 알림 확인/대응 ──

export class AcknowledgeAlertDto {
  @ApiProperty({ description: '확인자 ID' })
  @IsString()
  @IsNotEmpty()
  acknowledgedBy: string;

  @ApiProperty({ description: '대응 조치' })
  @IsString()
  @IsNotEmpty()
  action: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 번호표 발급 ──

export class IssueTicketDto {
  @ApiProperty({ description: '진료과 ID' })
  @IsString()
  @IsNotEmpty()
  departmentId: string;

  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '방문 유형' })
  @IsString()
  @IsNotEmpty()
  visitType: string;
}

// ── 인수인계 환자 항목 ──

export class HandoffPatientDto {
  @ApiProperty({ description: '환자 ID (예: p-P2026-0001)' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '인수인계 메모' })
  @IsString()
  notes: string;

  @ApiPropertyOptional({ description: '알림 목록' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  alerts?: string[];

  @ApiPropertyOptional({ description: '우선순위 (high, medium, low)' })
  @IsOptional()
  @IsString()
  priority?: string;
}

// ── 인수인계 제출 ──

export class SubmitHandoffDto {
  @ApiProperty({ description: '병동 ID' })
  @IsString()
  @IsNotEmpty()
  wardId: string;

  @ApiProperty({ description: '근무 교대 (day, night 등)' })
  @IsString()
  @IsNotEmpty()
  shift: string;

  @ApiProperty({ description: '인수인계 시간 (ISO 8601)' })
  @IsString()
  @IsNotEmpty()
  handoffTime: string;

  @ApiProperty({ description: '인계자 간호사 ID' })
  @IsString()
  @IsNotEmpty()
  fromNurseId: string;

  @ApiProperty({ description: '인수자 간호사 ID' })
  @IsString()
  @IsNotEmpty()
  toNurseId: string;

  @ApiProperty({ description: '환자별 인수인계 내용', type: [HandoffPatientDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HandoffPatientDto)
  patients: HandoffPatientDto[];

  @ApiPropertyOptional({ description: '전체 메모' })
  @IsOptional()
  @IsString()
  generalNotes?: string;
}
