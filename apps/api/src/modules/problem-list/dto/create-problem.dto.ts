import { IsUUID, IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProblemStatus, ProblemSeverity } from '@prisma/client';

export class CreateProblemDto {
  @ApiProperty({ description: '진단코드 ID (DiagnosisCode)' })
  @IsUUID()
  diagnosisCodeId: string;

  @ApiProperty({ description: '문제 설명' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ enum: ProblemStatus, default: 'ACTIVE' })
  @IsOptional()
  @IsEnum(ProblemStatus)
  status?: ProblemStatus;

  @ApiPropertyOptional({ enum: ProblemSeverity, default: 'MODERATE' })
  @IsOptional()
  @IsEnum(ProblemSeverity)
  severity?: ProblemSeverity;

  @ApiPropertyOptional({ description: '발병일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  onsetDate?: string;

  @ApiPropertyOptional({ description: '등록된 진료건 ID' })
  @IsOptional()
  @IsUUID()
  addedEncounterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
