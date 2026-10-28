# 전체 진료과 전용 차트 기획서

## 현재 현황

### 전용 차트 구현 완료 (4과)
| 과 | 전용 차트 | SVG |
|----|---------|:---:|
| 치과 | 치아 다이어그램 + 5면 + 치주 | ✅ |
| 안과 | 시력/안압/안저/시야 | ✅ |
| 피부과 | 바디맵 + ABCDE + 더모스코피 | ✅ |
| 이비인후과 | 청력도 + 고막 + 비강 | ✅ |

### 일반 SOAP 사용 중 (전용 차트 미구현)
- 내과, 외과, 정형외과, 신경외과, 소아청소년과, 산부인과
- 성형외과, 정신건강의학과, 비뇨의학과, 가정의학과
- 응급의학과, 마취통증의학과

## 전용 차트 필요 진료과

---

### 1. 정형외과 (Orthopedics)

#### 핵심 차트: 골격/관절 다이어그램 + ROM 측정

```
┌─ 정형외과 진료 화면 ────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─ 골격 다이어그램 (SVG) ──────────┐  ┌─ 검사/진단 ──────────────────────┐ │
│  │                                  │  │                                  │ │
│  │      [전신 골격 앞/뒤]           │  │  부위: [우측 무릎 ▼]             │ │
│  │                                  │  │  진단: [내측 반월판 파열 ____]    │ │
│  │  클릭 → 부위 선택                │  │                                  │ │
│  │  ● 통증 부위 마킹               │  │  ── ROM (관절가동범위) ──        │ │
│  │  ✕ 골절 부위 마킹               │  │  굴곡: [130° / 정상 135°]       │ │
│  │                                  │  │  신전: [-5° / 정상 0°]          │ │
│  │  [선택: 우측 무릎]               │  │  내회전: [25° / 정상 30°]       │ │
│  └──────────────────────────────────┘  │  외회전: [35° / 정상 40°]       │ │
│                                        │                                  │ │
│  ┌─ 특수 검사 ──────────────────────┐  │  ── 근력 (MMT) ──              │ │
│  │  McMurray: [+ / -]              │  │  대퇴사두근: [4/5]              │ │
│  │  Lachman: [+ / -]               │  │  햄스트링: [4/5]                │ │
│  │  Drawer: [전방+ / 후방-]        │  │                                  │ │
│  │  Varus/Valgus: [-/-]            │  │  ── 통증 ──                     │ │
│  │  Thompson: [-]                  │  │  VAS: [6/10] NRS: [6]           │ │
│  │                                  │  │  부위: 내측 관절선              │ │
│  │  NRS 통증: 6/10                 │  │  양상: 활동 시 악화              │ │
│  └──────────────────────────────────┘  │                                  │ │
│                                        │  [검사 저장]  [수술 의뢰]       │ │
│                                        └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 데이터 모델
```prisma
model OrthoExam {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  encounterId   String?  @map("encounter_id") @db.Uuid
  // 부위
  bodyPart      String   @map("body_part") @db.VarChar(50) // SHOULDER, ELBOW, WRIST, HIP, KNEE, ANKLE, SPINE_C, SPINE_T, SPINE_L
  side          String?  @db.VarChar(10) // LEFT, RIGHT, BILATERAL
  // ROM
  rom           Json?    @db.JsonB // [{movement, measured, normal}] — 굴곡/신전/내전/외전/내회전/외회전
  // 근력 MMT
  mmt           Json?    @db.JsonB // [{muscle, grade}] — 0~5 등급
  // 특수 검사
  specialTests  Json?    @map("special_tests") @db.JsonB // [{test, result: '+'/'-', notes}]
  // 통증
  painVas       Int?     @map("pain_vas") // 0-10
  painLocation  String?  @map("pain_location") @db.VarChar(100)
  painPattern   String?  @map("pain_pattern") @db.VarChar(100) // 활동시/안정시/야간
  // 영상 소견
  imagingFindings String? @map("imaging_findings") @db.Text
  // 진단/계획
  diagnosis     String?  @db.Text
  plan          String?  @db.Text
  examinedBy    String   @map("examined_by") @db.Uuid
  examinedAt    DateTime @default(now()) @map("examined_at") @db.Timestamptz()
  patient       Patient  @relation(fields: [patientId], references: [id])
  @@map("ortho_exams")
}
```

#### SVG 컴포넌트: SkeletonDiagram
- 전신 골격 앞/뒤 뷰
- 관절 부위 클릭 → 선택
- 통증 마커(빨강 ●), 골절 마커(X), 수술 부위(파랑 ■)
- 선택 부위의 ROM/MMT/특수검사 표시

#### 특수 검사 목록
| 부위 | 검사 |
|------|------|
| 어깨 | Neer, Hawkins, Empty Can, Speed, O'Brien |
| 팔꿈치 | Cozen, Mill, Tinel |
| 손목/수부 | Phalen, Tinel, Finkelstein, Allen |
| 고관절 | Thomas, FABER, Trendelenburg |
| 무릎 | McMurray, Lachman, Drawer, Varus/Valgus, Pivot Shift |
| 발목/족부 | Thompson, Drawer, Talar Tilt |
| 경추 | Spurling, Lhermitte, Distraction |
| 요추 | SLR, Lasegue, Schober |

---

### 2. 산부인과 (Obstetrics & Gynecology)

#### 핵심 차트: 산전 기록 + 태아 모니터링

```
┌─ 산부인과 진료 화면 ────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─ 산전 기록 (Prenatal) ───────────┐  ┌─ 검사/시술 ─────────────────────┐ │
│  │  임신주수: 28주 3일               │  │                                 │ │
│  │  분만예정일: 2026-08-15           │  │  ── 초음파 ──                   │ │
│  │  G2P1 (임신2회, 출산1회)          │  │  BPD: [72mm]  FL: [54mm]       │ │
│  │                                   │  │  AC: [245mm]  EFW: [1250g]     │ │
│  │  ── 산모 활력징후 ──             │  │  AFI: [14cm]  태위: [두위]      │ │
│  │  체중: [72.5kg] (임신 전 58kg)    │  │  태반위치: [전벽 상부]          │ │
│  │  혈압: [120/75]                   │  │                                 │ │
│  │  소변 단백: [-]  당: [-]          │  │  ── NST (태아 심박수) ──       │ │
│  │  부종: [하지 1+]                  │  │  Baseline: [140bpm]            │ │
│  │                                   │  │  Variability: [moderate]       │ │
│  │  ── 자궁저 높이 ──              │  │  Accelerations: [+]            │ │
│  │  FH: [28cm]                       │  │  Decelerations: [-]            │ │
│  │  태아심음: [140bpm]               │  │  Reactive: [Yes]               │ │
│  │  태동: [활발]                     │  │                                 │ │
│  │                                   │  │  ── 자궁경부 ──               │ │
│  │  ── 임신 경과 차트 ──           │  │  개대: [___cm]                  │ │
│  │  체중 추이 그래프                 │  │  소실: [___%]                   │ │
│  │  혈압 추이 그래프                 │  │  하강도: [station ___]          │ │
│  │                                   │  │                                 │ │
│  └───────────────────────────────────┘  │  [검사 저장]                    │ │
│                                         └─────────────────────────────────┘ │
│                                                                             │
│  ── 부인과 검사 (비임신) ──                                                 │
│  Pap smear: [___]  HPV: [___]  자궁경부 세포진: [___]                      │
│  골반 초음파: [자궁 정상 / 난소 정상]                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 데이터 모델
```prisma
model ObGynExam {
  id              String   @id @default(uuid()) @db.Uuid
  patientId       String   @map("patient_id") @db.Uuid
  examType        String   @map("exam_type") @db.VarChar(20) // PRENATAL, GYNECOLOGY, LABOR, POSTPARTUM
  // 산과 (Obstetric)
  gestationalAge  String?  @map("gestational_age") @db.VarChar(20) // "28W3D"
  edd             DateTime? @db.Date // 분만예정일
  gravida         Int?     // 임신 횟수
  para            Int?     // 출산 횟수
  prePregnancyWeight Decimal? @map("pre_pregnancy_weight") @db.Decimal(5,1)
  currentWeight   Decimal? @map("current_weight") @db.Decimal(5,1)
  bloodPressure   String?  @map("blood_pressure") @db.VarChar(20)
  urineProtein    String?  @map("urine_protein") @db.VarChar(10)
  urineGlucose    String?  @map("urine_glucose") @db.VarChar(10)
  edema           String?  @db.VarChar(20) // NONE, MILD(1+), MODERATE(2+), SEVERE(3+)
  fundalHeight    Decimal? @map("fundal_height") @db.Decimal(4,1) // cm
  fetalHeartRate  Int?     @map("fetal_heart_rate") // bpm
  fetalMovement   String?  @map("fetal_movement") @db.VarChar(20) // ACTIVE, DECREASED, ABSENT
  // 초음파
  ultrasound      Json?    @db.JsonB // {bpd, fl, ac, efw, afi, presentation, placentaLocation}
  // NST
  nst             Json?    @db.JsonB // {baseline, variability, accelerations, decelerations, reactive}
  // 자궁경부 (분만)
  cervicalDilation Decimal? @map("cervical_dilation") @db.Decimal(3,1) // cm
  effacement      Int?     // %
  station         Int?     // -3 ~ +3
  // 부인과
  papSmear        String?  @map("pap_smear") @db.VarChar(50)
  hpvTest         String?  @map("hpv_test") @db.VarChar(50)
  pelvicUltrasound Json?   @map("pelvic_ultrasound") @db.JsonB
  diagnosis       String?  @db.Text
  plan            String?  @db.Text
  examinedBy      String   @map("examined_by") @db.Uuid
  examinedAt      DateTime @default(now()) @map("examined_at") @db.Timestamptz()
  patient         Patient  @relation(fields: [patientId], references: [id])
  @@map("obgyn_exams")
}
```

#### SVG 컴포넌트
- **PregnancyProgressChart** — 임신 주수별 체중/혈압/자궁저 높이 추이
- **FetalGrowthChart** — BPD/FL/AC/EFW 성장 곡선 (백분위 그리드)
- **PartogramChart** — 분만 진행도 (경부 개대 + 하강도 vs 시간)

---

### 3. 소아청소년과 (Pediatrics)

#### 핵심 차트: 성장 곡선 + 예방접종 + 발달 평가

```
┌─ 소아 진료 화면 ────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─ 성장 측정 ──────────────────────┐  ┌─ 성장 곡선 (Chart.js) ──────────┐ │
│  │  연령: 3세 4개월 (남아)          │  │                                  │ │
│  │  체중: [14.5kg] → 50th 백분위   │  │  [체중 곡선] [신장 곡선] [BMI]   │ │
│  │  신장: [96.5cm] → 60th 백분위   │  │                                  │ │
│  │  두위: [49.5cm] → 55th 백분위   │  │  97th ─ ─ ─ ─ ─ ─              │ │
│  │  BMI:  [15.6] → 정상            │  │  50th ────●────●────●──         │ │
│  │                                   │  │   3th ─ ─ ─ ─ ─ ─              │ │
│  │  ── 활력징후 ──                  │  │        출생  6개월  1세  2세  3세 │ │
│  │  체온: [36.5°C]                   │  └──────────────────────────────────┘ │
│  │  맥박: [100/min]                  │                                      │
│  │  호흡: [24/min]                   │  ┌─ 예방접종 현황 ────────────────┐  │
│  └───────────────────────────────────┘  │  BCG:       ✓ 완료 (2023-03)  │  │
│                                         │  HepB:      ✓✓✓ 완료          │  │
│  ┌─ 발달 평가 ──────────────────────┐  │  DTaP:      ✓✓✓✓ 4차 완료     │  │
│  │  대근육: [정상 / 지연]           │  │  IPV:       ✓✓✓ 3차 완료      │  │
│  │  소근육: [정상 / 지연]           │  │  MMR:       ✓ 1차 완료         │  │
│  │  언어:   [정상 / 지연]           │  │  수두:      ✓ 완료             │  │
│  │  사회성: [정상 / 지연]           │  │  일본뇌염:  ✓✓ 2차까지        │  │
│  │  Denver II: [정상]                │  │  인플루엔자: ⚠ 미접종          │  │
│  └───────────────────────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 데이터 모델
```prisma
model PediatricGrowth {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  ageMonths   Int      @map("age_months")
  weight      Decimal? @db.Decimal(5,2) // kg
  height      Decimal? @db.Decimal(5,1) // cm
  headCirc    Decimal? @map("head_circ") @db.Decimal(4,1) // cm
  bmi         Decimal? @db.Decimal(4,1)
  weightPercentile Int? @map("weight_percentile")
  heightPercentile Int? @map("height_percentile")
  bmiPercentile    Int? @map("bmi_percentile")
  measuredAt  DateTime @default(now()) @map("measured_at") @db.Timestamptz()
  measuredBy  String   @map("measured_by") @db.Uuid
  patient     Patient  @relation(fields: [patientId], references: [id])
  @@map("pediatric_growths")
}

model Immunization {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  vaccineName String   @map("vaccine_name") @db.VarChar(100)
  vaccineCode String?  @map("vaccine_code") @db.VarChar(20)
  doseNumber  Int      @map("dose_number")
  givenAt     DateTime @map("given_at") @db.Timestamptz()
  site        String?  @db.VarChar(30) // LEFT_ARM, RIGHT_ARM, LEFT_THIGH
  lotNumber   String?  @map("lot_number") @db.VarChar(50)
  manufacturer String? @db.VarChar(100)
  givenBy     String   @map("given_by") @db.Uuid
  nextDueDate DateTime? @map("next_due_date") @db.Date
  notes       String?  @db.Text
  patient     Patient  @relation(fields: [patientId], references: [id])
  @@map("immunizations")
}

model DevelopmentalAssessment {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  ageMonths     Int      @map("age_months")
  tool          String   @db.VarChar(30) // DENVER_II, K-ASQ, BAYLEY
  grossMotor    String   @map("gross_motor") @db.VarChar(20) // NORMAL, SUSPECT, DELAYED
  fineMotor     String   @map("fine_motor") @db.VarChar(20)
  language      String   @db.VarChar(20)
  socialPersonal String  @map("social_personal") @db.VarChar(20)
  overallResult String   @map("overall_result") @db.VarChar(20) // NORMAL, SUSPECT, ABNORMAL
  details       Json?    @db.JsonB
  assessedBy    String   @map("assessed_by") @db.Uuid
  assessedAt    DateTime @default(now()) @map("assessed_at") @db.Timestamptz()
  patient       Patient  @relation(fields: [patientId], references: [id])
  @@map("developmental_assessments")
}
```

#### SVG 컴포넌트
- **GrowthCurveChart** — WHO/Korean 성장 곡선 (3/15/50/85/97 백분위)
- **ImmunizationSchedule** — 접종 스케줄 시각화 (완료/미완료/지연)

---

### 4. 정신건강의학과 (Psychiatry)

#### 핵심 차트: 정신상태검사(MSE) + 심리검사 점수 추이

```
┌─ 정신과 진료 화면 ──────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─ 정신상태검사 (MSE) ─────────────┐  ┌─ 심리검사 점수 ────────────────┐  │
│  │                                   │  │                                │  │
│  │  외양:     [단정 / 불량 / 기이]   │  │  PHQ-9 (우울):  [14] 중등도   │  │
│  │  행동:     [협조적 / 초조 / 지연] │  │  GAD-7 (불안):  [10] 중등도   │  │
│  │  말:       [정상속도/양 / 다변]   │  │  MMSE (인지):   [28] 정상     │  │
│  │  기분:     [우울 / 불안 / 정상]   │  │  AUDIT (알코올): [12] 위험    │  │
│  │  정동:     [제한 / 둔마 / 적절]   │  │                                │  │
│  │  사고내용: [자살사고 ☐ / 망상 ☐]  │  │  ── 점수 추이 차트 ──         │  │
│  │  사고과정: [논리적 / 이완 / 우원] │  │  PHQ-9: 18→16→14→12 (↓개선)  │  │
│  │  지각:     [환청 ☐ / 환시 ☐]     │  │  GAD-7:  8→10→10→8           │  │
│  │  인지:     [지남력 ✓ / 기억력 ✓] │  │                                │  │
│  │  병식:     [양호 / 부분 / 없음]   │  │  ── 자살 위험 평가 ──         │  │
│  │                                   │  │  C-SSRS: [2] 수동적 사고      │  │
│  │  자살위험: [● 저 ○ 중 ○ 고]     │  │  안전 계약: [체결 ✓]          │  │
│  └───────────────────────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 데이터 모델
```prisma
model PsychExam {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  encounterId   String?  @map("encounter_id") @db.Uuid
  // MSE (Mental Status Exam)
  appearance    String?  @db.VarChar(30)
  behavior      String?  @db.VarChar(30)
  speech        String?  @db.VarChar(30)
  mood          String?  @db.VarChar(30)
  affect        String?  @db.VarChar(30)
  thoughtContent Json?   @map("thought_content") @db.JsonB // {suicidalIdeation, homicidalIdeation, delusions, obsessions}
  thoughtProcess String? @map("thought_process") @db.VarChar(30)
  perception    Json?    @db.JsonB // {hallucinations: {auditory, visual, tactile}}
  cognition     Json?    @db.JsonB // {orientation, memory, concentration, judgment}
  insight       String?  @db.VarChar(20) // GOOD, PARTIAL, POOR
  // 심리검사 점수
  phq9          Int?     // Patient Health Questionnaire (0-27)
  gad7          Int?     // Generalized Anxiety Disorder (0-21)
  mmse          Int?     // Mini-Mental State (0-30)
  audit         Int?     // Alcohol Use Disorders (0-40)
  cssrs         Int?     // Columbia Suicide Severity (0-5)
  customScales  Json?    @map("custom_scales") @db.JsonB // [{name, score, maxScore}]
  // 자살 위험
  suicideRisk   String?  @map("suicide_risk") @db.VarChar(10) // LOW, MODERATE, HIGH
  safetyPlan    Boolean? @map("safety_plan")
  diagnosis     String?  @db.Text
  plan          String?  @db.Text
  examinedBy    String   @map("examined_by") @db.Uuid
  examinedAt    DateTime @default(now()) @map("examined_at") @db.Timestamptz()
  patient       Patient  @relation(fields: [patientId], references: [id])
  @@map("psych_exams")
}
```

---

### 5. 신경외과 (Neurosurgery)

#### 핵심 차트: 신경학적 검사 + GCS + 근력/감각 맵

```
┌─ 신경외과 진료 화면 ────────────────────────────────────────────────────────┐
│                                                                             │
│  ── GCS (Glasgow Coma Scale) ──          ── 동공 반사 ──                   │
│  눈: [4] 자발적 개안                     OD: [3mm] 반응 [+]               │
│  언어: [5] 지남력 있는 대화              OS: [3mm] 반응 [+]               │
│  운동: [6] 명령 수행                     동공부동: [없음]                  │
│  합계: [15/15]                                                             │
│                                                                             │
│  ── 근력 (Dermatome/Myotome Map) ──                                       │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  C5: 삼각근      L [5] / R [5]                                  │       │
│  │  C6: 손목신전    L [5] / R [4]  ← 약화                         │       │
│  │  C7: 삼두근      L [5] / R [4]                                  │       │
│  │  C8: 수지굴곡    L [5] / R [5]                                  │       │
│  │  L2: 고관절굴곡  L [5] / R [5]                                  │       │
│  │  L3: 슬관절신전  L [5] / R [5]                                  │       │
│  │  L4: 족관절배굴  L [5] / R [5]                                  │       │
│  │  L5: 엄지신전    L [5] / R [3]  ← 현저한 약화                  │       │
│  │  S1: 족관절저굴  L [5] / R [4]                                  │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  ── 감각 ──                              ── 반사 ──                       │
│  통각: [정상 / L5 분절 감소]             이두근: L[++] R[++]              │
│  촉각: [정상]                            삼두근: L[++] R[+]               │
│  진동각: [정상]                          무릎: L[++] R[++]                │
│  위치각: [정상]                          아킬레스: L[++] R[+]             │
│                                          Babinski: L[-] R[-]              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 데이터 모델
```prisma
model NeuroExam {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  encounterId String?  @map("encounter_id") @db.Uuid
  // GCS
  gcsEye      Int?     @map("gcs_eye") // 1-4
  gcsVerbal   Int?     @map("gcs_verbal") // 1-5
  gcsMotor    Int?     @map("gcs_motor") // 1-6
  gcsTotal    Int?     @map("gcs_total") // 3-15
  // 동공
  pupilRight  Json?    @map("pupil_right") @db.JsonB // {size, reactive}
  pupilLeft   Json?    @map("pupil_left") @db.JsonB
  anisocoria  Boolean?
  // 근력 (Myotome)
  motorExam   Json?    @map("motor_exam") @db.JsonB // [{level: "C5", left: 5, right: 4}]
  // 감각 (Dermatome)
  sensoryExam Json?    @map("sensory_exam") @db.JsonB // [{modality, findings}]
  // 반사
  reflexes    Json?    @db.JsonB // [{name, left, right}] — 0/+/++/+++/++++
  babinski    Json?    @db.JsonB // {left, right}
  // 뇌신경
  cranialNerves Json?  @map("cranial_nerves") @db.JsonB // [{nerve: "II"-"XII", left, right}]
  diagnosis   String?  @db.Text
  plan        String?  @db.Text
  examinedBy  String   @map("examined_by") @db.Uuid
  examinedAt  DateTime @default(now()) @map("examined_at") @db.Timestamptz()
  patient     Patient  @relation(fields: [patientId], references: [id])
  @@map("neuro_exams")
}
```

---

### 6. 성형외과 (Plastic Surgery)

#### 핵심 차트: 시술 전후 사진 + 시술 기록

```
┌─ 성형외과 진료 화면 ────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─ 시술 전후 사진 ─────────────────┐  ┌─ 시술 기록 ─────────────────────┐ │
│  │                                  │  │                                  │ │
│  │  [전]  ◄─ 슬라이더 ─►  [후]     │  │  부위: [비부 (코) ▼]            │ │
│  │                                  │  │  시술: [비중격 교정술 ____]      │ │
│  │  촬영 각도:                       │  │  마취: [전신 ▼]                 │ │
│  │  [정면] [좌45°] [좌90°]          │  │  재료: [실리콘 보형물 ___]      │ │
│  │  [우45°] [우90°] [하면]          │  │  소요: [90분]                   │ │
│  │                                   │  │                                 │ │
│  │  [사진 업로드]                     │  │  ── 피부 상태 ──              │ │
│  └───────────────────────────────────┘  │  피부타입: [Fitzpatrick III ▼]  │ │
│                                         │  탄력: [양호 ▼]                │ │
│                                         │  흉터 경향: [정상 ▼]           │ │
│                                         │                                │ │
│                                         │  [기록 저장]                    │ │
│                                         └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 7. 비뇨의학과 (Urology)

#### 핵심 차트: 요역동학 + IPSS + 전립선

```
요역동학검사: 유속/잔뇨/방광용적 차트
IPSS (국제전립선증상점수): 7문항 0-35점, 추이 차트
PSA 추이: 시계열 그래프 (4.0 기준선)
```

#### 데이터 모델
```prisma
model UrologyExam {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  // IPSS
  ipssScore   Int?     @map("ipss_score") // 0-35
  ipssQol     Int?     @map("ipss_qol") // 0-6
  // PSA
  psaValue    Decimal? @map("psa_value") @db.Decimal(6,2)
  // 요역동학
  urodynamics Json?    @db.JsonB // {maxFlowRate, avgFlowRate, voidedVolume, residualVolume}
  // 초음파
  prostateVolume Decimal? @map("prostate_volume") @db.Decimal(5,1) // mL
  diagnosis   String?  @db.Text
  examinedBy  String   @map("examined_by") @db.Uuid
  examinedAt  DateTime @default(now()) @map("examined_at") @db.Timestamptz()
  patient     Patient  @relation(fields: [patientId], references: [id])
  @@map("urology_exams")
}
```

---

## 진료과별 진료 화면 분기 확장

```typescript
function getSpecialtyLayout(dept?: string) {
  switch (dept) {
    // 이미 구현
    case '치과': return 'dental';
    case '안과': return 'ophthalmology';
    case '피부과': return 'dermatology';
    case '이비인후과': return 'ent';
    // 신규
    case '정형외과': return 'orthopedics';
    case '산부인과': return 'obgyn';
    case '소아청소년과': return 'pediatrics';
    case '정신건강의학과': return 'psychiatry';
    case '신경외과': return 'neurosurgery';
    case '성형외과': return 'plastic';
    case '비뇨의학과': return 'urology';
    // 일반 SOAP
    default: return 'general';
  }
}
```

## 구현 우선순위

| 순위 | 과 | 모델 | SVG | 난이도 | 사유 |
|:----:|---|:----:|:---:|:------:|------|
| 1 | 정형외과 | 1 | SkeletonDiagram | 높음 | 환자 수 많음, ROM/특수검사 표준화 |
| 2 | 산부인과 | 1 | 성장곡선+Partogram | 높음 | 산전관리 필수, 법적 기록 |
| 3 | 소아과 | 3 | GrowthCurve | 중간 | 성장곡선+접종 국가필수 |
| 4 | 정신과 | 1 | 점수추이 | 중간 | MSE 구조화 필요 |
| 5 | 신경외과 | 1 | DermatomeMap | 중간 | GCS+근력맵 표준화 |
| 6 | 성형외과 | - | BeforeAfter | 낮음 | 기존 슬라이더 재활용 |
| 7 | 비뇨기과 | 1 | PSA/IPSS차트 | 낮음 | 점수 추이 차트 |

## 예상 총 작업량

| 항목 | 수량 |
|------|:----:|
| 신규 Prisma 모델 | 8 |
| API 엔드포인트 | ~50 |
| Encounter 레이아웃 | 7 |
| SVG 컴포넌트 | 4 |
| 기존 재활용 | 2 (BeforeAfter, 점수차트) |
