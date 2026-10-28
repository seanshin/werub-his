import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsNumber, IsBoolean, IsObject, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 병변 기록 ──

export class CreateLesionDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: '병변 위치' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiProperty({ description: '신체 부위' })
  @IsString()
  @IsNotEmpty()
  bodyRegion: string;

  @ApiProperty({ description: '형태학적 분류' })
  @IsString()
  @IsNotEmpty()
  morphology: string;

  @ApiPropertyOptional({ description: '색상' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ description: '크기' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ description: '경계' })
  @IsOptional()
  @IsString()
  border?: string;

  @ApiPropertyOptional({ description: '분포' })
  @IsOptional()
  @IsString()
  distribution?: string;

  @ApiPropertyOptional({ description: '표면' })
  @IsOptional()
  @IsString()
  surface?: string;

  @ApiPropertyOptional({ description: '더모스코피 소견' })
  @IsOptional()
  @IsObject()
  dermoscopy?: unknown;

  @ApiPropertyOptional({ description: 'ABCDE 점수' })
  @IsOptional()
  @IsNumber()
  abcdeScore?: number;

  @ApiPropertyOptional({ description: '사진 URL 목록' })
  @IsOptional()
  @IsArray()
  photoUrls?: unknown;

  @ApiPropertyOptional({ description: '생검 여부' })
  @IsOptional()
  @IsBoolean()
  biopsyTaken?: boolean;

  @ApiPropertyOptional({ description: '생검 결과' })
  @IsOptional()
  @IsString()
  biopsyResult?: string;

  @ApiPropertyOptional({ description: '진단명' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: '진단 코드' })
  @IsOptional()
  @IsString()
  diagnosisCode?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 병변 업데이트 ──

export class UpdateLesionDto {
  @ApiPropertyOptional({ description: '크기' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ description: '진단명' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: '진단 코드' })
  @IsOptional()
  @IsString()
  diagnosisCode?: string;

  @ApiPropertyOptional({ description: '생검 결과' })
  @IsOptional()
  @IsString()
  biopsyResult?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: '사진 URL 목록' })
  @IsOptional()
  @IsArray()
  photoUrls?: unknown;
}

// ── 시술 기록 ──

export class CreateTreatmentDto {
  @ApiPropertyOptional({ description: '병변 ID' })
  @IsOptional()
  @IsUUID()
  lesionId?: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '시술 유형' })
  @IsString()
  @IsNotEmpty()
  treatmentType: string;

  @ApiProperty({ description: '시술명' })
  @IsString()
  @IsNotEmpty()
  procedure: string;

  @ApiPropertyOptional({ description: '시술 부위' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ description: '시술 파라미터' })
  @IsOptional()
  @IsObject()
  parameters?: unknown;

  @ApiPropertyOptional({ description: '사용 약물' })
  @IsOptional()
  @IsString()
  medication?: string;

  @ApiPropertyOptional({ description: '시술 전 사진' })
  @IsOptional()
  @IsString()
  beforePhotoUrl?: string;

  @ApiPropertyOptional({ description: '시술 후 사진' })
  @IsOptional()
  @IsString()
  afterPhotoUrl?: string;

  @ApiPropertyOptional({ description: '합병증' })
  @IsOptional()
  @IsString()
  complications?: string;

  @ApiPropertyOptional({ description: '다음 세션 예정일' })
  @IsOptional()
  @IsString()
  nextSession?: string;
}

// ── 바디맵 ──

export class CreateBodyMapDto {
  @ApiProperty({ description: '부위별 정보' })
  @IsObject()
  regions: unknown;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 병리검사 의뢰 ──

export class SubmitPathologyDto {
  @ApiProperty({ description: '검체 유형' })
  @IsString()
  @IsNotEmpty()
  specimenType: string;

  @ApiProperty({ description: '임상 병력' })
  @IsString()
  @IsNotEmpty()
  clinicalHistory: string;
}

// ── 병리검사 결과 수신 ──

export class ReceivePathologyResultDto {
  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiPropertyOptional({ description: '등급' })
  @IsOptional()
  @IsString()
  grade?: string;

  @ApiPropertyOptional({ description: '절제면' })
  @IsOptional()
  @IsString()
  margins?: string;

  @ApiProperty({ description: '생검 결과' })
  @IsString()
  @IsNotEmpty()
  biopsyResult: string;
}
