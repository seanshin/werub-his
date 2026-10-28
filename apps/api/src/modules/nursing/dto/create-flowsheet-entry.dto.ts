import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * 입원 Flow Sheet(활력·I/O) 기록 — 종전 `@Body() Record<string, unknown>` 이라 **범위 검증이 전무**했다
 * (spo2: 9999·temperature: -50 통과). 외래(nurse-station) 경로와 검증 수준을 대칭으로 맞춘다.
 */
export class CreateFlowSheetEntryDto {
  @IsOptional() @IsISO8601()
  recordedAt?: string;

  @IsOptional() @IsInt() @Min(40) @Max(300)
  systolicBp?: number;

  @IsOptional() @IsInt() @Min(20) @Max(200)
  diastolicBp?: number;

  @IsOptional() @IsInt() @Min(20) @Max(250)
  heartRate?: number;

  @IsOptional() @IsNumber() @Min(30) @Max(45)
  temperature?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  spo2?: number;

  @IsOptional() @IsInt() @Min(0) @Max(60)
  respiratoryRate?: number;

  @IsOptional() @IsString() @MaxLength(20)
  consciousness?: string;

  @IsOptional() @IsInt() @Min(0) @Max(10)
  painScore?: number;

  @IsOptional() @IsString() @MaxLength(100)
  painLocation?: string;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  intakeOral?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  intakeIv?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  intakeOther?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  outputUrine?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  outputDrain?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  outputOther?: number;

  @IsOptional() @IsInt() @Min(3) @Max(15)
  gcsScore?: number;

  // NEWS2 산출 파라미터 — 산소 투여 여부·SpO2 스케일(COPD 등은 2)
  @IsOptional() @IsBoolean()
  supplementalO2?: boolean;

  @IsOptional() @IsIn([1, 2])
  spO2Scale?: number;

  @IsOptional() @IsIn(['DAY', 'EVENING', 'NIGHT'])
  shiftType?: 'DAY' | 'EVENING' | 'NIGHT';

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
