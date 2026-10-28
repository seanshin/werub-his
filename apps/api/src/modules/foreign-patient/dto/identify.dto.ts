import { IsString, IsNotEmpty, IsOptional, IsIn, MaxLength, Matches } from 'class-validator';

/**
 * 🔴 미확인(응급) 환자 신원 확인 — 임시ID → 실명 전환 (환자관리 A3 · 2026-08-31).
 *
 * 종전엔 `interface` 라 metatype 이 `Object` → ValidationPipe 가 통째로 스킵됐다(무검증 쓰기).
 * 신원 전환은 **법적 식별정보를 쓰는 고위험 변이**라 class-validator 로 승격한다. 변이는 기본 감사
 * ON 이고, `reason`(사유)을 body 에 실어 **누가 언제 왜 임시→실명으로 바꿨는가**를 원장에 남긴다.
 */
export class IdentifyPatientDto {
  @IsString() @IsNotEmpty({ message: '성(姓)을 입력하세요' }) @MaxLength(50)
  familyName!: string;

  @IsString() @IsNotEmpty({ message: '이름을 입력하세요' }) @MaxLength(50)
  givenName!: string;

  @IsOptional() @IsString() @MaxLength(100)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(50)
  nationality?: string;

  @IsOptional() @IsString() @MaxLength(50)
  passportNumber?: string;

  @IsOptional() @IsString() @MaxLength(30)
  alienRegistrationNo?: string;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '생년월일은 YYYY-MM-DD 형식이어야 합니다' })
  dateOfBirth!: string;

  @IsIn(['MALE', 'FEMALE'], { message: '성별은 MALE/FEMALE 중 하나여야 합니다' })
  gender!: 'MALE' | 'FEMALE';

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(30)
  nationalId?: string;

  @IsOptional() @IsString() @MaxLength(30)
  patientSource?: string;

  /** 🔴 신원 확인 사유 — 감사 원장에 남는다(임시→실명 전환의 근거) */
  @IsString() @IsNotEmpty({ message: '신원 확인 사유를 입력하세요' }) @MaxLength(300)
  reason!: string;
}
