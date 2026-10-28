import {
  IsString, IsOptional, IsBoolean, IsNotEmpty, IsObject, ValidateNested, IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 주소 수정 ──

export class UpdatePatientAddressDto {
  @ApiPropertyOptional({ description: '주소 유형 (HOME, WORK 등)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '우편번호' })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ description: '도로명 주소' })
  @IsOptional()
  @IsString()
  roadAddress?: string;

  @ApiPropertyOptional({ description: '지번 주소' })
  @IsOptional()
  @IsString()
  jibunAddress?: string;

  @ApiPropertyOptional({ description: '상세 주소' })
  @IsOptional()
  @IsString()
  detail?: string;

  @ApiPropertyOptional({ description: '기본 주소 여부' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

// ── 가족 수정 ──

export class UpdatePatientFamilyDto {
  @ApiPropertyOptional({ description: '관계 (부, 모, 배우자 등)' })
  @IsOptional()
  @IsString()
  relationship?: string;

  @ApiPropertyOptional({ description: '이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '생년월일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: '연락처' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '비상연락처 여부' })
  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiPropertyOptional({ description: '병력' })
  @IsOptional()
  @IsString()
  medicalHistory?: string;
}

// ── 주소 등록 ──

export class CreatePatientAddressDto {
  @ApiPropertyOptional({ description: '주소 유형 (HOME, WORK 등)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '우편번호' })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ description: '도로명 주소' })
  @IsOptional()
  @IsString()
  roadAddress?: string;

  @ApiPropertyOptional({ description: '지번 주소' })
  @IsOptional()
  @IsString()
  jibunAddress?: string;

  @ApiPropertyOptional({ description: '상세 주소' })
  @IsOptional()
  @IsString()
  detail?: string;

  @ApiPropertyOptional({ description: '기본 주소 여부' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

// ── 가족 등록 ──

export class CreatePatientFamilyDto {
  @ApiProperty({ description: '관계 (부, 모, 배우자 등)' })
  @IsString()
  @IsNotEmpty()
  relationship: string;

  @ApiProperty({ description: '이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '생년월일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: '연락처' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '비상연락처 여부' })
  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiPropertyOptional({ description: '병력' })
  @IsOptional()
  @IsString()
  medicalHistory?: string;
}

// ── 주민등록번호 등록/변경 ──

export class SetNationalIdDto {
  @ApiProperty({ description: '주민등록번호' })
  @IsString()
  @IsNotEmpty()
  nationalId: string;

  @ApiProperty({ description: '비밀번호 (재확인)' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

// ── 회원가입 주소 ──

export class SignupAddressDto {
  @ApiProperty({ description: '우편번호' })
  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @ApiProperty({ description: '도로명 주소' })
  @IsString()
  @IsNotEmpty()
  roadAddress: string;

  @ApiProperty({ description: '지번 주소' })
  @IsString()
  @IsNotEmpty()
  jibunAddress: string;

  @ApiProperty({ description: '상세 주소' })
  @IsString()
  @IsNotEmpty()
  detail: string;
}

// ── 회원가입 ──

export class PatientSignupDto {
  /**
   * 🔴 서버가 검증한 본인확인 거래의 **일회용 식별자**. 앱은 CI 를 알지도, 보내지도 않는다.
   *    이것이 있으면 이름·생년·성별·전화는 **인증 결과가 정본**이고 요청 값은 무시된다.
   */
  @ApiPropertyOptional({ description: '본인확인 verificationId (권장 경로)' })
  @IsOptional()
  @IsString()
  verificationId?: string;

  /** @deprecated 본인확인 연동 전 경로 — 서버가 형식을 검증하고 지어낸 값은 거부한다 */
  @ApiPropertyOptional({ description: '본인확인기관 CI — verificationId 가 없을 때만' })
  @IsOptional()
  @IsString()
  ci?: string;

  @ApiProperty({ description: '이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '생년월일 (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  dateOfBirth: string;

  @ApiProperty({ description: '성별 (MALE, FEMALE)' })
  @IsString()
  @IsNotEmpty()
  gender: string;

  @ApiProperty({ description: '휴대폰 번호' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: '비밀번호 (영문+숫자+특수문자 8자 이상)' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'PIN (6자리 숫자)' })
  @IsString()
  @IsNotEmpty()
  pin: string;

  @ApiPropertyOptional({ description: '주민등록번호' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({ description: '주소 정보', type: SignupAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SignupAddressDto)
  address?: SignupAddressDto;

  @ApiProperty({ description: '동의 항목 (privacyCollect, sensitiveHealth, thirdParty 필수)', type: Object })
  @IsObject()
  @IsNotEmpty()
  consents: Record<string, boolean>;
}

// ── SMS OTP 발송 ──

export class SendSmsDto {
  @ApiProperty({ description: '휴대폰 번호' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: '목적 (SIGNUP, LOGIN, PASSWORD_RESET 등)' })
  @IsString()
  @IsNotEmpty()
  purpose: string;
}

// ── SMS OTP 인증 ──

export class VerifySmsDto {
  @ApiProperty({ description: '휴대폰 번호' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: 'OTP 코드' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: '목적' })
  @IsString()
  @IsNotEmpty()
  purpose: string;
}

// ── 로그인 ──

export class PatientLoginDto {
  @ApiProperty({ description: '휴대폰 번호' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: '비밀번호' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: '기기 ID' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({ description: '플랫폼 (iOS, Android, Web)' })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiPropertyOptional({ description: 'FCM 푸시 토큰' })
  @IsOptional()
  @IsString()
  fcmToken?: string;
}

// ── PIN 로그인 ──

export class PatientLoginPinDto {
  @ApiProperty({ description: '휴대폰 번호' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: 'PIN (6자리)' })
  @IsString()
  @IsNotEmpty()
  pin: string;

  @ApiProperty({ description: '기기 ID' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiPropertyOptional({ description: 'FCM 푸시 토큰' })
  @IsOptional()
  @IsString()
  fcmToken?: string;
}

// ── 토큰 갱신 ──

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh Token' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;

  /** 기기 결합 — 다른 기기에서 남의 refresh 를 쓰지 못하게 */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  installationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceId?: string;
}

// ── 로그아웃 ──

export class PatientLogoutDto {
  @ApiPropertyOptional({ description: '기기 ID (특정 기기만 로그아웃)' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

// ── 비밀번호 변경 ──

export class ChangePasswordDto {
  @ApiProperty({ description: '현재 비밀번호' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: '새 비밀번호' })
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

// ── PIN 설정 ──

export class SetPinDto {
  @ApiProperty({ description: '비밀번호 (본인 확인)' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'PIN (6자리)' })
  @IsString()
  @IsNotEmpty()
  pin: string;
}

// ── 보호자 등록 신청 ──

export class GuardianRequestDto {
  @ApiProperty({ description: '보호자 계정 ID (신청자 본인)' })
  @IsString()
  @IsNotEmpty()
  guardianAccountId: string;

  @ApiProperty({ description: '피부양자 MRN' })
  @IsString()
  @IsNotEmpty()
  dependentMrn: string;

  @ApiProperty({ description: '관계 (SPOUSE, PARENT, CHILD, GRANDPARENT, LEGAL_GUARDIAN, OTHER)' })
  @IsString()
  @IsNotEmpty()
  relationship: string;

  @ApiProperty({ description: '법적 근거 (MINOR_GUARDIAN, PATIENT_CONSENT, UNCONSCIOUS, DECEASED, POWER_OF_ATTORNEY)' })
  @IsString()
  @IsNotEmpty()
  legalBasis: string;

  @ApiPropertyOptional({ description: '증빙 서류 URL' })
  @IsOptional()
  @IsString()
  documentUrl?: string;
}

// ── 보호자 승인/거부 ──

export class GuardianApproveDto {
  @ApiPropertyOptional({ description: '접근 범위 (JSON)' })
  @IsOptional()
  @IsObject()
  accessScope?: Record<string, boolean>;

  @ApiPropertyOptional({ description: '만료일 (ISO)' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class GuardianRejectDto {
  @ApiProperty({ description: '거부 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

// ── 알림 설정 변경 ──

export class NotificationSettingItemDto {
  @ApiProperty({ description: '알림 type (APPOINTMENT_REMINDER 등)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '수신 여부' })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ description: '푸시 수신 여부' })
  @IsBoolean()
  pushEnabled: boolean;

  @ApiProperty({ description: 'SMS 수신 여부' })
  @IsBoolean()
  smsEnabled: boolean;
}

export class UpdateNotificationSettingsDto {
  // ⚠️ 데코레이터 없는 필드는 전역 whitelist ValidationPipe가 strip → undefined("settings is not iterable" 500, 2026-07-07 검증에서 발견)
  @ApiProperty({ description: '알림 설정 목록', type: [NotificationSettingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationSettingItemDto)
  settings: NotificationSettingItemDto[];
}
