import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CPOE_QI_KEYS, QI_ACTION_STATUSES } from '@hospital-run/shared';

export class CpoeQualityQueryDto {
  @ApiPropertyOptional({ description: '시작일 YYYY-MM-DD(기본: 종료일 30일 전)' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: '종료일 YYYY-MM-DD(그 날 포함 · 기본: 오늘)' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ description: '책임 처방의 user id(관리자만 · 의사는 늘 본인)' })
  @IsOptional() @IsUUID()
  prescriberId?: string;
}

export class CpoeSpcQueryDto {
  @ApiProperty({ enum: CPOE_QI_KEYS })
  @IsIn(CPOE_QI_KEYS as unknown as string[])
  key!: (typeof CPOE_QI_KEYS)[number];

  @ApiPropertyOptional({ description: '개월 수(3~24 · 기본 12 · 이번 달 포함)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(24)
  months?: number;

  @ApiPropertyOptional({ description: '책임 처방의 user id(관리자만 · 의사는 늘 본인)' })
  @IsOptional() @IsUUID()
  prescriberId?: string;
}

export class RecordCpoeMeasurementDto {
  @ApiProperty({ enum: CPOE_QI_KEYS })
  @IsIn(CPOE_QI_KEYS as unknown as string[])
  key!: (typeof CPOE_QI_KEYS)[number];

  @ApiProperty({ description: '측정 연월 YYYY-MM(끝난 달만)' })
  @Matches(/^\d{4}-\d{2}$/)
  period!: string;
}

export class CreateImprovementDto {
  // 2026-10-08 — CPOE 지표(indicatorKey) 또는 질 지표 원장 지표(indicatorId) 중 하나. 둘 다/둘 다 없음은 400
  @ApiPropertyOptional({ enum: CPOE_QI_KEYS })
  @IsOptional() @IsIn(CPOE_QI_KEYS as unknown as string[])
  indicatorKey?: (typeof CPOE_QI_KEYS)[number];

  @ApiPropertyOptional({ description: '질 지표 원장 지표 id(일반 지표 — 낙상·손위생 등)' })
  @IsOptional() @IsUUID()
  indicatorId?: string;

  @ApiPropertyOptional({ description: '공급원 없는 지표만 — 사람이 센 기준선 분자(출처 MANUAL)' })
  @IsOptional() @IsInt() @Min(0)
  baselineNumerator?: number;

  @ApiPropertyOptional({ description: '공급원 없는 지표만 — 사람이 센 기준선 분모(출처 MANUAL)' })
  @IsOptional() @IsInt() @Min(1)
  baselineDenominator?: number;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ description: '문제(무엇이 신호였나)' }) @IsString() @IsNotEmpty()
  problem!: string;

  @ApiPropertyOptional({ description: '원인 분석' }) @IsOptional() @IsString()
  rootCause?: string;

  @ApiProperty({ description: '개선 계획' }) @IsString() @IsNotEmpty()
  plan!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: '기한 YYYY-MM-DD' }) @IsOptional() @IsString()
  dueDate?: string;

  @ApiPropertyOptional({ description: '시작 신호(관리도 달 YYYY-MM 등)' }) @IsOptional() @IsString() @MaxLength(20)
  triggerPeriod?: string;

  @ApiProperty({ description: '기준선 시작일 YYYY-MM-DD' }) @IsString()
  baselineFrom!: string;

  @ApiProperty({ description: '기준선 종료일 YYYY-MM-DD(그 날 포함)' }) @IsString()
  baselineTo!: string;
}

export class TransitImprovementDto {
  @ApiProperty({ enum: QI_ACTION_STATUSES })
  @IsIn(QI_ACTION_STATUSES as unknown as string[])
  to!: (typeof QI_ACTION_STATUSES)[number];

  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}

export class ImprovementNoteDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  note!: string;
}

export class ImprovementCheckDto {
  @ApiProperty({ description: '효과 확인 시작일 YYYY-MM-DD' }) @IsString()
  from!: string;

  @ApiPropertyOptional({ description: '기준선이 MANUAL 인 활동만 — 사람이 센 분자' }) @IsOptional() @IsInt() @Min(0)
  numerator?: number;

  @ApiPropertyOptional({ description: '기준선이 MANUAL 인 활동만 — 사람이 센 분모' }) @IsOptional() @IsInt() @Min(1)
  denominator?: number;

  @ApiProperty({ description: '효과 확인 종료일 YYYY-MM-DD(그 날 포함)' }) @IsString()
  to!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}

export class ImprovementListQueryDto {
  @ApiPropertyOptional({ description: 'OPEN(진행 중 전부) 또는 상태 하나' }) @IsOptional() @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: CPOE_QI_KEYS }) @IsOptional() @IsIn(CPOE_QI_KEYS as unknown as string[])
  indicatorKey?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  indicatorId?: string;
}

export class CpoeQiAgendaDto {
  @ApiProperty({ enum: CPOE_QI_KEYS })
  @IsIn(CPOE_QI_KEYS as unknown as string[])
  key!: (typeof CPOE_QI_KEYS)[number];

  @ApiProperty({ description: '목표 후보(%) 1~3개 — 위원회가 고른다' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsNumber({}, { each: true }) @Min(0, { each: true }) @Max(100, { each: true })
  targets!: number[];

  @ApiPropertyOptional({ description: '방향 — 코드 등재표에 없을 때만 쓰인다', enum: ['LOWER_IS_BETTER', 'HIGHER_IS_BETTER'] })
  @IsOptional() @IsIn(['LOWER_IS_BETTER', 'HIGHER_IS_BETTER'])
  direction?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
