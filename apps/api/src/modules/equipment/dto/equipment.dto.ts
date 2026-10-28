import {
  IsString, IsNumber, IsOptional, IsArray, IsEnum,
  IsNotEmpty, IsDateString, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 장비 등록 ──

export class CreateEquipmentDto {
  @ApiProperty({ description: '자산번호' })
  @IsString()
  @IsNotEmpty()
  assetNumber: string;

  @ApiPropertyOptional({ description: 'ERP 고정자산 코드 매핑' })
  @IsOptional()
  @IsString()
  erpAssetCode?: string;

  @ApiProperty({ description: '장비명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '분류' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '모델명' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: '시리얼번호' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({ description: '위치' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: '구매일' })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional({ description: '구매가격' })
  @IsOptional()
  @IsNumber()
  purchasePrice?: number;

  @ApiPropertyOptional({ description: '보증만료일' })
  @IsOptional()
  @IsDateString()
  warrantyExpiry?: string;

  @ApiPropertyOptional({ description: '다음 점검일' })
  @IsOptional()
  @IsDateString()
  nextInspection?: string;

  @ApiPropertyOptional({ description: '공급업체명' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ description: '공급업체 연락처' })
  @IsOptional()
  @IsString()
  supplierContact?: string;

  @ApiPropertyOptional({ description: '공급업체 전화' })
  @IsOptional()
  @IsString()
  supplierPhone?: string;

  @ApiPropertyOptional({ description: 'A/S 담당자명' })
  @IsOptional()
  @IsString()
  asContactName?: string;

  @ApiPropertyOptional({ description: 'A/S 전화' })
  @IsOptional()
  @IsString()
  asContactPhone?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 장비 수정 ──

export class UpdateEquipmentDto {
  @ApiPropertyOptional({ description: 'ERP 자산코드(FixedAsset.asset_no) — ERP 회신 시 매핑 저장' }) @IsOptional() @IsString() erpAssetCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() manufacturer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() purchaseDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() purchasePrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() warrantyExpiry?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextInspection?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierContact?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() asContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() asContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

// ── 정비/점검/A/S 기록 ──

export class CreateMaintenanceLogDto {
  @ApiProperty({ description: '유형 (PREVENTIVE, REPAIR, AS 등)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: '상태' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: '설명' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ description: '수행자' })
  @IsOptional()
  @IsString()
  performedBy?: string;

  @ApiPropertyOptional({ description: '요청자' })
  @IsOptional()
  @IsString()
  requestedBy?: string;

  @ApiPropertyOptional({ description: '비용' })
  @IsOptional()
  @IsNumber()
  cost?: number;

  @ApiPropertyOptional({ description: '업체' })
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional({ description: '교체 부품' })
  @IsOptional()
  @IsString()
  partReplaced?: string;

  @ApiPropertyOptional({ description: '결과 비고' })
  @IsOptional()
  @IsString()
  resultNotes?: string;

  @ApiProperty({ description: '수행일시' })
  @IsDateString()
  performedAt: string;

  @ApiPropertyOptional({ description: '완료일시' })
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}

// ── 정비 기록 상태 업데이트 ──

export class UpdateMaintenanceLogDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() resultNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() completedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() cost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() partReplaced?: string;
}

// ── 부품 등록 ──

export class CreatePartDto {
  @ApiProperty({ description: '부품명' })
  @IsString()
  @IsNotEmpty()
  partName: string;

  @ApiPropertyOptional({ description: '부품번호' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: '현재 재고' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentStock?: number;

  @ApiPropertyOptional({ description: '최소 재고' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ description: '단가' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional({ description: '공급업체' })
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 부품 수정 ──

export class UpdatePartDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) currentStock?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() unitPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() supplier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() lastOrderedAt?: string;
}

// ── 사용일지 ──

export class CreateUsageLogDto {
  @ApiProperty({ description: '사용일' })
  @IsDateString()
  usedDate: string;

  @ApiProperty({ description: '사용자' })
  @IsString()
  @IsNotEmpty()
  usedBy: string;

  @ApiPropertyOptional({ description: '부서' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: '환자수' })
  @IsOptional()
  @IsNumber()
  patientCount?: number;

  @ApiPropertyOptional({ description: '사용시간' })
  @IsOptional()
  @IsNumber()
  usageHours?: number;

  @ApiPropertyOptional({ description: '사용목적' })
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiPropertyOptional({ description: '상태 (NORMAL, ISSUE 등)' })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({ description: '이슈 사항' })
  @IsOptional()
  @IsString()
  issueNotes?: string;
}

// ── 점검일지 ──

export class CreateInspectionLogDto {
  @ApiProperty({ description: '점검일' })
  @IsDateString()
  inspectionDate: string;

  @ApiProperty({ description: '점검자' })
  @IsString()
  @IsNotEmpty()
  inspectorName: string;

  @ApiProperty({ description: '점검 유형' })
  @IsString()
  @IsNotEmpty()
  inspectionType: string;

  @ApiPropertyOptional({ description: '점검 항목' })
  @IsOptional()
  @IsArray()
  checkItems?: { name: string; result: string; notes?: string }[];

  @ApiProperty({ description: '종합 결과' })
  @IsString()
  @IsNotEmpty()
  overallResult: string;

  @ApiPropertyOptional({ description: '발견 사항' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ description: '조치 사항' })
  @IsOptional()
  @IsString()
  actionTaken?: string;

  @ApiPropertyOptional({ description: '다음 점검 예정일' })
  @IsOptional()
  @IsDateString()
  nextInspectionDate?: string;
}

// ── 장비 상태 변경 ──

export class UpdateEquipmentStatusDto {
  @ApiProperty({ description: '장비 상태' })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional({ description: '다음 점검일' })
  @IsOptional()
  @IsString()
  nextInspection?: string;
}
