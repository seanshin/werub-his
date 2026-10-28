# EMR Phase C/D 설계서

> **Version**: 0.1
> **Created**: 2026-05-07
> **Author**: user
> **Status**: Draft
> **Planning Doc**: [emr-phase-cd.plan.md](../../01-plan/features/emr-phase-cd.plan.md)
> **Phase A/B Design**: [emr-enhancement.design.md](./emr-enhancement.design.md)

---

## 1. Overview

### 1.1 Scope

EMR Phase C(템플릿/PDF/감사) + Phase D(문진표/검색) + **Consent PDF** 설계.
기존 FormEngine, AuditLog, ConsentForm을 확장하고 PDF 생성, 전문검색을 신규 구현.
- **C-1**: 진료 템플릿 + 텍스트 매크로 (EncounterTemplate, TextMacro)
- **C-2**: 의무기록 PDF 출력 + **동의서 PDF** (Encounter, DischargeSummary, LabResult, **ConsentForm**)
- **C-3**: 감사 강화 (Break-the-Glass, VIP Patient, 비정상 접근 탐지)
- **D-1**: 초진/재진 문진표 (Questionnaire)
- **D-2**: 의무기록 전문 검색 (Full-text Search)

### 1.2 Module Dependency

```
기존 모듈                         Phase C/D (신규/확장)
──────────────────    ──────────────────────────────
FormEngineModule  ──→  EncounterTemplateModule (EMR-06)
                  ──→  QuestionnaireModule (EMR-09)

EncounterModule   ──→  EncounterTemplateModule (템플릿 연동)
                  ──→  MedicalRecordCopyModule (EMR-07: PDF)

AuditModule       ──→  AuditEnhancedModule (EMR-08 확장)

PatientModule     ──→  MedicalRecordCopyModule (EMR-07)
                  ──→  MedicalRecordSearchModule (EMR-10)

ConsentModule     ──→  MedicalRecordCopyModule (C-2: ConsentForm PDF)
```

---

## 2. Data Model

### 2.1 Prisma Schema

```prisma
// ── EMR-06: 진료기록 템플릿 ──

model EncounterTemplate {
  id           String   @id @default(uuid()) @db.Uuid
  department   String   @db.VarChar(50)
  name         String   @unique @db.VarChar(200)
  description  String?  @db.Text
  soapSections Json     @map("soap_sections") @db.JsonB
  version      String   @db.VarChar(20)
  isActive     Boolean  @default(true) @map("is_active")
  createdBy    String   @map("created_by") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  creator User @relation("EncounterTemplateCreator", fields: [createdBy], references: [id])

  @@index([department])
  @@map("encounter_templates")
}

model TextMacro {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  category  String   @db.VarChar(20)   // S, O, A, P, 간호, 공통
  shortcut  String   @db.VarChar(50)   // "htn"
  content   String   @db.Text          // 확장될 전체 문구
  isShared  Boolean  @default(false) @map("is_shared")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()

  user User @relation("UserTextMacros", fields: [userId], references: [id])

  @@unique([userId, shortcut])
  @@index([userId])
  @@map("text_macros")
}

// ── EMR-07: 사본발급 ──

model MedicalRecordCopy {
  id                String   @id @default(uuid()) @db.Uuid
  patientId         String   @map("patient_id") @db.Uuid
  requestedBy       String   @map("requested_by") @db.VarChar(100)
  requestorRelation String   @map("requestor_relation") @db.VarChar(50)
  purpose           String   @db.VarChar(200)
  recordTypes       Json     @map("record_types") @db.JsonB
  dateRange         Json?    @map("date_range") @db.JsonB
  issuedBy          String   @map("issued_by") @db.Uuid
  issuedAt          DateTime @map("issued_at") @db.Timestamptz()
  copyCount         Int      @map("copy_count")
  fee               Int
  notes             String?  @db.Text
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient Patient @relation(fields: [patientId], references: [id])
  issuer  User    @relation("RecordCopyIssuer", fields: [issuedBy], references: [id])

  @@index([patientId])
  @@map("medical_record_copies")
}

// ── EMR-08: 감사 강화 ──

model BreakTheGlassAccess {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  patientId    String    @map("patient_id") @db.Uuid
  reason       String    @db.Text
  accessedAt   DateTime  @map("accessed_at") @db.Timestamptz()
  resourceType String    @map("resource_type") @db.VarChar(50)
  resourceId   String?   @map("resource_id") @db.Uuid
  reviewedBy   String?   @map("reviewed_by") @db.Uuid
  reviewedAt   DateTime? @map("reviewed_at") @db.Timestamptz()
  isApproved   Boolean?  @map("is_approved")

  user     User    @relation("BtgAccessUser", fields: [userId], references: [id])
  patient  Patient @relation(fields: [patientId], references: [id])
  reviewer User?   @relation("BtgAccessReviewer", fields: [reviewedBy], references: [id])

  @@index([userId, accessedAt])
  @@index([patientId])
  @@map("break_the_glass_accesses")
}

model VipPatient {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @unique @map("patient_id") @db.Uuid
  designatedBy  String   @map("designated_by") @db.Uuid
  reason        String?  @db.Text
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient    Patient @relation(fields: [patientId], references: [id])
  designator User    @relation("VipDesignator", fields: [designatedBy], references: [id])

  @@map("vip_patients")
}

// ── EMR-09: 문진표 토큰 ──

model QuestionnaireToken {
  id             String    @id @default(uuid()) @db.Uuid
  patientId      String    @map("patient_id") @db.Uuid
  formSchemaId   String    @map("form_schema_id") @db.Uuid
  appointmentId  String?   @map("appointment_id") @db.Uuid
  token          String    @unique @db.VarChar(100)
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz()
  completedAt    DateTime? @map("completed_at") @db.Timestamptz()
  submissionId   String?   @map("submission_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  patient    Patient         @relation(fields: [patientId], references: [id])
  formSchema FormSchema      @relation(fields: [formSchemaId], references: [id])
  submission FormSubmission? @relation(fields: [submissionId], references: [id])

  @@index([token])
  @@map("questionnaire_tokens")
}
```

### 2.2 기존 모델 Relation 추가

```prisma
// User 모델 추가:
  encounterTemplates    EncounterTemplate[]     @relation("EncounterTemplateCreator")
  textMacros            TextMacro[]             @relation("UserTextMacros")
  recordCopiesIssued    MedicalRecordCopy[]     @relation("RecordCopyIssuer")
  btgAccesses           BreakTheGlassAccess[]   @relation("BtgAccessUser")
  btgReviews            BreakTheGlassAccess[]   @relation("BtgAccessReviewer")
  vipDesignations       VipPatient[]            @relation("VipDesignator")

// Patient 모델 추가:
  medicalRecordCopies   MedicalRecordCopy[]
  btgAccesses           BreakTheGlassAccess[]
  vipStatus             VipPatient?
  questionnaireTokens   QuestionnaireToken[]

// FormSchema 모델 추가:
  questionnaireTokens   QuestionnaireToken[]

// FormSubmission 모델 추가:
  questionnaireToken    QuestionnaireToken?
```

---

## 3. API Specification

### 3.1 EMR-06: 진료기록 템플릿

```
POST   /api/v1/encounter-templates                  (ADMIN, DOCTOR)
GET    /api/v1/encounter-templates                  ?department=내과
GET    /api/v1/encounter-templates/:id
PUT    /api/v1/encounter-templates/:id              (ADMIN)

POST   /api/v1/text-macros
GET    /api/v1/text-macros                          ?category=S
GET    /api/v1/text-macros/expand/:shortcut
DELETE /api/v1/text-macros/:id
```

### 3.2 EMR-07: PDF 출력/사본발급

```
POST   /api/v1/medical-records/generate-pdf         body: { patientId, recordType, recordId }
POST   /api/v1/medical-record-copies                body: { patientId, requestedBy, ... }
GET    /api/v1/patients/:patientId/record-copies

GET    /api/v1/consent/:id/generate-pdf             (DOCTOR, NURSE, ADMIN) [신규]
GET    /api/v1/patients/:patientId/consents/:consentId/generate-pdf  (신규)
```

**POST /api/v1/medical-records/generate-pdf Response:**
```typescript
{ data: { url: string; expiresAt: string } }  // 임시 PDF URL (5분 유효)
```

**GET /api/v1/consent/:id/generate-pdf Response:**
```
Content-Type: text/html; charset=utf-8
[HTML 문서 — 클라이언트 Print 또는 Puppeteer로 PDF 변환 가능]
```

**생성되는 Consent PDF 내용:**
- 병원 헤더 (Hospital RUN)
- 동의서 유형 (진료, 수술, 검사, 기타)
- 환자 정보 (이름, MRN, 생년월일, 성별)
- 동의서 템플릿 내용
- 위험 요소 및 대체 치료법
- 담당의 정보
- 서명 상태 (PENDING/SIGNED/REVOKED)
- 유효성 표시
- 법적 고지 (의료법 제24조)
- 워터마크: "서명완료" 또는 "취소됨"

### 3.3 EMR-08: 열람 감사 강화

```
POST   /api/v1/break-the-glass                      body: { patientId, reason, resourceType, resourceId? }
GET    /api/v1/break-the-glass                      ?userId=&dateFrom=&dateTo= (ADMIN)
PATCH  /api/v1/break-the-glass/:id/review           body: { isApproved } (ADMIN)

POST   /api/v1/vip-patients                         body: { patientId, reason? } (ADMIN)
GET    /api/v1/vip-patients                         (ADMIN)
DELETE /api/v1/vip-patients/:patientId               (ADMIN)

GET    /api/v1/patients/:patientId/access-history    (환자 열람 이력)
GET    /api/v1/audit/dashboard                       ?dateFrom=&dateTo= (ADMIN)
```

### 3.4 EMR-09: 문진표

```
POST   /api/v1/questionnaires/generate-token        body: { patientId, formSchemaId, appointmentId? }
GET    /api/v1/questionnaires/:token                 (공개 — 인증 불필요)
POST   /api/v1/questionnaires/:token/submit          (공개 — 인증 불필요)
GET    /api/v1/patients/:patientId/questionnaires
```

### 3.5 EMR-10: 의무기록 검색

```
GET    /api/v1/medical-records/search               ?q=&type=&dateFrom=&dateTo=&doctorId=
```

**Response:**
```typescript
{
  data: {
    results: {
      id: string;
      type: 'encounter' | 'progress_note' | 'nursing_note' | 'discharge_summary';
      headline: string;          // ts_headline 결과 (하이라이트)
      patientName: string;
      doctorName: string;
      recordedAt: string;
    }[];
    total: number;
  }
}
```

---

## 4. Service Layer Design

### 4.1 PDF Generation Service

```typescript
// pdf-generation.service.ts
// HTML 렌더링 기반 PDF 생성 (클라이언트 print 또는 puppeteer로 변환 가능)
class PdfGenerationService {
  async generateEncounterPdf(encounterId: string): Promise<string>      // HTML
  async generateDischargeSummaryPdf(admissionId: string): Promise<string> // HTML
  async generateLabResultPdf(labResultId: string): Promise<string>      // HTML
  async generateConsentFormPdf(consentId: string): Promise<string>      // HTML [신규 C-2]

  // 공통: HTML 템플릿 렌더링 (진료/퇴원/검사/동의서)
  private renderHtml(data): string                 // 진료/퇴원/검사
  private renderConsentHtml(data): string          // 동의서 [신규]
  
  // 포함 요소:
  // - 병원 헤더 (로고/주소)
  // - 환자 정보 (이름, MRN, 생년월일, 성별)
  // - 문서 내용 (SOAP/퇴원/검사/동의 세부사항)
  // - 워터마크 ("사본" 또는 "서명완료"/"취소됨")
  // - 발급일시 및 법적 고지
  // - 반응형 CSS (인쇄 최적화)
}
```

**Consent PDF 특화 요소:**
- 동의서 유형 상태 배지 (PENDING/SIGNED/REVOKED)
- 위험 요소 및 대체 치료법 섹션
- 의료법 제24조 법적 고지
- 담당의 정보
- 서명 일시 기록

### 4.2 Break-the-Glass Guard

```typescript
// btg.guard.ts — NestJS Guard로 구현
// 환자 리소스 접근 시 담당 의사/간호사 확인
// 비담당 → 403 + Break-the-Glass 필요 응답
// BTG 사유 제출 후 접근 허용 + 로깅

class BreakTheGlassGuard implements CanActivate {
  canActivate(context: ExecutionContext): Promise<boolean>
  // 1. 요청에서 patientId 추출
  // 2. 현재 사용자가 담당자인지 확인 (Encounter/Admission 기반)
  // 3. 담당자 → 통과
  // 4. 비담당 → BtgRequired 에러 (사유 입력 필요)
}
```

### 4.3 Anomaly Detection Service

```typescript
// anomaly-detection.service.ts
class AnomalyDetectionService {
  // Cron 또는 실시간 검사
  async checkBulkAccess(userId: string): Promise<boolean>     // 1시간 내 10+ 환자
  async checkAfterHoursAccess(userId: string): Promise<boolean> // 22:00~06:00
  async checkVipAccess(patientId: string): Promise<boolean>   // VIP 환자 여부
  async runPeriodicCheck(): Promise<AnomalyAlert[]>           // Cron: 매 30분
}
```

### 4.4 Full-text Search Service

```typescript
// medical-record-search.service.ts
class MedicalRecordSearchService {
  async search(query: string, filters: SearchFilters): Promise<SearchResult[]>
  // SQL: SELECT *, ts_headline('simple', content, to_tsquery('simple', $1))
  //      FROM encounters WHERE content @@ to_tsquery('simple', $1)
  //      UNION ALL ... (progress_notes, nursing_notes, discharge_summaries)
  //      ORDER BY ts_rank DESC LIMIT 20
}
```

---

## 5. Module Structure

```
apps/api/src/modules/
├── encounter-template/
│   ├── encounter-template.module.ts
│   ├── encounter-template.controller.ts
│   ├── encounter-template.service.ts
│   └── dto/
│       └── create-encounter-template.dto.ts
│
├── text-macro/
│   ├── text-macro.module.ts
│   ├── text-macro.controller.ts
│   └── text-macro.service.ts
│
├── medical-record-copy/
│   ├── medical-record-copy.module.ts
│   ├── medical-record-copy.controller.ts
│   ├── medical-record-copy.service.ts
│   └── pdf-generation.service.ts
│
├── audit-enhanced/
│   ├── audit-enhanced.module.ts
│   ├── btg.controller.ts
│   ├── btg.service.ts
│   ├── btg.guard.ts
│   ├── vip-patient.controller.ts
│   ├── vip-patient.service.ts
│   ├── anomaly-detection.service.ts
│   └── audit-dashboard.controller.ts
│
├── questionnaire/
│   ├── questionnaire.module.ts
│   ├── questionnaire.controller.ts        // 인증 필요 (토큰 생성)
│   ├── questionnaire-public.controller.ts  // 공개 (토큰 기반 접근)
│   └── questionnaire.service.ts
│
└── medical-record-search/
    ├── medical-record-search.module.ts
    ├── medical-record-search.controller.ts
    └── medical-record-search.service.ts

apps/web/src/app/(main)/
├── admin/
│   ├── encounter-templates/page.tsx        // 템플릿 관리
│   ├── audit-dashboard/page.tsx            // 감사 대시보드
│   └── vip-patients/page.tsx               // VIP 환자 관리
├── medical-records/
│   ├── copy/page.tsx                       // 사본발급
│   └── search/page.tsx                     // 의무기록 검색

// 공개 라우트 (인증 불필요)
apps/web/src/app/questionnaire/[token]/page.tsx
```

---

## 6. Dependencies

```json
// apps/api/package.json 추가
{
  "puppeteer": "^23.0.0"
}
```

```sql
-- PostgreSQL 확장 (Docker init script)
CREATE EXTENSION IF NOT EXISTS pg_bigm;

-- Full-text search 인덱스
CREATE INDEX idx_encounters_fts ON encounters USING gin (
  (subjective || ' ' || objective || ' ' || assessment || ' ' || plan) gin_bigm_ops
);
CREATE INDEX idx_progress_notes_fts ON progress_notes USING gin (content gin_bigm_ops);
CREATE INDEX idx_nursing_notes_fts ON nursing_notes USING gin (
  (COALESCE(focus,'') || ' ' || COALESCE(data,'') || ' ' || COALESCE(action,'') || ' ' || COALESCE(response,'') || ' ' || COALESCE(content,'')) gin_bigm_ops
);
CREATE INDEX idx_discharge_summaries_fts ON discharge_summaries USING gin (hospital_course gin_bigm_ops);
```

---

## 7. Implementation Order

```
Phase C-1: EMR-06 진료기록 템플릿 (2-3일)
  1. Prisma: EncounterTemplate + TextMacro 모델
  2. encounter-template 모듈 (CRUD)
  3. text-macro 모듈 (CRUD + expand)
  4. 기본 템플릿 3개 시딩 (내과/외과/응급)
  5. 진료 작성 페이지 템플릿 선택 UI
  6. 관리자 템플릿 관리 페이지

Phase C-2: EMR-07 PDF 출력 (3-4일)
  1. npm install puppeteer (옵션 - 현재는 HTML 기반)
  2. Prisma: MedicalRecordCopy 모델
  3. pdf-generation.service.ts (HTML 렌더링)
     - generateEncounterPdf() → 진료기록
     - generateDischargeSummaryPdf() → 퇴원요약
     - generateLabResultPdf() → 검사결과
     - generateConsentFormPdf() → 동의서 [신규]
  4. HTML 템플릿 (공통: 헤더/워터마크, 동의서: 상태배지/법적고지)
  5. medical-record-copy 모듈 (발급 + 이력)
  6. consent 모듈 확장 (PDF 엔드포인트 2개 추가)
  7. 사본발급 + 동의서 PDF 프론트엔드

Phase C-3: EMR-08 감사 강화 (2-3일)
  1. Prisma: BreakTheGlassAccess + VipPatient 모델
  2. btg.guard.ts (Break-the-Glass Guard)
  3. btg 서비스 + 컨트롤러
  4. vip-patient 서비스 + 컨트롤러
  5. anomaly-detection.service.ts
  6. 감사 대시보드 페이지

Phase D-1: EMR-09 문진표 (2-3일)
  1. Prisma: QuestionnaireToken 모델
  2. questionnaire 모듈 (토큰 생성 + 공개 접근)
  3. 공개 문진표 페이지 (/questionnaire/[token])
  4. QR 코드 생성 (qrcode 라이브러리)
  5. SOAP Subjective 연동

Phase D-2: EMR-10 의무기록 검색 (2-3일)
  1. pg_bigm 확장 + GIN 인덱스 마이그레이션
  2. medical-record-search 모듈
  3. 검색 API (UNION ALL + ts_rank)
  4. 검색 UI 페이지
```

---

## 8. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-05-07 | 초기 설계: Phase C(템플릿/PDF/감사) + Phase D(문진표/검색) |
