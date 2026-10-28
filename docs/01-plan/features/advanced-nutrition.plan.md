# 영양관리 고도화 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:2817 model NutritionAssessment · apps/api/prisma/schema.prisma:2934 model SpecialNutritionOrder · apps/api/prisma/schema.prisma:2961 model NutritionCounsel · 잔여: 없음

## 현재 상태

### 이미 구현된 것
- MealOrder: 식사 주문 (입원환자, 식사유형, 식이유형, 알레르기)
- API 4개: 식사 목록, 생성, 일괄 생성, 상태 변경 (ORDERED→PREPARED→DELIVERED)
- 식이유형: 일반식, 저염식, 당뇨식, 유동식, 금식

### 부족한 것
- 영양 평가/영양 상태 기록 없음
- 식이 처방 (의사 처방 → 급양실 연동) 없음
- 영양 상담 기록 없음
- 식단 관리 (메뉴 편성, 영양소 계산) 없음
- 특수 영양 (경장영양, 정맥영양 TPN) 없음
- 알레르기 자동 필터링 없음
- 환자 선호도/만족도 없음

## 기능 설계

### 1. 영양 평가 (Nutrition Assessment)

```prisma
model NutritionAssessment {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  admissionId   String?  @map("admission_id") @db.Uuid
  assessmentType String  @map("assessment_type") @db.VarChar(30)
  // INITIAL (입원 시), FOLLOW_UP (추적), DISCHARGE (퇴원 시)
  height        Decimal? @db.Decimal(5, 1) // cm
  weight        Decimal? @db.Decimal(5, 1) // kg
  bmi           Decimal? @db.Decimal(4, 1)
  albumin       Decimal? @db.Decimal(4, 1) // g/dL
  prealbumin    Decimal? @db.Decimal(5, 1) // mg/dL
  nrsScore      Int?     @map("nrs_score") // NRS-2002 (0-7)
  mustScore     Int?     @map("must_score") // MUST (0-6+)
  riskLevel     String?  @map("risk_level") @db.VarChar(20) // LOW, MODERATE, HIGH
  intakeStatus  String?  @map("intake_status") @db.VarChar(20) // ADEQUATE, REDUCED, MINIMAL, NPO
  swallowingDifficulty Boolean? @map("swallowing_difficulty")
  dentalProblems Boolean? @map("dental_problems")
  notes         String?  @db.Text
  assessedBy    String   @map("assessed_by") @db.Uuid
  assessedAt    DateTime @default(now()) @map("assessed_at") @db.Timestamptz()

  patient       Patient  @relation(fields: [patientId], references: [id])

  @@map("nutrition_assessments")
}
```

### 2. 식이 처방 (Diet Order)

```prisma
model DietOrder {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  admissionId   String   @map("admission_id") @db.Uuid
  dietType      String   @map("diet_type") @db.VarChar(50)
  // REGULAR (일반식), LOW_SALT (저염식), DIABETIC (당뇨식), LOW_FAT (저지방식),
  // SOFT (연식), LIQUID (유동식), CLEAR_LIQUID (맑은 유동식), NPO (금식),
  // RENAL (신장식), HEPATIC (간장식), HIGH_PROTEIN (고단백식), LOW_RESIDUE (저잔사식),
  // PUREED (갈은식), TUBE_FEEDING (경관영양), TPN (정맥영양)
  calorieTarget Int?     @map("calorie_target") // kcal/day
  proteinTarget Decimal? @map("protein_target") @db.Decimal(5, 1) // g/day
  fluidLimit    Int?     @map("fluid_limit") // mL/day (제한 시)
  restrictions  Json?    @db.JsonB // ["글루텐프리", "유당제한", "퓨린제한"]
  allergyNote   String?  @map("allergy_note") @db.Text
  texture       String?  @db.VarChar(30) // REGULAR, CHOPPED, MINCED, PUREED, LIQUID
  snackIncluded Boolean  @default(false) @map("snack_included")
  orderedBy     String   @map("ordered_by") @db.Uuid // 처방 의사
  startDate     DateTime @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date
  isActive      Boolean  @default(true) @map("is_active")
  notes         String?  @db.Text
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient       Patient  @relation(fields: [patientId], references: [id])

  @@index([admissionId, isActive])
  @@map("diet_orders")
}
```

### 3. 식단 관리 (Menu Management)

```prisma
model MenuTemplate {
  id            String   @id @default(uuid()) @db.Uuid
  name          String   @db.VarChar(200) // "일반식 A 코스"
  dietType      String   @map("diet_type") @db.VarChar(50)
  mealType      String   @map("meal_type") @db.VarChar(20) // BREAKFAST, LUNCH, DINNER, SNACK
  items         Json     @db.JsonB // [{name, portion, calories, protein, fat, carb, sodium}]
  totalCalories Int      @map("total_calories")
  totalProtein  Decimal  @map("total_protein") @db.Decimal(5, 1)
  totalSodium   Int?     @map("total_sodium") // mg
  isActive      Boolean  @default(true) @map("is_active")
  season        String?  @db.VarChar(20) // SPRING, SUMMER, FALL, WINTER

  @@map("menu_templates")
}

model NutritionCounsel {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  counselType   String   @map("counsel_type") @db.VarChar(30)
  // INITIAL, FOLLOW_UP, DISCHARGE, OUTPATIENT
  topic         String   @db.VarChar(200) // "당뇨식이 교육", "저염식 안내"
  content       String   @db.Text
  dietaryGoals  Json?    @map("dietary_goals") @db.JsonB // [{goal, target, method}]
  duration      Int?     // 상담 시간 (분)
  counseledBy   String   @map("counseled_by") @db.Uuid
  counseledAt   DateTime @default(now()) @map("counseled_at") @db.Timestamptz()
  followUpDate  DateTime? @map("follow_up_date") @db.Date

  patient       Patient  @relation(fields: [patientId], references: [id])

  @@map("nutrition_counsels")
}
```

### 4. 특수 영양 (Enteral/Parenteral)

```prisma
model EnteralFeeding {
  id            String   @id @default(uuid()) @db.Uuid
  admissionId   String   @map("admission_id") @db.Uuid
  formulaName   String   @map("formula_name") @db.VarChar(100) // "뉴케어 RTH", "글루세르나"
  route         String   @db.VarChar(30) // NG_TUBE, G_TUBE, J_TUBE
  rate          Int      // mL/hr
  totalVolume   Int      @map("total_volume") // mL/day
  caloriePerMl  Decimal  @map("calorie_per_ml") @db.Decimal(3, 2) // 1.0, 1.5, 2.0
  flushVolume   Int?     @map("flush_volume") // 물 세척 mL
  schedule      String?  @db.VarChar(100) // "06:00-22:00 연속주입", "3회 볼루스"
  status        String   @default("ACTIVE") @db.VarChar(20)
  startDate     DateTime @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date

  @@map("enteral_feedings")
}
```

### 5. API 설계

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/nutrition/assessment` | 영양 평가 기록 |
| 2 | GET | `/api/v1/nutrition/assessment/:patientId` | 환자 영양 평가 이력 |
| 3 | POST | `/api/v1/nutrition/diet-orders` | 식이 처방 |
| 4 | GET | `/api/v1/nutrition/diet-orders` | 식이 처방 목록 |
| 5 | PATCH | `/api/v1/nutrition/diet-orders/:id` | 식이 처방 수정/종료 |
| 6 | GET | `/api/v1/nutrition/menus` | 식단 템플릿 목록 |
| 7 | POST | `/api/v1/nutrition/menus` | 식단 등록 |
| 8 | POST | `/api/v1/nutrition/counsel` | 영양 상담 기록 |
| 9 | GET | `/api/v1/nutrition/counsel/:patientId` | 상담 이력 |
| 10 | POST | `/api/v1/nutrition/enteral` | 경장영양 처방 |
| 11 | GET | `/api/v1/nutrition/dashboard` | 급양실 대시보드 (식수현황, 식이분포) |

### 6. 화면 기획

```
급식 관리 (/nutrition)
├── 식사 관리 (기존 + 개선)
├── 식이 처방
├── 영양 평가
├── 영양 상담
├── 식단 관리
└── 경장/정맥 영양
```

#### 급양실 대시보드
```
┌─ 오늘 식수 현황 ─────────────────────────────────────────────┐
│ 전체: 45  │  일반: 28  │  저염: 8  │  당뇨: 5  │  금식: 4    │
├───────────────────────────────────────────────────────────────┤
│ 조식 배식완료 ✓  │  중식 준비중  │  석식 대기                 │
└───────────────────────────────────────────────────────────────┘

┌─ 식이 분포 (파이차트) ──┬─ 알레르기 환자 ──────────────────────┐
│  일반식 62%             │  301호 김OO — 갑각류, 견과류         │
│  저염식 18%             │  402호 박OO — 우유, 계란             │
│  당뇨식 11%             │  503호 이OO — 페니실린 (약물)        │
│  기타 9%                │                                     │
└─────────────────────────┴─────────────────────────────────────┘
```

## 구현 우선순위

1. **식이 처방** (DietOrder) — 의사 처방 → 급양실 연동
2. **영양 평가** (NutritionAssessment) — NRS-2002 자동 계산
3. **영양 상담** (NutritionCounsel) — 상담 기록/추적
4. **식단 관리** (MenuTemplate) — 영양소 계산
5. **경장 영양** (EnteralFeeding) — 중환자/수술 후
