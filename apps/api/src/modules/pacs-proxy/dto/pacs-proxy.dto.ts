import {
  IsString, IsOptional, IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Worklist 항목 생성 ──

export class CreateWorklistItemDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patient_id: string;

  @ApiProperty({ description: '환자명' })
  @IsString()
  @IsNotEmpty()
  patient_name: string;

  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accession_number: string;

  @ApiProperty({ description: '모달리티 (CT, MR, DR 등)' })
  @IsString()
  @IsNotEmpty()
  modality: string;

  @ApiPropertyOptional({ description: '예약 일시' })
  @IsOptional()
  @IsString()
  scheduled_date?: string;

  @ApiPropertyOptional({ description: '의뢰 의사' })
  @IsOptional()
  @IsString()
  referring_physician?: string;

  @ApiPropertyOptional({ description: '검사 설명' })
  @IsOptional()
  @IsString()
  requested_procedure_description?: string;
}

// ── 영상 오더 생성 ──

export class CreatePacsOrderDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patient_id: string;

  @ApiProperty({ description: '환자명' })
  @IsString()
  @IsNotEmpty()
  patient_name: string;

  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accession_number: string;

  @ApiProperty({ description: 'Requested Procedure ID' })
  @IsString()
  @IsNotEmpty()
  requested_procedure_id: string;

  @ApiProperty({ description: '검사 설명' })
  @IsString()
  @IsNotEmpty()
  requested_procedure_description: string;

  @ApiProperty({ description: '모달리티 (CT, MR, DR 등)' })
  @IsString()
  @IsNotEmpty()
  modality: string;

  @ApiProperty({ description: '예약 일시' })
  @IsString()
  @IsNotEmpty()
  scheduled_date: string;

  @ApiProperty({ description: '의뢰 의사' })
  @IsString()
  @IsNotEmpty()
  referring_physician: string;

  @ApiPropertyOptional({ description: '임상 정보' })
  @IsOptional()
  @IsString()
  clinical_info?: string;

  @ApiPropertyOptional({ description: '우선순위 (ROUTINE, URGENT, STAT)' })
  @IsOptional()
  @IsString()
  priority?: string;
}

// ── 판독 리포트 생성 ──

export class CreatePacsReportDto {
  @ApiProperty({ description: 'Study Instance UID' })
  @IsString()
  @IsNotEmpty()
  study_instance_uid: string;

  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patient_id: string;

  @ApiPropertyOptional({ description: '판독 소견' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ description: '판독 결론' })
  @IsOptional()
  @IsString()
  conclusion?: string;

  @ApiPropertyOptional({ description: '판독 의사 ID' })
  @IsOptional()
  @IsString()
  radiologist_id?: string;
}

// ── 판독 리포트 수정 ──

export class UpdatePacsReportDto {
  @ApiPropertyOptional({ description: '판독 소견' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ description: '판독 결론' })
  @IsOptional()
  @IsString()
  conclusion?: string;

  @ApiPropertyOptional({ description: '리포트 상태' })
  @IsOptional()
  @IsString()
  status?: string;
}

// ── AI 추론 요청 ──

export class RequestAiInferenceDto {
  @ApiProperty({ description: 'Study Instance UID' })
  @IsString()
  @IsNotEmpty()
  study_instance_uid: string;

  @ApiProperty({ description: 'AI 모델 ID' })
  @IsString()
  @IsNotEmpty()
  model_id: string;

  @ApiPropertyOptional({ description: '우선순위 (normal, high)' })
  @IsOptional()
  @IsString()
  priority?: string;
}

// ── HIS Integration DTOs ──

export class RetakeRequestDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accessionNumber: string;

  @ApiProperty({ description: '재촬영 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: '우선순위 (ROUTINE, URGENT, STAT)' })
  @IsOptional()
  @IsString()
  priority?: string;
}

export class CancelOrderDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accessionNumber: string;

  @ApiProperty({ description: '취소 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AdditionalViewDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accessionNumber: string;

  @ApiProperty({ description: '추가 촬영 유형 (LATERAL, OBLIQUE 등)' })
  @IsString()
  @IsNotEmpty()
  viewType: string;

  @ApiPropertyOptional({ description: '추가 촬영 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UrgentReadingDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accessionNumber: string;

  @ApiProperty({ description: '긴급 판독 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: '임상 정보' })
  @IsOptional()
  @IsString()
  clinicalInfo?: string;
}

export class PatientUpdateDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ description: '환자명' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '생년월일 (YYYYMMDD)' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: '성별 (M, F, O)' })
  @IsOptional()
  @IsString()
  gender?: string;
}

export class ClinicalInfoDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accessionNumber: string;

  @ApiPropertyOptional({ description: '병력' })
  @IsOptional()
  @IsString()
  history?: string;

  @ApiPropertyOptional({ description: '증상' })
  @IsOptional()
  @IsString()
  symptoms?: string;

  @ApiPropertyOptional({ description: '검사 결과' })
  @IsOptional()
  @IsString()
  labs?: string;

  @ApiPropertyOptional({ description: '복용 약물' })
  @IsOptional()
  @IsString()
  medications?: string;

  @ApiPropertyOptional({ description: '알레르기' })
  @IsOptional()
  @IsString()
  allergies?: string;
}

export class ScheduleChangeDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @IsNotEmpty()
  accessionNumber: string;

  @ApiProperty({ description: '변경 일시 (ISO 8601)' })
  @IsString()
  @IsNotEmpty()
  newDateTime: string;

  @ApiPropertyOptional({ description: '변경 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}
