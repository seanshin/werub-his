import {
  IsString, IsNumber, IsOptional, IsBoolean, IsArray, IsEnum,
  IsUUID, Min, MinLength, ValidateNested, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 품목 ──────────────────────────────────────────────────────────────────────

export class CreateItemDto {
  @ApiProperty({ example: 'INV-019', description: '품목코드' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiPropertyOptional({ description: 'ERP 품목코드 매핑' })
  @IsOptional()
  @IsString()
  erpItemCode?: string;

  @ApiProperty({ example: '의료용 장갑', description: '품목명' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: '소모품', description: '분류' })
  @IsString()
  category: string;

  @ApiProperty({ example: '개', description: '단위' })
  @IsString()
  unit: string;

  @ApiPropertyOptional({ example: 'S/M/L', description: '규격' })
  @IsOptional()
  @IsString()
  specification?: string;

  @ApiPropertyOptional({ example: 100, description: '안전재고량' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  safetyStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryOfOrigin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  storageCondition?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultStorageId?: string;
}

export class UpdateItemDto {
  @ApiPropertyOptional({ description: 'ERP 품목코드 매핑' })
  @IsOptional()
  @IsString()
  erpItemCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  safetyStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultStorageId?: string;
}

// ── 입출고 ────────────────────────────────────────────────────────────────────

export class TransactDto {
  @ApiProperty({ example: 'IN', description: '거래 유형: IN|OUT|ADJUST|RETURN|TRANSFER|ISSUE|RECEIVE|DISPOSAL|EXPIRED' })
  @IsString()
  type: string;

  @ApiProperty({ example: 10, description: '수량' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: '사유' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unitCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNumber?: string;
}

// ── 보관장소 ──────────────────────────────────────────────────────────────────

export class CreateStorageDto {
  @ApiProperty({ example: 'STG-001', description: '보관장소 코드' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiProperty({ example: '중앙창고 A구역' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: '창고', description: '유형' })
  @IsString()
  type: string;

  @ApiPropertyOptional({ example: '본관 B1' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  temperature?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateStorageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  temperature?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 거래처 ────────────────────────────────────────────────────────────────────

export class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-001', description: '거래처 코드' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiPropertyOptional({ description: 'ERP 거래처코드 매핑' })
  @IsOptional()
  @IsString()
  erpVendorCode?: string;

  @ApiProperty({ example: '한국의료물자㈜' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: '000-00-00000', description: '사업자번호' })
  @IsOptional()
  @IsString()
  businessNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representative?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: '월말결제 30일' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractExpiry?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddItemSupplierDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplierItemCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  leadTimeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  minOrderQty?: number;
}

// ── LOT ───────────────────────────────────────────────────────────────────────

export class UpdateLotStatusDto {
  @ApiProperty({ example: 'EXPIRED', description: 'LOT 상태' })
  @IsString()
  status: string;
}

// ── 발주 ──────────────────────────────────────────────────────────────────────

class POItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  orderedQty: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [POItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => POItemDto)
  items: POItemDto[];
}

export class UpdatePOStatusDto {
  @ApiProperty({ example: 'APPROVED', description: '발주 상태' })
  @IsString()
  status: string;
}

class ReceiveItemDto {
  @ApiProperty({ description: 'PurchaseOrderItem ID' })
  @IsUUID()
  poItemId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  receivedQty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lotNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storageId?: string;
}

export class ReceivePODto {
  @ApiProperty({ type: [ReceiveItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];
}

// ── 부서 청구 ─────────────────────────────────────────────────────────────────

class RequestItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  requestedQty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRequestDto {
  @ApiProperty({ example: '내과 병동' })
  @IsString()
  @MinLength(1)
  department: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [RequestItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}

class ApproveItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  approvedQty: number;
}

export class ApproveRequestDto {
  @ApiPropertyOptional({ type: [ApproveItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveItemDto)
  items?: ApproveItemDto[];
}

// ── 재포장 ────────────────────────────────────────────────────────────────────

class RepackItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRepackOrderDto {
  @ApiProperty({ example: 'KIT', description: 'SPLIT|KIT|REPACK' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'IV 준비 세트 (성인)' })
  @IsString()
  @MinLength(1)
  targetItemName: string;

  @ApiPropertyOptional({ description: '산출물 품목 ID — 지정 시 재포장 완료에서 자동 입고' })
  @IsOptional()
  @IsUUID()
  targetItemId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  targetQty: number;

  @ApiPropertyOptional({ example: '세트' })
  @IsOptional()
  @IsString()
  targetUnit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetStorageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [RepackItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepackItemDto)
  items: RepackItemDto[];
}

export class UpdateRepackStatusDto {
  @ApiProperty({ example: 'IN_PROGRESS' })
  @IsString()
  status: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  performedBy?: string;
}

// ── QR 라벨 ───────────────────────────────────────────────────────────────────

export class CreateQrLabelDto {
  @ApiProperty({ example: 'ITEM', description: 'ITEM|LOT|STORAGE' })
  @IsString()
  labelType: string;

  @ApiProperty()
  @IsUUID()
  referenceId: string;

  @ApiProperty()
  @IsString()
  referenceName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceCode?: string;

  @ApiProperty()
  @IsString()
  qrData: string;
}

export class CreateQrLabelsBulkDto {
  @ApiProperty({ type: [CreateQrLabelDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQrLabelDto)
  labels: CreateQrLabelDto[];
}

// ── 실사 (Inventory Count) ───────────────────────────────────────────────────

export class CreateInventoryCountDto {
  @ApiProperty({ example: '2026년 5월 정기실사', description: '실사 제목' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional({ description: '보관장소 ID (특정 장소만 실사)' })
  @IsOptional()
  @IsUUID()
  storageId?: string;

  @ApiPropertyOptional({ example: '소모품', description: '카테고리 필터' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ example: '2026-05-10', description: '실사 예정일' })
  @IsDateString()
  scheduledDate: string;
}

class UpdateCountItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 98, description: '실사 수량' })
  @IsNumber()
  @Min(0)
  countedQty: number;

  @ApiPropertyOptional({ description: '차이 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateCountItemsDto {
  @ApiProperty({ type: [UpdateCountItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCountItemDto)
  items: UpdateCountItemDto[];
}

// ── 리포트 ───────────────────────────────────────────────────────────────────

export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ example: '소모품' })
  @IsOptional()
  @IsString()
  category?: string;
}
