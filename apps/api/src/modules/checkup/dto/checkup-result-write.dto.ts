import { IsDateString, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 B4) 검진 예약·결과·판독·추적·의뢰 쓰기 8종 — 종전 인라인 타입(ValidationPipe 스킵).
 *
 * - 길이는 스키마 VarChar 근거(`CheckupResultItem`·`CheckupInterpretation`·`CheckupFollowUp`·`CheckupReferral`).
 *   종전엔 초과분이 Prisma 500 이었다 — 결과·소견·사유는 임상 기록이라 **자르지 않고 400** 으로 돌려준다(U4 규칙).
 * - uuid 는 `@db.Uuid` 근거 · 날짜는 서비스 `checkupDateOnly` 가 한 번 더 400 으로 막는다.
 * - 판정 어휘(finding NORMAL·ABNORMAL…·grade A~D2)·검사 분류(category)·의뢰 긴급도는 도메인 판정이라 막지 않는다.
 * - 화면(his-checkup/visit/[id])은 결과 입력에서 `unit:''`·`referenceRange:''` 를 보낸다 — 빈 문자열을 막지 않는다.
 */
const present = (_: object, v: unknown) => v !== '' && v !== null && v !== undefined;

export class CancelCheckupVisitDto {
  @ApiPropertyOptional({ description: '취소 사유(여정 이벤트·selectedOptions 에 남는다)' }) @IsOptional() @IsString() reason?: string;
}

export class RescheduleCheckupVisitDto {
  @ApiPropertyOptional({ example: '2026-09-20' }) @ValidateIf(present) @IsDateString() scheduledDate?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() programId?: string;
}

export class SkipCheckupItemDto {
  @ApiProperty() @IsString() @MaxLength(200) testName!: string;
  @ApiProperty({ description: '스킵 사유(원장 note 에 남는다)' }) @IsString() reason!: string;
}

export class AddCheckupResultDto {
  @ApiProperty({ description: 'LAB·IMAGING·DIAGNOSTIC·PHYSICAL (스키마 주석)' }) @IsString() @MaxLength(20) category!: string;
  @ApiPropertyOptional({ description: '검사코드 — 프로토콜 판정룰 매칭' }) @IsOptional() @IsString() @MaxLength(30) testCode?: string;
  @ApiProperty() @IsString() @MaxLength(200) testName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) value?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) referenceRange?: string;
  @ApiPropertyOptional({ description: '입력 판정(자동 판정이 있으면 서버가 우선)' }) @IsOptional() @IsString() @MaxLength(20) finding?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class AddCheckupPanelResultsDto {
  @ApiPropertyOptional({ description: '구 경로(패널 지정)' }) @IsOptional() @IsString() panelCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) category?: string;
  @ApiPropertyOptional({ description: '정본 — 그 항목의 검사코드를 서버가 편다' }) @IsOptional() @IsString() @MaxLength(200) parentTestName?: string;
  /** 분석물 코드 → 값. 미지 코드는 서비스가 코드 이름을 들어 400 으로 말한다 */
  @ApiPropertyOptional({ example: { TC: '210', HDL: 45 } }) @IsOptional() @IsObject() values?: Record<string, string | number>;
}

export class CompleteCheckupInterpretationDto {
  @ApiProperty() @IsString() finding!: string;
  @ApiProperty({ description: '판정 등급 A~D2 (VarChar 5)' }) @IsString() @MaxLength(5) grade!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() recommendation?: string;
}

export class CreateCheckupFollowUpDto {
  @ApiProperty({ description: 'RECHECK·OUTPATIENT·SCREENING (스키마 주석)' }) @IsString() @MaxLength(30) followUpType!: string;
  @ApiProperty() @IsString() @MaxLength(500) description!: string;
  @ApiProperty({ example: '2027-03-15' }) @IsDateString() dueDate!: string;
}

export class CreateCheckupReferralDto {
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() resultItemId?: string;
  @ApiProperty() @IsString() @MaxLength(50) toDepartment!: string;
  @ApiProperty() @IsString() reason!: string;
  @ApiPropertyOptional({ description: 'ROUTINE·URGENT (기본 ROUTINE)' }) @IsOptional() @IsString() @MaxLength(20) urgency?: string;
}
