import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsIn,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateCheckupTestMasterDto {
  @ApiProperty({ description: '검사 코드', example: 'CBC_18' })
  @IsString()
  @MaxLength(30)
  code: string;

  @ApiProperty({ description: '검사명', example: '일반혈액검사 (18항목)' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: '카테고리',
    enum: ['PHYSICAL', 'LAB', 'IMAGING', 'DIAGNOSTIC', 'CONSULT', 'AI'],
  })
  @IsString()
  @IsIn(['PHYSICAL', 'LAB', 'IMAGING', 'DIAGNOSTIC', 'CONSULT', 'AI'])
  category: string;

  @ApiPropertyOptional({ description: '세부 분류', example: '혈액' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subCategory?: string;

  @ApiPropertyOptional({ description: '판독 담당과', example: '영상의학과' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  interpretDept?: string;

  @ApiPropertyOptional({ description: '결과 단위', example: 'mg/dL' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional({ description: '참고치', example: '70~110' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceRange?: string;

  @ApiPropertyOptional({ description: '기본 단가 (원)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultPrice?: number;

  @ApiPropertyOptional({ description: '예상 소요(분)', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '정렬 순서', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '활성 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCheckupTestMasterDto extends PartialType(
  CreateCheckupTestMasterDto,
) {}
