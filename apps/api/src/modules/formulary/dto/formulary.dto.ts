import { ArrayMaxSize, IsString, IsOptional, IsUUID, IsArray, IsBoolean, IsIn, IsNotEmpty, ValidateNested, MaxLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DOMAINS = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING'];

export class FormularyItemInput {
  @ApiPropertyOptional({ description: '마스터 코드 ID' })
  @IsOptional()
  @IsUUID()
  codeId?: string;

  @ApiPropertyOptional({ description: '프리셋 키(치료/활동)' })
  @IsOptional()
  @IsString()
  presetKey?: string;

  @ApiPropertyOptional({ description: '표시용 라벨' })
  @IsOptional()
  @IsString()
  label?: string;
}

export class AddFormularyDto {
  @ApiProperty({ enum: DOMAINS })
  @IsIn(DOMAINS)
  domain!: string;

  @ApiProperty({ type: [FormularyItemInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormularyItemInput)
  items!: FormularyItemInput[];

  @ApiPropertyOptional({ description: '결정 위원회' })
  @IsOptional()
  @IsString()
  committee?: string;

  @ApiPropertyOptional({ description: '결정 메모' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ToggleFormularyDto {
  @ApiProperty({ enum: DOMAINS })
  @IsIn(DOMAINS)
  domain!: string;

  @ApiProperty({ description: '마스터 코드 ID' })
  @IsUUID()
  codeId!: string;
}

export class UpdateFormularyDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'REMOVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'REMOVED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  committee?: string;
}

export class CreateFormularyRequestDto {
  @ApiProperty({ enum: DOMAINS })
  @IsIn(DOMAINS)
  domain!: string;

  @ApiPropertyOptional({ description: '마스터 코드 ID(있으면)' })
  @IsOptional()
  @IsUUID()
  codeId?: string;

  @ApiPropertyOptional({ description: '표시용 코드·명' })
  @IsOptional()
  @IsString()
  codeLabel?: string;

  @ApiPropertyOptional({ description: '마스터에 없는 신규 항목명' })
  @IsOptional()
  @IsString()
  freeText?: string;

  @ApiProperty({ description: '임상 사유(필수)' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ enum: ['ROUTINE', 'URGENT'] })
  @IsOptional()
  @IsIn(['ROUTINE', 'URGENT'])
  urgency?: string;
}

export class DecideFormularyRequestDto {
  @ApiProperty({ description: '승인 여부' })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({ description: '심의 메모(반려 시 필수)' })
  @IsOptional()
  @IsString()
  decision?: string;

  @ApiPropertyOptional({ description: '결정 위원회' })
  @IsOptional()
  @IsString()
  committee?: string;
}

/** CSV 일괄 등재 — dryRun=true 는 쓰지 않고 행별 판정만 돌려준다. 열: code(또는 presetKey)·codeSystem·validFrom·note */
export class ImportFormularyCsvDto {
  @ApiProperty({ enum: DOMAINS })
  @IsIn(DOMAINS)
  domain!: string;

  @ApiProperty({ description: 'CSV 원문(UTF-8 · 머리글 필수 · 최대 1MB·2000행)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000_000)
  csv!: string;

  @ApiProperty({ description: 'true=미리보기(쓰기 없음) · false=확정' })
  @IsBoolean()
  dryRun!: boolean;

  @ApiPropertyOptional({ description: '결정 위원회' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  committee?: string;

  @ApiPropertyOptional({ description: '행에 note 가 없을 때 쓰는 결정 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * (2026-09-15 B10) 사용 실적 일괄 등재 — `months: "abc"` 는 `NaN` 기준일로 Prisma 500 · 음수는 미래 기준일로 0건 "성공"이었다.
 */
export class SeedFormularyFromUsageDto {
  @ApiPropertyOptional({ description: '최근 N개월(기본 6)', minimum: 1, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  months?: number;
}

/** (2026-09-15 B10) AI 체크리스트 초안 시작 — 영역·주제 검사는 서비스에 있다. 주제 길이는 프롬프트로 그대로 들어가므로 상한을 둔다. */
export class StartFormularyAiDraftDto {
  @ApiProperty({ enum: DOMAINS }) @IsIn(DOMAINS) domain: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) topic: string;
}

/**
 * 🔴 (2026-09-15 B10) 체크리스트 저장 — 인라인 본문이었다. `aiGenerated: "false"`(문자열)가 `!!` 로 **참**이 되어
 *    사람이 만든 목록에 AI 생성 표기가 붙었다(AI 표기는 사실이어야 한다 — AI기본법 §31).
 *    이름·설명 길이는 서비스가 잘라 저장하고 `truncatedFields` 로 알린다(U4) — DTO 는 길이로 막지 않는다.
 */
export class CreateFormularyListDto {
  @ApiProperty({ enum: DOMAINS }) @IsIn(DOMAINS) domain: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ description: '[{ category, items: [{ codeId, code, label }] }]' }) @IsArray() items: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() aiGenerated?: boolean;
}

/** 코드 묶음 처방집 상태 조회(2026-10-21 임상 규칙 P4 A8 · 세트 편집기용 · 읽기 전용) */
export class FormularyStatusOfDto {
  @ApiProperty({ enum: DOMAINS }) @IsIn(DOMAINS)
  domain!: string;

  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true })
  codeIds!: string[];
}
