# 투석실 관리 시스템 기획서

## 목표

혈액투석(HD) 및 복막투석(PD) 환자의 치료 전 과정 관리: 투석 처방 → 기기 배정 → 치료 기록 → 합병증 추적

## 기능 설계

### 1. 투석 처방 (Dialysis Order)

```prisma
model DialysisOrder {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  modality      String   @db.VarChar(20)       // HD (혈액투석), PD (복막투석), CRRT (연속신대체)
  frequency     String   @db.VarChar(30)       // "주 3회", "매일"
  duration      Int      // 분 (HD: 240, CRRT: 1440)
  // HD 처방
  dialyzerType  String?  @map("dialyzer_type") @db.VarChar(50) // "FX-80", "Polyflux 210H"
  bloodFlowRate Int?     @map("blood_flow_rate") // mL/min (200-400)
  dialysateFlow Int?     @map("dialysate_flow")  // mL/min (500-800)
  dryWeight     Decimal? @map("dry_weight") @db.Decimal(5, 1) // 건체중 kg
  ufGoal        Int?     @map("uf_goal")         // 제수 목표 mL
  anticoagulant String?  @db.VarChar(50)        // "헤파린 1000U", "무헤파린"
  accessType    String?  @map("access_type") @db.VarChar(30) // AVF, AVG, PERM_CATH, TEMP_CATH
  // PD 처방
  pdSolution    String?  @map("pd_solution") @db.VarChar(50) // "1.5% Dianeal"
  pdVolume      Int?     @map("pd_volume")       // mL/회 (2000)
  pdExchanges   Int?     @map("pd_exchanges")    // 교환 횟수/일
  dwellTime     Int?     @map("dwell_time")      // 저류 시간 (분)
  prescribedBy  String   @map("prescribed_by") @db.Uuid
  startDate     DateTime @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date
  isActive      Boolean  @default(true) @map("is_active")
  notes         String?  @db.Text
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient       Patient  @relation(fields: [patientId], references: [id])
  sessions      DialysisSession[]
  @@map("dialysis_orders")
}
```

### 2. 투석 세션 (Treatment Record)

```prisma
model DialysisSession {
  id            String    @id @default(uuid()) @db.Uuid
  orderId       String    @map("order_id") @db.Uuid
  patientId     String    @map("patient_id") @db.Uuid
  machineId     String?   @map("machine_id") @db.Uuid
  scheduledDate DateTime  @map("scheduled_date") @db.Date
  shift         String?   @db.VarChar(10)       // AM, PM, EVE (오전/오후/저녁)
  // 치료 전
  preWeight     Decimal?  @map("pre_weight") @db.Decimal(5, 1)
  preTemp       Decimal?  @map("pre_temp") @db.Decimal(4, 1)
  preBp         String?   @map("pre_bp") @db.VarChar(20)
  preHr         Int?      @map("pre_hr")
  // 치료 중 (시계열)
  intradialyticVitals Json? @map("intradialytic_vitals") @db.JsonB
  // [{time, bp, hr, ufRate, venousPressure, arterialPressure, tmpPressure}]
  // 치료 후
  postWeight    Decimal?  @map("post_weight") @db.Decimal(5, 1)
  postTemp      Decimal?  @map("post_temp") @db.Decimal(4, 1)
  postBp        String?   @map("post_bp") @db.VarChar(20)
  postHr        Int?      @map("post_hr")
  actualUf      Int?      @map("actual_uf")      // 실제 제수량 mL
  actualDuration Int?     @map("actual_duration") // 실제 시간 (분)
  ktV           Decimal?  @map("kt_v") @db.Decimal(4, 2) // 투석 적절도 (목표 ≥1.2)
  startTime     DateTime? @map("start_time") @db.Timestamptz()
  endTime       DateTime? @map("end_time") @db.Timestamptz()
  nurseId       String?   @map("nurse_id") @db.Uuid
  complications Json?     @db.JsonB // [{type, description, time, action}]
  // HYPOTENSION, CRAMPS, NAUSEA, HEADACHE, CHEST_PAIN, ACCESS_CLOT, AIR_EMBOLISM
  status        String    @default("SCHEDULED") @db.VarChar(20) // SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
  notes         String?   @db.Text

  order         DialysisOrder @relation(fields: [orderId], references: [id])
  @@index([scheduledDate, shift])
  @@map("dialysis_sessions")
}
```

### 3. 투석기 관리

```prisma
model DialysisMachine {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @db.VarChar(50)        // "HD-01", "CRRT-01"
  model       String?  @db.VarChar(100)       // "Fresenius 5008S"
  serialNumber String? @map("serial_number") @db.VarChar(50)
  machineType String   @map("machine_type") @db.VarChar(20) // HD, CRRT, PD_CYCLER
  location    String?  @db.VarChar(50)        // "투석실 A구역 1번"
  status      String   @default("AVAILABLE") @db.VarChar(20) // AVAILABLE, IN_USE, MAINTENANCE, OUT_OF_SERVICE
  lastDisinfection DateTime? @map("last_disinfection") @db.Timestamptz()
  isActive    Boolean  @default(true) @map("is_active")

  @@map("dialysis_machines")
}
```

### 4. API (18개)

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| | **처방** | | |
| 1 | POST | `/api/v1/dialysis/orders` | 투석 처방 |
| 2 | GET | `/api/v1/dialysis/orders` | 처방 목록 |
| 3 | GET | `/api/v1/dialysis/orders/:id` | 처방 상세 |
| 4 | PATCH | `/api/v1/dialysis/orders/:id` | 처방 수정/종료 |
| | **세션** | | |
| 5 | POST | `/api/v1/dialysis/sessions/generate` | 월간 세션 자동 생성 |
| 6 | GET | `/api/v1/dialysis/sessions` | 세션 목록 (날짜/환자) |
| 7 | GET | `/api/v1/dialysis/sessions/:id` | 세션 상세 |
| 8 | PATCH | `/api/v1/dialysis/sessions/:id/start` | 투석 시작 (전 활력징후) |
| 9 | POST | `/api/v1/dialysis/sessions/:id/vitals` | 투석 중 활력징후 |
| 10 | PATCH | `/api/v1/dialysis/sessions/:id/complete` | 투석 완료 (후 활력징후, Kt/V) |
| 11 | POST | `/api/v1/dialysis/sessions/:id/complication` | 합병증 기록 |
| | **기기** | | |
| 12 | GET | `/api/v1/dialysis/machines` | 투석기 목록 |
| 13 | POST | `/api/v1/dialysis/machines` | 투석기 등록 |
| 14 | PATCH | `/api/v1/dialysis/machines/:id/status` | 상태 변경 |
| 15 | PATCH | `/api/v1/dialysis/machines/:id/disinfect` | 소독 기록 |
| | **통계** | | |
| 16 | GET | `/api/v1/dialysis/dashboard` | 투석실 대시보드 |
| 17 | GET | `/api/v1/dialysis/patients/:id/history` | 환자 투석 이력 |
| 18 | GET | `/api/v1/dialysis/stats` | 투석 통계 (Kt/V 달성률, 합병증) |

### 5. 화면 기획

```
투석실 (/dialysis)
├── 오늘 스케줄 (AM/PM/EVE 시프트별)
├── 투석 처방 관리
├── 투석 기록 (실시간 활력징후)
├── 투석기 배정/상태
├── 환자 이력 (Kt/V 추이)
└── 대시보드
```

#### 투석실 대시보드
```
┌─ 오늘 현황 ───────────────────────────────────────────────────┐
│  AM: 8/10  │  PM: 6/10  │  EVE: 3/10  │  합계: 17/30         │
├───────────────────────────────────────────────────────────────┤
│  기기 1  [투석중 ●] 김OO  BFR:300  UF:2.5L  2h/4h 경과      │
│  기기 2  [투석중 ●] 박OO  BFR:250  UF:2.0L  1h/4h 경과      │
│  기기 3  [대기 ○]  다음: PM 이OO                              │
│  기기 4  [소독 ◐]  열소독 진행 중                             │
│  ...                                                          │
└───────────────────────────────────────────────────────────────┘

┌─ Kt/V 달성률 (이번 달) ─┬─ 합병증 현황 ──────────────────────┐
│  ≥1.2 달성: 85%         │  저혈압: 12건                      │
│  평균 Kt/V: 1.35        │  근경련: 5건                       │
│  █████████░░ 85%        │  두통: 3건                         │
└─────────────────────────┴────────────────────────────────────┘
```

#### 투석 기록 (실시간)
```
┌─ 김OO HD 기록 ────────────────────────────────────────────────┐
│  처방: HD 주3회/4시간  │  기기: HD-01 (5008S)                  │
│  건체중: 65.0kg  │  접근: AVF (좌완)  │  항응고: 헤파린 1000U  │
│                                                               │
│  전: 67.2kg  BP 140/85  HR 78  T 36.5                        │
│                                                               │
│  시간    BP      HR   UF속도  정맥압  동맥압                  │
│  09:00  138/82   76   800     120     -150                    │
│  09:30  132/78   74   800     118     -148                    │
│  10:00  125/72   78   900     122     -155     ← UF 증가     │
│  10:30  110/65   82   900     125     -158     ⚠ BP↓         │
│  11:00  118/70   80   700     120     -152     ← UF 감소     │
│                                                               │
│  후: 65.1kg  BP 120/75  HR 74  실제UF: 2100mL  Kt/V: 1.32    │
└───────────────────────────────────────────────────────────────┘
```

## 구현 우선순위

1. 투석 처방 (DialysisOrder) — HD/PD/CRRT
2. 투석 세션 (자동 생성 + 실시간 기록)
3. 투석기 관리 + 배정
4. Kt/V 추적 + 합병증 통계
