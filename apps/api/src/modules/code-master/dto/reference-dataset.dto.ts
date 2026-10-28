import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DATASET_KINDS } from '../reference-dataset.service';

/** 🔴 인라인 `@Body` 를 쓰지 않는다 — 검증이 통째로 스킵된다 */
export class StandardCodeRowDto {
  @ApiProperty() @IsString() @Length(8, 14) standardCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(14) representativeCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) ediCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) productName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) maker?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) packageSpec?: string;
}

export class ImportStandardCodesDto {
  /** 🔴 **고시 기준일** — 파일이 말하는 시점이지 올린 날이 아니다 */
  @ApiProperty({ example: '2025-10-31', description: '고시/자료 기준일(YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '기준일은 YYYY-MM-DD 여야 합니다' })
  effectiveDate!: string;

  @ApiProperty({ example: '건강보험심사평가원 약가마스터 의약품표준코드' })
  @IsString() @Length(2, 300) sourceName!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;

  @ApiProperty({ type: [StandardCodeRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => StandardCodeRowDto)
  rows!: StandardCodeRowDto[];
}

export class RecordDatasetDto {
  @ApiProperty({ enum: DATASET_KINDS })
  @IsIn(DATASET_KINDS as unknown as string[]) kind!: string;

  @ApiProperty({ description: '고시 기준일(YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;

  @ApiProperty() @IsString() @Length(2, 300) sourceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/**
 * 🔴 고시 **전체** 코드 목록. 부분 목록을 주면 전 약품이 "빠짐"으로 나오므로
 *    서비스가 하한(100건)을 검사한다 — 판정이 아니라 사고가 되는 것을 막는다.
 */
export class NotInGazetteDto {
  @ApiProperty({ description: '고시에 실린 제품코드 전체', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  codes!: string[];
}

// ── DRG(질병군) 참조 자료 ──

export class DrgSeverityRowDto {
  @ApiProperty() @IsString() @Length(3, 10) diagnosisCode!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(4) score!: number;
}

export class ImportDrgSeverityDto {
  @ApiProperty({ description: '고시 기준일(YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @ApiProperty() @IsString() @Length(2, 300) sourceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiProperty({ type: [DrgSeverityRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => DrgSeverityRowDto) rows!: DrgSeverityRowDto[];
}

export class DrgZeroRowDto {
  @ApiProperty() @IsString() @Length(3, 10) otherDiagnosis!: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) mainDiagnoses!: string[];
}

export class ImportDrgZeroDto {
  @ApiProperty({ description: '고시 기준일(YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @ApiProperty() @IsString() @Length(2, 300) sourceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiProperty({ type: [DrgZeroRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => DrgZeroRowDto) rows!: DrgZeroRowDto[];
}

export class DrgSeverityQueryDto {
  @ApiProperty({ description: '주진단(KCD)' })
  @IsString() @Length(3, 10) mainDiagnosis!: string;
  @ApiProperty({ type: [String], description: '기타진단 목록' })
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(100) otherDiagnoses!: string[];
}

export class DrgSeparateRowDto {
  @ApiProperty() @IsString() @Length(1, 20) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) gazetteClass?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) calcName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) benefitType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) validTo?: string;
}

export class ImportDrgSeparateDto {
  @ApiProperty({ description: '고시 기준일(YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @ApiProperty() @IsString() @Length(2, 300) sourceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiProperty({ type: [DrgSeparateRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => DrgSeparateRowDto) rows!: DrgSeparateRowDto[];
}

export class SeparateBillableQueryDto {
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) codes!: string[];
  @ApiPropertyOptional({ description: '판정 시점(YYYY-MM-DD·기본 오늘)' })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) onDate?: string;
}

export class DrugPriceRowDto {
  @ApiProperty() @IsString() @Length(1, 20) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) nameKo?: string;
  @ApiPropertyOptional({ description: '🔴 금액을 모르면 보내지 않는다 — 0 은 "무료"라는 다른 사실이다' })
  @IsOptional() @IsInt() @Min(0) price?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) ingredientCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) route?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) spec?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) manufacturer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) classNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) note?: string;
}

export class ImportDrugPriceDto {
  @ApiProperty({ description: '고시 시행일(YYYY-MM-DD) — 이 날짜가 곧 적용 시점이다' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @ApiProperty() @IsString() @Length(2, 300) sourceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) contentHash?: string;
  @ApiProperty({ type: [DrugPriceRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => DrugPriceRowDto) rows!: DrugPriceRowDto[];
}

export class DrugPriceOnQueryDto {
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(500) codes!: string[];
  @ApiPropertyOptional({ description: '판정 시점(YYYY-MM-DD·기본 오늘) — 진료일을 넣는다' })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) onDate?: string;
}

export class ProcedureFeeRowDto {
  @ApiProperty() @IsString() @Length(1, 20) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) gazetteClass?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) nameKo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) benefitType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) domain?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceClinic?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceHospital?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceDental?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceHealthCtr?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceMidwife?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceOriental?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceNursing?: number;
  @ApiPropertyOptional() @IsOptional() rvu?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() copay50?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() copay80?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() copay90?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5) duplicateOk?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) calcName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5) isSurgery?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) appliedOn?: string;
}

export class ImportProcedureFeeDto {
  @ApiProperty({ description: '고시 시행일(YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @ApiProperty() @IsString() @Length(2, 300) sourceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) contentHash?: string;
  @ApiProperty({ type: [ProcedureFeeRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProcedureFeeRowDto) rows!: ProcedureFeeRowDto[];
}

export class FeeOnQueryDto {
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(500) codes!: string[];
  @ApiPropertyOptional({ description: '판정 시점(YYYY-MM-DD·기본 오늘)' })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) onDate?: string;
  @ApiPropertyOptional({ description: '종별을 명시해 확인할 때만 — 비우면 `billing.institution.grade` 설정을 따른다' })
  @IsOptional() @IsString() @MaxLength(20) tier?: string;
}
