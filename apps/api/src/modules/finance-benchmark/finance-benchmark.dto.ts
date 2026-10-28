import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportDisclosureDto {
  @ApiPropertyOptional({ description: '출처 메모(예: HASPA 2021 회계연도 공시 · 내려받은 날짜)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  sourceNote?: string;
}
