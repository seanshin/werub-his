import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 B9) 자격조회·본인확인 — 인라인 타입이라 검증이 없었다.
 *  · `patientId`·`queueId` 형식 오류는 @db.Uuid 에서 500 · 방법(`method`) 20자 초과도 500
 *  · `visitType` 은 서비스가 외래/입원 분기에 쓰는데 아무 문자열이나 받았다
 *  · 확인자(`verifiedBy`)는 로그인 사용자(컨트롤러) — 본문으로 받지 않는다
 * 본인확인 판정(대조 항목 없으면 400·불일치 사유 필수·예외 표기)은 서비스 정본이 한다 — 여기서는 모양만 본다.
 */
export class CheckEligibilityDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsIn(['OUTPATIENT', 'INPATIENT']) visitType?: 'OUTPATIENT' | 'INPATIENT';
  @IsOptional() @IsUUID() queueId?: string;
}

export class VerifyIdentityDto {
  @IsUUID() patientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) method!: string;
  /** 실제로 대조한 항목만(키→불리언) — 불리언이 아닌 값은 서비스가 버린다 */
  @IsOptional() @IsObject() verifiedItems?: Record<string, boolean>;
  @IsOptional() @IsString() @MaxLength(10) result?: string;
  @IsOptional() @IsString() exceptionReason?: string;
  @IsOptional() @IsString() failureReason?: string;
  @IsOptional() @IsUUID() queueId?: string;
}
