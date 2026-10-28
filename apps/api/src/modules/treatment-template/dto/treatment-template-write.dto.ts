import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested,
} from 'class-validator';

/**
 * 🔴 (2026-09-15 B9) 치료일정 템플릿 쓰기 4 EP — 인라인 타입이라 ValidationPipe 가 건너뛰었다.
 *  · 🔴 일정 항목 변경 `cancel: "false"`(문자열)는 **참**으로 읽혀 일정 항목과 연계된 미결 사전처방까지 취소됐다.
 *    `shiftFollowing: "false"` 도 참이라 이후 항목이 일괄 이동했다 — 진짜 불리언만 받는다.
 *  · 전개(`apply`) `anchorDate` 는 서비스가 `${날짜}T00:00:00+09:00` 로 조립한다 — 날짜만(YYYY-MM-DD) 받는다
 *  · 작성자·전개자는 로그인 사용자(컨트롤러)
 * 제목(200)·메모(300)·사유(150)는 **서비스가 잘라 저장하고 `truncatedFields` 로 말한다**(U4) — 여기서 길이로 400 내지 않는다.
 * 항목 유형 어휘 검사도 서비스 정본(`ITEM_TYPES`)이 한다.
 */
export class TemplateItemInputDto {
  @IsNumber() dayOffset!: number;
  @IsOptional() @IsString() @MaxLength(5) timeOfDay?: string | null;
  @IsString() @IsNotEmpty() itemType!: string;
  @IsString() title!: string;
  @IsOptional() @IsUUID() refCodeId?: string | null;
  @IsOptional() @IsNumber() repeatEvery?: number | null;
  @IsOptional() @IsNumber() repeatCount?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() notes?: string | null;
}

export class CreateTreatmentTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(50) department?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() totalDays?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateItemInputDto) items?: TemplateItemInputDto[];
}

/** 수정 — 상태(`status`)는 상태 전이 EP(게이트)가 정본이라 받지 않는다 · items 는 전체 교체 */
export class UpdateTreatmentTemplateDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(50) department?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsNumber() totalDays?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateItemInputDto) items?: TemplateItemInputDto[];
}

export class UpdateScheduleItemDto {
  @IsOptional() @IsDateString() plannedAt?: string;
  @IsOptional() @IsBoolean() cancel?: boolean;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() shiftFollowing?: boolean;
}

export class ApplyTreatmentTemplateDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) anchorDate!: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) selectedItemIds?: string[];
}
