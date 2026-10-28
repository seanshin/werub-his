# Hospital RUN Phase 2 Design Document

> **Version**: 0.1
> **Created**: 2026-05-06
> **Author**: user
> **Status**: Draft
> **Planning Doc**: [hospital-run-phase2.plan.md](../../01-plan/features/hospital-run-phase2.plan.md)
> **Phase 1 Design**: [hospital-run.design.md](./hospital-run.design.md)

---

## 1. Overview

### 1.1 Scope

Phase 2는 한국형 HIS의 **진료 핵심 워크플로우**를 구현:
- 진료기록 (SOAP) + OCS + DUR + 수납 + JSON Form Engine

### 1.2 Module Dependency

```
Phase 1 (기존)                    Phase 2 (신규)
─────────────────    ─────────────────────────────────────
PatientModule   ──→  EncounterModule (진료기록)
ScheduleModule  ──→       │
CodeMasterModule──→  PrescriptionModule (처방+DUR)
AuthModule      ──→       │
                     OrderModule (OCS 오더)
                          │
                     BillingModule (수납)

                     FormEngineModule (독립)
```

---

## 2. Data Model

### 2.1 New Entities

#### Encounter (진료기록)

```typescript
interface Encounter {
  id: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;   // 예약 연결 (walk-in은 null)
  
  // SOAP Note
  subjective: string | null;       // 주관적 증상 (환자 호소)
  objective: string | null;        // 객관적 소견 (��사/진찰)
  assessment: string | null;       // 평가 (진단)
  plan: string | null;             // 계획 (치료 방침)
  
  // Diagnoses (KCD 코드, 다건)
  diagnoses: EncounterDiagnosis[];
  
  status: EncounterStatus;         // DRAFT → SIGNED → AMENDED
  signedAt: Date | null;
  
  createdAt: Date;
  updatedAt: Date;
}

enum EncounterStatus { DRAFT = 'DRAFT', SIGNED = 'SIGNED', AMENDED = 'AMENDED' }

interface EncounterDiagnosis {
  id: string;
  encounterId: string;
  diagnosisCodeId: string;        // FK → DiagnosisCode
  type: 'PRIMARY' | 'SECONDARY';
  notes: string | null;
}
```

#### Prescription (처방)

```typescript
interface Prescription {
  id: string;
  encounterId: string;
  type: PrescriptionType;          // MEDICATION | LAB | IMAGING
  
  // 약 처방 시
  medicationCodeId: string | null;
  dosage: string | null;           // "500mg"
  frequency: string | null;        // "1일 3회"
  duration: number | null;         // 일수
  quantity: number | null;         // 총 수량
  route: string | null;            // "경구", "주사"
  
  // 검사/영상 처방 시
  procedureCodeId: string | null;
  
  // DUR
  durChecked: boolean;
  durWarnings: Json | null;        // DUR 점검 결과 (경고 목록)
  durOverridden: boolean;          // 의사가 경고 무시하고 강제 처방
  
  instructions: string | null;     // 특이사항
  status: PrescriptionStatus;
  
  createdAt: Date;
  createdBy: string;
}

enum PrescriptionType { MEDICATION = 'MEDICATION', LAB = 'LAB', IMAGING = 'IMAGING' }
enum PrescriptionStatus { ACTIVE = 'ACTIVE', CANCELLED = 'CANCELLED' }
```

#### Order (OCS 오더)

```typescript
interface Order {
  id: string;
  prescriptionId: string;
  department: OrderDepartment;     // PHARMACY | LAB | IMAGING
  status: OrderStatus;
  
  receivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  
  result: Json | null;             // 검사/영상 결과 (Phase 3에서 확장)
  notes: string | null;
  
  createdAt: Date;
  updatedAt: Date;
}

enum OrderDepartment { PHARMACY = 'PHARMACY', LAB = 'LAB', IMAGING = 'IMAGING' }
enum OrderStatus { ORDERED = 'ORDERED', RECEIVED = 'RECEIVED', IN_PROGRESS = 'IN_PROGRESS', COMPLETED = 'COMPLETED', CANCELLED = 'CANCELLED' }
```

#### Billing (수납)

```typescript
interface Billing {
  id: string;
  encounterId: string;
  patientId: string;
  
  // 금액
  totalAmount: number;             // 총 진료비 (원)
  insuranceCovered: number;        // 보험 부담금
  patientCopay: number;            // 본인부담금
  
  // 항목 내역
  items: BillingItem[];
  
  status: BillingStatus;
  paidAt: Date | null;
  paidAmount: number | null;
  
  createdAt: Date;
  updatedAt: Date;
}

interface BillingItem {
  id: string;
  billingId: string;
  codeType: 'PROCEDURE' | 'MEDICATION';
  codeId: string;                  // FK → ProcedureCode or MedicationCode
  codeName: string;
  quantity: number;
  unitPrice: number;
  amount: number;                  // quantity × unitPrice
  copayRate: number;               // 본인부담률
}

enum BillingStatus { PENDING = 'PENDING', PAID = 'PAID', PARTIAL = 'PARTIAL', CANCELLED = 'CANCELLED' }
```

#### FormSchema (JSON Form Engine)

```typescript
interface FormSchema {
  id: string;
  name: string;                    // "vital-signs", "symptom-checklist"
  version: string;                 // "1.0"
  locale: string;                  // "ko"
  schema: Json;                    // JSON Form 정의 (pages/sections/questions)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

interface FormSubmission {
  id: string;
  formSchemaId: string;
  patientId: string;
  encounterId: string | null;
  data: Json;                      // 제출된 폼 데이터
  submittedBy: string;
  submittedAt: Date;
}
```

### 2.2 Prisma Schema Extension

```prisma
// ── Encounter ──
enum EncounterStatus { DRAFT SIGNED AMENDED }
enum PrescriptionType { MEDICATION LAB IMAGING }
enum PrescriptionStatus { ACTIVE CANCELLED }
enum OrderDepartment { PHARMACY LAB IMAGING }
enum OrderStatus { ORDERED RECEIVED IN_PROGRESS COMPLETED CANCELLED }
enum BillingStatus { PENDING PAID PARTIAL CANCELLED }

model Encounter {
  id             String   @id @default(uuid()) @db.Uuid
  patientId      String   @map("patient_id") @db.Uuid
  doctorId       String   @map("doctor_id") @db.Uuid
  appointmentId  String?  @map("appointment_id") @db.Uuid
  subjective     String?  @db.Text
  objective      String?  @db.Text
  assessment     String?  @db.Text
  plan           String?  @db.Text
  status         EncounterStatus @default(DRAFT)
  signedAt       DateTime? @map("signed_at") @db.Timestamptz()
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  patient       Patient      @relation(fields: [patientId], references: [id])
  doctor        User         @relation("DoctorEncounters", fields: [doctorId], references: [id])
  appointment   Appointment? @relation(fields: [appointmentId], references: [id])
  diagnoses     EncounterDiagnosis[]
  prescriptions Prescription[]
  billing       Billing?
  formSubmissions FormSubmission[]

  @@index([patientId])
  @@index([doctorId])
  @@index([createdAt])
  @@map("encounters")
}

model EncounterDiagnosis {
  id              String @id @default(uuid()) @db.Uuid
  encounterId     String @map("encounter_id") @db.Uuid
  diagnosisCodeId String @map("diagnosis_code_id") @db.Uuid
  type            String @default("PRIMARY") @db.VarChar(20)
  notes           String? @db.Text

  encounter      Encounter     @relation(fields: [encounterId], references: [id])
  diagnosisCode  DiagnosisCode @relation(fields: [diagnosisCodeId], references: [id])

  @@map("encounter_diagnoses")
}

model Prescription {
  id               String @id @default(uuid()) @db.Uuid
  encounterId      String @map("encounter_id") @db.Uuid
  type             PrescriptionType
  medicationCodeId String? @map("medication_code_id") @db.Uuid
  procedureCodeId  String? @map("procedure_code_id") @db.Uuid
  dosage           String? @db.VarChar(100)
  frequency        String? @db.VarChar(100)
  duration         Int?
  quantity         Int?
  route            String? @db.VarChar(50)
  durChecked       Boolean @default(false) @map("dur_checked")
  durWarnings      Json?   @map("dur_warnings") @db.JsonB
  durOverridden    Boolean @default(false) @map("dur_overridden")
  instructions     String? @db.Text
  status           PrescriptionStatus @default(ACTIVE)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz()
  createdBy        String @map("created_by") @db.Uuid

  encounter       Encounter      @relation(fields: [encounterId], references: [id])
  medicationCode  MedicationCode? @relation(fields: [medicationCodeId], references: [id])
  procedureCode   ProcedureCode?  @relation(fields: [procedureCodeId], references: [id])
  orders          Order[]

  @@index([encounterId])
  @@map("prescriptions")
}

model Order {
  id              String @id @default(uuid()) @db.Uuid
  prescriptionId  String @map("prescription_id") @db.Uuid
  department      OrderDepartment
  status          OrderStatus @default(ORDERED)
  receivedAt      DateTime? @map("received_at") @db.Timestamptz()
  startedAt       DateTime? @map("started_at") @db.Timestamptz()
  completedAt     DateTime? @map("completed_at") @db.Timestamptz()
  result          Json? @db.JsonB
  notes           String? @db.Text
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  prescription    Prescription @relation(fields: [prescriptionId], references: [id])

  @@index([department, status])
  @@index([prescriptionId])
  @@map("orders")
}

model Billing {
  id              String @id @default(uuid()) @db.Uuid
  encounterId     String @unique @map("encounter_id") @db.Uuid
  patientId       String @map("patient_id") @db.Uuid
  totalAmount     Int    @map("total_amount")
  insuranceCovered Int   @map("insurance_covered")
  patientCopay    Int    @map("patient_copay")
  status          BillingStatus @default(PENDING)
  paidAt          DateTime? @map("paid_at") @db.Timestamptz()
  paidAmount      Int?   @map("paid_amount")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  encounter       Encounter @relation(fields: [encounterId], references: [id])
  patient         Patient   @relation(fields: [patientId], references: [id])
  items           BillingItem[]

  @@index([patientId])
  @@index([status])
  @@map("billings")
}

model BillingItem {
  id        String @id @default(uuid()) @db.Uuid
  billingId String @map("billing_id") @db.Uuid
  codeType  String @map("code_type") @db.VarChar(20)
  codeId    String @map("code_id") @db.Uuid
  codeName  String @map("code_name") @db.VarChar(500)
  quantity  Int
  unitPrice Int    @map("unit_price")
  amount    Int
  copayRate Decimal @map("copay_rate") @db.Decimal(5, 4)

  billing   Billing @relation(fields: [billingId], references: [id])

  @@map("billing_items")
}

model FormSchema {
  id        String  @id @default(uuid()) @db.Uuid
  name      String  @unique @db.VarChar(100)
  version   String  @db.VarChar(20)
  locale    String  @default("ko") @db.VarChar(10)
  schema    Json    @db.JsonB
  isActive  Boolean @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  createdBy String  @map("created_by") @db.Uuid

  submissions FormSubmission[]

  @@map("form_schemas")
}

model FormSubmission {
  id           String   @id @default(uuid()) @db.Uuid
  formSchemaId String   @map("form_schema_id") @db.Uuid
  patientId    String   @map("patient_id") @db.Uuid
  encounterId  String?  @map("encounter_id") @db.Uuid
  data         Json     @db.JsonB
  submittedBy  String   @map("submitted_by") @db.Uuid
  submittedAt  DateTime @default(now()) @map("submitted_at") @db.Timestamptz()

  formSchema  FormSchema @relation(fields: [formSchemaId], references: [id])
  patient     Patient    @relation(fields: [patientId], references: [id])
  encounter   Encounter? @relation(fields: [encounterId], references: [id])

  @@index([patientId])
  @@index([formSchemaId])
  @@map("form_submissions")
}
```

---

## 3. API Specification

### 3.1 Encounter API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/encounters` | 진료기록 목록 (환자/의사/날짜 필터) | DOCTOR, ADMIN |
| POST | `/api/v1/encounters` | 진료 시작 (SOAP 생성) | DOCTOR |
| GET | `/api/v1/encounters/:id` | 진료기록 상세 (처방, 진단 포함) | DOCTOR, NURSE, ADMIN |
| PUT | `/api/v1/encounters/:id` | SOAP 노트 수정 | DOCTOR |
| PATCH | `/api/v1/encounters/:id/sign` | 진료 서명 (DRAFT→SIGNED) | DOCTOR |
| GET | `/api/v1/patients/:patientId/encounters` | 환자별 진료 이력 | DOCTOR, NURSE |

### 3.2 Prescription + DUR API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/encounters/:id/prescriptions` | 처방 추가 (DUR 자동 점검) | DOCTOR |
| GET | `/api/v1/encounters/:id/prescriptions` | 처방 목록 | DOCTOR, NURSE, PHARMACIST |
| DELETE | `/api/v1/prescriptions/:id` | 처방 취소 | DOCTOR |
| POST | `/api/v1/dur/check` | DUR 수동 점검 (처방 전 미리보기) | DOCTOR |

### 3.3 Order (OCS) API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/orders` | 오더 목록 (부서/상태 필터) | ALL |
| GET | `/api/v1/orders/queue/:department` | 부서별 대기열 | PHARMACIST, LAB_TECH |
| PATCH | `/api/v1/orders/:id/status` | 오더 상태 변경 | PHARMACIST, LAB_TECH |

### 3.4 Billing API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/billings` | 수납 목록 (상태/날짜 필터) | NURSE, ADMIN |
| GET | `/api/v1/billings/:id` | 수납 상세 (항목 내역) | NURSE, ADMIN |
| POST | `/api/v1/encounters/:id/billing` | 수납 생성 (자동 금액 산정) | NURSE, ADMIN |
| PATCH | `/api/v1/billings/:id/pay` | 수납 처리 | NURSE, ADMIN |

### 3.5 Form Engine API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/forms` | 폼 스키마 목록 | ALL |
| GET | `/api/v1/forms/:name` | 폼 스키마 상세 | ALL |
| POST | `/api/v1/forms` | 폼 스키마 생성 | ADMIN |
| PUT | `/api/v1/forms/:id` | 폼 스키마 수정 | ADMIN |
| POST | `/api/v1/forms/:name/submit` | 폼 데이터 제출 | DOCTOR, NURSE |
| GET | `/api/v1/patients/:patientId/form-data` | 환자별 폼 제출 이력 | DOCTOR, NURSE |

---

## 4. DUR 기본 룰 설계

### 4.1 DUR 데이터 구조

```typescript
// 약물 상호작용 룰 (초기 데이터로 시딩)
interface DurRule {
  id: string;
  drugA: string;          // 약품코드 또는 성분명
  drugB: string;
  severity: 'ERROR' | 'WARNING';
  description: string;    // "와파린과 아스피린 병용 시 출혈 위험 증가"
}
```

### 4.2 DUR 점검 로직

```typescript
// PrescriptionService.checkDur()
async checkDur(encounterId: string, newMedCode: string): Promise<DurWarning[]> {
  // 1. 현재 진료의 기존 처방 약품 목록 조회
  const existingMeds = await this.getActiveMedications(encounterId);
  
  // 2. 환자의 최근 30일 타 진료 처방도 조회
  const recentMeds = await this.getRecentPatientMeds(encounterId, 30);
  
  // 3. 상호작용 룰 테이블에서 매칭
  const allMeds = [...existingMeds, ...recentMeds];
  const warnings = await this.matchDurRules(newMedCode, allMeds);
  
  // 4. 중복 처방 체크 (동일 성분)
  const duplicates = await this.checkDuplicates(newMedCode, allMeds);
  
  return [...warnings, ...duplicates];
}
```

---

## 5. Billing 계산 로직

### 5.1 정액제 계산 (Phase 2 범위)

```typescript
// BillingService.calculateBilling()
async calculateBilling(encounterId: string): Promise<BillingCalc> {
  const encounter = await this.getEncounterWithPrescriptions(encounterId);
  const patient = await this.getPatient(encounter.patientId);
  
  const items: BillingItemCalc[] = [];
  
  // 1. 진찰료 (초진/재진 자동 판별)
  const consultCode = encounter.appointment?.type === 'INITIAL' ? 'AA157' : 'AA257';
  const consultFee = await this.getProcedurePrice(consultCode);
  items.push({ codeType: 'PROCEDURE', code: consultCode, ...consultFee });
  
  // 2. 처방별 금액
  for (const rx of encounter.prescriptions) {
    if (rx.type === 'MEDICATION' && rx.medicationCode) {
      items.push({
        codeType: 'MEDICATION',
        code: rx.medicationCode.code,
        unitPrice: rx.medicationCode.unitPrice,
        quantity: rx.quantity ?? 1,
      });
    } else if (rx.procedureCode) {
      items.push({
        codeType: 'PROCEDURE',
        code: rx.procedureCode.code,
        unitPrice: rx.procedureCode.unitPrice,
        quantity: 1,
      });
    }
  }
  
  // 3. 본인부���률 적용
  const copayRate = this.getCopayRate(patient.insuranceType);
  const totalAmount = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const patientCopay = Math.round(totalAmount * copayRate);
  
  return { totalAmount, insuranceCovered: totalAmount - patientCopay, patientCopay, items };
}

private getCopayRate(insuranceType: InsuranceType): number {
  const rates: Record<InsuranceType, number> = {
    NHI: 0.3,          // 건강보험 30%
    MEDICAID: 0.0,     // 의료급여 0%
    INDUSTRIAL: 0.0,   // 산재 0%
    AUTO: 0.0,         // 자보 0%
    SELF_PAY: 1.0,     // 자비 100%
  };
  return rates[insuranceType];
}
```

---

## 6. Frontend Pages (Phase 2)

### 6.1 New Pages

| Page | Path | Description |
|------|------|-------------|
| 진료 화면 | `/encounters/:appointmentId` | SOAP 에디터 + 처방 입력 + DUR |
| 환자 진료이력 | `/patients/:id/encounters` | 타임라인 형태 진료 기록 |
| 오더 대기열 | `/orders/queue` | 부서별(약국/검사/영상) 오더 목록 |
| 수납 목록 | `/billing` | 미수납/완료 목록 |
| 수납 처리 | `/billing/:id` | 수납 상세 + 결제 처리 |
| 폼 빌더 | `/admin/forms` | JSON 폼 스키마 관리 (Admin) |
| 바이탈 입력 | (진료 화면 내) | Form Engine 렌더러로 동적 폼 |

### 6.2 진료 화면 레이아웃

```
┌─────────────────────────────────────────────────────────────┐
│  환자: 홍길동 (HR-20260506-0001) | 초진 | 2026-05-10 09:00  │
├──────────────────────────┬──────────────────────────────────┤
│                          │                                  │
│  SOAP 노트 에디터         │  처방 입력 패널                   │
│                          │                                  │
│  [S] 주관적 증상          │  [약 처방] [검사] [영상]          │
│  ┌────────────────────┐  │  ┌──────────────────────────┐    │
│  │ 텍스트 에디터       │  │  │ 약품 검색: [       ]     │    │
│  └────────────────────┘  │  │ 용량: [    ] 횟수: [   ] │    │
│                          │  │ 일수: [    ]             │    │
│  [O] 객관적 소견          │  │ [DUR 점검 결과]          │    │
│  ┌────────────────────┐  │  │                          │    │
│  │ + 바이탈 폼 (Form)  │  │  │ [추가]                   │    │
│  └────────────────────┘  │  └──────────────────────────┘    │
│                          │                                  │
│  [A] 진단                │  처방 목록:                       │
│  ┌────────────────────┐  │  ┌──────────────────────────┐    │
│  │ KCD 검색: [  진단  ] │  │  │ 1. 아목시실린 500mg 3T  │    │
│  └────────────────────┘  │  │ 2. CBC 검사             │    │
│                          │  │ 3. 흉부 X-ray           │    │
│  [P] 계획                │  └──────────────────────────┘    │
│  ┌────────────────────┐  │                                  │
│  │ 텍스트 에디터       │  │  [진료 완료 + 수납 생성]         │
│  └────────────────────┘  │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

---

## 7. Implementation Order

| Step | Scope | Duration | 선행 |
|:----:|-------|----------|------|
| 1 | Prisma 스키마 확장 + 마이그레이션 | 2일 | - |
| 2 | EncounterModule — SOAP CRUD + 진단 연결 | 4일 | Step 1 |
| 3 | PrescriptionModule — 처방 입력 + DUR 기본 룰 | 4일 | Step 2 |
| 4 | OrderModule — OCS 오더 자동 생성 + 상태 관리 | 3일 | Step 3 |
| 5 | BillingModule — 정액제 계산 + 수납 처리 | 4일 | Step 2, 4 |
| 6 | FormEngineModule — 스키마 CRUD + 렌더러 | 5일 | Step 1 |
| 7 | Frontend — 진료 화면 (SOAP + 처방 + DUR) | 5일 | Step 3 |
| 8 | Frontend — 오더 대기열 + 수납 화면 | 4일 | Step 4, 5 |
| 9 | Frontend — Form Engine 렌더러 (바이탈) | 3일 | Step 6 |
| 10 | 테스트 + QA | 4일 | All |

**총 예상: ~10주 (38 working days)**

---

## 8. Success Criteria

- [ ] SOAP 노트 생성/수정/서명 완료
- [ ] 약/검사/영상 처방 → OCS 오더 자동 생성
- [ ] DUR 점검 결과 경고 표시 + 강제 처방 가능
- [ ] 정액제 수납 금액 자동 산정 + 수납 처리
- [ ] JSON Form Engine으로 바이탈 폼 렌더링/저장
- [ ] TypeScript 0 errors
- [ ] 테스트 커버리지 60%+ (서비스 레이어)

---

## Document History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial draft — Phase 2 상세 설계 | user |
