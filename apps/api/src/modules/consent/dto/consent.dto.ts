import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsEnum, IsObject, IsIn, IsInt, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsentType } from '@prisma/client';

// ── 동의서 생성 ──

export class CreateConsentDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '템플릿명' })
  @IsString()
  @IsNotEmpty()
  templateName: string;

  @ApiProperty({ description: '내용 (JSON)' })
  @IsObject()
  content: Record<string, unknown>;

  @ApiPropertyOptional({ description: '증인 ID' })
  @IsOptional()
  @IsUUID()
  witnessId?: string;

  @ApiPropertyOptional({ description: '템플릿 ID' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ enum: ConsentType, description: '동의 유형' })
  @IsOptional()
  @IsEnum(ConsentType)
  consentType?: ConsentType;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '수술 ID' })
  @IsOptional()
  @IsUUID()
  surgeryId?: string;

  @ApiPropertyOptional({ description: '위험사항' })
  @IsOptional()
  @IsString()
  risks?: string;

  @ApiPropertyOptional({ description: '대안' })
  @IsOptional()
  @IsString()
  alternatives?: string;

  @ApiPropertyOptional({ description: '의사 ID' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ description: '담당 간호사 ID' })
  @IsOptional()
  @IsUUID()
  nurseId?: string;

  @ApiPropertyOptional({ description: '설명 요지' })
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ description: '서명자 유형(PATIENT/GUARDIAN)' })
  @IsOptional()
  @IsString()
  signerType?: string;
}

// ── 동의서 서명 ──

export class SignConsentDto {
  @ApiPropertyOptional({ description: '환자 서명 (Base64)' })
  @IsOptional()
  @IsString()
  patientSignature?: string;

  @ApiPropertyOptional({ description: '서명자 (대리인 등)' })
  @IsOptional()
  @IsString()
  patientSignedBy?: string;

  @ApiPropertyOptional({ description: 'PAD(기본) = 서명패드 이미지 필수 · PAPER = 종이 서명 스캔본(첨부 인덱스) 필수', enum: ['PAD', 'PAPER'] })
  @IsOptional()
  @IsIn(['PAD', 'PAPER'])
  signMode?: 'PAD' | 'PAPER';

  @ApiPropertyOptional({ description: '종이 서명 스캔본 — 이 동의서 첨부 배열 인덱스(signMode=PAPER 일 때)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  paperScanIndex?: number;

  @ApiPropertyOptional({ description: '블록체인 전자서명 데이터' })
  @IsOptional()
  blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  };
}

// ── 동의서 철회 ──

export class RevokeConsentDto {
  @ApiPropertyOptional({ description: '철회 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── 환자 동의서 생성 (patientId는 URL에서 받음) ──

export class CreatePatientConsentDto {
  @ApiProperty({ description: '유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '템플릿명' })
  @IsString()
  @IsNotEmpty()
  templateName: string;

  @ApiProperty({ description: '내용 (JSON)' })
  @IsObject()
  content: Record<string, unknown>;

  @ApiPropertyOptional({ description: '증인 ID' })
  @IsOptional()
  @IsUUID()
  witnessId?: string;

  @ApiPropertyOptional({ description: '템플릿 ID' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ enum: ConsentType, description: '동의 유형' })
  @IsOptional()
  @IsEnum(ConsentType)
  consentType?: ConsentType;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '수술 ID' })
  @IsOptional()
  @IsUUID()
  surgeryId?: string;

  @ApiPropertyOptional({ description: '위험사항' })
  @IsOptional()
  @IsString()
  risks?: string;

  @ApiPropertyOptional({ description: '대안' })
  @IsOptional()
  @IsString()
  alternatives?: string;

  @ApiPropertyOptional({ description: '의사 ID' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
