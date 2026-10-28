import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  IsIn,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCheckupProgramDto {
  @ApiProperty({ description: '프로그램 코드', example: 'CK-BASIC' })
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiProperty({ description: '프로그램명', example: '기본 종합검진' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: '카테고리',
    enum: ['BASIC', 'PLUS', 'PRECISION', 'PREMIUM', 'PET_PRECISION', 'SPECIAL'],
  })
  @IsString()
  @IsIn(['BASIC', 'PLUS', 'PRECISION', 'PREMIUM', 'PET_PRECISION', 'SPECIAL'])
  category: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: '대상 성별',
    enum: ['ALL', 'MALE', 'FEMALE'],
    default: 'ALL',
  })
  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'MALE', 'FEMALE'])
  gender?: string;

  @ApiPropertyOptional({ description: '최소 연령' })
  @IsOptional()
  @IsInt()
  @Min(0)
  ageMin?: number;

  @ApiPropertyOptional({ description: '최대 연령' })
  @IsOptional()
  @IsInt()
  @Max(150)
  ageMax?: number;

  @ApiProperty({ description: '정가 (원)', example: 380000 })
  @IsInt()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ description: '할인율 (%)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountRate?: number;

  @ApiPropertyOptional({ description: '예상 소요(분)', default: 120 })
  @IsOptional()
  @IsInt()
  @Min(10)
  duration?: number;

  @ApiPropertyOptional({ description: '일일 최대 수검자 수 (null=무제한)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyCapacity?: number;

  @ApiProperty({ description: '검사 항목 (JSON)', type: 'array' })
  @IsArray()
  items: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '선택 추가 항목 (JSON)' })
  @IsOptional()
  @IsArray()
  options?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '활성 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCheckupProgramDto extends PartialType(
  CreateCheckupProgramDto,
) {}
