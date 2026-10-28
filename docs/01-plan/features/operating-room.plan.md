# 수술실 관리 시스템 기획서

## 현재 상태

### 이미 구현된 것
- Surgery 모델: 스케줄링, 시작/완료, Op Note (15 필드)
- API 5개: schedule, create, detail, start, complete
- 수술 상태: SCHEDULED → IN_PROGRESS → COMPLETED / CANCELLED
- Op Note: 집도의/마취과/보조/스크럽 간호사, EBL, 수액, 검체, 드레인 등

### 부족한 것
- 수술실 관리 (OR Room 배정, 일정 최적화) 없음
- 마취 기록 (Anesthesia Record) 구조화 없음 (현재 텍스트 필드)
- 회복실 (PACU) 모니터링 없음
- 수술 장비/세트 추적 없음
- 수술 전 체크리스트 (WHO Surgical Safety Checklist) 없음
- 수술 통계 (수술실 가동률, 지연, 취소율) 없음

## 기능 설계

### 1. 수술실 관리 (Operating Room)

```prisma
model OperatingRoom {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @db.VarChar(50) // "OR-1", "OR-2", "외래 시술실"
  floor       String?  @db.VarChar(20)
  roomType    String   @map("room_type") @db.VarChar(30)
  // GENERAL, CARDIAC, NEURO, ORTHO, ENT, OPH, MINOR_PROCEDURE
  equipment   Json?    @db.JsonB // ["C-Arm", "Microscope", "Laser"]
  isActive    Boolean  @default(true) @map("is_active")
  capacity    Int      @default(1) // 동시 수술 수 (보통 1)

  schedules   OrSchedule[]

  @@map("operating_rooms")
}

model OrSchedule {
  id              String    @id @default(uuid()) @db.Uuid
  roomId          String    @map("room_id") @db.Uuid
  surgeryId       String    @map("surgery_id") @db.Uuid
  date            DateTime  @db.Date
  startTime       String    @map("start_time") @db.VarChar(5) // "09:00"
  endTime         String    @map("end_time") @db.VarChar(5) // "11:30"
  estimatedDuration Int     @map("estimated_duration") // 분
  actualStartTime DateTime? @map("actual_start_time") @db.Timestamptz()
  actualEndTime   DateTime? @map("actual_end_time") @db.Timestamptz()
  setupTime       Int       @default(30) @map("setup_time") // 세팅 시간 (분)
  cleanupTime     Int       @default(15) @map("cleanup_time") // 정리 시간 (분)
  status          String    @default("SCHEDULED") @db.VarChar(20)
  // SCHEDULED, PREPARING, IN_OR, IN_PROGRESS, CLOSING, CLEANUP, COMPLETED, CANCELLED, DELAYED
  delayReason     String?   @map("delay_reason") @db.Text
  notes           String?   @db.Text

  room            OperatingRoom @relation(fields: [roomId], references: [id])

  @@index([roomId, date])
  @@map("or_schedules")
}
```

### 2. 마취 기록 (Anesthesia Record)

```prisma
model AnesthesiaRecord {
  id              String    @id @default(uuid()) @db.Uuid
  surgeryId       String    @unique @map("surgery_id") @db.Uuid
  anesthetistId   String    @map("anesthetist_id") @db.Uuid
  asaClass        String?   @map("asa_class") @db.VarChar(10) // ASA I~VI
  anesthesiaType  String    @map("anesthesia_type") @db.VarChar(30)
  // GENERAL, SPINAL, EPIDURAL, REGIONAL, LOCAL, SEDATION, COMBINED
  airwayType      String?   @map("airway_type") @db.VarChar(30)
  // ETT (기관내관), LMA (후두마스크), MASK, NASAL
  ettSize         String?   @map("ett_size") @db.VarChar(10) // "7.0", "7.5"
  inductionTime   DateTime? @map("induction_time") @db.Timestamptz()
  intubationTime  DateTime? @map("intubation_time") @db.Timestamptz()
  incisionTime    DateTime? @map("incision_time") @db.Timestamptz()
  closureTime     DateTime? @map("closure_time") @db.Timestamptz()
  extubationTime  DateTime? @map("extubation_time") @db.Timestamptz()
  pacuArrivalTime DateTime? @map("pacu_arrival_time") @db.Timestamptz()

  // 마취 약물
  inductionDrugs  Json?     @map("induction_drugs") @db.JsonB
  // [{name, dose, unit, time}] — "프로포폴 200mg", "로쿠로늄 50mg"
  maintenanceDrugs Json?    @map("maintenance_drugs") @db.JsonB
  // [{name, dose, unit, method}] — "세보플루란 2vol%", "레미펜타닐 0.1mcg/kg/min"
  analgesics      Json?     @db.JsonB
  muscleRelaxants Json?     @map("muscle_relaxants") @db.JsonB
  reversal        Json?     @db.JsonB // "슈가마덱스 200mg"

  // I/O
  fluidInput      Json?     @map("fluid_input") @db.JsonB // [{type, volume}]
  bloodProducts   Json?     @map("blood_products") @db.JsonB // [{type, units, volume}]
  ebl             Int?      // Estimated Blood Loss (mL)
  urineOutput     Int?      @map("urine_output") // mL

  // 합병증
  complications   Json?     @db.JsonB // [{type, description, time}]
  notes           String?   @db.Text

  // 활력징후 (시계열)
  vitalSigns      Json?     @map("vital_signs") @db.JsonB
  // [{time, systolicBp, diastolicBp, heartRate, spo2, etco2, fiO2, temp}]

  @@map("anesthesia_records")
}
```

### 3. 회복실 (PACU)

```prisma
model PacuRecord {
  id              String    @id @default(uuid()) @db.Uuid
  surgeryId       String    @map("surgery_id") @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  arrivalTime     DateTime  @map("arrival_time") @db.Timestamptz()
  dischargeTime   DateTime? @map("discharge_time") @db.Timestamptz()
  aldretScore     Int?      @map("aldrete_score") // 0-10 (PACU 퇴실 기준 ≥9)
  painScore       Int?      @map("pain_score") // NRS 0-10
  nauseaVomiting  Boolean?  @map("nausea_vomiting")
  shivering       Boolean?
  oxygenTherapy   String?   @map("oxygen_therapy") @db.VarChar(50) // "Nasal 3L", "Mask 5L"
  vitalSigns      Json?     @map("vital_signs") @db.JsonB // 15분 간격 활력징후
  interventions   Json?     @db.JsonB // [{time, action, drug, dose}]
  nurseId         String    @map("nurse_id") @db.Uuid
  disposition     String?   @db.VarChar(30) // WARD, ICU, HOME, ER
  notes           String?   @db.Text

  @@map("pacu_records")
}
```

### 4. 수술 안전 체크리스트 (WHO)

```prisma
model SurgicalChecklist {
  id          String   @id @default(uuid()) @db.Uuid
  surgeryId   String   @unique @map("surgery_id") @db.Uuid

  // Sign In (마취 유도 전)
  signInPatientId       Boolean? @map("sign_in_patient_id")       // 환자 확인
  signInSiteMarked      Boolean? @map("sign_in_site_marked")      // 수술 부위 표시
  signInConsentSigned   Boolean? @map("sign_in_consent_signed")   // 동의서 서명
  signInAnesthesiaCheck Boolean? @map("sign_in_anesthesia_check") // 마취 안전 점검
  signInPulseOximeter   Boolean? @map("sign_in_pulse_oximeter")   // 산소포화도 모니터
  signInAllergyCheck    Boolean? @map("sign_in_allergy_check")    // 알레르기 확인
  signInAirwayRisk      Boolean? @map("sign_in_airway_risk")      // 기도 관리 위험
  signInBloodLossRisk   Boolean? @map("sign_in_blood_loss_risk")  // 출혈 위험
  signInCompletedBy     String?  @map("sign_in_completed_by") @db.Uuid
  signInCompletedAt     DateTime? @map("sign_in_completed_at") @db.Timestamptz()

  // Time Out (피부 절개 전)
  timeOutTeamIntro      Boolean? @map("time_out_team_intro")       // 팀원 소개
  timeOutPatientName    Boolean? @map("time_out_patient_name")     // 환자명 확인
  timeOutProcedure      Boolean? @map("time_out_procedure")        // 수술명 확인
  timeOutSite           Boolean? @map("time_out_site")             // 부위 확인
  timeOutAntibiotics    Boolean? @map("time_out_antibiotics")      // 예방적 항생제
  timeOutImaging        Boolean? @map("time_out_imaging")          // 영상 확인
  timeOutCompletedBy    String?  @map("time_out_completed_by") @db.Uuid
  timeOutCompletedAt    DateTime? @map("time_out_completed_at") @db.Timestamptz()

  // Sign Out (환자 퇴실 전)
  signOutProcedureRecorded Boolean? @map("sign_out_procedure_recorded") // 수술명 기록
  signOutInstrumentCount   Boolean? @map("sign_out_instrument_count")   // 기구 수량 확인
  signOutSpecimenLabeled   Boolean? @map("sign_out_specimen_labeled")   // 검체 라벨링
  signOutEquipmentIssues   Boolean? @map("sign_out_equipment_issues")   // 장비 문제
  signOutRecoveryPlan      Boolean? @map("sign_out_recovery_plan")      // 회복 계획
  signOutCompletedBy       String?  @map("sign_out_completed_by") @db.Uuid
  signOutCompletedAt       DateTime? @map("sign_out_completed_at") @db.Timestamptz()

  @@map("surgical_checklists")
}
```

### 5. API 설계

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | GET | `/api/v1/surgery/rooms` | 수술실 목록 |
| 2 | POST | `/api/v1/surgery/rooms` | 수술실 등록 |
| 3 | GET | `/api/v1/surgery/rooms/:id/schedule` | 수술실별 일정 |
| 4 | POST | `/api/v1/surgery/rooms/assign` | 수술실 배정 |
| 5 | GET | `/api/v1/surgery/board` | 수술 현황판 (전체 OR 실시간) |
| 6 | POST | `/api/v1/surgery/:id/anesthesia` | 마취 기록 생성 |
| 7 | PATCH | `/api/v1/surgery/:id/anesthesia` | 마취 기록 업데이트 |
| 8 | POST | `/api/v1/surgery/:id/anesthesia/vitals` | 마취 중 활력징후 |
| 9 | POST | `/api/v1/surgery/:id/pacu` | 회복실 입실 |
| 10 | PATCH | `/api/v1/surgery/:id/pacu` | 회복실 기록 업데이트 |
| 11 | PATCH | `/api/v1/surgery/:id/pacu/discharge` | 회복실 퇴실 |
| 12 | POST | `/api/v1/surgery/:id/checklist` | WHO 체크리스트 생성 |
| 13 | PATCH | `/api/v1/surgery/:id/checklist/sign-in` | Sign In 완료 |
| 14 | PATCH | `/api/v1/surgery/:id/checklist/time-out` | Time Out 완료 |
| 15 | PATCH | `/api/v1/surgery/:id/checklist/sign-out` | Sign Out 완료 |
| 16 | GET | `/api/v1/surgery/stats` | 수술 통계 (가동률, 지연, 취소) |

### 6. 화면 기획

```
수술 관리 (/surgery)
├── 수술 일정 (기존 + 수술실 배정)
├── 수술 현황판 (OR Board — 실시간)
├── 마취 기록
├── 회복실 (PACU)
├── 안전 체크리스트 (WHO)
└── 수술 통계
```

#### 수술 현황판 (OR Board)
```
┌─ 수술 현황판 ─────────────────────────────────────────────────┐
│                                                               │
│  OR-1   [수술중 ●]  김OO  Lt. TKR  09:00~  이외과 / 강마취    │
│         ████████████░░░░ 2h 15m 경과                          │
│                                                               │
│  OR-2   [준비중 ◐]  박OO  LAP CHOLE  11:00~  최외과           │
│         체크리스트: Sign In ✓  Time Out ○                      │
│                                                               │
│  OR-3   [회복실 ◑]  이OO  Arthroscopy  완료  PACU             │
│         Aldrete: 8/10  통증: NRS 4                            │
│                                                               │
│  OR-4   [대기 ○]  다음: 14:00 한OO C-section                  │
└───────────────────────────────────────────────────────────────┘
```

#### 마취 기록
```
┌─ 마취 기록 ───────────────────────────────────────────────────┐
│  환자: 김OO  │  수술: Lt. TKR  │  ASA: II  │  전신마취       │
│                                                               │
│  타임라인:                                                    │
│  09:00 마취유도 (프로포폴 200mg + 로쿠로늄 50mg)              │
│  09:05 기관삽관 (ETT 7.5)                                     │
│  09:10 피부절개                                               │
│  ...                                                          │
│  11:15 봉합완료                                               │
│  11:20 발관 (슈가마덱스 200mg)                                │
│  11:25 PACU 도착                                              │
│                                                               │
│  활력징후 (5분 간격 차트):                                     │
│  BP  ──────────────────────────────                           │
│  HR  ──────────────────────────────                           │
│  SpO2 ─────────────────────────────                           │
│                                                               │
│  I/O: 수액 1500mL + pRBC 2U  │  EBL 400mL  │  소변 300mL    │
└───────────────────────────────────────────────────────────────┘
```

## 구현 우선순위

1. **수술실 관리** (OperatingRoom + OrSchedule) — 수술실 배정, 현황판
2. **WHO 체크리스트** (SurgicalChecklist) — 환자 안전 필수
3. **마취 기록** (AnesthesiaRecord) — 구조화된 마취 기록
4. **회복실** (PacuRecord) — PACU 모니터링, Aldrete 점수
5. **수술 통계** — 가동률, 지연, 취소율
