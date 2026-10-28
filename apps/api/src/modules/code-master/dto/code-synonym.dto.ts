import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import {
  SYNONYM_KINDS,
  SYNONYM_SOURCE_TABLES,
} from '../../../common/code-search';

/**
 * 🔴 인라인 `@Body` 를 쓰지 않는다 — 교차 타입·인터페이스·인라인은 ValidationPipe 가 통째로 스킵된다.
 *    동의어는 **검색 결과를 바꾸는 입력**이라 더 그렇다.
 */
export class CodeSynonymProposeDto {
  @ApiProperty({ enum: SYNONYM_SOURCE_TABLES })
  @IsIn(SYNONYM_SOURCE_TABLES as unknown as string[])
  sourceTable!: string;

  @ApiProperty({ description: '검색어(사람이 치는 표기 그대로)' })
  @IsString()
  @Length(1, 120)
  term!: string;

  @ApiProperty({ enum: SYNONYM_KINDS })
  @IsIn(SYNONYM_KINDS as unknown as string[])
  kind!: string;

  @ApiPropertyOptional({ description: '지목할 코드 — 비우면 질의 확장 전용' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  codeSystem?: string;

  @ApiPropertyOptional({ description: '확장 질의어 — 이 말로도 찾는다' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  expandsTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CodeSynonymReviewDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
