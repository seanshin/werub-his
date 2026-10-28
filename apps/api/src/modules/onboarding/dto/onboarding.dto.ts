import { IsString, IsOptional, IsEmail, IsIn, IsDateString, MaxLength, IsObject, IsArray, IsBoolean } from 'class-validator';

// 초대 등록 (관리자) — 성/이름 분리, 생년월일은 본인확인 게이트
export class CreateInviteDto {
  @IsString() @MaxLength(50) candidateFamilyName!: string;
  @IsString() @MaxLength(50) candidateGivenName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsString() @MaxLength(30) jobCategory!: string;
  @IsOptional() @IsString() @MaxLength(40) department?: string;
  @IsDateString() hireDate!: string;
  @IsIn(['FULL_TIME', 'CONTRACT', 'COMMISSIONED', 'PART_TIME']) contractType!: string;
}

// 발송 채널
export class SendInviteDto {
  @IsIn(['EMAIL', 'QR_IMAGE', 'LINK']) channel!: string;
  /**
   * EMAIL 발송 시 메일에 넣을 초대 링크. 서버엔 토큰이 해시로만 남아 재구성할 수 없어
   * 발급 화면이 들고 있는 링크를 받는다(서버가 tokenHash 대조 후에만 사용).
   */
  @IsOptional() @IsString() @MaxLength(300) link?: string;
}

// 입사예정자 본인확인(claim) — 생년월일 대조
export class ClaimDto {
  @IsDateString() birthDate!: string;
}

// 패스키(생체) 등록 검증 — response 는 WebAuthn RegistrationResponseJSON
export class PasskeyVerifyDto {
  @IsObject() response!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(60) deviceName?: string;
}

// 입사 개인정보(인적사항) — 주민번호·계좌 제외(서류로만, ERP 입력)
export class UpsertProfileDto {
  @IsOptional() @IsIn(['M', 'F', 'OTHER']) gender?: string;
  @IsOptional() @IsString() @MaxLength(40) nationality?: string;
  @IsOptional() @IsString() @MaxLength(300) photoKey?: string;
  @IsOptional() @IsString() @MaxLength(10) zipCode?: string;
  @IsOptional() @IsString() @MaxLength(200) addr1?: string;
  @IsOptional() @IsString() @MaxLength(200) addr2?: string;
  @IsOptional() @IsString() @MaxLength(50) emgName?: string;
  @IsOptional() @IsString() @MaxLength(30) emgRelation?: string;
  @IsOptional() @IsString() @MaxLength(20) emgPhone?: string;
  @IsOptional() @IsArray() education?: unknown[];
  @IsOptional() @IsArray() career?: unknown[];
  @IsOptional() @IsArray() licenses?: unknown[];
  @IsOptional() @IsIn(['DONE', 'EXEMPT', 'NA', 'UNFINISHED']) military?: string;
  @IsOptional() @IsArray() dependents?: unknown[];
  @IsOptional() @IsBoolean() sensitiveConsent?: boolean;
  @IsOptional() @IsBoolean() submit?: boolean; // true 면 제출 확정
}

// 서류 업로드 메타
export class UploadDocumentDto {
  @IsIn(['ID_CARD', 'BANKBOOK', 'LICENSE', 'CAREER', 'PLEDGE', 'HEALTH', 'PHOTO', 'ETC']) category!: string;
}

// 서류 검토(관리자)
export class ReviewDocumentDto {
  @IsIn(['APPROVED', 'REJECTED']) status!: string;
  @IsOptional() @IsString() @MaxLength(300) rejectReason?: string;
}

// 전자계약 서명 (최소 — 템플릿·서명이미지)
export class SignContractDto {
  @IsOptional() @IsString() @MaxLength(64) templateId?: string;
  @IsOptional() @IsString() @MaxLength(300) signatureImageKey?: string;
}
