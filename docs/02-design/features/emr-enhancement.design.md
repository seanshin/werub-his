# EMR 의무기록 강화 설계서

> **Version**: 0.2
> **Created**: 2026-05-07
> **Author**: user
> **Status**: Draft
> **Planning Doc**: [emr-enhancement.plan.md](../../01-plan/features/emr-enhancement.plan.md)
> **Phase 2 Design**: [hospital-run-phase2.design.md](./hospital-run-phase2.design.md)

---

## 1. Overview

### 1.1 Scope

EMR 의무기록 강화 — Phase A(문제목록, 알레르기, 퇴원요약, 동의서) + Phase B(간호기록) 구현 설계.
기존 Phase 2(SOAP + OCS + DUR + 수납) 위에 의무기록의 깊이와 다양성을 확장한다.

**본 설계서 범위:**
- **설계 포함**: EMR-01(간호기록), EMR-02(퇴원요약), EMR-03(동의서), EMR-04(문제목록), EMR-05(알레르기)
- **설계 제외 (Phase C/D 별도 설계)**: EMR-06(진료기록 템플릿), EMR-07(의무기록 출력/사본발급), EMR-08(열람 감사), EMR-09(문진표), EMR-10(의무기록 검색)

### 1.2 Module Dependency

```
Phase 2 (기존)                      EMR Enhancement (신규)
───────────────────    ──────────────────────────────────────────
PatientModule     ──→  ProblemListModule (EMR-04)
                  ──→  AllergyModule (EMR-05)
                  ──→  DischargeSummaryModule (EMR-02)

EncounterModule   ──→  ProblemListModule (진단→문제목록 연동)

PrescriptionModule    
  └─ DurService   ──→  AllergyModule (알레르기-DUR 연동)

AdmissionModule   ──→  NursingModule (EMR-01)
                  ──→  DischargeSummaryModule

ConsentModule     ──→  ConsentModule (기존 확장, EMR-03)
  (기존)               ConsentTemplateModule (신규)

SurgeryModule     ──→  ConsentModule (수술동의서 연결)

FormEngineModule  ──→  ConsentTemplateModule (FormSchema 패턴 참고)
```

### 1.3 RBAC 매핑 (전체)

| 기능 | ADMIN | DOCTOR | NURSE | PHARMACIST | LAB_TECH |
|------|:-----:|:------:|:-----:|:----------:|:--------:|
| EMR-01 간호기록 | CRUD | R | CRUD | R(MAR) | - |
| EMR-02 퇴원요약 | CRUD | CRUD | R | - | - |
| EMR-03 동의서 | CRUD | CRU | R | - | - |
| EMR-04 문제목록 | CRUD | CRUD | R | - | - |
| EMR-05 알레르기 | CRUD | CRUD | CRU | R | - |
| EMR-06 템플릿 | CRUD | R | R | - | - |
| EMR-07 사본발급 | CRUD | R | CR | - | - |
| EMR-08 감사 | CRUD | R(본인) | R(본인) | - | - |

---

## 2. Data Model

### 2.1 New Entities — TypeScript Interfaces

#### ProblemList (EMR-04: 문제목록)

```typescript
interface ProblemList {
  id: string;
  patientId: string;
  diagnosisCodeId: string;           // FK → DiagnosisCode
  description: string;               // 문제 설명 (진단명 또는 자유 기술)
  status: ProblemStatus;
  severity: ProblemSeverity;
  onsetDate: Date | null;            // 발병일
  resolvedDate: Date | null;         // 해결일 (status=RESOLVED 시)
  addedBy: string;                   // FK → User (등록 의사)
  addedEncounterId: string | null;   // FK → Encounter (등록된 진료건)
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

enum ProblemStatus { ACTIVE = 'ACTIVE', CHRONIC = 'CHRONIC', RESOLVED = 'RESOLVED', INACTIVE = 'INACTIVE' }
enum ProblemSeverity { MILD = 'MILD', MODERATE = 'MODERATE', SEVERE = 'SEVERE' }
```

#### Allergy (EMR-05: 알레르기/ADR)

```typescript
interface Allergy {
  id: string;
  patientId: string;
  type: AllergyType;
  allergen: string;                  // 원인물질명 ("페니실린")
  allergenCode: string | null;       // 약품코드/성분코드 (DUR 연동용)
  reaction: string;                  // 반응/증상 ("두드러기, 호흡곤란")
  severity: AllergySeverity;
  onsetDate: Date | null;
  verificationStatus: AllergyVerification;
  reportedBy: string;                // 보고자 (환자/보호자/의사)
  recordedBy: string;                // FK → User
  notes: string | null;
  isActive: boolean;                 // default: true
  createdAt: Date;
  updatedAt: Date;
}

enum AllergyType { DRUG = 'DRUG', FOOD = 'FOOD', ENVIRONMENTAL = 'ENVIRONMENTAL', LATEX = 'LATEX', OTHER = 'OTHER' }
enum AllergySeverity { MILD = 'MILD', MODERATE = 'MODERATE', SEVERE = 'SEVERE', LIFE_THREATENING = 'LIFE_THREATENING' }
enum AllergyVerification { CONFIRMED = 'CONFIRMED', UNCONFIRMED = 'UNCONFIRMED', REFUTED = 'REFUTED', ENTERED_IN_ERROR = 'ENTERED_IN_ERROR' }
```

#### DischargeSummary (EMR-02: 퇴원요약)

```typescript
interface DischargeSummary {
  id: string;
  admissionId: string;               // FK → Admission (unique)
  doctorId: string;                  // FK → User
  admitDate: Date;
  dischargeDate: Date;
  admitDiagnosis: string;
  dischargeDiagnosis: string;
  diagnosisCodes: object;            // KCD 코드 목록 (JsonB)
  hospitalCourse: string;            // 입원경과
  procedures: string | null;         // 시행된 시술/수술
  significantFindings: string | null; // 주요 검사결과
  conditionAtDischarge: string;      // 퇴원 시 상태
  dischargeMedications: object;      // 퇴원약 목록 (JsonB)
  followUpPlan: string;
  followUpDate: Date | null;
  dietaryInstructions: string | null;
  activityRestrictions: string | null;
  patientEducation: string | null;
  status: DischargeSummaryStatus;
  signedAt: Date | null;
  signedBy: string | null;           // FK → User
  createdAt: Date;
  updatedAt: Date;
}

enum DischargeSummaryStatus { DRAFT = 'DRAFT', SIGNED = 'SIGNED', AMENDED = 'AMENDED' }
```

#### ConsentTemplate (EMR-03: 동의서 템플릿)

```typescript
interface ConsentTemplate {
  id: string;
  type: string;                      // 동의서 유형
  name: string;                      // "전신마취 동의서"
  version: string;                   // "1.0"
  content: object;                   // 템플릿 JSON (JsonB)
  requiredFields: object;            // 필수 입력 항목 (JsonB)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

#### NursingAssessment (EMR-01: 간호초기평가)

```typescript
interface NursingAssessment {
  id: string;
  admissionId: string;               // FK → Admission
  nurseId: string;                   // FK → User
  consciousness: string;             // Alert/Verbal/Pain/Unresponsive
  mobility: string;
  painScore: number;                 // NRS 0-10
  painLocation: string | null;
  nutritionStatus: string;
  skinIntegrity: string;
  fallRiskAssessmentId: string | null; // FK → FallRiskAssessment (기존 모델 참조)
  bradenScore: number | null;        // Braden Scale 점수
  allergyConfirmed: boolean;         // Allergy 모델 확인 여부
  additionalData: object | null;     // 기타 사정항목 (JsonB)
  assessedAt: Date;
  createdAt: Date;
}
```

#### NursingDiagnosis (EMR-01: 간호진단)

```typescript
interface NursingDiagnosis {
  id: string;
  assessmentId: string;              // FK → NursingAssessment
  nurseId: string;                   // FK → User
  nandaCode: string;                 // NANDA-I 진단코드
  nandaName: string;
  relatedFactors: string | null;
  definingCharacteristics: string | null;
  expectedOutcome: string;
  status: NursingDiagnosisStatus;
  createdAt: Date;
  updatedAt: Date;
}

enum NursingDiagnosisStatus { ACTIVE = 'ACTIVE', RESOLVED = 'RESOLVED' }
```

#### NursingNote (EMR-01: 간호일지)

```typescript
interface NursingNote {
  id: string;
  admissionId: string;
  nurseId: string;
  noteType: NursingNoteType;
  focus: string | null;              // Focus Charting 초점
  data: string | null;               // D: 자료
  action: string | null;             // A: 간호중재
  response: string | null;           // R: 반응/평가
  content: string | null;            // 서술식 기록 (NARRATIVE 타입)
  shiftType: ShiftType;
  recordedAt: Date;
  createdAt: Date;
}

enum NursingNoteType { FOCUS = 'FOCUS', NARRATIVE = 'NARRATIVE', DAR = 'DAR' }
enum ShiftType { DAY = 'DAY', EVENING = 'EVENING', NIGHT = 'NIGHT' }
```

#### IntakeOutput (EMR-01: I/O 기록)

```typescript
interface IntakeOutput {
  id: string;
  admissionId: string;
  nurseId: string;
  recordedAt: Date;
  intakeType: IntakeType | null;
  intakeAmount: number | null;       // mL
  intakeDetail: string | null;
  outputType: OutputType | null;
  outputAmount: number | null;       // mL
  outputDetail: string | null;
  createdAt: Date;
}

enum IntakeType { ORAL = 'ORAL', IV = 'IV', OTHER = 'OTHER' }
enum OutputType { URINE = 'URINE', DRAIN = 'DRAIN', EMESIS = 'EMESIS', OTHER = 'OTHER' }
```

#### MedicationAdministration (EMR-01: 투약확인/MAR)

```typescript
interface MedicationAdministration {
  id: string;
  prescriptionId: string;            // FK → Prescription (원본 처방)
  orderId: string | null;            // FK → Order (입원 시 OCS 오더)
  dispensingId: string | null;        // FK → Dispensing (조제 완료건)
  nurseId: string | null;            // FK → User (스케줄 생성 시 null, 투약 시 배정)
  patientId: string;                 // FK → Patient
  scheduledAt: Date;                 // 예정시간
  administeredAt: Date | null;       // 실제 투약시간
  status: MedAdminStatus;
  holdReason: string | null;
  route: string;                     // PO, IV, IM, SC
  dose: string;                      // 실제 투여량
  verifiedBy: string | null;         // FK → User (더블체크 간호사)
  notes: string | null;
  createdAt: Date;
}

enum MedAdminStatus { SCHEDULED = 'SCHEDULED', ADMINISTERED = 'ADMINISTERED', HELD = 'HELD', REFUSED = 'REFUSED', MISSED = 'MISSED' }
```

### 2.2 Prisma Schema Extension

```prisma
// ============================================================
// EMR Enhancement: Phase A + Phase B
// ============================================================

// ── Enums ──

enum ProblemStatus {
  ACTIVE
  CHRONIC
  RESOLVED
  INACTIVE
}

enum ProblemSeverity {
  MILD
  MODERATE
  SEVERE
}

enum AllergyType {
  DRUG
  FOOD
  ENVIRONMENTAL
  LATEX
  OTHER
}

enum AllergySeverity {
  MILD
  MODERATE
  SEVERE
  LIFE_THREATENING
}

enum AllergyVerification {
  CONFIRMED
  UNCONFIRMED
  REFUTED
  ENTERED_IN_ERROR
}

enum DischargeSummaryStatus {
  DRAFT
  SIGNED
  AMENDED
}

enum ConsentType {
  SURGERY
  PROCEDURE
  ANESTHESIA
  RESEARCH
  TRANSFUSION
  DNR
  TREATMENT
  GENERAL
}

enum ConsentStatus {
  PENDING
  SIGNED
  EXPIRED
  REVOKED
}

enum NursingDiagnosisStatus {
  ACTIVE
  RESOLVED
}

enum NursingNoteType {
  FOCUS
  NARRATIVE
  DAR
}

enum ShiftType {
  DAY
  EVENING
  NIGHT
}

enum IntakeType {
  ORAL
  IV
  OTHER
}

enum OutputType {
  URINE
  DRAIN
  EMESIS
  OTHER
}

enum MedAdminStatus {
  SCHEDULED
  ADMINISTERED
  HELD
  REFUSED
  MISSED
}

// ── EMR-04: 문제목록 ──

model ProblemList {
  id                String          @id @default(uuid()) @db.Uuid
  patientId         String          @map("patient_id") @db.Uuid
  diagnosisCodeId   String          @map("diagnosis_code_id") @db.Uuid
  description       String          @db.VarChar(500)
  status            ProblemStatus   @default(ACTIVE)
  severity          ProblemSeverity @default(MODERATE)
  onsetDate         DateTime?       @map("onset_date") @db.Date
  resolvedDate      DateTime?       @map("resolved_date") @db.Date
  addedBy           String          @map("added_by") @db.Uuid
  addedEncounterId  String?         @map("added_encounter_id") @db.Uuid
  notes             String?         @db.Text
  createdAt         DateTime        @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt         DateTime        @updatedAt @map("updated_at") @db.Timestamptz()

  patient       Patient       @relation(fields: [patientId], references: [id])
  diagnosisCode DiagnosisCode @relation(fields: [diagnosisCodeId], references: [id])
  addedByUser   User          @relation("ProblemAddedBy", fields: [addedBy], references: [id])
  encounter     Encounter?    @relation(fields: [addedEncounterId], references: [id])

  @@index([patientId, status])
  @@index([patientId])
  @@map("problem_lists")
}

// ── EMR-05: 알레르기/ADR ──

model Allergy {
  id                 String             @id @default(uuid()) @db.Uuid
  patientId          String             @map("patient_id") @db.Uuid
  type               AllergyType
  allergen           String             @db.VarChar(300)
  allergenCode       String?            @map("allergen_code") @db.VarChar(50)
  reaction           String             @db.VarChar(500)
  severity           AllergySeverity
  onsetDate          DateTime?          @map("onset_date") @db.Date
  verificationStatus AllergyVerification @default(UNCONFIRMED) @map("verification_status")
  reportedBy         String             @map("reported_by") @db.VarChar(100)
  recordedBy         String             @map("recorded_by") @db.Uuid
  notes              String?            @db.Text
  isActive           Boolean            @default(true) @map("is_active")
  createdAt          DateTime           @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt          DateTime           @updatedAt @map("updated_at") @db.Timestamptz()

  patient    Patient @relation("PatientAllergies", fields: [patientId], references: [id])
  recorder   User    @relation("AllergyRecorder", fields: [recordedBy], references: [id])

  @@index([patientId, isActive])
  @@index([allergenCode])
  @@map("allergies")
}

// ── EMR-02: 퇴원요약 ──

model DischargeSummary {
  id                    String                 @id @default(uuid()) @db.Uuid
  admissionId           String                 @unique @map("admission_id") @db.Uuid
  doctorId              String                 @map("doctor_id") @db.Uuid
  admitDate             DateTime               @map("admit_date") @db.Date
  dischargeDate         DateTime               @map("discharge_date") @db.Date
  admitDiagnosis        String                 @map("admit_diagnosis") @db.Text
  dischargeDiagnosis    String                 @map("discharge_diagnosis") @db.Text
  diagnosisCodes        Json                   @map("diagnosis_codes") @db.JsonB
  hospitalCourse        String                 @map("hospital_course") @db.Text
  procedures            String?                @db.Text
  significantFindings   String?                @map("significant_findings") @db.Text
  conditionAtDischarge  String                 @map("condition_at_discharge") @db.VarChar(200)
  dischargeMedications  Json                   @map("discharge_medications") @db.JsonB
  followUpPlan          String                 @map("follow_up_plan") @db.Text
  followUpDate          DateTime?              @map("follow_up_date") @db.Date
  dietaryInstructions   String?                @map("dietary_instructions") @db.Text
  activityRestrictions  String?                @map("activity_restrictions") @db.Text
  patientEducation      String?                @map("patient_education") @db.Text
  status                DischargeSummaryStatus @default(DRAFT)
  signedAt              DateTime?              @map("signed_at") @db.Timestamptz()
  signedBy              String?                @map("signed_by") @db.Uuid
  createdAt             DateTime               @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt             DateTime               @updatedAt @map("updated_at") @db.Timestamptz()

  admission Admission @relation(fields: [admissionId], references: [id])
  doctor    User      @relation("DischargeSummaryDoctor", fields: [doctorId], references: [id])

  @@map("discharge_summaries")
}

// ── EMR-03: 동의서 템플릿 ──

model ConsentTemplate {
  id             String   @id @default(uuid()) @db.Uuid
  type           String   @db.VarChar(50)
  name           String   @unique @db.VarChar(200)
  version        String   @db.VarChar(20)
  content        Json     @db.JsonB
  requiredFields Json     @map("required_fields") @db.JsonB
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  consentForms ConsentForm[]

  @@map("consent_templates")
}

// ── EMR-03: ConsentForm 확장 (기존 모델 ALTER) ──
// ★ 아래는 확장 후 최종 모습. [기존] 필드는 유지, [추가] 필드는 신규.
// ★ Prisma migrate는 ADD COLUMN만 수행. signedBy→patientSignedBy는 수동 SQL 필요.

model ConsentForm {
  // [기존 유지]
  id            String    @id @default(uuid()) @db.Uuid
  patientId     String    @map("patient_id") @db.Uuid
  type          String    @db.VarChar(50)                    // 기존 freetext 유지
  templateName  String    @map("template_name") @db.VarChar(200)  // deprecated, 다음 릴리즈 제거
  content       Json      @db.JsonB
  signedBy      String?   @map("signed_by") @db.VarChar(100)     // deprecated → patientSignedBy로 이전
  signedAt      DateTime? @map("signed_at") @db.Timestamptz()
  witnessId     String?   @map("witness_id") @db.Uuid
  expiresAt     DateTime? @map("expires_at") @db.Timestamptz()
  isValid       Boolean   @default(true) @map("is_valid")        // deprecated → status로 이전
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  // [추가 필드 — 모두 nullable로 하위호환]
  templateId       String?        @map("template_id") @db.Uuid
  consentType      ConsentType?   @map("consent_type")
  encounterId      String?        @map("encounter_id") @db.Uuid
  surgeryId        String?        @map("surgery_id") @db.Uuid
  risks            String?        @db.Text
  alternatives     String?        @db.Text
  patientSignature String?        @map("patient_signature") @db.Text   // Base64 (AES-256)
  patientSignedAt  DateTime?      @map("patient_signed_at") @db.Timestamptz()
  patientSignedBy  String?        @map("patient_signed_by") @db.VarChar(100)
  witnessSignedAt  DateTime?      @map("witness_signed_at") @db.Timestamptz()
  doctorId         String?        @map("doctor_id") @db.Uuid
  doctorSignedAt   DateTime?      @map("doctor_signed_at") @db.Timestamptz()
  status           ConsentStatus? @default(PENDING)
  revokedAt        DateTime?      @map("revoked_at") @db.Timestamptz()
  revokedReason    String?        @map("revoked_reason") @db.Text

  // Relations
  patient   Patient          @relation(fields: [patientId], references: [id])
  template  ConsentTemplate? @relation(fields: [templateId], references: [id])
  encounter Encounter?       @relation(fields: [encounterId], references: [id])
  surgery   Surgery?         @relation(fields: [surgeryId], references: [id])
  doctor    User?            @relation("ConsentDoctor", fields: [doctorId], references: [id])

  @@index([patientId])
  @@map("consent_forms")
}

// ★ 마이그레이션 수동 SQL (Prisma 자동생성 후 추가):
// ALTER TABLE consent_forms ADD COLUMN patient_signed_by VARCHAR(100);
// UPDATE consent_forms SET patient_signed_by = signed_by;
// UPDATE consent_forms SET status = CASE
//   WHEN is_valid = true AND signed_at IS NOT NULL THEN 'SIGNED'
//   WHEN is_valid = false THEN 'REVOKED'
//   ELSE 'PENDING' END;
// -- signedBy, templateName 컬럼은 다음 릴리즈에서 DROP

// ── EMR-01: 간호초기평가 ──

model NursingAssessment {
  id                    String   @id @default(uuid()) @db.Uuid
  admissionId           String   @map("admission_id") @db.Uuid
  nurseId               String   @map("nurse_id") @db.Uuid
  consciousness         String   @db.VarChar(20)
  mobility              String   @db.VarChar(50)
  painScore             Int      @map("pain_score")
  painLocation          String?  @map("pain_location") @db.VarChar(100)
  nutritionStatus       String   @map("nutrition_status") @db.VarChar(50)
  skinIntegrity         String   @map("skin_integrity") @db.VarChar(50)
  fallRiskAssessmentId  String?  @map("fall_risk_assessment_id") @db.Uuid
  bradenScore           Int?     @map("braden_score")
  allergyConfirmed      Boolean  @default(false) @map("allergy_confirmed")
  additionalData        Json?    @map("additional_data") @db.JsonB
  assessedAt            DateTime @map("assessed_at") @db.Timestamptz()
  createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz()

  admission          Admission           @relation(fields: [admissionId], references: [id])
  nurse              User                @relation("NursingAssessmentNurse", fields: [nurseId], references: [id])
  fallRiskAssessment FallRiskAssessment? @relation(fields: [fallRiskAssessmentId], references: [id])
  diagnoses          NursingDiagnosis[]

  @@index([admissionId])
  @@map("nursing_assessments")
}

// ── EMR-01: 간호진단 ──

model NursingDiagnosis {
  id                       String                 @id @default(uuid()) @db.Uuid
  assessmentId             String                 @map("assessment_id") @db.Uuid
  nurseId                  String                 @map("nurse_id") @db.Uuid
  nandaCode                String                 @map("nanda_code") @db.VarChar(20)
  nandaName                String                 @map("nanda_name") @db.VarChar(300)
  relatedFactors           String?                @map("related_factors") @db.Text
  definingCharacteristics  String?                @map("defining_characteristics") @db.Text
  expectedOutcome          String                 @map("expected_outcome") @db.Text
  status                   NursingDiagnosisStatus @default(ACTIVE)
  createdAt                DateTime               @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt                DateTime               @updatedAt @map("updated_at") @db.Timestamptz()

  assessment NursingAssessment @relation(fields: [assessmentId], references: [id])
  nurse      User              @relation("NursingDiagnosisNurse", fields: [nurseId], references: [id])

  @@index([assessmentId])
  @@map("nursing_diagnoses")
}

// ── EMR-01: 간호일지 (Focus Charting) ──

model NursingNote {
  id           String          @id @default(uuid()) @db.Uuid
  admissionId  String          @map("admission_id") @db.Uuid
  nurseId      String          @map("nurse_id") @db.Uuid
  noteType     NursingNoteType @map("note_type")
  focus        String?         @db.VarChar(200)
  data         String?         @db.Text
  action       String?         @db.Text
  response     String?         @db.Text
  content      String?         @db.Text
  shiftType    ShiftType       @map("shift_type")
  recordedAt   DateTime        @map("recorded_at") @db.Timestamptz()
  createdAt    DateTime        @default(now()) @map("created_at") @db.Timestamptz()

  admission Admission @relation(fields: [admissionId], references: [id])
  nurse     User      @relation("NursingNoteNurse", fields: [nurseId], references: [id])

  @@index([admissionId, recordedAt])
  @@map("nursing_notes")
}

// ── EMR-01: I/O 기록 ──

model IntakeOutput {
  id            String      @id @default(uuid()) @db.Uuid
  admissionId   String      @map("admission_id") @db.Uuid
  nurseId       String      @map("nurse_id") @db.Uuid
  recordedAt    DateTime    @map("recorded_at") @db.Timestamptz()
  intakeType    IntakeType? @map("intake_type")
  intakeAmount  Int?        @map("intake_amount")
  intakeDetail  String?     @map("intake_detail") @db.VarChar(200)
  outputType    OutputType? @map("output_type")
  outputAmount  Int?        @map("output_amount")
  outputDetail  String?     @map("output_detail") @db.VarChar(200)
  createdAt     DateTime    @default(now()) @map("created_at") @db.Timestamptz()

  admission Admission @relation(fields: [admissionId], references: [id])
  nurse     User      @relation("IntakeOutputNurse", fields: [nurseId], references: [id])

  @@index([admissionId, recordedAt])
  @@map("intake_outputs")
}

// ── EMR-01: 투약확인 (MAR) ──

model MedicationAdministration {
  id              String         @id @default(uuid()) @db.Uuid
  prescriptionId  String         @map("prescription_id") @db.Uuid
  orderId         String?        @map("order_id") @db.Uuid
  dispensingId    String?        @map("dispensing_id") @db.Uuid
  nurseId         String?        @map("nurse_id") @db.Uuid   // ★ nullable: 스케줄 생성 시 null, 투약 시 배정
  patientId       String         @map("patient_id") @db.Uuid
  scheduledAt     DateTime       @map("scheduled_at") @db.Timestamptz()
  administeredAt  DateTime?      @map("administered_at") @db.Timestamptz()
  status          MedAdminStatus @default(SCHEDULED)
  holdReason      String?        @map("hold_reason") @db.VarChar(500)
  route           String         @db.VarChar(20)
  dose            String         @db.VarChar(100)
  verifiedBy      String?        @map("verified_by") @db.Uuid
  notes           String?        @db.Text
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz()

  prescription Prescription @relation(fields: [prescriptionId], references: [id])
  order        Order?       @relation(fields: [orderId], references: [id])
  dispensing   Dispensing?  @relation(fields: [dispensingId], references: [id])
  nurse        User?        @relation("MedAdminNurse", fields: [nurseId], references: [id])  // ★ optional
  patient      Patient      @relation(fields: [patientId], references: [id])
  verifier     User?        @relation("MedAdminVerifier", fields: [verifiedBy], references: [id])

  @@index([patientId, scheduledAt])
  @@index([prescriptionId])
  @@map("medication_administrations")
}
```

### 2.3 기존 모델 Relation 추가

**★ User 모델 (9건 추가 — Prisma 컴파일 필수):**
```prisma
model User {
  // ... 기존 relation 유지 ...

  // EMR Enhancement 추가 relation:
  problemsAdded         ProblemList[]                @relation("ProblemAddedBy")
  allergiesRecorded     Allergy[]                    @relation("AllergyRecorder")
  dischargeSummaries    DischargeSummary[]           @relation("DischargeSummaryDoctor")
  consentsAsDoctor      ConsentForm[]                @relation("ConsentDoctor")
  nursingAssessments    NursingAssessment[]          @relation("NursingAssessmentNurse")
  nursingDiagnoses      NursingDiagnosis[]           @relation("NursingDiagnosisNurse")
  nursingNotes          NursingNote[]                @relation("NursingNoteNurse")
  intakeOutputs         IntakeOutput[]               @relation("IntakeOutputNurse")
  medAdminsAsNurse      MedicationAdministration[]   @relation("MedAdminNurse")
  medAdminsAsVerifier   MedicationAdministration[]   @relation("MedAdminVerifier")
}
```

**Patient 모델:**
```prisma
model Patient {
  // ... 기존 relation 유지 ...
  problemLists    ProblemList[]
  allergiesRel    Allergy[]                    @relation("PatientAllergies")
  medAdmins       MedicationAdministration[]
}
```

**Admission 모델:**
```prisma
model Admission {
  // ... 기존 relation 유지 ...
  dischargeSummary   DischargeSummary?
  nursingAssessments NursingAssessment[]
  nursingNotes       NursingNote[]
  intakeOutputs      IntakeOutput[]
}
```

**Encounter 모델:**
```prisma
model Encounter {
  // ... 기존 relation 유지 ...
  problemLists  ProblemList[]
  consentForms  ConsentForm[]
}
```

**DiagnosisCode 모델 (★ 역관계 추가 — C-4 수정):**
```prisma
model DiagnosisCode {
  // ... 기존 relation 유지 ...
  problemLists ProblemList[]
}
```

**Surgery 모델:**
```prisma
model Surgery {
  // ... 기존 relation 유지 ...
  consentForms ConsentForm[]
}
```

**FallRiskAssessment 모델:**
```prisma
model FallRiskAssessment {
  // ... 기존 relation 유지 ...
  nursingAssessments NursingAssessment[]
}
```

**Prescription / Order / Dispensing 모델:**
```prisma
model Prescription {
  // ... 기존 relation 유지 ...
  medAdmins MedicationAdministration[]
}

model Order {
  // ... 기존 relation 유지 ...
  medAdmins MedicationAdministration[]
}

model Dispensing {
  // ... 기존 relation 유지 ...
  medAdmins MedicationAdministration[]
}
```

---

## 3. API Specification

### 3.1 EMR-04: 문제목록 API

```
POST   /api/v1/patients/:patientId/problems
GET    /api/v1/patients/:patientId/problems          ?status=ACTIVE,CHRONIC
GET    /api/v1/patients/:patientId/problems/:id
PUT    /api/v1/patients/:patientId/problems/:id
PATCH  /api/v1/patients/:patientId/problems/:id/resolve
```

#### POST /api/v1/patients/:patientId/problems

**Request Body:**
```typescript
class CreateProblemDto {
  @IsUUID()           diagnosisCodeId: string;
  @IsString()         description: string;
  @IsEnum(ProblemStatus)  @IsOptional()  status?: ProblemStatus;       // default: ACTIVE
  @IsEnum(ProblemSeverity) @IsOptional() severity?: ProblemSeverity;   // default: MODERATE
  @IsDateString()     @IsOptional()     onsetDate?: string;
  @IsUUID()           @IsOptional()     addedEncounterId?: string;
  @IsString()         @IsOptional()     notes?: string;
}
```

**Response:** `{ data: ProblemList }`

#### PATCH /api/v1/patients/:patientId/problems/:id/resolve

**Request Body:**
```typescript
class ResolveProblemDto {
  @IsDateString() @IsOptional() resolvedDate?: string;  // default: today
  @IsString()     @IsOptional() notes?: string;
}
```

**Response:** `{ data: ProblemList }` (status → RESOLVED)

---

### 3.2 EMR-05: 알레르기 API

```
POST   /api/v1/patients/:patientId/allergies
GET    /api/v1/patients/:patientId/allergies          ?isActive=true
GET    /api/v1/patients/:patientId/allergies/:id
PUT    /api/v1/patients/:patientId/allergies/:id
PATCH  /api/v1/patients/:patientId/allergies/:id/verify
```

#### POST /api/v1/patients/:patientId/allergies

**Request Body:**
```typescript
class CreateAllergyDto {
  @IsEnum(AllergyType)         type: AllergyType;
  @IsString()                  allergen: string;
  @IsString()     @IsOptional() allergenCode?: string;
  @IsString()                  reaction: string;
  @IsEnum(AllergySeverity)     severity: AllergySeverity;
  @IsDateString() @IsOptional() onsetDate?: string;
  @IsString()                  reportedBy: string;
  @IsString()     @IsOptional() notes?: string;
}
```

**Response:** `{ data: Allergy }`

#### PATCH /api/v1/patients/:patientId/allergies/:id/verify

**Request Body:**
```typescript
class VerifyAllergyDto {
  @IsEnum(AllergyVerification) verificationStatus: AllergyVerification;
  @IsString() @IsOptional()    notes?: string;
}
```

---

### 3.3 EMR-02: 퇴원요약 API

```
POST   /api/v1/admissions/:admissionId/discharge-summary
GET    /api/v1/admissions/:admissionId/discharge-summary
PUT    /api/v1/admissions/:admissionId/discharge-summary
PATCH  /api/v1/admissions/:admissionId/discharge-summary/sign
GET    /api/v1/admissions/:admissionId/discharge-summary/prefill
```

#### GET /api/v1/admissions/:admissionId/discharge-summary/prefill

Admission 데이터를 기반으로 퇴원요약 자동 프리필 데이터 반환.

**Response:**
```typescript
{
  data: {
    admitDate: string;
    dischargeDate: string | null;
    admitDiagnosis: string;             // 입원 시 첫 진단
    diagnosisCodes: DiagnosisCode[];    // 입원 기간 진단 코드 목록
    procedures: string;                  // 수술기록 자동 취합
    significantFindings: string;         // 주요 검사결과 자동 취합
    dischargeMedications: Medication[];  // 활성 처방 목록
  }
}
```

---

### 3.4 EMR-03: 동의서 API

```
# 템플릿 관리
POST   /api/v1/consent-templates                    (ADMIN)
GET    /api/v1/consent-templates                    ?type=SURGERY
GET    /api/v1/consent-templates/:id

# 동의서 관리 (기존 ConsentForm 엔드포인트 확장)
POST   /api/v1/patients/:patientId/consents
GET    /api/v1/patients/:patientId/consents
PATCH  /api/v1/consents/:id/sign
PATCH  /api/v1/consents/:id/revoke
```

#### PATCH /api/v1/consents/:id/sign

**Request Body:**
```typescript
class SignConsentDto {
  @IsString()                  patientSignature: string;  // Base64 PNG
  @IsString() @IsOptional()    patientSignedBy?: string;  // 서명자 이름
}
```

**Response:** `{ data: ConsentForm }` (status → SIGNED)

---

### 3.5 EMR-01: 간호기록 API

```
# 간호초기평가
POST   /api/v1/admissions/:admissionId/nursing-assessment
GET    /api/v1/admissions/:admissionId/nursing-assessment

# 간호진단
POST   /api/v1/nursing-assessments/:assessmentId/diagnoses
GET    /api/v1/nursing-assessments/:assessmentId/diagnoses
PATCH  /api/v1/nursing-diagnoses/:id/resolve

# 간호일지
POST   /api/v1/admissions/:admissionId/nursing-notes
GET    /api/v1/admissions/:admissionId/nursing-notes    ?shiftType=DAY&date=2026-05-07

# I/O 기록
POST   /api/v1/admissions/:admissionId/intake-outputs
GET    /api/v1/admissions/:admissionId/intake-outputs   ?date=2026-05-07
GET    /api/v1/admissions/:admissionId/intake-outputs/summary  ?date=2026-05-07

# 투약확인 (MAR)
GET    /api/v1/admissions/:admissionId/medication-schedule   ?date=2026-05-07
PATCH  /api/v1/medication-administrations/:id/administer
PATCH  /api/v1/medication-administrations/:id/hold
```

#### GET /api/v1/admissions/:admissionId/intake-outputs/summary

24시간 I/O 집계.

**Response:**
```typescript
{
  data: {
    date: string;
    totalIntake: number;      // mL
    totalOutput: number;      // mL
    balance: number;          // intake - output
    byHour: { hour: number; intake: number; output: number }[];
  }
}
```

#### PATCH /api/v1/medication-administrations/:id/administer

**Request Body:**
```typescript
class AdministerMedDto {
  @IsDateString() @IsOptional() administeredAt?: string;  // default: now
  @IsString()                   dose: string;
  @IsString()                   route: string;
  @IsUUID()     @IsOptional()   verifiedBy?: string;
  @IsString()   @IsOptional()   notes?: string;
}
```

---

## 4. Service Layer Design

### 4.1 AllergyDurIntegration (핵심 연동)

```
기존 DUR 흐름:
  PrescriptionService.create()
    → DurService.checkInteractions(encounterId, medicationCodeId, patientId)
      → 기존 처방 중복/상호작용 체크

확장 후 DUR 흐름:
  PrescriptionService.create()
    → DurService.checkInteractions(encounterId, medicationCodeId, patientId)
      → [기존] 처방 중복/상호작용 체크
      → [신규] AllergyService.checkDrugAllergy(patientId, medicationCodeId)
        → Allergy 모델에서 DRUG 타입 + isActive=true 조회
        → allergenCode ↔ MedicationCode.ingredient 매칭
        → 매칭 시 DurWarning { severity: 'ERROR', type: 'ALLERGY' } 반환
```

**DurService 확장:**
```typescript
// dur.service.ts 에 추가할 DUR 타입
type: 'INTERACTION' | 'DUPLICATE' | 'AGE_CONTRAINDICATION' | 'ALLERGY';

// dur.service.ts checkInteractions 메서드 끝에 추가
async checkInteractions(...): Promise<DurWarning[]> {
  // ... 기존 로직 ...

  // 5. 알레르기 체크 (신규)
  const allergyWarnings = await this.allergyService.checkDrugAllergy(
    patientId,
    newMedicationCodeId,
  );
  warnings.push(...allergyWarnings);

  return warnings;
}
```

### 4.2 DischargeSummary Prefill Service

```typescript
// discharge-summary.service.ts
async prefill(admissionId: string): Promise<PrefillData> {
  const admission = await this.prisma.admission.findUnique({
    where: { id: admissionId },
    include: {
      patient: { include: { encounters: { ... }, problemLists: { ... } } },
      progressNotes: true,
    },
  });

  // 입원 기간 진단 취합
  const diagnoses = await this.getDiagnosesDuringAdmission(admission);
  
  // 입원 기간 수술 기록
  const surgeries = await this.getSurgeriesDuringAdmission(admission);
  
  // 입원 기간 주요 검사결과
  const labResults = await this.getSignificantLabResults(admission);
  
  // 활성 처방 → 퇴원약
  const activeMeds = await this.getActiveMedications(admission);

  return { admitDate, dischargeDate, admitDiagnosis, diagnosisCodes,
           procedures, significantFindings, dischargeMedications };
}
```

### 4.3 MAR Schedule Generation

```typescript
// medication-administration.service.ts
async generateSchedule(prescriptionId: string): Promise<MedicationAdministration[]> {
  const prescription = await this.prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { medicationCode: true },
  });

  // frequency 파싱: "1일 3회" → [08:00, 13:00, 18:00]
  const times = this.parseFrequency(prescription.frequency);
  const days = prescription.duration ?? 1;

  const schedules: CreateInput[] = [];
  for (let day = 0; day < days; day++) {
    for (const time of times) {
      schedules.push({
        prescriptionId,
        patientId: prescription.encounter.patientId,
        nurseId: null, // 투약 시 배정
        scheduledAt: addDays(startDate, day).setTime(time),
        route: prescription.route ?? 'PO',
        dose: prescription.dosage ?? '',
        status: 'SCHEDULED',
      });
    }
  }

  return this.prisma.medicationAdministration.createMany({ data: schedules });
}
```

---

## 5. Migration Strategy

### 5.1 실행 순서

```
Migration 1: create_emr_enums
  → ProblemStatus, ProblemSeverity, AllergyType, AllergySeverity,
    AllergyVerification, DischargeSummaryStatus, ConsentType,
    ConsentStatus, NursingDiagnosisStatus, NursingNoteType,
    ShiftType, IntakeType, OutputType, MedAdminStatus

Migration 2: create_emr_tables
  → problem_lists, allergies, discharge_summaries, consent_templates,
    nursing_assessments, nursing_diagnoses, nursing_notes,
    intake_outputs, medication_administrations

Migration 3: alter_consent_forms
  → ADD COLUMN template_id, consent_type, encounter_id, surgery_id,
    risks, alternatives, patient_signature, patient_signed_at,
    patient_signed_by, witness_signed_at, doctor_id,
    doctor_signed_at, status, revoked_at, revoked_reason

Migration 4: migrate_consent_data
  → UPDATE consent_forms SET patient_signed_by = signed_by
  → UPDATE consent_forms SET status = CASE ...
  → INSERT consent_templates (기본 템플릿)
  → UPDATE consent_forms SET template_id = ... WHERE template_name = ...

Migration 5: migrate_allergies
  → INSERT INTO allergies SELECT FROM patients.allergies JSON
  → (Patient.allergies 컬럼은 유지, 다음 릴리즈에서 제거)

Migration 6: add_relation_columns
  → Patient, Admission, Encounter, FallRiskAssessment 등에 relation 추가
```

### 5.2 알레르기 마이그레이션 SQL (완전판)

```sql
INSERT INTO allergies (
  id, patient_id, type, allergen, allergen_code, reaction,
  severity, verification_status, reported_by, recorded_by,
  is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  p.id,
  'DRUG',
  elem->>'name',
  NULL,
  'Unknown',                    -- 기존 JSON에 reaction 없음
  CASE elem->>'severity'
    WHEN 'high' THEN 'SEVERE'
    WHEN 'medium' THEN 'MODERATE'
    WHEN 'low' THEN 'MILD'
    ELSE 'MODERATE'
  END,
  'UNCONFIRMED',                -- 마이그레이션된 데이터는 미확인
  'Patient (migrated)',
  p.created_by,                 -- 환자 등록자를 기록자로
  true,
  NOW(),
  NOW()
FROM patients p,
     jsonb_array_elements(p.allergies) AS elem
WHERE jsonb_array_length(p.allergies) > 0;
```

---

## 6. Module Structure

### 6.1 Backend Module 파일 구조

```
apps/api/src/modules/
├── problem-list/
│   ├── problem-list.module.ts
│   ├── problem-list.controller.ts
│   ├── problem-list.service.ts
│   └── dto/
│       ├── create-problem.dto.ts
│       └── resolve-problem.dto.ts
│
├── allergy/
│   ├── allergy.module.ts
│   ├── allergy.controller.ts
│   ├── allergy.service.ts
│   └── dto/
│       ├── create-allergy.dto.ts
│       └── verify-allergy.dto.ts
│
├── discharge-summary/
│   ├── discharge-summary.module.ts
│   ├── discharge-summary.controller.ts
│   ├── discharge-summary.service.ts
│   └── dto/
│       ├── create-discharge-summary.dto.ts
│       └── sign-discharge-summary.dto.ts
│
├── consent-template/
│   ├── consent-template.module.ts
│   ├── consent-template.controller.ts
│   └── consent-template.service.ts
│
├── consent/                           ← 기존 모듈 확장
│   ├── consent.module.ts              ← ConsentTemplateModule import 추가
│   ├── consent.controller.ts          ← sign, revoke 엔드포인트 확장
│   ├── consent.service.ts             ← 전자서명/상태관리 로직 추가
│   └── dto/
│       ├── create-consent.dto.ts      ← 신규
│       ├── sign-consent.dto.ts        ← 신규
│       └── revoke-consent.dto.ts      ← 신규
│
├── nursing/
│   ├── nursing.module.ts
│   ├── nursing-assessment.controller.ts
│   ├── nursing-assessment.service.ts
│   ├── nursing-note.controller.ts
│   ├── nursing-note.service.ts
│   ├── intake-output.controller.ts
│   ├── intake-output.service.ts
│   ├── medication-administration.controller.ts
│   ├── medication-administration.service.ts
│   └── dto/
│       ├── create-nursing-assessment.dto.ts
│       ├── create-nursing-note.dto.ts
│       ├── create-intake-output.dto.ts
│       └── administer-med.dto.ts
│
└── prescription/
    └── dur/
        └── dur.service.ts             ← AllergyService 주입 + ALLERGY 타입 추가
```

### 6.2 Frontend Page 구조

```
apps/web/src/app/(main)/
├── patients/[id]/
│   ├── page.tsx                       ← 문제목록/알레르기 탭 추가
│   ├── problems/
│   │   └── page.tsx                   ← 문제목록 관리 페이지
│   └── allergies/
│       └── page.tsx                   ← 알레르기 관리 페이지
│
├── inpatient/
│   ├── [admissionId]/
│   │   ├── discharge-summary/
│   │   │   └── page.tsx               ← 퇴원요약 작성/조회
│   │   ├── nursing/
│   │   │   ├── assessment/
│   │   │   │   └── page.tsx           ← 간호초기평가
│   │   │   ├── notes/
│   │   │   │   └── page.tsx           ← 간호일지 (Focus Charting)
│   │   │   ├── io/
│   │   │   │   └── page.tsx           ← I/O 기록 + 24시간 집계
│   │   │   └── mar/
│   │   │       └── page.tsx           ← 투약확인 (MAR)
│   │   └── page.tsx                   ← 입원 상세 (기존 확장)
│
├── consent/
│   ├── page.tsx                       ← 기존 페이지 확장
│   └── templates/
│       └── page.tsx                   ← 동의서 템플릿 관리 (ADMIN)
```

---

## 7. Error Handling

| Code | HTTP | Message | 발생 조건 |
|------|------|---------|----------|
| `PROBLEM_NOT_FOUND` | 404 | Problem not found | 문제목록 ID 미존재 |
| `PROBLEM_ALREADY_RESOLVED` | 400 | Problem is already resolved | 이미 해결된 문제 재해결 |
| `ALLERGY_NOT_FOUND` | 404 | Allergy record not found | 알레르기 ID 미존재 |
| `ALLERGY_DRUG_CONFLICT` | 409 | Drug allergy conflict detected | 처방 시 알레르기 약물 |
| `DISCHARGE_SUMMARY_EXISTS` | 409 | Discharge summary already exists | 중복 퇴원요약 생성 |
| `DISCHARGE_NOT_ADMITTED` | 400 | Patient is not admitted | 미입원 환자 퇴원요약 |
| `DISCHARGE_ALREADY_SIGNED` | 400 | Already signed | 서명된 퇴원요약 재서명 |
| `CONSENT_NOT_FOUND` | 404 | Consent form not found | 동의서 ID 미존재 |
| `CONSENT_ALREADY_SIGNED` | 400 | Already signed | 서명된 동의서 재서명 |
| `CONSENT_ALREADY_REVOKED` | 400 | Already revoked | 철회된 동의서 재철회 |
| `CONSENT_TEMPLATE_NOT_FOUND` | 404 | Consent template not found | 템플릿 ID 미존재 |
| `NURSING_ASSESSMENT_EXISTS` | 409 | Assessment already exists | 중복 간호초기평가 |
| `ADMISSION_NOT_FOUND` | 404 | Admission not found | 입원 ID 미존재 |
| `MED_ADMIN_NOT_SCHEDULED` | 400 | Not in SCHEDULED status | 비예정 투약 확인 |
| `MED_ADMIN_ALREADY_DONE` | 400 | Already administered | 이미 투약된 건 재투약 |
| `FALL_RISK_NOT_FOUND` | 404 | Fall risk assessment not found | FK 참조 실패 |

**응답 형식 (CLAUDE.md 준수):**
```json
{
  "error": {
    "code": "ALLERGY_DRUG_CONFLICT",
    "message": "Drug allergy conflict: 페니실린 알레르기 환자에게 아목시실린 처방 불가",
    "details": {
      "allergyId": "...",
      "allergen": "페니실린",
      "medicationName": "아목시실린"
    }
  },
  "meta": { "timestamp": "..." }
}
```

---

## 8. Implementation Order

```
Phase A-1: EMR-04 문제목록 (1-2일)
  1. Prisma schema: ProblemList 모델 + enum 추가
  2. prisma migrate dev
  3. problem-list.service.ts → CRUD + resolve
  4. problem-list.controller.ts → REST endpoints
  5. DTOs (create, resolve)
  6. Patient 상세 페이지 문제목록 탭 추가
  7. 진료(Encounter) 작성 시 문제목록 연동 UI

Phase A-2: EMR-05 알레르기 (1-2일)
  1. Prisma schema: Allergy 모델 + enum 추가
  2. prisma migrate dev
  3. allergy.service.ts → CRUD + verify + checkDrugAllergy()
  4. allergy.controller.ts → REST endpoints
  5. dur.service.ts → AllergyService 주입 + ALLERGY 체크 추가
  6. Migration 5: Patient.allergies JSON → Allergy 행 변환 SQL
  7. Patient 상세 페이지 알레르기 탭 + 차트 배너
  8. 진료 작성 페이지 알레르기 경고 배너

Phase A-3: EMR-02 퇴원요약 (2-3일)
  1. Prisma schema: DischargeSummary 모델 + enum 추가
  2. prisma migrate dev
  3. discharge-summary.service.ts → CRUD + prefill + sign
  4. discharge-summary.controller.ts → REST endpoints
  5. Prefill 서비스 (진단/수술/검사/처방 자동 취합)
  6. 입원 상세 페이지 퇴원요약 탭
  7. Admission.dischargeSummary 텍스트 필드 deprecated 마킹

Phase A-4: EMR-03 동의서 (2-3일)
  1. Prisma schema: ConsentTemplate 모델 + ConsentForm ALTER
  2. prisma migrate dev
  3. Migration 4: 기존 ConsentForm 데이터 매핑 SQL
  4. consent-template.service.ts → CRUD
  5. consent.service.ts → 확장 (sign with signature, revoke with status)
  6. 기본 동의서 템플릿 시딩 (수술/마취/수혈/시술/연구/DNR)
  7. 동의서 페이지 확장 (전자서명 Canvas)
  8. 동의서 템플릿 관리 페이지 (ADMIN)

Phase B: EMR-01 간호기록 (3-5일)
  1. Prisma schema: NursingAssessment + NursingDiagnosis + NursingNote
                   + IntakeOutput + MedicationAdministration
  2. prisma migrate dev
  3. nursing-assessment.service.ts + controller
  4. nursing-note.service.ts + controller
  5. intake-output.service.ts + controller (24시간 집계 포함)
  6. medication-administration.service.ts + controller
     + generateSchedule() + administer() + hold()
  7. 간호초기평가 페이지 (FallRiskAssessment 연동)
  8. 간호일지 페이지 (Focus Charting DAR 폼)
  9. I/O 기록 페이지 (시간대별 입력 + 집계 차트)
  10. MAR 페이지 (투약 스케줄 타임라인 + 확인 체크)
```

---

## 9. Seed Data

### 9.1 동의서 기본 템플릿

```typescript
const consentTemplates = [
  { type: 'SURGERY', name: '수술 동의서', version: '1.0',
    content: { title: '수술 동의서', sections: ['수술명', '수술 목적', '예상 합병증', '대안 치료법'] },
    requiredFields: ['procedureName', 'risks', 'patientSignature', 'doctorSignature'] },
  { type: 'ANESTHESIA', name: '마취 동의서', version: '1.0',
    content: { title: '마취 동의서', sections: ['마취 방법', '위험 요인', '부작용'] },
    requiredFields: ['anesthesiaType', 'risks', 'patientSignature'] },
  { type: 'TRANSFUSION', name: '수혈 동의서', version: '1.0', ... },
  { type: 'PROCEDURE', name: '시술 동의서', version: '1.0', ... },
  { type: 'RESEARCH', name: '연구 참여 동의서', version: '1.0', ... },
  { type: 'DNR', name: '심폐소생술 거부(DNR) 동의서', version: '1.0', ... },
];
```

---

## 10. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-05-07 | 초기 설계서: Phase A(문제목록/알레르기/퇴원요약/동의서) + Phase B(간호기록) 전체 설계 |
| 0.2 | 2026-05-07 | Critical 4건 수정: C-1 ConsentForm 완전 Prisma 모델 정의, C-2 User 모델 relation 10건 추가, C-3 MAR nurseId nullable 변경, C-4 DiagnosisCode 역관계 추가. EMR-06~10 설계 제외 명시 |
