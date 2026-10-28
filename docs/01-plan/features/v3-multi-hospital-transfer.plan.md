# Hospital RUN v3.0 — 멀티 병원 + 환자 전원 + SMART-on-FHIR 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:12760 · apps/api/src/modules/transfer/ · apps/api/src/app.module.ts:144 · 잔여: §9 건강정보고속도로(사람); §7 멀티 병원 구조(사람)

> **Version**: 1.0
> **Date**: 2026-06-01
> **Author**: PM
> **Status**: Plan
> **Prerequisites**: v2.8.0 완료 (FHIR R4 17리소스, HIE 스텁)

---

## 1. 개요

### 1.1 배경

현재 Hospital RUN은 **단일 병원** 환경에서 동작합니다. 실제 의료 현장에서는:

- **전원(Transfer)**: 응급 환자를 상급병원으로 이송, 재활 환자를 전문병원으로 전원
- **회송(Referral Return)**: 상급병원 진료 후 원래 병원으로 복귀
- **진료정보 교류**: 타 병원 진료 이력 조회, 검사 결과 공유
- **건강정보고속도로**: 보건복지부 표준 기반 병원 간 데이터 교환

이 모든 시나리오에서 **SMART-on-FHIR** 표준 인증과 **멀티 테넌트** 구조가 필수입니다.

### 1.2 목표

| 목표 | 설명 |
|------|------|
| 멀티 병원 | 단일 인스턴스에서 복수 병원/분원 관리 |
| 환자 전원 | 전원 의뢰서 → FHIR Bundle 전송 → 수신 병원 자동 등록 |
| SMART-on-FHIR | 외부 병원 앱이 우리 FHIR API에 안전하게 접근 |
| 건강정보고속도로 | 보건복지부 표준 HIE 연동 (CDA ↔ FHIR) |
| PWA 오프라인 | 네트워크 불안정 환경 대비 오프라인 진료 기록 |

---

## 2. 환자 전원(Transfer) 워크플로우

### 2.1 전원 유형

| 유형 | 방향 | 시나리오 |
|------|------|---------|
| **전원 의뢰** | 우리 → 타 병원 | 응급 환자 상급병원 이송, 전문 치료 의뢰 |
| **전원 수신** | 타 병원 → 우리 | 하급병원에서 전원 환자 수신 |
| **회송** | 상급 → 우리 | 상급병원 치료 후 원래 병원으로 복귀 |
| **교차 진료** | 양방향 | 분원/협력병원 간 환자 공유 |

### 2.2 전원 의뢰 플로우 (우리 → 타 병원)

```
① 전원 결정 (의사)
   ├─ 전원 사유 입력 (응급/전문치료/시설 부족/환자 요청)
   ├─ 수신 병원 검색 (기관코드/진료과/지역)
   └─ 긴급도 설정 (EMERGENT/URGENT/ROUTINE)
       ↓
② 전원 의뢰서 생성
   ├─ 환자 기본 정보 (FHIR Patient)
   ├─ 현재 진단 + 치료 경과 (Condition + Encounter)
   ├─ 투약 이력 (MedicationRequest)
   ├─ 검사 결과 (Observation + DiagnosticReport)
   ├─ 알레르기 (AllergyIntolerance)
   ├─ 영상 (ImagingStudy 참조)
   └─ 전원 사유 + 요청 사항 (ServiceRequest)
       ↓
③ FHIR Bundle 생성
   ├─ Bundle.type = 'document'
   ├─ Composition (전원 의뢰서 메타)
   ├─ 모든 참조 리소스 포함
   └─ Bundle.signature (디지털 서명)
       ↓
④ 전송
   ├─ SMART-on-FHIR 인증 (OAuth2 Client Credentials)
   ├─ POST /fhir/R4 (Bundle)
   ├─ 전송 상태 추적 (SENT → RECEIVED → ACCEPTED/REJECTED)
   └─ 실패 시 재전송 큐
       ↓
⑤ 수신 병원 확인
   ├─ 수락/거절 응답
   ├─ 이송 일시 조율
   └─ 이송 완료 확인
```

### 2.3 전원 수신 플로우 (타 병원 → 우리)

```
① FHIR Bundle 수신
   ├─ POST /fhir/R4 (Bundle)
   ├─ 서명 검증
   └─ 리소스 파싱
       ↓
② 환자 매칭/등록
   ├─ CI(본인인증) 기반 매칭 (기존 환자 검색)
   ├─ 매칭 실패 시 → 신규 환자 자동 등록
   ├─ 중복 방지 (familyName + givenName + dateOfBirth)
   └─ 전원 출처 태깅 (sourceOrganization)
       ↓
③ 진료 데이터 이관
   ├─ Condition → EncounterDiagnosis (이력)
   ├─ MedicationRequest → 투약 이력 (읽기 전용)
   ├─ Observation → 검사 결과 이력
   ├─ AllergyIntolerance → 알레르기 동기화
   └─ DocumentReference → 첨부 문서
       ↓
④ 입원/외래 연결
   ├─ 응급 전원 → 응급실 접수 자동 생성
   ├─ 일반 전원 → 입원 예약 생성
   └─ 외래 전원 → 예약 생성
       ↓
⑤ 전원 기록 저장
   ├─ TransferRecord 생성 (양방향 추적)
   ├─ 원내 여정(Journey) 이벤트 발행
   └─ 알림 (담당 의사 + 원무과)
```

---

## 3. 해외/외부 환자 등록

### 3.1 대상 유형

| 유형 | 식별자 | 보험 | 시나리오 |
|------|--------|------|---------|
| **외국인 관광객** | 여권번호 | 없음 (SELF_PAY) | 응급/외래 방문, 관광 의료 |
| **재외동포** | 여권 + 한국주민번호(선택) | NHI 가능 | 귀국 후 진료 |
| **외국인 거주자** | 외국인등록번호 | NHI/SELF_PAY | 등록 외국인 정기 진료 |
| **원격진료 해외환자** | 여권/이메일 | 없음 | 원격 2차소견, 국제 진료 |
| **타 병원 전원 환자** | CI/MRN | 기존 보험 | 전원 수신 시 자동 등록 |
| **응급 미확인 환자** | 없음 (임시ID) | 미상 | 의식불명/신원미상 응급 |

### 3.2 등록 워크플로우

```
① 환자 유형 선택
   ├─ 내국인 (주민번호 검증)
   ├─ 외국인 거주자 (외국인등록번호)
   ├─ 외국인 관광객 (여권번호)
   ├─ 재외동포 (여권 + 선택적 주민번호)
   ├─ 원격 해외환자 (여권/이메일)
   └─ 응급 미확인 (임시ID 자동 부여)
       ↓
② 식별 정보 입력
   ├─ 성명: familyName/givenName (영문 필수, 한글 선택)
   ├─ 국적: nationality (ISO 3166-1)
   ├─ 여권번호: passportNumber (여권 유형)
   ├─ 외국인등록번호: alienRegistrationNo (거주자)
   ├─ 생년월일 + 성별
   ├─ 연락처: 국가코드+전화번호, 이메일
   └─ 언어: preferredLanguage (ko/en/zh/ja/...)
       ↓
③ 보험/결제 설정
   ├─ NHI (건강보험) — 외국인 거주자 가능
   ├─ SELF_PAY — 자비 (외국인 관광객)
   ├─ TRAVEL_INSURANCE — 여행자 보험 (보험사 정보 입력)
   ├─ EMBASSY — 대사관 보증
   └─ DEPOSIT — 선수금 필수 (미보험 외국인)
       ↓
④ 의사소통 지원
   ├─ 선호 언어 설정 → AI 번역 자동 활성화
   ├─ 동의서 다국어 버전 (영/중/일)
   ├─ 통역 서비스 요청 플래그
   └─ 진료 안내문 다국어 출력
       ↓
⑤ 등록 완료
   ├─ MRN 자동 부여
   ├─ FHIR Patient 리소스 생성 (identifier: passport)
   ├─ 여정(Journey) 시작
   └─ 알림 (원무과 + 담당 의사)
```

### 3.3 Patient 모델 확장

```prisma
model Patient {
  // 기존 필드...

  // v3.0 해외/외부 환자 확장
  nationality         String?  @db.VarChar(3)               // ISO 3166-1 alpha-3 (KOR, USA, CHN, JPN)
  passportNumber      String?  @map("passport_number")       // 여권번호 (암호화)
  alienRegistrationNo String?  @map("alien_registration_no") // 외국인등록번호 (암호화)
  preferredLanguage   String?  @map("preferred_language") @db.VarChar(5)  // ko, en, zh, ja
  nameEn              String?  @map("name_en") @db.VarChar(200)           // 영문 성명
  patientSource       String?  @map("patient_source") @db.VarChar(20)
  // DOMESTIC: 내국인
  // FOREIGN_RESIDENT: 외국인 거주자
  // FOREIGN_TOURIST: 외국인 관광객
  // OVERSEAS_KOREAN: 재외동포
  // REMOTE_INTERNATIONAL: 원격 해외환자
  // TRANSFER_IN: 타병원 전원
  // EMERGENCY_UNKNOWN: 응급 미확인
  travelInsurance     Json?    @map("travel_insurance") @db.JsonB // {company, policyNo, contactNo}
  embassyContact      String?  @map("embassy_contact") @db.VarChar(200)
  interpreterNeeded   Boolean  @default(false) @map("interpreter_needed")
  depositRequired     Boolean  @default(false) @map("deposit_required")
}
```

### 3.4 다국어 지원

| 항목 | 지원 언어 | 방식 |
|------|----------|------|
| 동의서 | 한/영/중/일 | 템플릿 다국어 버전 |
| 진료 안내 | 한/영/중/일 | AI 자동 번역 |
| 처방전 | 한/영 | 약품명 nameEn 필드 |
| 영수증 | 한/영 | 법정양식 + 영문 부본 |
| 진단서 | 한/영 | ICD-10 영문 코드 활용 |
| AI 진료보조 | 한/영 | language 파라미터 |
| 포털/모바일 | 한/영 | i18n (향후) |

### 3.5 신규 엔드포인트

```
POST /api/v1/patients/foreign          — 외국인 환자 등록
POST /api/v1/patients/emergency-unknown — 응급 미확인 환자 등록 (임시ID)
PATCH /api/v1/patients/:id/identify    — 미확인 환자 신원 확인 (임시→정식)
GET  /api/v1/patients/:id/passport     — 여권 정보 조회 (권한 제한)
POST /api/v1/consent-forms/:id/translate — 동의서 다국어 번역 (AI)
GET  /api/v1/billing/:id/receipt-en    — 영문 영수증
```

### 3.6 FE 페이지

| 페이지 | 역할 |
|--------|------|
| 환자 등록 모달 | 유형 탭 추가 (내국인/외국인/응급미확인) |
| 환자 상세 | 여권/국적/언어/보험 섹션 추가 |
| 원무과 접수 | 외국인 환자 예치금 안내 + 여행자보험 입력 |
| 동의서 | 다국어 선택 드롭다운 |

---

## 4. 데이터 모델 (전원 + 인증)

### 4.1 신규 모델

```prisma
// 병원/기관 (멀티 테넌트)
model Organization {
  id              String   @id @default(uuid()) @db.Uuid
  code            String   @unique @db.VarChar(20)      // HIRA 기관코드
  name            String   @db.VarChar(200)
  type            String   @db.VarChar(30)               // HOSPITAL, CLINIC, PHARMACY, PUBLIC_HEALTH
  grade           String?  @db.VarChar(20)               // TERTIARY, GENERAL, HOSPITAL, CLINIC
  address         Json?    @db.JsonB
  phone           String?  @db.VarChar(20)
  fhirEndpoint    String?  @map("fhir_endpoint")         // 상대 병원 FHIR Base URL
  smartClientId   String?  @map("smart_client_id")       // SMART-on-FHIR Client ID
  smartSecret     String?  @map("smart_secret")          // 암호화 저장
  isActive        Boolean  @default(true) @map("is_active")
  isSelf          Boolean  @default(false) @map("is_self") // 우리 병원 여부
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  transfersSent     TransferRecord[] @relation("TransferFrom")
  transfersReceived TransferRecord[] @relation("TransferTo")

  @@map("organizations")
}

// 전원 기록
model TransferRecord {
  id                String   @id @default(uuid()) @db.Uuid
  patientId         String   @map("patient_id") @db.Uuid
  fromOrgId         String   @map("from_org_id") @db.Uuid
  toOrgId           String   @map("to_org_id") @db.Uuid
  transferType      String   @map("transfer_type") @db.VarChar(20)
  // OUTGOING_REFERRAL: 전원 의뢰 (우리→타)
  // INCOMING_REFERRAL: 전원 수신 (타→우리)
  // RETURN: 회송
  // CROSS_CONSULT: 교차 진료
  status            String   @db.VarChar(20)
  // REQUESTED → ACCEPTED → IN_TRANSIT → COMPLETED / REJECTED / CANCELLED
  urgency           String   @db.VarChar(10)              // EMERGENT, URGENT, ROUTINE
  reason            String   @db.Text                     // 전원 사유
  clinicalSummary   String?  @map("clinical_summary") @db.Text  // 임상 요약
  diagnoses         Json?    @db.JsonB                    // 진단 목록 [{code, name}]
  medications       Json?    @db.JsonB                    // 현재 투약
  allergies         Json?    @db.JsonB                    // 알레르기
  labResults        Json?    @map("lab_results") @db.JsonB // 최근 검사
  fhirBundleId      String?  @map("fhir_bundle_id")       // 전송된 FHIR Bundle ID
  fhirBundle        Json?    @map("fhir_bundle") @db.JsonB // Bundle 원본 (보관)
  requestedBy       String?  @map("requested_by") @db.Uuid // 의뢰 의사
  acceptedBy        String?  @map("accepted_by") @db.Uuid  // 수락 의사
  requestedAt       DateTime @default(now()) @map("requested_at") @db.Timestamptz()
  acceptedAt        DateTime? @map("accepted_at") @db.Timestamptz()
  transferredAt     DateTime? @map("transferred_at") @db.Timestamptz()
  completedAt       DateTime? @map("completed_at") @db.Timestamptz()
  responseNote      String?  @map("response_note") @db.Text // 수신 병원 응답
  metadata          Json?    @db.JsonB

  patient           Patient      @relation(fields: [patientId], references: [id])
  fromOrg           Organization @relation("TransferFrom", fields: [fromOrgId], references: [id])
  toOrg             Organization @relation("TransferTo", fields: [toOrgId], references: [id])

  @@index([patientId])
  @@index([status])
  @@index([fromOrgId, status])
  @@index([toOrgId, status])
  @@map("transfer_records")
}

// SMART-on-FHIR 토큰 (외부 앱 인증)
model SmartClient {
  id           String   @id @default(uuid()) @db.Uuid
  clientId     String   @unique @map("client_id") @db.VarChar(100)
  clientSecret String   @map("client_secret") @db.VarChar(500) // 암호화
  name         String   @db.VarChar(200)
  orgId        String?  @map("org_id") @db.Uuid          // 연결 기관
  scopes       String[] @default([])                       // patient/*.read, user/*.write 등
  redirectUris String[] @default([]) @map("redirect_uris")
  isActive     Boolean  @default(true) @map("is_active")
  lastUsedAt   DateTime? @map("last_used_at") @db.Timestamptz()
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@map("smart_clients")
}
```

### 3.2 Patient 확장

```prisma
model Patient {
  // 기존 필드...

  // v3.0 멀티 병원 확장
  sourceOrgId       String?  @map("source_org_id") @db.Uuid    // 전원 출처 기관
  externalPatientId String?  @map("external_patient_id")        // 원래 병원 Patient ID
  transferRecords   TransferRecord[]
}
```

---

## 5. 파트너 연동 관리 (Partner Integration Management)

### 5.1 파트너 연동 라이프사이클

```
① 연동 신청 (파트너 병원/보험사/앱)
   ├─ 공개 신청 폼 (/international/interoperability → "연동 신청")
   ├─ 기관 정보 입력 (기관명, 유형, 연락처, FHIR Base URL)
   ├─ 연동 목적 선택 (전원/진료정보교류/보험청구/앱연동)
   └─ 기술 담당자 정보
       ↓
② 신청 접수 + 심사 (관리자)
   ├─ /admin/partner-requests — 신청 대기열
   ├─ 기관 정보 검증 (HIRA 기관코드, 사업자번호)
   ├─ 연동 범위 협의 (Scope: patient/*.read, encounter/*.write 등)
   ├─ 보안 요건 확인 (TLS, IP 화이트리스트)
   └─ 심사 상태: PENDING → REVIEWING → APPROVED / REJECTED
       ↓
③ 승인 + 클라이언트 발급
   ├─ SMART Client 자동 생성 (clientId + clientSecret)
   ├─ API Key 발급 (선택)
   ├─ Scope 설정 (접근 가능 리소스/작업)
   ├─ Rate Limit 설정 (기관별 API 호출 제한)
   ├─ IP 화이트리스트 등록
   └─ 파트너에게 인증 정보 전달 (암호화 이메일)
       ↓
④ 연동 테스트 (Sandbox)
   ├─ Sandbox 환경 자동 생성 (테스트 데이터)
   ├─ 연결 테스트 (FHIR metadata 호출)
   ├─ 리소스 CRUD 테스트
   ├─ Bundle 전송 테스트
   └─ 테스트 결과 리포트 자동 생성
       ↓
⑤ 운영 전환 (Go-Live)
   ├─ Production 환경 활성화
   ├─ 모니터링 대시보드 자동 설정
   └─ 알림 설정 (에러율, 응답시간)
       ↓
⑥ 운영 모니터링
   ├─ API 호출 통계 (일별/주별/월별)
   ├─ 에러율 + 응답시간 추이
   ├─ 전원/교류 건수 추적
   ├─ 이상 감지 알림 (에러 급증, 비정상 접근)
   └─ 월간 리포트 자동 발송
```

### 5.2 데이터 모델

```prisma
// 파트너 연동 신청
model PartnerRequest {
  id              String   @id @default(uuid()) @db.Uuid
  orgName         String   @map("org_name") @db.VarChar(200)
  orgType         String   @map("org_type") @db.VarChar(30)     // HOSPITAL, CLINIC, INSURANCE, APP_VENDOR, RESEARCH
  orgCode         String?  @map("org_code") @db.VarChar(20)     // HIRA 기관코드
  businessNo      String?  @map("business_no") @db.VarChar(20)  // 사업자번호
  country         String   @db.VarChar(3)                        // ISO 3166-1
  contactName     String   @map("contact_name") @db.VarChar(100)
  contactEmail    String   @map("contact_email") @db.VarChar(200)
  contactPhone    String?  @map("contact_phone") @db.VarChar(30)
  techContactName String?  @map("tech_contact_name") @db.VarChar(100)
  techContactEmail String? @map("tech_contact_email") @db.VarChar(200)
  fhirBaseUrl     String?  @map("fhir_base_url")                // 상대방 FHIR Base URL
  purpose         String[] @default([])                          // TRANSFER, HIE, INSURANCE_CLAIM, APP_INTEGRATION
  requestedScopes String[] @default([]) @map("requested_scopes") // patient/*.read, encounter/*.read 등
  status          String   @db.VarChar(20)                       // PENDING, REVIEWING, APPROVED, REJECTED, SUSPENDED
  reviewNote      String?  @map("review_note") @db.Text
  reviewedBy      String?  @map("reviewed_by") @db.Uuid
  reviewedAt      DateTime? @map("reviewed_at") @db.Timestamptz()
  orgId           String?  @map("org_id") @db.Uuid              // 승인 시 Organization 연결
  smartClientId   String?  @map("smart_client_id") @db.Uuid     // 승인 시 SmartClient 연결
  ipWhitelist     String[] @default([]) @map("ip_whitelist")
  rateLimit       Int?     @map("rate_limit")                    // 분당 최대 요청 수
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([status])
  @@map("partner_requests")
}

// API 호출 로그 (모니터링)
model ApiAccessLog {
  id           String   @id @default(uuid()) @db.Uuid
  clientId     String   @map("client_id") @db.VarChar(100)     // SmartClient.clientId
  orgId        String?  @map("org_id") @db.Uuid
  method       String   @db.VarChar(10)                         // GET, POST, PUT
  path         String   @db.VarChar(500)                        // /fhir/R4/Patient
  statusCode   Int      @map("status_code")                     // 200, 401, 500
  responseTime Int      @map("response_time")                   // ms
  ipAddress    String?  @map("ip_address") @db.VarChar(50)
  userAgent    String?  @map("user_agent") @db.VarChar(500)
  errorMessage String?  @map("error_message") @db.Text
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([clientId, createdAt])
  @@index([orgId, createdAt])
  @@index([statusCode, createdAt])
  @@map("api_access_logs")
}
```

### 5.3 FE 페이지

| 경로 | 페이지 | 접근 | 주요 기능 |
|------|--------|------|----------|
| `/international/interoperability` | 공개 안내 + 연동 신청 폼 | 공개 | 신청 폼 (기관정보+목적+스코프) |
| `/admin/partner-requests` | 파트너 신청 관리 | ADMIN | 대기열, 심사(승인/거절), 클라이언트 발급 |
| `/admin/partner-requests/[id]` | 신청 상세 | ADMIN | 기관 검증, Scope 협의, 테스트 결과 |
| `/admin/partner-monitoring` | 연동 모니터링 대시보드 | ADMIN | API 통계, 에러율, 기관별 트래픽, 알림 |
| `/admin/partner-monitoring/[orgId]` | 기관별 상세 | ADMIN | 호출 이력, 응답시간 추이, 월간 리포트 |

### 5.4 신규 API

```
// 공개 (인증 불필요)
POST /api/v1/partner/apply              — 연동 신청 접수
GET  /api/v1/partner/apply/:id/status   — 신청 상태 조회 (이메일 인증)

// 관리자
GET  /api/v1/admin/partner-requests              — 신청 목록 (상태 필터)
GET  /api/v1/admin/partner-requests/:id          — 신청 상세
PATCH /api/v1/admin/partner-requests/:id/review  — 심사 (승인/거절)
POST /api/v1/admin/partner-requests/:id/approve  — 승인 + 클라이언트 자동 발급
POST /api/v1/admin/partner-requests/:id/sandbox  — Sandbox 환경 생성
GET  /api/v1/admin/partner-requests/:id/test     — 연결 테스트 실행

// 모니터링
GET  /api/v1/admin/partner-monitoring/stats       — 전체 통계 (호출수/에러율/응답시간)
GET  /api/v1/admin/partner-monitoring/:orgId      — 기관별 상세 통계
GET  /api/v1/admin/partner-monitoring/:orgId/logs — 기관별 호출 이력
GET  /api/v1/admin/partner-monitoring/alerts      — 이상 감지 알림 목록
```

### 5.5 연동 신청 폼 와이어프레임

```
┌─────────────────────────────────────────────────┐
│  연동 파트너 신청                    [← 돌아가기]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  기관 유형:  ○ 병원  ○ 보험사  ○ 앱개발사  ○ 연구  │
│                                                 │
│  기관명:     [_______________________________]   │
│  국가:       [🇰🇷 대한민국 ▼]                     │
│  기관코드:   [__________] (HIRA/해외 기관코드)    │
│  FHIR URL:  [https://fhir.partner.com/R4    ]   │
│                                                 │
│  ── 연동 목적 (복수 선택) ──                      │
│  ☑ 환자 전원 (Transfer)                          │
│  ☐ 진료정보 교류 (HIE)                           │
│  ☐ 보험 청구 (Insurance Claim)                   │
│  ☐ 앱 연동 (App Integration)                     │
│                                                 │
│  ── 요청 Scope ──                                │
│  ☑ patient/*.read    ☐ patient/*.write           │
│  ☑ encounter/*.read  ☐ encounter/*.write         │
│  ☑ observation/*.read                            │
│  ☐ medicationrequest/*.read                      │
│                                                 │
│  ── 담당자 ──                                     │
│  이름:  [___________]  이메일: [_______________]  │
│  기술:  [___________]  이메일: [_______________]  │
│                                                 │
│  [               연동 신청 제출               ]   │
│                                                 │
│  * 심사에 3~5 영업일 소요됩니다.                   │
│  * 승인 후 SMART Client 인증 정보가 발급됩니다.    │
└─────────────────────────────────────────────────┘
```

### 5.6 모니터링 대시보드 와이어프레임

```
┌─────────────────────────────────────────────────┐
│  파트너 연동 모니터링                             │
├──────┬──────┬──────┬──────┬────────────────────┤
│활성파트너│ 오늘호출│ 에러율  │ 평균응답 │  전원 건수   │
│  12   │ 2,450 │ 0.3% │ 120ms │  이번달 8  │
├──────┴──────┴──────┴──────┴────────────────────┤
│                                                 │
│  ┌─ 기관별 API 트래픽 (24h) ──────────────┐    │
│  │  ████████████████████ 가상대병원 (850)  │    │
│  │  ████████████ 가상대분당 (420)          │    │
│  │  ██████ Tokio Medical (210)            │    │
│  │  ████ AIG Insurance (150)              │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  ┌─ 에러율 추이 (7일) ──────────────────┐     │
│  │    0.5% ─ · · ·                       │     │
│  │    0.3% ─ · · · · · ·                │     │
│  │    0.1% ─                             │     │
│  │          월  화  수  목  금  토  일     │     │
│  └────────────────────────────────────────┘    │
│                                                 │
│  ┌─ 최근 알림 ──────────────────────────┐     │
│  │ ⚠️ Tokio Medical 에러율 5% 초과 (1h)  │     │
│  │ ℹ️ AIG 신규 연동 테스트 통과           │     │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## 6. SMART-on-FHIR 인증

### 4.1 흐름 (Client Credentials — 병원 간)

```
┌──────────────┐                    ┌──────────────┐
│  송신 병원    │                    │  수신 병원    │
│  (Client)    │                    │  (Auth Server)│
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │  1. POST /oauth2/token            │
       │  grant_type=client_credentials    │
       │  client_id=xxx                    │
       │  client_secret=yyy               │
       │  scope=patient/*.read             │
       │─────────────────────────────────→│
       │                                   │
       │  2. { access_token, expires_in }  │
       │←─────────────────────────────────│
       │                                   │
       │  3. POST /fhir/R4 (Bundle)        │
       │  Authorization: Bearer <token>    │
       │─────────────────────────────────→│
       │                                   │
       │  4. { Bundle response }           │
       │←─────────────────────────────────│
```

### 4.2 신규 엔드포인트

```
POST /oauth2/token                    — SMART 토큰 발급
GET  /oauth2/authorize                — SMART 인가 (EHR Launch)
GET  /.well-known/smart-configuration — SMART 메타데이터

POST /api/v1/transfer/request         — 전원 의뢰 생성
GET  /api/v1/transfer/incoming        — 수신 전원 목록
PATCH /api/v1/transfer/:id/accept     — 전원 수락
PATCH /api/v1/transfer/:id/reject     — 전원 거절
PATCH /api/v1/transfer/:id/complete   — 전원 완료
GET  /api/v1/transfer/:id/bundle      — FHIR Bundle 조회
POST /api/v1/transfer/:id/send        — Bundle 전송

GET  /api/v1/organizations            — 연동 기관 목록
POST /api/v1/organizations            — 기관 등록
GET  /api/v1/organizations/:id/test   — 연결 테스트

POST /api/v1/smart-clients            — SMART 클라이언트 등록
GET  /api/v1/smart-clients            — 클라이언트 목록
```

---

## 6. 전원 의뢰서 FHIR Bundle 구조

```json
{
  "resourceType": "Bundle",
  "type": "document",
  "timestamp": "2026-06-01T10:00:00+09:00",
  "signature": {
    "type": [{"code": "1.2.840.10065.1.12.1.1"}],
    "when": "2026-06-01T10:00:00+09:00",
    "who": {"reference": "Practitioner/doctor-001"},
    "data": "base64-signature"
  },
  "entry": [
    {
      "resource": {
        "resourceType": "Composition",
        "status": "final",
        "type": {"coding": [{"system": "http://loinc.org", "code": "18761-7", "display": "Transfer summary note"}]},
        "title": "전원 의뢰서",
        "subject": {"reference": "Patient/patient-001"},
        "author": [{"reference": "Practitioner/doctor-001"}],
        "section": [
          {"title": "전원 사유", "text": {"div": "..."}},
          {"title": "현재 진단", "entry": [{"reference": "Condition/cond-001"}]},
          {"title": "투약 이력", "entry": [{"reference": "MedicationRequest/med-001"}]},
          {"title": "검사 결과", "entry": [{"reference": "Observation/obs-001"}]},
          {"title": "알레르기", "entry": [{"reference": "AllergyIntolerance/allergy-001"}]}
        ]
      }
    },
    {"resource": {"resourceType": "Patient", "...": "환자 전체 정보"}},
    {"resource": {"resourceType": "Condition", "...": "진단 정보"}},
    {"resource": {"resourceType": "MedicationRequest", "...": "투약 정보"}},
    {"resource": {"resourceType": "Observation", "...": "검사 결과"}},
    {"resource": {"resourceType": "AllergyIntolerance", "...": "알레르기"}}
  ]
}
```

---

## 7. 멀티 병원 구조

### 6.1 단계별 접근

| Phase | 범위 | 설명 |
|-------|------|------|
| **Phase 1** | 전원 기록 | TransferRecord CRUD + FHIR Bundle 생성 |
| **Phase 2** | SMART 인증 | OAuth2 토큰 서버 + 클라이언트 관리 |
| **Phase 3** | Bundle 전송 | 실제 HTTP 전송 + 상태 추적 |
| **Phase 4** | Bundle 수신 | 자동 환자 매칭 + 데이터 이관 |
| **Phase 5** | 관리 UI | 전원 대시보드 + 기관 관리 + 모니터링 |

### 7.2 FE 페이지 상세

#### 전원 관리 (5페이지)

| 경로 | 페이지 | 접근 권한 | 주요 컴포넌트 |
|------|--------|----------|-------------|
| `/transfer` | 전원 대시보드 | DOCTOR, ADMIN | 요약카드(발신/수신/진행/완료), 최근 전원 목록, 상태 필터 |
| `/transfer/request` | 전원 의뢰 작성 | DOCTOR | 4Step: 환자선택→수신병원→임상정보→Bundle미리보기+전송 |
| `/transfer/incoming` | 수신 전원 목록 | DOCTOR, ADMIN | 수신 대기열, 수락/거절 버튼, Bundle 미리보기 |
| `/transfer/[id]` | 전원 상세 | DOCTOR, ADMIN | 상태 타임라인, FHIR Bundle 뷰어(리소스 트리), 메시지 |
| `/transfer/history` | 전원 이력 | DOCTOR, ADMIN | 기간 필터, 기관별/유형별 통계 차트 |

#### 해외/외부 환자 (3페이지)

| 경로 | 페이지 | 접근 권한 | 주요 컴포넌트 |
|------|--------|----------|-------------|
| `/patients/register/foreign` | 외국인 등록 | NURSE, ADMIN | 유형 탭(관광/거주/재외동포), 여권입력, 국적선택, 언어설정 |
| `/patients/register/emergency` | 응급 미확인 등록 | NURSE, DOCTOR | 임시ID 자동부여, 최소 정보(성별/추정연령), 나중에 신원확인 |
| `/patients/[id]/international` | 해외환자 상세 탭 | NURSE, DOCTOR | 여권/비자, 여행자보험, 대사관, 통역요청, 다국어 동의서 |

#### 관리자 (3페이지)

| 경로 | 페이지 | 접근 권한 | 주요 컴포넌트 |
|------|--------|----------|-------------|
| `/admin/organizations` | 연동 기관 관리 | ADMIN | 기관 목록+검색, 등록 폼(기관코드/FHIR URL/SMART인증), 연결 테스트 |
| `/admin/smart-clients` | SMART 클라이언트 | ADMIN | 클라이언트 목록, 발급/폐기, Scope 설정, 사용 이력 |
| `/admin/transfer-stats` | 전원 통계 | ADMIN | 월별 전원 건수, 기관별 분포, 평균 소요시간, 거절률 |

#### 안내/랜딩 (2페이지)

| 경로 | 페이지 | 접근 | 주요 컴포넌트 |
|------|--------|------|-------------|
| `/interoperability` | FHIR/전원 안내 | 공개 (인증 불필요) | v3.0 기능 소개, FHIR R4 API 목록, 연동 절차, 문서 링크 |
| `/interoperability/test` | 연동 테스트 콘솔 | ADMIN | FHIR 엔드포인트 테스트, Bundle 유효성 검증, 응답 뷰어 |

#### 전원 의뢰 작성 Step 상세

```
Step 1: 환자 선택
┌─────────────────────────────────────┐
│  [PatientSelector]                  │
│  최근 진료 환자 / 입원 환자 검색     │
│  선택 시 현재 진단+투약 자동 로드    │
└─────────────────────────────────────┘

Step 2: 수신 병원 선택
┌─────────────────────────────────────┐
│  [기관 검색] 기관코드/이름/지역      │
│  ┌──────────────────────┐           │
│  │ 가상대병원    TERTIARY │ [선택]   │
│  │ 가상대분당    GENERAL  │ [선택]   │
│  └──────────────────────┘           │
│  전원 유형: ○ 전원의뢰  ○ 회송      │
│  긴급도:   ○ EMERGENT ○ URGENT ○ ROUTINE │
│  전원 사유: [________________]       │
└─────────────────────────────────────┘

Step 3: 임상 정보 확인
┌─────────────────────────────────────┐
│  ◻ 현재 진단 (자동)                 │
│    [J06.9] 급성 상기도감염            │
│    [I10] 본태성 고혈압               │
│  ◻ 투약 이력 (자동)                 │
│    아스피린 100mg QD                 │
│  ◻ 검사 결과 (최근 7일)             │
│    CBC, BMP, 흉부 X-ray             │
│  ◻ 알레르기                         │
│    페니실린 (SEVERE)                 │
│  ◻ 추가 소견 [자유텍스트]           │
└─────────────────────────────────────┘

Step 4: 전송 확인
┌─────────────────────────────────────┐
│  FHIR Bundle 미리보기               │
│  ┌───────────────────────┐         │
│  │ Composition           │         │
│  │ ├─ Patient            │         │
│  │ ├─ Condition (2)      │         │
│  │ ├─ MedicationReq (1)  │         │
│  │ ├─ Observation (5)    │         │
│  │ └─ AllergyInt (1)     │         │
│  └───────────────────────┘         │
│  [취소]            [전원 의뢰 전송]  │
└─────────────────────────────────────┘
```

#### 전원 대시보드 레이아웃

```
┌─────────────────────────────────────────────┐
│  전원 관리                    [+ 전원 의뢰]  │
├──────┬──────┬──────┬──────┬────────────────┤
│ 발신  │ 수신  │ 진행중 │ 완료 │  이번달 통계   │
│  3   │  2   │  1   │ 15  │  거절률 5%     │
├──────┴──────┴──────┴──────┴────────────────┤
│  [전체] [발신] [수신] [진행] [완료]          │
├─────────────────────────────────────────────┤
│  김환자 → 가상대병원  │ EMERGENT │ 진행중    │
│  이환자 ← 가상대분당  │ ROUTINE  │ 수락대기  │
│  박환자 → 가상의료원    │ URGENT   │ 완료      │
└─────────────────────────────────────────────┘
```

---

## 8. PWA 오프라인 지원

### 7.1 범위

| 기능 | 오프라인 지원 | 동기화 전략 |
|------|:----------:|-----------|
| 환자 검색 | ✅ (IndexedDB 캐시) | 최근 100명 |
| SOAP 작성 | ✅ | 온라인 복귀 시 자동 업로드 |
| 바이탈 입력 | ✅ | Queue 기반 동기화 |
| 처방 입력 | ⚠️ (DUR 불가) | 온라인 시 DUR 재검증 |
| 검사 결과 | ❌ (읽기만 캐시) | - |
| 수납 | ❌ | 온라인 필수 |

### 7.2 기술 스택

```
Service Worker (next-pwa)
  ├─ Cache Strategy: NetworkFirst (API), CacheFirst (Static)
  ├─ IndexedDB (Dexie.js): 환자/진료/처방 오프라인 저장
  ├─ Background Sync: 온라인 복귀 시 자동 동기화
  └─ Conflict Resolution: Last-Write-Wins + 의사 확인
```

---

## 9. 건강정보고속도로 연동

### 8.1 표준

| 항목 | 규격 |
|------|------|
| 문서 형식 | CDA R2 (HL7 Korea 표준) |
| 전송 | SOAP/REST (건강정보고속도로 게이트웨이) |
| 인증 | 기관인증서 (NPKI) |
| 환자 매칭 | CI (본인확인정보) |

### 8.2 지원 문서 유형

| 코드 | 문서 | 방향 |
|------|------|------|
| TRSF | 진료의뢰서/회신서 | 양방향 |
| PRSC | 처방전 | 송신 |
| DIAG | 진단서 | 송신 |
| EXAM | 검사결과지 | 양방향 |
| IMAG | 영상 판독문 | 양방향 |
| DSCH | 퇴원요약서 | 양방향 |

### 8.3 CDA ↔ FHIR 변환

```
CDA R2 (한국 표준)
  ↕ CDA-FHIR Converter
FHIR R4 Bundle
  ↕ Hospital RUN 내부 모델
Prisma Models (Patient, Encounter, Prescription, ...)
```

---

## 10. 구현 로드맵

### Phase 1 (2주) — 전원 기록 + Bundle 생성

- [ ] TransferRecord 스키마 + 마이그레이션
- [ ] Organization 스키마 (연동 기관)
- [ ] transfer 모듈 BE (CRUD + Bundle 생성)
- [x] 전원 의뢰서 작성 FE (`/transfer/request`)
- [x] 전원 대시보드 FE (`/transfer`)

### Phase 2 (2주) — SMART-on-FHIR 인증

- [ ] SmartClient 스키마
- [x] OAuth2 토큰 엔드포인트 (`/oauth2/token`)
- [ ] SMART Configuration (`.well-known/smart-configuration`)
- [x] 클라이언트 관리 FE (`/admin/smart-clients`)
- [ ] Scope 기반 FHIR 접근 제어

### Phase 3 (2주) — 전송 + 수신

- [ ] Bundle HTTP 전송 (retry + queue)
- [ ] Bundle 수신 + 파싱
- [ ] 환자 자동 매칭 (CI 기반)
- [ ] 진료 데이터 이관 (Condition, Medication, Observation)
- [x] 수신 전원 목록 FE (`/transfer/incoming`)

### Phase 4 (1주) — 관리 + 모니터링

- [x] 기관 관리 FE (`/admin/organizations`)
- [x] 전원 상세 FE (`/transfer/[id]`)
- [ ] 전송 실패 재시도 대시보드
- [ ] 감사 로그 확장

### Phase 5 (2주) — 해외/외부 환자 등록

- [ ] Patient 스키마 확장 (nationality, passport, language, source)
- [ ] 외국인 환자 등록 API (foreign, emergency-unknown, identify)
- [ ] 환자 등록 모달 유형 탭 (내국인/외국인/응급미확인)
- [ ] 다국어 동의서 (영/중/일)
- [ ] 여행자보험 + 예치금 처리
- [ ] 영문 영수증 + 진단서

### Phase 6 (2주) — PWA 오프라인

- [ ] Service Worker 설정 (next-pwa)
- [ ] IndexedDB 캐시 (Dexie.js)
- [ ] 오프라인 SOAP 작성
- [ ] Background Sync
- [ ] Conflict Resolution UI

### Phase 7 (3주) — 건강정보고속도로

- [ ] CDA R2 파서/생성기
- [ ] CDA ↔ FHIR 변환기
- [ ] 건강정보고속도로 게이트웨이 연동
- [ ] 기관인증서 (NPKI) 처리
- [ ] 교류 이력 대시보드

---

## 11. 예상 규모

| 항목 | 수량 |
|------|------|
| 신규 Prisma 모델 | 3개 (Organization, TransferRecord, SmartClient) |
| Patient 확장 필드 | 10개 (nationality, passport, language 등) |
| 신규 BE 모듈 | 4개 (transfer, smart-auth, foreign-patient, cda-converter) |
| 신규 API | ~30개 |
| 신규 FE 페이지 | ~10개 |
| 다국어 지원 | 4개 언어 (한/영/중/일) |
| 예상 기간 | 14주 (Phase 1~7) |

---

## 12. 위험 요소

| 위험 | 영향 | 대응 |
|------|------|------|
| 건강정보고속도로 인증 절차 복잡 | 3개월+ | Phase 1~4 먼저 완료, Phase 6 병행 |
| CDA R2 파싱 복잡도 | 중 | 오픈소스 파서 활용 (hl7-cda-parser) |
| 환자 매칭 정확도 | 높음 | CI 우선, 실패 시 수동 매칭 UI |
| 오프라인 충돌 | 중 | Last-Write-Wins + 의사 확인 모달 |
| SMART 보안 취약점 | 높음 | PKCE 필수, 토큰 만료 1시간 |

---

## 13. 참고 자료

- [SMART on FHIR](https://smarthealthit.org/)
- [HL7 Korea 표준](https://www.hl7korea.or.kr/)
- [건강정보고속도로](https://www.hira.or.kr/dummy.do?pgmid=HIRAA020002000000)
- [FHIR R4 Transfer Summary](https://www.hl7.org/fhir/composition-example-transfer.html)
- [CDA R2 Implementation Guide (Korea)](https://www.hl7korea.or.kr/)
