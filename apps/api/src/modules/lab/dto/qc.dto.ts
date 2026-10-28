import {
  IsString, IsOptional, IsNotEmpty, IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── QC 기록 추가 ──

export class AddQcRecordDto {
  @ApiProperty({ description: '장비 ID' })
  @IsString()
  @IsNotEmpty()
  instrumentId: string;

  @ApiPropertyOptional({ description: 'QC 물질 ID' })
  @IsOptional()
  @IsString()
  qcMaterialId?: string;

  @ApiProperty({ description: 'QC 레벨 (L1, L2, L3)' })
  @IsString()
  @IsNotEmpty()
  qcLevel: string;

  @ApiProperty({ description: '검사 코드' })
  @IsString()
  @IsNotEmpty()
  testCode: string;

  @ApiProperty({ description: '측정값' })
  @IsNumber()
  measuredValue: number;

  @ApiProperty({ description: '목표 평균' })
  @IsNumber()
  targetMean: number;

  @ApiProperty({ description: '목표 표준편차' })
  @IsNumber()
  targetSD: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}
