import {
  IsString, IsOptional, IsNumber, IsUUID, IsNotEmpty, IsBoolean, IsEnum, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 안과 검사 기록 ──

export class CreateOphthalmologyExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '나안시력 OD' })
  @IsOptional()
  @IsString()
  vaOdUncorrected?: string;

  @ApiPropertyOptional({ description: '나안시력 OS' })
  @IsOptional()
  @IsString()
  vaOsUncorrected?: string;

  @ApiPropertyOptional({ description: '교정시력 OD' })
  @IsOptional()
  @IsString()
  vaOdCorrected?: string;

  @ApiPropertyOptional({ description: '교정시력 OS' })
  @IsOptional()
  @IsString()
  vaOsCorrected?: string;

  @ApiPropertyOptional({ description: '굴절검사 OD' })
  @IsOptional()
  refractionOd?: unknown;

  @ApiPropertyOptional({ description: '굴절검사 OS' })
  @IsOptional()
  refractionOs?: unknown;

  @ApiPropertyOptional({ description: '안압 OD (mmHg)' })
  @IsOptional()
  @IsNumber()
  iopOd?: number;

  @ApiPropertyOptional({ description: '안압 OS (mmHg)' })
  @IsOptional()
  @IsNumber()
  iopOs?: number;

  @ApiPropertyOptional({ description: '안압 측정법' })
  @IsOptional()
  @IsString()
  iopMethod?: string;

  @ApiPropertyOptional({ description: '동공 OD' })
  @IsOptional()
  @IsString()
  pupilOd?: string;

  @ApiPropertyOptional({ description: '동공 OS' })
  @IsOptional()
  @IsString()
  pupilOs?: string;

  @ApiPropertyOptional({ description: 'RAPD 여부' })
  @IsOptional()
  @IsBoolean()
  rapd?: boolean;

  @ApiPropertyOptional({ description: '세극등 OD' })
  @IsOptional()
  slitLampOd?: unknown;

  @ApiPropertyOptional({ description: '세극등 OS' })
  @IsOptional()
  slitLampOs?: unknown;

  @ApiPropertyOptional({ description: '안저 OD' })
  @IsOptional()
  fundusOd?: unknown;

  @ApiPropertyOptional({ description: '안저 OS' })
  @IsOptional()
  fundusOs?: unknown;

  @ApiPropertyOptional({ description: '안저 이미지 URL' })
  @IsOptional()
  @IsString()
  fundusImageUrl?: string;

  @ApiPropertyOptional({ description: 'OCT OD' })
  @IsOptional()
  octOd?: unknown;

  @ApiPropertyOptional({ description: 'OCT OS' })
  @IsOptional()
  octOs?: unknown;

  @ApiPropertyOptional({ description: 'OCT 이미지 URL' })
  @IsOptional()
  @IsString()
  octImageUrl?: string;

  @ApiPropertyOptional({ description: '시야검사 OD' })
  @IsOptional()
  vfOd?: unknown;

  @ApiPropertyOptional({ description: '시야검사 OS' })
  @IsOptional()
  vfOs?: unknown;

  @ApiPropertyOptional({ description: '시야검사 이미지 URL' })
  @IsOptional()
  @IsString()
  vfImageUrl?: string;

  @ApiPropertyOptional({ description: '진단' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: '계획' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 안과 수술 기록 ──

export class CreateOphthalmologySurgeryDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '수술 ID' })
  @IsOptional()
  @IsUUID()
  surgeryId?: string;

  @ApiProperty({ description: '눈 (OD 우안·OS 좌안·OU 양안)', enum: ['OD', 'OS', 'OU'] })
  @IsIn(['OD', 'OS', 'OU']) // 오부위(wrong-eye) 방지 — 자유문자열 오타 차단
  eye: string;

  @ApiProperty({ description: '수술명' })
  @IsString()
  @IsNotEmpty()
  procedure: string;

  @ApiPropertyOptional({ description: 'IOL 모델' })
  @IsOptional()
  @IsString()
  iolModel?: string;

  @ApiPropertyOptional({ description: 'IOL 도수' })
  @IsOptional()
  @IsString()
  iolPower?: string;

  @ApiPropertyOptional({ description: '레이저 파라미터' })
  @IsOptional()
  laserParams?: unknown;

  @ApiPropertyOptional({ description: '수술 전 시력' })
  @IsOptional()
  @IsString()
  preOpVa?: string;

  @ApiPropertyOptional({ description: '수술 후 시력' })
  @IsOptional()
  @IsString()
  postOpVa?: string;

  @ApiPropertyOptional({ description: '합병증' })
  @IsOptional()
  @IsString()
  complications?: string;
}

// ── 안경 처방전 ──

export class PrescribeGlassesDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '굴절검사 OD' })
  @IsNotEmpty()
  refractionOd: unknown;

  @ApiProperty({ description: '굴절검사 OS' })
  @IsNotEmpty()
  refractionOs: unknown;

  @ApiPropertyOptional({ description: 'PD OD (mm)' })
  @IsOptional()
  @IsNumber()
  pdOd?: number;

  @ApiPropertyOptional({ description: 'PD OS (mm)' })
  @IsOptional()
  @IsNumber()
  pdOs?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 콘택트렌즈 처방 ──

export class PrescribeContactsDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '굴절검사 OD' })
  @IsNotEmpty()
  refractionOd: unknown;

  @ApiProperty({ description: '굴절검사 OS' })
  @IsNotEmpty()
  refractionOs: unknown;

  @ApiPropertyOptional({ description: '베이스 커브' })
  @IsOptional()
  @IsString()
  baseCurve?: string;

  @ApiPropertyOptional({ description: '직경' })
  @IsOptional()
  @IsString()
  diameter?: string;

  @ApiPropertyOptional({ description: '브랜드' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 안경/콘택트 처방전 생성 ──

export class CreatePrescriptionDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '처방 유형 (GLASSES, CONTACTS)' })
  @IsString()
  @IsNotEmpty()
  prescriptionType: string;

  @ApiPropertyOptional({ description: 'OD Sphere' })
  @IsOptional()
  @IsNumber()
  odSphere?: number;

  @ApiPropertyOptional({ description: 'OD Cylinder' })
  @IsOptional()
  @IsNumber()
  odCylinder?: number;

  @ApiPropertyOptional({ description: 'OD Axis' })
  @IsOptional()
  @IsNumber()
  odAxis?: number;

  @ApiPropertyOptional({ description: 'OD Add' })
  @IsOptional()
  @IsNumber()
  odAdd?: number;

  @ApiPropertyOptional({ description: 'OS Sphere' })
  @IsOptional()
  @IsNumber()
  osSphere?: number;

  @ApiPropertyOptional({ description: 'OS Cylinder' })
  @IsOptional()
  @IsNumber()
  osCylinder?: number;

  @ApiPropertyOptional({ description: 'OS Axis' })
  @IsOptional()
  @IsNumber()
  osAxis?: number;

  @ApiPropertyOptional({ description: 'OS Add' })
  @IsOptional()
  @IsNumber()
  osAdd?: number;

  @ApiPropertyOptional({ description: 'PD (mm)' })
  @IsOptional()
  @IsNumber()
  pd?: number;

  @ApiPropertyOptional({ description: '베이스 커브' })
  @IsOptional()
  @IsNumber()
  baseCurve?: number;

  @ApiPropertyOptional({ description: '직경' })
  @IsOptional()
  @IsNumber()
  diameter?: number;

  @ApiPropertyOptional({ description: '브랜드' })
  @IsOptional()
  @IsString()
  brand?: string;
}

// ── 안저 사진 업로드 ──

export class UploadFundusPhotoDto {
  @ApiProperty({ description: '검사 ID' })
  @IsUUID()
  examId: string;

  @ApiProperty({ description: '눈 (OD, OS)', enum: ['OD', 'OS'] })
  @IsEnum(['OD', 'OS'])
  eye: 'OD' | 'OS';

  @ApiProperty({ description: '사진 URL' })
  @IsString()
  @IsNotEmpty()
  photoUrl: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;
}
