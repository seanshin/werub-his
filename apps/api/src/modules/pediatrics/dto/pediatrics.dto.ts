import {
  IsString, IsOptional, IsNotEmpty, IsUUID, IsNumber, IsInt, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 성장 기록 생성 ──

export class CreateGrowthDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '월령 (0–1200)' })
  @IsInt()
  @Min(0)
  @Max(1200)
  ageMonths: number;

  @ApiPropertyOptional({ description: '체중 (kg)' })
  @IsOptional()
  @IsNumber()
  @Min(0.2)
  @Max(250)
  weight?: number;

  @ApiPropertyOptional({ description: '신장 (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(250)
  height?: number;

  @ApiPropertyOptional({ description: '두위 (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(70)
  headCirc?: number;

  @ApiPropertyOptional({ description: 'BMI' })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(80)
  bmi?: number;

  @ApiPropertyOptional({ description: '🔴 입력받지 않음 — 보내면 400 GROWTH_PERCENTILE_NOT_ACCEPTED(기준표 미등록 · 서버 계산 전용). DTO 에 남긴 것은 whitelist 가 조용히 지우지 않게 하려는 것' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  weightPercentile?: number;

  @ApiPropertyOptional({ description: '🔴 입력받지 않음(400) — 체중 백분위와 같다' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  heightPercentile?: number;

  @ApiPropertyOptional({ description: '🔴 입력받지 않음(400) — 체중 백분위와 같다' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  bmiPercentile?: number;
}

// ── 예방접종 기록 생성 ──

export class CreateImmunizationDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '백신명' })
  @IsString()
  @IsNotEmpty()
  vaccineName: string;

  @ApiPropertyOptional({ description: '백신코드' })
  @IsOptional()
  @IsString()
  vaccineCode?: string;

  @ApiProperty({ description: '접종 차수 (1–20)' })
  @IsInt()
  @Min(1)
  @Max(20)
  doseNumber: number;

  @ApiPropertyOptional({ description: '로트번호' })
  @IsOptional()
  @IsString()
  lotNumber?: string;

  @ApiPropertyOptional({ description: '접종 부위' })
  @IsOptional()
  @IsString()
  site?: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '접종일시 (ISO)' })
  @IsOptional()
  @IsString()
  givenAt?: string;

  @ApiPropertyOptional({ description: '다음 접종 예정일' })
  @IsOptional()
  @IsString()
  nextDueDate?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 발달 평가 생성 ──

export class CreateDevelopmentalDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '월령 (0–1200)' })
  @IsInt()
  @Min(0)
  @Max(1200)
  ageMonths: number;

  @ApiProperty({ description: '평가 도구' })
  @IsString()
  @IsNotEmpty()
  tool: string;

  @ApiProperty({ description: '대근육 운동' })
  @IsString()
  @IsNotEmpty()
  grossMotor: string;

  @ApiProperty({ description: '소근육 운동' })
  @IsString()
  @IsNotEmpty()
  fineMotor: string;

  @ApiProperty({ description: '언어' })
  @IsString()
  @IsNotEmpty()
  language: string;

  @ApiProperty({ description: '사회성/개인' })
  @IsString()
  @IsNotEmpty()
  socialPersonal: string;

  @ApiProperty({ description: '종합 결과' })
  @IsString()
  @IsNotEmpty()
  overallResult: string;

  @ApiPropertyOptional({ description: '상세 (JSON)' })
  @IsOptional()
  details?: unknown;
}
