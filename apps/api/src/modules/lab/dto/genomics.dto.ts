import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 유전체 검사 오더 ──

export class CreateGenomicTestDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '검사 유형' })
  @IsString()
  @IsNotEmpty()
  testType: string;

  @ApiPropertyOptional({ description: '패널명' })
  @IsOptional()
  @IsString()
  panelName?: string;

  @ApiProperty({ description: '검체 유형' })
  @IsString()
  @IsNotEmpty()
  sampleType: string;

  @ApiPropertyOptional({ description: '외부 검사기관 ID' })
  @IsOptional()
  @IsString()
  referenceLabId?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 검사 상태 변경 ──

export class UpdateGenomicTestStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}

// ── 변이 추가 ──

export class AddVariantDto {
  @ApiProperty({ description: '유전자명' })
  @IsString()
  @IsNotEmpty()
  gene: string;

  @ApiPropertyOptional({ description: '염색체' })
  @IsOptional()
  @IsString()
  chromosome?: string;

  @ApiPropertyOptional({ description: '위치' })
  @IsOptional()
  @IsNumber()
  position?: number;

  @ApiPropertyOptional({ description: '참조 대립유전자' })
  @IsOptional()
  @IsString()
  refAllele?: string;

  @ApiPropertyOptional({ description: '변이 대립유전자' })
  @IsOptional()
  @IsString()
  altAllele?: string;

  @ApiProperty({ description: '변이 유형' })
  @IsString()
  @IsNotEmpty()
  variantType: string;

  @ApiPropertyOptional({ description: '접합성' })
  @IsOptional()
  @IsString()
  zygosity?: string;

  @ApiProperty({ description: '분류 (Pathogenic, Likely pathogenic 등)' })
  @IsString()
  @IsNotEmpty()
  classification: string;

  @ApiPropertyOptional({ description: '대립유전자 빈도' })
  @IsOptional()
  @IsNumber()
  alleleFreq?: number;

  @ApiPropertyOptional({ description: '임상적 의의' })
  @IsOptional()
  @IsString()
  clinicalSig?: string;

  @ApiPropertyOptional({ description: '실행 가능성' })
  @IsOptional()
  @IsString()
  actionability?: string;

  @ApiPropertyOptional({ description: 'dbSNP ID' })
  @IsOptional()
  @IsString()
  dbSnpId?: string;

  @ApiPropertyOptional({ description: 'COSMIC ID' })
  @IsOptional()
  @IsString()
  cosmicId?: string;

  @ApiPropertyOptional({ description: 'HGVS coding' })
  @IsOptional()
  @IsString()
  hgvsC?: string;

  @ApiPropertyOptional({ description: 'HGVS protein' })
  @IsOptional()
  @IsString()
  hgvsP?: string;
}

// ── 보고서 추가 ──

export class AddGenomicReportDto {
  @ApiProperty({ description: '보고서 유형' })
  @IsString()
  @IsNotEmpty()
  reportType: string;

  @ApiPropertyOptional({ description: '해석' })
  @IsOptional()
  @IsString()
  interpretation?: string;

  @ApiPropertyOptional({ description: '권고사항' })
  @IsOptional()
  @IsString()
  recommendation?: string;

  @ApiPropertyOptional({ description: '보고서 파일 URL' })
  @IsOptional()
  @IsString()
  reportFileUrl?: string;
}

// ── 유전상담 ──

export class RecordCounselDto {
  @ApiProperty({ description: '상담 기록' })
  @IsString()
  @IsNotEmpty()
  notes: string;
}
