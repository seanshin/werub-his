import { IsString, IsOptional, IsDateString, IsObject, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateDischargeSummaryDto {
  @ApiProperty()
  @IsDateString()
  admitDate: string;

  @ApiProperty()
  @IsDateString()
  dischargeDate: string;

  @ApiProperty()
  @IsString()
  admitDiagnosis: string;

  @ApiProperty()
  @IsString()
  dischargeDiagnosis: string;

  @ApiProperty({ description: 'KCD 코드 목록 (JSON)' })
  @IsObject()
  diagnosisCodes: object;

  @ApiProperty()
  @IsString()
  hospitalCourse: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  procedures?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  significantFindings?: string;

  @ApiProperty()
  @IsString()
  conditionAtDischarge: string;

  @ApiProperty({ description: '퇴원약 목록 (JSON)' })
  @IsObject()
  dischargeMedications: object;

  @ApiProperty()
  @IsString()
  followUpPlan: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dietaryInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activityRestrictions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patientEducation?: string;
}

/**
 * 🔴 (2026-09-15 B10) 퇴원요약 수정 — `Partial<CreateDischargeSummaryDto>` 는 런타임 metatype 이 `Object` 라
 *    ValidationPipe 가 **통째로 스킵**됐다(날짜 오류 Prisma 500 · JSON 칸에 아무 값). `PartialType` 은 원 클래스 검증을 물려받는다.
 */
export class UpdateDischargeSummaryDto extends PartialType(CreateDischargeSummaryDto) {
  /** 정정 사유(2026-10-03 · 선택) — 서명본을 정정하는 순간에만 보존본에 남는다 · 정정 항목이 아니다 */
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) amendmentReason?: string;
}
