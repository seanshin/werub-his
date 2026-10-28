import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** N-W1 창구(원무) 접수 — 포털 신청이 성립하지 않는 서류(사망진단서 등)의 접수 경로 */
export class StaffCreateRequestDto {
  @IsUUID() patientId!: string;
  @IsString() @MaxLength(30) type!: string;
  @IsOptional() @IsString() @MaxLength(200) purpose?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) copies?: number;
  /** 수령 방법 — 포털(환자 계정에서 내려받기) 포함 */
  @IsOptional() @IsIn(['VISIT', 'MAIL', 'FAX', 'PORTAL']) deliveryMethod?: string;
  /** 보낼 곳 — 우편이면 주소, 팩스면 번호(필수 · 서비스가 형식 검사) */
  @IsOptional() @IsString() @MaxLength(300) deliveryDestination?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** 대리 신청 시 관계(예: 배우자·자녀) — 확인은 창구 대면 책임(시스템 미검증·기록만) */
  @IsOptional() @IsString() @MaxLength(30) requesterRelation?: string;
  @IsOptional() @IsIn(['SELF', 'LEGAL_GUARDIAN', 'DELEGATED', 'BEREAVED']) legalBasis?: string;
  /** 대리 신청 — 창구가 신분증·관계·위임 서류를 대면으로 확인했는가(기록만 · 시스템은 서류 진위를 검증하지 않는다) */
  @IsOptional() @IsBoolean() identityChecked?: boolean;
}
