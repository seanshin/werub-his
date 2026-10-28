import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AllergyType, AllergySeverity } from '@prisma/client';

export class CreateAllergyDto {
  @ApiProperty({ enum: AllergyType })
  @IsEnum(AllergyType)
  type: AllergyType;

  @ApiProperty({ description: '원인물질명' })
  @IsString()
  allergen: string;

  @ApiPropertyOptional({ description: '약품코드/성분코드 (DUR 연동용)' })
  @IsOptional()
  @IsString()
  allergenCode?: string;

  @ApiProperty({ description: '반응/증상' })
  @IsString()
  reaction: string;

  @ApiProperty({ enum: AllergySeverity })
  @IsEnum(AllergySeverity)
  severity: AllergySeverity;

  @ApiPropertyOptional({ description: '발병일' })
  @IsOptional()
  @IsDateString()
  onsetDate?: string;

  @ApiProperty({ description: '보고자 (환자/보호자/의사)' })
  @IsString()
  reportedBy: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
