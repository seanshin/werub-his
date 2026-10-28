# ICU + 기초검사 기획서

> 작성일: 2026-05-08
> Hospital RUN에 누락된 중환자실 및 기초검사 모듈

---

## 1. 누락 항목 분석

### 1-1. ICU (중환자실)

현재 HIS에는 일반 입원(병동)만 있고 **중환자실(ICU)** 관리가 없음.

| 항목 | 현재 | 필요 |
|------|:----:|:----:|
| ICU 병상 관리 | ❌ | 별도 ICU 병동 + 모니터링 침대 |
| 실시간 모니터링 (바이탈) | ❌ | HR, BP, SpO2, RR, Temperature |
| 인공호흡기(Ventilator) 관리 | ❌ | 모드, 설정값, 알람 |
| 수액/주입펌프 관리 | ❌ | 약물/속도/잔량 |
| APACHE/SOFA 점수 | ❌ | 중증도 평가 스코어 |
| ICU 일일 기록 | ❌ | I/O(섭취배출), 의식상태 |
| 격리 관리 | ✅ (감염관리) | 연동 필요 |

### 1-2. 기초검사 (Diagnostic Tests)

현재 검사실은 혈액/생화학 위주. **생리기능검사**가 빠짐.

| 검사 | 현재 | 필요 | 설명 |
|------|:----:|:----:|------|
| EKG (심전도) | ❌ | 12-lead ECG, 리듬 분석 |
| EEG (뇌파) | ❌ | 간질/의식장애 평가 |
| EMG/NCS (근전도/신경전도) | ❌ | 신경근 질환 |
| 폐기능검사 (PFT) | ❌ | FVC, FEV1, DLCO |
| 심초음파 (Echo) | △ (영상) | 심기능 평가 (별도 리포트) |
| 운동부하검사 (TMT) | ❌ | 심장 스트레스 테스트 |
| 24시간 홀터 | ❌ | 부정맥 모니터링 |
| 수면다원검사 (PSG) | ❌ | 수면무호흡 진단 |
| 청력검사 (Audiometry) | ❌ | 난청 평가 |
| 안저검사 (Fundoscopy) | ❌ | 당뇨망막병증 |
| 골밀도검사 (DEXA) | ❌ | 골다공증 |
| 내시경 (상부/하부) | ❌ | 위/대장 내시경 |

---

## 2. ICU 데이터 모델

### 2-1. ICU 병상

```prisma
model IcuBed {
  id          String   @id @default(uuid()) @db.Uuid
  unitName    String   @map("unit_name") @db.VarChar(100)    // "내과 ICU", "외과 ICU", "신생아 ICU"
  bedNumber   String   @map("bed_number") @db.VarChar(20)    // "ICU-01"
  status      String   @default("AVAILABLE") @db.VarChar(20)  // AVAILABLE, OCCUPIED, MAINTENANCE
  equipments  Json     @db.JsonB    // ["인공호흡기","모니터","주입펌프"]
  createdAt   DateTime @default(now()) @map("created_at")

  admissions  IcuAdmission[]
  @@map("icu_beds")
}
```

### 2-2. ICU 입실

```prisma
model IcuAdmission {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  icuBedId        String    @map("icu_bed_id") @db.Uuid
  admittingDoctorId String  @map("admitting_doctor_id") @db.Uuid
  admitDate       DateTime  @map("admit_date") @db.Timestamptz()
  dischargeDate   DateTime? @map("discharge_date") @db.Timestamptz()
  admitReason     String    @map("admit_reason") @db.Text
  diagnosis       String?   @db.Text
  severity        String?   @db.VarChar(20)     // CRITICAL, SEVERE, MODERATE
  ventilator      Boolean   @default(false)
  isolation       Boolean   @default(false)
  isolationType   String?   @map("isolation_type") @db.VarChar(50)
  status          String    @default("ADMITTED") @db.VarChar(20)
  
  patient   Patient      @relation(fields: [patientId], references: [id])
  icuBed    IcuBed       @relation(fields: [icuBedId], references: [id])
  records   IcuRecord[]
  @@map("icu_admissions")
}
```

### 2-3. ICU 일일 기록

```prisma
model IcuRecord {
  id              String   @id @default(uuid()) @db.Uuid
  admissionId     String   @map("admission_id") @db.Uuid
  recordDate      DateTime @map("record_date") @db.Date
  recordTime      DateTime @map("record_time") @db.Timestamptz()
  
  // 바이탈
  heartRate       Int?     @map("heart_rate")
  systolicBp      Int?     @map("systolic_bp")
  diastolicBp     Int?     @map("diastolic_bp")
  spo2            Int?     @map("spo2")
  respiratoryRate Int?     @map("respiratory_rate")
  temperature     Decimal? @db.Decimal(4,1)
  
  // 의식 수준
  gcScore         Int?     @map("gc_score")          // Glasgow Coma Scale (3~15)
  consciousness   String?  @db.VarChar(20)           // ALERT, VERBAL, PAIN, UNRESPONSIVE
  pupilReaction   String?  @map("pupil_reaction") @db.VarChar(50)
  
  // I/O (섭취/배출)
  intakeOral      Int?     @map("intake_oral")       // ml
  intakeIv        Int?     @map("intake_iv")         // ml
  outputUrine     Int?     @map("output_urine")      // ml
  outputDrain     Int?     @map("output_drain")      // ml
  
  // 인공호흡기
  ventMode        String?  @map("vent_mode") @db.VarChar(30)     // SIMV, AC, PS, CPAP
  fio2            Int?     @map("fio2")              // %
  peep            Int?     @map("peep")              // cmH2O
  tidalVolume     Int?     @map("tidal_volume")      // ml
  
  // 중증도 점수
  apacheScore     Int?     @map("apache_score")      // APACHE II (0~71)
  sofaScore       Int?     @map("sofa_score")        // SOFA (0~24)
  
  notes           String?  @db.Text
  recordedBy      String   @map("recorded_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")

  admission IcuAdmission @relation(fields: [admissionId], references: [id])
  @@map("icu_records")
}
```

---

## 3. 기초검사 데이터 모델

### 3-1. 생리기능검사 결과

```prisma
model DiagnosticTest {
  id              String   @id @default(uuid()) @db.Uuid
  patientId       String   @map("patient_id") @db.Uuid
  orderId         String?  @map("order_id") @db.Uuid
  testType        String   @map("test_type") @db.VarChar(50)    // EKG, EEG, PFT, ECHO, HOLTER, TMT, PSG, AUDIOMETRY, DEXA, ENDOSCOPY
  testName        String   @map("test_name") @db.VarChar(200)   // "12-lead EKG", "뇌파검사"
  
  // 검사 정보
  requestedBy     String   @map("requested_by") @db.Uuid        // 의뢰 의사
  performedBy     String?  @map("performed_by") @db.Uuid        // 시행 기사
  interpretedBy   String?  @map("interpreted_by") @db.Uuid      // 판독 의사
  
  // 상태
  status          String   @default("ORDERED") @db.VarChar(20)   // ORDERED, SCHEDULED, IN_PROGRESS, COMPLETED, REPORTED
  scheduledAt     DateTime? @map("scheduled_at") @db.Timestamptz()
  performedAt     DateTime? @map("performed_at") @db.Timestamptz()
  reportedAt      DateTime? @map("reported_at") @db.Timestamptz()
  
  // 결과
  findings        String?  @db.Text                              // 소견
  impression      String?  @db.Text                              // 판독 소견
  conclusion      String?  @db.VarChar(50)                       // NORMAL, ABNORMAL, BORDERLINE
  measurements    Json?    @db.JsonB                             // 검사별 측정값
  
  // 첨부
  attachmentUrl   String?  @map("attachment_url") @db.VarChar(500)  // 파형 이미지/PDF
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  patient Patient @relation(fields: [patientId], references: [id])
  @@index([patientId])
  @@index([testType])
  @@index([status])
  @@map("diagnostic_tests")
}
```

### 3-2. 검사별 측정값 (measurements JSON 예시)

```json
// EKG
{
  "heartRate": 72,
  "rhythm": "Normal Sinus Rhythm",
  "prInterval": 160,
  "qrsDuration": 88,
  "qtInterval": 380,
  "axis": 45,
  "stChanges": "none"
}

// 폐기능 (PFT)
{
  "fvc": 4.2,
  "fvcPredicted": 95,
  "fev1": 3.5,
  "fev1Predicted": 92,
  "fev1FvcRatio": 83,
  "dlco": 25.5,
  "dlcoPredicted": 88
}

// 심초음파 (Echo)
{
  "lvef": 62,
  "lvedd": 48,
  "lvesd": 32,
  "laMM": 35,
  "rvsp": 28,
  "wallMotion": "normal",
  "valvular": "no significant abnormality"
}

// 골밀도 (DEXA)
{
  "lumbarTScore": -1.2,
  "femoralTScore": -0.8,
  "assessment": "osteopenia"
}
```

---

## 4. API 설계

### ICU API
```
GET    /api/v1/icu/beds                    // ICU 병상 현황
GET    /api/v1/icu/patients                // ICU 입실 환자 목록
POST   /api/v1/icu/admit                   // ICU 입실
PATCH  /api/v1/icu/:id/discharge           // ICU 퇴실
POST   /api/v1/icu/:id/record              // ICU 기록 등록 (바이탈/I-O/벤트)
GET    /api/v1/icu/:id/records             // ICU 기록 조회 (시계열)
GET    /api/v1/icu/:id/flowsheet           // ICU 플로우시트 (표 형태)
PATCH  /api/v1/icu/:id/ventilator          // 인공호흡기 설정 변경
GET    /api/v1/icu/dashboard               // ICU 대시보드 (점유율, 중증도)
```

### 기초검사 API
```
POST   /api/v1/diagnostic-tests            // 검사 의뢰
GET    /api/v1/diagnostic-tests             // 검사 목록 (필터: type, status, patient)
GET    /api/v1/diagnostic-tests/:id         // 검사 상세 + 결과
PATCH  /api/v1/diagnostic-tests/:id/perform // 검사 시행
PATCH  /api/v1/diagnostic-tests/:id/report  // 판독 결과 입력
GET    /api/v1/diagnostic-tests/types       // 검사 종류 목록
```

---

## 5. UI 설계

### ICU 대시보드 (`/icu`)
```
┌──────────────────────────────────────────────────────────────┐
│ ICU 현황                                                      │
│ 총 8상 / 사용 3상 / 가용 5상 / 점유율 37.5%                    │
├──────────────────────────────────────────────────────────────┤
│ ICU-01 ● 김영수 (심정지 후 관찰) GCS:8 인공호흡기 ⚡           │
│   HR:92 BP:110/70 SpO2:96% RR:14 BT:36.8                    │
│   Vent: AC FiO2:40% PEEP:5 TV:450                           │
│   I/O: +320ml                                                │
├──────────────────────────────────────────────────────────────┤
│ ICU-02 ● 이민정 (패혈증) GCS:14 격리(접촉)                     │
│   HR:108 BP:95/60 SpO2:94% RR:22 BT:38.5                    │
│   SOFA:8 APACHE:22                                           │
├──────────────────────────────────────────────────────────────┤
│ ICU-03 ● 박지훈 (수술 후 관찰) GCS:15                          │
│   HR:78 BP:125/80 SpO2:98% RR:16 BT:36.5                    │
│   퇴실 예정 (내일)                                             │
└──────────────────────────────────────────────────────────────┘
```

### 기초검사 페이지 (`/diagnostics`)
```
┌──────────────────────────────────────────────────────────────┐
│ 기초검사                                                      │
│ [EKG] [EEG] [PFT] [Echo] [내시경] [골밀도] [전체]             │
├──────────────────────────────────────────────────────────────┤
│ 대기 5건 / 진행 2건 / 완료 12건 (오늘)                         │
├──────────────────────────────────────────────────────────────┤
│ 김영수 | 12-lead EKG | 14:00 예정 | SCHEDULED                 │
│ 이민정 | 폐기능검사  | 시행중      | IN_PROGRESS               │
│ 박지훈 | 심초음파    | 완료        | LVEF 62% ✅ 정상          │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 사이드바 메뉴 추가

```
임상
  ...
  수술
  응급실
  중환자실 (ICU)     ← 신규
  기초검사            ← 신규
```

---

## 7. 구현 우선순위

### Phase 1: 기초검사 (기존 패턴 활용, 빠름)
1. DiagnosticTest 모델 → Prisma 스키마
2. DiagnosticTest API (CRUD + 상태 변경)
3. 기초검사 UI 페이지 (/diagnostics)
4. 시드 데이터 (EKG/PFT/Echo 10건)

### Phase 2: ICU (복잡, 별도 모듈)
5. IcuBed, IcuAdmission, IcuRecord 모델
6. ICU API (입퇴실, 기록, 플로우시트)
7. ICU 대시보드 UI (/icu)
8. ICU 시드 데이터 (3환자, 바이탈 기록)

### Phase 3: 대시보드 연동
9. 의사 대시보드: ICU 환자 위젯
10. 간호사 대시보드: ICU 담당 환자
11. 검사실 대시보드: 기초검사 대기열

---

## 8. 수가코드 (EDI) 추가 필요

| 코드 | 검사명 | 수가 |
|------|--------|------|
| E6011 | 심전도(12유도) | 11,990원 |
| E6012 | 24시간 심전도(홀터) | 73,260원 |
| E6541 | 일반혈액검사(CBC) | 3,890원 (기존) |
| F6100 | 뇌파검사 | 82,340원 |
| F6110 | 수면다원검사 | 245,800원 |
| E6591 | 폐기능검사(기본) | 18,900원 |
| EB421 | 심초음파 | 77,390원 |
| EB441 | 운동부하검사 | 54,560원 |
| FA011 | 골밀도검사(DEXA) | 25,130원 |
| E7631 | 상부위장관내시경 | 47,800원 |
| E7651 | 대장내시경 | 62,400원 |
| FA091 | 청력검사(순음) | 15,230원 |
