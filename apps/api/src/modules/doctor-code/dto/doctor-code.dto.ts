import {
  IsString, IsNumber, IsOptional, IsBoolean, IsUUID,
  IsNotEmpty, Min, IsArray, IsInt, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 의사 개인 코드 추가 ──

export class AddDoctorCodeDto {
  @ApiProperty({ description: '분류 (MEDICATION, LAB, IMAGING)' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '코드 ID' })
  @IsUUID()
  codeId: string;

  @ApiProperty({ description: '코드 타입 (MEDICATION_CODE, PROCEDURE_CODE)' })
  @IsString()
  @IsNotEmpty()
  codeType: string;

  @ApiPropertyOptional({ description: '표시 이름' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ description: '기본 용량' })
  @IsOptional()
  @IsString()
  defaultDosage?: string;

  @ApiPropertyOptional({ description: '기본 빈도' })
  @IsOptional()
  @IsString()
  defaultFrequency?: string;

  @ApiPropertyOptional({ description: '기본 기간(일)' })
  @IsOptional()
  @IsNumber()
  defaultDuration?: number;

  @ApiPropertyOptional({ description: '기본 투여경로' })
  @IsOptional()
  @IsString()
  defaultRoute?: string;

  @ApiPropertyOptional({ description: '즐겨찾기 고정' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

// ── 의사 코드 수정 ──

export class UpdateDoctorCodeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultDosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultFrequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() defaultDuration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultRoute?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPinned?: boolean;
}

// ── 진료과 카탈로그 코드 추가 ──

export class AddCatalogItemDto {
  @ApiProperty({ description: '진료과명' })
  @IsString()
  @IsNotEmpty()
  departmentName: string;

  @ApiPropertyOptional({ description: '서브카테고리' })
  @IsOptional()
  @IsString()
  subcategory?: string;

  @ApiProperty({ description: '코드 ID' })
  @IsUUID()
  codeId: string;

  @ApiProperty({ description: '코드 타입' })
  @IsString()
  @IsNotEmpty()
  codeType: string;

  @ApiPropertyOptional({ description: '기본 용량' })
  @IsOptional()
  @IsString()
  defaultDosage?: string;

  @ApiPropertyOptional({ description: '기본 빈도' })
  @IsOptional()
  @IsString()
  defaultFrequency?: string;

  @ApiPropertyOptional({ description: '기본 기간(일)' })
  @IsOptional()
  @IsNumber()
  defaultDuration?: number;

  @ApiPropertyOptional({ description: '기본 투여경로' })
  @IsOptional()
  @IsString()
  defaultRoute?: string;

  @ApiPropertyOptional({ description: '최대 용량' })
  @IsOptional()
  @IsString()
  maxDosage?: string;

  @ApiPropertyOptional({ description: '가이드 노트' })
  @IsOptional()
  @IsString()
  guideNote?: string;
}

// ── 카탈로그 코드 수정 ──

export class UpdateCatalogItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() subcategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultDosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultFrequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() defaultDuration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultRoute?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() maxDosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guideNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── 처방 세트 (2026-09-15 B5) ──
// 🔴 종전 `@Body() body: Record<string, unknown>` 이 수정 경로에서 `{ ...updates }` 로 Prisma data 에 그대로 갔다 —
//    본문의 `doctorId` 가 세트를 다른 의사에게 옮기고 `useCount`·`isActive` 를 위조할 수 있었다.
//    화면(settings/my-codes SetCreateModal)은 항목 `codeId: ''`(자유 입력 항목)를 보낸다 — 형식을 강제하지 않는다.

export class PrescriptionSetItemDto {
  // items 는 Json 컬럼 — 스키마 길이 근거가 없어 모양(형)만 본다
  @ApiProperty({ description: '코드 ID(자유 입력 항목은 빈 문자열)' }) @IsString() codeId: string;
  @ApiProperty({ description: '코드 타입' }) @IsString() codeType: string;
  @ApiProperty({ description: '항목 이름' }) @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() frequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() route?: string;
}

export class CreatePrescriptionSetDto {
  @ApiProperty({ description: '세트 이름' }) @IsString() @MaxLength(200) name: string; // VarChar(200)
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string; // VarChar(50)
  @ApiProperty({ type: [PrescriptionSetItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrescriptionSetItemDto)
  items: PrescriptionSetItemDto[];
}

export class UpdatePrescriptionSetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
  @ApiPropertyOptional({ type: [PrescriptionSetItemDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PrescriptionSetItemDto)
  items?: PrescriptionSetItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class ImportDoctorCodeCatalogDto {
  @ApiProperty({ description: '진료과명' }) @IsString() @MaxLength(100) department: string;
  @ApiProperty({ description: '카탈로그 코드 ID 목록' }) @IsArray() @IsUUID('all', { each: true }) codeIds: string[]; // code_id @db.Uuid — 종전 Prisma 500
}
