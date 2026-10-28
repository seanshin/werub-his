import { IsString, IsInt, IsOptional, IsBoolean, IsUUID, IsDateString, IsObject, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNursingAssessmentDto {
  @ApiProperty({ description: '의식수준 (Alert/Verbal/Pain/Unresponsive)' })
  @IsString()
  consciousness: string;

  @ApiProperty({ description: '활동정도' })
  @IsString()
  mobility: string;

  @ApiProperty({ description: '통증점수 (NRS 0-10)' })
  @IsInt()
  @Min(0)
  @Max(10)
  painScore: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  painLocation?: string;

  @ApiProperty()
  @IsString()
  nutritionStatus: string;

  @ApiProperty()
  @IsString()
  skinIntegrity: string;

  @ApiPropertyOptional({ description: '기존 FallRiskAssessment ID (FK 참조)' })
  @IsOptional()
  @IsUUID()
  fallRiskAssessmentId?: string;

  // 🔴 (2026-10-10) 범위 검사가 없어 6 미만·23 초과도 저장됐다 — 위험 추이가 그런 행을 "확인 필요"로 보인다
  @ApiPropertyOptional({ description: 'Braden Scale 점수(6~23)' })
  @IsOptional()
  @IsInt()
  @Min(6)
  @Max(23)
  bradenScore?: number;

  /**
   * Braden 하위 6항목(2026-10-10 · 원내 결정 `nursing.initialAssessment.bradenInput` = SUBSCORES 일 때 화면이 보낸다).
   * `{ sensory, moisture, activity, mobility, nutrition, friction }` — 총점은 서버가 합으로 정한다(보낸 총점이 다르면 400).
   */
  @ApiPropertyOptional({ description: 'Braden 하위 6항목 점수 { sensory, moisture, activity, mobility, nutrition, friction }' })
  @IsOptional()
  @IsObject()
  bradenSubscores?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allergyConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  additionalData?: object;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  assessedAt?: string;
}
