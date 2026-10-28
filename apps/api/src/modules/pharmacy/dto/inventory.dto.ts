import { IsUUID, IsOptional, IsString, IsInt, IsBoolean, IsIn, IsDateString, IsNotEmpty, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 약품 재고 DTO — 🔴 인라인 @Body 승격(2026-08-18)
 *
 * `POST /pharmacy/inventory/receive` 와 `PATCH /pharmacy/inventory/:batchId/adjust` 는
 * 인라인 `@Body() body: { … }` 라 **ValidationPipe 를 건너뛰었다**. 실제 결과:
 *   · 화면(`pharmacy/admin`)의 입고 버튼은 **유효기간을 비워도 눌린다** → `new Date('')`
 *     = Invalid Date → Prisma 500. 400 이어야 한다(유효기간은 NOT NULL 컬럼).
 *   · 수량은 Int 컬럼인데 음수·소수가 통과했다. 재고 조정도 마찬가지 —
 *     **음수 재고**는 불출 가능 수량 계산과 마약류 장부를 동시에 오염시킨다.
 */
export class ReceiveBatchDto {
  @ApiProperty({ description: '약품코드 ID' })
  @IsUUID('4', { message: 'medicationCodeId 는 UUID 여야 합니다' })
  medicationCodeId: string;

  @ApiProperty({ description: 'LOT 번호' })
  @IsString()
  @IsNotEmpty({ message: 'LOT 번호는 필수입니다' })
  @MaxLength(50)
  lotNumber: string;

  @ApiProperty({ description: '유효기간(YYYY-MM-DD)' })
  @IsDateString({}, { message: '유효기간은 날짜여야 합니다(필수)' })
  expirationDate: string;

  @ApiProperty({ description: '입고 수량(정수·1 이상)' })
  @IsInt({ message: '수량은 정수여야 합니다' })
  @Min(1, { message: '수량은 1 이상이어야 합니다' })
  @Max(10_000_000)
  quantity: number;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @ApiPropertyOptional({ description: '보관 조건', enum: ['ROOM', 'COLD', 'FROZEN'] })
  @IsOptional()
  @IsIn(['ROOM', 'COLD', 'FROZEN'], { message: 'storageCondition 은 ROOM|COLD|FROZEN 이어야 합니다' })
  storageCondition?: string;

  @ApiPropertyOptional({ description: '마약류 여부' })
  @IsOptional()
  @IsBoolean()
  isControlled?: boolean;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdjustBatchDto {
  /** 🔴 조정 후 잔여 수량. 음수 재고는 존재하지 않는다. */
  @ApiProperty({ description: '조정 후 잔여 수량(0 이상 정수)' })
  @IsInt({ message: '수량은 정수여야 합니다' })
  @Min(0, { message: '잔여 수량은 0 미만이 될 수 없습니다' })
  @Max(10_000_000)
  quantity: number;

  @ApiProperty({ description: '조정 사유(감사 근거 — 필수)' })
  @IsString()
  @IsNotEmpty({ message: '재고 조정 사유는 필수입니다' })
  @MaxLength(500)
  reason: string;
}

export class ScanBarcodeDto {
  @ApiProperty({ description: '스캔한 바코드' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  barcode: string;

  @ApiProperty({ description: '조제 건 ID' })
  @IsUUID('4', { message: 'dispensingId 는 UUID 여야 합니다' })
  dispensingId: string;
}
