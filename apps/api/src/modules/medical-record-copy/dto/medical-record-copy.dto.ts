import {
  IsString, IsNumber, IsOptional, IsUUID, IsNotEmpty, IsObject, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 사본발급 이력 생성 ──

export class CreateMedicalRecordCopyDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '신청자' })
  @IsString()
  @IsNotEmpty()
  requestedBy: string;

  @ApiProperty({ description: '신청자 관계' })
  @IsString()
  @IsNotEmpty()
  requestorRelation: string;

  @ApiProperty({ description: '발급 목적' })
  @IsString()
  @IsNotEmpty()
  purpose: string;

  @ApiProperty({ description: '기록 유형 (JSON)' })
  recordTypes: string[];

  @ApiPropertyOptional({ description: '기간 범위 (JSON)' })
  @IsOptional()
  dateRange?: { from?: string; to?: string };

  @ApiProperty({ description: '사본 수' })
  @IsNumber()
  @Min(1)
  copyCount: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── PDF 생성 ──

export class GeneratePdfDto {
  @ApiProperty({ description: '기록 유형 (encounter, prescription 등)' })
  @IsString()
  @IsNotEmpty()
  recordType: string;

  @ApiProperty({ description: '기록 ID' })
  @IsString()
  @IsNotEmpty()
  recordId: string;
}
