import { IsOptional, IsUUID, IsInt, IsString, IsNumber } from 'class-validator';

// 전역 ValidationPipe whitelist가 데코 없는 필드를 strip하므로 모든 필드에 최소 1개 데코레이터 필수

export class CreateEmergencyExamDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @IsOptional() @IsInt() ktasLevel?: number;
  @IsOptional() triage?: unknown;
  @IsOptional() assessment?: unknown;
  @IsOptional() treatment?: unknown;
  @IsOptional() progressNotes?: unknown;
  @IsOptional() disposition?: unknown;
}

export class CreateFamilyMedExamDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @IsOptional() soap?: unknown;
  @IsOptional() vitals?: unknown;
  @IsOptional() checkup?: unknown;
  @IsOptional() lifestyle?: unknown;
  @IsOptional() screenings?: unknown;
}

export class CreatePediatricExamDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @IsOptional() @IsInt() ageMonths?: number;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() headCircumference?: number;
  /** 받기만 한다 — 저장 값은 서버가 체중·신장에서 계산(2026-10-10 · 보낸 값 무시) */
  @IsOptional() @IsNumber() bmi?: number;
  @IsOptional() developmentalAssessment?: unknown;
  @IsOptional() immunizations?: unknown;
  @IsOptional() @IsString() findings?: string;
}

export class CreateRehabExamDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @IsOptional() soap?: unknown;
  @IsOptional() functionalAssessment?: unknown;
  @IsOptional() therapyPlans?: unknown;
}
