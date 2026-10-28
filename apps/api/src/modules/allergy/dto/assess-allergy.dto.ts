import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AllergyAssessmentResult } from '@prisma/client';

export class AssessAllergyDto {
  @ApiProperty({ enum: AllergyAssessmentResult, description: '문진 결과 (NKA/알레르기있음/문진불가)' })
  @IsEnum(AllergyAssessmentResult)
  result: AllergyAssessmentResult;

  @ApiPropertyOptional({ description: '연관 진료(encounter) ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  note?: string;
}
