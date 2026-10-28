import { IsString, IsObject, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFormSchemaDto {
  @ApiProperty({ example: 'vital-signs' })
  @IsString()
  name: string;

  @ApiProperty({ example: '1.0' })
  @IsString()
  version: string;

  @ApiPropertyOptional({ example: 'ko', default: 'ko' })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiProperty({ description: 'JSON Form 스키마 정의' })
  @IsObject()
  schema: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'QUESTIONNAIRE', description: 'QUESTIONNAIRE | SCORING | CONSENT | CUSTOM' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  category?: string;

  @ApiPropertyOptional({ example: 5, description: '예상 작성 시간(분)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  estimatedMinutes?: number;

  @ApiPropertyOptional({ description: '환자에게 표시되는 설명' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/**
 * 🔴 W8 — 수정 DTO 를 **클래스로** 둔다.
 * 종전 컨트롤러는 `@Body() dto: Partial<CreateFormSchemaDto>` 였는데, `Partial<>` 는 타입일 뿐
 * 런타임 메타타입이 `Object` 라 **ValidationPipe 가 통째로 스킵**된다(저장소 함정: 인라인 @Body).
 * 그 결과 `schema` 에 배열·문자열 무엇이든 들어와 문항 원장을 덮어쓸 수 있었다.
 */
export class UpdateFormSchemaDto {
  @ApiPropertyOptional({ example: '1.1' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ example: 'ko' })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({ description: 'JSON Form 스키마 정의(부분 갱신 — 보내지 않은 최상위 키는 보존)' })
  @IsOptional()
  @IsObject()
  schema?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'QUESTIONNAIRE' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  category?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  estimatedMinutes?: number;

  @ApiPropertyOptional({ description: '환자에게 표시되는 설명' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
