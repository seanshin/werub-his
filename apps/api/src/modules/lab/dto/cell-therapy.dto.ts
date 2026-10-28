import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 배치 생성 ──

export class CreateCellTherapyBatchDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '세포 유형' })
  @IsString()
  @IsNotEmpty()
  cellType: string;

  @ApiProperty({ description: '소스 유형' })
  @IsString()
  @IsNotEmpty()
  sourceType: string;

  @ApiProperty({ description: '채취일' })
  @IsString()
  @IsNotEmpty()
  collectionDate: string;

  @ApiPropertyOptional({ description: '목표 투여량' })
  @IsOptional()
  @IsString()
  targetDose?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 배치 상태 변경 ──

export class UpdateBatchStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}

// ── 환경 모니터링 ──

export class AddEnvironmentLogDto {
  @ApiProperty({ description: '온도 (C)' })
  @IsNumber()
  temperature: number;

  @ApiProperty({ description: 'CO2 농도 (%)' })
  @IsNumber()
  co2Percent: number;

  @ApiPropertyOptional({ description: '습도 (%)' })
  @IsOptional()
  @IsNumber()
  humidity?: number;
}

// ── QC 검사 ──

export class AddQcTestDto {
  @ApiProperty({ description: '검사 유형' })
  @IsString()
  @IsNotEmpty()
  testType: string;

  @ApiProperty({ description: '결과' })
  @IsString()
  @IsNotEmpty()
  result: string;

  @ApiPropertyOptional({ description: '단위' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ description: '합격/불합격 (PASS, FAIL)' })
  @IsString()
  @IsNotEmpty()
  passFail: string;

  @ApiPropertyOptional({ description: '보고서 URL' })
  @IsOptional()
  @IsString()
  reportUrl?: string;
}

// ── GMP 문서 ──

export class AddDocumentDto {
  @ApiProperty({ description: '문서 유형' })
  @IsString()
  @IsNotEmpty()
  docType: string;

  @ApiProperty({ description: '파일명' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ description: '파일 URL' })
  @IsString()
  @IsNotEmpty()
  fileUrl: string;
}
