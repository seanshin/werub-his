# EMR Phase C/D 기획서 — 템플릿 + PDF + 감사 + 문진표 + 검색

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:7681 model QuestionnaireToken · apps/api/src/modules/medical-record-search/medical-record-search.service.ts · 잔여: 없음

> **Summary**: EMR Phase A/B 완료 후 부가 기능 구현 — 진료기록 템플릿, 의무기록 PDF 출력, 열람 감사 강화, 문진표, 전문검색
>
> **Project**: Hospital RUN
> **Version**: 0.1.0
> **Author**: user
> **Date**: 2026-05-07
> **Status**: Draft
> **Prerequisites**: EMR Phase A/B 완료 (91% Match Rate, ProblemList/Allergy/DischargeSummary/Consent/Nursing)

---

## 1. Overview

### 1.1 배경

EMR Phase A/B에서 핵심 의무기록(문제목록, 알레르기, 퇴원요약, 동의서, 간호기록)을 구현했다.
Phase C/D는 **사용성과 규정 준수**를 강화하는 부가 기능을 추가한다.

### 1.2 기존 의존 모듈

| 모듈 | Phase C/D 활용 |
|------|---------------|
| **FormEngine** (FormSchema/FormSubmission) | EMR-06 템플릿, EMR-09 문진표의 기반 |
| **AuditLog** (AuditService/AuditInterceptor) | EMR-08 감사 강화의 기반 |
| **Encounter** (SOAP) | EMR-06 템플릿 연동, EMR-10 검색 대상 |
| **NursingNote/ProgressNote/DischargeSummary** | EMR-10 검색 대상 |

---

## 2. Scope

### 2.1 In Scope

| ID | Requirement | Priority | 의존성 |
|----|-------------|----------|--------|
| EMR-06 | **진료기록 템플릿** — 진료과별 SOAP 템플릿 + 매크로 | Medium | FormEngine, Encounter |
| EMR-07 | **의무기록 PDF 출력/사본발급** — PDF 생성 + 워터마크 + 발급이력 | Medium | Encounter, DischargeSummary |
| EMR-08 | **열람 감사 강화** — Break-the-Glass + 비정상 접근 탐지 | Medium | AuditLog |
| EMR-09 | **초진/재진 문진표** — QR 기반 환자 사전 입력 | Low | FormEngine |
| EMR-10 | **의무기록 검색** — PostgreSQL Full-text Search | Low | 전체 기록 모델 |

### 2.2 Out of Scope

- AI 음성인식 (STT) → 별도 Phase
- CDSS 고도화 → 별도 Phase
- 의무기록 장기 아카이빙 → 인프라 Phase

---

## 3. Functional Requirements Detail

### 3.1 EMR-06: 진료기록 템플릿

**기존 FormEngine 확장** — FormSchema를 활용하되 SOAP 진료 워크플로우에 통합

**데이터 모델:**
```
EncounterTemplate (진료기록 템플릿) — 신규
├── id
├── department: String               // 진료과 ("내과", "외과", "정형외과" 등)
├── name: String                     // "내과 초진 템플릿"
├── description: String?
├── soapSections: Json               // { subjective: [...fields], objective: [...], assessment: [...], plan: [...] }
├── version: String
├── isActive: Boolean
├── createdBy: String → User
├── createdAt, updatedAt

TextMacro (자주 쓰는 문구) — 신규
├── id
├── userId: String → User            // 개인 매크로
├── category: String                 // "S", "O", "A", "P", "간호", "공통"
├── shortcut: String                 // "htn" → 고혈압 관련 문구
├── content: String                  // 전체 문구
├── isShared: Boolean @default(false)// 공유 매크로 여부
├── createdAt
```

**기능:**
- 진료과별 SOAP 템플릿 CRUD (ADMIN/DOCTOR)
- 진료 시작 시 템플릿 선택 → 구조화 입력 필드 렌더링
- 템플릿 데이터 → Encounter SOAP 필드 + FormSubmission 동시 저장
- 텍스트 매크로: 단축키 입력 → 자동 확장 (개인/공유)
- 템플릿 버전관리

**RBAC:**
- ADMIN: 전체 CRUD
- DOCTOR: 본인 진료과 템플릿 조회 + 매크로 CRUD
- NURSE: 조회만

---

### 3.2 EMR-07: 의무기록 PDF 출력/사본발급

**데이터 모델:**
```
MedicalRecordCopy (사본발급 이력) — 신규
├── id
├── patientId → Patient
├── requestedBy: String              // 신청자명
├── requestorRelation: String        // 본인/배우자/직계/기관
├── purpose: String                  // 발급목적 (보험, 법적, 개인)
├── recordTypes: Json                // ["encounter", "discharge_summary", "lab_result"]
├── dateRange: Json?                 // { from, to }
├── issuedBy: String → User
├── issuedAt: DateTime
├── copyCount: Int
├── fee: Int                         // 원
├── notes: String?
├── createdAt
```

**기능:**
- PDF 생성 대상: 진료기록, 퇴원요약, 검사결과, 간호기록
- 병원 헤더 (로고, 병원명, 주소) 자동 삽입
- "사본" 워터마크 + 발급일시 + 발급자명
- 사본발급 이력 관리 + 수수료 자동 계산
- 의료법 시행규칙 준수 (환자 본인 확인)

**기술:**
- 백엔드: `puppeteer` 또는 `@react-pdf/renderer` (서버사이드)
- HTML 템플릿 → PDF 변환
- 워터마크: CSS `@page` 또는 Canvas overlay

**RBAC:**
- ADMIN: 전체 관리
- NURSE: 사본발급 실행
- DOCTOR: 본인 기록 조회

---

### 3.3 EMR-08: 열람 감사 강화

**기존 AuditLog 확장** — Break-the-Glass + 비정상 접근 탐지

**데이터 모델:**
```
BreakTheGlassAccess (긴급 접근 기록) — 신규
├── id
├── userId → User
├── patientId → Patient
├── reason: String                   // 접근 사유
├── accessedAt: DateTime
├── resourceType: String             // "encounter", "nursing_note" 등
├── resourceId: String?
├── reviewedBy: String? → User       // 관리자 검토
├── reviewedAt: DateTime?
├── isApproved: Boolean?

VipPatient (VIP 환자 지정) — 신규
├── patientId → Patient (unique)
├── designatedBy: String → User
├── reason: String?
├── createdAt
```

**기능:**
- **Break-the-Glass**: 비담당 환자 기록 접근 시 사유 입력 팝업 → 기록 저장
- **비정상 접근 탐지 규칙:**
  - 1시간 내 10명 이상 환자 열람 → 대량 열람 경고
  - 22:00~06:00 접근 → 비근무 시간 경고
  - VIP 환자 접근 → 즉시 알림
- **환자 열람 이력**: 환자 본인이 누가 기록을 열람했는지 API로 조회
- **감사 대시보드**: 접근 통계, 이상 패턴 차트

**RBAC:**
- ADMIN: 대시보드 + 검토 + VIP 지정
- DOCTOR/NURSE: Break-the-Glass 사유 입력 (본인 기록만)

---

### 3.4 EMR-09: 초진/재진 문진표

**기존 FormEngine 활용** — FormSchema에 문진표 유형 추가

**기능:**
- 문진표 FormSchema 시딩: 초진, 재진, 수술 전, 진료과별
- 환자용 공개 URL 생성 (`/questionnaire/:token`)
- QR 코드 생성 (대기실 포스터/키오스크)
- 모바일 반응형 폼 렌더링
- 작성 완료 → FormSubmission 저장 → SOAP Subjective 연동
- 예약 시 문진표 URL 자동 발송 (SMS/카카오 준비)

**데이터 모델:**
```
QuestionnaireToken (문진표 접근 토큰) — 신규
├── id
├── patientId → Patient
├── formSchemaId → FormSchema
├── appointmentId? → Appointment
├── token: String (unique)           // UUID 기반 URL 토큰
├── expiresAt: DateTime
├── completedAt: DateTime?
├── submissionId? → FormSubmission
├── createdAt
```

**RBAC:**
- ADMIN/NURSE: 토큰 생성
- 공개 URL: 인증 없이 접근 (토큰 기반)

---

### 3.5 EMR-10: 의무기록 검색

**기능:**
- PostgreSQL Full-text Search (`tsvector` + `GIN` 인덱스)
- 한국어 지원: `pg_bigm` 확장 (바이그램 인덱스)
- 검색 대상: Encounter(SOAP), ProgressNote, NursingNote, DischargeSummary
- 필터: 날짜범위, 진료과, 의사, 기록유형, 진단코드
- 결과 하이라이트: `ts_headline()` 함수
- 검색 API: `/api/v1/medical-records/search?q=...&type=...&dateFrom=...&dateTo=...`

**인프라 요구:**
- Docker Compose에 `pg_bigm` 확장 설치 필요
- 마이그레이션: `CREATE EXTENSION pg_bigm;`
- 인덱스: 각 텍스트 컬럼에 `bigm_gin_ops` GIN 인덱스

**RBAC:**
- DOCTOR/NURSE/ADMIN: 검색 가능
- 검색 시 AuditLog 기록 (EMR-08 연동)

---

## 4. 비기능 요구사항

| 항목 | 기준 |
|------|------|
| PDF 생성 | < 3초 (단일 문서) |
| 전문검색 | < 1초 (100만 건 기준) |
| Break-the-Glass 팝업 | < 200ms 응답 |
| 문진표 로딩 | < 1초 (모바일) |

---

## 5. 구현 우선순위

### Phase C (Medium Priority)

```
1. EMR-06: 진료기록 템플릿 — 2-3일
   ├── EncounterTemplate 모델 + CRUD
   ├── TextMacro 모델 + CRUD
   ├── 진료 작성 페이지 템플릿 선택 연동
   └── 기본 템플릿 3-5개 시딩

2. EMR-07: 의무기록 PDF 출력 — 2-3일
   ├── MedicalRecordCopy 모델 + API
   ├── PDF 생성 서비스 (puppeteer)
   ├── HTML 템플릿 (헤더, 워터마크)
   └── 사본발급 프론트엔드 페이지

3. EMR-08: 열람 감사 강화 — 2-3일
   ├── BreakTheGlassAccess 모델 + VipPatient 모델
   ├── Break-the-Glass 미들웨어
   ├── 비정상 접근 탐지 서비스
   └── 감사 대시보드 페이지
```

### Phase D (Low Priority)

```
4. EMR-09: 초진/재진 문진표 — 2-3일
   ├── QuestionnaireToken 모델
   ├── 공개 문진표 페이지 (인증 불필요)
   ├── QR 코드 생성
   └── SOAP Subjective 연동

5. EMR-10: 의무기록 검색 — 2-3일
   ├── pg_bigm 확장 설치
   ├── GIN 인덱스 생성 마이그레이션
   ├── 검색 API + 서비스
   └── 검색 UI 페이지
```

---

## 6. 성공 기준

| 항목 | 기준 |
|------|------|
| 진료기록 템플릿 | 3개 이상 진료과별 템플릿 등록 + 진료 시 사용 가능 |
| PDF 출력 | 진료기록, 퇴원요약 2종 이상 PDF 생성 가능 |
| Break-the-Glass | 비담당 환자 접근 시 100% 사유 입력 강제 |
| 문진표 | QR 코드로 환자 모바일 입력 → SOAP 연동 |
| 의무기록 검색 | 한국어 키워드로 1초 이내 검색 결과 반환 |

---

## 7. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-05-07 | user | 초기 기획서 작성 (EMR-06~10) |
