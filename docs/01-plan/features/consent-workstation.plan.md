# 동의서 워크스테이션 기획서 v1.0

> **작성일**: 2026-06-05
> **우선순위**: P0 (의료법 제24조의2 설명·동의 + 대면 서명 워크플로우)
> **전제**: 기존 ConsentForm/ConsentTemplate/DocumentSignature + consent 모듈 + SignatureModal 재사용
> **핵심 신규**: 직원 워크스테이션 + **태블릿/PC 대면 서명 핸드오프** + 필기 서명패드 + 보호자 서명
> **관련 기존 기획**: [consent-protocol](consent-protocol.plan.md)(SSE 실시간), [consent-template-v2](consent-template-v2.plan.md)(템플릿 빌더), [initial-consent-protocol](initial-consent-protocol.plan.md)(법정 10종)

---

## 1. 기획 배경

### 1.1 요구사항 (요지)
의료진이 환자 본인·보호자에게 **필요한 내용을 설명**하고, 동의서에 **관련 내용이 서술**되어 있으며, 이에 대해 **태블릿이나 PC에서 동의(서명)**하는 기능이 필요하다. 환자·보호자에 대한 **동의서 요청(생성)은 의료진·접수처·원무과 직원**이 수행한다.

### 1.2 현재 한계
- HIS에 동의서 목록/생성 화면(`/consent`)은 있으나, **현장 대면 설명→서명 핸드오프** 워크플로우가 없다.
- 환자/보호자가 **태블릿·PC에서 직접 읽고 서명**하는 전용 화면이 없다(전자서명 모달은 직원 인증용).
- **필기(서명패드) 입력** 미구현 — 현재 PIN/생체/블록체인 전자서명만.
- **보호자 서명** 경로가 명확하지 않다(증인 필드만 존재).

### 1.3 목표
```
직원(의료진/접수/원무과)이 동의서를 요청·생성하고 설명한 뒤,
환자/보호자가 태블릿 또는 PC에서 동의서 전문을 읽고 직접 서명하여,
법적 효력이 있는 전자 동의서를 즉시 완성한다.
```

---

## 2. 기존 자산 재사용 vs 신규 구현

### 2.1 재사용 (이미 구현됨, 그대로 활용)
| 자산 | 위치 | 활용 |
|------|------|------|
| ConsentForm 모델(8유형·다중서명·상태) | schema.prisma | 동의서 본체 |
| ConsentTemplate(버전·변수·컴포넌트) | consent-template 모듈 | 동의서 내용 템플릿 |
| consent API(생성/조회/sign/doctor-sign/witness-sign/PDF/revoke) | consent.controller | 요청·서명·출력 |
| 다중 서명 순서제어 `SIGN_REQUIREMENTS` | consent.service | 환자→의사→증인 순서 |
| DocumentSignature/SignedDocument/BlockchainAnchor | schema.prisma | 서명 무결성·블록체인 앵커 |
| SignatureModal/SmartSignButton/SignatureBadge | components/signature | 직원 전자서명 |
| PatientNotification + SSE 기반 알림 | notification | 요청/완료 알림 |
| consent.created 이벤트 | consent.service | 실시간 트리거 |

### 2.2 신규 구현 (이 기획서 범위)
| # | 항목 | 규모 |
|---|------|:----:|
| N-1 | **동의서 워크스테이션 페이지** (`/workstation/consent`) — 직원이 요청·설명·진행 관리 | 대 |
| N-2 | **동의서 요청 생성 패널** — 환자 선택 → 템플릿 선택 → 설명 입력 → (필요 시 변수 입력) → 생성 | 중 |
| N-3 | **태블릿/PC 대면 서명 핸드오프** — 1회용 서명 세션(토큰/URL) → 전용 서명 화면 | 대 |
| N-4 | **서명패드(필기) 컴포넌트** — 캔버스 기반 손/펜 서명 입력 | 중 |
| N-5 | **보호자 서명 경로** — 보호자 신원·관계·법적근거 + 서명 | 중 |
| N-6 | **SSE 실시간 반영** — 환자/보호자 서명 → 워크스테이션 즉시 갱신 | 중 |
| N-7 | 동의서 큐/통계 API (`/consent/workstation/queue`, 진행현황) | 소 |
| N-8 | 스키마 보강(ConsentForm 확장 + ConsentSignSession) | 소 |

> 환자 포털 동의서 페이지(`/portal/consents`)와 모바일 서명은 [consent-protocol](consent-protocol.plan.md) 범위로 분리(원격 서명). 본 기획은 **현장 대면 + 태블릿/PC 핸드오프**가 핵심.

---

## 3. 사용자 역할

| 역할 | 권한 | 행위 |
|------|------|------|
| **의료진(의사)** | 요청·설명·의사 서명 | 동의서 생성, 위험·대안 설명, 의사 서명, 철회 |
| **간호사** | 요청·증인·간호 서명 | 동의서 생성, 증인 서명, 수혈 등 간호 서명 |
| **접수처/원무과** | 요청(법정·일반) | 접수 동의서 요청, 태블릿 서명 안내, 출력 |
| **환자 본인** | 서명 | 태블릿/PC에서 읽고 서명 |
| **보호자** | 대리·동석 서명 | 미성년/의식불명/위임 시 서명(관계·근거 기록) |
| **ADMIN** | 전체 | 템플릿 관리, 감사 |

---

## 4. 핵심 워크플로우

### 4.1 대면 서명 (태블릿 핸드오프 — 주 시나리오)
```
직원(워크스테이션, PC)                     환자/보호자(태블릿)
  │
  ├─ 환자 검색·선택
  ├─ 동의서 템플릿 선택 (수술/마취/수혈/시술…)
  ├─ 변수 입력(수술명·위험·대안 등) + 설명 메모
  ├─ [동의서 생성]  → ConsentForm(PENDING)
  │
  ├─ [태블릿으로 서명 받기]
  │     → ConsentSignSession 생성(1회용 토큰, 5분 TTL)
  │     → 태블릿에 URL/QR 표시 또는 같은 기기 서명모드 전환
  │                                         │
  │                              ┌──────────▼───────────┐
  │                              │ 동의서 전문 표시        │
  │                              │ (스크롤·확대)          │
  │                              │ 서명자: ●본인 ○보호자   │
  │                              │ [내용 확인] 체크        │
  │                              │ ✍️ 서명패드(필기)       │
  │                              │ [동의·서명]            │
  │                              └──────────┬───────────┘
  │   SSE: consent.patient_signed  ◀────────┘
  ├─ 워크스테이션 실시간 "환자 서명됨"
  │
  ├─ [의사 서명] (전자서명 모달, PIN/생체)
  ├─ [증인 서명] (필요 시)
  │
  ▼
동의서 완료(SIGNED) → 블록체인 앵커 → PDF 보존(의료법 제22조)
```

### 4.2 보호자 서명 (미성년/의식불명/위임)
```
직원: 서명자 = 보호자 선택 → 관계(부모/배우자/자녀/법정대리인) + 법적근거 입력
태블릿: 보호자 신원 확인 안내 → 보호자가 서명패드 서명
기록: ConsentForm.guardianName/guardianRelation/legalBasis + 보호자 서명
```

### 4.3 원격 서명(포털) — 보조 시나리오
직원이 [포털로 요청] → PatientNotification + 포털 동의 목록 노출 → 환자가 본인 기기에서 서명(기존 consent-protocol 흐름 재사용).

---

## 5. 데이터 모델 (보강)

### 5.1 ConsentForm 확장 (additive)
```prisma
model ConsentForm {
  // ... 기존 필드 유지 ...
  requestedBy     String?  @map("requested_by") @db.Uuid     // 요청 직원(의료진/접수/원무)
  explanation     String?  @db.Text                          // 설명 메모(구두 설명 요지)
  signMode        String?  @map("sign_mode") @db.VarChar(20) // TABLET, PC, PORTAL, PAPER
  signerType      String?  @map("signer_type") @db.VarChar(20) // PATIENT, GUARDIAN
  guardianName    String?  @map("guardian_name") @db.VarChar(100)
  guardianRelation String? @map("guardian_relation") @db.VarChar(30)
  guardianLegalBasis String? @map("guardian_legal_basis") @db.VarChar(50) // MINOR/INCAPACITATED/POA
  patientSignatureImage String? @map("patient_signature_image") @db.Text // 서명패드 PNG(base64)
}
```

### 5.2 ConsentSignSession (신규 — 태블릿/PC 핸드오프)
```prisma
model ConsentSignSession {
  id          String   @id @default(uuid()) @db.Uuid
  consentId   String   @map("consent_id") @db.Uuid
  token       String   @unique @db.VarChar(64)          // 1회용 서명 토큰
  signMode    String   @db.VarChar(20)                  // TABLET, PC
  signerType  String   @db.VarChar(20)                  // PATIENT, GUARDIAN
  status      String   @default("OPEN") @db.VarChar(20) // OPEN, SIGNED, EXPIRED, CANCELLED
  createdBy   String   @map("created_by") @db.Uuid
  expiresAt   DateTime @map("expires_at") @db.Timestamptz()  // 5분 TTL
  signedAt    DateTime? @map("signed_at") @db.Timestamptz()
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  @@index([token])
  @@index([consentId, status])
  @@map("consent_sign_sessions")
}
```

---

## 6. API 설계 (신규)

| Method | Endpoint | 역할 | 설명 |
|--------|----------|------|------|
| GET | `/api/v1/consent/workstation/queue` | 직원 | 진행 중 동의서 큐(상태/유형/환자 필터) |
| GET | `/api/v1/consent/workstation/stats` | 직원 | 오늘 요청/대기/완료/만료 통계 |
| POST | `/api/v1/consent/:id/sign-session` | 직원 | 태블릿/PC 서명 세션 생성(토큰 반환) |
| GET | `/api/v1/consent/sign-session/:token` | 공개(토큰) | 서명 화면용 동의서 전문 + 메타 |
| POST | `/api/v1/consent/sign-session/:token/submit` | 공개(토큰) | 서명패드 이미지 + 서명자(본인/보호자) 제출 |
| POST | `/api/v1/consent/sign-session/:token/cancel` | 직원 | 세션 취소 |

> 기존 재사용: `POST /consent`(생성), `PATCH /consent/:id/doctor-sign`·`witness-sign`, `GET /consent/:id/generate-pdf`, `consent-templates` 전체.

---

## 7. 화면 설계

### 7.1 동의서 워크스테이션 (`/workstation/consent`, 직원 PC)
```
┌──────────────────────────────────────────────────────────┐
│ 동의서 워크스테이션                  [+ 동의서 요청]        │
│ 오늘: 요청 12 · 서명대기 5 · 완료 7 · 만료 1               │
│ [전체][서명대기][직원서명대기][완료]                       │
│ ┌─ 서명 대기 ──────────────────────────────────────────┐ │
│ │ 🔴 박철수 · 수술동의서 · 환자서명 대기 · 3분 전       │ │
│ │    [태블릿으로 서명] [같은화면 서명] [상세]           │ │
│ │ 🟡 김영희 · 수혈동의서 · 의사서명 대기                │ │
│ │    [의사 서명] [증인 서명]                            │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 7.2 동의서 요청 패널
```
환자 검색 → 선택  |  서명자: ● 본인  ○ 보호자(관계·근거)
템플릿 선택: [수술][마취][수혈][시술][DNR][연구][일반]
변수 입력: 수술명·예상위험·대안·마취방법 …(템플릿 변수)
설명 메모: "○○ 수술의 위험과 대안을 구두 설명함"
[동의서 생성]
```

### 7.3 태블릿/PC 서명 화면 (`/consent-sign/[token]`, 풀스크린)
```
┌──────────────────────────────────────────────────────────┐
│  위루비병원 · 수술 동의서                          │
│  ┌─ 동의서 전문 (스크롤) ──────────────────────────────┐ │
│  │ 환자: 박철수 (P2026-0003)                            │ │
│  │ 수술명: … / 위험: … / 대안: … / 담당의: …            │ │
│  └──────────────────────────────────────────────────────┘ │
│  서명자: ● 본인  ○ 보호자(박OO·배우자)                    │
│  ☐ 위 내용을 충분히 설명받고 이해하였습니다               │
│  ┌─ ✍️ 아래에 서명해주세요 ────────────────────────────┐ │
│  │            (서명패드 캔버스)                  [지우기] │ │
│  └──────────────────────────────────────────────────────┘ │
│  [동의하고 서명 제출]                                     │
│  ⚖️ 의료법 제24조의2 설명·동의 · 제22조 10년 보존         │
└──────────────────────────────────────────────────────────┘
```

---

## 8. 법적 근거
| 항목 | 근거 |
|------|------|
| 설명·동의 의무 | 의료법 제24조의2(의료행위에 관한 설명) |
| 수술/마취/수혈 별도 동의 | 의료법 시행규칙, 혈액관리법 제11조 |
| 의무기록 보존(10년) | 의료법 제22조·시행규칙 제15조 |
| 전자서명 효력 | 전자서명법, 전자문서법 |
| 보호자 대리 동의 | 민법 제911조(친권), 의료법 제24조의2 |

---

## 9. 구현 우선순위
| Phase | 작업 | 규모 |
|:-----:|------|:----:|
| 1 | 스키마 보강(ConsentForm 확장 + ConsentSignSession) | 소 |
| 2 | 워크스테이션 큐/통계 API + 요청 생성(기존 consent API 연계) | 중 |
| 3 | 워크스테이션 페이지(요청 패널 + 큐 + 액션) | 대 |
| 4 | 서명 세션 API(생성/조회/제출/취소) + 서명패드 컴포넌트 | 대 |
| 5 | 태블릿/PC 서명 화면(`/consent-sign/[token]`) + 보호자 서명 | 대 |
| 6 | SSE 실시간 반영(서명→워크스테이션) + 알림 리스너 | 중 |
| 7 | 의사/증인 서명 연계(기존 모달) + 완료 PDF/블록체인 | 소 |
| 8 | 원무과 접수 연계(법정 10종 출력/포털 요청) | 중 |

---

## 10. 성공 지표
| 지표 | 목표 |
|------|------|
| 종이 동의서 대체율 | 80%+ |
| 동의서 1건 완료 시간 | 5분 이하 |
| 서명 누락(미완료) 비율 | 5% 이하 |
| 태블릿 서명 성공률 | 95%+ |
| 의무기록 보존(서명+PDF+블록체인) | 100% |

---

## 11. 리스크·결정 필요 (PM 체크리스트)
- [ ] 태블릿 기기 운영 방식: 전용 키오스크 vs 직원 보유 태블릿 핸드오프
- [ ] 서명 세션 인증: 토큰 URL vs QR vs 같은-기기 모드(키오스크 잠금)
- [ ] 서명패드 vs 전자서명(블록체인) 병행/선택 정책
- [ ] 보호자 신원 확인 수준(신분증 스캔 여부)
- [ ] 오프라인(네트워크 단절) 시 서명 임시저장 정책
- [ ] 기존 `/consent` 화면과 워크스테이션 역할 분리/통합

---

## 변경 이력
| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-06-05 | 초안 — 직원 워크스테이션 + 태블릿/PC 대면 서명 핸드오프 + 서명패드 + 보호자 서명. 기존 consent 인프라 재사용 매핑 |
