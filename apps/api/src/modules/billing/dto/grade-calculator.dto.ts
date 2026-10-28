import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INSTITUTION_GRADES } from '@hospital-run/shared';

/** 계산기가 받는 본인부담 구분 — 자격 정본(EligibilityService RATE_KEY)의 어휘 그대로 */
export const GRADE_CALC_COPAY_CATEGORIES = ['NHI', 'MA_TYPE1', 'MA_TYPE2', 'NEAR_POOR', 'SPECIAL_EXEMPTION', 'PATRIOT', 'INDUSTRIAL', 'AUTO', 'SELF_PAY'] as const;

export class GradeCalculatorItemDto {
  @ApiProperty({ description: '수가 코드(EDI)', example: 'D2200' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{2,20}$/, { message: '수가 코드 형식이 아닙니다' })
  code: string;

  @ApiProperty({ description: '수량', example: 1 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity: number;
}

export class GradeCalculatorDto {
  @ApiPropertyOptional({ description: '비교할 종별 — 비우면 넷 다', enum: INSTITUTION_GRADES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(INSTITUTION_GRADES, { each: true })
  grades?: string[];

  @ApiProperty({ description: '진찰료 — 초진·재진·없음', enum: ['INITIAL', 'FOLLOW_UP', 'NONE'] })
  @IsIn(['INITIAL', 'FOLLOW_UP', 'NONE'])
  visitKind: 'INITIAL' | 'FOLLOW_UP' | 'NONE';

  @ApiProperty({ description: '본인부담 구분(자격 어휘)', enum: GRADE_CALC_COPAY_CATEGORIES })
  @IsIn(GRADE_CALC_COPAY_CATEGORIES)
  copayCategory: (typeof GRADE_CALC_COPAY_CATEGORIES)[number];

  @ApiProperty({ description: '수가 코드·수량(최대 50)', type: [GradeCalculatorItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GradeCalculatorItemDto)
  items: GradeCalculatorItemDto[];

  @ApiPropertyOptional({ description: '기준일(YYYY-MM-DD) — 비우면 오늘', example: '2026-10-20' })
  @IsOptional()
  @IsDateString({ strict: true })
  onDate?: string;
}
