import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * 🔴 (2026-09-15 B9) MDT 쓰기 6 EP — 종전 `Record<string, unknown>` 은 검증 없이 서비스로 갔다.
 * 참석 여부 `attended: "false"` 는 Boolean 컬럼에 문자열로 들어가 500, 일시 오류는 Invalid Date 500 이었다.
 * 의장(`chairpersonId`)은 서버가 로그인 사용자로 정한다 — 본문으로 받지 않는다(서비스도 무시).
 * 회의 유형·참석 역할 어휘는 화면 목록과 저장 값이 갈릴 수 있어 지어내 강제하지 않는다 — 컬럼 길이만 본다.
 */
export class CreateMdtConferenceDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) conferenceType!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) department!: string;
  @IsDateString() scheduledAt!: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsString() notes?: string;
}

/** 수정 — 상태(`status`)는 시작/완료 EP, 회의록(`minutes`)은 생성 EP 가 정본이라 받지 않는다 */
export class UpdateMdtConferenceDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(30) conferenceType?: string;
  @IsOptional() @IsString() @MaxLength(50) department?: string;
  /** 수정 폼은 모든 칸을 보낸다 — 빈 일시는 "바꾸지 않음"(서비스가 falsy 를 무시) */
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '') @IsDateString() scheduledAt?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string | null;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() recordingUrl?: string | null;
}

/**
 * 케이스 추가 — 발표자(`presenterId`)는 등록자와 다른 의사일 수 있어 받는다(미지정=등록자, 서비스 동작 유지).
 * 사용자 id 형식은 본다(종전엔 아무 문자열이 @db.Uuid 에 가서 500).
 */
export class AddMdtCaseDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() presenterId?: string;
  @IsString() @IsNotEmpty() @MaxLength(200) primaryDiag!: string;
  @IsOptional() @IsString() @MaxLength(30) tnmStage?: string;
  @IsOptional() @IsString() clinicalSummary?: string;
  @IsOptional() @IsString() imagingSummary?: string;
  @IsOptional() @IsString() pathologySummary?: string;
  @IsOptional() @IsString() labSummary?: string;
  @IsOptional() @IsString() proposedPlan?: string;
}

/** 케이스 수정(결정 기록) — 결정 분류 어휘 검사는 서비스 정본(MDT_DECISION_CATEGORIES)이 한다(빈 값=미분류) */
export class UpdateMdtCaseDto {
  @IsOptional() @IsString() @MaxLength(200) primaryDiag?: string;
  @IsOptional() @IsString() @MaxLength(30) tnmStage?: string | null;
  @IsOptional() @IsString() clinicalSummary?: string | null;
  @IsOptional() @IsString() imagingSummary?: string | null;
  @IsOptional() @IsString() pathologySummary?: string | null;
  @IsOptional() @IsString() labSummary?: string | null;
  @IsOptional() @IsString() proposedPlan?: string | null;
  @IsOptional() @IsString() decision?: string | null;
  @IsOptional() @IsString() @MaxLength(30) decisionCategory?: string | null;
  @IsOptional() @IsString() followUp?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class AddMdtAttendeeDto {
  @IsUUID() userId!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) department!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) role!: string;
  /** 🔴 진짜 불리언만 — "false" 문자열은 400 */
  @IsOptional() @IsBoolean() attended?: boolean;
}

export class UpdateMdtAttendeeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) role?: string;
  @IsOptional() @IsBoolean() attended?: boolean;
}
