import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const RELATIONSHIPS = ['PARENT', 'SPOUSE', 'CHILD', 'SIBLING', 'GUARDIAN', 'OTHER'] as const;

export class CreateContactDto {
  @ApiProperty({ example: '홍순이' })
  @IsString()
  name: string;

  @ApiProperty({ enum: RELATIONSHIPS, example: 'PARENT' })
  @IsString()
  @IsIn(RELATIONSHIPS)
  relationship: string;

  @ApiPropertyOptional({ example: '어머니' })
  @IsOptional()
  @IsString()
  relationshipDetail?: string;

  @ApiProperty({ example: '010-9876-5432' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: '02-123-4567' })
  @IsOptional()
  @IsString()
  phone2?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLegalGuardian?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
