import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsDateString, IsIn,
} from 'class-validator';
import { MEAL_ORDER_STATUS } from '@hospital-run/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 급식 주문 생성 ──

export class CreateMealOrderDto {
  @ApiProperty({ description: '입원 ID' })
  @IsUUID()
  admissionId: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '일자' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: '식사 유형 (BREAKFAST, LUNCH, DINNER)' })
  @IsString()
  @IsNotEmpty()
  mealType: string;

  @ApiProperty({ description: '식이 유형' })
  @IsString()
  @IsNotEmpty()
  dietType: string;

  @ApiPropertyOptional({ description: '알레르기' })
  @IsOptional()
  @IsString()
  allergies?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 급식 일괄 생성 ──

export class GenerateDailyOrdersDto {
  @ApiProperty({ description: '대상 날짜', example: '2026-01-15' })
  @IsDateString()
  date: string;
}

// ── 급식 상태 변경 ──

export class UpdateMealStatusDto {
  /**
   * 🔴 종전엔 `@IsString()` 뿐이라 **아무 문자열이나 저장**됐다. 그래서 모델 주석에 없는
   *    `UNDELIVERED` 가 운영 원장의 대부분(23/24)이 됐고, 상태 문자열에 건 집계는
   *    조용히 빗나갈 수 있었다(이 저장소의 반복 유형 — 누적선량·DUR 43룰).
   *    어휘 정본은 shared `MEAL_ORDER_STATUS` 하나다.
   */
  @ApiProperty({ description: '상태', enum: MEAL_ORDER_STATUS })
  @IsIn(MEAL_ORDER_STATUS as unknown as string[], { message: `status 는 ${MEAL_ORDER_STATUS.join('|')} 중 하나여야 합니다.` })
  status: string;

  /**
   * 🔴 미배식은 사유와 한 벌이다(서비스가 비어 있는지 검증한다).
   *    다만 **값 자체는 자유 문자열로 둔다** — 운영 원장에는 정리 배치가 남긴 출처 문장과
   *    현장 자유 입력이 함께 있다. 화이트리스트로 막으면 그 기록이 고아가 된다.
   *    자주 쓰는 사유는 shared `MEAL_UNDELIVERED_REASON_PRESET`(입력 보조)에 있다.
   */
  @ApiProperty({ description: '미배식 사유(자유 문자열)', required: false })
  @IsOptional()
  @IsString()
  undeliveredReason?: string;
}
