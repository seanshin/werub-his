import { IsUUID, IsOptional, IsString, IsArray, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class DiagnosisDto {
  @ApiProperty({ description: 'DiagnosisCode ID' })
  @IsUUID()
  diagnosisCodeId: string;

  @ApiPropertyOptional({ enum: ['PRIMARY', 'SECONDARY', 'DIFFERENTIAL'], default: 'PRIMARY', description: '주상병/부상병/감별' })
  @IsOptional()
  @IsIn(['PRIMARY', 'SECONDARY', 'DIFFERENTIAL'])
  type?: string;

  @ApiPropertyOptional({ enum: ['CONFIRMED', 'PROVISIONAL', 'RULE_OUT', 'EXCLUDED'], description: '확정도: 확진/의증/R-O/배제' })
  @IsOptional()
  @IsIn(['CONFIRMED', 'PROVISIONAL', 'RULE_OUT', 'EXCLUDED'])
  certainty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateEncounterDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '예약 ID (walk-in이면 생략)' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiPropertyOptional({ enum: ['OUTPATIENT', 'INPATIENT', 'ER_CONSULT', 'INPATIENT_CONSULT'], description: '진료 유형(생략 시 외래로 취급) — 입원/응급 청구 분기' })
  @IsOptional()
  @IsIn(['OUTPATIENT', 'INPATIENT', 'ER_CONSULT', 'INPATIENT_CONSULT'])
  visitType?: string;

  @ApiPropertyOptional({ description: '입원 ID (INPATIENT 진료기록 연계)' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjective?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  objective?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assessment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ type: [DiagnosisDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagnosisDto)
  diagnoses?: DiagnosisDto[];
}
