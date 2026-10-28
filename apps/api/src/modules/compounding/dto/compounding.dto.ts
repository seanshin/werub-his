import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsIn, IsBoolean, IsNumber, IsInt,
  IsArray, IsDateString, Min, Max, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 무균조제(IV/TPN/CHEMO) DTO — 🔴 인라인 @Body 승격(2026-08-18)
 *
 * 종전 컨트롤러는 `Parameters<CompoundingService['createOrder']>[0]`(인터페이스)·
 * 인라인 객체·`@Body('budHours')` 였다. 인터페이스와 인라인 타입은 런타임 메타타입이 `Object` 라
 * **전역 ValidationPipe 가 통째로 스킵**된다. 실제 피해:
 *   · 🔴 항암 용량 계산기: 키·체중·mg/m² 가 무검증이라 빈 값이면 `BSA 0`·`finalDose NaN`(응답 `null`)
 *     이 나왔다 — **항암 용량 화면이 숫자를 만들어내는 자리**다. 음수 키/체중도 통과했다.
 *   · `patientId` 가 uuid 가 아니면 Prisma P2023(500). 400 이어야 한다.
 *   · `computedVolumeMl`·`orderedAmount` 음수 허용.
 * 화면(`apps/web/.../compounding/page.tsx`)이 실제로 보내는 키를 기준으로 작성했다.
 */

export class CompoundingComponentInputDto {
  @ApiProperty({ description: '역할(BASE_FLUID/ADDITIVE 등)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  role: string;

  @ApiProperty({ description: '성분명' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: '약품코드 ID' })
  @IsOptional()
  @IsUUID()
  medicationCodeId?: string;

  @ApiPropertyOptional({ description: '지시량' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  orderedAmount?: number;

  @ApiPropertyOptional({ description: '단위' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  amountUnit?: string;

  @ApiPropertyOptional({ description: '계산 용량(mL)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  computedVolumeMl?: number;

  @ApiPropertyOptional({ description: '정렬 순서' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateCompoundingOrderDto {
  @ApiProperty({ description: '조제 유형', enum: ['IV_RX', 'TPN', 'CHEMO'] })
  @IsIn(['IV_RX', 'TPN', 'CHEMO'], { message: 'sourceType은 IV_RX/TPN/CHEMO' })
  sourceType: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: 'patientId 는 UUID 여야 합니다' })
  patientId: string;

  @ApiPropertyOptional({ description: '연결 처방 ID' })
  @IsOptional()
  @IsUUID()
  prescriptionId?: string;

  @ApiPropertyOptional({ description: '연결 특수영양 오더 ID' })
  @IsOptional()
  @IsUUID()
  specialNutritionOrderId?: string;

  @ApiPropertyOptional({ description: '우선순위(ROUTINE/URGENT/STAT)' })
  @IsOptional()
  @IsIn(['ROUTINE', 'URGENT', 'STAT'])
  priority?: string;

  @ApiPropertyOptional({ description: '위험약물(항암) 여부 — 미지정 시 CHEMO 는 자동 true' })
  @IsOptional()
  @IsBoolean()
  isHazardous?: boolean;

  @ApiPropertyOptional({ description: '조제 기한' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: '조성 성분', type: [CompoundingComponentInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompoundingComponentInputDto)
  components?: CompoundingComponentInputDto[];
}

/**
 * 항암 용량 계산 — 🔴 값은 **환자에게 들어갈 mg 을 만든다**. 표본 없는 계산은 0 이 아니라 거부다.
 * 범위: 키 20~300cm · 체중 0.3~500kg(신생아~고도비만) · mg/m² 는 양수.
 */
export class ChemoDoseDto {
  @ApiProperty({ description: '키(cm)' })
  @IsNumber({}, { message: 'heightCm 은 숫자여야 합니다' })
  @Min(20, { message: 'heightCm 은 20cm 이상이어야 합니다' })
  @Max(300)
  heightCm: number;

  @ApiProperty({ description: '체중(kg)' })
  @IsNumber({}, { message: 'weightKg 는 숫자여야 합니다' })
  @Min(0.3, { message: 'weightKg 는 0.3kg 이상이어야 합니다' })
  @Max(500)
  weightKg: number;

  @ApiProperty({ description: '단위 용량(mg/m²)' })
  @IsNumber({}, { message: 'dosePerM2 는 숫자여야 합니다' })
  @Min(0.0001, { message: 'dosePerM2 는 양수여야 합니다' })
  dosePerM2: number;

  @ApiPropertyOptional({ description: '상한(mg)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  capMg?: number;

  @ApiPropertyOptional({ description: '용량밴딩 단위(mg)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bandMg?: number;
}

export class CompoundingComponentVolumeDto {
  @ApiProperty({ description: '성분 ID' })
  @IsUUID()
  id: string;

  @ApiPropertyOptional({ description: '계산 용량(mL)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  computedVolumeMl?: number;
}

export class CalculateCompoundingDto {
  @ApiPropertyOptional({ description: '성분별 계산 용량', type: [CompoundingComponentVolumeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompoundingComponentVolumeDto)
  components?: CompoundingComponentVolumeDto[];
}

export class CompoundingComponentLotDto {
  @ApiProperty({ description: '성분 ID' })
  @IsUUID()
  id: string;

  @ApiPropertyOptional({ description: '로트번호' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lotNumber?: string;

  @ApiPropertyOptional({ description: '유효기간' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class PrepCompoundingDto {
  /** 🔴 항암은 서비스가 BSC_II/ISOLATOR 만 허용한다 — 그 밖의 값이 비항암에 자유롭게 저장되던 것을 막는다. */
  @ApiProperty({ description: '작업대 유형', enum: ['BSC_II', 'ISOLATOR', 'LAF', 'CLEAN_BENCH'] })
  @IsIn(['BSC_II', 'ISOLATOR', 'LAF', 'CLEAN_BENCH'], { message: 'hoodType 은 BSC_II|ISOLATOR|LAF|CLEAN_BENCH 여야 합니다' })
  hoodType: string;

  @ApiPropertyOptional({ description: '성분별 로트·유효기간', type: [CompoundingComponentLotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompoundingComponentLotDto)
  componentLots?: CompoundingComponentLotDto[];
}

export class VerifyCompoundingDto {
  /** BUD = 사용기한. 무제한 값이 들어오면 라벨에 수년짜리 사용기한이 찍힌다(최대 720h=30일). */
  @ApiPropertyOptional({ description: 'BUD 시간(h·기본 24)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(720)
  budHours?: number;
}

export class CancelCompoundingDto {
  @ApiPropertyOptional({ description: '취소 사유' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
