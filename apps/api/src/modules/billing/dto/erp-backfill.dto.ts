import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * ERP close-loop 백필 수신 DTO — 2026-07 입력 검증 전수검토.
 *
 * ⚠️ `code` 는 `medicationCode.updateMany({ where: { code } })` 에 그대로 들어간다.
 * 검증이 없으면 문자열 자리에 `{ not: '...' }` 같은 **Prisma 필터 연산자**를 넣어
 * 약품 마스터 24,022건을 한 번에 덮어쓸 수 있다(값 자체는 형식 검증돼도 where 는 무방비였음).
 * 중첩 배열은 `@ValidateNested({ each: true }) + @Type` 이 있어야 실제로 검증된다.
 */
const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;

export class DrugMappingItemDto {
  @ApiProperty({ description: '원내 약품코드' })
  @IsString()
  @Matches(CODE_RE, { message: 'code 형식이 올바르지 않습니다' })
  code: string;

  @ApiProperty({ description: '보험 제품코드(8~13자리 숫자)' })
  @IsString()
  @MaxLength(32)
  insuranceCode: string;
}

export class DrugMappingBackfillDto {
  @ApiProperty({ type: [DrugMappingItemDto] })
  @IsArray()
  @ArrayMaxSize(50_000)
  @ValidateNested({ each: true })
  @Type(() => DrugMappingItemDto)
  mappings: DrugMappingItemDto[];
}

export class IngredientMappingItemDto {
  @ApiProperty({ description: '원내 약품코드' })
  @IsString()
  @Matches(CODE_RE, { message: 'code 형식이 올바르지 않습니다' })
  code: string;

  @ApiProperty({ description: '주성분코드' })
  @IsString()
  @MaxLength(32)
  ingredientCode: string;
}

export class IngredientMappingBackfillDto {
  @ApiProperty({ type: [IngredientMappingItemDto] })
  @IsArray()
  @ArrayMaxSize(50_000)
  @ValidateNested({ each: true })
  @Type(() => IngredientMappingItemDto)
  mappings: IngredientMappingItemDto[];
}
