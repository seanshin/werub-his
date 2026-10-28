import {
  IsString, IsNumber, IsNotEmpty, IsUUID, Min, IsOptional, IsIn, IsInt, MaxLength, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QI_SUPPLIERS } from '@hospital-run/shared';

/**
 * 🔴 지표 방향 입력값 — 저장 정본은 `LOWER_IS_BETTER`/`HIGHER_IS_BETTER` 하나다.
 *    스키마 주석 표기(`LOWER_BETTER`/`HIGHER_BETTER`)도 받아 정본으로 접는다(`normalizeIndicatorDirection`).
 *    해석되지 않는 값은 거절한다 — 오타를 방향으로 지어내면 임상 지표가 통째로 뒤집힌다.
 */
export const DIRECTION_INPUTS = [
  'LOWER_IS_BETTER', 'HIGHER_IS_BETTER', 'LOWER_BETTER', 'HIGHER_BETTER',
] as const;

// ── 질 지표 등록 ──

export class CreateIndicatorDto {
  @ApiProperty({ description: '지표명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '분류' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '산출공식' })
  @IsString()
  @IsNotEmpty()
  formula: string;

  @ApiProperty({ description: '목표값' })
  @IsNumber()
  targetValue: number;

  /**
   * 🔴 여기서 등재하면 코드 배포 없이 즉시 판정된다(종전엔 코드 등재표에만 있어 새 지표가 판정 불가였다).
   *    비워 두면 코드 등재표로 내려가고, 거기에도 없으면 '판정 불가'로 남는다(측정 입력은 막지 않는다).
   */
  @ApiPropertyOptional({ description: '지표 방향(생략 시 코드 등재표 → 미등재)', enum: DIRECTION_INPUTS })
  @IsOptional()
  @IsIn(DIRECTION_INPUTS as unknown as string[])
  direction?: string;

  @ApiPropertyOptional({ description: '표시 단위(%·일·분·건 등). 생략 시 산출공식에서 읽는다' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ description: '측정값 배율(백분율 100·천분율 1000·건수 1). 생략 시 산출공식에서 읽는다' })
  @IsOptional()
  @IsInt()
  @Min(1)
  valueScale?: number;

  // ── QI 흐름(2026-10-08) — 직접 수정 사유(결정 qi.indicator.directEdit)·담당·위원회·공급원
  @ApiPropertyOptional({ description: '정의·목표 변경 사유 — 설정 qi.indicator.directEdit=ALLOW_WITH_REASON 이면 필수' })
  @IsOptional() @IsString() @MaxLength(500)
  changeReason?: string;

  @ApiPropertyOptional({ description: '지표 담당자(목표 미달·측정 누락 알림 대상)', nullable: true })
  @IsOptional() @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ description: '담당 위원회 코드(QPS·SAFE·IC 등)', nullable: true })
  @IsOptional() @IsString() @MaxLength(20)
  committeeCode?: string | null;

  @ApiPropertyOptional({ description: '자동 산출 공급원 키(shared QI_SUPPLIERS · null = 수기 지표)', nullable: true, enum: Object.keys(QI_SUPPLIERS) })
  @IsOptional() @IsIn(Object.keys(QI_SUPPLIERS))
  supplierKey?: string | null;

}

// ── 질 지표 수정(방향·단위·배율 등재) ──

export class UpdateIndicatorDto {
  /** `null` 을 명시하면 등재 해제 — 다시 코드 등재표/미등재로 내려간다 */
  @ApiPropertyOptional({ description: '지표 방향(null = 등재 해제)', enum: DIRECTION_INPUTS, nullable: true })
  @IsOptional()
  @IsIn([...DIRECTION_INPUTS, null] as unknown as string[])
  direction?: string | null;

  @ApiPropertyOptional({ description: '표시 단위(null = 등재 해제)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @ApiPropertyOptional({ description: '측정값 배율(null = 등재 해제)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  valueScale?: number | null;

  @ApiPropertyOptional({ description: '목표값' })
  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @ApiPropertyOptional({ description: '사용 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ── QI 흐름(2026-10-08) — 직접 수정 사유(결정 qi.indicator.directEdit)·담당·위원회·공급원
  @ApiPropertyOptional({ description: '정의·목표 변경 사유 — 설정 qi.indicator.directEdit=ALLOW_WITH_REASON 이면 필수' })
  @IsOptional() @IsString() @MaxLength(500)
  changeReason?: string;

  @ApiPropertyOptional({ description: '지표 담당자(목표 미달·측정 누락 알림 대상)', nullable: true })
  @IsOptional() @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ description: '담당 위원회 코드(QPS·SAFE·IC 등)', nullable: true })
  @IsOptional() @IsString() @MaxLength(20)
  committeeCode?: string | null;

  @ApiPropertyOptional({ description: '자동 산출 공급원 키(shared QI_SUPPLIERS · null = 수기 지표)', nullable: true, enum: Object.keys(QI_SUPPLIERS) })
  @IsOptional() @IsIn(Object.keys(QI_SUPPLIERS))
  supplierKey?: string | null;

}

// ── 측정값 입력 ──

export class CreateMeasurementDto {
  /** 2026-10-09 — 화면 입력의 출처: 원내 직접 측정(MANUAL · 기본) 또는 외부 기관 통보 결과(EXTERNAL · 통보 문서·번호 필수) */
  @ApiPropertyOptional({ enum: ['MANUAL', 'EXTERNAL'] }) @IsOptional() @IsIn(['MANUAL', 'EXTERNAL'])
  source?: 'MANUAL' | 'EXTERNAL';

  @ApiPropertyOptional({ description: '외부 결과의 통보 문서·번호(출처 EXTERNAL 이면 필수)' }) @IsOptional() @IsString() @MaxLength(200)
  externalRef?: string;

  @ApiProperty({ description: '지표 ID' })
  @IsUUID()
  indicatorId: string;

  @ApiProperty({ description: '측정기간 (YYYY-MM 등)' })
  @IsString()
  @IsNotEmpty()
  period: string;

  @ApiProperty({ description: '분자' })
  @IsNumber()
  @Min(0)
  numerator: number;

  @ApiProperty({ description: '분모 (0 이면 산출 불가 — 거절됩니다)' })
  @IsNumber()
  @Min(0)
  denominator: number;

  /**
   * 🔴 방향을 함께 보내면 **지표에 등재**된다(그 한 건만 판정하고 버리지 않는다) —
   *    일회성으로 쓰면 저장값과 읽는 시점 재판정이 갈라진다(P12).
   *    보내지 않아도 측정은 저장된다. 방향을 모르면 `meet_target = null`(판정 불가)이다.
   */
  @ApiPropertyOptional({ description: '지표 방향 등재(미등재 지표만·생략 가능)', enum: DIRECTION_INPUTS })
  @IsOptional()
  @IsIn(DIRECTION_INPUTS as unknown as string[])
  direction?: string;
}


/** 측정값 정정 — 기간·지표는 바꾸지 않는다(기간을 옮기려면 무효화 후 새로 입력) */
export class UpdateMeasurementDto {
  @ApiPropertyOptional({ description: '분자' })
  @IsOptional() @IsInt() @Min(0)
  numerator?: number;

  @ApiPropertyOptional({ description: '분모 — 0 은 산출 불가(표본 부재는 값 0 이 아니다)' })
  @IsOptional() @IsInt() @Min(1)
  denominator?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional() @IsString()
  notes?: string;
}

/** 측정값 무효화 — 사유 필수(왜 취소했는지가 남아야 한다) */
export class VoidMeasurementDto {
  @ApiProperty({ description: '무효화 사유' })
  @IsString() @IsNotEmpty()
  reason!: string;
}
