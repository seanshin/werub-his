import { IsOptional, IsString, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CodeQueryDto {
  @ApiPropertyOptional({ description: '코드 또는 명칭 통합 검색', example: '감기' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: '코드 체계 필터', example: 'KCD-8', enum: ['KCD-8', 'ICD-10', 'ICD-11'] })
  @IsOptional()
  @IsString()
  codeSystem?: string;

  @ApiPropertyOptional({ description: '분류 필터', example: '호흡기계 질환' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '유효 코드만 (기본 true)', default: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active?: boolean = true;

  @ApiPropertyOptional({
    description: "출처 필터 — HIRA(고시 반영) | LOCAL(원내 등록) | UNKNOWN(표기 없음)",
    enum: ['HIRA', 'LOCAL', 'UNKNOWN'],
  })
  @IsOptional()
  @IsString()
  origin?: string;

  @ApiPropertyOptional({
    description:
      '이름 일부 일치까지 넓혀 검색 — 짧은 영문 약어는 기본적으로 단어 단위로만 찾는다(우연한 일치 방지). 사람이 눌러서만 넓힌다',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  wide?: boolean = false;

  @ApiPropertyOptional({ description: '페이지 번호', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '페이지당 개수', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
