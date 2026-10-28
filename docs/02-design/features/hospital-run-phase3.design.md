# Hospital RUN Phase 3 Design Document

> **Version**: 0.1
> **Created**: 2026-05-06
> **Author**: user
> **Status**: Draft
> **Planning Doc**: [hospital-run-phase3.plan.md](../../01-plan/features/hospital-run-phase3.plan.md)

---

## 1. Overview

Phase 3는 OCS 수신 부서(약국/검사실/영상실) 실 운영 + 건강보험 청구 + 대시보드를 구현한다.

**Scope**: FR-05(약국), FR-06(검사실), FR-07(영상), FR-15(건강보험 청구), FR-09(대시보드)

---

## 2. Data Model

### 2.1 New Entities

```prisma
// ── 약국 (FR-05) ──

model Dispensing {
  id          String   @id @default(uuid()) @db.Uuid
  orderId     String   @unique @map("order_id") @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  pharmacistId String  @map("pharmacist_id") @db.Uuid
  
  items       DispensingItem[]
  status      DispensingStatus @default(PENDING)
  dispensedAt DateTime? @map("dispensed_at") @db.Timestamptz()
  verifiedAt  DateTime? @map("verified_at") @db.Timestamptz()
  notes       String?  @db.Text
  
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  order       Order    @relation(fields: [orderId], references: [id])
  patient     Patient  @relation(fields: [patientId], references: [id])
  pharmacist  User     @relation("PharmacistDispensings", fields: [pharmacistId], references: [id])

  @@map("dispensings")
}

model DispensingItem {
  id              String @id @default(uuid()) @db.Uuid
  dispensingId    String @map("dispensing_id") @db.Uuid
  medicationCodeId String @map("medication_code_id") @db.Uuid
  prescribedQty   Int    @map("prescribed_qty")
  dispensedQty    Int    @map("dispensed_qty")
  
  dispensing      Dispensing     @relation(fields: [dispensingId], references: [id])
  medicationCode  MedicationCode @relation(fields: [medicationCodeId], references: [id])

  @@map("dispensing_items")
}

enum DispensingStatus { PENDING DISPENSED VERIFIED CANCELLED }

// ── 검사실 (FR-06) ──

model LabResult {
  id          String   @id @default(uuid()) @db.Uuid
  orderId     String   @unique @map("order_id") @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  technicianId String  @map("technician_id") @db.Uuid
  
  items       LabResultItem[]
  status      LabResultStatus @default(PENDING)
  collectedAt DateTime? @map("collected_at") @db.Timestamptz()
  completedAt DateTime? @map("completed_at") @db.Timestamptz()
  notes       String?  @db.Text
  
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()

  order       Order   @relation(fields: [orderId], references: [id])
  patient     Patient @relation(fields: [patientId], references: [id])
  technician  User    @relation("TechnicianLabResults", fields: [technicianId], references: [id])

  @@map("lab_results")
}

model LabResultItem {
  id          String @id @default(uuid()) @db.Uuid
  labResultId String @map("lab_result_id") @db.Uuid
  testName    String @map("test_name") @db.VarChar(200)
  value       String @db.VarChar(100)
  unit        String @db.VarChar(50)
  normalMin   Decimal? @map("normal_min") @db.Decimal(10, 3)
  normalMax   Decimal? @map("normal_max") @db.Decimal(10, 3)
  flag        String?  @db.VarChar(10)    // "H" (High), "L" (Low), "N" (Normal)
  
  labResult   LabResult @relation(fields: [labResultId], references: [id])

  @@map("lab_result_items")
}

enum LabResultStatus { PENDING COLLECTED IN_PROGRESS COMPLETED }

// ── 영상실 (FR-07) ──

model ImagingResult {
  id          String   @id @default(uuid()) @db.Uuid
  orderId     String   @unique @map("order_id") @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  radiologistId String? @map("radiologist_id") @db.Uuid
  
  modality    String   @db.VarChar(50)    // X-ray, CT, MRI, US
  bodyPart    String?  @map("body_part") @db.VarChar(100)
  finding     String?  @db.Text           // 판독 소견
  impression  String?  @db.Text           // 판독 결론
  status      ImagingResultStatus @default(ORDERED)
  
  acquiredAt  DateTime? @map("acquired_at") @db.Timestamptz()
  reportedAt  DateTime? @map("reported_at") @db.Timestamptz()
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()

  order       Order   @relation(fields: [orderId], references: [id])
  patient     Patient @relation(fields: [patientId], references: [id])

  @@map("imaging_results")
}

enum ImagingResultStatus { ORDERED ACQUIRED REPORTED }

// ── 건강보험 청구 (FR-15) ──

model Claim {
  id          String   @id @default(uuid()) @db.Uuid
  billingId   String   @map("billing_id") @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  
  claimNumber String?  @unique @map("claim_number") @db.VarChar(50)
  claimDate   DateTime @map("claim_date") @db.Date
  
  // 금액
  claimedAmount  Int   @map("claimed_amount")      // 청구 금액
  approvedAmount Int?  @map("approved_amount")     // 인정 금액
  paidAmount     Int?  @map("paid_amount")         // 지급 금액
  reducedAmount  Int?  @map("reduced_amount")      // 삭감 금액
  
  status      ClaimStatus @default(DRAFT)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz()
  reviewedAt  DateTime? @map("reviewed_at") @db.Timestamptz()
  paidAt      DateTime? @map("paid_at") @db.Timestamptz()
  
  rejectReason String? @map("reject_reason") @db.Text
  claimData   Json?    @map("claim_data") @db.JsonB  // HIRA 청구 포맷 데이터
  
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  billing     Billing  @relation(fields: [billingId], references: [id])
  patient     Patient  @relation(fields: [patientId], references: [id])

  @@index([status])
  @@index([claimDate])
  @@map("claims")
}

enum ClaimStatus { DRAFT SUBMITTED UNDER_REVIEW APPROVED PARTIALLY_APPROVED REJECTED PAID }
```

---

## 3. API Specification

### 3.1 Pharmacy API (FR-05)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/pharmacy/queue` | 조제 대기열 | PHARMACIST |
| POST | `/api/v1/pharmacy/dispense/:orderId` | 조제 시작 | PHARMACIST |
| PATCH | `/api/v1/pharmacy/dispense/:id/complete` | 조제 완료 | PHARMACIST |
| PATCH | `/api/v1/pharmacy/dispense/:id/verify` | 투약 확인 | PHARMACIST |

### 3.2 Lab API (FR-06)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/lab/queue` | 검사 대기열 | LAB_TECH |
| POST | `/api/v1/lab/collect/:orderId` | 채혈/검체 접수 | LAB_TECH |
| POST | `/api/v1/lab/result/:orderId` | 결과 입력 (items) | LAB_TECH |
| GET | `/api/v1/lab/result/:orderId` | 결과 조회 | DOCTOR, LAB_TECH |
| GET | `/api/v1/patients/:id/lab-results` | 환자별 검사 이력 | DOCTOR |

### 3.3 Imaging API (FR-07)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/imaging/queue` | 영상 대기열 | LAB_TECH, ADMIN |
| PATCH | `/api/v1/imaging/:orderId/acquire` | 촬영 완료 | LAB_TECH |
| POST | `/api/v1/imaging/:orderId/report` | 판독 결과 입력 | DOCTOR |
| GET | `/api/v1/patients/:id/imaging-results` | 환자별 영상 이력 | DOCTOR |

### 3.4 Claim API (FR-15)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/claims` | 청구 목록 (상태/날짜 필터) | ADMIN |
| POST | `/api/v1/claims/generate` | 청구 데이터 일괄 생성 (미청구 수납 대상) | ADMIN |
| GET | `/api/v1/claims/:id` | 청구 상세 (HIRA 데이터 포함) | ADMIN |
| PATCH | `/api/v1/claims/:id/submit` | 청구 제출 (DRAFT→SUBMITTED) | ADMIN |
| PATCH | `/api/v1/claims/:id/review` | 심사 결과 입력 | ADMIN |
| GET | `/api/v1/claims/summary` | 월별 청구 요약 (청구액/인정액/삭감액) | ADMIN |

### 3.5 Dashboard API (FR-09)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/dashboard/overview` | 오늘 요약 (환자/예약/진료/수납) | ALL |
| GET | `/api/v1/dashboard/stats` | 기간별 통계 (일/주/월) | ADMIN |
| GET | `/api/v1/dashboard/orders` | 부서별 오더 현황 | ALL |

---

## 4. Key Business Logic

### 4.1 검사 결과 정상/이상 자동 판정

```typescript
function flagResult(value: number, normalMin: number, normalMax: number): string {
  if (value < normalMin) return 'L';  // Low
  if (value > normalMax) return 'H';  // High
  return 'N';                          // Normal
}

// 기본 참고치 (시딩)
const NORMAL_RANGES = [
  { test: 'WBC', unit: '10³/μL', min: 4.0, max: 10.0 },
  { test: 'RBC', unit: '10⁶/μL', min: 4.0, max: 5.5 },
  { test: 'Hemoglobin', unit: 'g/dL', min: 12.0, max: 17.0 },
  { test: 'PLT', unit: '10³/μL', min: 150, max: 400 },
  { test: 'AST', unit: 'U/L', min: 0, max: 40 },
  { test: 'ALT', unit: 'U/L', min: 0, max: 40 },
  { test: 'Glucose', unit: 'mg/dL', min: 70, max: 110 },
  { test: 'Creatinine', unit: 'mg/dL', min: 0.6, max: 1.2 },
  { test: 'BUN', unit: 'mg/dL', min: 7, max: 20 },
  { test: 'CRP', unit: 'mg/L', min: 0, max: 5 },
];
```

### 4.2 건강보험 청구 데이터 구조

```typescript
interface HiraClaimData {
  claimHeader: {
    medicalInstitutionCode: string;  // 요양기관 번호
    claimYearMonth: string;          // 청구 년월 (YYYYMM)
    patientName: string;
    insuranceNumber: string;
    treatmentStartDate: string;       // 진료 시작일
    treatmentEndDate: string;
    totalDays: number;               // 진료 일수
  };
  procedures: {
    code: string;                    // EDI 코드
    name: string;
    quantity: number;
    days: number;
    unitPrice: number;
    amount: number;
  }[];
  medications: {
    code: string;
    name: string;
    dosage: string;
    frequency: string;
    days: number;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
  totals: {
    totalAmount: number;
    insuranceClaimed: number;
    patientCopay: number;
  };
}
```

### 4.3 대시보드 집계 쿼리

```typescript
// DashboardService.getOverview()
async getOverview() {
  const today = startOfDay(new Date());
  const [patients, todayAppointments, todayEncounters, pendingBillings, ordersByDept] = await Promise.all([
    this.prisma.patient.count({ where: { validTo: null } }),
    this.prisma.appointment.count({ where: { scheduledAt: { gte: today }, status: { not: 'CANCELLED' } } }),
    this.prisma.encounter.count({ where: { createdAt: { gte: today } } }),
    this.prisma.billing.count({ where: { status: 'PENDING' } }),
    this.prisma.order.groupBy({ by: ['department', 'status'], _count: true }),
  ]);
  return { patients, todayAppointments, todayEncounters, pendingBillings, ordersByDept };
}
```

---

## 5. Frontend Pages

| Page | Path | Description |
|------|------|-------------|
| 약국 조제 | `/pharmacy` | 조제 대기열 + 디스펜싱 처리 |
| 검사실 | `/lab` | 검사 대기열 + 결과 입력 |
| 영상실 | `/imaging` | 영상 대기열 + 판독 입력 |
| 청구 관리 | `/claims` | 청구 목록 + 일괄 생성 + 상세 |
| 대시보드 | `/dashboard` (강화) | 통계 카드 + 차트 + 실시간 현황 |

---

## 6. Implementation Order

| Step | Scope | Duration | 선행 |
|:----:|-------|----------|------|
| 1 | Prisma 스키마 확장 | 2일 | - |
| 2 | PharmacyModule | 4일 | Step 1 |
| 3 | LabModule | 3일 | Step 1 |
| 4 | ImagingModule | 2일 | Step 1 |
| 5 | ClaimModule | 5일 | Step 1 |
| 6 | DashboardModule | 3일 | Step 1 |
| 7 | Frontend — 약국/검사/영상 | 5일 | Step 2-4 |
| 8 | Frontend — 청구 관리 | 4일 | Step 5 |
| 9 | Frontend — 대시보드 강화 | 4일 | Step 6 |
| 10 | 테스트 + QA | 4일 | All |

**총 예상: ~12주 (36 days)**

---

## 7. Success Criteria

- [ ] 약국 디스펜싱 워크플로우 완전 동작
- [ ] 검사 결과 입력 + H/L/N 자동 판정
- [ ] 영상 판독 소견/결론 기록
- [ ] 건강보험 청구 데이터 생성 (HIRA 포맷 JSON)
- [ ] 대시보드 실시간 현황 (5개 통계 카드)
- [ ] TypeScript 0 errors, 테스트 60%+

---

## Document History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial draft — Phase 3 설계 | user |
