import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/**
 * 🔴 **클래스로 선언한다.** 인터페이스·교차 타입·`Partial<>` 는 런타임 metatype 이 `Object` 라
 *    ValidationPipe 가 통째로 스킵된다(이 저장소가 실제로 겪은 것 — `interface-body-dto-guard`).
 */

export const REVIEW_FILTERS = [
  'all',
  'unreviewed',
  'proposed',
  'approved',
  'rejected',
  'merged',
  'contextGap',
  'safety',
  'untranslated',
  'baseChanged',
] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/**
 * 🔴 **`status` 파라미터를 두지 않는다.** 이 EP 는 런타임 오버레이 전용이고 나가는 것은 `APPROVED`
 *    뿐이다(기획서 §2.2). "기본은 APPROVED, 원하면 PROPOSED 도" 로 열어 두면 소비처가 그것을
 *    부르는 순간 **미승인 번역이 화면에 나간다** — 이 저장소가 반복해 겪은 "만든 것 ≠ 소비처가
 *    쓰는 것"의 자리다. 검수 화면의 미리보기는 `/review` 행의 `overlayValue` 로 이미 가능하다.
 */
export class OverridesQueryDto {
  @IsString() @MaxLength(16) locale!: string;
}

export class ReviewQueryDto {
  @IsString() @MaxLength(16) locale!: string;
  @IsOptional() @IsString() @MaxLength(40) area?: string;
  @IsOptional() @IsIn(REVIEW_FILTERS as unknown as string[]) filter?: ReviewFilter;
  /** 원문·번역 부분 일치 */
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class ReviewExportQueryDto {
  @IsString() @MaxLength(16) locale!: string;
  @IsOptional() @IsString() @MaxLength(40) area?: string;
}

export class ReviewStatsQueryDto {
  @IsString() @MaxLength(16) locale!: string;
}

export class ProposeDto {
  @IsString() @MaxLength(16) locale!: string;
  @IsString() @MinLength(1) @MaxLength(500) key!: string;
  /** 검수자가 확정한 값. 🔴 빈 값은 받지 않는다 — "번역하지 않음"은 반려(REJECTED)로 남긴다 */
  @IsString() @MinLength(1) @MaxLength(4000) value!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class DecisionDto {
  /** 사유. 🔴 필수로 강제하지 않는다 — 강제하면 아무 값이나 골라 거짓 데이터가 된다 */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * **"이 키는 번역하지 않는다"** — 제안 없이 **키만으로** 반려한다(기획서 §2.4).
 *
 * 🔴 왜 별도 EP 인가: 종전에는 `REJECTED` 로 가는 경로가 `POST review/:id/reject` 뿐이라
 *    **오버레이 행이 먼저 있어야** 했고, 행을 만들려면 `ProposeDto.value`(`@MinLength(1)`)에
 *    검수자가 쓰지도 않은 값을 넣어야 했다. 안전 키를 "번역하지 않고 원문+티로 둔다"는
 *    §2.4 의 **정답이 실행 불가**였다(KTAS 등급·MAR 상태 선례).
 *
 * 🔴 **여기서만 사유가 필수다.** `DecisionDto.reason` 은 선택인데(강제하면 아무 값이나 골라
 *    거짓 데이터가 된다) 여기는 다르다 — 이 판정에는 **교정값이 없어서 사유가 곧 내용**이고,
 *    스키마 주석도 그렇게 못박고 있다(§2.1 "반려는 특히 여기가 본문이다").
 *    사유 없는 "번역하지 않음"은 나중에 아무도 그 판정을 재검토할 수 없다.
 */
export class RejectKeyDto {
  @IsString() @MaxLength(16) locale!: string;
  @IsString() @MinLength(1) @MaxLength(500) key!: string;
  /** 🔴 필수 — 위 주석 참조(전이 원장 `reason` 이 VarChar(500) 이라 길이도 맞춘다) */
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class OverrideIdParamDto {
  @IsUUID() id!: string;
}
