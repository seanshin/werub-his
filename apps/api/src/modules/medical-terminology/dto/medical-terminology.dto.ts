import { IsString, IsOptional, IsUUID, IsBoolean, IsArray, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============================================================
// Diagnosis Code DTOs
// ============================================================

export class CreateDiagnosisCodeDto {
  @ApiProperty({ description: '코드 시스템 (KCD-8, ICD-10, ICD-11)' })
  @IsString()
  codeSystem: string; // KCD-8, ICD-10, ICD-11

  @ApiProperty({ description: '질병 코드' })
  @IsString()
  code: string;

  @ApiProperty({ description: '한글명' })
  @IsString()
  nameKo: string;

  @ApiPropertyOptional({ description: '영문명' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: '범주' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '챕터' })
  @IsOptional()
  @IsString()
  chapter?: string;

  @ApiPropertyOptional({ description: '상위 코드 (계층)' })
  @IsOptional()
  @IsString()
  parentCode?: string;

  @ApiPropertyOptional({ description: 'ICD-10 코드 매핑' })
  @IsOptional()
  @IsString()
  icd10Code?: string;

  @ApiPropertyOptional({ description: 'ICD-11 코드 매핑' })
  @IsOptional()
  @IsString()
  icd11Code?: string;

  @ApiProperty({ description: '유효 시작일' })
  @IsDateString()
  validFrom: string;

  @ApiPropertyOptional({ description: '유효 종료일' })
  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class UpdateDiagnosisCodeDto {
  @ApiPropertyOptional({ description: '한글명' })
  @IsOptional()
  @IsString()
  nameKo?: string;

  @ApiPropertyOptional({ description: '영문명' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: '범주' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '상위 코드' })
  @IsOptional()
  @IsString()
  parentCode?: string;

  @ApiPropertyOptional({ description: 'ICD-10 매핑' })
  @IsOptional()
  @IsString()
  icd10Code?: string;

  @ApiPropertyOptional({ description: 'ICD-11 매핑' })
  @IsOptional()
  @IsString()
  icd11Code?: string;

  @ApiPropertyOptional({ description: '유효 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '유효 종료일' })
  @IsOptional()
  @IsDateString()
  validTo?: string;
}

// ============================================================
// Medication Code DTOs
// ============================================================

export class CreateMedicationCodeDto {
  @ApiProperty({ description: '약품 코드' })
  @IsString()
  code: string;

  @ApiProperty({ description: '한글명' })
  @IsString()
  nameKo: string;

  @ApiPropertyOptional({ description: '영문명' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: '주성분' })
  @IsOptional()
  @IsString()
  ingredient?: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '제형' })
  @IsOptional()
  @IsString()
  dosageForm?: string;

  @ApiPropertyOptional({ description: '단위' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: '보험 코드' })
  @IsOptional()
  @IsString()
  insuranceCode?: string;

  @ApiPropertyOptional({ description: '단가 (원)' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiProperty({ description: '유효 시작일' })
  @IsDateString()
  validFrom: string;

  @ApiPropertyOptional({ description: '유효 종료일' })
  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class UpdateMedicationCodeDto {
  @ApiPropertyOptional({ description: '한글명' })
  @IsOptional()
  @IsString()
  nameKo?: string;

  @ApiPropertyOptional({ description: '영문명' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: '주성분' })
  @IsOptional()
  @IsString()
  ingredient?: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '제형' })
  @IsOptional()
  @IsString()
  dosageForm?: string;

  @ApiPropertyOptional({ description: '단위' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: '보험 코드' })
  @IsOptional()
  @IsString()
  insuranceCode?: string;

  @ApiPropertyOptional({ description: '단가' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional({ description: '유효 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '유효 종료일' })
  @IsOptional()
  @IsDateString()
  validTo?: string;
}

// ============================================================
// Search & Validation DTOs
// ============================================================

export class SearchCodeDto {
  @ApiPropertyOptional({ description: '검색어 (코드/명)' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '코드 시스템' })
  @IsOptional()
  @IsString()
  codeSystem?: string;

  @ApiPropertyOptional({ description: '범주' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '페이지' })
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ description: '페이지당 결과' })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

export class DrugInteractionCheckDto {
  @ApiProperty({ description: '약품 코드 배열' })
  @IsArray()
  @IsString({ each: true })
  medicationCodes: string[];

  @ApiPropertyOptional({ description: '환자 나이' })
  @IsOptional()
  @IsNumber()
  patientAge?: number;

  @ApiPropertyOptional({ description: '환자 성별' })
  @IsOptional()
  @IsString()
  patientGender?: string;
}

export class DURCheckDto {
  @ApiProperty({ description: '약품 코드' })
  @IsString()
  medicationCode: string;

  @ApiPropertyOptional({ description: '처방 기간 (일)' })
  @IsOptional()
  @IsNumber()
  prescriptionDays?: number;

  @ApiPropertyOptional({ description: '1회 용량' })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiPropertyOptional({ description: '환자 나이' })
  @IsOptional()
  @IsNumber()
  patientAge?: number;

  @ApiPropertyOptional({ description: '신장 기능 (EGFR)' })
  @IsOptional()
  @IsNumber()
  egfr?: number;
}

export class ContraindicationCheckDto {
  @ApiProperty({ description: '약품 코드' })
  @IsString()
  medicationCode: string;

  @ApiProperty({ description: '질병 코드' })
  @IsString()
  diagnosisCode: string;

  @ApiPropertyOptional({ description: '환자 나이' })
  @IsOptional()
  @IsNumber()
  patientAge?: number;

  @ApiPropertyOptional({ description: '임신 여부' })
  @IsOptional()
  @IsBoolean()
  isPregnant?: boolean;
}

// ============================================================
// Response DTOs
// ============================================================

export class InteractionWarningDto {
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CONTRAINDICATED';
  interactingDrug1: string;
  interactingDrug2: string;
  description: string;
  recommendation: string;
}

export class DURWarningDto {
  ruleCode: string;
  ruleName: string;
  severity: 'WARNING' | 'ERROR';
  description: string;
  recommendation: string;
}

export class ValidationResultDto {
  isValid: boolean;
  warnings: (InteractionWarningDto | DURWarningDto | ContraindicationCheckDto)[];
  message?: string;
}
