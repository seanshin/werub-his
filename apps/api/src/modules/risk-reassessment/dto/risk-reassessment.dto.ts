import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, IsUUID, IsObject, IsArray, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSESSMENT_TYPES } from '../risk-reassessment.policy';

/**
 * 🔴 원 결함: 컨트롤러가 `@Body() data: Record<string, unknown>` 을 받아
 *    전역 ValidationPipe 를 통째로 건너뛰었다. 그래서 FE 가 보내는 `totalScore` 와
 *    서버가 읽는 `score` 의 필드명 불일치가 **런타임까지 조용히 통과**했고,
 *    `undefined >= 45` 가 false 라 고위험 환자가 전건 LOW 로 기록됐다.
 *    → DTO 로 계약을 고정한다. 점수가 없으면 400 으로 **거부**한다(조용히 LOW 금지).
 */

export class CreateRiskScheduleDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiProperty({ description: 'FALL_RISK | PRESSURE_ULCER', enum: ASSESSMENT_TYPES })
  @IsIn(ASSESSMENT_TYPES as unknown as string[])
  assessmentType: (typeof ASSESSMENT_TYPES)[number];

  @ApiPropertyOptional({ description: '평가 도구 (미지정 시 유형별 기본값 — MORSE/BRADEN)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  toolName?: string;

  @ApiPropertyOptional({ description: '재평가 주기(시간). 미지정 시 주기 정본의 초기값' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  intervalHours?: number;
}

export class RecordAssessmentDto {
  /**
   * 🔴 필드명 정본 = `totalScore`(FE 가 실제로 보내던 이름).
   *    서버가 `score` 를 읽던 것이 결함이었다. 필수 — 없으면 400.
   */
  @ApiProperty({ description: '평가 총점 (Morse 0~125 / Braden 6~23)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  totalScore: number;

  @ApiPropertyOptional({ description: '항목별 점수 {항목키: 점수} — 법정기록의 근거이므로 저장된다' })
  @IsOptional()
  @IsObject()
  scores?: Record<string, number>;

  @ApiPropertyOptional({ description: '적용 중재 목록' })
  @IsOptional()
  @IsArray()
  interventions?: unknown[];

  @ApiPropertyOptional({ description: '평가 소견' })
  @IsOptional()
  @IsString()
  note?: string;
}
