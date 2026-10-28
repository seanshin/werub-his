import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 T2) ADR(약물이상반응) 보고 — 종전 인라인 @Body 였고 서비스가 `{ ...data }` 를 그대로 Prisma create 에 펼쳤다.
 * ValidationPipe 가 스킵돼 본문에 `isSerious`·`reportType` 같은 원장 컬럼을 넣으면 그대로 저장될 수 있었고,
 * `onsetDate: ''` 는 Invalid Date 로 500 이 났다. 길이는 `AdverseReactionReport` 스키마 VarChar 그대로.
 * 어휘(severity·outcome 등)는 스키마 주석에만 있고 정본 상수가 없어 강제하지 않는다(지어내지 않는다).
 */
export class CreateAdrDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) suspectedDrugName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) suspectedDrugCode?: string;
  @ApiProperty() @IsString() @IsNotEmpty() reactionDescription!: string;
  @ApiProperty({ example: '2026-09-14' }) @IsDateString() onsetDate!: string;
  @ApiProperty({ description: 'MILD·MODERATE·SEVERE·FATAL' }) @IsString() @IsNotEmpty() @MaxLength(10) severity!: string;
  @ApiProperty({ description: 'RECOVERED·RECOVERING·NOT_RECOVERED·FATAL·UNKNOWN' }) @IsString() @IsNotEmpty() @MaxLength(15) outcome!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) causalityAssessment?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() naranjoScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) actionTaken?: string;
  @ApiPropertyOptional({ description: '후속보고 → 원보고' }) @IsOptional() @IsUUID() parentReportId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seriousDeath?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seriousLifeThreat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seriousHospital?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seriousDisability?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seriousCongenital?: boolean;
}
