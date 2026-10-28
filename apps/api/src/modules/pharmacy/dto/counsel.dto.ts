import {
  IsUUID, IsOptional, IsString, IsIn, IsNotEmpty, IsInt, Min, Max,
  IsArray, ArrayMinSize, ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 복약지도 종류 — 스키마 주석(dispensing_counsels.counsel_type) 실측 */
export const COUNSEL_TYPES = ['INITIAL', 'REFILL', 'DISCHARGE'] as const;

/**
 * 복약지도 DTO — 🔴 인라인 `@Body()` 승격 + 고아 EP 회수(2026-08-26)
 *
 * `POST /api/v1/pharmacy/counsel` 은 개통 이래 **부르는 화면이 0** 이었다
 * (운영 `dispensing_counsels` 3행은 전부 2026-05-28 시드). 화면을 붙이면서
 * 인라인 @Body 도 함께 걷는다 — 종전에는 `counselType` 에 아무 문자열이나
 * 들어갔고(어휘 오염 → 라벨표가 빈 배지), `duration` 이 음수·소수로 통과했다.
 *
 * 🔴 `pharmacistId` 는 여기 없다(whitelist 가 지운다) — 상담한 사람은 인증 사용자다.
 */
export class CreateCounselDto {
  @ApiProperty({ description: '조제 ID(어느 조제에 대한 복약지도인가)' })
  @IsUUID('4', { message: '조제 ID 는 UUID 여야 합니다' })
  dispensingId: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: '환자 ID 는 UUID 여야 합니다' })
  patientId: string;

  @ApiPropertyOptional({ description: '상담 종류', enum: COUNSEL_TYPES as unknown as string[] })
  @IsOptional()
  @IsIn(COUNSEL_TYPES as unknown as string[], {
    message: `상담 종류는 ${COUNSEL_TYPES.join('|')} 중 하나여야 합니다`,
  })
  counselType?: string;

  @ApiProperty({ description: '상담 내용' })
  @IsString()
  @IsNotEmpty({ message: '상담 내용은 필수입니다' })
  content: string;

  @ApiPropertyOptional({ description: '상호작용 설명' })
  @IsOptional()
  @IsString()
  drugInteractions?: string;

  @ApiPropertyOptional({ description: '부작용 설명' })
  @IsOptional()
  @IsString()
  sideEffects?: string;

  @ApiPropertyOptional({ description: '음식 상호작용 설명' })
  @IsOptional()
  @IsString()
  foodInteractions?: string;

  @ApiPropertyOptional({ description: '보관 방법 설명' })
  @IsOptional()
  @IsString()
  storageInstructions?: string;

  /** 🔴 상담 시간은 실제로 잰 값만 — 재지 않았으면 보내지 않는다(0 분은 다른 사실이다). */
  @ApiPropertyOptional({ description: '상담 시간(분·실제로 잰 값만)' })
  @IsOptional()
  @IsInt({ message: '상담 시간은 정수(분)여야 합니다' })
  @Min(1, { message: '상담 시간은 1분 이상이어야 합니다' })
  @Max(600)
  duration?: number;
}

export const NARANJO_ANSWERS = ['yes', 'no', 'unknown'] as const;
/** Naranjo ADR probability scale 문항 수 — 표준 10문항 고정 */
export const NARANJO_ITEM_COUNT = 10;

/**
 * Naranjo 인과성 문항 DTO — 🔴 고아 EP 회수 + "빈 설문이 판정이 되던 것"(2026-08-26)
 *
 * `POST /pharmacy/adr/naranjo` 는 종전 `@Body('answers') answers: string[]` 였다.
 * 검증이 전혀 없었고, `computeNaranjo([])` 는 **0점 = UNLIKELY(희박)** 을 돌려줬다 —
 * 즉 **문항을 하나도 제출하지 않아도 "인과성 희박"이라는 임상 판정이 나왔다**.
 * 표본 부재의 정답은 판정이 아니다. 10문항 전체 제출을 강제해서
 * "10문항에 모름으로 답했다"와 "설문을 하지 않았다"를 갈라놓는다.
 */
export class ComputeNaranjoDto {
  @ApiProperty({
    description: `Naranjo 10문항 응답(${NARANJO_ANSWERS.join('|')}) — 전 문항 필수`,
    isArray: true,
    enum: NARANJO_ANSWERS as unknown as string[],
  })
  @IsArray({ message: 'answers 는 배열이어야 합니다' })
  @ArrayMinSize(NARANJO_ITEM_COUNT, { message: `Naranjo 는 ${NARANJO_ITEM_COUNT}문항 전체를 제출해야 합니다` })
  @ArrayMaxSize(NARANJO_ITEM_COUNT, { message: `Naranjo 는 ${NARANJO_ITEM_COUNT}문항입니다` })
  @IsIn(NARANJO_ANSWERS as unknown as string[], {
    each: true,
    message: `각 응답은 ${NARANJO_ANSWERS.join('|')} 중 하나여야 합니다`,
  })
  answers: string[];
}
