import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsNumber, IsBoolean, IsObject, IsInt, Min, Max, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 영양 평가 생성 ──

export class CreateNutritionAssessmentDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiProperty({ description: '평가 유형' })
  @IsString()
  @IsNotEmpty()
  assessmentType: string;

  @ApiPropertyOptional({ description: '키 (cm)' })
  @IsOptional()
  @IsNumber()
  height?: number;

  @ApiPropertyOptional({ description: '체중 (kg)' })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ description: '알부민 (g/dL)' })
  @IsOptional()
  @IsNumber()
  albumin?: number;

  @ApiPropertyOptional({ description: 'NRS 점수' })
  @IsOptional()
  @IsNumber()
  nrsScore?: number;

  @ApiPropertyOptional({ description: '섭취 상태' })
  @IsOptional()
  @IsString()
  intakeStatus?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 식이처방 생성 ──

export class CreateDietOrderDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '입원 ID' })
  @IsUUID()
  admissionId: string;

  @ApiProperty({ description: '식이 유형' })
  @IsString()
  @IsNotEmpty()
  dietType: string;

  @ApiPropertyOptional({ description: '칼로리 목표 (kcal)' })
  @IsOptional()
  @IsNumber()
  calorieTarget?: number;

  @ApiPropertyOptional({ description: '단백질 목표 (g)' })
  @IsOptional()
  @IsNumber()
  proteinTarget?: number;

  @ApiPropertyOptional({ description: '수분 제한 (mL)' })
  @IsOptional()
  @IsNumber()
  fluidLimit?: number;

  @ApiPropertyOptional({ description: '제한 사항' })
  @IsOptional()
  @IsObject()
  restrictions?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '질감 (일반, 다진, 유동 등)' })
  @IsOptional()
  @IsString()
  texture?: string;

  @ApiProperty({ description: '시작일' })
  @IsString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 식이처방 수정 ──

export class UpdateDietOrderDto {
  @ApiPropertyOptional({ description: '식이 유형' })
  @IsOptional()
  @IsString()
  dietType?: string;

  @ApiPropertyOptional({ description: '칼로리 목표 (kcal)' })
  @IsOptional()
  @IsNumber()
  calorieTarget?: number;

  @ApiPropertyOptional({ description: '단백질 목표 (g)' })
  @IsOptional()
  @IsNumber()
  proteinTarget?: number;

  @ApiPropertyOptional({ description: '수분 제한 (mL)' })
  @IsOptional()
  @IsNumber()
  fluidLimit?: number;

  @ApiPropertyOptional({ description: '제한 사항' })
  @IsOptional()
  @IsObject()
  restrictions?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '질감' })
  @IsOptional()
  @IsString()
  texture?: string;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 영양 상담 기록 ──

export class CreateNutritionCounselDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '상담 유형' })
  @IsString()
  @IsNotEmpty()
  counselType: string;

  @ApiProperty({ description: '주제' })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({ description: '상담 내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '식이 목표' })
  @IsOptional()
  @IsObject()
  dietaryGoals?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '상담 시간 (분)' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ description: '추적 상담일' })
  @IsOptional()
  @IsString()
  followUpDate?: string;
}

// ── 특수영양(경장 EN·정맥 TPN) ──

/**
 * 🔴 (2026-09-15 B10) 특수영양 처방 생성·수정 — `Record<string, unknown>` 본문이었다.
 *  - 주입 속도·용량·목표 열량이 음수여도 그대로 저장됐고(정맥 영양 처방), 소수·문자열은 Int 컬럼에서 Prisma 500 이었다.
 *  - 수정의 `status` 는 아무 문자열이나 저장됐다 — 어휘는 스키마 주석(ACTIVE·HELD·DISCONTINUED) 그대로.
 *  - 종류 어휘는 스키마 주석(ENTERAL·PARENTERAL) 그대로(화면 토글 두 값). 경로는 강제하지 않는다(VarChar 30).
 * 처방자(`orderedBy`)는 본문이 아니라 로그인 사용자다.
 */
export class CreateSpecialNutritionDto {
  @ApiProperty() @IsUUID() admissionId: string;
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ enum: ['ENTERAL', 'PARENTERAL'] }) @IsIn(['ENTERAL', 'PARENTERAL']) kind: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) route?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) formula?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) targetCalories?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) volumeMl?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) rateMlHr?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() composition?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() monitoring?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD · 미지정 오늘(KST)' }) @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD' }) @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateSpecialNutritionDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'HELD', 'DISCONTINUED'] }) @IsOptional() @IsIn(['ACTIVE', 'HELD', 'DISCONTINUED']) status?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD' }) @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) rateMlHr?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) volumeMl?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() composition?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() monitoring?: Record<string, unknown>;
}

// ── 식사 섭취 기록 ──

/**
 * 🔴 (2026-09-15 B10) 식사 섭취 기록 — 인라인 본문이었다.
 *  - `trayCollected: "false"`(문자열)가 참으로 읽혀 **회수하지 않은 트레이에 회수 시각**이 찍혔다.
 *  - 섭취율 범위 검사가 없어 150% → 급식 상태 `COMPLETED`·잔반율 -50% 로 저장됐다(스키마 주석 0~100).
 *  - 열량·단백·수분이 음수여도 섭취 원장에 들어갔다.
 * 기록자는 본문이 아니라 로그인 사용자다. 끼니 어휘는 강제하지 않는다(서비스가 모르는 끼니는 비율 0.33).
 */
export class RecordMealIntakeDto {
  @ApiProperty() @IsUUID() admissionId: string;
  @ApiProperty() @IsUUID() patientId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() mealOrderId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) mealType: string;
  @ApiProperty({ description: 'YYYY-MM-DD(서비스가 형식 검사)' }) @IsString() date: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) intakePercent: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) calories?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) protein?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) fluid?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() refusedItems?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsOptional() @IsInt() @Min(0) @Max(100) leftoverPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) refusalReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trayCollected?: boolean;
}
