import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * 🔴 (2026-09-15 B6) 원가 쓰기 8 핸들러가 `Record<string, unknown>`·`@Body('period')` 원시 추출이었고
 *    서비스는 그 본문을 `prisma.*.create({ data: body as never })` 로 그대로 넘겼다(대량 할당).
 *  - 수동 배부는 **금액(`amount`)·출처(`source`)를 요청자가 정했다** — 원가 배부 원장에 임의 금액·`AUTO` 위장이 가능했다.
 *  - 반대로 화면(`/cost-analysis` 수동 배분)은 `{costCenterId, driverId, quantity, period}` 를 보내는데 모델 필드는
 *    `costDriverId` 이고 `amount`·`source` 가 필수라 **수동 배분은 한 번도 저장된 적이 없다**(Prisma 오류 → 500 · P11).
 *    이제 금액은 서버가 동인 단가 × 수량으로 계산하고 출처는 `MANUAL` 로 고정한다.
 * 길이는 스키마 VarChar 그대로. 유형(type)·분류(category) 어휘는 지어내지 않는다(길이만).
 */
export class CreateCostCenterDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiProperty({ description: '화면 선택지 DIRECT_CARE·SUPPORT·ADMIN' }) @IsString() @IsNotEmpty() @MaxLength(20) type!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) department!: string;
  /** 화면은 미선택을 `null` 로 보낸다 */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
}

export class UpdateCostCenterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50) department?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateCostDriverDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) category!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) unit!: string;
  @ApiProperty({ description: 'Decimal(12,2)' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost!: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10) period!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class UpdateCostDriverDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) unit?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10) period?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

/** 수동 배부 — 금액은 받지 않는다(동인 단가 × 수량 서버 계산) · 화면 키 `driverId` 그대로 */
export class CreateManualCostAllocationDto {
  @ApiProperty() @IsUUID() costCenterId!: string;
  @ApiProperty() @IsUUID() driverId!: string;
  @ApiProperty({ description: 'Decimal(10,2)' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10) period!: string;
}

/** 자동 배부·시술 원가 산출·ERP 발행 — 기간 하나 */
export class CostPeriodDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10) period!: string;
}
