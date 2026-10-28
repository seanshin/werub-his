# 신규입사 온보딩 + 직원 행정 셀프서비스(ESS) 설계서 v1.6

> **요약**: 관리자/행정과 사이드바 **`신규 입사자 관리`** 메뉴를 유일한 시작점으로, 입사예정자에게 **이메일·QR 이미지·1회용 링크**로 온보딩 초대를 발급 → 서류·전자계약 → **계정 부팅(생체 전환)** → 비밀번호 없는 **ESS 행정 포털** 이용까지의 상세 설계. 기존 직원 SSO(패스키)·QR 페어링(SSE)·W3 ERP 연동 자산을 재사용한다.
>
> **프로젝트**: Hospital RUN (한국형 대학병원급 HIS, v3.10.0)
> **작성일**: 2026-06-10 / **개정**: v1.6 (**기존 인사자료 audit §0-Y** — `Staff`/`StaffCredential`/`hr` 모듈 재사용, `OnboardingProfile`·`accountStage` 정정)
> **상태**: Draft (P1 선행 §0-Y.4·§5.6 해소 후 착수)
> **Plan 문서**: [staff-onboarding-ess.plan.md](../../01-plan/features/staff-onboarding-ess.plan.md) (v1.4, FR-A0~G5)

---

## 0-Y. 기존 인사자료 실측 Audit (구현 전 필수 — v1.6)

> "현재 등록된 인사자료 검토·점검 우선" 요청에 따라 실측. **결론: HIS는 이미 인사 데이터 아키텍처(`Staff`+`StaffCredential`+`StaffEducation`+`StaffSchedule`+`hr` 모듈)를 보유**하고 있어, 온보딩/ESS는 **이를 신설이 아니라 확장**해야 한다. 설계의 `OnboardingProfile`·`User.accountStage`는 기존 자산과 중복/충돌.

### 0-Y.1 이미 존재하는 인사 자산 (실측)
| 자산 | 내용 | 온보딩/ESS 영향 |
|------|------|----------------|
| **`Staff` 모델**(`staff`) | `userId?`(User 연결)·`employeeNumber`·`erpEmployeeCode`·`clinicUserId`·familyName/givenName·`category(StaffCategory)`·department·position·licenseNumber·specialty·**`hireDate`·`status(EmploymentStatus)`**·phone·email·executiveRole | **인사 SoT 엔티티**. 온보딩은 이 레코드를 생성/채워야 함 |
| **`StaffCredential`**(`staff_credentials`) | userId·type(LICENSE/CERT/BLS…)·name·number·issuer·issuedAt·expiresAt·status·**verifiedBy/At**·fileUrl | **면허/자격 입력·검증 target**(OnboardingProfile.licenses JSON 대체) |
| **`StaffEducation`**(`staff_educations`) | userId·courseName·category(MANDATORY…)·completedAt·expiresAt·dueDate·status | **ESS 의무교육 이수현황** 원천 |
| **`StaffSchedule`**(`staff_schedules`) | **`staffId`**·date·shiftType·start/end | **ESS 근무표**(staffId 키 — userId 아님) |
| **`DoctorProfile`** | education/career/certifications(JSON)·photo·languages·intro | 의사 온보딩 시 공개 프로필 |
| **`hr` 모듈**(실재) | `GET/POST /hr/staff`·`/hr/staff/:id`(PUT/PATCH)·`/staff/:id/resign`·**`GET /hr/me`**·`/hr/departments`·`POST/GET /hr/schedule` + ERP(`/integration/hr/*`·`/map`) | **Staff CRUD·ESS(/hr/me)·스케줄·ERP가 이미 구현** → 확장 대상 |
| `staff-qualification` 모듈 | 자격·교육 관리 | 재사용 |

### 0-Y.2 enum 실측
- `EmploymentStatus = ACTIVE·ON_LEAVE·RESIGNED·RETIRED` (PRE_BOARD/ONBOARDING **없음** → 값 추가 필요)
- `StaffCategory = MEDICAL·TECHNICAL·ADMIN·SUPPORT` (jobCategory 매핑 대상)
- `UserRole = ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH·CRM_MANAGER·CRM_STAFF·READ`

### 0-Y.3 등록 현황(시드) — 데이터 단절
- **`User`(임상 로그인 계정) ≈105건 시드**, **`Staff`(인사 레코드) ≈6건** → **기존 직원 대부분이 Staff HR 레코드 없음**(User만 존재).
- 영향: ESS는 `Staff` 기반인데 **기존 직원은 Staff가 없어 ESS 사용 불가** → **기존 User→Staff 백필(매핑) 작업이 선행**돼야 함.

### 0-Y.4 설계 정정 (이 audit 반영)
| 기존 설계 | 정정 |
|-----------|------|
| `User.accountStage` 신규 필드 | **철회** → **`Staff.status`에 `ONBOARDING` 값 추가**(기존 EmploymentStatus enum). 격리는 Staff.status + 온보딩 스코프 JWT |
| `OnboardingProfile`에 성명·부서·직급·면허·연락처 | **`Staff`로 이관**(중복 제거). OnboardingProfile은 **민감 intake 전용**(rrnEnc·bankAccountEnc·주소·비상연락처·병역·부양·동의)만 |
| 면허 `licenses` JSON | **`StaffCredential` 행 생성**(검증 워크플로 재사용) |
| 교육 이수 | **`StaffEducation`** 재사용 |
| ESS 근무표(userId) | **`StaffSchedule.staffId`** |
| 신규 `ess`/`onboarding` 모듈 | **`hr` 모듈 확장**(`/hr/me`·staff CRUD·schedule·ERP 이미 존재) |
| 활성화 = User 생성 | **Staff(status ONBOARDING→ACTIVE) + 연결 User** 둘 다 |

> **P1 추가 선행**: ① `EmploymentStatus`에 `ONBOARDING` 추가 ② 기존 User↔Staff 백필 전략 ③ `hr` 모듈 확장 설계(신규 모듈 최소화).

---

## 0-Z. v1.5 정정 요약 — 재검증 코드 실측 (블로킹 3건 + 정합)

> design-validator 재검증 + 코드 실측으로 **증분 누적 토대 오류 3건**을 정정. P1 코딩 전 §5.6 선행.

| ID | 검증 지적 | 실측 | 정정 |
|----|-----------|------|------|
| 🔴 C-c | `User.status PRE_BOARD` 전제 | **`User.status` 필드 없음**(`isActive` Boolean만) + `passkey.service.ts:255`가 `!isActive` 시 로그인 차단 | **`User.accountStage`(VarChar, PRE_BOARD\|ACTIVE) 신규 필드** + 인증 스코프 분리(§5.6). isActive=false로는 생체로그인 불가 |
| 🔴 C-b | "프로젝트 Prisma enum 미사용" | **enum 42개 실재**, `User.role = UserRole` enum | "enum/String **혼용**. 신규 모델 상태값만 IntegrationOutbox식 String VarChar" 로 정정. `User.role` enum 제약을 권한매핑에 반영(§4.3) |
| 🔴 §3 | claim→패스키 register JWT 호환 | register는 `JwtAuthGuard`+`CurrentUser('id')` | **온보딩 스코프 JWT** 정의 + 가드 통과/staff 차단 규칙(§5.6) |
| 🟡 C-a | "신규 9종" | 실제 정의 **10종**(OnboardingSend 포함) | 전 표기 **10종** 통일 |
| 🟡 §4-W | "cms-config 서비스 재사용" | cms-config는 `CmsCategory/CmsMenu`만. SystemConfig는 `config-runtime`/`hospital-info`가 사용 | **`config-runtime`(SystemConfig key-value) 사용**, 병원소개 부분은 **`HospitalInfoContent`(실재) 재사용** 검토 |
| 🟡 W-a | `reissue-temp-credential` 잔재 | SMS/임시비번 제거 방침과 충돌 | 삭제 → `passkey-reset` 단일 |
| 🟡 — | EncryptionService 주입 | `patient-auth.module`에서만 export | onboarding 모듈이 **patient-auth import 또는 shared 추출** 필요(명시) |
| 🟡 — | 주민번호 ERP 전송 채널 미확정 | — | `staff.created` outbox에서 **주민번호 제외**(별도 보안 동기화), §9.2 |

---

---

## 0-A. v1.2 변경 요약 — 흐름 완주 실측 검토 (관리자 발송 → 입사자 로그인등록·서류등록)

> **검토 질문**: "관리자가 실제 이메일을 발송하고, 입사자가 흐름을 따라 **로그인 정보 등록 + 입사 서류 등록**까지 완주할 수 있는가?" → 의존 인프라를 코드로 실측한 결과 **SMS 경로는 미작동(시뮬레이션)**, **생체(패스키) 경로는 실작동**. 이에 따라 SMS를 제거하고 **생체등록을 인증 코어로** 재설계.

| 코어 의존 | 실측 결과 | v1.2 조치 |
|-----------|-----------|-----------|
| **SMS OTP/임시비번** | `patient-auth/services/sms-otp.service.ts:43-46` — `// TODO: 알리고 API 연동` + 로그만, **실발송 없음**(DEV 로그) | **전면 제거** — 본인확인·로그인등록에서 SMS 의존 삭제 |
| **스마트폰 생체(패스키)** | `auth/passkey`(`register/options`·`register/verify`·`login/options`·`login/verify`) + `WebAuthnCredential` 모델 **실재·작동** | **인증 코어로 채택** — 입사자가 폰에서 등록한 패스키가 **그대로 입사 후 직원 로그인 자격** |
| **이메일 발송** | `crm/crm-channel.service.ts` nodemailer 존재하나 **SMTP 미설정 시 시뮬레이션**(로그만, line 87-96) | 발송 전제로 **SMTP 설정 필수**(§13-1) + 미설정 시 **QR/링크 대면전달 폴백** |
| **QR 이미지 생성** | 기존은 외부 `api.qrserver.com`(inventory·staff-devices) — **토큰이 외부 서비스로 전송됨** | 온보딩 QR은 **서버 로컬 생성**(`qrcode` npm 도입, 외부 API 금지) — 토큰 외부유출 차단 |
| **파일 업로드** | `media`·`upload` 컨트롤러 모두 `@UseGuards(JwtAuthGuard, RolesGuard)` — **계정 없는 입사자 업로드 불가** | **온보딩 세션 전용 업로드 엔드포인트** 신설(§6.2) |
| **임시 User 생성** | 패스키 register는 `JwtAuthGuard`+`CurrentUser('id')` 필요 → **userId 있어야 등록 가능** | **임시 User(PRE_BOARD)** 를 초대수락 시 생성 → 패스키 등록 가능, 승인 시 활성화(§5.5) |

### 핵심 재설계 — "생체 우선, SMS·임시비번 제로"
```
관리자 이메일/QR 발송 → 입사자 폰에서 링크 진입 → (생년월일 확인) → 임시계정(PRE_BOARD) 발급
   → 스마트폰 생체등록(패스키, 실작동) ← '로그인 정보 등록' 완료 지점
   → 이후 온보딩 전 단계 생체로 재인증(SMS 없음)
   → 서류 업로드(온보딩 세션) + 전자계약 서명
   → HR 서류·신분증 검토 후 4-eyes 승인 → 임시계정 '활성화'(사번·ESS권한·W3)
   → 입사 첫날부터 같은 생체로 패스워드리스 로그인 (임시비번 없음)
```
> **신분 보증**: SMS 대신 ① 이메일/링크(소유) ② 생년월일(지식) ③ 생체-기기 바인딩 ④ **HR의 신분증 서류 대조(권위 게이트, 승인 단계)** 의 4중. 사칭은 ④에서 차단.

---

## 0. v1.1 변경 요약 (검증 반영)

| ID | 검증 지적 | 반영 |
|----|-----------|------|
| C-1 | enum 미정의 | 신규 모델 상태값을 `String @db.VarChar + 주석`+**허용값표**(§4.2)로 정의. ※v1.5 정정: 프로젝트는 enum도 사용(§0-Z C-b) — "미사용" 표현 철회, 신규 모델만 String 선택 |
| C-2 | Prisma 컨벤션 불일치 | §4를 `uuid()@db.Uuid` · `@map(snake_case)` · `@@map` · `@db.Timestamptz()` · `@relation`으로 재작성 |
| C-3 | `QrSession` 재사용 전제 붕괴(미존재) | **범용 `QrSession` 신규 모델**로 명시(§4.1), "신설 회피" 서술 철회. consent 페어링 코어 추출 |
| C-4 | webauthn 시그니처/서버검증 부재 | 현 `webauthn.ts`는 클라 전용 → **부팅 패스키 등록은 staff-sso 패스키 백엔드 의존**(§7.2 토큰교환 시퀀스) |
| C-5 | 휴가 승인 vs `EApprovalRelay` SoT 충돌 | §9.3에서 **EApprovalRelay(HR_LEAVE) 경유로 SoT 확정**, `LeaveRequest.refId` 연계 |
| W-1/W-2 | outbox `ref` 비유니크 / `attendance_recorded` 미정의 | §9.1 멱등키 규칙 + 송신측 dedup + payload 스키마 + degraded 폴백 |
| W-4 | `erpEmployeeCode` 저장 위치 | **User에 이미 존재**(`erp_employee_code`·`clinic_user_id`) → 신규필드 불필요(§4.3) |
| W-5 | 필드 드리프트 | `signatureImageKey` 통일, `remaining` 계산값, `lat/lng` 분리(§4.1) |
| W-6 | 응답/에러코드 표준 | §6.5 응답·에러코드표 신설 |
| I-1/I-2 | NFR·테스트 부재 | §11 NFR, §12 테스트 계획 신설 |
| I-3 | 4-eyes 자산 | `AdminApproval` 재사용(§2.2, §7.1 부팅 승인) |

---

## 1. 개요

### 1.1 설계 목표
- **단일 시작점**: 온보딩의 모든 진입을 관리자 사이드바 `신규 입사자 관리`로 일원화.
- **3채널 초대 발급**: 이메일(링크+QR 첨부) / QR 이미지 다운로드·인쇄 / 링크 복사 — 동일 토큰의 표현만 다름.
- **계정 전 단계 인증**: 재직자 JwtAuthGuard와 분리된 `OnboardingTokenGuard`(토큰 기반).
- **재사용 우선**: 기존 토큰체계·서명엔진·4-eyes·ERP outbox를 재사용하되, **범용 QR 세션은 신규 추출**(consent 강결합 해소).
- **행정 전용 ESS**: 임상 기능 미노출, 본인(self) 스코프 고정.

### 1.2 설계 원칙
- **비파괴(Non-destructive)**: 기존 사이드바 진료 메뉴/라우트 변경 금지 — `관리자` 그룹에 1줄 추가, ESS는 프로필 드롭다운 진입.
- **컨벤션 정합**: 신규 모델은 `uuid·snake_case map·Timestamptz`. 상태값은 프로젝트가 **enum/String 혼용**(enum 42개 실재)이나, 신규 모델은 `IntegrationOutbox`처럼 **String VarChar+주석**으로 통일(마이그레이션 단순). 단 기존 `User.role`은 `UserRole` **enum**이므로 권한매핑은 enum 제약 준수.
- **보안 기본값**: 초대 토큰 1회용·해시저장·단기만료·연락처 바인딩, 서류 암호화, 생체 원본 비전송(공개키만).
- **라우트 가드 분리**: `/onboarding/*`=토큰 가드, `/ess/*`=JwtAuthGuard+self. 중복 라우트 금지.
- **멱등·감사·보상**: 발급/발송/스캔/부팅/출퇴근 전 이벤트 AuditLog + `ref` 멱등 + 부팅 사가 보상.

---

## 2. 아키텍처

### 2.1 컴포넌트 다이어그램
```
┌─────────────────────── apps/web (Next.js) ───────────────────────┐
│  관리자 사이드바 ▶ [신규 입사자 관리] /admin/onboarding  ← 시작점     │
│       │  초대발급(이메일/QR이미지/링크) · 목록(SSE) · 서류검토 · 승인 │
│  입사예정자(계정無) ▶ /onboarding/[token]  (서류·계약·본인확인)       │
│  신규직원 ▶ /onboarding/boot  (활성화 안내 — 생체 이미 등록)         │
│  재직자 ▶ /ess, /ess/attendance|leave|certificates|profile        │
│  공용단말 ▶ /kiosk/clock (출퇴근 QR)                               │
└──────────┬───────────────────────────────────┬───────────────────┘
           │ REST /api/v1                       │ SSE /qr·/onboarding stream
┌──────────▼───────────────────────────────────▼───────────────────┐
│                        apps/api (NestJS)                          │
│  onboarding/   invite · document · contract · boot · token-guard  │
│  ess/          attendance · leave · certificate · profile         │
│  qr/           session · scan · sse   (범용 — 페어링 코어 신규추출)  │
│  ── 재사용 ── auth+passkey(staff-sso) · sign(서명) · AdminApproval  │
│              EApprovalRelay(HR_LEAVE) · media(암호화) · outbox(W3)  │
│              sqe(자격·교육) · audit                                 │
└──────────┬───────────────────────────────────┬───────────────────┘
           │ Prisma                             │ outbox(webhook)
   ┌───────▼────────┐                   ┌───────▼────────┐
   │  PostgreSQL     │                   │   ERP (인사/급여) │
   │  (신규 10모델)   │                   │  staff.* · 근태   │
   └────────────────┘                   └────────────────┘
```

### 2.2 모듈 경계 (신규 3 + 재사용)
| 모듈 | 책임 | 재사용 자산 |
|------|------|------------|
| `onboarding`(신규) | 초대 발급·전달채널·토큰가드·서류·계약·환영·**활성화 오케스트레이션** | `hr.service`·`staff-qualification`·`sign`·`media`·`auth+passkey`·`AdminApproval`·`outbox` |
| `hr`(확장) | Staff CRUD·`/hr/me`·schedule·departments·ERP outbox — **이미 구현** | 그대로 + `ONBOARDING` 상태·활성화 연계 |
| `attendance`(신규) | 출퇴근(타임클럭)·휴가·증명서 — **hr에 없는 신규 도메인** | `EApprovalRelay`(휴가)·`media`·`hr`(staffId) |
| `qr`(신규) | 범용 용도별 QR 세션·스캔·SSE 페어링 | consent 페어링 코어 추출 |

### 2.3 기존 자산 재사용 경계 — FR별 처분 (실측 `hr`·`staff-qualification` 분석)
> **`hr.service`는 이미 ERP outbox 발행**(`create→staff.created`·`update→staff.changed`·`resign→staff.resigned`·`setSchedule→staff.schedule_changed`). **`staff-qualification`은 면허(verify)·교육 이수·대시보드 구현.** → 신규 빌드는 온보딩 고유 흐름·근태·QR로 한정.

| FR 영역 | 처분 | 근거(실재 자산) |
|---------|------|----------------|
| 직원(Staff) 등록·조회·수정·퇴직 | **재사용** | `POST/GET/PUT/PATCH /hr/staff`·`/resign` + outbox |
| ESS 내 정보(D4·D5) | **재사용** | `GET /hr/me`(findByUserId) |
| 근무표 조회(D1 일부) | **재사용** | `GET /hr/schedule`·`POST /hr/schedule` |
| 부서 목록 | **재사용** | `GET /hr/departments`(ACTIVE만 — ONBOARDING 자동 격리) |
| 면허·자격(B0⑦·D4) | **재사용** | `staff-qualification` credentials(+verify) |
| 의무교육 이수(D4) | **재사용** | `staff-qualification` education(+dashboard) |
| ERP 인사 동기화(C5·B6) | **재사용** | `hr.service.emitStaff` outbox + `hr-erp`(`/integration/hr/*`·`/map`) |
| 급여명세·발령(D3) | **재사용** | ERP 읽기(`/integration/hr/*`) |
| **초대·claim·생체·서류·계약·환영·활성화** | **신규** | onboarding 모듈 |
| **출퇴근(타임클럭)(D1·E1)** | **신규** | `AttendanceRecord` — hr엔 스케줄만, 출퇴근 없음 |
| **휴가·근태정정(D2)** | **신규** | `LeaveRequest` + EApprovalRelay 결재 |
| **증명서 발급(D3)** | **신규** | `EmploymentCertificate` |
| **QR 5상황(E)** | **신규** | `QrSession` |
| 활성화 = Staff(ONBOARDING→ACTIVE)+User 생성·연결 | **신규(오케스트레이션)** | `hr.service.create` 호출 + User 생성 + 패스키 연결 |

---

## 3. 시작점 — `신규 입사자 관리` (사이드바 등록)

### 3.1 사이드바 추가 (비파괴)
`apps/web/src/components/layout/Sidebar.tsx` 의 `{ title: '관리자', items:[…] }` 그룹, `직원 관리`(`/admin/staff-management`) 다음 줄에 1줄 추가:
```ts
{ href: '/admin/onboarding', label: '신규 입사자 관리', icon: HrIcon, roles: ADMIN_ONLY },
```
- `roles`: `ADMIN_ONLY`(기본). 행정과 분리 운영 시 `HR_MANAGER` 권한 추가 후 `['ADMIN','HR_MANAGER']`. (역할 신설 여부는 §13-1 미해소)
- 아이콘: 기존 `HrIcon` 재사용. 기타 진료/워크스테이션 메뉴 **무수정**.

### 3.2 화면 구성 (`/admin/onboarding`)
```
┌ 신규 입사자 관리 ──────────────────────────────── [+ 입사예정자 등록] ┐
│ [필터: 상태 ▾ / 직종 ▾ / 검색]                                      │
│ ┌ 목록(SSE 실시간 상태) ─────────────────────────────────────────┐ │
│ │ 이름   직종   부서   입사예정  상태칩          초대   액션         │ │
│ │ 김OO  간호사 3East  06-15   ●서류검토중   [재발송][QR][링크] [열기]│ │
│ │ 이OO  전문의 내과    06-20   ●계약서명대기  …                      │ │
│ └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```
**[+ 입사예정자 등록] 모달** → **성·이름(분리)**·생년월일·연락처(휴대폰/이메일)·직종·부서·입사예정일·계약유형 → 저장 시 초대 자동 생성(성/이름·생년월일은 임시계정 생성·본인확인에 필요, §5.7).

**[초대 발급] 결과 패널** (등록 직후, 3채널 — 모두 **동일 단일 토큰**):
| 채널 | 동작 |
|------|------|
| 📧 이메일 발송 | 초대 메일 자동 전송(링크 + **QR 이미지 인라인/첨부**), `OnboardingSend(EMAIL)` |
| 🔳 QR 이미지 | QR PNG **다운로드/인쇄**(대면 전달·게시), `onboarding-{name}-{shortId}.png`, `OnboardingSend(QR_IMAGE)` |
| 🔗 링크 복사 | 1회용 URL 클립보드, `OnboardingSend(LINK)` |
> 재발급 시 이전 토큰 즉시 폐기(§5 상태기계).

### 3.3 상세 드로어 (행 [열기])
체크리스트(환영열람·인적사항·서류·계약·승인) 진행, 서류 미리보기·검토(승인/반려+사유), 계약 상태, **[계정 부팅 승인]**(`AdminApproval` 4-eyes), 발송/감사 이력.

> `/admin/onboarding` 상단 탭: **[입사자] / [환영·회사소개 편집]** — 후자에서 환영 콘텐츠(섹션·다국어·미디어)를 편집(§4-W.2).

---

## 4. 데이터 설계 (Prisma — 기존 컨벤션 정합)

> 기존 스키마 컨벤션 준수: `@id @default(uuid()) @db.Uuid`, 컬럼 `@map("snake_case")`, 테이블 `@@map`, 시각 `@db.Timestamptz()`. 프로젝트는 enum/String **혼용**(enum 42개)이나, **신규 모델 상태값은 `String @db.VarChar(n)`+주석 선택**(IntegrationOutbox/AdminApproval/ConsentSignSession과 동일, 마이그레이션·확장 단순). 기존 `User.role`(UserRole enum)은 그대로 준수.

### 4.1 신규 모델 (10종)
```prisma
model OnboardingInvite {
  id            String    @id @default(uuid()) @db.Uuid
  tokenHash     String    @unique @map("token_hash") @db.VarChar(64)  // 원문 비저장
  candidateFamilyName String @map("candidate_family_name") @db.VarChar(50) // User.familyName 매핑(§5.7)
  candidateGivenName  String @map("candidate_given_name") @db.VarChar(50)
  email         String?   @db.VarChar(120)                            // 이메일 발송 채널(소유 요소). 없으면 placeholder(§5.7)
  phone         String?   @db.VarChar(20)                             // 연락처(표시용 — SMS OTP 미사용)
  birthDate     DateTime? @map("birth_date") @db.Timestamptz()        // 진입 지식 게이트(생년월일 대조)
  jobCategory   String    @map("job_category") @db.VarChar(30)
  department    String?   @db.VarChar(40)
  hireDate      DateTime  @map("hire_date") @db.Timestamptz()
  contractType  String    @map("contract_type") @db.VarChar(20)       // 허용값표 §4.2
  status        String    @default("INVITED") @db.VarChar(20)         // 상태기계 §5
  provisionalUserId String? @map("provisional_user_id") @db.Uuid      // PRE_BOARD 임시계정(패스키 등록 대상)
  expiresAt     DateTime  @map("expires_at") @db.Timestamptz()
  verifiedAt    DateTime? @map("verified_at") @db.Timestamptz()       // = 생체등록 완료 시점
  welcomeViewedAt DateTime? @map("welcome_viewed_at") @db.Timestamptz() // 환영/회사소개 열람·필수숙지 확인
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz()
  createdById   String    @map("created_by_id") @db.Uuid
  bootedUserId  String?   @map("booted_user_id") @db.Uuid             // 활성화된 User(=provisionalUserId 승격)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  sends         OnboardingSend[]
  documents     OnboardingDocument[]
  profile       OnboardingProfile?
  contract      OnboardingContract?
  @@index([status])
  @@index([hireDate])
  @@map("onboarding_invites")
}

model OnboardingSend {
  id        String   @id @default(uuid()) @db.Uuid
  inviteId  String   @map("invite_id") @db.Uuid
  channel   String   @db.VarChar(10)                  // EMAIL | QR_IMAGE | LINK
  sentById  String   @map("sent_by_id") @db.Uuid
  meta      Json?
  sentAt    DateTime @default(now()) @map("sent_at") @db.Timestamptz()
  invite    OnboardingInvite @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  @@index([inviteId])
  @@map("onboarding_sends")
}

model OnboardingDocument {
  id           String   @id @default(uuid()) @db.Uuid
  inviteId     String   @map("invite_id") @db.Uuid
  category     String   @db.VarChar(20)               // 허용값표 §4.2
  fileKey      String   @map("file_key") @db.VarChar(300)  // 암호화 저장 키
  sensitive    Boolean  @default(false)
  status       String   @default("PENDING") @db.VarChar(12) // PENDING|APPROVED|REJECTED
  reviewerId   String?  @map("reviewer_id") @db.Uuid
  rejectReason String?  @map("reject_reason") @db.VarChar(300)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()
  invite       OnboardingInvite @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  @@index([inviteId, status])
  @@map("onboarding_documents")
}

// ※v1.6(§0-Y.4): 성명·부서·직급·면허·연락처·hireDate는 **Staff**로, 면허는 **StaffCredential** 행으로 이관.
//   아래 OnboardingProfile은 Staff에 없는 **민감 intake 전용**으로 축소(중복 제거 권장).
model OnboardingProfile {                              // 입사 개인정보(민감 intake 전용)
  id            String    @id @default(uuid()) @db.Uuid
  inviteId      String    @unique @map("invite_id") @db.Uuid
  // 기본 인적사항
  familyName    String    @map("family_name") @db.VarChar(50)
  givenName     String    @map("given_name") @db.VarChar(50)
  nameHanja     String?   @map("name_hanja") @db.VarChar(50)
  nameEng       String?   @map("name_eng") @db.VarChar(80)
  gender        String?   @db.VarChar(10)              // M | F | OTHER
  nationality   String?   @db.VarChar(40) @default("KR")
  // ※주민번호·급여계좌는 HIS 구조화 수집 안 함 — 서류(ID_CARD/BANKBOOK)로만, ERP가 서류 보고 입력(§9.5.1 req4)
  phone         String?   @db.VarChar(20)
  email         String?   @db.VarChar(120)
  photoKey      String?   @map("photo_key") @db.VarChar(300)
  // 주소
  zipCode       String?   @map("zip_code") @db.VarChar(10)
  addr1         String?   @db.VarChar(200)
  addr2         String?   @db.VarChar(200)
  // 비상연락처
  emgName       String?   @map("emg_name") @db.VarChar(50)
  emgRelation   String?   @map("emg_relation") @db.VarChar(30)
  emgPhone      String?   @map("emg_phone") @db.VarChar(20)
  // 학력/경력/면허(의료진) — 가변 → JSON
  education     Json?                                  // [{level,school,major,gradYm}]
  career        Json?                                  // [{org,from,to,position}]
  licenses      Json?                                  // [{type,number,issuedAt,issuer}]
  military      String?   @db.VarChar(20)              // DONE|EXEMPT|NA|UNFINISHED
  dependents    Json?                                  // 4대보험·연말정산 부양가족
  sensitiveConsent Boolean @default(false) @map("sensitive_consent") // 민감/고유식별정보 수집동의
  submittedAt   DateTime? @map("submitted_at") @db.Timestamptz()
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  invite        OnboardingInvite @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  @@map("onboarding_profiles")
}

model OnboardingContract {
  id                String    @id @default(uuid()) @db.Uuid
  inviteId          String    @unique @map("invite_id") @db.Uuid
  templateId        String    @map("template_id") @db.Uuid            // → ConsentTemplate(실재) 재사용
  pdfKey            String?   @map("pdf_key") @db.VarChar(300)
  signedAt          DateTime? @map("signed_at") @db.Timestamptz()
  signerHash        String?   @map("signer_hash") @db.VarChar(128)
  signatureImageKey String?   @map("signature_image_key") @db.VarChar(300)
  blockchainTxId    String?   @map("blockchain_tx_id") @db.VarChar(120)
  invite            OnboardingInvite @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  @@map("onboarding_contracts")
}

model QrSession {                                      // 범용 — 신규(페어링 코어 추출)
  id          String    @id @default(uuid()) @db.Uuid
  purpose     String    @db.VarChar(16)               // LOGIN|CLOCK|ONBOARDING|ATTEND|RECEIPT
  token       String    @unique @db.VarChar(64)       // 단기 회전 토큰
  refType     String?   @map("ref_type") @db.VarChar(30) // attend:eventId / receipt:docId 등
  refId       String?   @map("ref_id") @db.VarChar(64)
  status      String    @default("OPEN") @db.VarChar(12)  // OPEN|SCANNED|CONSUMED|EXPIRED|CANCELLED
  createdById String?   @map("created_by_id") @db.Uuid
  consumedById String?  @map("consumed_by_id") @db.Uuid    // 스캔/소비한 user
  deviceId    String?   @map("device_id") @db.Uuid
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz()
  consumedAt  DateTime? @map("consumed_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  @@index([token])
  @@index([purpose, status])
  @@map("qr_sessions")
}

model AttendanceRecord {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  type         String    @db.VarChar(10)              // CLOCK_IN | CLOCK_OUT
  method       String    @db.VarChar(10)              // QR | BIO | MANUAL
  deviceId     String?   @map("device_id") @db.Uuid
  lat          Float?
  lng          Float?
  correctionOf String?   @map("correction_of") @db.Uuid  // 정정 대상
  at           DateTime  @default(now()) @db.Timestamptz()
  @@index([userId, at])
  @@map("attendance_records")
}

model LeaveRequest {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  type         String    @db.VarChar(12)              // ANNUAL|SICK|HALF|OUTING|CORRECTION
  fromDate     DateTime  @map("from_date") @db.Timestamptz()
  toDate       DateTime  @map("to_date") @db.Timestamptz()
  days         Float
  reason       String?   @db.VarChar(300)
  status       String    @default("REQUESTED") @db.VarChar(12) // REQUESTED|APPROVED|REJECTED|WITHDRAWN
  approverId   String?   @map("approver_id") @db.Uuid
  eApprovalRef String?   @map("eapproval_ref") @db.VarChar(80)  // EApprovalRelay.refId 연계(§9.3)
  decidedAt    DateTime? @map("decided_at") @db.Timestamptz()
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  @@index([userId])
  @@index([status])
  @@map("leave_requests")
}

model LeaveBalance {                                   // remaining = granted - used (계산값, 비저장)
  id      String @id @default(uuid()) @db.Uuid
  userId  String @map("user_id") @db.Uuid
  year    Int
  type    String @db.VarChar(12)
  granted Float
  used    Float  @default(0)
  @@unique([userId, year, type])
  @@map("leave_balances")
}

model EmploymentCertificate {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  kind       String   @db.VarChar(12)                 // EMPLOYMENT | CAREER
  pdfKey     String   @map("pdf_key") @db.VarChar(300)
  verifyCode String   @unique @map("verify_code") @db.VarChar(40)  // QR 진위확인
  revoked    Boolean  @default(false)
  issuedAt   DateTime @default(now()) @map("issued_at") @db.Timestamptz()
  @@index([userId])
  @@map("employment_certificates")
}
```

### 4.2 상태값 허용값표 (Prisma enum 대체)
| 필드 | 허용값 |
|------|--------|
| `OnboardingInvite.status` | `INVITED · VERIFIED(=생체등록 완료) · DOC_SUBMITTED · CONTRACT_SIGNED · APPROVED · BOOTED(=계정 활성화) · EXPIRED · REVOKED` |
| **`User.accountStage`(신규 필드)** | `PRE_BOARD`(온보딩 임시계정 — 온보딩 스코프만, staff 접근 차단) → `ACTIVE`(활성화). **`isActive`는 true 유지**(생체 로그인 가능해야 함, §5.6) — 격리는 accountStage+토큰 스코프로 |
| `OnboardingInvite.contractType` | `FULL_TIME · CONTRACT · COMMISSIONED(위촉) · PART_TIME` |
| `OnboardingSend.channel` | `EMAIL · QR_IMAGE · LINK` |
| `OnboardingDocument.category` | `ID_CARD · BANKBOOK · LICENSE · CAREER · PLEDGE · HEALTH · PHOTO · ETC` |
| `OnboardingProfile.gender / military` | `M·F·OTHER` / `DONE·EXEMPT·NA·UNFINISHED` |
| `OnboardingDocument.status` | `PENDING · APPROVED · REJECTED` |
| `QrSession.purpose` | `LOGIN · CLOCK · ONBOARDING · ATTEND · RECEIPT` |
| `AttendanceRecord.type/method` | `CLOCK_IN·CLOCK_OUT` / `QR·BIO·MANUAL` |
| `LeaveRequest.type/status` | `ANNUAL·SICK·HALF·OUTING·CORRECTION` / `REQUESTED·APPROVED·REJECTED·WITHDRAWN` |

### 4.3 기존 모델 재사용 + 필수 신규 필드
- `User.employeeNumber`(`@unique`, 사번 채번), **`User.erpEmployeeCode`·`User.clinicUserId` 이미 존재** → ERP 매핑 키 신규 저장 불필요.
- **신규 필드 `User.accountStage`(VarChar) 추가 필요** — 기존엔 `isActive`·`role(UserRole enum)`만 있어 PRE_BOARD 표현 불가(C-c). `role`은 enum이므로 임시계정 기본 role은 기존 enum 값 중 최소권한(예: 직종 기본값) 사용하되 **accountStage=PRE_BOARD로 staff 접근 차단**(§5.6).
- **`WebAuthnCredential`(userId 키) 재사용** → 임시계정에 등록한 패스키를 활성화 후 그대로 사용(userId 동일, 마이그레이션 불필요).
- **주소검색**은 접수 다음(Daum) 우편번호 컴포넌트 재사용. ~~EncryptionService(rrn/계좌 암호화)~~ → **불필요**(주민번호·계좌 구조화 미수집, ERP가 서류 보고 입력 §9.5.1 req4). HIS 민감 PII 수집 부담 감소.

### 4.4 데이터 출처·재사용 맵 (흐름이 요구하는 데이터 — 실측)
| 흐름/기능 | 필요 데이터 | 출처 | 신규? |
|-----------|------------|------|------|
| 직종별 **필수 서류·인적사항 항목** | jobCategory→required/optional 정의 | **`SystemConfig` key `onboarding.requirements`**(config-runtime) 또는 코드 상수 | 콘텐츠(모델0) |
| **근로/위촉 계약 템플릿** | 템플릿 본문·변수 | **`ConsentTemplate`(실재) 재사용** — `OnboardingContract.templateId`→ConsentTemplate.id | 재사용 |
| ESS **내 근무표·교대** | 근무 스케줄 | **`StaffSchedule`(키=`staffId`) + 기존 `GET /hr/schedule`** | 재사용 |
| ESS **내 정보(ESS 홈)** | 본인 인사 | **기존 `GET /hr/me`(실재)** 확장 | 재사용 |
| ESS **급여명세·발령** | 급여·인사 | **ERP 읽기**(`/integration/hr/staff/*`) | 외부 |
| ESS **인사 기본정보 조회** | 확정 인사정보 | **`Staff`(SoT 내부) + ERP 읽기** | 기존+외부 |
| ESS **자격 조회/온보딩 면허 입력** | 면허·자격 | **`staff-qualification` credentials**(`StaffCredential`, **키=userId**, verify 포함) | 재사용 |
| ESS **교육 이수현황** | 의무교육 | **`staff-qualification` education**(`StaffEducation`, 키=userId) | 재사용 |
| ⚠ 키 주의 | — | **`StaffSchedule`=staffId, `StaffCredential`/`StaffEducation`=userId**(혼재) → 활성화 시 Staff.userId 연결 보장 필수 | — |
| 의사 공개 프로필 | 학력·경력 | **`DoctorProfile`(JSON) 재사용** | 재사용 |
| **ESS_* 권한** | 권한셋 | **RBAC는 `UserRole` enum+코드 상수**(Permission **DB 모델 없음**) → ESS 접근은 role/가드+accountStage. "권한 추가"=코드 변경(마이그레이션 아님) | 코드 |
| **근태 정정** | 정정된 출퇴근 | `LeaveRequest(type=CORRECTION)` 승인 → **`AttendanceRecord`(method=MANUAL, correctionOf=원본)** 생성 | 신규(연계) |
| **공용단말 로그인** | 세션 전달 | `QrSession(LOGIN)` consume 시 PC가 **SSE로 발급 토큰 수신**(폰=인증된 staff) | 신규 |
| 알림(휴가 결재·발송) | 알림 | 휴가=ERP 전자결재(`EApprovalRelay`) 콜백 / 발송=`OnboardingSend`+기존 notification | 재사용 |
- 활성화 시 `OnboardingProfile` 핵심 필드(성명·생년월일·연락처)는 **User로 매핑**, 전체는 **W3 `staff.created` payload로 ERP 전송**(확정 인사정보 SoT=ERP). 주민번호·계좌는 ERP 전송정책에 따라 마스킹/별도 보안채널(§8).
- `AdminApproval`(action=`ACCOUNT_BOOT` 신설값) → 부팅(활성화) 4-eyes.
- `EApprovalRelay`(docType=`HR_LEAVE`, refModule=`hr.leave_requests`) → 휴가 결재(§9.3).

---

## 4-W. 입사자 환영·회사소개/문화 콘텐츠 (신규 모델 없이 `SystemConfig` 재사용)

> 실측 정정: `cms-config` 서비스는 `CmsCategory/CmsMenu`만 다룸(SystemConfig 미사용). **SystemConfig key-value는 `config-runtime.service`(`get/upsert(key)`)·`hospital-info.service`가 운영**하며, 병원 소개용 **`HospitalInfoContent` 모델이 별도 실재**. → 환영 콘텐츠는 ① 범용 텍스트/섹션은 `config-runtime`의 `SystemConfig` key, ② 병원 소개·연혁 등은 **`HospitalInfoContent` 재사용** 중 택일. 어느 쪽이든 **신규 모델 0**, 단 **cms-config 서비스가 아닌 신규 서비스 메서드** 필요.

### 4-W.1 저장
- `config-runtime` 통해 `SystemConfig.key = "onboarding.welcome"`, `value`(JSON): 섹션 배열 + 다국어(ko/en). (병원소개 섹션은 `HospitalInfoContent` 조인 가능)
```jsonc
{
  "version": 3,
  "locales": ["ko", "en"],
  "sections": [
    { "type": "HERO",      "title": {"ko":"환영합니다","en":"Welcome"}, "videoKey": "...", "imageKey": "..." },
    { "type": "GREETING",  "by": "병원장", "body": {...} },           // 원장 인사말
    { "type": "ABOUT",     "body": {...} },                          // 병원 소개·연혁·규모·진료과
    { "type": "MVV",       "mission": {...}, "vision": {...}, "values": [...] }, // 미션·비전·핵심가치
    { "type": "CULTURE",   "body": {...}, "talent": {...} },         // 조직문화·인재상·근무방식
    { "type": "BENEFITS",  "items": [...] },                         // 복지·베네핏·교육지원·휴가
    { "type": "FACILITY",  "gallery": ["mediaKey", ...] },           // 시설·근무환경 투어
    { "type": "GUIDE",     "firstDay": {...}, "contacts": [...], "faq": [...] }, // 온보딩 가이드·FAQ
    { "type": "CODE_OF_CONDUCT", "required": true, "body": {...} }   // 행동강령·윤리(필수 숙지)
  ]
}
```
- 이미지/영상: 기존 `media` 모듈 업로드 키 참조.

### 4-W.2 화면
- **입사자**: `/onboarding/[token]/welcome` — 생체등록 직후 **첫 화면**(체크리스트 진입 전 환영). `required:true` 섹션(행동강령 등)은 **읽음 확인 체크** → `OnboardingInvite.welcomeViewedAt` 기록. 스킵 가능하나 활성화 전 1회 열람 권장(필수숙지 항목은 확인 강제).
- **재직자(ESS)**: `/ess`에서 "회사 소개·문화" 링크로 동일 콘텐츠 재열람(읽기 전용).
- **관리자(HR)**: `/admin/onboarding` 의 **`환영/회사소개 편집` 탭** — 섹션 추가/정렬/다국어 입력 + media 업로드 + 미리보기. 저장은 `SystemConfig` upsert(`cms-config` 서비스 패턴 재사용).

### 4-W.3 API
```
GET  /api/v1/onboarding/:token/welcome      # (토큰 가드) 입사자용 콘텐츠(locale 협상)
POST /api/v1/onboarding/:token/welcome/ack  # 열람·필수숙지 확인 → welcomeViewedAt
GET  /api/v1/ess/welcome                     # (재직자) 동일 콘텐츠
GET  /api/v1/admin/onboarding/welcome        # (HR) 편집용 원본
PUT  /api/v1/admin/onboarding/welcome        # (HR) SystemConfig 저장
```
> i18n: 외국인 의료진/위촉의 대상 ko/en(§11 NFR 일관). 텍스트는 콘텐츠 JSON 내 다국어 필드. **locale 협상 실패/누락 시 `ko` 기본 폴백**. 영상·이미지 **대체텍스트(alt) 필수**, 필수숙지 섹션은 **키보드 접근**(체크박스 focusable).

---

## 5. 온보딩 상태기계 & 예외 흐름 (W-3 보완)

### 5.1 정상 전이
`INVITED → VERIFIED → DOC_SUBMITTED → CONTRACT_SIGNED → APPROVED → BOOTED`

### 5.2 전이표 (현재 × 이벤트 × 다음 × 보상/액션)
| 현재 | 이벤트 | 다음 | 보상/부가 |
|------|--------|------|-----------|
| INVITED | 진입+생년월일 대조 성공 | INVITED(유지) | 임시계정(PRE_BOARD) 생성 + 온보딩 세션 발급 |
| INVITED | **스마트폰 생체등록 성공**(패스키) | VERIFIED | `WebAuthnCredential` 저장 = 로그인정보 등록 완료 |
| INVITED/VERIFIED | `expiresAt` 경과 | EXPIRED | 진입 시 "만료" 안내 + 관리자 **재초대** 버튼(임시계정 정리) |
| any(≠BOOTED) | 관리자 폐기 | REVOKED | 토큰 무효, 사유 감사 |
| any(≠BOOTED) | **재발급** | INVITED | **이전 tokenHash 폐기**·새 토큰·만료 갱신 |
| VERIFIED | 환영 페이지 **필수숙지(행동강령) 확인** | VERIFIED(유지) | `welcomeViewedAt` 기록. **미확인 시 DOC_SUBMITTED 진입 차단**(게이트) |
| VERIFIED | **인적사항 입력 + 전 서류 제출**(+필수숙지 완료) | DOC_SUBMITTED | `OnboardingProfile.submittedAt` + 필수 카테고리·필수필드 검증(직종별) + 민감정보 동의 + `welcomeViewedAt≠null` |
| DOC_SUBMITTED | 서류 **반려** | DOC_SUBMITTED(유지) | 해당 `OnboardingDocument=REJECTED`+사유 → **재제출 시 PENDING 복귀**, invite 상태 불변 |
| DOC_SUBMITTED | 계약 서명 | CONTRACT_SIGNED | step-up 본인확인 |
| CONTRACT_SIGNED | 부팅 승인(4-eyes) | APPROVED | `AdminApproval(ACCOUNT_BOOT)` EXECUTED |
| APPROVED | 부팅 실행 성공 | BOOTED | `bootedUserId` set, W3 송신 |
| APPROVED | **부팅 실행 실패** | APPROVED(유지) | **사가 보상**(§5.3) 후 재시도 가능 |

### 5.3 계정 활성화 사가(보상 트랜잭션, FR-C6) — 임시비번·SMS 없음
부팅 = **이미 패스키 등록된 임시계정(PRE_BOARD)을 활성화**하는 것. 새 자격 발급이 없으므로 단순·안전:
```
1) 사전조건 검증: provisionalUserId + WebAuthnCredential ≥1(생체) + 서류/계약 완료 + welcomeViewedAt
                                                              ── 미충족 시 거부(BIOMETRIC/DOCS_INCOMPLETE)
2) DB 트랜잭션:
   - Staff.status ONBOARDING→ACTIVE (또는 hr.service.create로 신규 Staff 생성 — employeeNumber 채번)
   - User: role 확정(enum) + Staff.userId 연결 + 온보딩 스코프 해제(정규 세션 가능)
   - OnboardingProfile 민감필드 → 면허는 staff-qualification.createCredential, 그 외 ERP 송신 대상
                                                              ── 실패 시 전체 롤백(원자), APPROVED 유지·재시도
3) W3 staff.created outbox — **`hr.service.create`/`emitStaff`가 이미 발행** → 신규 발행 코드 불필요(중복 주의)
```
> ★ `hr.service.create`가 이미 `staff.created` outbox를 발행하므로, 활성화가 hr.service.create를 호출하면 **ERP 송신은 자동**. 온보딩이 별도 outbox를 또 쏘지 않도록 한 경로로 일원화.
- **임시비번/SMS 단계 자체가 없음** → 발송 실패 좌초 불가. 입사자는 활성화 즉시 **기존 등록 생체**로 로그인.
- **중간 좌초(서류완료 전 이탈)**: 임시계정 PRE_BOARD 유지, 입사자는 재방문 시 **생체로 재인증**해 이어서 진행(SMS 재발급 불필요).
- 채번 충돌(동시성): `employeeNumber @unique` 위반 시 시퀀스 재시도(최대 3회).

### 5.4 디바이스 변경·생체 재등록 (임시비번 대체)
폰 분실/교체 시 `POST /onboarding/:token/passkey-reset`(승인 전) 또는 활성화 후 기존 `auth/passkey` 디바이스 관리로 재등록. **임시비번 발급 경로 없음**(SMS 의존 제거).

### 5.6 인증 스코프 · 임시계정 처리 — 코드 실측 반영 (P1 선행조건)
> **v1.6 정정(§0-Y.4)**: 고용상태는 **`Staff.status`(EmploymentStatus enum, `ONBOARDING` 값 추가)** 로 표현(`User.accountStage` 철회). User는 로그인 자격만, Staff가 인사 SoT. 아래 표의 `accountStage`는 **`Staff.status=ONBOARDING/ACTIVE`** 로 읽는다.
> 실측: 패스키 `register/options|verify`는 `JwtAuthGuard`+`CurrentUser('id')`, `login`은 `!user.isActive` 시 차단. 따라서 임시계정을 안전히 다루려면 아래가 **P1 선행**.

| 항목 | 설계 |
|------|------|
| **신규 필드** | `User.accountStage`(VarChar: `PRE_BOARD`\|`ACTIVE`, default `ACTIVE`). 온보딩 생성분만 `PRE_BOARD` |
| **isActive 정책** | PRE_BOARD도 `isActive=true`(생체 로그인 가능해야 등록·재방문 됨). 격리는 isActive가 아니라 **accountStage + 토큰 스코프**로 |
| **온보딩 스코프 JWT** | `claim`/온보딩 로그인이 발급하는 토큰에 클레임 `scope:"onboarding"`+`inviteId`. 유효기간 짧게 |
| **패스키 register 호출** | 온보딩 스코프 JWT로 기존 `register/options|verify` 호출 → `JwtAuthGuard`는 통과(유효 user). `CurrentUser('id')`=임시 userId |
| **온보딩 재인증** | 기존 staff `login`이 아니라 **온보딩 전용 생체 검증**(passkey.service 내부 `verifyLogin` 재사용)으로 온보딩 스코프 토큰 재발급 — staff 세션 발급 금지 |
| **staff 가드 차단** | `RolesGuard`/ESS 가드 등은 `accountStage=PRE_BOARD` 또는 `scope=onboarding` 토큰을 **거부**(403). 활성화(ACTIVE) 후에만 정규 staff 세션 |
| **통계/시드/카운트 격리** | **`hr.service`는 이미 `status:'ACTIVE'`로 필터**(findAll·getDepartmentList) → `Staff.status=ONBOARDING`은 **자동 격리**(추가 작업 최소). User 기반 임상 카운트만 별도 점검 |

> 이 메커니즘이 없으면 (a) PRE_BOARD를 isActive=false로 막으면 생체등록 불가, (b) isActive=true로 열면 임시계정이 staff 화면 접근 → 둘 다 불가. **accountStage+스코프 분리가 유일 해법**.

### 5.7 임시계정 생성 필수필드 (코드 실측 — `User`는 email·passwordHash·name·role 필수)
> `User`는 `email @unique`(필수)·**`passwordHash`(NOT NULL)**·`familyName`/`givenName`·`role(UserRole enum)`이 모두 필수. claim 시점엔 `candidateName`(단일)·선택적 email만 있어 **그대로 생성 불가** → 아래로 채움.

| 필드 | claim 시 처리 | 활성화 시 |
|------|--------------|-----------|
| `email` | invite.email 있으면 사용. **없으면 내부 placeholder** `onboarding+{inviteId}@{internal}` (unique 보장) | 인적사항의 실제 email로 갱신(중복 검사 — 재입사 충돌 시 반려) |
| `passwordHash` | **사용 불가능한 랜덤 해시**(패스워드리스 — 로그인은 패스키만, 이 값은 절대 미사용) | 변경 없음 |
| `familyName`/`givenName` | **초대 등록 시 성/이름 분리 입력**(권장) 또는 candidateName 분해 | 인적사항 입력값으로 확정 갱신 |
| `role` | jobCategory→`UserRole` enum 기본 매핑(최소권한) | 직종별 정식 role 확정 |
| `accountStage` | `PRE_BOARD` | `ACTIVE` |
| `employeeNumber` | **미부여**(활성화 시 채번) | 채번 |

> 권고: 초대 등록 폼(`OnboardingInvite`)에 **성/이름 분리 + email 권장 수집**을 넣어 placeholder 의존을 줄임.

---

## 6. API 설계

### 6.1 신규 입사자 관리 (관리자, JwtAuthGuard + `ADMIN`/`HR_MANAGER`)
```
POST   /api/v1/onboarding/invites                       # 등록+초대 생성 → {inviteId, token(1회노출)}
POST   /api/v1/onboarding/invites/:id/send              # body{channel} → 발송/QR PNG URL
GET    /api/v1/onboarding/invites/:id/qr.png             # QR 이미지(다운로드/인쇄)
POST   /api/v1/onboarding/invites/:id/resend|revoke
GET    /api/v1/onboarding/invites                        # 목록(상태/직종 필터·페이지네이션)
GET    /api/v1/onboarding/invites/:id                    # 상세
POST   /api/v1/onboarding/invites/:id/documents/:docId/review  # 승인/반려
POST   /api/v1/onboarding/invites/:id/approve-boot       # AdminApproval 4-eyes
GET    /api/v1/onboarding/invites/stream                 # SSE 상태 스트림
```
### 6.2 입사예정자 (OnboardingTokenGuard — 계정 전, SMS 없음)
```
GET    /api/v1/onboarding/:token                 # 진입(상태·체크리스트)
POST   /api/v1/onboarding/:token/claim           # 생년월일 대조 → 임시계정(PRE_BOARD) + 온보딩 세션(JWT, 스코프 제한)
# ↓ 이후 온보딩 세션 JWT로 기존 패스키 백엔드 재사용(생체 = 로그인정보 등록)
POST   /api/v1/auth/passkey/register/options     # (기존) 온보딩 세션으로 호출 가능
POST   /api/v1/auth/passkey/register/verify      # (기존) 생체등록 완료 → invite VERIFIED
GET    /api/v1/onboarding/:token/profile         # 인적사항 조회(저장값·복호화는 민감필드 마스킹)
PUT    /api/v1/onboarding/:token/profile         # 인적사항 입력/저장(주민번호·계좌 EncryptionService 암호화)
POST   /api/v1/onboarding/:token/documents       # 서류 업로드(multipart, 온보딩 세션 — 신규 전용 EP, 암호화)
POST   /api/v1/onboarding/:token/contract/sign   # 전자서명(생체 step-up) — 인적사항·서류 완료 후 활성화
POST   /api/v1/onboarding/:token/passkey-reset   # 폰 교체 시 재등록(임시비번 대체)
```
> 재인증: 재방문 시 기존 `POST /auth/passkey/login/options|verify`(공개)로 **생체 로그인** → 온보딩 세션 재발급. **SMS 미사용**.
> 업로드 가드: 기존 `media`/`upload`는 `JwtAuthGuard+RolesGuard`(직원 전용)라 입사자 사용 불가 → **온보딩 세션 전용 업로드 EP 신설**(파일 암호화·`sensitive`·크기/형식 제한).
### 6.3 ESS (재직, JwtAuthGuard + self)
```
GET  /ess/me · POST /ess/attendance/clock · GET /ess/attendance
POST /ess/leave · GET /ess/leave/balance · POST /ess/leave/:id/withdraw
POST /ess/leave/eapproval-callback   # (Clinic/ERP→HIS, X-Integration-Key·멱등) 결재결과 수신 — Clinic 콜백 무재시도 → GET /erp/eapproval/:id 폴링 폴백
GET  /ess/certificates · POST /ess/certificates/employment
GET  /ess/profile · POST /ess/profile/change-request · GET /ess/qualifications
```
> 휴가 **승인은 ESS가 아니라 EApprovalRelay(ERP 결재)** 경유(§9.3) — HIS에 `/approve` 직접 엔드포인트 두지 않음(부서장 승인은 ERP 결재 콜백으로 수신).

### 6.4 QR (`/qr`)
```
POST /qr/sessions {purpose, refType?, refId?}   · GET /qr/sessions/:id/stream(SSE)   · POST /qr/scan
```

### 6.5 응답·에러코드 (CLAUDE.md `{data,meta}`/`{error}` 규약)
| 상황 | HTTP | error.code |
|------|------|-----------|
| 토큰 만료 | 410 | `ONBOARDING_TOKEN_EXPIRED` |
| 토큰 폐기/재발급됨 | 409 | `ONBOARDING_TOKEN_REVOKED` |
| 생년월일 대조 실패 | 401 | `DOB_MISMATCH` |
| 생체등록 전 후속단계 시도 | 412 | `BIOMETRIC_REGISTRATION_REQUIRED` |
| 필수 서류 미충족 부팅 | 422 | `ONBOARDING_DOCS_INCOMPLETE` |
| 부팅 승인 권한·4-eyes 미충족 | 403 | `BOOT_APPROVAL_REQUIRED` |
| 사번 채번 충돌 | 409 | `EMPLOYEE_NUMBER_CONFLICT` |
| ESS 타인 데이터 접근 | 403 | `ESS_SCOPE_VIOLATION` |
| QR 만료/재사용 | 410/409 | `QR_SESSION_INVALID` |
| 검증 일반 | 400 | `VALIDATION_ERROR` |

---

## 7. 핵심 플로우

### 7.1 초대 발급 (시작점 → 3채널)
```
[관리자] /admin/onboarding ▶ [+등록] ▶ POST /invites
   → 서버: 토큰 생성(원문 1회 반환)·tokenHash 저장·expiresAt(14d)·status=INVITED·연락처 바인딩
   → 결과 패널:
       ├ [이메일 발송] POST /invites/:id/send{EMAIL} → 메일(링크+QR인라인)
       ├ [QR 다운로드] GET /invites/:id/qr.png
       └ [링크 복사]
   → 발송 AuditLog + OnboardingSend
   ※ QR PNG는 **서버 로컬 생성**(qrcode 라이브러리) — 외부 api.qrserver.com 금지(토큰 외부유출)
[부팅 승인] HR 신분증 서류 대조 → AdminApproval(action=ACCOUNT_BOOT) 2인 승인 → 임시계정 활성화(§5.3)
```
### 7.2 로그인 정보 등록 = 스마트폰 생체등록 (실작동 경로, SMS·임시비번 없음)
> 패스키 백엔드 `auth/passkey`가 **실재·작동**(`register/options`·`register/verify`는 `JwtAuthGuard`+`CurrentUser('id')`). 따라서 **임시계정(PRE_BOARD)의 userId**만 있으면 입사자가 진입 시점에 바로 생체등록 가능 → 이게 "로그인 정보 등록"의 실작동 지점이다.
```
[입사자 폰] /onboarding/[token] 진입
   1) POST /onboarding/:token/claim {birthDate} → 대조 성공 → 임시 User(PRE_BOARD) 생성(필수필드 §5.7: email placeholder·랜덤 passwordHash·성/이름·role 매핑)
        → 온보딩 세션 JWT 발급(scope:onboarding, §5.6)
   2) POST /auth/passkey/register/options  → 서버 챌린지(기존 백엔드)
   3) navigator.credentials.create(platform·UV required)  ← Face ID/지문
   4) POST /auth/passkey/register/verify {response} → WebAuthnCredential 저장
        → invite VERIFIED  ★로그인 정보 등록 완료★
   5) 이후 모든 재방문/단계: POST /auth/passkey/login/options|verify (생체) — SMS 없음

[입사 첫날 — 활성화 후] 같은 폰 생체로 /staff 로그인 → ESS 접근
   (임시비번·SMS 단계 전무. 자격 마이그레이션 불필요 — userId 동일)
```
> 현 `webauthn.ts`(클라 전용)는 보조이고, **실제 등록/검증은 서버 `auth/passkey` 백엔드**가 수행. 부팅(§5.3)은 자격 발급이 아니라 **임시계정 활성화**일 뿐.
### 7.3 QR 출퇴근 (FR-E1)
```
[벽면단말] /kiosk/clock: POST /qr/sessions{purpose:CLOCK} 회전 QR(SSE)
[직원폰] 스캔 → POST /qr/scan{token} → 생체확인(authenticateBiometric) → AttendanceRecord(method:QR)
  → (선택) 위치검증 → W3 staff.attendance_recorded(§9.1) → ERP
```

---

## 8. 보안 설계
| 항목 | 설계 |
|------|------|
| 초대 토큰 | 32B 랜덤·**해시만 저장**·1회용·14일·재발급 시 무효화 |
| **신원 보증(SMS 제거)** | 4중: ① 이메일/링크(소유) ② **생년월일 대조**(지식) ③ **생체-기기 바인딩**(패스키) ④ **HR 신분증 서류 대조**(승인 단계, 권위 게이트). 사칭은 ④에서 차단 |
| **QR 발급물 유출** | QR PNG **서버 로컬 생성**(외부 api.qrserver.com 금지 — 토큰 외부전송 차단), 1회용·만료, 진입 후 생년월일+생체로 추가 차단 |
| **개인정보(인적사항)** | 최소수집·**목적 명시 동의**. **주민번호·계좌는 HIS 구조화 미수집**(서류로만, ERP가 서류 보고 입력 §9.5.1 req4) → HIS PII 부담 감소. 민감/고유식별정보(`sensitiveConsent`) **별도 동의**(개인정보보호법 §23·§24), 미입사자 보존기간 후 파기 |
| 서류 | **온보딩 세션 전용 업로드**(직원 EP 미개방) + 암호화 저장, `sensitive` 접근통제·보존기간 후 파기 cron(FR-F6) |
| 계정 활성화 | `AdminApproval` 4-eyes, **임시비번·SMS 없음** — 기등록 생체로 즉시 로그인 |
| 패스키(생체) | 서버 `auth/passkey` 챌린지·**공개키만 저장**(원본 생체 비전송), RP ID 바인딩, 임시계정(PRE_BOARD)은 로그인·권한 없음 |
| QR | 용도별 단기 회전·1회성·재생방지·SSE 만료, 전 스캔 감사 |
| ESS | self 스코프 고정(`ESS_SCOPE_VIOLATION`), 고위험 step-up |
| 가드 | `/onboarding/*`=TokenGuard, `/ess/*`=Jwt+self — 라우트 분리 |
| 감사 | 발급·발송·서류·계약·부팅·근태·QR·증명발급 전부 AuditLog |

---

## 9. ERP / W3 연동 정합

### 9.1 출퇴근 이벤트 `staff.attendance_recorded` (W3 v1.1 제안 — W-1/W-2)
- **현황**: W3 명세 이벤트 5종에 미포함 → **v1.1 확장 제안** 필요(미합의 의존).
- **payload**: `{ employeeNumber, at(ISO), type(CLOCK_IN|OUT), method, deviceId?, ref }`
- **멱등키 `ref`**: `att:{employeeNumber}:{at(분단위)}:{type}` — 동일키 재발행 금지.
- **송신측 멱등**: `IntegrationOutbox.ref`는 현재 **비유니크** → 발행 전 dedup(같은 ref PENDING/SENT 존재 시 skip) 또는 `@@unique([domain, ref])` 추가 검토(타 도메인 영향 확인 후).
- **Degraded 폴백**: ERP 미합의/수신불가 시 **outbox 적재만(PENDING 보류)** 하고 ESS 근태 기록은 정상 — 합의 후 일괄 송신.

### 9.2 부팅·자격 (기존 이벤트 재사용) + 주민번호 전송정책
- 부팅 완료 → `staff.created`(employeeNumber·name·department·position·hireDate). ERP `/map` 회신 `erpEmployeeCode`는 **기존 `User.erpEmployeeCode`에 저장**.
- **주민등록번호·계좌번호는 `staff.created` outbox payload에서 제외**(평문/암호문 모두 미포함). ERP가 필요 시 **별도 보안 동기화 채널**(전용 암호화 엔드포인트·키교환)로 전송 — W3 명세 확장 항목으로 합의(§13-1). outbox(webhook)에는 식별·근태·자격만.
- 면허/자격 검증 → `qualification_changed`(기존).

### 9.5 ERP 협의·요청 항목 (온보딩/ESS로 신규 발생 — W3 v1.1 제안)
> 기존 합의/구현: HIS→ERP 이벤트 5종(staff.created/changed/resigned/schedule_changed/qualification_changed) + ERP→HIS 읽기 3종(`/hr/staff`·`/schedule`·`/map`). 아래는 **추가 요청**.

| # | 요청 항목 | 방향 | 상세 | 상태 |
|---|-----------|------|------|------|
| 1 | **출퇴근 이벤트 `staff.attendance_recorded`** | HIS→ERP | payload `{employeeNumber, at, type(CLOCK_IN/OUT), method, deviceId?, ref}`. ref=`att:{empNo}:{분}:{type}`(멱등). ERP 수신 어댑터 신설 | 신규 합의 |
| 2 | **근태 원천 단일화** | 정책 | HIS 타임클럭 단일 vs groupware 병행. 중복 시 `ref` 멱등 정합 | 미해결(W3 §6) |
| 3 | **휴가 결재 콜백** | ERP→HIS | HIS가 `EApprovalRelay(HR_LEAVE)`로 상신 → **ERP가 승인/반려 시 HIS로 콜백**(`{refId, status, approver, decidedAt}`) → `LeaveRequest` 갱신 | 신규 합의 |
| 4 | **급여명세 조회 API** | ERP→HIS | ESS 표시용 `GET payslip(employeeNumber, period)` 또는 ERP 급여화면 **SSO 링크**. 현재 ERP read엔 급여 미정의 | 신규 합의 |
| 5 | **연차 잔여(LeaveBalance) 동기화** | ERP→HIS | 잔여=급여/근태 SoT(ERP)면 ERP가 제공 또는 정기 동기화. HIS는 캐시 | 신규 합의 |
| 6 | **주민번호·계좌 전송 채널** | 정책 | `staff.created` outbox에서 **제외**. ERP가 급여지급에 필요 시 **별도 보안채널**(암호화·키교환) 또는 ERP 자체수집. **주민번호/계좌 SoT 확정** | 신규 합의 |
| 7 | **사번(employeeNumber) 채번 주체** | 정책 | W3 전제 = HIS 채번 + ERP는 `erpEmployeeCode` `/map` 회신. **온보딩 활성화 시 HIS 채번** 재확인 | 확인 |
| 8 | **활성화 staff.created payload** | HIS→ERP | 온보딩 수집분(category·position·department·hireDate) 포함. 추가 필드 필요 시 합의 | 확인/확장 |
| 9 | **면허 → 자격수당** | HIS→ERP | 온보딩 면허(StaffCredential) → `qualification_changed` 발행 확인 | 확인 |
| 10 | **SoT 경계(온보딩 신규)** | 정책 | 입사서류·전자계약·생체자격=**HIS 소유**(ERP 불필요), 확정 인사·발령·급여·평가=**ERP** | 확인 |

### 9.5.1 ERP 회신 반영 (W3.1 회신서, PR #129 머지)
> ERP 팀 회신 — 요청 1·2·3 **구현 완료**, 요청 4(주민번호/계좌)=**(A) ERP 자체수집** 채택, 요청 5=**HIS 콜백 스펙 회신 요청**.

| 요청 | ERP 회신 | HIS 영향/작업 |
|------|----------|----------------|
| 1 출퇴근 수신 | ✅ **구현 완료**(`staff.attendance_recorded` 수신·근태→급여) | HIS는 타임클럭에서 이벤트 발행만 하면 됨 → **ESS 출퇴근(P5) 외부 의존 해소** |
| 2(=급여명세) | ✅ **구현 완료**(조회 API/SSO) | ESS 급여명세 표시 가능 → **P4 의존 해소** |
| 3(=연차 잔여) | ✅ **구현 완료**(LeaveBalance 제공) | ESS 휴가 잔여 표시 가능 → **P4 의존 해소** |
| 4 주민번호·계좌 | **ERP가 제출 서류(신분증·통장사본)를 보고 ERP에 직접 입력** (확정) | **HIS는 주민번호·계좌를 구조화 필드로 수집하지 않음** — 서류(`ID_CARD`·`BANKBOOK`)만 수집. `OnboardingProfile.rrnEnc`/`bankAccountEnc` **미사용(제거 가능)**. 대신 **ERP에 온보딩 서류 열람 경로 제공**(아래 신규작업) |
| 4-b 서류 열람(신규) | HIS→ERP | ERP 입력 담당자가 신분증·통장사본 확인 → **HIS가 ERP에 해당 서류 보안 열람**(presigned 단기링크 또는 HR 콘솔 공유). PII 접근 감사 | 🔨 HIS 작업 |
| 5 휴가 결재 콜백 | **HIS가 콜백 스펙 회신 요청** | 🔨 **HIS 작업**: 콜백 수신 EP 스펙 확정·회신 → `POST /api/v1/ess/leave/eapproval-callback`(§6.3·§9.6.1 C-3). Clinic C-3와 동일 콜백 — **ERP·Clinic 공통 스펙으로 회신** |

> **결과**: ESS 근태·휴가(P4·P5)의 **ERP 측 외부 의존이 대부분 해소**. 남은 공통 미결 = **휴가 결재 콜백 스펙(요청5 + Clinic C-3)** → HIS가 확정·회신해야 함(아래 §9.6.2 통합 스펙).

### 9.6 Clinic 협의·요청 항목 (디렉터리/계정 + 전자결재 라우팅)
> 실측: **Clinic = 디렉터리/계정 권위**(SSO `findOrCreateUser`→`Staff.clinicUserId` 매핑) + **전자결재 라우팅**(`clinic-integration/erp-eapproval`: `submit`·`approvers?drafter_clinic_user_id&doc_type`·`:approvalId`). → **휴가 결재·신규자 계정·근태 신원은 Clinic 경유**.

| # | 요청 항목 | 방향 | 상세 | 상태 |
|---|-----------|------|------|------|
| C-1 | **신규 입사자 디렉터리 계정 생성/매핑** | HIS↔Clinic | 온보딩 활성화 시 Clinic 디렉터리 계정 프로비저닝 → `clinicUserId` 회신·`Staff.clinicUserId` 링크. (현재 SSO는 기존자 findOrCreate만 — **역방향 신규등록** 합의 필요) | 신규 합의 |
| C-2 | **휴가(HR_LEAVE) 결재선 등록** | HIS→Clinic | `erp-eapproval/approvers?drafter_clinic_user_id&doc_type=HR_LEAVE` 가 반환할 **결재선·문서양식**을 Clinic 결재시스템에 등록 | 신규 합의 |
| C-3 | **휴가 결재 상신·결과 콜백** | HIS→Clinic→HIS | HIS `LeaveRequest`→`EApprovalRelay`→`erp-eapproval/submit`(drafter=clinicUserId) → **결재 완료 시 HIS 콜백**으로 `LeaveRequest.status` 갱신 | 신규 합의 |
| C-4 | **출퇴근/근태 신원·원천 정합** | 정책 | 근태 집계 키 = `clinicUserId` 기준 여부, **Clinic groupware 근태 보유 시 원천 단일화**(HIS 타임클럭 vs groupware), 중복 `ref` 정합 | 미해결 |
| C-5 | **디렉터리 동기화(퇴직·부서변경)** | HIS↔Clinic | 활성화/변경/퇴직을 Clinic 디렉터리에 반영(SSO·결재 신원 일관성) | 확인 |

> **3자 경계 요약**: 온보딩·서류·계약·근태원천·생체자격=**HIS** / 디렉터리·계정·전자결재 라우팅=**Clinic** / 인사·발령·급여·결재 최종처리=**ERP**. 휴가 결재는 **HIS→Clinic(라우팅)→ERP(W.Sign)→HIS(콜백)** 3자 경유.

### 9.6.1 Clinic 회신 반영 — HIS 측 작업·결정 (커밋 62db55982)
> Clinic 팀이 C-1~C-5에 코드 실측 근거로 회신. 아래는 그에 따른 **HIS 작업/결정**.

| # | Clinic 회신 | HIS 측 작업/결정 |
|---|-------------|------------------|
| **C-1** | 기존 **`POST /api/v1/clinic/sync-staff`**(Clinic 디렉터리 fetch → **email 매칭 → `Staff.clinicUserId` 링크**) 제시. 초기 1회 일괄 + 입사 시 증분 호출 요청 | ⚠ sync-staff는 **기존 Staff만 링크**(없으면 skip) → **User→Staff 생성 백필**은 별도(sync 확장: User(email)↔Clinic staff 매칭 시 Staff 생성·채번). 온보딩 활성화 시 **증분 sync 호출** 추가 |
| **C-2** | approvers API가 HR_LEAVE 별칭 정규화하나 **자동추천은 `his_role_mappings` 조직도 의존** | **결정**: 추천 결재선(조직도) vs `approvers[]` 명시 전달 택1. 조직도 미비 시 **부서장→인사 명시 전달** 권장(초기), 조직도 정비 후 자동 |
| **C-3** | submit DTO **무변경 수용**(v8.12.1). callbackUrl 수신 + **HIS 콜백 EP 회신 요청**. **Clinic 콜백=fire-and-forget(재시도 없음)** | **HIS 작업**: ① 콜백 수신 EP `POST /api/v1/ess/leave/eapproval-callback`(멱등) 신설·회신 ② **재시도 없음 보완** → `GET /erp/eapproval/:approvalId` **상태 폴링 폴백**(콜백 유실 대비) |
| **C-4** | attendance/leave inbound는 **userId 또는 email 식별**, **groupware 근태와 동일 테이블** 기록 | **결정**: 근태 키 **`clinicUserId` 단일** + **groupware vs HIS 타임클럭 원천 단일화**. 중복 시 `ref` 정합. (AttendanceRecord에 clinicUserId 포함) |
| **C-5** | `PATCH staff/[userId]` 있으나 **퇴직/이동 통지 플로우 미합의** | **결정**: 이벤트 호출(staff.changed/resigned 시 Clinic PATCH) vs 주기 sync 택1. 기존 outbox 활용해 **이벤트 통지** 권장 |

> **휴가 PoC E2E 순서(Clinic 권장)**: sync(C-1) → 결재선(C-2) → wsign/request(C-3 submit) → 콜백(C-3). → **이 순서로 스테이징 검증.**
> **백필 재평가**: C-1로 Staff↔Clinic **링크**는 해결. 단 **User(≈105)→Staff(≈6) 생성**은 sync-staff 확장 필요(여전히 P1 선행, 그러나 Clinic 디렉터리가 source라 자동화 가능).

### 9.6.2 휴가 결재 콜백 — 통합 스펙 (ERP 요청5 + Clinic C-3 공통, HIS 회신본)
> ERP·Clinic 양측이 동일 콜백을 요청 → **HIS가 단일 수신 EP를 제공**하고 양 팀에 회신.

**수신 EP (HIS)**: `POST /api/v1/ess/leave/eapproval-callback`
- 인증: `X-Integration-Key`(기존 `erp.integrationKey` 재사용) · `Idempotency-Key`(권장)
- **멱등**: 동일 `ref.source_ref` + `status` 재수신 시 무시(Clinic 콜백 **무재시도**이므로 HIS는 멱등+폴링 폴백)
```jsonc
// 요청 body (Clinic/ERP → HIS)
{ "approvalId": "wsign-123",
  "ref": { "source_module": "hr.leave_requests", "source_ref": "{leaveRequestId}" },
  "status": "APPROVED",            // APPROVED | REJECTED | WITHDRAWN
  "approver": "clinic-mgr-id", "decidedAt": "2026-06-18T10:00:00+09:00", "comment": "" }
// 응답
{ "data": { "ok": true, "leaveRequestId": "...", "applied": "APPROVED" } }
```
**처리**: `LeaveRequest`(source_ref) → `status` 갱신 + `decidedAt`·`approverId` + (APPROVED 시) `LeaveBalance.used` 반영 + AuditLog.
**폴백(무재시도 대비)**: 콜백 미수신 N분 시 HIS가 `GET /api/v1/erp/eapproval/:approvalId` **폴링**으로 상태 동기화.
> 이 스펙을 ERP(요청5)·Clinic(C-3)에 회신. 구현은 ESS 휴가(P4)에 포함.

### 9.3 휴가 승인 SoT·라우팅 확정 (C-5) — **Clinic 경유 3자**
- **승인 SoT = 전자결재(`EApprovalRelay`, docType=`HR_LEAVE`)**, 단 **라우팅은 Clinic**(`clinic-integration/erp-eapproval`, drafter=`clinicUserId`, 결재선=Clinic 제공), **최종처리=ERP/W.Sign**. ESS는 **신청만** 생성.
```
[직원] POST /ess/leave → LeaveRequest(REQUESTED)
   → EApprovalRelay(docType=HR_LEAVE, refModule='hr.leave_requests', refId=LeaveRequest.id)
   → clinic-integration erp-eapproval/submit (drafter_clinic_user_id, approvers=Clinic 결재선)  ★Clinic
   → ERP/W.Sign 결재
[콜백] Clinic/ERP → HIS: LeaveRequest.status=APPROVED/REJECTED·eApprovalRef 연계·LeaveBalance 반영
```
- 전제: `Staff.clinicUserId` 매핑 필수(C-1) + HR_LEAVE 결재선 Clinic 등록(C-2) + 결과 콜백(C-3). §9.6 참조.
- 이중 승인 방지: HIS는 결재 상태 **읽기/반영만**. `LeaveRequest.eApprovalRef ↔ EApprovalRelay.refId` 1:1.

---

## 10. 프런트 구조
```
apps/web/src/app/
  admin/onboarding/page.tsx            # 신규 입사자 관리(목록·등록·발급·검토·승인)
    _components/{InviteFormModal,InviteSendPanel,OnboardingDrawer,StatusChip}.tsx
  onboarding/[token]/{page,welcome,profile,documents,contract}.tsx  # 입사예정자(토큰) — welcome=환영/회사소개, profile=인적사항
    _components/welcome/{Hero,Greeting,Mvv,Culture,Benefits,Facility,Guide}.tsx
  onboarding/boot/page.tsx             # 부팅 마무리(패스키 등록)
  ess/{page,attendance,leave,certificates,profile}/page.tsx
  kiosk/clock/page.tsx                 # 출퇴근 QR 단말
components/layout/Sidebar.tsx          # 관리자 그룹 1줄 추가(비파괴)
lib/qr/usePairing.ts                   # 범용 QR 페어링 SSE 훅(신규 — consent 코어 추출)
```

---

## 11. 비기능 요구 (NFR — I-1)
| 항목 | 설계 |
|------|------|
| **모바일 반응형** | 입사예정자/출퇴근은 **개인폰 우선** → 온보딩·boot·kiosk·ess는 반응형 필수 |
| **다국어(i18n)** | 외국인 의료진/위촉의 대상 — 온보딩 플로우·계약 안내 **한/영 최소 지원**(기존 i18n zustand 재사용) |
| **접근성** | WCAG AA(폼 라벨·대비·키보드), QR 대체 수단(코드 수동 입력) 제공 |
| **오프라인** | 근태 오프라인은 **Out-of-Scope**(Plan §11, FR-08 정책 일관) |
| **성능** | 목록 SSE·페이지네이션, QR 회전 토큰 단주기 |
| **가용성** | ERP 미연동/패스키 백엔드 부재 시 degraded(폴백) 동작 |

---

## 12. 테스트 계획 (I-2)
| 영역 | 핵심 케이스 |
|------|------------|
| 상태기계 | INVITED→생체등록(VERIFIED)→…→BOOTED 정상, EXPIRED 진입, REVOKED, 재발급 시 구토큰 무효, 반려→재제출 |
| 생체등록 경로 | claim(생년월일) → 임시계정 → passkey register/verify → VERIFIED, 재방문 생체 login, 폰 교체 재등록 |
| 활성화 사가 | 사전조건(생체·서류) 미충족 거부, PRE_BOARD→ACTIVE 트랜잭션 롤백, 채번 동시성 충돌, 중간 좌초 후 생체 재인증 이어가기 |
| 토큰/QR 보안 | 만료·재사용·1회성·회전, **QR PNG 로컬생성(외부 미전송) 검증** |
| ESS self 스코프 | 타인 userId 접근 403, 휴가 EApprovalRelay 연계·중복승인 방지 |
| ERP 멱등 | 동일 attendance ref 중복 송신 skip, degraded 적재 |
| E2E | 초대발급(3채널)→서류→계약→승인→부팅→ESS 출퇴근 |
> 기존 BE 테스트(265파일) 동등 수준. Zero-Script QA(Docker 로그)로 부팅 사가·outbox 검증.

---

## 13. 구현 순서 (Plan Phase 매핑)
| 순서 | 내용 | Phase |
|------|------|-------|
| 0 | **선행(§5.6): `User.accountStage` 추가 + 온보딩 스코프 JWT + staff 가드 차단 + 통계 ACTIVE 필터** | P1 |
| 1 | Prisma 10모델(컨벤션 정합) + 허용값·마이그레이션 | P1 |
| 2 | **사이드바 `신규 입사자 관리` + `/admin/onboarding` 목록·등록·3채널 발급(QR 로컬생성)** | P1 |
| 3 | OnboardingTokenGuard + claim(생년월일)→임시계정(PRE_BOARD) + **생체등록(스코프 JWT로 passkey 연결)** | P1 |
| 3.5 | **입사자 환영·회사소개/문화 페이지**(`SystemConfig` 콘텐츠 + HR 편집 탭 + 열람확인) | P2 |
| 4 | **인적사항(개인정보) 입력폼(주민번호·계좌 암호화)** + 온보딩 세션 전용 업로드·암호화·검토(반려/재제출) + 전자계약 생체서명 | P2 |
| 5 | 계정 활성화 사가(4-eyes·HR 신분증대조·채번·PRE_BOARD→ACTIVE·W3) — **임시비번/SMS 없음** | P3 |
| 6 | ESS = **신규 근태(타임클럭)·휴가·증명서** + **재사용 연결**(내정보=`/hr/me`·근무표=`/hr/schedule`·자격=staff-qualification·교육=education) | P4 |
| 7 | 범용 QrSession + 페어링 코어 추출 + QR 5상황 + kiosk | P5 |
| 8 | 감사·**보존/파기 cron(카테고리별 보존기간표 — 근로기준법 3년 등, 미입사자 파기)**·attendance_recorded(W3 v1.1)·주민번호 ERP 보안채널·보안점검·배포 | P6 |
> FR-B5(신분증 OCR 자동채움)는 P2 선택 — 기존 접수 OCR 패턴 재사용, **원본 미저장**. FR-D4(인사정보 수정요청)는 **ERP SoT → EApprovalRelay 변경결재 경로**로 처리(HIS 직접수정 금지).

> §13-3(QrSession 범용화)은 consent-signing-device 페어링 로직 추출을 동반 — **회귀 테스트로 동의서 기기 무영향 확인** 필수.

---

## 13-1. 미해소 / 설계 확인 필요
1. `HR_MANAGER` 권한 신설 여부(행정과 분리) — 미신설 시 `ADMIN_ONLY`.
2. `staff.attendance_recorded` ERP 수신 어댑터 합의(W3 v1.1) + outbox `ref` 유니크 적용 범위.
3. **이메일 SMTP 설정 필수**(`smtp.config`) — 미설정 시 발송이 시뮬레이션(로그)에 그쳐 입사자가 메일을 못 받음. 운영 전 SMTP 구성 또는 QR/링크 대면전달로 운용.
4. 입사서류 보존·파기 기준(미입사자 포함) 법무.
5. **QrSession 범용화 vs consent 페어링 일반화 리팩터링** 범위 확정(규모 재산정 — C-3).
6. 휴가 결재 콜백 인터페이스(ERP→HIS) 스펙 — EApprovalRelay 콜백 경로 합의.
7. **임시계정 노출 범위** — `Staff.status=ONBOARDING`은 직원 수 집계·시드·가드에서 제외(활성화 전 staff 접근 0).
8. `qrcode` npm 도입(서버 로컬 QR) — 외부 api.qrserver.com 미사용 확정.
9. **기존 직원 User↔Staff 백필** — User≈105 vs Staff≈6. Clinic 회신(§9.6.1 C-1): 기존 `sync-staff`로 **링크는 해결**되나 **User→Staff 생성**은 sync 확장 필요(Clinic 디렉터리 source, email 매칭 → Staff 생성·채번·category). P1 선행이나 자동화 경로 확보됨.
10. **`hr` 모듈 확장 vs 신규 모듈** — `/hr/me`·staff CRUD·schedule·ERP가 이미 존재 → onboarding/ESS를 **`hr` 확장**으로 구현(신규 `ess`/`onboarding`은 온보딩 고유 흐름만). 모듈 경계 재확정.
11. **`EmploymentStatus`에 `ONBOARDING` 추가**(enum 마이그레이션) — 기존 ACTIVE/ON_LEAVE/RESIGNED/RETIRED에 추가.
12. **Clinic 협의(§9.6)** — ✅ Clinic 1차 회신 완료(§9.6.1, 커밋 62db55982). 남은 HIS 결정: C-2 결재선 방식(명시 vs 자동), C-4 근태 원천 단일화, C-5 통지 방식. **HIS 신규 작업: 휴가 콜백 수신 EP(`/ess/leave/eapproval-callback`, 멱등) + 상태 폴링 폴백(Clinic 콜백 무재시도)**.

---

## 14. 재사용 자산 실재 확인표 (코드 실측)
| 자산 | 실측 결과 | 설계 반영 |
|------|-----------|-----------|
| `Sidebar.tsx` 관리자 그룹·`HrIcon`·`ADMIN_ONLY` | ✅ 실재 | §3.1 비파괴 추가 |
| `User.employeeNumber`/`erpEmployeeCode`/`clinicUserId` | ✅ 실재 | §4.3 매핑키 신규불필요 |
| `AdminApproval`(4-eyes, action VarChar) | ✅ 실재 | 부팅 승인 `ACCOUNT_BOOT` |
| `EApprovalRelay`(HR_LEAVE·hr.leave_requests) | ✅ 실재 | 휴가 결재 SoT §9.3 |
| `IntegrationOutbox`(uuid·snake_case·ref) | ✅ 실재(ref 비유니크) | §9.1 멱등 보완 |
| **`auth/passkey` 백엔드**(register/login options·verify) + `WebAuthnCredential` | ✅ **실재·작동**(register=JwtAuthGuard, login=isActive 검사) | §7.2·§5.6 생체등록 코어 |
| **`User.accountStage`** | ❌ **부재**(isActive·role enum만) | **신규 필드 추가**(§5.6) |
| 프로젝트 Prisma enum | ✅ **42개 사용**(User.role=enum) | §4.1 "enum 미사용" 정정 |
| `cms-config` 서비스 | ⚠ CmsCategory/Menu만(SystemConfig 미사용) | `config-runtime`/`HospitalInfoContent` 사용(§4-W) |
| `HospitalInfoContent`(병원소개 콘텐츠) | ✅ 실재 | 환영 병원소개 재사용 후보 |
| `webauthn.ts`(클라 전용) | ⚠ 보조(서버 검증은 passkey 백엔드) | §7.2 |
| **SMS OTP**(`patient-auth/sms-otp.service`) | ❌ **시뮬레이션**(TODO 알리고, 로그만) | **제거** — 생체로 대체 |
| 이메일(`crm-channel` nodemailer) | ⚠ SMTP 설정 시만 실발송 | §13-1 전제 |
| **QR 생성** | ⚠ 기존은 외부 `api.qrserver.com` | **서버 로컬 qrcode 도입** |
| `media`/`upload` 업로드 | ⚠ `JwtAuthGuard+RolesGuard`(직원 전용) | **온보딩 세션 전용 EP 신설** |
| `QrSession` | ❌ 미존재 | §4.1 **신규 범용 모델** |
| consent 페어링(`DevicePairingCode`/`ConsentSignSession`) | ⚠ consent 강결합 | 코어 추출 후 범용화 |
| `AuditLog` | ✅ 실재 | §8 감사 전제 유효 |

> **다음 단계**: §13-1 미해소(2·5·6 — ERP 합의·QrSession 범위·결재 콜백) 선결 → `/pdca do staff-onboarding-ess` P1 착수, 또는 design-validator 재검증(목표 75+).
