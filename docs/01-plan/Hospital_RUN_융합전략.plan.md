# Hospital RUN 오픈소스 융합 전략 기획서

> **Summary**: HospitalRun + EtherCIS/EHRBase + Medplum + OpenMRS O3 — 4대 오픈소스 HIS의 핵심 아키텍처를 한국형 Enterprise HIS로 융합하는 전략
>
> **Project**: Hospital RUN
> **Version**: 1.0.0
> **Author**: user
> **Date**: 2026-05-07
> **Status**: Final

---

## 1. 프로젝트 포지셔닝

### 1.1 Hospital RUN이란?

Hospital RUN은 4대 오픈소스 HIS의 **핵심 아키텍처**를 선별 융합하고, **한국 의료 규정**에 완전히 맞춘 차세대 Enterprise 병원정보시스템이다.

```
┌─────────────────────────────────────────────────────────────┐
│                    Hospital RUN                              │
│         한국형 Enterprise HIS (Next-Gen)                      │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │HospitalRun│ │EtherCIS/ │ │ Medplum  │ │OpenMRS O3│       │
│  │  (UI/UX)  │ │ EHRBase  │ │ (FHIR)   │ │(FormEng) │       │
│  │           │ │(openEHR) │ │          │ │          │       │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘       │
│        │            │            │            │              │
│        ▼            ▼            ▼            ▼              │
│  ┌──────────────────────────────────────────────────┐       │
│  │         Korean Medical Standards Layer            │       │
│  │  KCD-8 | EDI | DUR | HIRA | KTAS | EMR인증       │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 왜 융합인가?

| 오픈소스 | 강점 | 한계 | Hospital RUN의 선택적 융합 |
|---------|------|------|--------------------------|
| **HospitalRun** | 직관적 UI, 오프라인 지원 | 개발 중단(archived), 한국 규정 미지원 | UI/UX 철학 + PWA 오프라인 전략 채택 |
| **EtherCIS/EHRBase** | openEHR 임상데이터 유연성 | 배포 복잡, REST API 부족 | Bi-temporal 패턴 + 유연한 EMR 구조 채택 |
| **Medplum** | FHIR R4 네이티브, TypeScript | SaaS 종속, 한국 표준 부재 | FHIR API 설계 + Bots 자동화 + Monorepo 채택 |
| **OpenMRS O3** | JSON Form Engine, 확장성 | Java 기반, 복잡한 설치 | Form Engine + Extension/Slot 플러그인 채택 |

**단독 채택하지 않고 융합하는 이유:**
- 한국 의료 규정 100% 준수가 필수 (KCD, EDI, DUR, HIRA, EMR인증)
- 기존 오픈소스는 한국 시장을 타겟하지 않음
- 각 프로젝트의 "최선의 부분"만 조합하면 더 나은 시스템 구축 가능

---

## 2. 4대 오픈소스별 융합 상세

### 2.1 HospitalRun → UI/UX + 오프라인 전략

| 채택 요소 | 구현 현황 | 적용 위치 |
|-----------|----------|----------|
| **환자 중심 UI 워크플로우** | ✅ 구현 완료 | 환자 등록 → 예약 → 접수 → 진료 → 수납 |
| **직관적 대시보드** | ✅ 구현 완료 | `/dashboard` — 실시간 통계, 부서별 현황 |
| **반응형 모바일 지원** | ✅ Tailwind + shadcn/ui | 전체 프론트엔드 |
| **오프라인 PWA** | ⏳ Phase 5+ 예정 | RxDB + Service Worker 동기화 |
| **간호 기록 UI 패턴** | ✅ 구현 완료 | Focus Charting DAR, I/O 기록, MAR |

**HospitalRun과의 차별점:**
```
HospitalRun (원본)              Hospital RUN (융합)
─────────────────────          ─────────────────────
Ember.js + CouchDB             Next.js 15 + PostgreSQL
오프라인 우선                    온라인 우선 + 오프라인 대비
영문 단일 언어                   한국어 네이티브 + 다국어
기본 임상 기능                   57개 모듈 Enterprise급
FHIR 미지원                     FHIR R4 + 한국 표준 완전 지원
개발 중단 (archived)            활발히 개발 중
```

---

### 2.2 EtherCIS/EHRBase → Bi-temporal + openEHR 패턴

| 채택 요소 | 구현 현황 | 적용 위치 |
|-----------|----------|----------|
| **Bi-temporal 데이터 관리** | ✅ 구현 완료 | `Patient.validFrom/validTo`, `PatientHistory` |
| **임상 데이터 버전 관리** | ✅ 구현 완료 | `Encounter.DRAFT→SIGNED→AMENDED` 이력 추적 |
| **유연한 EMR 구조** | ✅ 구현 완료 | `FormSchema` (JSON 기반 동적 폼) + `additionalData` (JsonB) |
| **openEHR Archetype 패턴** | 🔄 변형 적용 | JSON Schema 기반 FormEngine으로 대체 |
| **감사 추적 (Audit Trail)** | ✅ 구현 완료 | `AuditLog` + `AuditInterceptor` + Break-the-Glass |

**EtherCIS 패턴의 한국형 적용:**
```
EtherCIS (원본)                 Hospital RUN (융합)
─────────────────────          ─────────────────────
openEHR ADL 아키타입             JSON Schema (FormEngine)
PostgreSQL + AQL 쿼리           Prisma ORM + PostgreSQL
독립 CDR 서버                    NestJS 내장 모듈
XML 기반 Composition            JsonB 기반 FormSubmission
Java/Kotlin                     TypeScript (NestJS + Next.js)
```

**핵심: Bi-temporal 패턴이 한국 EMR 인증에 필수**
```sql
-- EtherCIS 스타일 bi-temporal 쿼리
-- "2026년 3월 시점에 유효했던 환자 정보"
SELECT * FROM patients
WHERE valid_from <= '2026-03-01'
  AND (valid_to IS NULL OR valid_to > '2026-03-01');
```

---

### 2.3 Medplum → FHIR R4 + Bots + TypeScript

| 채택 요소 | 구현 현황 | 적용 위치 |
|-----------|----------|----------|
| **FHIR R4 API** | ✅ 구현 완료 | `/fhir/R4/` — Patient, Encounter, MedicationRequest, Condition, Observation |
| **CapabilityStatement** | ✅ 구현 완료 | `/fhir/R4/metadata` — SMART-on-FHIR 보안 모델 |
| **FHIR Bundle 검색** | ✅ 구현 완료 | Bundle-type searchset 응답 |
| **Bots 워크플로우** | ✅ 구현 완료 | `/modules/bots/` — 리소스 변경 시 자동 트리거 |
| **TypeScript Monorepo** | ✅ 구현 완료 | Turborepo + npm workspaces |
| **HIE 진료정보교류** | 🔄 MVP 단계 | `/modules/hie/` — FHIR Bundle 송수신 |

**Medplum과의 아키텍처 비교:**
```
Medplum (원본)                  Hospital RUN (융합)
─────────────────────          ─────────────────────
FHIR-only 데이터 모델            FHIR(외부) + 도메인(내부) 이중 모델
React + Medplum SDK             Next.js 15 + TanStack Query
SaaS 클라우드 전용               온프레미스 + 클라우드 하이브리드
미국 의료 규정 (HIPAA)           한국 의료 규정 (의료법, 개보법)
SMART-on-FHIR 인증              Custom JWT + FHIR 연동
```

**이중 모델 전략 (핵심 설계 결정):**
```
                  ┌──────────────┐
                  │  외부 시스템   │
                  │ (건강정보교류)  │
                  └──────┬───────┘
                         │ FHIR R4
                  ┌──────▼───────┐
                  │ FHIR Mapper  │  ← Medplum 패턴
                  │ (변환 계층)    │
                  └──────┬───────┘
                         │
    ┌────────────────────▼────────────────────┐
    │         Hospital RUN 내부 도메인          │
    │                                          │
    │  Patient ←→ FHIR Patient                 │
    │  Encounter ←→ FHIR Encounter             │
    │  Prescription ←→ FHIR MedicationRequest  │
    │  ProblemList ←→ FHIR Condition           │
    │  Allergy ←→ FHIR AllergyIntolerance      │
    │                                          │
    │  + 한국 전용: KCD, EDI, DUR, HIRA         │
    └──────────────────────────────────────────┘
```

---

### 2.4 OpenMRS O3 → Form Engine + 확장성

| 채택 요소 | 구현 현황 | 적용 위치 |
|-----------|----------|----------|
| **JSON Form Engine** | ✅ 구현 완료 | `FormSchema` + `FormSubmission` — 동적 의료 폼 |
| **Extension/Slot 시스템** | ✅ 구현 완료 | `/modules/extension/` — 플러그인 아키텍처 |
| **런타임 설정** | ✅ 구현 완료 | `/modules/config/` — 병원별 커스터마이징 |
| **진료과별 템플릿** | ✅ 구현 완료 | `EncounterTemplate` + `soapSections` (JsonB) |
| **문진표 시스템** | ✅ 구현 완료 | `QuestionnaireToken` — 토큰 기반 공개 폼 |

**O3 Form Engine의 한국형 확장:**
```json
// OpenMRS O3 스타일 JSON Form Schema
{
  "name": "내과 초진 템플릿",
  "version": "1.0",
  "sections": {
    "subjective": [
      { "type": "textarea", "label": "주호소", "key": "chiefComplaint" },
      { "type": "checklist", "label": "ROS", "key": "ros",
        "options": ["발열", "두통", "흉통", "복통", "호흡곤란"] }
    ],
    "objective": [
      { "type": "vitals", "label": "활력징후" },
      { "type": "textarea", "label": "신체검사 소견", "key": "physicalExam" }
    ],
    "assessment": [
      { "type": "diagnosis-search", "label": "진단", "codeSystem": "KCD-8" }
    ],
    "plan": [
      { "type": "prescription", "label": "처방" },
      { "type": "textarea", "label": "치료계획", "key": "treatmentPlan" }
    ]
  }
}
```

---

## 3. 한국 의료 규정 적합 계층

### 3.1 오픈소스에 없는 한국 전용 기능

| 기능 | 한국 규정 | 구현 현황 |
|------|----------|----------|
| **KCD-8 진단코드** | 한국표준질병분류 (보건복지부) | ✅ `DiagnosisCode` + ICD-10/11 매핑 |
| **EDI 수가코드** | 건강보험 행위/치료재료 (건보공단) | ✅ `ProcedureCode` + 보험 적용 여부 |
| **DUR 실시간 점검** | 의약품 안전사용 (HIRA) | ⚠️ 원내 룰 55건(상호작용·연령금기·BEERS 등)·알레르기 연동. 🔴 **2026-08-18 실측: 55룰 중 43룰이 개통 이래 매칭 0**(룰은 한글·약품 마스터는 영문) — 차단 룰 21건 전량 사멸이었고 당일 회수(사멸 4/55). **심평원 실시간 DUR 연동은 미구현**(원내 룰만) |
| **HIRA 청구** | 건강보험 심사평가원 | ✅ `Claim` 모델 + 청구 워크플로우 |
| **KTAS 트리아지** | 한국형 응급환자 분류 | ✅ 5단계 긴급도 (Level 1~5) |
| **EMR 인증제** | 보건복지부 2주기 59개 지표 | ✅ `EmrCertService` 자가 점검 |
| **보험 유형** | 국민건강보험 다유형 | ✅ NHI/의료급여/산재/자보/자비 |
| **환자명 체계** | familyName/givenName (FHIR 호환) | ✅ ADR-002 |
| **주민번호 미수집** | 개인정보보호법 | ✅ 생년월일+성별 대체 (ADR-003) |

### 3.2 규정 준수 아키텍처

```
┌─────────────────────────────────────────────────┐
│              Hospital RUN 규정 준수 계층           │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ 의료법      │  │ 개인정보보호법│  │ EMR 인증제  │ │
│  │            │  │            │  │            │ │
│  │• 의무기록   │  │• 최소수집   │  │• 59개 지표  │ │
│  │  보존 10년  │  │• 접근통제   │  │• 기능/보안/ │ │
│  │• 사본발급   │  │• 열람권     │  │  상호운용   │ │
│  │• 전자서명   │  │• 파기      │  │            │ │
│  └────────────┘  └────────────┘  └────────────┘ │
│                      │                           │
│  구현: AuditLog + BTG Guard + AES-256 + RBAC     │
│        + MedicalRecordCopy + ConsentForm          │
└─────────────────────────────────────────────────┘
```

---

## 4. 시스템 아키텍처 융합 맵

### 4.1 전체 모듈 구성 (57개)

```
Hospital RUN — 57개 NestJS 모듈
═══════════════════════════════════════════════════

[임상 Core] 12개 ─── HospitalRun UI + Medplum FHIR
├── Patient (환자)
├── Schedule (예약)
├── Encounter (진료/SOAP)
├── Prescription + DUR (처방+안전점검)
├── Order/OCS (처방전달)
├── Pharmacy (약국)
├── Lab (검사실)
├── Imaging + PACS (영상)
├── Surgery (수술)
├── Emergency/KTAS (응급)
├── Inpatient + Admission (입원)
└── Nursing (간호기록)

[EMR 의무기록] 10개 ─── EtherCIS 패턴 + O3 FormEngine
├── ProblemList (문제목록)
├── Allergy (알레르기/ADR)
├── DischargeSummary (퇴원요약)
├── Consent + ConsentTemplate (동의서)
├── EncounterTemplate (진료템플릿)
├── TextMacro (텍스트 매크로)
├── MedicalRecordCopy + PDF (사본발급)
├── AuditEnhanced + BTG (감사강화)
├── Questionnaire (문진표)
└── MedicalRecordSearch (의무기록검색)

[행정/관리] 11개 ─── 한국형 병원 운영
├── Billing + BillingAdvanced (수납)
├── Claim (HIRA 청구)
├── Bed + Ward (병상관리)
├── HR + Staff (인사관리)
├── Inventory + CSSD (자재/멸균)
├── Nutrition (급양)
├── Equipment (의료장비)
└── Education (직원교육)

[플랫폼] 14개 ─── Medplum + O3 아키텍처
├── Auth (JWT + RBAC)
├── User (사용자)
├── FHIR + FhirFull (FHIR R4 API)
├── HIE (진료정보교류)
├── FormEngine (JSON 동적폼)
├── Bots (워크플로우 자동화)
├── Extension (플러그인)
├── ConfigRuntime (런타임 설정)
├── CodeMaster (KCD/EDI/약품)
├── EmrCert (EMR 인증)
├── Dashboard (대시보드)
├── Audit (감사로그)
├── ClinicSchedule + WaitingQueue (진료표/대기)
└── ClinicIntegration (외부연동)
```

### 4.2 데이터 흐름

```
환자 내원
    │
    ▼
[예약/접수] ──→ [대기열] ──→ [진료 시작]
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              [SOAP 작성]  [처방 입력]  [검사 오더]
              (템플릿 선택)  (DUR 점검)   (OCS 전달)
                    │           │           │
                    ▼           ▼           ▼
              [문제목록]    [약국 조제]   [검사실]
              [알레르기]    [MAR 투약]   [결과 입력]
                    │           │           │
                    └───────────┼───────────┘
                                ▼
                          [진료 완료/서명]
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              [수납/청구]   [FHIR 변환]  [감사 로깅]
              (HIRA 청구)   (진료정보교류)  (BTG 체크)
```

---

## 5. 기술 스택 융합 맵

| 영역 | HospitalRun | EtherCIS | Medplum | OpenMRS O3 | **Hospital RUN** |
|------|-------------|----------|---------|------------|-----------------|
| **Frontend** | Ember.js | - | React | React | **Next.js 15 + Tailwind + shadcn/ui** |
| **Backend** | Node.js | Java | Node.js | Java | **NestJS (TypeScript)** |
| **Database** | CouchDB | PostgreSQL | PostgreSQL | MySQL | **PostgreSQL 16** |
| **ORM** | PouchDB | JDBC | Prisma | Hibernate | **Prisma ORM** |
| **Cache** | - | - | Redis | - | **Redis 7** |
| **API** | REST | openEHR AQL | FHIR R4 | REST | **REST + FHIR R4** |
| **Form** | Handlebars | - | - | JSON Schema | **JSON Form Engine** |
| **Auth** | OAuth | - | SMART-on-FHIR | Spring Security | **JWT + RBAC** |
| **Monorepo** | - | - | Turborepo | - | **Turborepo + npm workspaces** |
| **Standards** | - | openEHR | HL7 FHIR | HL7 FHIR | **FHIR R4 + KCD + EDI + DUR** |

---

## 6. 융합 로드맵

### Phase 1~2 (완료): 핵심 임상 + EMR

```
✅ HospitalRun UI 패턴 → 환자/예약/진료 워크플로우
✅ EtherCIS Bi-temporal → Patient 이력 관리
✅ Medplum FHIR → Patient/Encounter/MedicationRequest/Condition/Observation
✅ O3 Form Engine → 동적 폼 + 진료 템플릿
✅ 한국 표준 → KCD-8, EDI, DUR, HIRA, KTAS, EMR인증
✅ EMR 의무기록 10개 모듈 전부 구현
```

### Phase 3 (다음): 고도화

```
⏳ Medplum Bots 고도화 → 이벤트 기반 자동화 (처방 시 자동 알림 등)
⏳ FHIR R4 완전 지원 → Practitioner, Organization, AllergyIntolerance, DocumentReference
⏳ HIE 실연동 → 건강정보 고속도로 API 연결
⏳ HospitalRun PWA → RxDB 오프라인 동기화
⏳ O3 Extension Slot → 타 병원 커스텀 UI 플러그인
```

### Phase 4+ (미래): Enterprise

```
⏳ EHRBase openEHR → AQL 쿼리 지원 (임상 연구용)
⏳ Medplum Subscriptions → FHIR Subscription R5 (실시간 이벤트)
⏳ AI/ML → CDSS (임상의사결정지원), STT (음성인식)
⏳ Kubernetes → 마이크로서비스 전환
⏳ SMART-on-FHIR → 써드파티 앱 생태계
```

---

## 7. 경쟁 우위

### 7.1 vs 기존 한국 HIS 벤더

| 항목 | 기존 한국 HIS | Hospital RUN |
|------|-------------|-------------|
| 기술 스택 | C/C++, Java, Delphi | TypeScript (풀스택) |
| 아키텍처 | 모놀리식 | 모듈러 모놀리스 → 마이크로서비스 |
| 표준 | 자체 프로토콜 | FHIR R4 + openEHR 패턴 |
| 커스터마이징 | 소스코드 수정 | JSON 설정 + 플러그인 |
| 오프라인 | 미지원 | PWA 오프라인 지원 (Phase 3+) |
| 개발 속도 | 느림 (레거시) | AI 네이티브 개발 (PDCA) |

### 7.2 vs 해외 오픈소스 HIS

| 항목 | 해외 오픈소스 | Hospital RUN |
|------|-------------|-------------|
| 한국 규정 | 미지원 | KCD/EDI/DUR/HIRA/EMR인증 100% |
| 한국어 | 영문 기반 | 한국어 네이티브 |
| 보험 | 미국(HIPAA) | 국민건강보험 5유형 |
| 처방 안전 | 기본 | DUR 22규칙 + 알레르기 연동 |
| 진단코드 | ICD-10 | KCD-8 + ICD-10/11 교차매핑 |

---

## 8. 성공 지표

| 지표 | 목표 |
|------|------|
| 모듈 수 | 57개 (현재 달성) |
| FHIR 리소스 | 5개 구현 → 10개 목표 |
| EMR 인증 지표 | 59개 중 55개+ PASS |
| API 엔드포인트 | 200+ |
| 코드 품질 | TypeScript 0 에러 |
| 한국 표준 준수 | KCD/EDI/DUR/HIRA/KTAS 100% |

---

## 9. 결론

Hospital RUN은 단일 오픈소스를 포크하거나 래핑한 것이 아니라, **4대 오픈소스 HIS의 검증된 아키텍처 패턴을 선별 융합**하고 **한국 의료 규정 계층을 완전히 덮어씌운** 새로운 시스템이다.

```
HospitalRun의 UX + EtherCIS의 데이터 유연성
    + Medplum의 FHIR 표준 + OpenMRS의 확장성
    + 한국 의료 규정 100% 준수
    ─────────────────────────────
    = Hospital RUN (차세대 한국형 Enterprise HIS)
```

이 융합 전략으로 기존 한국 HIS 벤더의 레거시 한계와 해외 오픈소스의 한국 규정 부재를 동시에 해결한다.

---

## 10. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-07 | user | 오픈소스 융합 전략 기획서 초판 |
