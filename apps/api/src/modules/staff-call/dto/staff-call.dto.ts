import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateStaffCallDto {
  @IsIn(['USER', 'ROLE', 'DEPARTMENT'])
  targetKind!: 'USER' | 'ROLE' | 'DEPARTMENT';

  @IsString()
  targetRef!: string; // userId / role / department

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  patientRef?: string; // 환자 ID만 (FR-50)

  @IsOptional()
  @IsIn(['NORMAL', 'URGENT'])
  severity?: 'NORMAL' | 'URGENT';
}

export class BroadcastDto {
  @IsIn(['ROLE', 'DEPARTMENT', 'ALL'])
  targetKind!: 'ROLE' | 'DEPARTMENT' | 'ALL';

  @IsOptional()
  @IsString()
  targetRef?: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsIn(['URGENT', 'CRITICAL'])
  severity?: 'URGENT' | 'CRITICAL';
}

export class CodeCallDto {
  /** 대상: 보통 전체 또는 특정 팀(role/dept) */
  @IsIn(['ROLE', 'DEPARTMENT', 'ALL'])
  targetKind!: 'ROLE' | 'DEPARTMENT' | 'ALL';

  @IsOptional()
  @IsString()
  targetRef?: string;

  @IsString()
  codeType!: string; // 예: CODE_BLUE

  @IsString()
  location!: string;
}

export class RespondDto {
  @IsIn(['ACCEPT', 'CONFIRM', 'CALLBACK', 'ACK'])
  response!: 'ACCEPT' | 'CONFIRM' | 'CALLBACK' | 'ACK';
}

/**
 * 🔴 (2026-09-15 B10) 인라인 `{ falseAlarm?: boolean }` 였다 — 문자열 "false" 가 참으로 읽혀
 *    **실제 CODE 호출 취소에 허위 발신 플래그**가 감사에 남고 허위 CODE 경고 로그가 울렸다.
 */
export class CancelStaffCallDto {
  @IsOptional()
  @IsBoolean()
  falseAlarm?: boolean;
}
