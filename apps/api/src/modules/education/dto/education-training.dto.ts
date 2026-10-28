import { IsArray, IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 U2) 수련 로그북·EPA·로테이션·증례 발표 쓰기 4종 — 종전 `@Body() body: Record<string, unknown>` 라
 *    ValidationPipe 가 통째로 스킵됐다. 날짜 문자열이 아니면 `new Date('abc')` → Prisma 500, 나이·위임 수준이 문자면
 *    `Number('abc')` = NaN → 500, VarChar 길이 초과 → 500. 필드는 서비스가 실제로 읽는 것만 · 길이는 스키마 VarChar 근거.
 *    어휘(category·role·complexity·outcome·caseType)는 서비스 기본값만 있고 정본 어휘가 없어 막지 않는다(길이만).
 */

export class AddLogbookEntryDto {
  @ApiPropertyOptional({ description: '시행일 YYYY-MM-DD(없으면 오늘)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'PROCEDURE|CASE|LECTURE|CONFERENCE (스키마 주석)' }) @IsOptional() @IsString() @MaxLength(20) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) procedureName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) icdCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) supervisor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) department?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) patientAge?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) complexity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) outcome?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reflection?: string;
}

export class AddEpaAssessmentDto {
  @ApiPropertyOptional({ description: 'EPA 번호(없으면 EPA-0)' }) @IsOptional() @IsString() @MaxLength(20) epaNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) epaTitle?: string;
  /** 스키마 주석 `1~5` — 위임 수준 척도 범위 */
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) entrustmentLevel?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) assessor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) assessorRole?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clinicalContext?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() strengths?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() improvements?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() feedback?: string;
}

export class AssignRotationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) residentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) residentName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) department?: string;
  /** 스키마 VarChar(10) 문자열 날짜 — 형식이 다르면 저장은 되지만 정렬·표시가 깨진다 */
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @ApiPropertyOptional({ example: '2026-11-30' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) supervisor?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() objectives?: unknown[];
}

export class AddCasePresentationDto {
  /** 서비스가 없으면 '(제목없음)' 으로 채운다 — 종전에 통과하던 요청을 400 으로 바꾸지 않게 필수로 올리지 않는다 */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) presenter?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) department?: string;
  @ApiPropertyOptional({ description: '발표일 YYYY-MM-DD(없으면 오늘)' }) @IsOptional() @IsDateString() presentationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) caseType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() summary?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() learningPoints?: unknown[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() attendees?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() feedback?: string;
}
