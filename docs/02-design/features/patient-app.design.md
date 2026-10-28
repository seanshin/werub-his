# Design: 환자 모바일 앱 — Phase 1 계정 체계 (patient-app)

> Created: 2026-05-19
> Plan: [patient-app.plan.md](../../01-plan/features/patient-app.plan.md)
> Phase 1 (계정 체계 핵심) 상세 설계

---

## 1. DB 스키마 (Phase 1 범위)

### 1-1. Patient 모델 확장

기존 Patient에 CI값과 관계 추가:

```prisma
// 기존 필드에 추가
model Patient {
  // ... 기존 필드 ...
  ci              String?   @unique @db.VarChar(200) // NICE/PASS CI값 (AES-256 암호화)

  // 신규 Relations
  account         PatientAccount?
  familyMembers   PatientFamily[]    @relation("PatientFamilyMembers")
  linkedByFamily  PatientFamily[]    @relation("LinkedFamilyPatient")
  addresses       PatientAddress[]
}
```

### 1-2. 신규 모델 6개

Plan 섹션 4의 모델을 구현:
- **PatientAccount** (4-1): 계정, CI, 비밀번호, PIN, 상태
- **PatientConsent** (4-2): 동의 이력 6종
- **PatientDevice** (4-3): 기기, FCM, refreshToken 해시
- **PatientFamily** (4-5): 가족 구성원, 가족력, 비상연락처
- **PatientAddress** (4-6): 구조화 주소 (도로명/지번)
- **SmsVerification** (4-8): OTP 3분/5회

> PatientGuardian (4-4), PatientNotification (4-7)은 Phase 2

---

## 2. 인증 아키텍처

### 2-1. 인증 플로우 (Phase 1)

```
[가입]
  NICE 본인인증 → CI + 이름 + 생년 + 성별 + 폰
    ↓
  동의 수집 (필수 4 + 선택 2)
    ↓
  기존 환자 매칭 (CI → 이름+생년+성별 → 추가확인)
    ↓
  비밀번호(8자+) + PIN(6자리) 설정
    ↓
  PatientAccount 생성 + PatientConsent 6건 저장

[로그인]
  phone + password → bcrypt 검증 → 실패 5회 잠금
    ↓
  accessToken (1h, JWT HS256) + refreshToken (30d, 기기 바인딩)
    ↓
  PatientDevice 등록/갱신

[토큰 갱신]
  refreshToken → DB 해시 확인 → 새 accessToken 발급

[Guard 호환]
  PatientAccountAuthGuard: JWT 검증 → req.portalPatientId = patientId
  PortalAuthGuard: 기존 MRN+DOB → req.portalPatientId = patientId
  → 기존 포털 API 코드 변경 없이 앱 지원
```

### 2-2. JWT Payload

```json
{
  "sub": "patient-account-uuid",
  "pid": "patient-uuid",
  "phone": "010-1234-5678",
  "type": "patient",
  "iat": 1716000000,
  "exp": 1716003600
}
```

### 2-3. NICE 본인인증 연동

```
[서버]
  POST /patient-auth/nice/request
    → NICE API에 인증 요청 → 팝업 URL 반환
  
[클라이언트]
  WebView로 NICE 인증 화면 표시 → 사용자 인증

[서버]
  POST /patient-auth/nice/callback
    → NICE에서 암호화된 결과 수신 → 복호화
    → CI, 이름, 생년, 성별, 폰번호 추출
    → 클라이언트에 반환
```

> NICE API 미연동 시 **개발용 폴백**: SMS OTP + 수동 정보 입력 (프로덕션 비활성)

---

## 3. API 상세 설계

### 3-1. 회원가입

**POST `/api/v1/patient-auth/signup`**

```typescript
// Request
{
  ci: string;                    // NICE 인증 결과 CI
  name: string;                  // 인증된 이름
  dateOfBirth: string;           // "1990-01-15"
  gender: "MALE" | "FEMALE";
  phone: string;                 // "010-1234-5678"
  password: string;              // 8자+, 영문+숫자+특수
  pin: string;                   // 6자리 숫자
  nationalId?: string;           // 주민번호 13자리 (별도 동의 시)
  address?: {                    // 다음 우편번호 결과
    zipCode: string;
    roadAddress: string;
    jibunAddress: string;
    detail: string;
  };
  consents: {                    // 동의 항목
    privacyCollect: true;        // 필수
    sensitiveHealth: true;       // 필수
    nationalIdProcess?: boolean; // 별도
    thirdParty: true;            // 필수
    marketing?: boolean;         // 선택
    location?: boolean;          // 선택
  };
}

// Response 200
{
  data: {
    accountId: string;
    patientId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }
}

// Error 409: 이미 가입된 CI
// Error 400: 필수 동의 미체크, 비밀번호 복잡도 미달
```

### 3-2. 로그인

**POST `/api/v1/patient-auth/login`**

```typescript
// Request
{ phone: string; password: string; deviceId: string; platform: string; }

// Response 200
{
  data: {
    accountId: string;
    patientId: string;
    patientName: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }
}

// Error 401: 인증 실패
// Error 423: 계정 잠금 (lockedUntil 포함)
```

### 3-3. PIN 로그인

**POST `/api/v1/patient-auth/login/pin`**

```typescript
// Request
{ phone: string; pin: string; deviceId: string; }
// 기기 바인딩 확인: deviceId가 등록된 기기인지 검증
```

### 3-4. 토큰 갱신

**POST `/api/v1/patient-auth/token/refresh`**

```typescript
// Request
{ refreshToken: string; }
// DB에서 해시 매칭 + 만료 확인 + 기기 바인딩 확인
```

### 3-5. 비밀번호 변경

**PUT `/api/v1/patient-auth/password/change`**

```typescript
// Request (인증 필요)
{ currentPassword: string; newPassword: string; }
// 이전 3개 비밀번호 재사용 검증
// 성공 시 → 모든 기기 refreshToken 무효화
```

### 3-6. 개인정보 API

**주소 CRUD**: `/api/v1/patient-auth/profile/address`
**가족 CRUD**: `/api/v1/patient-auth/profile/family`
**주민번호**: `PUT /api/v1/patient-auth/profile/national-id` (비밀번호 재확인)

---

## 4. Guard 호환 설계

### 4-1. PatientAccountAuthGuard

```typescript
@Injectable()
export class PatientAccountAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearerToken(req);
    
    // JWT 검증
    const payload = jwt.verify(token, secret);
    if (payload.type !== 'patient') throw new UnauthorizedException();
    
    // 계정 상태 확인
    const account = await prisma.patientAccount.findUnique({ where: { id: payload.sub } });
    if (!account || account.status !== 'ACTIVE') throw new UnauthorizedException();
    
    // 기존 포털 API와 동일한 인터페이스
    req.portalPatientId = payload.pid; // patientId
    req.patientAccountId = payload.sub; // accountId
    return true;
  }
}
```

### 4-2. 복합 Guard (OR 조건)

```typescript
@Injectable()
export class PortalOrPatientGuard implements CanActivate {
  constructor(
    private portalGuard: PortalAuthGuard,
    private patientGuard: PatientAccountAuthGuard,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // PatientAccount 인증 먼저 시도
    try { return await this.patientGuard.canActivate(ctx); } catch {}
    // 실패 시 기존 Portal 인증 시도
    try { return await this.portalGuard.canActivate(ctx); } catch {}
    throw new UnauthorizedException('인증이 필요합니다.');
  }
}
```

기존 PortalController에서 Guard 교체:
```typescript
@UseGuards(PortalOrPatientGuard) // 기존 PortalAuthGuard → 호환 Guard
@Controller('api/v1/portal')
export class PortalController { ... }
```

---

## 5. 파일 구조

```
apps/api/src/modules/
├── patient-auth/                          [신규 모듈]
│   ├── patient-auth.module.ts
│   ├── patient-auth.controller.ts         회원가입/로그인/토큰 API
│   ├── patient-auth.service.ts            인증 비즈니스 로직
│   ├── patient-profile.controller.ts      주소/가족/주민번호 API
│   ├── patient-profile.service.ts         개인정보 CRUD
│   ├── guards/
│   │   ├── patient-account-auth.guard.ts  JWT 인증 Guard
│   │   └── portal-or-patient.guard.ts     OR 호환 Guard
│   ├── services/
│   │   ├── nice-auth.service.ts           NICE 본인인증 연동
│   │   ├── sms-otp.service.ts             SMS OTP 발송/검증
│   │   └── encryption.service.ts          AES-256 암호화 (주민번호/CI)
│   └── dto/
│       ├── signup.dto.ts
│       ├── login.dto.ts
│       └── profile.dto.ts
├── portal/                                [기존 수정]
│   ├── portal.controller.ts               Guard → PortalOrPatientGuard
│   └── ...
```

---

## 6. 구현 순서 (Phase 1)

### Step 1: DB 스키마 + Prisma (Day 1)
1. Patient 모델에 `ci`, 관계 추가
2. PatientAccount, PatientConsent, PatientDevice 모델 생성
3. PatientFamily, PatientAddress 모델 생성
4. SmsVerification 모델 생성
5. `prisma db push` + generate

### Step 2: 암호화 + OTP 서비스 (Day 2)
6. EncryptionService (AES-256-GCM: 주민번호/CI 암호화/복호화)
7. SmsOtpService (발송/검증/Rate Limit)
8. NICE 본인인증 서비스 (개발용 폴백 포함)

### Step 3: 인증 API (Day 3-4)
9. PatientAuthController + Service
10. 회원가입 API (CI 매칭 + 동의 + 계정 생성)
11. 로그인 API (phone + password + 실패 잠금)
12. PIN 로그인 API
13. 토큰 갱신 API (refreshToken)
14. 로그아웃 API (기기 토큰 무효화)
15. 비밀번호 변경/재설정 API

### Step 4: Guard 호환 + 개인정보 (Day 5-6)
16. PatientAccountAuthGuard
17. PortalOrPatientGuard (OR 호환)
18. 기존 PortalController Guard 교체
19. PatientProfileController (주소/가족/주민번호 CRUD)

### Step 5: 관리자 + 테스트 (Day 7)
20. 관리자 계정 관리 API
21. 관리자 계정 관리 페이지
22. 통합 테스트 (가입 → 로그인 → 포털 API 호출)

---

## 7. 시드 데이터

### 테스트 계정

| 환자 | 폰 | 비밀번호 | PIN |
|------|-----|---------|-----|
| 김영수 (P2026-0001) | 010-1111-0001 | Test1234! | 123456 |
| 박철수 (P2026-0003) | 010-1111-0003 | Test1234! | 123456 |
| 한지영 (P2026-0006) | 010-1111-0006 | Test1234! | 123456 |
| 강미래 (P2026-0008) | 010-1111-0008 | Test1234! | 123456 |

---

## 8. Warning 항목 대응 (검토 반영)

| Warning | 대응 |
|---------|------|
| NICE 장애 시 폴백 | 개발 환경: SMS OTP + 수동 입력. 프로덕션: "인증 서비스 점검 중" 안내 |
| CI값 암호화 | EncryptionService로 AES-256-GCM 암호화 저장 (평문 X) |
| 보호자 유효기간 갱신 | Phase 2에서 구현 (만료 30일 전 재승인 알림) |
