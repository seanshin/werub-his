import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AllergyVerification } from '@prisma/client';

export class VerifyAllergyDto {
  @ApiProperty({ enum: AllergyVerification })
  @IsEnum(AllergyVerification)
  verificationStatus: AllergyVerification;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
