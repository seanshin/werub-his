import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProblemStatus, ProblemSeverity } from '@prisma/client';

export class UpdateProblemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ProblemStatus })
  @IsOptional()
  @IsEnum(ProblemStatus)
  status?: ProblemStatus;

  @ApiPropertyOptional({ enum: ProblemSeverity })
  @IsOptional()
  @IsEnum(ProblemSeverity)
  severity?: ProblemSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResolveProblemDto {
  @ApiPropertyOptional({ description: '해결일 (기본: 오늘)' })
  @IsOptional()
  @IsDateString()
  resolvedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
