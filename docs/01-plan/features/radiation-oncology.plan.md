# 방사선종양학과 시스템 기획서

## 목표

방사선 치료의 계획/시뮬레이션/치료/추적 전 과정 관리: 종양위원회 → 치료 계획 → 시뮬레이션 → 분할 치료 → 경과 관찰

## 기능 설계

### 1. 방사선 치료 계획 (RT Plan)

```prisma
model RadiationPlan {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  diagnosis       String    @db.VarChar(200)     // "Rt. breast cancer, Stage IIA"
  diagnosisCode   String?   @map("diagnosis_code") @db.VarChar(20) // ICD-10
  intent          String    @db.VarChar(20)      // CURATIVE, PALLIATIVE, ADJUVANT, NEOADJUVANT
  technique       String    @db.VarChar(30)      // 3DCRT, IMRT, VMAT, SBRT, SRS, ELECTRON, PROTON, BRACHY
  site            String    @db.VarChar(100)     // "Rt. breast + SCL"
  totalDose       Decimal   @map("total_dose") @db.Decimal(6, 2) // 50.40 Gy
  fractionDose    Decimal   @map("fraction_dose") @db.Decimal(5, 2) // 1.80 Gy
  totalFractions  Int       @map("total_fractions") // 28회
  energy          String?   @db.VarChar(30)      // "6MV", "15MV", "6MV FFF"
  machine         String?   @db.VarChar(50)      // "TrueBeam #1", "Halcyon"
  simulationDate  DateTime? @map("simulation_date") @db.Date
  planApprovedAt  DateTime? @map("plan_approved_at") @db.Timestamptz()
  planApprovedBy  String?   @map("plan_approved_by") @db.Uuid
  startDate       DateTime? @map("start_date") @db.Date
  endDate         DateTime? @map("end_date") @db.Date
  status          String    @default("PLANNED") @db.VarChar(20)
  // PLANNED, SIMULATION, PLANNING, APPROVED, IN_TREATMENT, COMPLETED, CANCELLED
  prescribedBy    String    @map("prescribed_by") @db.Uuid
  notes           String?   @db.Text
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  patient         Patient   @relation(fields: [patientId], references: [id])
  fractions       RadiationFraction[]
  toxicities      RadiationToxicity[]
  @@map("radiation_plans")
}
```

### 2. 분할 치료 기록 (Fraction)

```prisma
model RadiationFraction {
  id            String    @id @default(uuid()) @db.Uuid
  planId        String    @map("plan_id") @db.Uuid
  fractionNumber Int      @map("fraction_number") // 1, 2, 3...
  scheduledDate DateTime  @map("scheduled_date") @db.Date
  deliveredAt   DateTime? @map("delivered_at") @db.Timestamptz()
  deliveredDose Decimal?  @map("delivered_dose") @db.Decimal(5, 2) // 실제 조사량 Gy
  cumulativeDose Decimal? @map("cumulative_dose") @db.Decimal(6, 2) // 누적 Gy
  setupVerified Boolean?  @map("setup_verified") // IGRT 영상 확인
  coneBeamCT    Boolean?  @map("cone_beam_ct")   // CBCT 시행
  therapistId   String?   @map("therapist_id") @db.Uuid
  status        String    @default("SCHEDULED") @db.VarChar(20) // SCHEDULED, DELIVERED, CANCELLED, SKIPPED
  notes         String?   @db.Text

  plan          RadiationPlan @relation(fields: [planId], references: [id])
  @@map("radiation_fractions")
}
```

### 3. 부작용 추적 (Toxicity)

```prisma
model RadiationToxicity {
  id          String   @id @default(uuid()) @db.Uuid
  planId      String   @map("plan_id") @db.Uuid
  week        Int      // 치료 주차
  skinGrade   Int?     @map("skin_grade")    // CTCAE Grade 0-4
  mucositisGrade Int?  @map("mucositis_grade")
  fatigueGrade Int?   @map("fatigue_grade")
  nauseaGrade Int?    @map("nausea_grade")
  painGrade   Int?    @map("pain_grade")
  otherToxicity Json? @map("other_toxicity") @db.JsonB // [{name, grade}]
  weight      Decimal? @db.Decimal(5, 1)
  ecog        Int?    // ECOG PS 0-4
  notes       String? @db.Text
  assessedBy  String  @map("assessed_by") @db.Uuid
  assessedAt  DateTime @default(now()) @map("assessed_at") @db.Timestamptz()

  plan        RadiationPlan @relation(fields: [planId], references: [id])
  @@map("radiation_toxicities")
}
```

### 4. API (16개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/radiation/plans` | 치료 계획 생성 |
| 2 | GET | `/api/v1/radiation/plans` | 계획 목록 |
| 3 | GET | `/api/v1/radiation/plans/:id` | 상세 (분할+부작용 포함) |
| 4 | PATCH | `/api/v1/radiation/plans/:id/status` | 상태 변경 |
| 5 | PATCH | `/api/v1/radiation/plans/:id/approve` | 계획 승인 |
| 6 | POST | `/api/v1/radiation/plans/:id/fractions/generate` | 분할 일정 자동 생성 |
| 7 | GET | `/api/v1/radiation/fractions/today` | 오늘 치료 스케줄 |
| 8 | PATCH | `/api/v1/radiation/fractions/:id/deliver` | 치료 완료 기록 |
| 9 | PATCH | `/api/v1/radiation/fractions/:id/cancel` | 치료 취소 |
| 10 | POST | `/api/v1/radiation/plans/:id/toxicity` | 부작용 기록 |
| 11 | GET | `/api/v1/radiation/plans/:id/toxicity` | 부작용 추이 |
| 12 | GET | `/api/v1/radiation/machines` | 치료기 목록 |
| 13 | GET | `/api/v1/radiation/machines/:id/schedule` | 기기별 일정 |
| 14 | GET | `/api/v1/radiation/dashboard` | 방사선과 대시보드 |
| 15 | GET | `/api/v1/radiation/patients/:id/history` | 환자 조사 이력 |
| 16 | GET | `/api/v1/radiation/stats` | 통계 (기법별, 부위별, 완료율) |

### 5. 화면 기획

```
방사선종양 (/radiation)
├── 치료 계획 (IMRT/VMAT/SBRT 설정)
├── 오늘 치료 스케줄 (기기별)
├── 분할 치료 기록 (누적 선량 차트)
├── 부작용 추적 (CTCAE Grade 추이)
├── 치료기 일정
└── 통계
```

#### 분할 치료 차트
```
환자: 김OO │ Rt. breast │ 50.4Gy/28Fx │ VMAT │ TrueBeam #1

누적 선량:
50 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 목표
40 ─────────────────────────●
30 ──────────────────●
20 ────────────●
10 ──────●
 0 ──●
   Fx1  5    10    15    20    25   28

부작용 추이:
피부 ○○○○●●●●●●●●●●●●●●●●●●●●●○○○  Grade 2 (Fx15~)
피로 ○○○○○○○○●●●●●●●●●●●●●●●●●●●●  Grade 1 (Fx9~)
```

## 구현 우선순위

1. 치료 계획 (RadiationPlan) + 상태 관리
2. 분할 치료 (자동 일정 생성 + 기록)
3. 부작용 추적 (CTCAE 등급)
4. 치료기 스케줄
