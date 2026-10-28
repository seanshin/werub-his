# 전문과 클리닉 시스템 기획서

## 대상 진료과

| 진료과 | 핵심 기능 | 우선순위 |
|--------|---------|:--------:|
| 치과 | 치아차트, 치료계획, 보철/교정 | 1 |
| 안과 | 시력검사, 안압, 안저촬영, 수술 | 2 |
| 피부과 | 피부병변 기록, 사진, 시술 | 3 |
| 이비인후과 | 청력검사, 내시경, 수술 | 4 |
| 비뇨기과 | 요역동학, 전립선, 결석 | 백로그 |
| 한방 | 사상체질, 침구, 한약 | 백로그 |

---

## 1. 치과 (Dental)

### 1.1 데이터 모델

```prisma
model DentalChart {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  encounterId String?  @map("encounter_id") @db.Uuid
  // 치아 상태 (FDI 2자리 번호: 11~48, 51~85)
  teethStatus Json     @map("teeth_status") @db.JsonB
  // [{tooth: "11", status: "NORMAL|CARIES|MISSING|CROWN|BRIDGE|IMPLANT|RCT|FILLING|EXTRACTION_NEEDED",
  //   surfaces: ["M","O","D","B","L"], notes: "근심면 우식"}]
  perioStatus Json?    @map("perio_status") @db.JsonB
  // [{tooth: "11", pocket: [3,2,3,3,2,3], mobility: 0, bleeding: false, furcation: 0}]
  occlusion   String?  @db.VarChar(100)   // "Class I", "Class II Div 1"
  oralHygiene String?  @map("oral_hygiene") @db.VarChar(20) // GOOD, FAIR, POOR
  notes       String?  @db.Text
  chartedBy   String   @map("charted_by") @db.Uuid
  chartedAt   DateTime @default(now()) @map("charted_at") @db.Timestamptz()

  patient     Patient  @relation(fields: [patientId], references: [id])
  @@map("dental_charts")
}

model DentalTreatmentPlan {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  tooth       String   @db.VarChar(5)     // FDI: "11", "46"
  procedure   String   @db.VarChar(100)   // "레진 충전", "근관치료", "임플란트"
  category    String   @db.VarChar(30)
  // RESTORATION (수복), RCT (근관), EXTRACTION (발치), PROSTHESIS (보철),
  // IMPLANT (임플란트), ORTHODONTIC (교정), PERIO (치주), SURGERY (수술),
  // PREVENTIVE (예방), COSMETIC (심미)
  priority    Int      @default(1)        // 1=긴급, 2=필요, 3=선택
  estimatedCost Decimal? @map("estimated_cost") @db.Decimal(10, 0)
  insuranceCovered Boolean? @map("insurance_covered")
  status      String   @default("PLANNED") @db.VarChar(20) // PLANNED, IN_PROGRESS, COMPLETED, CANCELLED
  sessions    Int      @default(1)        // 예상 내원 횟수
  notes       String?  @db.Text
  plannedBy   String   @map("planned_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient     Patient  @relation(fields: [patientId], references: [id])
  records     DentalTreatmentRecord[]
  @@map("dental_treatment_plans")
}

model DentalTreatmentRecord {
  id          String   @id @default(uuid()) @db.Uuid
  planId      String?  @map("plan_id") @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  encounterId String?  @map("encounter_id") @db.Uuid
  tooth       String   @db.VarChar(5)
  procedure   String   @db.VarChar(100)
  surfaces    Json?    @db.JsonB          // ["M", "O", "D"]
  material    String?  @db.VarChar(50)    // "복합레진", "아말감", "지르코니아", "PFM"
  anesthesia  String?  @db.VarChar(50)    // "리도카인 2% 1.8mL"
  canalLength Json?    @map("canal_length") @db.JsonB // RCT: [{canal: "MB", length: 21.5}]
  shade       String?  @db.VarChar(10)    // 보철 색상 "A2", "A3"
  labOrder    String?  @map("lab_order") @db.VarChar(100) // "지르코니아 크라운 주문"
  xrayTaken   Boolean? @map("xray_taken")
  findings    String?  @db.Text
  nextVisit   String?  @map("next_visit") @db.VarChar(100) // "1주 후 근관충전"
  treatedBy   String   @map("treated_by") @db.Uuid
  treatedAt   DateTime @default(now()) @map("treated_at") @db.Timestamptz()

  plan        DentalTreatmentPlan? @relation(fields: [planId], references: [id])
  @@map("dental_treatment_records")
}
```

### 1.2 API (12개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | GET | `/api/v1/dental/chart/:patientId` | 치아차트 조회 |
| 2 | POST | `/api/v1/dental/chart` | 치아차트 기록/업데이트 |
| 3 | POST | `/api/v1/dental/plans` | 치료 계획 생성 |
| 4 | GET | `/api/v1/dental/plans/:patientId` | 환자 치료 계획 |
| 5 | PATCH | `/api/v1/dental/plans/:id/status` | 계획 상태 변경 |
| 6 | POST | `/api/v1/dental/records` | 치료 기록 |
| 7 | GET | `/api/v1/dental/records/:patientId` | 치료 이력 |
| 8 | GET | `/api/v1/dental/today` | 오늘 치과 일정 |
| 9 | GET | `/api/v1/dental/lab-orders` | 기공 의뢰 목록 |
| 10 | GET | `/api/v1/dental/stats` | 치과 통계 |
| 11 | GET | `/api/v1/dental/perio/:patientId` | 치주차트 |
| 12 | POST | `/api/v1/dental/perio` | 치주검사 기록 |

### 1.3 화면

```
치과 (/dental)
├── 치아차트 (FDI 32치아 시각화, 클릭→상태 변경)
├── 치료계획 (치아별 계획, 우선순위, 비용, 보험)
├── 치료기록 (시술 기록, 재료, 마취, X-ray)
├── 치주차트 (포켓 깊이 6점 기록, 출혈, 동요도)
└── 기공 의뢰
```

---

## 2. 안과 (Ophthalmology)

### 2.1 데이터 모델

```prisma
model EyeExam {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  encounterId String?  @map("encounter_id") @db.Uuid
  // 시력 (Visual Acuity)
  vaOdUncorrected String? @map("va_od_uncorrected") @db.VarChar(20) // "20/40"
  vaOsUncorrected String? @map("va_os_uncorrected") @db.VarChar(20)
  vaOdCorrected   String? @map("va_od_corrected") @db.VarChar(20)   // "20/20"
  vaOsCorrected   String? @map("va_os_corrected") @db.VarChar(20)
  // 굴절 (Refraction)
  refractionOd    Json?   @map("refraction_od") @db.JsonB // {sphere: -2.50, cylinder: -0.75, axis: 180}
  refractionOs    Json?   @map("refraction_os") @db.JsonB
  // 안압 (IOP)
  iopOd           Decimal? @map("iop_od") @db.Decimal(4, 1) // mmHg
  iopOs           Decimal? @map("iop_os") @db.Decimal(4, 1)
  iopMethod       String?  @map("iop_method") @db.VarChar(30) // NCT, GAT, TONOPEN
  // 동공 (Pupil)
  pupilOd         String?  @map("pupil_od") @db.VarChar(30) // "3mm, round, reactive"
  pupilOs         String?  @map("pupil_os") @db.VarChar(30)
  rapd            Boolean? // Relative Afferent Pupillary Defect
  // 세극등 (Slit Lamp)
  slitLampOd      Json?    @map("slit_lamp_od") @db.JsonB // {lids, conjunctiva, cornea, ac, iris, lens}
  slitLampOs      Json?    @map("slit_lamp_os") @db.JsonB
  // 안저 (Fundus)
  fundusOd        Json?    @map("fundus_od") @db.JsonB // {disc, macula, vessels, periphery}
  fundusOs        Json?    @map("fundus_os") @db.JsonB
  fundusImageUrl  String?  @map("fundus_image_url") @db.VarChar(500)
  // OCT
  octOd           Json?    @map("oct_od") @db.JsonB // {rnfl, ganglion, macula thickness}
  octOs           Json?    @map("oct_os") @db.JsonB
  octImageUrl     String?  @map("oct_image_url") @db.VarChar(500)
  // 시야 (Visual Field)
  vfOd            Json?    @map("vf_od") @db.JsonB // {md, psd, vfi, reliability}
  vfOs            Json?    @map("vf_os") @db.JsonB
  vfImageUrl      String?  @map("vf_image_url") @db.VarChar(500)

  diagnosis       String?  @db.Text
  plan            String?  @db.Text
  notes           String?  @db.Text
  examinedBy      String   @map("examined_by") @db.Uuid
  examinedAt      DateTime @default(now()) @map("examined_at") @db.Timestamptz()

  patient         Patient  @relation(fields: [patientId], references: [id])
  @@map("eye_exams")
}

model EyeSurgery {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  surgeryId   String?  @map("surgery_id") @db.Uuid
  eye         String   @db.VarChar(5)     // OD, OS, OU
  procedure   String   @db.VarChar(100)
  // CATARACT (백내장), LASIK, LASEK, SMILE, VITRECTOMY (유리체),
  // GLAUCOMA_SURGERY, CORNEAL_TRANSPLANT, STRABISMUS (사시), OCULOPLASTIC
  iolModel    String?  @map("iol_model") @db.VarChar(100) // 백내장: "AcrySof IQ SN60WF"
  iolPower    String?  @map("iol_power") @db.VarChar(20)  // "+21.0D"
  laserParams Json?    @map("laser_params") @db.JsonB      // LASIK: {flap, ablation, zone}
  preOpVa     String?  @map("pre_op_va") @db.VarChar(20)
  postOpVa    String?  @map("post_op_va") @db.VarChar(20)
  complications String? @db.Text
  operatedBy  String   @map("operated_by") @db.Uuid
  operatedAt  DateTime @default(now()) @map("operated_at") @db.Timestamptz()

  patient     Patient  @relation(fields: [patientId], references: [id])
  @@map("eye_surgeries")
}
```

### 2.2 API (10개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/ophthalmology/exam` | 안과 검사 기록 |
| 2 | GET | `/api/v1/ophthalmology/exam/:patientId` | 검사 이력 |
| 3 | GET | `/api/v1/ophthalmology/exam/:id/detail` | 검사 상세 |
| 4 | POST | `/api/v1/ophthalmology/surgery` | 안과 수술 기록 |
| 5 | GET | `/api/v1/ophthalmology/surgery/:patientId` | 수술 이력 |
| 6 | POST | `/api/v1/ophthalmology/prescription/glasses` | 안경 처방전 |
| 7 | POST | `/api/v1/ophthalmology/prescription/contacts` | 콘택트렌즈 처방 |
| 8 | GET | `/api/v1/ophthalmology/iop-trend/:patientId` | 안압 추이 |
| 9 | GET | `/api/v1/ophthalmology/today` | 오늘 안과 일정 |
| 10 | GET | `/api/v1/ophthalmology/stats` | 안과 통계 |

### 2.3 화면

```
안과 (/ophthalmology)
├── 검사 기록 (시력/굴절/안압/세극등/안저/OCT/시야)
├── 안저 사진 뷰어 (OD/OS 비교)
├── 안압 추이 차트
├── 수술 기록 (백내장 IOL, LASIK 파라미터)
├── 처방전 (안경/콘택트)
└── 통계
```

---

## 3. 피부과 (Dermatology)

### 3.1 데이터 모델

```prisma
model SkinLesion {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  encounterId   String?  @map("encounter_id") @db.Uuid
  location      String   @db.VarChar(100)   // "좌측 전완부", "우측 안면"
  bodyRegion    String   @map("body_region") @db.VarChar(30)
  // HEAD, FACE, NECK, CHEST, ABDOMEN, BACK, UPPER_ARM, FOREARM, HAND,
  // THIGH, LOWER_LEG, FOOT, GENITALIA, SCALP
  morphology    String   @db.VarChar(50)    // MACULE, PAPULE, NODULE, PLAQUE, VESICLE, BULLA, PUSTULE, ULCER, PATCH
  color         String?  @db.VarChar(30)    // 갈색, 적색, 흑색, 피부색
  size          String?  @db.VarChar(30)    // "2.0 x 1.5 cm"
  border        String?  @db.VarChar(30)    // REGULAR, IRREGULAR, WELL_DEFINED, ILL_DEFINED
  distribution  String?  @db.VarChar(30)    // LOCALIZED, GENERALIZED, SYMMETRIC, LINEAR, DERMATOMAL
  surface       String?  @db.VarChar(50)    // SMOOTH, ROUGH, SCALY, CRUSTED, VERRUCOUS
  dermoscopy    Json?    @db.JsonB          // {pattern, colors, structures, score}
  // ABCDE: Asymmetry, Border, Color, Diameter, Evolution
  abcdeScore    Int?     @map("abcde_score") // 0-8 (≥4 의심)
  photoUrls     Json?    @map("photo_urls") @db.JsonB // ["url1", "url2"]
  biopsyTaken   Boolean? @map("biopsy_taken")
  biopsyResult  String?  @map("biopsy_result") @db.Text
  diagnosis     String?  @db.VarChar(200)
  diagnosisCode String?  @map("diagnosis_code") @db.VarChar(20)
  notes         String?  @db.Text
  recordedBy    String   @map("recorded_by") @db.Uuid
  recordedAt    DateTime @default(now()) @map("recorded_at") @db.Timestamptz()

  patient       Patient  @relation(fields: [patientId], references: [id])
  treatments    SkinTreatment[]
  @@map("skin_lesions")
}

model SkinTreatment {
  id            String   @id @default(uuid()) @db.Uuid
  lesionId      String?  @map("lesion_id") @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  treatmentType String   @map("treatment_type") @db.VarChar(30)
  // TOPICAL (외용), SYSTEMIC (전신), PHOTOTHERAPY (광선), LASER (레이저),
  // CRYOTHERAPY (냉동), EXCISION (절제), BIOPSY (조직검사), INJECTION (주사),
  // CHEMICAL_PEEL (화학박피), BOTOX, FILLER, IPL
  procedure     String   @db.VarChar(200)   // "CO2 레이저 0.5W, 2mm spot"
  area          String?  @db.VarChar(100)   // 시술 부위
  parameters    Json?    @db.JsonB          // {power, pulse, spot_size, fluence, passes}
  medication    String?  @db.VarChar(200)   // "트레티노인 0.025% 크림"
  beforePhotoUrl String? @map("before_photo_url") @db.VarChar(500)
  afterPhotoUrl  String? @map("after_photo_url") @db.VarChar(500)
  complications String?  @db.Text
  nextSession   DateTime? @map("next_session") @db.Date
  treatedBy     String   @map("treated_by") @db.Uuid
  treatedAt     DateTime @default(now()) @map("treated_at") @db.Timestamptz()

  lesion        SkinLesion? @relation(fields: [lesionId], references: [id])
  @@map("skin_treatments")
}
```

### 3.2 API (10개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/dermatology/lesions` | 병변 기록 |
| 2 | GET | `/api/v1/dermatology/lesions/:patientId` | 환자 병변 목록 |
| 3 | GET | `/api/v1/dermatology/lesions/:id` | 병변 상세 |
| 4 | PATCH | `/api/v1/dermatology/lesions/:id` | 병변 업데이트 (경과) |
| 5 | POST | `/api/v1/dermatology/treatments` | 시술 기록 |
| 6 | GET | `/api/v1/dermatology/treatments/:patientId` | 시술 이력 |
| 7 | POST | `/api/v1/dermatology/body-map/:patientId` | 전신 바디맵 기록 |
| 8 | GET | `/api/v1/dermatology/body-map/:patientId` | 바디맵 조회 |
| 9 | GET | `/api/v1/dermatology/today` | 오늘 피부과 일정 |
| 10 | GET | `/api/v1/dermatology/stats` | 통계 |

### 3.3 화면

```
피부과 (/dermatology)
├── 병변 기록 (바디맵 클릭→위치 선택→형태/크기/사진)
├── 더모스코피 (ABCDE Score)
├── 시술 기록 (레이저/냉동/절제/주사, 전후 사진)
├── 사진 비교 (전/후 슬라이더)
└── 통계
```

---

## 4. 이비인후과 (ENT)

### 4.1 데이터 모델

```prisma
model EntExam {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  encounterId String?  @map("encounter_id") @db.Uuid
  // 이과 (Ear)
  otoscopyRight Json?  @map("otoscopy_right") @db.JsonB
  // {tympanic_membrane: "정상/천공/삼출", canal: "정상/부종", discharge: "없음/장액/화농"}
  otoscopyLeft  Json?  @map("otoscopy_left") @db.JsonB
  // 청력 (Audiometry)
  audiogramRight Json? @map("audiogram_right") @db.JsonB // [{freq: 250, ac: 20, bc: 15}, ...]
  audiogramLeft  Json? @map("audiogram_left") @db.JsonB
  ptaRight       Int?  @map("pta_right")  // Pure Tone Average dB
  ptaLeft        Int?  @map("pta_left")
  speechRight    Int?  @map("speech_right") // Speech Discrimination %
  speechLeft     Int?  @map("speech_left")
  tympanometryRight String? @map("tympanometry_right") @db.VarChar(10) // Type A, B, C, As, Ad
  tympanometryLeft  String? @map("tympanometry_left") @db.VarChar(10)
  // 비과 (Nose)
  nasalEndoscopy Json? @map("nasal_endoscopy") @db.JsonB
  // {septum: "정상/만곡", turbinate: "정상/비후", polyp: "없음/있음", discharge: "없음/있음"}
  nasalEndoscopyImageUrl String? @map("nasal_endoscopy_image_url") @db.VarChar(500)
  // 인후 (Throat)
  pharynxExam    Json?  @map("pharynx_exam") @db.JsonB
  // {tonsil: "Grade I~IV", pharynx: "정상/발적", uvula: "정상", vocal_cord: "정상/마비"}
  laryngoscopyImageUrl String? @map("laryngoscopy_image_url") @db.VarChar(500)

  diagnosis      String? @db.Text
  notes          String? @db.Text
  examinedBy     String  @map("examined_by") @db.Uuid
  examinedAt     DateTime @default(now()) @map("examined_at") @db.Timestamptz()

  patient        Patient @relation(fields: [patientId], references: [id])
  @@map("ent_exams")
}
```

### 4.2 API (8개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/ent/exam` | 이비인후과 검사 기록 |
| 2 | GET | `/api/v1/ent/exam/:patientId` | 검사 이력 |
| 3 | GET | `/api/v1/ent/audiogram/:patientId` | 청력검사 추이 |
| 4 | POST | `/api/v1/ent/hearing-aid` | 보청기 처방 |
| 5 | GET | `/api/v1/ent/today` | 오늘 일정 |
| 6 | GET | `/api/v1/ent/stats` | 통계 |
| 7 | POST | `/api/v1/ent/sleep-study` | 수면검사 기록 |
| 8 | GET | `/api/v1/ent/sleep-study/:patientId` | 수면검사 이력 |

### 4.3 화면

```
이비인후과 (/ent)
├── 검사 기록 (이경/비내시경/후두내시경)
├── 청력도 (Audiogram 차트 — 250Hz~8kHz)
├── 수면검사 (AHI, 산소포화도)
├── 내시경 사진 뷰어
└── 통계
```

---

## 구현 우선순위

| 순서 | 모듈 | 모델 | API | 화면 |
|:----:|------|:----:|:---:|:----:|
| 1 | 치과 | 3 | 12 | 5탭 |
| 2 | 안과 | 2 | 10 | 5탭 |
| 3 | 피부과 | 2 | 10 | 4탭 |
| 4 | 이비인후과 | 1 | 8 | 4탭 |
| **합계** | | **8** | **40** | |

## API 요약

| 모듈 | Prefix | 엔드포인트 수 |
|------|--------|:------------:|
| 치과 | `/api/v1/dental` | 12 |
| 안과 | `/api/v1/ophthalmology` | 10 |
| 피부과 | `/api/v1/dermatology` | 10 |
| 이비인후과 | `/api/v1/ent` | 8 |
