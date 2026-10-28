import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RegimenDrugDto {
  @IsOptional() @IsIn(['CHEMO', 'PREMED', 'HYDRATION', 'GCSF', 'SUPPORT']) role?: string;
  @IsString() @MaxLength(200) drugName!: string;
  @IsOptional() @IsUUID() medicationCodeId?: string;
  @IsOptional() @IsNumber() @Min(0.01) dosePerM2?: number;
  @IsOptional() @IsNumber() @Min(0.01) fixedDose?: number;
  @IsOptional() @IsNumber() @Min(0.01) capMg?: number;
  @IsOptional() @IsNumber() @Min(0.01) bandMg?: number;
  @IsArray() @ArrayNotEmpty() dayOffsets!: number[];
  @IsOptional() @IsString() @MaxLength(200) infusionNote?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class CreateRegimenDto {
  @IsString() @MaxLength(40) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsInt() @Min(7) @Max(56) cycleLengthDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) defaultCycles?: number;
  @IsOptional() @IsString() @MaxLength(200) diagnosisHint?: string;
  @IsOptional() @IsIn(['HIGH', 'MODERATE', 'LOW', 'MINIMAL']) emetogenicity?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'RETIRED']) status?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RegimenDrugDto) drugs!: RegimenDrugDto[];
}

export class UpdateRegimenDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsInt() @Min(7) @Max(56) cycleLengthDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) defaultCycles?: number;
  @IsOptional() @IsString() @MaxLength(200) diagnosisHint?: string;
  @IsOptional() @IsIn(['HIGH', 'MODERATE', 'LOW', 'MINIMAL']) emetogenicity?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'RETIRED']) status?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RegimenDrugDto) drugs?: RegimenDrugDto[];
}

export class CreateCourseDto {
  @IsUUID() patientId!: string;
  @IsUUID() regimenId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @IsOptional() @IsUUID() registryId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) plannedCycles?: number;
  @IsDateString() startDate!: string;
  @IsOptional() @IsNumber() @Min(30) @Max(250) heightCm?: number;
  @IsOptional() @IsNumber() @Min(2) @Max(400) weightKg?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) doseReductionPct?: number;
}

export class UpdateCourseDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) doseReductionPct?: number;
  @IsOptional() @IsString() @MaxLength(300) stopReason?: string;
}

export class StartCycleDto {
  @IsOptional() @IsBoolean() overrideGate?: boolean;
  @IsOptional() @IsString() @MaxLength(300) overrideReason?: string;
}

export class DelayCycleDto {
  @IsInt() @Min(1) @Max(60) days!: number;
  @IsString() @MaxLength(300) reason!: string;
}

export class UpdateCycleDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) doseReductionPct?: number | null;
}
