import {
  IsString, IsOptional, IsNotEmpty, IsUUID, IsNumber, IsBoolean, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 이비인후과 검사 기록 ──

export class CreateEntExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '우측 이경검사 (JSON)' })
  @IsOptional()
  otoscopyRight?: unknown;

  @ApiPropertyOptional({ description: '좌측 이경검사 (JSON)' })
  @IsOptional()
  otoscopyLeft?: unknown;

  @ApiPropertyOptional({ description: '우측 청력도 (JSON)' })
  @IsOptional()
  audiogramRight?: unknown;

  @ApiPropertyOptional({ description: '좌측 청력도 (JSON)' })
  @IsOptional()
  audiogramLeft?: unknown;

  @ApiPropertyOptional({ description: '우측 PTA (dB)' })
  @IsOptional()
  @IsNumber()
  ptaRight?: number;

  @ApiPropertyOptional({ description: '좌측 PTA (dB)' })
  @IsOptional()
  @IsNumber()
  ptaLeft?: number;

  @ApiPropertyOptional({ description: '우측 어음명료도 (%)' })
  @IsOptional()
  @IsNumber()
  speechRight?: number;

  @ApiPropertyOptional({ description: '좌측 어음명료도 (%)' })
  @IsOptional()
  @IsNumber()
  speechLeft?: number;

  @ApiPropertyOptional({ description: '우측 고막운동도 유형' })
  @IsOptional()
  @IsString()
  tympanometryRight?: string;

  @ApiPropertyOptional({ description: '좌측 고막운동도 유형' })
  @IsOptional()
  @IsString()
  tympanometryLeft?: string;

  @ApiPropertyOptional({ description: '비내시경 소견 (JSON)' })
  @IsOptional()
  nasalEndoscopy?: unknown;

  @ApiPropertyOptional({ description: '비내시경 이미지 URL' })
  @IsOptional()
  @IsString()
  nasalEndoscopyImageUrl?: string;

  @ApiPropertyOptional({ description: '인두 검사 소견 (JSON)' })
  @IsOptional()
  pharynxExam?: unknown;

  @ApiPropertyOptional({ description: '후두경 이미지 URL' })
  @IsOptional()
  @IsString()
  laryngoscopyImageUrl?: string;

  @ApiPropertyOptional({ description: '진단' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 보청기 처방 ──

export class CreateHearingAidDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '귀 (LEFT, RIGHT, BOTH)' })
  @IsIn(['LEFT', 'RIGHT', 'BOTH']) // wrong-side 방지 — 자유문자열 오타 차단(안과 wrong-eye 선례)
  ear: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '보청기 모델' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: '보청기 유형' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '게인 설정 (JSON)' })
  @IsOptional()
  gain?: unknown;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 수면검사 기록 ──

export class CreateSleepStudyDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '검사 유형 (PSG, HSAT 등)' })
  @IsString()
  @IsNotEmpty()
  studyType: string;

  @ApiProperty({ description: '검사일 (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  studyDate: string;

  @ApiProperty({ description: '무호흡-저호흡 지수 (AHI)' })
  @IsNumber()
  ahi: number;

  @ApiPropertyOptional({ description: '최저 산소포화도 (%)' })
  @IsOptional()
  @IsNumber()
  oxygenSatMin?: number;

  @ApiPropertyOptional({ description: '평균 산소포화도 (%)' })
  @IsOptional()
  @IsNumber()
  oxygenSatAvg?: number;

  @ApiPropertyOptional({ description: '수면 효율 (%)' })
  @IsOptional()
  @IsNumber()
  sleepEfficiency?: number;

  @ApiPropertyOptional({ description: '총 수면 시간 (분)' })
  @IsOptional()
  @IsNumber()
  totalSleepTime?: number;

  @ApiPropertyOptional({ description: 'REM 비율 (%)' })
  @IsOptional()
  @IsNumber()
  remPercent?: number;

  @ApiPropertyOptional({ description: '앙와위 AHI' })
  @IsOptional()
  @IsNumber()
  supineAhi?: number;

  @ApiPropertyOptional({ description: '진단' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: 'CPAP 권고 여부' })
  @IsOptional()
  @IsBoolean()
  cpapRecommended?: boolean;

  @ApiPropertyOptional({ description: 'CPAP 압력 (cmH2O)' })
  @IsOptional()
  @IsNumber()
  cpapPressure?: number;
}
