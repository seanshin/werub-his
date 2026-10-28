# 처방/오더 시스템 고도화 기획

> **Feature**: order-prescription-enhancement
> **Created**: 2026-05-08
> **Status**: Draft
> **Priority**: High

---

## 1. 개요

현재 처방 시스템은 기본 SOAP 진료 → 처방 입력 → 오더 자동 생성 흐름이 구현되어 있으나,
실제 병원 운영에 필요한 **Pre-Order(사전오더)**, **의료진별 처방 관리**, **진료과별 코드 관리** 기능이 부족하다.

### 1.1 현재 상태 (AS-IS)

| 구분 | 상태 | 비고 |
|------|------|------|
| 처방 입력 (Prescription) | ✅ | 약/검사/영상 3타입, DUR 체크 |
| 오더 자동생성 (Order) | ✅ | 처방 → 약국/검사실/영상 자동 라우팅 |
| 오더 상태관리 (OCS) | ✅ | ORDERED→RECEIVED→IN_PROGRESS→COMPLETED |
| 약속처방 (OrderSet/CP) | ✅ | 진료과/진단코드별 템플릿 |
| 즐겨찾기 (FavoriteOrder) | ✅ | 의사 개인 처방 세트 |
| DUR 체크 | ✅ | 23개 상호작용 + 중복/연령/용량/알레르기 |
| **Pre-Order (사전오더)** | ❌ | 진료 전 미리 오더 넣어두기 |
| **의료진별 처방 코드 관리** | ❌ | 자주 쓰는 약/검사 코드 커스텀 목록 |
| **진료과별 코드 카탈로그** | ❌ | 과별 표준 처방 코드 세트 |
| **처방 복사/반복** | ❌ | 이전 처방 재사용 |
| **오더 우선순위** | ❌ | STAT/Routine/PRN 구분 |
| **처방 검증 강화** | ❌ | 용량 단위 검증, 투여경로 호환성 |

### 1.2 목표 상태 (TO-BE)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        처방/오더 시스템 고도화                            │
│                                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Pre-Order   │  │ 의료진별      │  │ 진료과별      │  │ 처방 복사/   │ │
│  │ 사전 오더    │  │ 처방 관리     │  │ 코드 관리     │  │ 반복 처방    │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                │                  │                 │         │
│         ▼                ▼                  ▼                 ▼         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                   진료 차트 (처방 입력 패널)                      │   │
│  │                                                                  │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐ │   │
│  │  │내 목록│ │CP 적용│ │코드  │ │Pre-  │ │이전  │ │ + 수동 입력  │ │   │
│  │  │      │ │      │ │검색  │ │Order │ │처방  │ │              │ │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────────────┘ │   │
│  │                                                                  │   │
│  │  ┌─ 처방 목록 ───────────────────────────────────────────────┐  │   │
│  │  │ 💊 아세트아미노펜 500mg PO 1일3회 5일    STAT  [DUR✅]    │  │   │
│  │  │ 🧪 CBC, 간기능 검사                      Routine          │  │   │
│  │  │ 📷 Chest X-ray PA                        Routine          │  │   │
│  │  │ ⏳ [Pre] 혈액응고 검사 (내일 수술 전)     PRE-ORDER        │  │   │
│  │  └────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    관리 기능 (설정)                                │   │
│  │                                                                  │   │
│  │  의료진: 내 처방 목록 관리 / 자주 쓰는 약 세트 / 처방 통계        │   │
│  │  과장:   과별 표준 코드 관리 / 약속처방 관리 / 신규 코드 요청      │   │
│  │  관리자: 전체 코드 마스터 관리 / 처방 통계 / 시스템 설정           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 기능 요구사항

### 2.1 Pre-Order (사전 오더)

진료 전에 미리 오더를 넣어두고, 진료 시 확인/승인하여 실행하는 기능.

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| PO-01 | Pre-Order 생성 | 진료 전 오더를 미리 등록 (상태: PENDING) | P0 |
| PO-02 | Pre-Order 목록 | 환자별/의사별 사전 오더 목록 조회 | P0 |
| PO-03 | Pre-Order 승인 | 진료 시 Pre-Order를 확인하고 실행/수정/취소 | P0 |
| PO-04 | Pre-Order 자동 표시 | 진료 시작 시 미결 Pre-Order 알림 배너 | P1 |
| PO-05 | Pre-Order 예약 | 특정 날짜/시간에 실행되는 예약 오더 | P2 |
| PO-06 | Pre-Order 연동 | 수술 전 검사, 입원 전 투약 등 워크플로우 연동 | P2 |

**사용 시나리오:**
```
1. 외래 환자가 다음 주 수술 예정
   → 의사가 "수술 전 검사" Pre-Order 등록
   → 환자 내원 시 검사실에서 Pre-Order 확인 → 바로 검사 시작

2. 만성질환 환자 정기 투약
   → 의사가 3개월 후 재진 시 동일 처방 Pre-Order
   → 재진 시 Pre-Order 확인 → 승인 → 처방 완료

3. 입원 환자 다음날 아침 검사
   → 당직의가 Pre-Order 등록 (실행일: 내일 06:00)
   → 다음날 아침 간호사가 확인 → 채혈
```

**Pre-Order 상태 흐름:**
```
PENDING → APPROVED → (Prescription 생성 → Order 생성)
PENDING → MODIFIED → APPROVED
PENDING → CANCELLED
PENDING → EXPIRED (기한 초과)
```

### 2.2 의료진별 처방 관리 (My Prescription Management)

의사 개인이 자주 사용하는 처방 코드/세트를 관리하는 기능.

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| MY-01 | 내 약 목록 | 자주 처방하는 약물 코드 커스텀 목록 | P0 |
| MY-02 | 내 검사 목록 | 자주 오더하는 검사 코드 커스텀 목록 | P0 |
| MY-03 | 내 처방 세트 | 복합 처방 템플릿 (FavoriteOrder 강화) | P0 |
| MY-04 | 처방 통계 | 내가 가장 많이 처방하는 약/검사 Top 20 | P1 |
| MY-05 | 처방 자동완성 | 입력 중 내 빈용 코드 우선 표시 | P1 |
| MY-06 | 처방 가져오기 | 다른 의사/과의 처방 세트 복사 | P2 |

**내 처방 목록 구조:**
```
┌─ 김내과 선생님의 처방 목록 ──────────────────────────────┐
│                                                         │
│ 📋 내 약물 (12개)                                       │
│ ├─ ⭐ 아모레틴 500mg  |  경구  1일3회  [사용 247회]      │
│ ├─ ⭐ 아세트아미노펜 650mg  |  경구  1일3회  [사용 189회] │
│ ├─ 메트포민 500mg  |  경구  1일2회  [사용 156회]         │
│ ├─ 암로디핀 5mg  |  경구  1일1회  [사용 134회]           │
│ └─ ... (더보기)                                          │
│                                                         │
│ 📋 내 검사 (8개)                                         │
│ ├─ ⭐ CBC + 간기능 + 신기능 세트  [사용 89회]            │
│ ├─ ⭐ 갑상선 기능 검사  [사용 56회]                       │
│ └─ ... (더보기)                                          │
│                                                         │
│ 📋 내 처방 세트 (5개)                                    │
│ ├─ ⭐ 고혈압 기본 처방 (암로디핀+검사)  [사용 78회]       │
│ ├─ ⭐ 당뇨 재진 처방 (메트포민+HbA1c)  [사용 65회]       │
│ └─ ... (더보기)                                          │
└─────────────────────────────────────────────────────────┘
```

### 2.3 진료과별 코드 카탈로그 (Department Code Catalog)

진료과 단위로 사용하는 약물/검사/영상 코드를 정의하고 관리하는 기능.

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| DC-01 | 과별 코드 목록 | 진료과에서 사용하는 약/검사/영상 코드 목록 | P0 |
| DC-02 | 코드 추가/제거 | 과장(또는 지정 관리자)이 과별 코드 관리 | P0 |
| DC-03 | 코드 검색 필터 | 처방 시 "내 과 코드" 필터 우선 표시 | P1 |
| DC-04 | 표준 처방 가이드 | 과별 권장 용량/빈도/기간 기본값 설정 | P1 |
| DC-05 | 코드 사용 통계 | 과별 코드 사용 빈도 분석 | P2 |
| DC-06 | 코드 요청/승인 | 새 코드 필요 시 관리자에게 요청 | P2 |

**과별 코드 카탈로그 구조:**
```
┌─ 내과 처방 카탈로그 ────────────────────────────────────┐
│                                                         │
│ 💊 약물 코드 (45개)                                      │
│ ├─ 순환기                                               │
│ │   ├─ 암로디핀 5mg/10mg (CCB)                          │
│ │   ├─ 로사르탄 50mg/100mg (ARB)                        │
│ │   └─ 아스피린 100mg (항혈소판)                         │
│ ├─ 내분비                                               │
│ │   ├─ 메트포민 500mg/1000mg                            │
│ │   └─ 글리메피리드 2mg/4mg                              │
│ ├─ 소화기                                               │
│ │   ├─ 란소프라졸 30mg (PPI)                             │
│ │   └─ 트리메부틴 100mg                                  │
│ └─ 공통                                                 │
│     ├─ 아세트아미노펜 500mg/650mg                        │
│     └─ 이부프로펜 200mg/400mg                            │
│                                                         │
│ 🧪 검사 코드 (30개)                                      │
│ ├─ 기본검사: CBC, 전해질, 간기능, 신기능                  │
│ ├─ 순환기: BNP, Troponin, CK-MB                        │
│ ├─ 내분비: HbA1c, 갑상선, 인슐린                         │
│ └─ 종양: CEA, AFP, CA19-9                               │
│                                                         │
│ 📷 영상 코드 (15개)                                      │
│ ├─ 기본: Chest X-ray, 복부 X-ray                        │
│ ├─ CT: 복부 CT, 흉부 CT                                 │
│ └─ 초음파: 복부 초음파, 심장 초음파                       │
│                                                         │
│ 📏 표준 처방 가이드                                       │
│ ├─ 암로디핀: 초회 5mg QD → 최대 10mg QD                  │
│ ├─ 메트포민: 초회 500mg BID → 최대 2000mg/day            │
│ └─ ...                                                   │
└─────────────────────────────────────────────────────────┘
```

### 2.4 처방 복사/반복 (Prescription Copy & Repeat)

이전 처방을 재사용하는 기능.

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| RC-01 | 이전 처방 복사 | 과거 진료의 처방을 현재 진료에 복사 | P0 |
| RC-02 | 반복 처방 | 만성질환 정기 처방 자동 생성 | P1 |
| RC-03 | 처방 수정 후 적용 | 복사된 처방 수정 후 일괄 적용 | P0 |
| RC-04 | 타 의사 처방 참조 | 다른 의사의 처방 이력 조회/복사 | P2 |

### 2.5 오더 우선순위 (Order Priority)

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| OP-01 | STAT 오더 | 긴급 오더 (즉시 처리) | P0 |
| OP-02 | Routine 오더 | 일반 오더 (순서대로) | P0 |
| OP-03 | PRN 오더 | 필요 시 오더 (간호사 판단) | P1 |
| OP-04 | Standing 오더 | 지속 오더 (기간 내 반복) | P2 |
| OP-05 | 우선순위 표시 | 오더 큐에서 STAT 강조 표시 | P0 |

---

## 3. 데이터 모델 변경

### 3.1 신규 모델

```prisma
// Pre-Order (사전 오더)
model PreOrder {
  id              String        @id @default(uuid()) @db.Uuid
  patientId       String        @map("patient_id") @db.Uuid
  doctorId        String        @map("doctor_id") @db.Uuid
  type            String        @db.VarChar(20)                // MEDICATION, LAB, IMAGING
  medicationCodeId String?      @map("medication_code_id") @db.Uuid
  procedureCodeId String?       @map("procedure_code_id") @db.Uuid
  dosage          String?       @db.VarChar(100)
  frequency       String?       @db.VarChar(100)
  duration        Int?
  quantity        Int?
  route           String?       @db.VarChar(50)
  priority        String        @default("ROUTINE") @db.VarChar(20) // STAT, ROUTINE, PRN
  instructions    String?       @db.Text
  reason          String?       @db.Text                       // 사전 오더 사유
  scheduledDate   DateTime?     @map("scheduled_date") @db.Date // 실행 예정일
  scheduledTime   String?       @map("scheduled_time") @db.VarChar(5) // "06:00"
  status          String        @default("PENDING") @db.VarChar(20)
  // PENDING, APPROVED, MODIFIED, CANCELLED, EXPIRED, EXECUTED
  approvedBy      String?       @map("approved_by") @db.Uuid
  approvedAt      DateTime?     @map("approved_at") @db.Timestamptz()
  encounterId     String?       @map("encounter_id") @db.Uuid  // 실행된 진료
  prescriptionId  String?       @map("prescription_id") @db.Uuid // 생성된 처방
  expiresAt       DateTime?     @map("expires_at") @db.Timestamptz()
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz()

  patient         Patient       @relation(fields: [patientId], references: [id])
  doctor          User          @relation("PreOrderDoctor", fields: [doctorId], references: [id])
  medicationCode  MedicationCode? @relation(fields: [medicationCodeId], references: [id])
  procedureCode   ProcedureCode? @relation(fields: [procedureCodeId], references: [id])

  @@index([patientId, status])
  @@index([doctorId, status])
  @@index([scheduledDate])
  @@map("pre_orders")
}

// 의료진 처방 코드 목록 (My Code List)
model DoctorCodeList {
  id              String   @id @default(uuid()) @db.Uuid
  doctorId        String   @map("doctor_id") @db.Uuid
  category        String   @db.VarChar(20)    // MEDICATION, LAB, IMAGING
  codeId          String   @map("code_id") @db.Uuid  // MedicationCode 또는 ProcedureCode ID
  codeType        String   @map("code_type") @db.VarChar(20) // MEDICATION_CODE, PROCEDURE_CODE
  displayName     String?  @map("display_name") @db.VarChar(200) // 의사 커스텀 이름
  defaultDosage   String?  @map("default_dosage") @db.VarChar(100)
  defaultFrequency String? @map("default_frequency") @db.VarChar(100)
  defaultDuration Int?     @map("default_duration")
  defaultRoute    String?  @map("default_route") @db.VarChar(50)
  sortOrder       Int      @default(0) @map("sort_order")
  useCount        Int      @default(0) @map("use_count")
  isPinned        Boolean  @default(false) @map("is_pinned")  // 즐겨찾기 고정
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  doctor          User     @relation("DoctorCodeLists", fields: [doctorId], references: [id])

  @@unique([doctorId, codeType, codeId])
  @@index([doctorId, category])
  @@map("doctor_code_lists")
}

// 진료과 코드 카탈로그
model DepartmentCodeCatalog {
  id              String   @id @default(uuid()) @db.Uuid
  departmentName  String   @map("department_name") @db.VarChar(100)
  subcategory     String?  @db.VarChar(100)  // "순환기", "내분비", "공통" 등
  codeId          String   @map("code_id") @db.Uuid
  codeType        String   @map("code_type") @db.VarChar(20) // MEDICATION_CODE, PROCEDURE_CODE
  defaultDosage   String?  @map("default_dosage") @db.VarChar(100)
  defaultFrequency String? @map("default_frequency") @db.VarChar(100)
  defaultDuration Int?     @map("default_duration")
  defaultRoute    String?  @map("default_route") @db.VarChar(50)
  maxDosage       String?  @map("max_dosage") @db.VarChar(100)   // 권장 최대 용량
  guideNote       String?  @map("guide_note") @db.Text           // 처방 가이드 메모
  sortOrder       Int      @default(0) @map("sort_order")
  isActive        Boolean  @default(true) @map("is_active")
  createdBy       String   @map("created_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([departmentName, codeType, codeId])
  @@index([departmentName, subcategory])
  @@map("department_code_catalogs")
}
```

### 3.2 기존 모델 변경

```prisma
// Order — 우선순위 추가
model Order {
  // ... 기존 필드 유지 ...
  priority    String   @default("ROUTINE") @db.VarChar(20)  // STAT, ROUTINE, PRN, STANDING
  preOrderId  String?  @map("pre_order_id") @db.Uuid        // Pre-Order 연결
}

// Prescription — 우선순위 + 출처 추가
model Prescription {
  // ... 기존 필드 유지 ...
  priority    String   @default("ROUTINE") @db.VarChar(20)
  source      String?  @db.VarChar(30)  // MANUAL, PRE_ORDER, CP, COPY, FAVORITE
}
```

---

## 4. API 설계

### 4.1 Pre-Order API

```
POST   /api/v1/pre-orders                     사전 오더 생성
GET    /api/v1/pre-orders                     목록 조회 (?patientId, ?doctorId, ?status)
GET    /api/v1/pre-orders/:id                 상세 조회
PATCH  /api/v1/pre-orders/:id/approve         승인 (→ Prescription 생성)
PATCH  /api/v1/pre-orders/:id/modify          수정 후 승인
PATCH  /api/v1/pre-orders/:id/cancel          취소
GET    /api/v1/pre-orders/patient/:patientId  환자별 미결 Pre-Order
GET    /api/v1/pre-orders/pending             내 미결 Pre-Order 목록
```

### 4.2 의료진 처방 코드 API

```
GET    /api/v1/my-codes                       내 코드 목록 (?category)
POST   /api/v1/my-codes                       코드 추가
PATCH  /api/v1/my-codes/:id                   코드 수정 (기본값, 순서, 고정)
DELETE /api/v1/my-codes/:id                   코드 제거
POST   /api/v1/my-codes/:id/use               사용 횟수 증가
GET    /api/v1/my-codes/stats                  내 처방 통계 (Top 20)
POST   /api/v1/my-codes/import                다른 의사/과 코드 가져오기
```

### 4.3 진료과 코드 카탈로그 API

```
GET    /api/v1/dept-catalog                   과별 카탈로그 (?department, ?subcategory, ?codeType)
POST   /api/v1/dept-catalog                   코드 추가 (과장/관리자)
PATCH  /api/v1/dept-catalog/:id               수정
DELETE /api/v1/dept-catalog/:id               제거
GET    /api/v1/dept-catalog/guide/:codeId     코드별 처방 가이드
POST   /api/v1/dept-catalog/bulk              일괄 등록
GET    /api/v1/dept-catalog/stats             과별 사용 통계
```

### 4.4 처방 복사 API

```
POST   /api/v1/encounters/:encounterId/prescriptions/copy
       Body: { sourceEncounterId: string, prescriptionIds?: string[] }
       → 이전 진료의 처방을 현재 진료에 복사
```

### 4.5 기존 API 수정

```
POST   /api/v1/encounters/:encounterId/prescriptions
       Body 추가필드: { priority?: "STAT"|"ROUTINE"|"PRN", source?: string }

PATCH  /api/v1/orders/:id/status
       STAT 오더는 큐 최상단 배치

GET    /api/v1/orders/queue/:department
       → priority 기준 정렬 (STAT → ROUTINE → PRN)
```

---

## 5. UI 설계

### 5.1 처방 입력 패널 개선

```
┌─ 처방 입력 ──────────────────────────────────────────────┐
│                                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │약속CP│ │내 목록│ │이전Rx│ │Pre-  │ │검색  │          │
│  │      │ │      │ │복사  │ │Order │ │      │          │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘          │
│                                                          │
│  ┌─ 탭 ────────────────────────────────────────────────┐ │
│  │ 💊 약 처방  │  🧪 검사  │  📷 영상  │  ⏳ Pre-Order │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ 코드 검색 ─────────────────────────────────────────┐ │
│  │ 🔍 [검색어...]                                       │ │
│  │ ┌─────────────────────────────────────────────────┐ │ │
│  │ │ ⭐ 아모레틴 500mg (내 목록)         [+추가]     │ │ │
│  │ │ 📋 아세트아미노펜 650mg (과 카탈로그) [+추가]    │ │ │
│  │ │    아모레틴 250mg (전체)             [+추가]     │ │ │
│  │ └─────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ 약 상세 입력 ──────────────────────────────────────┐ │
│  │ 용량: [500mg]  경로: [경구▼]  빈도: [1일3회]       │ │
│  │ 기간: [5일]    수량: [15]    우선순위: [Routine▼]   │ │
│  │                               [STAT] [PRN]          │ │
│  │                                     [+ 처방 추가]   │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ 처방 목록 (3건) ───────────────────────────────────┐ │
│  │ 🔴 STAT 💊 아세트아미노펜 500mg PO 1일3회 5일  [✕] │ │
│  │ ⚪ 🧪 CBC, 전해질, 간기능 검사               [✕]   │ │
│  │ ⚪ 📷 Chest X-ray PA                         [✕]   │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ⚠️ Pre-Order 알림: 이 환자에 미결 사전오더 2건 있음     │
│     [Pre-Order 확인하기]                                 │
└──────────────────────────────────────────────────────────┘
```

### 5.2 내 처방 목록 관리 페이지

```
┌─ 내 처방 관리 (/settings/my-codes) ────────────────────────┐
│                                                             │
│  ┌────────┬────────┬────────┐                              │
│  │ 💊 약물 │ 🧪 검사 │ 📷 영상 │                              │
│  └────────┴────────┴────────┘                              │
│                                                             │
│  🔍 [코드 검색하여 추가...]                                  │
│                                                             │
│  ┌─ 내 약물 목록 (12개) ───────────────────────────────────┐│
│  │ ☰ ⭐ 아모레틴 500mg                                     ││
│  │     기본: 경구 1일3회 5일 | 사용 247회                   ││
│  │     [기본값 수정] [제거]                                  ││
│  │ ─────────────────────────────────────────────────────── ││
│  │ ☰    메트포민 500mg                                      ││
│  │     기본: 경구 1일2회 90일 | 사용 156회                  ││
│  │     [기본값 수정] [제거]                                  ││
│  └──────────────────────────────────────────────────────────┘│
│                                                             │
│  📊 처방 통계                                                │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ 최다 처방 약물 Top 5:                                    ││
│  │ 1. 아모레틴 500mg — 247회                                ││
│  │ 2. 아세트아미노펜 650mg — 189회                           ││
│  │ ...                                                      ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 5.3 진료과 코드 관리 페이지

```
┌─ 과별 처방 카탈로그 (/admin/dept-catalog) ─────────────────┐
│                                                             │
│  진료과: [내과▼]   하위분류: [전체▼]                        │
│                                                             │
│  ┌────────┬────────┬────────┐                              │
│  │ 💊 약물 │ 🧪 검사 │ 📷 영상 │                              │
│  └────────┴────────┴────────┘                              │
│                                                             │
│  [+ 코드 추가]  [일괄 등록]  [사용 통계]                    │
│                                                             │
│  ┌─ 순환기 ────────────────────────────────────────────────┐│
│  │ 암로디핀 5mg/10mg (CCB)                                 ││
│  │   가이드: 초회 5mg QD → 반응 불충분 시 10mg QD          ││
│  │   최대: 10mg/day | 주의: 간부전 시 감량                  ││
│  │ ─────────────────────────────────────────────────────── ││
│  │ 로사르탄 50mg/100mg (ARB)                               ││
│  │   가이드: 초회 50mg QD → 최대 100mg QD                  ││
│  └──────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─ 내분비 ────────────────────────────────────────────────┐│
│  │ 메트포민 500mg/1000mg                                    ││
│  │   가이드: 초회 500mg BID (식후) → 최대 2000mg/day       ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 코드 검색 우선순위

처방 입력 시 코드 검색 결과의 표시 순서:

```
1순위: ⭐ 내 목록 (DoctorCodeList, isPinned=true)
2순위: 📋 과 카탈로그 (DepartmentCodeCatalog, 해당 과)
3순위: 🕐 최근 처방 (최근 30일 내 내가 처방한 코드)
4순위: 🔍 전체 코드 (MedicationCode/ProcedureCode 전체)

표시 형식:
┌─────────────────────────────────────────────────────────┐
│ ⭐ 아모레틴 500mg [A01234]  — 내 목록                    │
│    기본: 경구 1일3회 5일                                  │
│ ─────────────────────────────────────────────────────── │
│ 📋 아모레틴 250mg [A01233]  — 내과 카탈로그               │
│    가이드: 소아용 경구 1일2회                              │
│ ─────────────────────────────────────────────────────── │
│    아모레틴 125mg/5ml 시럽 [A01232]                      │
└─────────────────────────────────────────────────────────┘
```

---

## 7. 구현 우선순위 (Phase)

### Phase 1: 핵심 기능 (P0)

```
1. Pre-Order 모델 + CRUD API
2. Pre-Order 승인 → 처방 자동 생성 연동
3. 처방/오더에 priority 필드 추가
4. 오더 큐 priority 정렬 (STAT 우선)
5. DoctorCodeList 모델 + CRUD API
6. 처방 검색 시 내 코드 우선 표시
7. 처방 복사 API
8. UI: 처방 패널에 Pre-Order 탭 + 우선순위 선택 + 이전 처방 복사
```

### Phase 2: 관리 기능 (P1)

```
1. DepartmentCodeCatalog 모델 + CRUD API
2. 과별 코드 관리 페이지 (/admin/dept-catalog)
3. 내 처방 목록 관리 페이지 (/settings/my-codes)
4. 처방 통계 API (의사별, 과별 Top 20)
5. 코드 검색 자동완성 (내 빈용 코드 우선)
6. Pre-Order 진료 시 알림 배너
7. 표준 처방 가이드 (과 카탈로그에 guideNote)
```

### Phase 3: 고도화 (P2)

```
1. Pre-Order 예약 실행 (scheduledDate + cron)
2. PRN/Standing 오더
3. 코드 요청/승인 워크플로우
4. 처방 자동완성 AI 추천
5. 반복 처방 (만성질환 정기 처방)
6. 타 의사/과 처방 세트 가져오기
```

---

## 8. 기존 시스템 연동

| 기존 기능 | 연동 방식 |
|-----------|-----------|
| Prescription 생성 | `source` 필드로 출처 구분 (MANUAL/PRE_ORDER/CP/COPY/FAVORITE) |
| Order 자동생성 | `priority` 필드 전파 (Prescription → Order) |
| OrderSet (CP) | 기존 유지, 카탈로그와 병행 사용 |
| FavoriteOrder | 기존 유지, DoctorCodeList와 보완 관계 |
| DUR 체크 | Pre-Order 승인 시에도 DUR 실행 |
| 수술 모듈 | 수술 전 Pre-Order 자동 생성 연동 |
| 입원 모듈 | 입원 시 Standing Order 지원 |
| 대기열 | STAT 오더 시 큐 최상단 표시 |

---

## 9. 참고: 현재 처방 흐름 vs 개선 후

```
[현재]
진료 시작 → SOAP 작성 → 코드 검색 → 처방 입력 → DUR → Order 생성 → 서명

[개선 후]
                  ┌─ Pre-Order 확인 (미결 건 알림)
                  │
진료 시작 → SOAP → ├─ 이전 처방 복사 (1클릭)
                  │
                  ├─ 내 목록에서 선택 (기본값 자동 적용)
                  │
                  ├─ 과 카탈로그에서 선택 (가이드 표시)
                  │
                  ├─ CP(약속처방) 적용 (일괄 추가)
                  │
                  └─ 코드 검색 → 처방 입력

→ 우선순위(STAT/Routine) 설정
→ DUR 체크 (Pre-Order 포함)
→ Order 생성 (STAT 우선)
→ 서명
```
