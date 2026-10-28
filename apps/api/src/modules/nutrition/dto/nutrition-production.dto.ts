import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 B4) 급양 생산·검식·HACCP·배식 확인·직원 식단/식수 쓰기 9종 — 종전 인라인 타입(ValidationPipe 스킵).
 *
 * - 숫자 컬럼(`producedQty`·관능 점수 Int · HACCP `value` Float · 가격·열량 Int)에 문자열이 오면 Prisma 500 이었다 → 400.
 * - 길이는 스키마 VarChar 근거(`StaffMealMenu`·`StaffMealRequest`·`HaccpCheck`·`ProductionBatch`).
 * - 어휘(조리 상태 PLANNED·COOKING·DONE · CCP 종류 · 끼니 · 코스)는 스키마 주석뿐이라 막지 않는다.
 *   CCP 기준 판정은 서비스 `ccpWithinLimit` 이 한다(미지 종류는 판정하지 않는다).
 * - 날짜는 서비스 `dayValue` 가 한 번 더 400 으로 막는다.
 * - HACCP 기록 경로의 `date`·`mealType` 은 배치(경로 id)에서 서버가 편다 — 본문으로 받지 않는다(종전 인라인 타입에도 없었다).
 */
const given = (_: object, v: unknown) => v !== undefined;

export class GenerateProductionDto {
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() date!: string;
}

export class UpdateProductionStatusDto {
  @ApiPropertyOptional({ description: 'PLANNED·COOKING·DONE (스키마 주석)' }) @IsOptional() @IsString() @MaxLength(20) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() producedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class InspectProductionBatchDto {
  @ApiPropertyOptional({ description: '적합 여부(기본 true — 서비스)' }) @IsOptional() @IsBoolean() pass?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() taste?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() temperature?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() portion?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() hygiene?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class RecordHaccpDto {
  @ApiProperty({ description: 'HEATING·COLD·HOT·TIME (스키마 주석)' }) @IsString() @MaxLength(20) ccpType!: string;
  @ApiPropertyOptional({ description: '측정값(℃ 또는 분)' }) @IsOptional() @IsNumber() value?: number;
  @ApiPropertyOptional({ description: '이탈 시 시정조치(적합이면 서버가 버린다)' }) @IsOptional() @IsString() correctiveAction?: string;
}

export class DeliverMealCheckDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() patientVerified?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dietVerified?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allergyVerified?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tempOk?: boolean;
}

export class UpsertStaffMenuDto {
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() date!: string;
  @ApiProperty({ description: 'BREAKFAST·LUNCH·DINNER (스키마 주석)' }) @IsString() @MaxLength(20) mealType!: string;
  @ApiProperty({ description: 'A·B·C·SPECIAL (스키마 주석)' }) @IsString() @MaxLength(10) courseType!: string;
  @ApiProperty() @IsString() @MaxLength(200) menuName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  /** NOT NULL Int — `null` 로 수정하면 Prisma 500 이었다 */
  @ApiPropertyOptional() @ValidateIf(given) @IsInt() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() calories?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) allergens?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsBoolean() isSpecial?: boolean;
}

export class BulkStaffMenuDto {
  @ApiProperty({ type: [UpsertStaffMenuDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => UpsertStaffMenuDto) menus!: UpsertStaffMenuDto[];
}

export class RequestStaffMealDto {
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() date!: string;
  @ApiProperty() @IsString() @MaxLength(20) mealType!: string;
  @ApiPropertyOptional({ description: '기본 A(서비스)' }) @IsOptional() @IsString() @MaxLength(10) courseType?: string;
}

export class ConfirmStaffMealsDto {
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() date!: string;
}
