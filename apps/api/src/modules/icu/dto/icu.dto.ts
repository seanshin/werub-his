import { IsBoolean, IsString, IsNumber, IsOptional, IsUUID, IsEnum, Min, Max, IsDateString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── ICU 입실 ──────────────────────────────────────────────────────────────────

export class AdmitIcuDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: 'ICU 병상 ID' })
  @IsUUID()
  icuBedId: string;

  @ApiProperty({ description: '입실 사유' })
  @IsString()
  @MinLength(1)
  admitReason: string;

  @ApiPropertyOptional({ description: '중증도: LOW|MODERATE|HIGH|CRITICAL' })
  @IsOptional()
  @IsString()
  severity?: string;

  // 🔴 (2026-09-15 P2) `@IsOptional` 만이라 문자열 "false" 가 통과해 Boolean 컬럼에서 500 — 형식을 입구에서 막는다
  @ApiPropertyOptional({ description: '인공호흡기 사용 여부' })
  @IsOptional()
  @IsBoolean()
  ventilator?: boolean;

  @ApiPropertyOptional({ description: '격리 여부' })
  @IsOptional()
  @IsBoolean()
  isolation?: boolean;
}

// ── ICU 기록 (바이탈/I-O/인공호흡기/중증도) ──────────────────────────────────

export class AddIcuRecordDto {
  // 🔴 필드명은 Prisma IcuRecord 스키마·서비스·프론트엔드 정본(camelCase)과 일치해야 함.
  //  (이전 DTO는 systolicBP/oxygenSaturation/gcsScore/intakeType 등 다른 이름 + 필수 type을 요구해
  //   전역 whitelist ValidationPipe가 실제 필드를 strip하거나 400을 유발 → BP/SpO2/GCS/I·O 유실·
  //   NEWS2/APACHE/SOFA 오산정. 정본에 맞춰 재정렬.)
  @ApiPropertyOptional({ description: '기록 유형(선택): VITAL|IO|VENTILATOR|SEVERITY' })
  @IsOptional()
  @IsString()
  type?: string;

  // 바이탈 사인
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(300) systolicBp?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(200) diastolicBp?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(300) heartRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) respiratoryRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(30) @Max(45) temperature?: number;
  @ApiPropertyOptional({ description: 'SpO2 (%)' }) @IsOptional() @IsNumber() @Min(0) @Max(100) spo2?: number;

  // 의식
  @ApiPropertyOptional({ description: 'GCS 점수' }) @IsOptional() @IsNumber() @Min(3) @Max(15) gcScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() consciousness?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pupilReaction?: string;

  // I/O 수지 (mL)
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) intakeOral?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) intakeIv?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) intakeOther?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) outputUrine?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) outputDrain?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) outputOther?: number;

  // 인공호흡기
  @ApiPropertyOptional({ description: '호흡기 모드: A/C|SIMV|PS|CPAP' }) @IsOptional() @IsString() ventMode?: string;
  @ApiPropertyOptional({ description: 'FiO2 (%)' }) @IsOptional() @IsNumber() @Min(21) @Max(100) fio2?: number;
  @ApiPropertyOptional({ description: 'PEEP (cmH2O)' }) @IsOptional() @IsNumber() @Min(0) @Max(50) peep?: number;
  @ApiPropertyOptional({ description: '1회 호흡량 (mL)' }) @IsOptional() @IsNumber() @Min(0) @Max(2000) tidalVolume?: number;
  @ApiPropertyOptional({ description: 'PIP (cmH2O)' }) @IsOptional() @IsNumber() @Min(0) @Max(80) pip?: number;

  // 중증도·점수
  @ApiPropertyOptional({ description: 'APACHE II 점수' }) @IsOptional() @IsNumber() @Min(0) @Max(71) apacheScore?: number;
  @ApiPropertyOptional({ description: 'SOFA 점수' }) @IsOptional() @IsNumber() @Min(0) @Max(24) sofaScore?: number;
  @ApiPropertyOptional({ description: '통증(NRS 0-10)' }) @IsOptional() @IsNumber() @Min(0) @Max(10) painScore?: number;
  @ApiPropertyOptional({ description: '진정(RASS -5~+4)' }) @IsOptional() @IsNumber() @Min(-5) @Max(4) sedationScore?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

// ── 인공호흡기 설정 ───────────────────────────────────────────────────────────

export class UpdateVentilatorDto {
  // 🔴 (2026-09-15) 검증 데코레이터가 없어 전역 whitelist 가 이 키를 **지웠다** — 사용 여부 변경이 조용히 무동작이었다.
  @ApiProperty({ description: '인공호흡기 사용 여부' })
  @IsBoolean()
  ventilator: boolean;

  @ApiPropertyOptional({ description: '호흡기 모드: A/C|SIMV|PS|CPAP' })
  @IsOptional()
  @IsString()
  ventMode?: string;

  @ApiPropertyOptional({ description: 'FiO2 (%)' })
  @IsOptional()
  @IsNumber()
  @Min(21)
  @Max(100)
  fio2?: number;

  @ApiPropertyOptional({ description: 'PEEP (cmH2O)' })
  @IsOptional()
  @IsNumber()
  peep?: number;

  @ApiPropertyOptional({ description: '1회 호흡량 (mL)' })
  @IsOptional()
  @IsNumber()
  tidalVolume?: number;
}
