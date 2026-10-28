# Plan: 환자 모바일 앱 API 기획 (patient-app)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:8349 · apps/api/src/app.module.ts:120 · 잔여: NICE/PASS 본인인증 실연동(발급기관 서명검증)(사람)

> Created: 2026-05-19
> Status: Draft → **v2 (검토 반영)**
> Priority: Critical
> 완성도: v1 68점 → v2 보완

---

## 1. 배경

### 현재 상태
- 환자에게 **계정(ID/PW)이 없음** — MRN+생년월일로만 인증
- 포털/예약 모두 웹 브라우저 기반
- JWT 30분 만료, 세션 DB 관리
- 환자 등록은 **의료진이 HIS에서** 수행 (환자 자가 등록 불가)

### 문제점
| 문제 | 설명 |
|------|------|
| 인증 취약 | MRN+생년월일은 추측/유출 가능 |
| 계정 없음 | 비밀번호 설정, 기기 등록, 알림 수신 불가 |
| 자가등록 불가 | 신규 환자가 앱에서 직접 가입 불가 |
| 모바일 미지원 | 푸시 알림, 생체인증, 오프라인 등 네이티브 기능 없음 |
| 법적 미충족 | 본인확인 미흡, 개인정보 동의 없음, 보호자 접근 법적 근거 미비 |

### 목표
환자가 **법적 본인확인을 거쳐 가입하고, 안전하게 의료정보를 조회/관리**할 수 있는 모바일 앱 API 체계 구축.

---

## 2. 법적 근거 및 규정 준수

### 2-1. 관련 법률

| 법률 | 조항 | 적용 |
|------|------|------|
| **개인정보보호법** 제15조 | 개인정보 수집·이용 동의 | 가입 시 동의 수집 필수 |
| **개인정보보호법** 제23조 | 민감정보(건강정보) 처리 | 별도 동의 필수 |
| **개인정보보호법** 제24조의2 | 주민등록번호 수집 제한 | 의료법 예외 근거 명시 |
| **의료법** 제21조 | 기록 열람/사본 발급 | 본인/보호자 범위, 필요 서류 |
| **의료법** 제22조 | 진료기록부 등 기재 | 주민번호 수집 법적 근거 |
| **의료법** 제23조의2 | 전자의무기록 관리 | 접근 기록 보관 의무 |
| **국민건강보험법** 시행규칙 | 보험 청구 | 주민번호 필요 근거 |
| **전자서명법** | 전자서명 효력 | 서류 발급 시 본인확인 |
| **정보통신망법** 제50조 | 야간 메시지 제한 | 21시~08시 알림 제한 |
| **장애인차별금지법** | 접근성 | 앱 접근성 기준 준수 |

### 2-2. 주민등록번호 처리 정책

| 항목 | 정책 |
|------|------|
| **수집 근거** | 의료법 제22조 제2항 (진료기록부 기재), 국민건강보험법 시행규칙 (보험 청구) |
| **수집 방법** | 가입 시 별도 동의 화면 (개인정보보호법 제24조) + 통신사 본인확인으로 검증 |
| **암호화** | AES-256-GCM 암호화 저장 (기존 Patient.nationalId 방식 동일) |
| **접근 제한** | 복호화 접근 시 별도 권한 + 접근 로그 기록 (의료법 제23조의2) |
| **마스킹** | 앱 표시 시 항상 마스킹 (720108-1******) |
| **보유 기간** | 진료 종료 후 10년 (의료법 시행규칙 제15조) |
| **파기 방법** | 보유기간 만료 시 복호화 키 폐기 → 복원 불가 |
| **파기 로그** | 파기 일시, 대상, 방법 기록 (5년 보관) |

### 2-3. 개인정보 동의 항목

| 동의 유형 | 필수/선택 | 내용 |
|----------|:--------:|------|
| 개인정보 수집·이용 | **필수** | 이름, 생년월일, 연락처, 주소 |
| 민감정보(건강) 처리 | **필수** | 진료기록, 검사결과, 처방 열람 |
| 고유식별정보(주민번호) | **별도 필수** | 주민등록번호 수집·이용 |
| 제3자 제공 | **필수** | 건강보험공단(HIRA), 보험사 |
| 마케팅 정보 수신 | 선택 | 건강정보, 병원 이벤트 |
| 위치정보 수집 | 선택 | 가까운 약국/응급실 안내 |

---

## 3. 가입/인증 플로우

### 3-1. 가입 플로우 (NICE/PASS 본인인증)

```
[1] 앱 설치 → 회원가입
    ↓
[2] 개인정보 동의 수집 (필수 4개 + 선택 2개)
    ↓
[3] 통신사 본인인증 (NICE 또는 PASS)
    → 이름, 생년월일, 성별, CI(Connecting Information), 휴대폰 번호 반환
    → CI = 본인 고유 식별값 (유일, 변경불가)
    ↓
[4] 기존 환자 매칭 (3단계 안전 매칭)
    ├── 1차: CI값으로 PatientAccount 조회 (기 가입 방지)
    ├── 2차: Patient 테이블에서 이름 + 생년월일 + 성별 매칭
    │   ├── 1명 매칭 → 자동 연결
    │   ├── 2명+ 매칭 → 추가 확인 (보험번호 또는 최근 진료일)
    │   └── 0명 매칭 → 신규 Patient 생성
    └── 3차: CI값을 Patient에 저장 (다음 매칭용)
    ↓
[5] 주민등록번호 입력 (별도 동의 후, 선택이지만 보험청구에 필요)
    → AES-256-GCM 암호화 저장
    → 생년월일/성별 크로스 검증
    ↓
[6] 주소 입력 (다음 우편번호 API 자동완성)
    ↓
[7] 비밀번호 설정 (영문+숫자+특수문자 8자 이상)
    + 간편 PIN 6자리 설정
    ↓
[8] 생체 인증 등록 (지문/Face ID) — 선택
    ↓
[9] 푸시 알림 동의 + FCM/APNs 토큰 등록
    ↓
[10] 가입 완료 → 홈 화면
```

### 3-2. 로그인 플로우

```
[일반 로그인]
  휴대폰 번호 + 비밀번호 → JWT 발급 (accessToken + refreshToken)
  + 2차 인증 (선택): SMS OTP 추가 확인

[간편 로그인]
  PIN 6자리 → JWT 발급 (기기 등록 필수)

[생체 인증 로그인]
  지문/Face ID → 기기 저장 refreshToken으로 자동 갱신

[자동 로그인]
  앱 실행 시 refreshToken 유효하면 자동 accessToken 갱신

[보안 강화 — 중요 작업 시 재인증]
  서류 신청, 개인정보 변경, 결제 → PIN/생체 재확인 필요
  주민번호 조회/변경 → 비밀번호 재입력 필수
```

### 3-3. 비밀번호 정책

| 항목 | 정책 |
|------|------|
| 최소 길이 | 8자 |
| 복잡도 | 영문 + 숫자 + 특수문자 조합 |
| 해싱 | bcrypt (rounds 12) |
| 이전 비밀번호 재사용 | 최근 3개 금지 |
| 변경 주기 | 권장 90일 (강제 아님) |
| 실패 잠금 | 5회 실패 → 30분 잠금, 10회 → 1일 잠금 |
| 잠금 해제 | 자동 (시간 경과) 또는 관리자 수동 |
| PIN | 6자리 숫자, bcrypt 해시, 기기 바인딩 |

### 3-4. 보호자 접근 (의료법 제21조 준수)

#### 열람 가능 관계 (의료법 제21조 제3항)

| 관계 | 조건 | 필요 서류 |
|------|------|----------|
| 본인 | - | 본인 확인 완료 |
| 배우자 | 환자 동의 또는 의식불명/사망 | 신분증 + 가족관계증명서 + (동의서) |
| 직계 존비속 | 환자 동의 또는 의식불명/사망 | 신분증 + 가족관계증명서 + (동의서) |
| 배우자의 직계존속 | 환자 동의 또는 의식불명/사망 | 신분증 + 가족관계증명서 + (동의서) |
| 미성년자의 법정대리인 | - | 신분증 + 가족관계증명서 |
| 기타 | 환자의 서면 동의 필수 | 신분증 + 위임장 + 환자 신분증 사본 |

#### 보호자 접근 범위

| 데이터 | 열람 가능 |
|--------|:--------:|
| 예약 정보 | O |
| 진료 요약 (진단명, 처방) | O |
| 검사 결과 | O |
| 진료기록 상세 (SOAP 원문) | 제한 (요청 시 서류 발급) |
| 수납 내역 | O |
| 개인정보 변경 | X (본인만) |
| 서류 발급 신청 | O (위임장 필요) |

#### 보호자 등록 플로우

```
[1] 보호자 본인 앱 가입 (NICE/PASS 본인인증)
    ↓
[2] 보호자 등록 신청 (피부양자 MRN 또는 이름+생년월일)
    ↓
[3] 증빙 서류 업로드 (가족관계증명서 + 환자 동의서)
    ↓
[4] 병원 관리자 검토 → 승인/거부
    ↓
[5] 승인 시 → 피부양자 정보 열람 권한 부여
    + 열람 범위 제한 (위 표 기준)
    + 모든 열람 이력 감사 로그 기록
```

---

## 4. DB 스키마

### 4-1. PatientAccount (환자 계정)

```prisma
model PatientAccount {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @unique @map("patient_id") @db.Uuid
  phone           String    @unique @db.VarChar(20)
  phoneVerified   Boolean   @default(false) @map("phone_verified")
  ci              String?   @unique @db.VarChar(100)  // NICE/PASS CI값 (본인 고유 식별)
  passwordHash    String    @map("password_hash") @db.VarChar(255)
  previousPasswords Json?   @map("previous_passwords") @db.JsonB // 최근 3개 해시 (재사용 방지)
  pinHash         String?   @map("pin_hash") @db.VarChar(255)
  biometricEnabled Boolean  @default(false) @map("biometric_enabled")
  email           String?   @db.VarChar(255)
  emailVerified   Boolean   @default(false) @map("email_verified")
  status          String    @default("ACTIVE") @db.VarChar(20)
  // ACTIVE, SUSPENDED, LOCKED, WITHDRAWN
  failedAttempts  Int       @default(0) @map("failed_attempts")
  lockedUntil     DateTime? @map("locked_until") @db.Timestamptz()
  passwordChangedAt DateTime? @map("password_changed_at") @db.Timestamptz()
  lastLoginAt     DateTime? @map("last_login_at") @db.Timestamptz()
  lastLoginIp     String?   @map("last_login_ip") @db.VarChar(50)
  twoFactorEnabled Boolean  @default(false) @map("two_factor_enabled")
  marketingConsent Boolean  @default(false) @map("marketing_consent")
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
  withdrawnAt     DateTime? @map("withdrawn_at") @db.Timestamptz()

  patient    Patient           @relation(fields: [patientId], references: [id])
  devices    PatientDevice[]
  consents   PatientConsent[]
  guardians  PatientGuardian[] @relation("GuardianAccount")
  dependents PatientGuardian[] @relation("DependentAccount")

  @@index([ci])
  @@map("patient_accounts")
}
```

### 4-2. PatientConsent (개인정보 동의 이력)

```prisma
model PatientConsent {
  id          String    @id @default(uuid()) @db.Uuid
  accountId   String    @map("account_id") @db.Uuid
  type        String    @db.VarChar(50)
  // PRIVACY_COLLECT, SENSITIVE_HEALTH, NATIONAL_ID, THIRD_PARTY, MARKETING, LOCATION
  version     String    @db.VarChar(20)  // 동의서 버전 (내용 변경 시 재동의)
  agreed      Boolean
  agreedAt    DateTime? @map("agreed_at") @db.Timestamptz()
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz()
  ipAddress   String?   @map("ip_address") @db.VarChar(50)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  account PatientAccount @relation(fields: [accountId], references: [id])

  @@index([accountId, type])
  @@map("patient_consents")
}
```

### 4-3. PatientDevice (기기 관리)

```prisma
model PatientDevice {
  id              String   @id @default(uuid()) @db.Uuid
  accountId       String   @map("account_id") @db.Uuid
  deviceId        String   @map("device_id") @db.VarChar(255)
  deviceName      String?  @map("device_name") @db.VarChar(100)  // "iPhone 15", "Galaxy S24"
  platform        String   @db.VarChar(20)   // iOS, Android, Web
  osVersion       String?  @map("os_version") @db.VarChar(30)
  appVersion      String?  @map("app_version") @db.VarChar(20)
  fcmToken        String?  @map("fcm_token") @db.VarChar(500)
  refreshTokenHash String? @map("refresh_token_hash") @db.VarChar(255) // 해시 저장 (평문 X)
  lastActiveAt    DateTime @default(now()) @map("last_active_at") @db.Timestamptz()
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  account PatientAccount @relation(fields: [accountId], references: [id])

  @@unique([accountId, deviceId])
  @@map("patient_devices")
}
```

### 4-4. PatientGuardian (보호자 관계)

```prisma
model PatientGuardian {
  id            String    @id @default(uuid()) @db.Uuid
  guardianId    String    @map("guardian_id") @db.Uuid
  dependentId   String    @map("dependent_id") @db.Uuid
  relationship  String    @db.VarChar(30)
  // SPOUSE, PARENT, CHILD, GRANDPARENT, PARENT_IN_LAW, LEGAL_GUARDIAN, OTHER
  legalBasis    String    @map("legal_basis") @db.VarChar(50)
  // MINOR_GUARDIAN, PATIENT_CONSENT, UNCONSCIOUS, DECEASED, POWER_OF_ATTORNEY
  documentUrl   String?   @map("document_url") @db.VarChar(500) // 증빙 서류 업로드 URL
  patientConsentUrl String? @map("patient_consent_url") @db.VarChar(500) // 환자 동의서
  accessScope   Json?     @map("access_scope") @db.JsonB
  // { "appointments": true, "encounters": true, "labs": true, "billing": true, "documents": false }
  isApproved    Boolean   @default(false) @map("is_approved")
  approvedBy    String?   @map("approved_by") @db.Uuid
  approvedAt    DateTime? @map("approved_at") @db.Timestamptz()
  rejectedReason String?  @map("rejected_reason") @db.VarChar(300)
  expiresAt     DateTime? @map("expires_at") @db.Timestamptz() // 접근 유효기간
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  guardian  PatientAccount @relation("GuardianAccount", fields: [guardianId], references: [id])
  dependent PatientAccount @relation("DependentAccount", fields: [dependentId], references: [id])

  @@unique([guardianId, dependentId])
  @@map("patient_guardians")
}
```

### 4-5. PatientFamily (가족 구성원)

```prisma
model PatientFamily {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  relationship    String    @db.VarChar(30) // FATHER, MOTHER, SPOUSE, SON, DAUGHTER, SIBLING, GRANDPARENT, OTHER
  name            String    @db.VarChar(100)
  dateOfBirth     DateTime? @map("date_of_birth") @db.Date
  phone           String?   @db.VarChar(20)
  linkedPatientId String?   @map("linked_patient_id") @db.Uuid
  isEmergencyContact Boolean @default(false) @map("is_emergency_contact")
  isDeceased      Boolean   @default(false) @map("is_deceased")
  medicalHistory  String?   @map("medical_history") @db.VarChar(500) // 가족력용
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  patient Patient @relation(fields: [patientId], references: [id])

  @@index([patientId])
  @@map("patient_families")
}
```

### 4-6. PatientAddress (구조화 주소)

```prisma
model PatientAddress {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  type          String   @default("HOME") @db.VarChar(20) // HOME, WORK, TEMP
  zipCode       String?  @map("zip_code") @db.VarChar(10)
  province      String?  @db.VarChar(50)     // 시/도
  city          String?  @db.VarChar(50)     // 시/군/구
  district      String?  @db.VarChar(100)    // 도로명
  detail        String?  @db.VarChar(200)    // 상세 주소
  fullAddress   String?  @map("full_address") @db.VarChar(500)
  roadAddress   String?  @map("road_address") @db.VarChar(500)
  jibunAddress  String?  @map("jibun_address") @db.VarChar(500)
  isPrimary     Boolean  @default(true) @map("is_primary")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  patient Patient @relation(fields: [patientId], references: [id])

  @@index([patientId])
  @@map("patient_addresses")
}
```

### 4-7. PatientNotification (알림)

```prisma
model PatientNotification {
  id          String    @id @default(uuid()) @db.Uuid
  accountId   String    @map("account_id") @db.Uuid
  type        String    @db.VarChar(30)
  // APPOINTMENT_REMINDER, LAB_RESULT, DOCUMENT_READY, BILLING, QUESTIONNAIRE, SYSTEM
  title       String    @db.VarChar(200)
  body        String    @db.VarChar(500)
  data        Json?     @db.JsonB  // { "appointmentId": "...", "screen": "appointment_detail" }
  isRead      Boolean   @default(false) @map("is_read")
  readAt      DateTime? @map("read_at") @db.Timestamptz()
  sentVia     String?   @map("sent_via") @db.VarChar(20) // PUSH, SMS, IN_APP
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  @@index([accountId, isRead])
  @@index([createdAt])
  @@map("patient_notifications")
}

model NotificationSetting {
  id          String  @id @default(uuid()) @db.Uuid
  accountId   String  @map("account_id") @db.Uuid
  type        String  @db.VarChar(30) // 알림 유형별 on/off
  enabled     Boolean @default(true)
  pushEnabled Boolean @default(true) @map("push_enabled")
  smsEnabled  Boolean @default(false) @map("sms_enabled")

  @@unique([accountId, type])
  @@map("notification_settings")
}
```

### 4-8. SmsVerification (OTP 인증)

```prisma
model SmsVerification {
  id         String   @id @default(uuid()) @db.Uuid
  phone      String   @db.VarChar(20)
  code       String   @db.VarChar(6)
  purpose    String   @db.VarChar(30) // SIGNUP, LOGIN_2FA, PASSWORD_RESET
  expiresAt  DateTime @map("expires_at") @db.Timestamptz()
  verified   Boolean  @default(false)
  attempts   Int      @default(0) // 최대 5회
  ipAddress  String?  @map("ip_address") @db.VarChar(50)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([phone, purpose])
  @@map("sms_verifications")
}
```

---

## 5. API 설계

### 5-1. 인증 API (`/api/v1/patient-auth`)

| Method | Endpoint | 설명 | 인증 | Rate Limit |
|--------|----------|------|:----:|:----------:|
| POST | `/nice/request` | NICE 본인인증 요청 (팝업 URL 반환) | X | 10/분 |
| POST | `/nice/callback` | NICE 인증 결과 콜백 → CI값 반환 | X | - |
| POST | `/signup` | 회원가입 (CI + 동의 + 비밀번호) | X | 5/분 |
| POST | `/login` | 로그인 (phone + password) | X | 10/분 |
| POST | `/login/pin` | PIN 로그인 (기기 바인딩) | X | 10/분 |
| POST | `/login/biometric` | 생체 인증 (refreshToken) | X | - |
| POST | `/token/refresh` | accessToken 갱신 | refresh | - |
| POST | `/logout` | 로그아웃 (기기 토큰 무효화) | O | - |
| POST | `/sms/send` | SMS OTP 발송 (2FA/비밀번호 재설정) | X | 1/분, 10/일 |
| POST | `/sms/verify` | OTP 인증 | X | 5/분 |
| PUT | `/password/change` | 비밀번호 변경 (현재PW 필요) | O | 5/분 |
| POST | `/password/reset` | 비밀번호 재설정 (NICE 재인증) | X | 3/분 |
| PUT | `/pin/set` | PIN 설정/변경 (PW 필요) | O | - |
| PUT | `/biometric/toggle` | 생체 인증 on/off | O | - |
| POST | `/withdraw` | 계정 탈퇴 (PW + 동의) | O | - |

### 5-2. 기기 관리 API

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|:----:|
| POST | `/devices/register` | 기기 등록 + FCM 토큰 | O |
| PUT | `/devices/:id/fcm` | FCM 토큰 갱신 | O |
| GET | `/devices` | 등록 기기 목록 | O |
| DELETE | `/devices/:id` | 기기 삭제 (원격 로그아웃) | O |

### 5-3. 개인정보 관리 API

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|:----:|
| GET | `/profile` | 내 정보 조회 | O |
| PATCH | `/profile` | 연락처/이메일 변경 | O |
| GET | `/profile/address` | 주소 목록 | O |
| POST | `/profile/address` | 주소 등록 (다음 우편번호) | O |
| PUT | `/profile/address/:id` | 주소 수정 | O |
| DELETE | `/profile/address/:id` | 주소 삭제 | O |
| GET | `/profile/family` | 가족 구성원 목록 | O |
| POST | `/profile/family` | 가족 등록 | O |
| PUT | `/profile/family/:id` | 가족 수정 | O |
| DELETE | `/profile/family/:id` | 가족 삭제 | O |
| PUT | `/profile/national-id` | 주민번호 등록/변경 | O + PW |
| GET | `/profile/national-id/masked` | 마스킹 주민번호 | O |

### 5-4. 보호자 API

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|:----:|
| POST | `/guardians/request` | 보호자 등록 신청 + 서류 업로드 | O |
| GET | `/guardians` | 내 보호자/피부양자 목록 | O |
| GET | `/guardians/:id/data/:resource` | 피부양자 데이터 열람 (범위 제한) | O |
| DELETE | `/guardians/:id` | 보호자 관계 해제 | O |

### 5-5. 알림 API

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|:----:|
| GET | `/notifications` | 알림 목록 (페이지네이션) | O |
| GET | `/notifications/unread-count` | 미읽음 수 | O |
| PUT | `/notifications/:id/read` | 읽음 처리 | O |
| PUT | `/notifications/read-all` | 전체 읽음 | O |
| GET | `/notifications/settings` | 알림 설정 조회 | O |
| PUT | `/notifications/settings` | 알림 설정 변경 | O |

### 5-6. 관리자 API (`/api/v1/admin/patient-accounts`)

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | `/` | 계정 목록 (검색/필터) | ADMIN |
| GET | `/:id` | 계정 상세 | ADMIN |
| PUT | `/:id/lock` | 계정 잠금 | ADMIN |
| PUT | `/:id/unlock` | 계정 잠금 해제 | ADMIN |
| GET | `/:id/audit` | 접근 감사 로그 | ADMIN |
| GET | `/guardians/pending` | 보호자 승인 대기 목록 | ADMIN, NURSE |
| PUT | `/guardians/:id/approve` | 보호자 승인 | ADMIN |
| PUT | `/guardians/:id/reject` | 보호자 거부 | ADMIN |
| GET | `/stats` | 가입/이용 통계 | ADMIN |

### 5-7. 기존 포털 API 호환

```
[Guard 전환 전략]
  기존: PortalAuthGuard (MRN + DOB → JWT → patientId)
  신규: PatientAccountAuthGuard (phone + PW → JWT → patientId)

  ↓ OR 조건 구현

  @UseGuards(PortalOrPatientGuard)  // 둘 중 하나 통과하면 OK
  // 두 가드 모두 req.portalPatientId에 patientId 주입
```

기존 포털 API 20+개는 **Guard만 교체**하면 앱에서 그대로 사용 가능.

---

## 6. 보안 설계

### 6-1. 토큰/세션

| 토큰 | 만료 | 저장 | 비고 |
|------|------|------|------|
| accessToken | 1시간 | 앱 메모리 | JWT HS256 → RS256 전환 권장 |
| refreshToken | 30일 | Secure Storage + DB 해시 | 기기 바인딩 |
| PIN | 영구 | Secure Storage (bcrypt 해시) | 기기 바인딩 |
| 생체인증 키 | 영구 | OS Keychain/Keystore | 기기 바인딩 |

### 6-2. 추가 보안 기능

| 기능 | 설명 |
|------|------|
| **이상 접근 감지** | 새 기기/IP 로그인 시 SMS 알림 |
| **동시 접속 제한** | 최대 3기기 (초과 시 가장 오래된 기기 자동 로그아웃) |
| **비활성 타임아웃** | 앱 5분 비활성 → PIN/생체 재확인 |
| **스크린 캡처 방지** | Android: FLAG_SECURE, iOS: 제한적 |
| **루팅/탈옥 감지** | 감지 시 경고 (차단은 선택) |
| **SSL 피닝** | 중간자 공격 방지 |
| **난독화** | ProGuard (Android), 코드 난독화 (iOS) |
| **앱 무결성** | Play Integrity API (Android), App Attest (iOS) |

### 6-3. 감사 로그 (의료법 제23조의2)

모든 데이터 접근은 `PortalAuditLog`에 자동 기록:
- 접근자 (accountId)
- 접근 대상 (patientId, 리소스 종류)
- 접근 유형 (VIEW, DOWNLOAD, PRINT)
- IP, 기기, 시각
- 보호자 대리 접근 시 별도 표시

---

## 7. 알림 설계

### 7-1. 알림 유형별 발송 시점

| 유형 | 발송 시점 | 채널 |
|------|----------|------|
| 예약 리마인더 | 예약 24시간 전, 2시간 전 | Push + SMS |
| 예약 변경/취소 | 즉시 | Push |
| 검사 결과 완료 | 결과 확정 즉시 | Push |
| 서류 발급 완료 | 상태 변경 시 | Push |
| 문진표 미작성 | 만료 24시간 전 | Push |
| 수납 안내 | 진료 완료 후 | Push |
| 보안 알림 | 새 기기 로그인, 비밀번호 변경 | Push + SMS |
| 시스템 공지 | 관리자 발송 | Push |

### 7-2. 야간 발송 제한 (정보통신망법 제50조)

- 21:00 ~ 08:00 사이 **마케팅/홍보성** 알림 발송 금지
- **의료/안전** 알림 (검사 결과, 보안 경고)은 시간 제한 없음
- 알림 발송 시 type별 야간 제한 여부 자동 판단

### 7-3. 알림 내용 보안

- 잠금화면 표시: 환자명/진료과 등 민감정보 미포함
- 예: "Hospital RUN: 새로운 알림이 있습니다" (상세는 앱 내에서)

---

## 8. 모바일 앱 고려사항

### 8-1. 기술 스택

| 항목 | 선택 | 사유 |
|------|------|------|
| **프레임워크** | React Native | 기존 Next.js(React) 코드 공유, 웹+앱 동시 지원 |
| **상태 관리** | Zustand | 기존 웹과 동일 |
| **API 클라이언트** | TanStack Query | 기존 웹과 동일 |
| **인증 저장** | react-native-keychain | Secure Storage |
| **생체 인증** | react-native-biometrics | 지문/Face ID |
| **푸시 알림** | @react-native-firebase/messaging | FCM |
| **주소 검색** | WebView (다음 우편번호) | 검증된 API |

### 8-2. 앱 스토어 심사 대비

| 스토어 | 요구사항 | 대응 |
|--------|---------|------|
| Apple | 의료 앱 가이드라인 | 면책 조항, 의료기기 해당 없음 명시 |
| Apple | HealthKit 미사용 시 | App Review에 의료정보 조회 전용임을 설명 |
| Google | 의료 앱 정책 | 개인정보 처리방침 URL, 데이터 안전 섹션 |
| 공통 | 최소 OS 버전 | iOS 15+, Android 10+ |

### 8-3. 오프라인/캐시 전략

| 데이터 | 캐시 | 오프라인 |
|--------|:----:|:--------:|
| 예약 목록 | O (5분) | 읽기 가능 |
| 진료이력 | O (30분) | 읽기 가능 |
| 검사결과 | O (30분) | 읽기 가능 |
| 문진표 작성 | O (localStorage) | 작성 가능 (제출은 온라인) |
| 서류 신청 | X | 불가 |

### 8-4. 딥링크

```
hospitalrun://appointments/:id     → 예약 상세
hospitalrun://labs/:id             → 검사 결과
hospitalrun://documents/:id        → 서류 상태
hospitalrun://questionnaire/:token → 문진표 작성
```

### 8-5. 접근성 (장애인차별금지법)

- VoiceOver (iOS) / TalkBack (Android) 지원
- 최소 터치 영역 44x44pt
- 색상 대비 4.5:1 이상
- 글자 크기 조절 지원

---

## 9. 계정 탈퇴 정책

### 의료법 vs 개인정보보호법 균형

```
[계정 탈퇴 시]
  PatientAccount → status = 'WITHDRAWN', withdrawnAt 기록
  PatientDevice → 전체 삭제
  PatientConsent → 보관 (동의 이력)
  PortalAuditLog → 보관 (감사 로그)

  ↕ (분리)

  Patient → 보존 (의료법 진료기록 보존 의무 10년)
  Encounter/Prescription/LabResult → 보존
  주민등록번호 → 의료기관이 계속 보유 가능 (의료법 근거)

  → 환자가 "앱 탈퇴"해도 "진료기록 삭제" 아님을 동의 시 명확 고지
```

---

## 10. 구현 로드맵

### Phase 1: 계정 체계 (핵심) `~7일`
1. DB 모델 8개 (PatientAccount, Consent, Device, Guardian, Family, Address, Notification, SmsVerification)
2. NICE 본인인증 연동
3. 회원가입 API (CI 매칭 + 동의 수집)
4. 로그인/로그아웃 API (phone + password/PIN)
5. 토큰 관리 (accessToken + refreshToken + 기기 바인딩)
6. 개인정보 CRUD (주소/가족/주민번호)
7. PatientAccountAuthGuard + 기존 PortalAuthGuard 호환
8. 관리자 계정 관리 페이지

### Phase 2: 보안 + 알림 `~5일`
9. 생체 인증 API
10. 2FA (SMS OTP)
11. 이상 접근 감지 + 기기 제한
12. 알림 서비스 (FCM/APNs)
13. 알림 설정 관리
14. 보호자 등록/승인 워크플로우

### Phase 3: 모바일 앱 `~7일`
15. React Native 프로젝트 셋업
16. 로그인/회원가입 화면
17. 홈/예약/진료/검사/수납/서류 화면
18. 푸시 알림 연동
19. 생체 인증 연동
20. 앱 스토어 제출

---

## 11. 성공 지표

| 지표 | 목표 |
|------|------|
| 앱 가입률 | 월 방문 환자 중 30% |
| DAU | 가입자 중 15% |
| 셀프 예약률 | 전체 예약의 40% |
| 푸시 알림 도달률 | 90%+ |
| 앱 평점 | 4.5+ |
| 법적 컴플라이언스 | 개인정보보호법/의료법 100% 준수 |
