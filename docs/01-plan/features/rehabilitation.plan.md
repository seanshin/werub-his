# 재활의학과 시스템 기획서

## 목표

재활의학과의 평가/치료/추적 전 과정을 전자화: 기능 평가 → 치료 계획 → 치료 기록 → 경과 추적

## 기능 설계

### 1. 재활 평가 (Rehabilitation Assessment)

```prisma
model RehabAssessment {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  admissionId   String?  @map("admission_id") @db.Uuid
  assessmentType String  @map("assessment_type") @db.VarChar(30)
  // INITIAL, FOLLOW_UP, DISCHARGE, OUTPATIENT
  diagnosis     String   @db.VarChar(200)      // "Rt. hemiplegia (뇌졸중 후 우측 편마비)"
  onsetDate     DateTime? @map("onset_date") @db.Date
  // 기능 평가 도구
  barthel       Int?     // Barthel Index (0-100) — ADL 독립성
  fim           Int?     // FIM (18-126) — 기능적 독립성 측정
  mmt           Json?    @db.JsonB // Manual Muscle Test [{muscle, left, right}] (0-5 등급)
  rom           Json?    @db.JsonB // Range of Motion [{joint, movement, value, normal}]
  berg          Int?     // Berg Balance Scale (0-56)
  mmse          Int?     // Mini-Mental State Exam (0-30)
  vas           Int?     // Visual Analog Scale (0-10) — 통증
  gait          String?  @db.VarChar(100)      // "독립보행", "워커 보행", "휠체어"
  swallow       String?  @db.VarChar(100)      // 연하 평가 "정상", "유동식만", "경관영양"
  goals         Json?    @db.JsonB             // [{goal, target, timeline}]
  notes         String?  @db.Text
  assessedBy    String   @map("assessed_by") @db.Uuid
  assessedAt    DateTime @default(now()) @map("assessed_at") @db.Timestamptz()

  patient       Patient  @relation(fields: [patientId], references: [id])
  @@map("rehab_assessments")
}
```

### 2. 치료 계획 + 치료 기록

```prisma
model RehabPlan {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  diagnosis     String   @db.VarChar(200)
  startDate     DateTime @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date
  frequency     String   @db.VarChar(50)       // "주 5회", "주 3회"
  therapies     Json     @db.JsonB
  // [{type: "PT"|"OT"|"ST"|"COGNITIVE"|"AQUATIC", duration: 30, goals: "보행 독립"}]
  status        String   @default("ACTIVE") @db.VarChar(20)
  prescribedBy  String   @map("prescribed_by") @db.Uuid
  notes         String?  @db.Text
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient       Patient  @relation(fields: [patientId], references: [id])
  sessions      RehabSession[]
  @@map("rehab_plans")
}

model RehabSession {
  id            String   @id @default(uuid()) @db.Uuid
  planId        String   @map("plan_id") @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  therapyType   String   @map("therapy_type") @db.VarChar(20)
  // PT (물리치료), OT (작업치료), ST (언어치료), COGNITIVE (인지), AQUATIC (수치료)
  therapistId   String   @map("therapist_id") @db.Uuid
  scheduledAt   DateTime @map("scheduled_at") @db.Timestamptz()
  startTime     DateTime? @map("start_time") @db.Timestamptz()
  endTime       DateTime? @map("end_time") @db.Timestamptz()
  duration      Int?     // 실제 치료 시간 (분)
  activities    Json?    @db.JsonB  // [{name, sets, reps, resistance, notes}]
  vitals        Json?    @db.JsonB  // {hrBefore, hrAfter, bpBefore, bpAfter, painBefore, painAfter}
  progress      String?  @db.Text   // 치료사 소견
  status        String   @default("SCHEDULED") @db.VarChar(20) // SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW
  notes         String?  @db.Text

  plan          RehabPlan @relation(fields: [planId], references: [id])
  @@map("rehab_sessions")
}
```

### 3. API (14개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/rehab/assessments` | 재활 평가 |
| 2 | GET | `/api/v1/rehab/assessments/:patientId` | 환자 평가 이력 |
| 3 | POST | `/api/v1/rehab/plans` | 치료 계획 생성 |
| 4 | GET | `/api/v1/rehab/plans` | 치료 계획 목록 |
| 5 | GET | `/api/v1/rehab/plans/:id` | 계획 상세 (세션 포함) |
| 6 | PATCH | `/api/v1/rehab/plans/:id` | 계획 수정/종료 |
| 7 | POST | `/api/v1/rehab/sessions` | 치료 세션 예약 |
| 8 | GET | `/api/v1/rehab/sessions` | 세션 목록 (날짜/치료사) |
| 9 | PATCH | `/api/v1/rehab/sessions/:id/start` | 세션 시작 |
| 10 | PATCH | `/api/v1/rehab/sessions/:id/complete` | 세션 완료 (활동/활력징후/소견) |
| 11 | GET | `/api/v1/rehab/therapist/schedule` | 치료사 일정 |
| 12 | GET | `/api/v1/rehab/dashboard` | 재활 대시보드 |
| 13 | GET | `/api/v1/rehab/patients/:id/progress` | 환자 경과 추적 (Barthel/FIM 추이) |
| 14 | GET | `/api/v1/rehab/stats` | 재활 통계 |

### 4. 화면 기획

```
재활의학 (/rehab)
├── 환자 목록 (재활 대상자)
├── 재활 평가 (Barthel/FIM/MMT/ROM)
├── 치료 계획 (PT/OT/ST 일정)
├── 치료 기록 (세션별)
├── 경과 추적 (차트: 기능 점수 추이)
└── 치료사 스케줄
```

## 구현 우선순위

1. 재활 평가 (RehabAssessment) + Barthel/FIM
2. 치료 계획 (RehabPlan) + 세션 예약/기록
3. 경과 추적 차트
4. 치료사 스케줄
