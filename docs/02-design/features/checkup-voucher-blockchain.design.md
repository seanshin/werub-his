# 건강검진권(블록체인) 발행·유통·재판매 설계서

> **Feature**: checkup-voucher-blockchain
> **Version**: 1.1 (design-validator 검토 반영 — §14 상세 보완이 충돌 시 우선)
> **Date**: 2026-06-17
> **Status**: Design (검토 점수 62→보완)
> **기획**: [checkup-voucher-blockchain.plan.md](../../01-plan/features/checkup-voucher-blockchain.plan.md)
> **결정 반영**: 검진권 2형태 · 선결제 매입 · 해외 딜러 비율 수수료 · 별도 딜러 포털

---

## 0. 설계 핵심 2축 (사용자 요구)

1. **중요 설정 관리 레이어** — 유효기간·수수료율 상한·환불 정책·앵커링·시리얼 규칙·국적/프로그램 허용 등 운영 핵심값을 **관리자 화면에서 조정**. 단, **법정 하한/상한으로 클램프**(설정 미스로 위법 불가). → §2
2. **법적 한계·형태 명세** — 외국인환자 한정·비급여 한정·수수료율 상한·유효기간 환불의무·유치업 등록을 **코드로 강제(enforced)**, 검진권 2형태를 정확히 정의. → §3

---

## 1. 아키텍처 개요

```
[관리자] voucher.admin (feature-access-matrix 권한)
   │ 정책설정·발행·배분·딜러심사·정산
[딜러 별도 포털] DistributorAuthGuard (독립 인증·다국어)
   │ 매입·재고·재판매·정산
[소비자(외국인환자) 포털] PortalOrPatientGuard
   │ 활성화·사용·잔여
[공개] 무인증 — 시리얼/QR 진위검증(PHI 비노출)
        │
   ┌────┴───────────────────────────────────┐
   ▼                                         ▼
VoucherService(발행·상태머신·상환)      VoucherPolicyService(설정·법정클램프)
DistributorService(딜러·배분·재판매)    VoucherLedgerService(해시체인·merkle·앵커)
SettlementService(비율수수료·정산)       → BlockchainAnchor(기존 재사용)
   │
   ▼ Prisma (신규 모델 — --schema --api 배포, db push 금지)
```

---

## 2. 중요 설정 관리 레이어 (VoucherPolicy)

### 2.1 설계 원칙 — 3계층 (법정 하한 클램프)
[[security_retention_g1]] 의 "법정 클램프 + DRY-RUN + 게이트" 패턴 차용.
```
법정 상수(코드, 변경불가)  ─클램프─▶  관리자 설정(VoucherPolicy, DB)  ─적용─▶  런타임
   LEGAL_FLOORS                       admin이 조정(법정 범위 내)
```
- 관리자가 유효기간을 6개월로 줄여도 **법정 최소 보장 미만이면 거부**(클램프).
- 위법 가능 설정은 저장 자체를 막고(BadRequest), 변경은 4-eyes + 감사.

### 2.2 VoucherPolicy 모델 (활성 1버전 + 이력)
```prisma
model VoucherPolicy {
  id                String   @id @default(uuid()) @db.Uuid
  version           Int      // 증가, active=최신 승인본
  active            Boolean  @default(false)
  // ── 형태/발행 ──
  enabledForms      String[] // ["PROGRAM","AMOUNT"] (상품권형/금액권형)
  serialPrefix      String   @default("WGC")
  // ── 유효기간/환불 (법정 클램프) ──
  validityMonths    Int      // 발행~만료 (법정 하한 이상)
  refundWindowMonths Int     // 미사용 환불 의무 기간
  balanceRefundRate Int      // 잔액 환불 비율(%) — 신유형 상품권 기준 이상
  // ── 딜러/수수료 (법정 상한 클램프) ──
  maxCommissionRate Int      // 딜러 수수료율 상한(%) ≤ 신고 한도
  maxHierarchyDepth Int      @default(2) // 총판→대리점 깊이
  prepaymentRequired Boolean @default(true) // 선결제 매입 강제
  // ── 법적 게이트 (토글로 끌 수 없는 강제값은 코드 상수) ──
  foreignerOnly     Boolean  @default(true) // 외국인환자 한정
  allowedCategories String[] // 비급여 프로그램 category 허용목록
  // ── 블록체인 앵커 ──
  anchorChainType   String   @default("INTERNAL") // INTERNAL | <ext chain>
  anchorIntervalMin Int      @default(60)
  approvedBy        String?  @db.Uuid // 4-eyes
  createdAt         DateTime @default(now()) @db.Timestamptz()
  @@map("voucher_policies")
}
```

### 2.3 법정 상수 (코드, `voucher-legal.constants.ts` — 변경 불가)
```ts
export const LEGAL_FLOORS = {
  MIN_VALIDITY_MONTHS: 60,        // 신유형 상품권 표준약관(유효기간) — 법무 확정값으로 교체
  MIN_REFUND_WINDOW_MONTHS: 60,   // 미사용 환불 청구 가능 최소
  MIN_BALANCE_REFUND_RATE: 60,    // 잔액 60% 이상 사용 시 잔액환불(신유형 상품권)
  MAX_COMMISSION_RATE_CAP: 30,    // 유치 수수료율 행정 상한(신고값으로 교체)
  FOREIGNER_ONLY_LOCKED: true,    // 내국인 재판매 불가(코드 강제 — 정책 토글 무시)
} as const;
// setPolicy(): validityMonths >= MIN_VALIDITY_MONTHS 등 전부 검증, 위반 시 BadRequest
```

### 2.4 관리 화면 (admin)
`/admin/voucher/settings` — 정책 편집(폼별 토글·유효기간·환불·수수료 상한·허용 프로그램·앵커) + **법정 하한 인라인 표시**(이 값 미만 저장 불가) + 4-eyes 승인 + 버전 이력/롤백.

---

## 3. 법적 한계 명세 (코드 강제) + 검진권 형태

### 3.1 법적 한계 — enforced rules
| ID | 법적 한계 | 근거 | 코드 강제 지점 |
|----|----------|------|---------------|
| L1 | **외국인환자 한정** 재판매(내국인 불가) | 의료법 §27③ 단서 + 외국인환자유치법 | Sale 시 소비자 `isForeigner` 검증 가드. `FOREIGNER_ONLY_LOCKED` |
| L2 | **비급여 종합검진만** 발행 | 국민건강보험(급여 본인부담 할인 금지) | Batch 발행 시 program.category ∈ allowedCategories & 비급여 검증 |
| L3 | **딜러 유치업 등록** 필수 | 외국인환자유치법(유치업 등록제) | Distributor 활성화 = 등록번호·만료 검증 통과 시에만 |
| L4 | **수수료율 상한** | 유치 수수료 신고/과도금지 | Sale commission ≤ policy.maxCommissionRate ≤ LEGAL cap |
| L5 | **유효기간·환불 의무** | 신유형 상품권 표준약관·전자금융거래법 | 만료 전 환불·잔액환불 정책 강제(클램프) |
| L6 | **이중사용 금지** | (무결성) | REDEEM 원자성(트랜잭션+advisory lock) |
| L7 | **병원 유치 의료기관 등록** | 외국인환자유치법 | 시스템 게이트(미등록 시 발행 비활성 flag) |
| L8 | 개인정보 국외이전 동의 | 개인정보보호법 | 소비자 활성화 동의 필드 |

> 위 L1·L3·L4는 **런타임 가드로 차단**(설정으로 우회 불가). 위반 시 DomainException.

### 3.2 검진권 형태 (2형태 명세)
| 항목 | **상품권형 (PROGRAM)** | **금액권형 (AMOUNT)** |
|------|----------------------|----------------------|
| 바인딩 | 특정 CheckupProgram 고정 | 프로그램 비고정, **액면가(faceValue)** |
| 사용 | 해당 프로그램 1회 예약 상환 | 임의 비급여 검진 결제에 차감 |
| 차액 | 없음(프로그램=정가 스냅샷) | faceValue vs 실검진가 차액정산(§3.3) |
| 잔액 | 없음(전액 1회) | 부분사용 시 잔액 추적(balance) |
| serial 군 | program.category 코드 | `AMT` 코드 |
| 환불 | 미사용 전액(기간 내) | 미사용/잔액 비율 환불 |

### 3.3 금액권형 차액정산 정책 (policy.balance 정책으로 택1)
- `RESIDUAL_VOUCHER`: 잔액으로 새 잔액권 발행(체인 분기)
- `REFUND_DIFF`: 차액 환불
- `FORFEIT`: 잔액 소멸(법정 잔액환불율 이상 사용 시에만 허용)
> 기본값은 정책 설정, 단 FORFEIT는 L5(잔액환불 의무) 위반 구간에서 자동 비활성.

---

## 4. 데이터 모델 (신규 — Prisma)

```prisma
model VoucherBatch {
  id           String   @id @default(uuid()) @db.Uuid
  form         String   // PROGRAM | AMOUNT
  programId    String?  @db.Uuid         // PROGRAM형
  faceValue    Int                       // 액면가(스냅샷)
  quantity     Int
  supplyPrice  Int                       // 발행 단가(기준)
  policyVersion Int                       // 발행 시점 정책 스냅샷
  serialRule   Json                       // 시리얼 규칙 스냅샷
  merkleRoot   String?  @db.VarChar(64)
  anchorId     String?  @db.Uuid          // BlockchainAnchor
  status       String   @default("DRAFT") // DRAFT|ISSUED|CLOSED
  issuedBy     String   @db.Uuid
  approvedBy   String?  @db.Uuid          // 고액 4-eyes
  createdAt    DateTime @default(now()) @db.Timestamptz()
  @@map("voucher_batches")
}

model CheckupVoucher {
  id             String  @id @default(uuid()) @db.Uuid
  serial         String  @unique @db.VarChar(40)
  batchId        String  @db.Uuid
  form           String  // PROGRAM | AMOUNT
  programId      String? @db.Uuid
  faceValue      Int
  balance        Int     // 금액권형 잔액(=faceValue 시작), 상품권형=faceValue/0
  status         String  @default("ISSUED") // §5 상태머신
  currentOwnerType String // HOSPITAL|DISTRIBUTOR|PATIENT
  currentOwnerId String?  @db.Uuid
  activationHash String  @db.VarChar(64)  // 활성화코드 해시(원문 미저장)
  boundPatientId String?  @db.Uuid        // 활성화 시 바인딩(외국인환자)
  genesisHash    String  @db.VarChar(64)
  headHash       String  @db.VarChar(64)
  expiresAt      DateTime? @db.Timestamptz()
  redeemedVisitId String? @db.Uuid
  createdAt      DateTime @default(now()) @db.Timestamptz()
  @@index([batchId]) @@index([currentOwnerType, currentOwnerId]) @@index([status])
  @@map("checkup_vouchers")
}

model VoucherEvent {       // append-only 해시체인
  id         String  @id @default(uuid()) @db.Uuid
  voucherId  String  @db.Uuid
  serial     String  @db.VarChar(40)
  type       String  // ISSUE|ALLOCATE|TRANSFER|ACTIVATE|REDEEM|REVOKE|REFUND|RESIDUAL
  prevHash   String  @db.VarChar(64)
  hash       String  @db.VarChar(64)
  actorType  String
  actorId    String? @db.Uuid
  payload    Json    @db.JsonB           // 당사자·수량·단가·결제ref
  anchorId   String? @db.Uuid
  createdAt  DateTime @default(now()) @db.Timestamptz()
  @@index([voucherId]) @@index([serial]) @@index([hash])
  @@map("voucher_events")
}

model Distributor {        // 해외 딜러
  id            String  @id @default(uuid()) @db.Uuid
  name          String
  parentId      String? @db.Uuid          // 계층(총판→대리점)
  tier          String  // MASTER | AGENT
  country       String                     // ISO
  currency      String
  licenseNumber String                     // 외국인환자 유치업 등록번호 (L3)
  licenseExpiry DateTime? @db.Date
  commissionRate Int                       // 비율 수수료(%) ≤ policy.maxCommissionRate
  status        String  @default("PENDING") // PENDING|ACTIVE|SUSPENDED|TERMINATED
  approvedBy    String? @db.Uuid           // 심사 4-eyes
  createdAt     DateTime @default(now()) @db.Timestamptz()
  @@index([parentId]) @@map("voucher_distributors")
}

model DistributorAccount { // 별도 포털 인증주체
  id            String  @id @default(uuid()) @db.Uuid
  distributorId String  @db.Uuid
  email         String  @unique
  passwordHash  String
  locale        String  @default("en")
  mfaEnabled    Boolean @default(false)
  lastLoginAt   DateTime? @db.Timestamptz()
  @@map("voucher_distributor_accounts")
}

model VoucherAllocation { // 선결제 매입 배분
  id           String @id @default(uuid()) @db.Uuid
  fromType     String // HOSPITAL | DISTRIBUTOR
  fromId       String? @db.Uuid
  toDistributorId String @db.Uuid
  quantity     Int
  supplyPrice  Int                       // 공급단가
  paymentRef   String? @db.VarChar(64)   // 선결제 결제 ref(필수 — prepaymentRequired)
  paidAt       DateTime? @db.Timestamptz()
  status       String @default("PENDING") // PENDING|PAID|FULFILLED|REVOKED
  createdAt    DateTime @default(now()) @db.Timestamptz()
  @@map("voucher_allocations")
}

model VoucherSale {       // 재판매
  id           String @id @default(uuid()) @db.Uuid
  voucherId    String @db.Uuid
  distributorId String @db.Uuid
  buyerType    String // PATIENT(외국인) | DISTRIBUTOR(하위)
  buyerId      String? @db.Uuid
  salePrice    Int
  commissionRate Int                      // 적용 수수료율(스냅샷)
  commissionAmount Int
  currency     String
  paymentRef   String? @db.VarChar(64)
  soldAt       DateTime @default(now()) @db.Timestamptz()
  @@index([distributorId]) @@map("voucher_sales")
}

model VoucherSettlement { // 정산
  id           String @id @default(uuid()) @db.Uuid
  distributorId String @db.Uuid
  periodStart  DateTime @db.Date
  periodEnd    DateTime @db.Date
  grossSales   Int
  commissionTotal Int
  netPayable   Int
  status       String @default("DRAFT") // DRAFT|CONFIRMED|PAID
  billingRef   String? @db.VarChar(64)   // ERP/Billing 연계
  @@map("voucher_settlements")
}
```

---

## 5. 상태 머신 / 상환 원자성

```
ISSUED ─allocate(선결제 PAID)→ ALLOCATED ─(재)allocate→ ALLOCATED ─sell→ SOLD
SOLD ─activate(외국인환자+동의)→ ACTIVE ─redeem→ REDEEMED
ACTIVE(금액권 부분사용) → ACTIVE(balance↓) 또는 → REDEEMED(소진)
any ─revoke→ REVOKED / SOLD·ACTIVE ─refund→ REFUNDED / ACTIVE ─만료→ EXPIRED
```
- **REDEEM 원자성**: `pg_advisory_xact_lock(hashtext(serial))` + 트랜잭션 + 조건부 `updateMany(where status=ACTIVE, balance>=요구액)` → 이중사용 0. (W-9 패턴 [[consult_desk_expansion]])
- 모든 전이 = VoucherEvent 1건(prevHash=headHash 선행조건, append-only) + 상태 update, 동일 트랜잭션.

---

## 6. 블록체인 (해시체인 + merkle 앵커)
- `hash = sha256(prevHash + serial + type + sha256(payload) + actorId + ts)`.
- 배치/주기 cron: 미앵커 이벤트 headHash 모아 **merkle tree → merkleRoot** → `BlockchainAnchor`(anchorType=`CHECKUP_VOUCHER`, chainType=policy.anchorChainType, 옵션 외부 txHash).
- 공개 검증: serial → headHash → merkleProof로 merkleRoot 포함 증명 → 발급 진위·무변조. (PHI·소유자 미노출)

---

## 7. 딜러 별도 포털 (독립 인증)
- `DistributorAuthGuard` — staff JwtAuthGuard·PortalOrPatientGuard 와 **분리**. `DistributorAccount` 기반 JWT(aud=`distributor`). MFA·locale.
- **스코프 가드**: 모든 딜러 EP는 `assertDistributorScope(req.distributor.id, resource)` — 타 딜러 재고/정산 접근 403 (IDOR 차단, [[feature_portal_endpoint_guard]] 패턴).
- 화면(다국어): 대시보드·매입(선결제)·재고·재판매·하위배분·정산명세·실적.

---

## 8. API 설계

### 8.1 관리자 (`/api/v1/voucher`, voucher.admin 권한)
```
GET/PUT  /policy                  정책 조회/수정(법정클램프·4-eyes)
POST     /batches                 배치 발행(L2 검증·시리얼·genesis·merkle)
GET      /batches/:id
POST     /distributors            딜러 등록/심사(L3 등록번호 검증)
PUT      /distributors/:id/status 활성/정지/해지
POST     /allocations             배분(선결제 요구)
POST     /allocations/:id/revoke
GET      /settlements             정산 산출/확정
GET      /dashboard               발행/유통/사용/앵커 집계
```
### 8.2 딜러 포털 (`/api/v1/distributor`, DistributorAuthGuard)
```
POST /auth/login                  딜러 로그인(독립 IdP)
GET  /inventory                   내 재고(스코프)
POST /allocations/:id/pay         선결제 매입 완결
POST /sales                       재판매(L1 외국인 검증·L4 수수료 상한)
POST /sub-allocations             하위 딜러 배분(maxHierarchyDepth)
GET  /settlement                  내 정산
```
### 8.3 소비자/공개
```
POST /api/v1/portal/vouchers/:serial/activate   활성화(외국인환자+L8 동의)
POST /api/v1/portal/vouchers/:serial/redeem     검진예약 상환(원자)
GET  /api/v1/public/vouchers/:serial/verify     공개 진위검증(무인증·PHI없음)
```

---

## 9. 권한 / feature-access 연동
- `voucher.admin` (발행·배분·정산), `voucher.policy`(정책변경·4-eyes), `voucher.settlement` 를 [[feature_access_matrix]] FEATURE_REGISTRY에 등록 → 역할×기능 + 사용자 grant/deny 세밀관리.
- 딜러는 RBAC 밖(별도 인증주체) — feature-access 대상 아님.

---

## 10. 정산 / 회계 (ERP 연계)
- 발행/매입/재판매/환불 시 `billing.line_recorded` 발행(스키마 정합 [[billing_lines_d6]]) → ERP가 SoT로 정산. 외화·영세율 필드 동봉.
- 딜러 정산 = 기간별 grossSales·commission(비율)·netPayable → VoucherSettlement → billingRef.

---

## 11. 테스트 / 검증
- 단위: 정책 클램프(법정 하한 미만 거부)·상태전이·시리얼 체크값·해시체인 검증.
- E2E: 발행→선결제배분→재판매(외국인 검증·비외국인 차단 L1)→활성화→상환(이중사용 동시 5건→1건)→환불.
- 공개검증 merkleProof 포함증명·변조탐지.
- 딜러 스코프 IDOR(타 딜러 재고 403).
- code-analyzer 🔴0.

---

## 12. 구현 순서

**P1 (코어·스키마)**
1. Prisma 모델 + `--schema --api` 배포(자동 백업)
2. voucher-legal.constants + VoucherPolicyService(클램프·4-eyes) + 설정 화면
3. VoucherService(발행 배치·시리얼·genesis) + VoucherLedgerService(해시체인·merkle·앵커)
4. 소비자 활성화·상환(원자) + 공개 검증

**P2 (유통)**
5. DistributorService(심사·L3 등록검증·계층) + 선결제 배분 + 재판매(L1·L4)
6. DistributorAuthGuard + 딜러 별도 포털(다국어)

**P3 (정산/대시보드)**
7. SettlementService(비율 정산·ERP/Billing) + 관리자 대시보드 + 앵커 cron

각 단계: code-analyzer + E2E + nest build.

---

## 13. 미결(설계 후속, 법무 수치 확정)
- LEGAL_FLOORS 실제값(유효기간·잔액환불율·수수료 상한) = 법무/약관 확정 후 상수 교체. **L4 수수료 상한 출처 = 시도 신고 유치 수수료율**(행정 확정).
- 외부 퍼블릭 체인 앵커 연동 시점(P3 이후 옵션). 그 전까지 INTERNAL 앵커의 신뢰 한계는 §14.3 명문.
- 병원 유치 의료기관 등록·딜러 유치업 등록 운영 현황(행정).

---

## 14. 상세 보완 (v1.1 — design-validator 검토 반영)
> 본 장이 앞 장과 충돌하면 본 장이 우선. (검토 C-1~C-5 / W-1~W-6 / G-1~G-5 대응)

### 14.1 상태머신 전이표 (C-1)
| # | 현재 | 이벤트 | 다음 | guard | actor | VoucherEvent.type | 자금흐름 |
|---|------|--------|------|-------|-------|-------------------|---------|
| 1 | DRAFT(batch) | issue | **ISSUED** | L2 비급여·정책 valid·4-eyes(고액) | admin | ISSUE(genesis) | — |
| 2 | ISSUED/ALLOCATED | allocate | **ALLOCATED** | 선결제 PAID·toDealer ACTIVE(L3)·단가≥상위 | admin/dealer | ALLOCATE/TRANSFER | 딜러→상위 선결제(매입) |
| 3 | ALLOCATED | sell | **SOLD** | 보유 dealer 일치·재고 | dealer | TRANSFER | 소비자→딜러 결제 |
| 4 | ALLOCATED | revoke | **ISSUED**(재고복귀) | 매입 환불 처리·미판매 | admin | REVOKE | 병원→딜러 환불(claw) |
| 5 | SOLD | activate | **ACTIVE** | L1 외국인·L8 동의·활성화코드 일치 | patient | ACTIVATE | — |
| 6 | SOLD | refund(미활성) | **REFUNDED** | 환불기간·미사용 | admin/dealer | REFUND | 소비자환급+딜러수수료 claw |
| 7 | ACTIVE | redeem(상품권형/금액권 소진) | **REDEEMED** | 원자락·잔액≥검진가·미만료 | patient | REDEEM | 액면 차감(초과분 §14.4) |
| 8 | ACTIVE | redeem(금액권 부분) | **ACTIVE**(balance↓) | 원자락·balance>0·미만료 | patient | REDEEM(부분) | balance 차감 |
| 9 | ACTIVE | refund | **REFUNDED** | 잔액환불율(L5)·기간 | admin | REFUND | 잔액 환급+claw |
| 10 | ISSUED/ALLOCATED/SOLD/ACTIVE | expire | **EXPIRED** | now>expiresAt | cron | EXPIRE | 낙전 인식(§14.5) |
| 11 | any | revoke(위조/분실) | **REVOKED** | 신고·관리자 | admin | REVOKE | 환불 규정 |

- **만료 cron**(신설, §14.10): `expiresAt < now & status ∈ {ISSUED,ALLOCATED,SOLD,ACTIVE}` 스캔 → EXPIRE 전이 + 이벤트. (미활성화 만료 포함)
- **딜러 정지/해지 재고처리**(FR-10): `PUT /distributors/:id/status=SUSPENDED|TERMINATED` 시, 해당 딜러 보유(`currentOwnerType=DISTRIBUTOR`) 검진권 **SOLD 전 전량 동결**(거래 차단 플래그) → TERMINATED 시 상위로 revoke(전이 #4, 매입 환불) 일괄. 트랜잭션 청크 처리.

### 14.2 동시성·멱등성 매트릭스 (C-2)
| 작업 | advisory lock 키 | 멱등키 | 비고 |
|------|------------------|--------|------|
| 시리얼 일련 발급 | `pg_advisory_xact_lock(hashtext(batchId))` | — | 또는 batch 전용 Postgres sequence. unique는 방어 아님 |
| batch 발행 | batchId | `VoucherBatch.idempotencyKey @unique` | 중복 호출 시 기존 배치 반환 |
| allocate/매입결제 | `hashtext(voucherId)`(건별) | `VoucherAllocation.idempotencyKey @unique`·`paymentRef @unique` | 이중 배분/이중 결제 차단 |
| sell | `hashtext(serial)` | `VoucherSale.idempotencyKey @unique` | |
| activate | `hashtext(serial)` | — | 1회성(상태조건) |
| redeem | `pg_advisory_xact_lock(hashtext(serial))` + 조건부 updateMany | `VoucherRedemption.idempotencyKey @unique` | 이중사용 0 |
- 체인 분기 방어: `VoucherEvent @@unique([voucherId, prevHash])` → 같은 head에서 2이벤트 불가(DB 강제).

### 14.3 블록체인 신뢰모델 (C-3) — 정직한 보증 범위
- **append-only 강제**: `voucher_events`에 UPDATE/DELETE 차단 트리거 + 앱 DB 롤에 해당 권한 revoke(별도 마이그레이션 SQL). 수정·삭제 자체를 DB가 거부.
- **신뢰 한계 명문**: INTERNAL 앵커는 같은 가변 DB에 merkleRoot 저장 → **운영자/DBA 신뢰 가정**. 외부 불변 앵커(third-party 체인 txHash) 연동 전까지는 "발급기관 내부 무결성"만 보증하고 "제3자 검증가능 불변성"은 아님 — 표제 과장 방지 위해 공개검증 UI·약관에 명시.
- **체인검증 cron**(신설): prevHash 연쇄 무결성 + 표본 merkleProof 재검증 주기 스캔 → 불일치 시 보안 알림(`[[emr_cert_audit_hardening]]` 변조탐지 패턴).
- **앵커 상태/재시도**: `VoucherEvent`에 `anchorStatus`(PENDING|ANCHORED|FAILED)·`anchorAttempts Int`·`anchoredAt` 추가. 앵커 cron 실패 시 지수백오프 재시도, 미앵커 적체 임계 초과 알림.

### 14.4 금액권형 차액정산 + 결제 연동 (C-4, G-1)
- **VoucherRedemption 모델 신설**(plan §3 복원, design 누락 수정):
```prisma
model VoucherRedemption {
  id String @id @default(uuid()) @db.Uuid
  voucherId String @db.Uuid
  visitId   String @db.Uuid        // CheckupVisit
  amountUsed Int                    // 차감액
  actualPrice Int                   // 실검진가
  diffBillingRef String?            // 초과분 추가결제 ref
  idempotencyKey String @unique
  createdAt DateTime @default(now()) @db.Timestamptz()
  voucher CheckupVoucher @relation(fields:[voucherId], references:[id])
  @@index([voucherId]) @@index([visitId]) @@map("voucher_redemptions")
}
```
  → `redeemedVisitId`(1:1) 제거, **N:M 부분사용** 지원.
- **redeem 시퀀스**: `redeem(serial, visitId, actualPrice)`
  1. 원자락 + 미만료·status ACTIVE 검증
  2. `useAmount = min(balance, actualPrice)`; balance -= useAmount
  3. `actualPrice > useAmount`(초과) → 차액 `billing.line_recorded`로 소비자 추가청구(diffBillingRef)
  4. balance==0 → REDEEMED, else ACTIVE 유지
  5. VoucherRedemption + REDEEM 이벤트(동일 트랜잭션)
  6. 종료 시 잔액 정책(RESIDUAL_VOUCHER 분기 발행 / REFUND_DIFF / FORFEIT) 적용

### 14.5 자금흐름 ↔ billing.line 매핑 (C-5)
2경로 동일스키마 원칙([[session_20260615_codeanalyzer_residual]], [[billing_lines_d6]]).
| 생애주기 | billing.line type | 당사자(차/대) | 통화 |
|----------|-------------------|--------------|------|
| 발행(매입 선결제) | `voucher.purchase` | 딜러→병원 | 딜러통화/원 |
| 재판매 | `voucher.resale` | 소비자→딜러 | 외화 |
| 수수료 | `voucher.commission` | 병원↔딜러(비율) | 정산통화 |
| 상환(검진사용) | `voucher.redeem` | 검진수익 인식 | 원 |
| 초과 차액 | `voucher.topup` | 소비자→병원 | 원 |
| 환불 | `voucher.refund`(claw 포함) | 병원→소비자/딜러 | 원천통화 |
| 만료 낙전 | `voucher.forfeit` | 수익 인식(규정) | — |
- **환불 claw-back**: 환불 시 기지급 딜러 수수료 회수 line 동반.
- **`VoucherSettlement` 컬럼 추가**: `currency`·`fxRate`·`fxRateAt`·`refundClawback`. netPayable = grossSales − commission − refundClawback. 환율 스냅샷 = 거래 시점(Sale.soldAt).

### 14.6 법적 강제 데이터소스 (W-1)
- **L1 외국인**: `Patient.nationality`(ISO)·여권번호 필드를 진실소스로. activate 가드에서 `nationality != 'KR'` 검증(FOREIGNER_ONLY_LOCKED).
- **L3 유치업 등록**: 딜러 온보딩 = 등록증 업로드 + **관리자 4-eyes 수동 승인**(자동 정부API는 후속). `licenseExpiry` **만료 모니터 cron**: 임박 알림·경과 시 자동 SUSPENDED(재판매 차단).
- **L4 상한 출처**: §13 명문(시도 신고 수수료율) → `MAX_COMMISSION_RATE_CAP` 교체.

### 14.7 딜러 포털 보안 (W-2)
- `DistributorAccount`에 `failedAttempts Int`·`lockedUntil DateTime?` 추가. N회 실패 잠금.
- **MFA 강제**: 매입/재판매 등 자금 작업 전 MFA 필수(`mfaEnabled @default(true)`, 미설정 시 거래 차단).
- 로그인·자금 EP에 Throttle(레이트리밋), 비밀번호 정책(길이·해시 scrypt/argon2). 스코프 IDOR 가드(§7) 유지.

### 14.8 모델 델타 (W-3, G-4)
- **전 모델 `@relation` 추가**(batch↔voucher, voucher↔event/redemption, distributor↔account/allocation/sale/settlement) + FK 인덱스([[db_performance_review]]).
- **인덱스 추가**: `VoucherSale.voucherId`·`distributorId`, `VoucherAllocation.toDistributorId,status`, `Distributor.licenseExpiry`, `Distributor.status`, `VoucherSettlement(distributorId,status)`, `CheckupVoucher.expiresAt`, `CheckupVoucher.boundPatientId`.
- **UNIQUE**: `VoucherEvent @@unique([voucherId, prevHash])`, 각 멱등키 unique, `VoucherPolicy` active 단일 보장 = partial unique index `WHERE active`.
- **balance 규약 확정**: 상품권형 balance = faceValue(소진 시 0), 사용은 전액 1회. 금액권형 balance = 가변.

### 14.9 DTO 검증 (W-4)
모든 쓰기 API에 class-validator DTO([[feedback_dto_class_validator]]): 금액 `@IsInt @Min(0)`, 수량 `@IsInt @Min(1)`, `currency @IsISO4217`, `commissionRate @IsInt @Min(0) @Max(cap)`, 시리얼/코드 `@Matches`, 멱등키 `@IsString`. 음수·오버플로우·통화 검증 필수.

### 14.10 대량 발행 성능 (W-5)
- 배치 발행 = **청크(10k)별 트랜잭션 + `createMany`**. genesis 이벤트도 청크 createMany.
- **merkle는 동기 산출 금지** → 앵커 cron으로 이연(발행 직후 status=ISSUED, anchorStatus=PENDING). 대량 leaf merkle은 배치 단위 비동기.
- 인덱스 위 대량 insert 부하 고려(필요 시 발행 중 일부 인덱스 지연 생성은 운영 판단).

### 14.11 시리얼/활성화코드 전달 (W-6)
- activationCode 원문 = **발행 시 1회 생성→해시(activationHash)만 저장**, 원문은 봉인 인쇄(스크래치) 또는 소비자 직접 채널 전달. **딜러는 원문 미열람**(시리얼만 취급) → 도난 무력화 유지.
- 검진권 형태: 디지털(QR+시리얼) 기본, 물리 카드(봉인 활성화코드) 옵션.

### 14.12 정합·규약 (G-1·G-2·G-3)
- API prefix **확정**: 관리자 `/api/v1/voucher/*`, 딜러 `/api/v1/distributor/*`, 소비자 `/api/v1/portal/vouchers/*`, 공개 `/api/v1/public/vouchers/*`. (plan §11 `/checkup/vouchers`는 본 설계로 대체)
- anchorType 문자열 **확정**: `CHECKUP_VOUCHER`(배치/이벤트 공통).
- 응답/에러 규약: `{ data, meta }` / `{ error:{ code, message } }`. 에러코드: `VOUCHER_NOT_FOUND·VOUCHER_EXPIRED·NOT_FOREIGNER·COMMISSION_EXCEEDED·DOUBLE_REDEEM·DEALER_SUSPENDED·LICENSE_EXPIRED·POLICY_BELOW_LEGAL_FLOOR`.

### 14.13 테스트 보강 (G-5)
- 만료 cron(미활성화/활성화 분기), 앵커 실패·재시도, 멱등 중복호출(배치/재판매/상환), 체인검증 변조탐지, 딜러 정지 재고동결, 금액권 부분사용 N회+초과 차액결제, 환불 claw-back 정산.
