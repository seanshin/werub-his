import { IsEnum, IsOptional, IsString, IsDateString, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AllergyType, AllergySeverity } from '@prisma/client';

export class UpdateAllergyDto {
  @ApiPropertyOptional({ enum: AllergyType })
  @IsOptional()
  @IsEnum(AllergyType)
  type?: AllergyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allergen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allergenCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reaction?: string;

  @ApiPropertyOptional({ enum: AllergySeverity })
  @IsOptional()
  @IsEnum(AllergySeverity)
  severity?: AllergySeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  onsetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reportedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
