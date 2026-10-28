import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefRangeSex } from '@prisma/client';

export class CreateReferenceRangeDto {
  @ApiPropertyOptional({ description: '원내 검사코드(LabTestCode.code)' })
  @IsOptional() @IsString()
  testCode?: string;

  @ApiPropertyOptional({ description: '표준 LOINC' })
  @IsOptional() @IsString()
  loincCode?: string;

  @ApiPropertyOptional({ description: '검사명(표시용)' })
  @IsOptional() @IsString()
  testName?: string;

  @ApiProperty({ enum: RefRangeSex, description: '성별(ANY/MALE/FEMALE)' })
  @IsEnum(RefRangeSex)
  sex: RefRangeSex;

  @ApiPropertyOptional({ description: '연령 하한(세·포함)' })
  @IsOptional() @IsInt()
  ageMinYears?: number;

  @ApiPropertyOptional({ description: '연령 상한(세·미포함)' })
  @IsOptional() @IsInt()
  ageMaxYears?: number;

  @ApiPropertyOptional({ description: '영아 연령 하한(개월·포함)' })
  @IsOptional() @IsInt()
  ageMinMonths?: number;

  @ApiPropertyOptional({ description: '영아 연령 상한(개월·미포함)' })
  @IsOptional() @IsInt()
  ageMaxMonths?: number;

  @ApiPropertyOptional({ description: '검체' })
  @IsOptional() @IsString()
  specimen?: string;

  @ApiPropertyOptional({ description: '정상 하한' })
  @IsOptional() @IsNumber()
  low?: number;

  @ApiPropertyOptional({ description: '정상 상한' })
  @IsOptional() @IsNumber()
  high?: number;

  @ApiPropertyOptional({ description: '위급 저치' })
  @IsOptional() @IsNumber()
  criticalLow?: number;

  @ApiPropertyOptional({ description: '위급 고치' })
  @IsOptional() @IsNumber()
  criticalHigh?: number;

  @ApiPropertyOptional({ description: '단위' })
  @IsOptional() @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: '정성검사 정상값(예: Negative)' })
  @IsOptional() @IsString()
  textNormal?: string;

  @ApiPropertyOptional({ description: '출처' })
  @IsOptional() @IsString()
  source?: string;
}

export class UpdateReferenceRangeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() testName?: string;
  @ApiPropertyOptional({ enum: RefRangeSex }) @IsOptional() @IsEnum(RefRangeSex) sex?: RefRangeSex;
  @ApiPropertyOptional() @IsOptional() @IsInt() ageMinYears?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() ageMaxYears?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() ageMinMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() ageMaxMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() specimen?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() low?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() high?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() criticalLow?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() criticalHigh?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() textNormal?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
