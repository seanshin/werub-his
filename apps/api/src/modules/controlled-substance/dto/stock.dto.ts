import { IsString, IsOptional, IsNotEmpty, IsNumber, IsUUID, IsIn, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 입고(RECEIPT) ──
export class ReceiveStockDto {
  @ApiProperty({ description: '약품 코드' }) @IsString() @IsNotEmpty() drugCode: string;
  @ApiProperty({ description: '약품명' }) @IsString() @IsNotEmpty() drugName: string;
  @ApiProperty({ description: '마약류 등급', enum: ['I', 'II', 'III', 'IV', 'V'] }) @IsIn(['I', 'II', 'III', 'IV', 'V']) deaSchedule: string;
  @ApiProperty({ description: '단위' }) @IsString() @IsNotEmpty() unit: string;
  @ApiPropertyOptional({ description: '보관 장소' }) @IsOptional() @IsString() location?: string;
  @ApiProperty({ description: '입고 수량(>0)' }) @IsNumber() @Min(0.01) @Max(1000000) quantity: number;
  @ApiPropertyOptional({ description: '비고' }) @IsOptional() @IsString() reason?: string;
}

// ── 불출/반납/폐기 (수량 이동) ──
export class StockMoveDto {
  @ApiProperty({ description: '수량(>0)' }) @IsNumber() @Min(0.01) @Max(1000000) quantity: number;
  @ApiPropertyOptional({ description: '사유' }) @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ description: '연계 마약류 로그 ID' }) @IsOptional() @IsUUID() refId?: string;
  @ApiPropertyOptional({ description: '증인(폐기 필수)' }) @IsOptional() @IsUUID() witnessedBy?: string;
}

// ── 조정(ADJUST) ──
export class AdjustStockDto {
  @ApiProperty({ description: '조정량(부호 있음, +/-)' }) @IsNumber() @Min(-1000000) @Max(1000000) delta: number;
  @ApiProperty({ description: '조정 사유(필수)' }) @IsString() @IsNotEmpty() reason: string;
  @ApiPropertyOptional({ description: '증인' }) @IsOptional() @IsUUID() witnessedBy?: string;
}

// ── 실사(COUNT) ──
export class CountStockDto {
  @ApiProperty({ description: '실사 수량(물리 재고)' }) @IsNumber() @Min(0) @Max(1000000) countedQty: number;
  @ApiPropertyOptional({ description: '증인(불일치 시 필수)' }) @IsOptional() @IsUUID() witnessedBy?: string;
  @ApiPropertyOptional({ description: '비고' }) @IsOptional() @IsString() reason?: string;
}
