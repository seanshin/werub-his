# 혈액은행 관리 시스템 기획서

## 현재 상태

### 이미 구현된 것
- Patient.bloodType (혈액형 필드)
- Surgery.ebl + fluidsGiven (수술 출혈량/수혈 텍스트)
- ConsentType.TRANSFUSION (수혈 동의서 유형)

### 부족한 것
- 혈액제제 재고 관리 없음
- 교차시험 (Cross-match) 없음
- 수혈 오더/기록 없음
- 혈액제제 추적 (수혈 시작~종료) 없음
- 수혈 부작용 모니터링 없음
- 혈액 폐기 관리 없음

## 기능 설계

### 1. 혈액제제 재고 (Blood Inventory)

```prisma
model BloodProduct {
  id              String    @id @default(uuid()) @db.Uuid
  unitNumber      String    @unique @map("unit_number") @db.VarChar(30) // 혈액번호
  productType     String    @map("product_type") @db.VarChar(30)
  // PRBC (농축적혈구), FFP (신선동결혈장), PC (혈소판농축액),
  // CRYO (동결침전제제), WB (전혈), APHERESIS_PLT (성분채혈혈소판),
  // LEUKOREDUCED_RBC (백혈구제거 적혈구), IRRADIATED_RBC (방사선조사 적혈구)
  bloodType       String    @map("blood_type") @db.VarChar(5) // A+, A-, B+, B-, AB+, AB-, O+, O-
  rhFactor        String    @map("rh_factor") @db.VarChar(3) // POS, NEG
  volume          Int       // mL
  collectedAt     DateTime  @map("collected_at") @db.Timestamptz()
  expiresAt       DateTime  @map("expires_at") @db.Timestamptz()
  donorId         String?   @map("donor_id") @db.VarChar(30) // 헌혈자 번호
  supplierName    String?   @map("supplier_name") @db.VarChar(100) // "대한적십자사 서울혈액원"
  receivedAt      DateTime  @map("received_at") @db.Timestamptz()
  status          String    @default("AVAILABLE") @db.VarChar(20)
  // AVAILABLE, RESERVED, CROSSMATCHED, ISSUED, TRANSFUSED, RETURNED, EXPIRED, DISCARDED
  storageLocation String?   @map("storage_location") @db.VarChar(50) // "혈액냉장고 1번"
  temperature     Decimal?  @db.Decimal(4, 1) // 보관 온도
  notes           String?   @db.Text
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  crossmatches    BloodCrossmatch[]
  transfusions    BloodTransfusion[]

  @@index([productType, bloodType, status])
  @@index([expiresAt])
  @@map("blood_products")
}
```

### 2. 교차시험 (Cross-match)

```prisma
model BloodCrossmatch {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  bloodProductId  String    @map("blood_product_id") @db.Uuid
  requestedBy     String    @map("requested_by") @db.Uuid
  requestedAt     DateTime  @default(now()) @map("requested_at") @db.Timestamptz()
  testedBy        String?   @map("tested_by") @db.Uuid
  testedAt        DateTime? @map("tested_at") @db.Timestamptz()
  method          String?   @db.VarChar(30) // TUBE, GEL_CARD, ELECTRONIC
  result          String?   @db.VarChar(20) // COMPATIBLE, INCOMPATIBLE, PENDING
  majorResult     String?   @map("major_result") @db.VarChar(20) // COMPATIBLE, INCOMPATIBLE
  minorResult     String?   @map("minor_result") @db.VarChar(20)
  antibodyScreen  String?   @map("antibody_screen") @db.VarChar(20) // NEGATIVE, POSITIVE
  antibodyId      String?   @map("antibody_id") @db.VarChar(100) // "Anti-Kell, Anti-Duffy(a)"
  validUntil      DateTime? @map("valid_until") @db.Timestamptz() // 교차시험 유효기간 (72h)
  notes           String?   @db.Text

  patient         Patient       @relation(fields: [patientId], references: [id])
  bloodProduct    BloodProduct  @relation(fields: [bloodProductId], references: [id])

  @@map("blood_crossmatches")
}
```

### 3. 수혈 오더 + 기록

```prisma
model TransfusionOrder {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  encounterId     String?   @map("encounter_id") @db.Uuid
  orderedBy       String    @map("ordered_by") @db.Uuid // 처방 의사
  productType     String    @map("product_type") @db.VarChar(30)
  units           Int       // 요청 단위 수
  urgency         String    @default("ROUTINE") @db.VarChar(20) // ROUTINE, URGENT, EMERGENT, MASSIVE
  indication      String?   @db.Text // 수혈 사유 ("Hb 6.8, 활동성 출혈")
  specialReqs     Json?     @map("special_reqs") @db.JsonB
  // ["IRRADIATED", "LEUKOREDUCED", "CMV_NEGATIVE", "WASHED", "HLA_MATCHED"]
  preTransfusionHb  Decimal? @map("pre_transfusion_hb") @db.Decimal(4, 1) // 수혈 전 Hb
  consentFormId   String?   @map("consent_form_id") @db.Uuid
  status          String    @default("ORDERED") @db.VarChar(20)
  // ORDERED, SPECIMEN_COLLECTED, CROSSMATCHING, READY, ISSUED, IN_PROGRESS, COMPLETED, CANCELLED
  orderedAt       DateTime  @default(now()) @map("ordered_at") @db.Timestamptz()

  patient         Patient   @relation(fields: [patientId], references: [id])

  transfusions    BloodTransfusion[]

  @@map("transfusion_orders")
}

model BloodTransfusion {
  id                String    @id @default(uuid()) @db.Uuid
  orderId           String    @map("order_id") @db.Uuid
  bloodProductId    String    @map("blood_product_id") @db.Uuid
  patientId         String    @map("patient_id") @db.Uuid
  // 수혈 전 확인 (JCI IPSG.1)
  verifiedByNurse1  String?   @map("verified_by_nurse1") @db.Uuid // 1차 확인 간호사
  verifiedByNurse2  String?   @map("verified_by_nurse2") @db.Uuid // 2차 확인 간호사
  verificationTime  DateTime? @map("verification_time") @db.Timestamptz()
  // 수혈 과정
  startTime         DateTime? @map("start_time") @db.Timestamptz()
  endTime           DateTime? @map("end_time") @db.Timestamptz()
  rate              Int?      // mL/hr (주입 속도)
  volumeTransfused  Int?      @map("volume_transfused") // 실제 투여량 mL
  // 모니터링 (수혈 시작 15분, 1시간, 완료 시)
  vitalSigns        Json?     @map("vital_signs") @db.JsonB
  // [{time, temp, bp, hr, rr, spo2, timing: "PRE"|"15MIN"|"1HR"|"POST"}]
  // 부작용
  reactionOccurred  Boolean   @default(false) @map("reaction_occurred")
  reactionType      String?   @map("reaction_type") @db.VarChar(50)
  // FEBRILE (발열), ALLERGIC (알레르기), HEMOLYTIC (용혈), ANAPHYLACTIC (아나필락시스),
  // TRALI (수혈 관련 폐손상), TACO (수혈 관련 순환과부하), DELAYED_HEMOLYTIC
  reactionSeverity  String?   @map("reaction_severity") @db.VarChar(20) // MILD, MODERATE, SEVERE
  reactionAction    String?   @map("reaction_action") @db.Text // 조치 내용
  status            String    @default("PENDING") @db.VarChar(20)
  // PENDING, VERIFIED, IN_PROGRESS, COMPLETED, STOPPED, REACTION
  notes             String?   @db.Text

  order             TransfusionOrder @relation(fields: [orderId], references: [id])
  bloodProduct      BloodProduct     @relation(fields: [bloodProductId], references: [id])
  patient           Patient          @relation(fields: [patientId], references: [id])

  @@map("blood_transfusions")
}
```

### 4. API 설계

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| | **재고** | | |
| 1 | GET | `/api/v1/blood-bank/inventory` | 혈액제제 재고 (유형/혈액형 필터) |
| 2 | POST | `/api/v1/blood-bank/inventory` | 혈액 입고 |
| 3 | GET | `/api/v1/blood-bank/inventory/:id` | 제제 상세 |
| 4 | PATCH | `/api/v1/blood-bank/inventory/:id/status` | 상태 변경 (폐기/반환) |
| 5 | GET | `/api/v1/blood-bank/inventory/expiring` | 유효기간 임박 목록 |
| 6 | GET | `/api/v1/blood-bank/inventory/stats` | 재고 통계 (유형별/혈액형별) |
| | **교차시험** | | |
| 7 | POST | `/api/v1/blood-bank/crossmatch` | 교차시험 요청 |
| 8 | PATCH | `/api/v1/blood-bank/crossmatch/:id/result` | 교차시험 결과 입력 |
| 9 | GET | `/api/v1/blood-bank/crossmatch/patient/:patientId` | 환자 교차시험 이력 |
| | **수혈** | | |
| 10 | POST | `/api/v1/blood-bank/transfusion-orders` | 수혈 오더 |
| 11 | GET | `/api/v1/blood-bank/transfusion-orders` | 수혈 오더 목록 |
| 12 | POST | `/api/v1/blood-bank/transfusions/:orderId/issue` | 혈액 출고 |
| 13 | POST | `/api/v1/blood-bank/transfusions/:id/verify` | 수혈 전 2인 확인 |
| 14 | PATCH | `/api/v1/blood-bank/transfusions/:id/start` | 수혈 시작 |
| 15 | POST | `/api/v1/blood-bank/transfusions/:id/vitals` | 수혈 중 활력징후 |
| 16 | PATCH | `/api/v1/blood-bank/transfusions/:id/complete` | 수혈 완료 |
| 17 | POST | `/api/v1/blood-bank/transfusions/:id/reaction` | 수혈 부작용 보고 |
| 18 | GET | `/api/v1/blood-bank/dashboard` | 혈액은행 대시보드 |

### 5. 화면 기획

```
혈액은행 (/blood-bank)
├── 재고 관리 (입고, 재고 현황, 유효기간)
├── 교차시험 (요청, 결과 입력, 이력)
├── 수혈 관리 (오더, 출고, 수혈 기록, 부작용)
└── 혈액은행 대시보드
```

#### 혈액은행 대시보드
```
┌─ 재고 현황 ───────────────────────────────────────────────────┐
│        A+   A-   B+   B-   AB+  AB-  O+   O-   합계          │
│ pRBC   12    3    8    2    4    1   15    5    50            │
│ FFP     8    2    6    1    3    1   10    3    34            │
│ PC      4    1    3    0    2    0    5    2    17            │
│ 합계   24    6   17    3    9    2   30   10   101           │
└───────────────────────────────────────────────────────────────┘

┌─ 긴급 알림 ───────────────┬─ 오늘 현황 ─────────────────────┐
│ ⚠ O- pRBC 5단위 이하      │  수혈 오더: 3건                  │
│ ⚠ AB- FFP 재고 없음       │  교차시험 대기: 2건              │
│ ⚠ 유효기간 3일 이내: 8단위 │  진행 중 수혈: 1건              │
│                           │  부작용 보고: 0건                │
└───────────────────────────┴──────────────────────────────────┘

┌─ 수혈 워크플로우 ─────────────────────────────────────────────┐
│ [오더] → [검체채취] → [교차시험] → [출고] → [2인확인] →       │
│ [수혈시작] → [15분 V/S] → [1시간 V/S] → [완료 V/S]          │
└───────────────────────────────────────────────────────────────┘
```

#### 수혈 기록
```
┌─ 수혈 기록 ───────────────────────────────────────────────────┐
│  환자: 김OO (O+)  │  pRBC 2단위 오더  │  긴급도: URGENT       │
│  사유: Hb 6.8, 수술 후 활동성 출혈                            │
│                                                               │
│  Unit #1: K-2026-0519-001 (O+ pRBC 320mL)                    │
│  교차시험: COMPATIBLE ✓  │  유효기간: 2026-06-15              │
│                                                               │
│  ┌─ 2인 확인 ────────────────────────────────────────┐        │
│  │  1차: 조간호 ✓  │  2차: 서간호 ✓  │  12:30 확인완료 │     │
│  │  환자명 ✓  혈액형 ✓  혈액번호 ✓  유효기간 ✓       │       │
│  └──────────────────────────────────────────────────┘         │
│                                                               │
│  수혈 전 V/S: 36.5°C  120/75  78  98%                        │
│  12:30 수혈 시작 (80mL/hr)                                    │
│  12:45 15분 V/S: 36.6°C  118/72  80  99%  ✓ 이상 없음       │
│  13:30  1시간 V/S: 36.7°C  122/78  76  99% ✓                │
│  16:30 수혈 완료 V/S: 36.5°C  118/74  74  99%                │
│                                                               │
│  수혈량: 320mL  │  소요시간: 4시간  │  부작용: 없음           │
└───────────────────────────────────────────────────────────────┘
```

### 6. 안전 규정

#### JCI 환자안전 (IPSG)
- **IPSG.1**: 수혈 전 2인 확인 (환자명, 혈액형, 혈액번호, 유효기간)
- **IPSG.5**: 수혈 부작용 즉시 보고 → 혈액 중단 → 보관 → 검사 의뢰

#### 혈액관리법 (대한적십자사)
- 혈액제제 온도 관리 (pRBC: 2~6°C, FFP: -18°C 이하, PC: 20~24°C)
- 혈액제제 추적 관리 (입고→보관→출고→수혈→폐기 전 과정)
- 수혈 부작용 보고 (식약처 혈액안전감시체계)

## 구현 우선순위

1. **혈액 재고** (BloodProduct) — 입고, 재고 현황, 유효기간 관리
2. **교차시험** (BloodCrossmatch) — 요청, 결과 입력, 호환성 확인
3. **수혈 오더** (TransfusionOrder) — 의사 처방, 동의서 연계
4. **수혈 기록** (BloodTransfusion) — 2인 확인, 모니터링, 부작용
5. **혈액은행 대시보드** — 재고 매트릭스, 긴급 알림, 수혈 현황
