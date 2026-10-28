import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShiftType } from '@prisma/client';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

/**
 * 🔴 (2026-09-15 B7) 간호 체크리스트·중재·결과 평가 쓰기 5 핸들러가 인라인 타입·`@Body('status')` 원시 추출이었다.
 *  - 체크 항목 `checked` 는 문자열 `"false"` 도 참으로 읽혀 **해제를 누르면 체크**되고 완료 시각까지 찍혔다(IsBoolean).
 *  - `shiftType` 은 `as any` 로 enum 컬럼에 들어가 오타면 Prisma 500 — 스키마 enum 으로 400.
 *  - 중재 상태·결과 점수는 서비스가 이미 막고 있었다(어휘 4종·0~100 정수) — 같은 규칙을 입구에서도 말한다.
 * 템플릿 종류(templateType) 어휘는 지어내지 않는다 — 서비스가 테이블 정본→코드 폴백으로 판정한다(길이만).
 */
export const NURSING_INTERVENTION_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'DISCONTINUED'] as const;

export class CreateNursingChecklistDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) templateType!: string;
  @ApiPropertyOptional({ enum: ShiftType }) @IsOptional() @IsEnum(ShiftType) shiftType?: ShiftType;
}

export class ToggleNursingChecklistItemDto {
  /** 🔴 문자열 `"false"` 는 400 — 종전엔 참으로 읽혀 체크됐다 */
  @ApiProperty() @IsBoolean() checked!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateNursingInterventionStatusDto {
  @ApiProperty({ enum: NURSING_INTERVENTION_STATUSES }) @IsIn(NURSING_INTERVENTION_STATUSES) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class EvaluateNursingOutcomeDto {
  @ApiProperty() @IsInt() @Min(0) @Max(100) currentScore!: number;
}

export class UpsertNursingChecklistTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsString({ each: true }) @IsNotEmpty({ each: true })
  items?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  /** 개정 근거(위원회 의결번호 자리) */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) source?: string;
}
