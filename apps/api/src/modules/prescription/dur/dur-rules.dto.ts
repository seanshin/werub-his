import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** DUR 룰 개정 DTO — 인라인 @Body 는 ValidationPipe 를 타지 않으므로 DTO 필수(규약) */
export class UpsertDurRuleDto {
  @IsIn(['INTERACTION', 'AGE', 'MAX_DOSE', 'BEERS', 'PEDIATRIC_DOSE'])
  ruleType!: string;

  @IsIn(['ERROR', 'WARNING'])
  severity!: string;

  @IsOptional() @IsString() @MaxLength(100)
  drugA?: string;

  @IsOptional() @IsString() @MaxLength(100)
  drugB?: string;

  @IsOptional()
  keywords?: string[];

  @IsOptional() @IsInt() @Min(0)
  minAge?: number;

  @IsOptional() @IsInt() @Min(0)
  maxAge?: number;

  @IsOptional() @IsNumber() @Min(0)
  maxDailyDose?: number;

  @IsOptional() @IsNumber() @Min(0)
  maxPerKgDay?: number;

  @IsOptional() @IsNumber() @Min(0)
  maxAbsolute?: number;

  @IsOptional() @IsString() @MaxLength(10)
  unit?: string;

  @IsString() @MaxLength(500)
  message!: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @MaxLength(40)
  source?: string; // 위원회 의결번호(GOV-…) 기입 자리
}

/** 영향 미리보기 — 룰 초안 + (수정이면) 비교할 저장된 룰 id(2026-10-21 P4 B2) */
export class PreviewDurRuleDto extends UpsertDurRuleDto {
  @IsOptional() @IsUUID()
  id?: string;
}

