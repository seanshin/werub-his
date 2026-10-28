import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * CSSD 품목·공급·패키지 이벤트 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입·`Record<string, unknown>` 은
 * ValidationPipe 가 통째로 건너뛰었다.
 *  - 🔴 품목 수정: 본문 전체를 `instrumentItem.update({ data })` 에 넘겼다 — **`stock` 을 직접 써서 입출고 원장
 *    (`supply_transactions`)을 거치지 않고 재고를 바꿀 수 있었다**(재고는 거래로만 바뀐다 — `supply()`). 선언 필드에서 `stock` 제외.
 *  - 공급: `qty` 에 문자열이 오면 `item.stock + "5"` 문자열 결합이 됐고, `type` 은 아무 문자열이 +qty 경로로 흘렀다.
 *  - 패키지 사용: `encounterId` 가 UUID 가 아니면 저장 단계 P2023 → 500.
 * 필드 이름은 종전 인라인 타입·화면(cssd/page.tsx 품목 등록 `f`·공급 `{type,qty,reason}`)과 같다.
 */
export class CreateSupplierDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contact?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
}

class ItemEditableFields {
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() spec?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) safetyStock?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() erpItemCode?: string;
}

export class CreateInstrumentItemDto extends ItemEditableFields {
  @ApiPropertyOptional({ description: '품목 코드(없으면 서버 발번)' }) @IsOptional() @IsString() code?: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ description: '초기 재고 — 입고 거래(초기 재고)로 원장에 남는다' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) stock?: number;
}

export class UpdateInstrumentItemDto extends ItemEditableFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SupplyInstrumentItemDto {
  @ApiProperty({ enum: ['IN', 'ADJUST', 'RETURN'], description: 'IN/RETURN=+수량 · ADJUST=목표 재고' })
  @IsIn(['IN', 'ADJUST', 'RETURN'])
  type!: 'IN' | 'ADJUST' | 'RETURN';

  @ApiProperty({ description: '수량(ADJUST 는 목표 재고 — 0 허용)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  qty!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class UsePackageDto {
  @ApiPropertyOptional({ description: '사용처 진료' }) @IsOptional() @IsUUID() encounterId?: string;
}

export class CssdEventNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
