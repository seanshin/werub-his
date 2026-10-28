# 자재/재고 관리 ERP 확장 기획서

> 작성일: 2026-05-08
> 대상: 병원 자재관리팀, 구매팀, 각 부서 물자담당자

---

## 1. 현황 분석

### 1-1. 현재 시스템

| 항목 | 현재 | 한계 |
|------|------|------|
| 품목 관리 | 코드/품명/분류/단위/현재고/안전재고 (18종) | 보관장소, LOT, 유효기간, 바코드 없음 |
| 거래처 | supplierName 1개 필드 | 거래처 마스터 없음, 복수 거래처 불가 |
| 입출고 | 단순 IN/OUT/ADJUST/RETURN 4종 | 입고 단가, LOT, 유효기간, 발주번호 연결 없음 |
| 보관장소 | 없음 | 창고/위치 관리 불가 |
| 발주/구매 | 없음 | 발주서 생성, 승인, 입고 확인 불가 |
| 불출 | 없음 | 부서별 청구/불출 워크플로우 없음 |
| 실사/조정 | ADJUST만 | 정기 실사, 차이 분석 불가 |
| 리포트 | 없음 | 월별 소모량, ABC 분석, 회전율 없음 |

### 1-2. 목표

**병원 ERP 수준의 자재관리**: 발주 → 입고(검수) → 보관 → 불출(청구) → 사용 → 실사 전체 라이프사이클을 관리하며, 부서별/창고별/LOT별 추적이 가능한 시스템

---

## 2. 데이터 모델 설계

### 2-1. 기존 모델 확장 — InventoryItem

```
InventoryItem (기존 + 확장)
├── 기본 정보 (기존)
│   code, name, category, unit, currentStock, safetyStock, unitPrice, isActive
│
├── + 상세 정보 (신규)
│   specification    VARCHAR(500)  // 규격 (3mL, 4x4인치, M사이즈)
│   barcode          VARCHAR(100)  // 바코드 (GS1-128, UDI)
│   manufacturer     VARCHAR(200)  // 제조사
│   countryOfOrigin  VARCHAR(50)   // 원산지
│   storageCondition VARCHAR(100)  // 보관조건 (실온, 냉장2~8℃, 냉동-20℃)
│   maxStock         INT           // 최대재고 (과잉 방지)
│   reorderPoint     INT           // 발주점 (=safetyStock 대체 가능)
│   reorderQty       INT           // 발주 단위 수량
│   leadTimeDays     INT           // 납품 리드타임 (일)
│   lastPurchaseDate DATE          // 최근 구매일
│   lastPurchasePrice INT          // 최근 구매 단가
│
├── + 보관장소 연결
│   defaultStorageId UUID → InventoryStorage
│
└── + 거래처 연결 (N:M)
    InventoryItemSupplier (품목-거래처 매핑)
```

### 2-2. 신규 모델

#### (1) InventoryStorage — 보관장소

```
InventoryStorage
├── id            UUID PK
├── code          VARCHAR(30) UNIQUE   // "WH-01", "PH-COLD", "ER-SHELF"
├── name          VARCHAR(200)         // "중앙창고 1", "약국 냉장고", "응급실 선반"
├── type          VARCHAR(50)          // WAREHOUSE, PHARMACY, WARD, DEPARTMENT, COLD_STORAGE
├── location      VARCHAR(200)         // "지하 1층 A구역"
├── parentId      UUID? (self-ref)     // 상위 보관장소 (계층 구조)
├── temperature   VARCHAR(50)          // "실온", "2~8℃", "-20℃"
├── capacity      INT?                 // 최대 보관 수량/단위
├── isActive      BOOL
├── managerId     VARCHAR(200)         // 담당자
└── notes         TEXT
```

#### (2) InventorySupplier — 거래처 마스터

```
InventorySupplier
├── id              UUID PK
├── code            VARCHAR(30) UNIQUE   // "SUP-001"
├── name            VARCHAR(200)         // "한국메디칼(주)"
├── businessNumber  VARCHAR(20)          // 사업자번호
├── representative  VARCHAR(100)         // 대표자
├── contactName     VARCHAR(100)         // 담당자
├── contactPhone    VARCHAR(50)          // 전화번호
├── contactEmail    VARCHAR(255)         // 이메일
├── address         TEXT                 // 주소
├── bankAccount     VARCHAR(200)         // 계좌번호
├── paymentTerms    VARCHAR(100)         // 결제조건 (월말, 30일, 60일)
├── contractExpiry  DATE?                // 계약 만료일
├── rating          VARCHAR(20)          // A, B, C 등급
├── isActive        BOOL
├── notes           TEXT
└── items           InventoryItemSupplier[]
```

#### (3) InventoryItemSupplier — 품목-거래처 매핑

```
InventoryItemSupplier
├── id            UUID PK
├── itemId        UUID → InventoryItem
├── supplierId    UUID → InventorySupplier
├── supplierItemCode VARCHAR(100)   // 거래처 자체 품목코드
├── unitPrice     INT               // 납품 단가
├── leadTimeDays  INT?              // 납품 리드타임
├── isPrimary     BOOL              // 주 거래처 여부
├── minOrderQty   INT?              // 최소 발주 수량
└── notes         TEXT
```

#### (4) InventoryLot — LOT/유효기간 관리

```
InventoryLot
├── id            UUID PK
├── itemId        UUID → InventoryItem
├── lotNumber     VARCHAR(100)       // LOT 번호
├── batchNumber   VARCHAR(100)?      // 배치 번호
├── expiryDate    DATE?              // 유효기간
├── manufactureDate DATE?            // 제조일
├── quantity      INT                // 현재 수량
├── storageId     UUID → InventoryStorage  // 보관 위치
├── purchaseOrderId UUID?            // 입고 발주번호
├── unitCost      INT?               // 입고 단가
├── status        VARCHAR(30)        // ACTIVE, EXPIRED, CONSUMED, RECALLED
├── createdAt     TIMESTAMP
└── updatedAt     TIMESTAMP
```

#### (5) PurchaseOrder — 발주서

```
PurchaseOrder
├── id            UUID PK
├── orderNumber   VARCHAR(30) UNIQUE  // "PO-20260508-001"
├── supplierId    UUID → InventorySupplier
├── status        VARCHAR(30)          // DRAFT, SUBMITTED, APPROVED, ORDERED, PARTIAL_RECEIVED, RECEIVED, CANCELLED
├── orderDate     DATE
├── expectedDate  DATE?                // 예상 납품일
├── receivedDate  DATE?                // 실제 입고일
├── totalAmount   INT                  // 총 금액
├── approvedBy    UUID?                // 승인자
├── approvedAt    TIMESTAMP?
├── notes         TEXT
├── createdBy     UUID
├── createdAt     TIMESTAMP
├── updatedAt     TIMESTAMP
└── items         PurchaseOrderItem[]
```

#### (6) PurchaseOrderItem — 발주 품목

```
PurchaseOrderItem
├── id            UUID PK
├── purchaseOrderId UUID → PurchaseOrder
├── itemId        UUID → InventoryItem
├── orderedQty    INT               // 발주 수량
├── receivedQty   INT DEFAULT 0     // 입고 수량
├── unitPrice     INT               // 발주 단가
├── amount        INT               // 소계 (수량 × 단가)
├── lotNumber     VARCHAR(100)?     // 입고 LOT
├── expiryDate    DATE?             // 유효기간
└── notes         TEXT
```

#### (7) InventoryRequest — 부서 청구/불출

```
InventoryRequest
├── id            UUID PK
├── requestNumber VARCHAR(30) UNIQUE  // "REQ-20260508-001"
├── requestType   VARCHAR(30)         // DEPARTMENT_REQUEST, EMERGENCY, RETURN
├── department    VARCHAR(100)        // 청구 부서 "내과병동", "수술실"
├── status        VARCHAR(30)         // REQUESTED, APPROVED, ISSUED, REJECTED, CANCELLED
├── requestedBy   UUID                // 청구자
├── requestedAt   TIMESTAMP
├── approvedBy    UUID?               // 승인자
├── approvedAt    TIMESTAMP?
├── issuedBy      UUID?               // 불출 담당자
├── issuedAt      TIMESTAMP?
├── notes         TEXT
├── createdAt     TIMESTAMP
└── items         InventoryRequestItem[]
```

#### (8) InventoryRequestItem — 청구 품목

```
InventoryRequestItem
├── id            UUID PK
├── requestId     UUID → InventoryRequest
├── itemId        UUID → InventoryItem
├── requestedQty  INT              // 청구 수량
├── approvedQty   INT?             // 승인 수량
├── issuedQty     INT DEFAULT 0    // 불출 수량
├── lotId         UUID?            // 불출 LOT (FEFO 자동 선택)
└── notes         TEXT
```

#### (9) InventoryCount — 정기 실사

```
InventoryCount
├── id            UUID PK
├── countNumber   VARCHAR(30) UNIQUE  // "CNT-20260508-001"
├── countDate     DATE
├── storageId     UUID? → InventoryStorage  // 창고별 실사
├── status        VARCHAR(30)         // PLANNED, IN_PROGRESS, COMPLETED, APPROVED
├── performedBy   UUID
├── approvedBy    UUID?
├── notes         TEXT
├── createdAt     TIMESTAMP
└── items         InventoryCountItem[]
```

#### (10) InventoryCountItem — 실사 품목

```
InventoryCountItem
├── id            UUID PK
├── countId       UUID → InventoryCount
├── itemId        UUID → InventoryItem
├── systemQty     INT              // 시스템 재고
├── actualQty     INT              // 실제 재고
├── difference    INT              // 차이 (actual - system)
├── reason        TEXT?            // 차이 사유
└── adjusted      BOOL DEFAULT false  // 조정 완료 여부
```

---

## 3. 기존 InventoryTransaction 확장

```
InventoryTransaction (기존 + 확장)
├── 기존: id, itemId, type, quantity, reason, performedBy, createdAt
│
├── + 신규 필드
│   lotId            UUID? → InventoryLot     // LOT 연결
│   storageId        UUID? → InventoryStorage // 보관장소
│   fromStorageId    UUID?                    // 이동 출발 (창고 간 이동)
│   toStorageId      UUID?                    // 이동 도착
│   purchaseOrderId  UUID?                    // 발주 연결
│   requestId        UUID?                    // 청구 연결
│   unitCost         INT?                     // 단가
│   totalCost        INT?                     // 총액
│   referenceNumber  VARCHAR(100)?            // 참조번호
│
├── + type 확장
│   기존: IN, OUT, ADJUST, RETURN
│   추가: TRANSFER (이동), ISSUE (불출), RECEIVE (입고검수),
│         DISPOSAL (폐기), EXPIRED (유효기간만료), COUNT_ADJUST (실사조정)
```

---

## 4. 화면 설계

### 4-1. 탭 구조 (6탭 → 10탭)

```
자재/재고 관리
├── 품목 관리        기존 확장 (규격/바코드/보관조건/발주점 추가)
├── 입출고 현황      기존 확장 (LOT/보관장소/발주번호 표시)
├── 보관장소         신규 (창고/선반 CRUD, 계층 트리뷰)
├── 거래처 관리      신규 (거래처 CRUD, 품목별 거래처 매핑)
├── 발주 관리        신규 (발주서 작성 → 승인 → 입고 워크플로우)
├── 입고 검수        신규 (발주 기반 입고, LOT/유효기간 입력)
├── 부서 불출        신규 (청구 → 승인 → 불출 워크플로우)
├── LOT/유효기간     신규 (LOT별 재고, 만료 임박 경고)
├── 실사 관리        신규 (정기 실사 계획 → 실사 → 차이 조정)
└── 리포트          신규 (월별 소모량, ABC 분석, 회전율)
```

### 4-2. 품목 관리 (확장)

```
┌──────────────────────────────────────────────────────────────────┐
│ 자재/재고 관리                                    [+ 품목 등록]  │
├──────────────────────────────────────────────────────────────────┤
│ 품목관리 | 입출고 | 보관장소 | 거래처 | 발주 | 입고 | 불출 | LOT | 실사 | 리포트│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 상태 카드:  전체 18  │  정상 15  │  부족 2  │  과잉 1            │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐  │
│ │코드     │품명            │규격      │분류    │보관장소│현재고│안전│상태│ │
│ │INV-001  │일회용주사기 3mL│3mL      │소모품  │중앙창고│5000 │500 │정상│ │
│ │INV-007  │IV수액세트(성인)│성인용    │소모품  │약국   │800  │100 │정상│ │
│ │INV-018  │혈액채취바늘    │진공채혈  │검사소모│검사실 │3000 │300 │정상│ │
│ └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ [클릭 시 상세: 규격/바코드/제조사/보관조건/거래처/LOT/입출고이력]  │
└──────────────────────────────────────────────────────────────────┘
```

### 4-3. 보관장소

```
┌─────────────────────────────────────┐  ┌──────────────────────────┐
│ 보관장소 트리                        │  │ 보관장소 상세              │
│                                     │  │                          │
│ ▼ 중앙창고 (WH-01)                  │  │ 중앙창고 1 (WH-01)       │
│   ├── A구역 (WH-01-A)              │  │ 위치: 지하 1층            │
│   ├── B구역 (WH-01-B)              │  │ 온도: 실온                │
│   └── 냉장고 (WH-01-C)              │  │ 담당: 김자재              │
│ ▼ 약국 (PH-01)                      │  │ 보관 품목: 235종          │
│   ├── 일반 선반                      │  │                          │
│   └── 냉장 보관 (2~8℃)              │  │ [보관 품목 목록]          │
│ ▼ 수술실 (OR-01)                    │  │ INV-015 봉합사 200개     │
│ ▼ 응급실 (ER-01)                    │  │ INV-014 수술가운 300벌   │
│ ▼ 내과병동 (WARD-INT)               │  │ ...                      │
│ ▼ 외과병동 (WARD-SURG)              │  │                          │
└─────────────────────────────────────┘  └──────────────────────────┘
```

### 4-4. 발주 관리 워크플로우

```
[작성(DRAFT)] → [제출(SUBMITTED)] → [승인(APPROVED)] → [발주(ORDERED)]
                                                          │
                                              [부분입고(PARTIAL)] → [입고완료(RECEIVED)]

┌──────────────────────────────────────────────────────────────────┐
│ 발주서 작성                                                       │
│                                                                  │
│ 발주번호: PO-20260508-001 (자동)                                  │
│ 거래처: [한국메디칼(주) ▼]                                        │
│ 예상 납품일: [2026-05-15]                                        │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐    │
│ │ 품목        │ 규격    │ 현재고 │ 발주수량 │ 단가   │ 소계     │    │
│ │ 주사기 3mL  │ 3mL    │ 5000  │ 10000   │ 120원  │ 1,200,000│    │
│ │ 니트릴글러브 │ M(100매)│ 200   │ 100     │ 8,500  │ 850,000  │    │
│ │ [+ 품목 추가]                                               │    │
│ └───────────────────────────────────────────────────────────┘    │
│                                         합계: 2,050,000원        │
│                                                                  │
│ [임시저장]  [결재 요청]                                           │
└──────────────────────────────────────────────────────────────────┘
```

### 4-5. 입고 검수

```
┌──────────────────────────────────────────────────────────────────┐
│ 입고 검수 — PO-20260508-001 (한국메디칼)                          │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐    │
│ │ 품목        │발주수량│입고수량│LOT번호    │유효기간  │보관장소│ │
│ │ 주사기 3mL  │ 10000 │[10000]│[LOT-A001] │[2028-05]│[중앙  ]│ │
│ │ 니트릴글러브 │ 100   │[ 100 ]│[LOT-B002] │[2027-12]│[중앙  ]│ │
│ └───────────────────────────────────────────────────────────┘    │
│                                                                  │
│ 검수 결과: [○ 합격  ○ 부분합격  ○ 불합격]                         │
│ 비고: [_________________]                                        │
│                                                                  │
│ [입고 확정]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

### 4-6. 부서 청구/불출

```
접수 워크플로우:
[부서 청구(REQUESTED)] → [자재팀 승인(APPROVED)] → [불출(ISSUED)]

┌──────────────────────────────────────────────────────────────────┐
│ 물품 청구서                                                       │
│                                                                  │
│ 청구 부서: [내과병동 ▼]   청구자: 조간호 (자동)                   │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐    │
│ │ 품목          │ 현재고 │ 청구수량 │ 비고                     │    │
│ │ 주사기 5mL    │ 3000  │ [100]   │ [일주일분 보충]           │    │
│ │ 니트릴글러브M  │ 200   │ [10]    │ [박스(100매)]            │    │
│ │ [+ 품목 추가]                                               │    │
│ └───────────────────────────────────────────────────────────┘    │
│                                                                  │
│ [청구 제출]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

### 4-7. LOT/유효기간 관리

```
┌──────────────────────────────────────────────────────────────────┐
│ LOT/유효기간 현황                           [만료 임박만 표시 ✓]  │
│                                                                  │
│ 경고: 7일 내 만료 3건  │  30일 내 만료 8건  │  만료됨 1건         │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐    │
│ │ 품목       │LOT번호  │수량│보관장소│유효기간 │남은일│상태    │    │
│ │ KF94마스크 │LOT-2024 │500│중앙   │2026-05-15│ 7일 │임박 ⚠ │    │
│ │ 주사기3mL  │LOT-C003 │2000│약국  │2028-03-01│638일│정상    │    │
│ │ 멸균거즈   │LOT-D001 │300│수술실 │2026-04-01│만료 │만료 🔴│    │
│ └───────────────────────────────────────────────────────────┘    │
│                                                                  │
│ FEFO 원칙: 유효기간 짧은 것부터 자동 불출                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4-8. 정기 실사

```
워크플로우:
[실사 계획(PLANNED)] → [실사 진행(IN_PROGRESS)] → [완료(COMPLETED)] → [승인/조정(APPROVED)]

┌──────────────────────────────────────────────────────────────────┐
│ 실사: CNT-20260508-001 (중앙창고 정기실사)                         │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐    │
│ │ 품목         │시스템재고│실제재고│차이│사유              │조정   │    │
│ │ 주사기 3mL   │ 5000   │[4980] │-20│[파손 폐기]       │[✓]   │    │
│ │ 니트릴글러브M │ 200    │[200]  │ 0 │                  │      │    │
│ │ KF94 마스크  │ 10000  │[9950] │-50│[사용 미기록]      │[✓]   │    │
│ └───────────────────────────────────────────────────────────┘    │
│                                                                  │
│ 차이 합계: -70 (3개 품목)                                         │
│                                                                  │
│ [실사 완료]  [조정 반영]                                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4-9. 리포트

| 리포트 | 내용 |
|--------|------|
| **월별 소모량** | 품목별 월간 사용량 트렌드 차트 |
| **ABC 분석** | 금액 기준 A(상위 70%), B(70~90%), C(하위 10%) 분류 |
| **재고 회전율** | 품목별 연간 회전율 = 연간 사용량 / 평균 재고 |
| **거래처별 구매 실적** | 거래처별 발주 금액, 납기 준수율, 불량률 |
| **유효기간 분석** | 만료 예정, 만료 폐기 금액, 손실률 |
| **부서별 사용 현황** | 부서별 청구/불출 금액 및 품목 통계 |

---

## 5. API 엔드포인트 설계

### 5-1. 보관장소 (6개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/storages` | 보관장소 목록 (트리 구조) |
| POST | `/api/v1/inventory/storages` | 보관장소 등록 |
| PUT | `/api/v1/inventory/storages/:id` | 보관장소 수정 |
| DELETE | `/api/v1/inventory/storages/:id` | 보관장소 삭제 |
| GET | `/api/v1/inventory/storages/:id/items` | 보관장소별 품목 |
| POST | `/api/v1/inventory/storages/:id/transfer` | 창고 간 이동 |

### 5-2. 거래처 (5개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/suppliers` | 거래처 목록 |
| POST | `/api/v1/inventory/suppliers` | 거래처 등록 |
| GET | `/api/v1/inventory/suppliers/:id` | 거래처 상세 (품목 매핑 포함) |
| PUT | `/api/v1/inventory/suppliers/:id` | 거래처 수정 |
| POST | `/api/v1/inventory/suppliers/:id/items` | 품목-거래처 매핑 추가 |

### 5-3. 발주 (7개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/purchase-orders` | 발주 목록 |
| POST | `/api/v1/inventory/purchase-orders` | 발주서 작성 |
| GET | `/api/v1/inventory/purchase-orders/:id` | 발주 상세 |
| PATCH | `/api/v1/inventory/purchase-orders/:id/status` | 상태 변경 (제출/승인/발주) |
| POST | `/api/v1/inventory/purchase-orders/:id/receive` | 입고 처리 (LOT/유효기간) |
| GET | `/api/v1/inventory/purchase-orders/auto-suggest` | 자동 발주 제안 (발주점 이하) |
| DELETE | `/api/v1/inventory/purchase-orders/:id` | 발주 취소 |

### 5-4. 부서 청구/불출 (5개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/requests` | 청구 목록 |
| POST | `/api/v1/inventory/requests` | 청구서 작성 |
| GET | `/api/v1/inventory/requests/:id` | 청구 상세 |
| PATCH | `/api/v1/inventory/requests/:id/approve` | 승인 |
| PATCH | `/api/v1/inventory/requests/:id/issue` | 불출 처리 (FEFO 자동) |

### 5-5. LOT 관리 (4개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/lots` | LOT 목록 (만료 임박 필터) |
| GET | `/api/v1/inventory/lots/:itemId` | 품목별 LOT 현황 |
| PATCH | `/api/v1/inventory/lots/:id` | LOT 상태 변경 (폐기 등) |
| GET | `/api/v1/inventory/lots/expiring` | 만료 임박 경고 |

### 5-6. 실사 (5개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/counts` | 실사 목록 |
| POST | `/api/v1/inventory/counts` | 실사 계획 생성 |
| GET | `/api/v1/inventory/counts/:id` | 실사 상세 (품목별 차이) |
| PATCH | `/api/v1/inventory/counts/:id` | 실사 입력 (실제 수량) |
| POST | `/api/v1/inventory/counts/:id/approve` | 실사 승인 + 재고 조정 |

### 5-7. 리포트 (5개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/inventory/reports/consumption` | 월별 소모량 |
| GET | `/api/v1/inventory/reports/abc-analysis` | ABC 분석 |
| GET | `/api/v1/inventory/reports/turnover` | 재고 회전율 |
| GET | `/api/v1/inventory/reports/supplier-performance` | 거래처 실적 |
| GET | `/api/v1/inventory/reports/department-usage` | 부서별 사용 |

---

## 6. 구현 우선순위

### Phase 1 — 기본 확장 (기존 개선)

1. InventoryItem 필드 확장 (규격/바코드/보관조건/제조사)
2. 품목 CRUD 완성 (수정/삭제)
3. 보관장소 CRUD
4. 거래처 마스터 CRUD
5. 프론트엔드 탭 구조 전환

### Phase 2 — 입출고 고도화

6. LOT/유효기간 모델 + 관리 화면
7. InventoryTransaction 확장 (LOT/보관장소/단가)
8. 입고 검수 화면 (LOT/유효기간 입력)
9. 만료 임박 경고 + FEFO 불출

### Phase 3 — 발주/불출 워크플로우

10. 발주서 CRUD + 상태 관리
11. 자동 발주 제안 (발주점 기반)
12. 부서 청구/불출 워크플로우
13. Clinic(WeRU.B) 전자결재 연동 (발주 승인)

### Phase 4 — 실사/리포트

14. 정기 실사 계획/실행/조정
15. 리포트 6종 (소모량/ABC/회전율/거래처/유효기간/부서)

---

## 7. 추정 규모

| 항목 | 수치 |
|------|:----:|
| 신규 Prisma 모델 | 10개 |
| 신규 API 엔드포인트 | 37개 |
| 신규 프론트엔드 탭 | 10개 |
| 기존 모델 확장 | 2개 (InventoryItem, InventoryTransaction) |

---

## 8. 기술 고려사항

| 항목 | 설계 |
|------|------|
| **FEFO 불출** | LOT 테이블에서 `expiryDate ASC, quantity > 0` 순으로 자동 차감 |
| **바코드** | GS1-128 포맷, 향후 바코드 스캐너 연동 (USB HID) |
| **동시성** | 입출고 시 Prisma `$transaction` 사용하여 재고 정합성 보장 |
| **이력 추적** | 모든 재고 변동은 InventoryTransaction으로 기록 (감사 추적) |
| **권한** | 발주: ADMIN만, 불출: ADMIN+NURSE, 청구: 전 역할 |
| **알림** | 안전재고 미달, 유효기간 30일 이내 → 대시보드 경고 + Clinic 알림 |

---

> **자재/재고 관리 ERP 확장** — 발주 → 입고(검수/LOT) → 보관(장소/온도) → 불출(부서청구/FEFO) → 실사 → 리포트
>
> 10 신규 모델 · 37 API · 10 프론트엔드 탭 · 4 Phase 구현
