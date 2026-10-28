import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * 🔴 (2026-09-15 B9) 암등록 쓰기 5 EP — 종전 `Record<string, unknown>` 은 ValidationPipe 를 통째로 건넜다.
 * 서비스가 필드를 골라 쓰긴 했지만 **형식은 아무도 보지 않았다**: 날짜 문자열 오류·컬럼 길이 초과는 Prisma 500,
 * 추적관찰 `recurrence: "false"` 는 Boolean 컬럼에 문자열로 들어가 500 이었다.
 * 어휘(원발부위·병기 등)는 지어내 강제하지 않는다 — 컬럼 길이(schema VarChar)와 타입만 본다.
 * 화면은 선택 칸을 빈 문자열로 보낸다(`EMPTY_REGISTRY_FORM`) — 빈 문자열은 그대로 통과시킨다(종전 저장 동작 유지).
 */
const optDate = () => ValidateIf((_o, v) => v !== undefined && v !== null && v !== '');

export class CreateCancerRegistryDto {
  @IsUUID() patientId!: string;
  @IsDateString() diagnosisDate!: string;
  @IsOptional() @IsString() @MaxLength(10) primarySite?: string;
  @IsOptional() @IsString() @MaxLength(10) morphology?: string;
  @IsOptional() @IsString() @MaxLength(5) behavior?: string;
  @IsOptional() @IsString() @MaxLength(5) grade?: string;
  @IsOptional() @IsString() @MaxLength(10) laterality?: string;
  @IsOptional() @IsString() @MaxLength(20) diagnosisBasis?: string;
  @IsOptional() @IsString() @MaxLength(10) icdCode?: string;
  @IsOptional() @IsString() @MaxLength(20) tnmClinical?: string;
  @IsOptional() @IsString() @MaxLength(20) tnmPathological?: string;
  @IsOptional() @IsString() @MaxLength(10) ajccStage?: string;
  @IsOptional() @IsInt() @Min(1) ajccEdition?: number;
  @IsOptional() @IsString() @MaxLength(30) firstTreatment?: string;
  @optDate() @IsDateString() firstTreatmentDate?: string;
  @IsOptional() @IsString() @MaxLength(20) vitalStatus?: string;
}

/** 수정 — `status`·`registrarId`·`verifiedBy`·`reportedToKccr`·`kccrTransmittedAt` 는 받지 않는다(확인·보고 경로가 정본) */
export class UpdateCancerRegistryDto {
  @IsOptional() @IsString() @MaxLength(10) primarySite?: string;
  @IsOptional() @IsString() @MaxLength(10) morphology?: string;
  @IsOptional() @IsString() @MaxLength(5) behavior?: string;
  @IsOptional() @IsString() @MaxLength(5) grade?: string;
  @IsOptional() @IsString() @MaxLength(10) laterality?: string;
  @IsOptional() @IsString() @MaxLength(20) diagnosisBasis?: string;
  @IsOptional() @IsString() @MaxLength(10) icdCode?: string;
  @IsOptional() @IsString() @MaxLength(20) tnmClinical?: string;
  @IsOptional() @IsString() @MaxLength(20) tnmPathological?: string;
  @IsOptional() @IsString() @MaxLength(10) ajccStage?: string;
  @IsOptional() @IsInt() @Min(1) ajccEdition?: number | null;
  @IsOptional() @IsString() @MaxLength(30) firstTreatment?: string;
  @IsOptional() @IsString() @MaxLength(20) vitalStatus?: string;
  @IsOptional() @IsString() @MaxLength(100) recurrenceSite?: string;
  @IsOptional() @IsString() @MaxLength(10) causeOfDeath?: string;
  @IsOptional() @IsDateString() diagnosisDate?: string;
  @optDate() @IsDateString() firstTreatmentDate?: string | null;
  @optDate() @IsDateString() recurrenceDate?: string | null;
  @optDate() @IsDateString() lastContactDate?: string | null;
  @optDate() @IsDateString() deathDate?: string | null;
}

export class AddCancerTreatmentDto {
  @IsString() @IsNotEmpty() @MaxLength(30) treatmentType!: string;
  @IsDateString() startDate!: string;
  @optDate() @IsDateString() endDate?: string;
  @IsOptional() @IsString() @MaxLength(200) regimen?: string;
  @IsOptional() @IsInt() @Min(0) cycles?: number;
  @IsOptional() @IsString() @MaxLength(20) response?: string;
  @IsOptional() @IsString() @MaxLength(100) surgeryType?: string;
  @IsOptional() @IsString() @MaxLength(50) radiationDose?: string;
  @IsOptional() @IsString() note?: string;
}

export class UpdateCancerTreatmentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30) treatmentType?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @optDate() @IsDateString() endDate?: string | null;
  @IsOptional() @IsString() @MaxLength(200) regimen?: string;
  @IsOptional() @IsInt() @Min(0) cycles?: number | null;
  @IsOptional() @IsString() @MaxLength(20) response?: string;
  @IsOptional() @IsString() @MaxLength(100) surgeryType?: string;
  @IsOptional() @IsString() @MaxLength(50) radiationDose?: string;
  @IsOptional() @IsString() note?: string;
}

/** 추적관찰 — 기록자(`recordedBy`)는 로그인 사용자(컨트롤러) · 🔴 `recurrence` 는 진짜 불리언만("false" 문자열 400) */
export class AddCancerFollowUpDto {
  @IsDateString() followUpDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) status!: string;
  @IsOptional() @IsBoolean() recurrence?: boolean;
  @IsOptional() @IsString() @MaxLength(100) metastasisSite?: string;
  @IsOptional() @IsString() @MaxLength(10) performanceStatus?: string;
  @IsOptional() @IsString() note?: string;
}
