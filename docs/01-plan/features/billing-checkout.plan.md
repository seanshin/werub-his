# 원무과 수납 관리 종합 기획서 v3

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/billing/billing.controller.ts:96 · apps/api/prisma/schema.prisma:2040 · apps/api/prisma/schema.prisma:2062 · apps/api/src/modules/deposit/deposit.service.ts:41 · 잔여: 없음

> 작성일: 2026-05-20 | 수정일: 2026-05-20 | 상태: 기획 완료 (검토 반영)

## 1. 현재 구현 상태

### 1.1 백엔드 모듈 (4개)

| 모듈 | API 수 | 역할 | 상태 |
|------|--------|------|------|
| billing | 4 | 수납 CRUD + 결제 | ✅ 완성 |
| billing-advanced | 2 | FFS/DRG 수가 계산 | ✅ 완성 |
| claim | 7 | HIRA 청구 + XML | ✅ 완성 |
| insurance-claim | 7 | 보험 청구 상세 (EDI) | ✅ 완성 |

### 1.2 프론트엔드 페이지 (6개)

| 페이지 | 경로 | 상태 |
|--------|------|------|
| 접수 데스크 | `/reception` | ✅ 예약/당일/대기 3탭 |
| 수납 목록 | `/billing` | ✅ 상태 필터 (전체/미수납/완료) |
| 수납 상세 | `/billing/[id]` | ✅ 항목 내역 + 결제 처리 |
| 보험 청구 | `/claims` | ✅ 생성/제출/XML/일괄 |
| 영수증 출력 | `/print/receipt/[billingId]` | ✅ A4 인쇄 |
| 환자 수납 이력 | 환자상세 > BillingTab | ✅ 수납+처방 |

### 1.3 데이터 모델

```
Billing (billings)
├── id, encounterId, patientId
├── totalAmount, insuranceCovered, patientCopay
├── status (PENDING/PAID/PARTIAL/CANCELLED)
├── paidAt, paidAmount
└── items: BillingItem[]
    └── codeType, codeId, codeName, quantity, unitPrice, amount, copayRate

Claim (claims)
├── billingId, patientId, claimNumber, claimDate
├── claimedAmount, approvedAmount, paidAmount, reducedAmount
├── status (DRAFT/SUBMITTED/UNDER_REVIEW/APPROVED/PARTIALLY_APPROVED/REJECTED/PAID)
└── claimData (JSON)
```

### 1.4 수가 계산 로직

```
보험유형별 본인부담률:
├── 건강보험 (NHI)      → 30%
├── 의료급여 (MEDICAID)  → 0%
├── 산재 (INDUSTRIAL)    → 0%
├── 자동차보험 (AUTO)    → 0%
└── 자비 (SELF_PAY)      → 100%

수가 체계:
├── FFS (행위별) — 진찰료 + 처방별 약제비/검사료/영상료 합산
└── DRG (포괄)  — 질병군 코드별 정액 (MVP: 4개 코드)
```

### 1.5 사이드바 메뉴 (원무과)

```
원무과 접근 메뉴:
/dashboard → /reception → /billing → /claims → /patients → /schedule → /hr → /education
```

---

## 2. 문제점 분석

### 2.1 워크플로우 단절

| # | 문제 | 영향 |
|---|------|------|
| P-1 | 의사 서명 후 수납 자동 생성 없음 | 원무과 직원이 수동 확인 필요 |
| P-2 | 수납 대기열 없음 | 환자가 수납 순서를 모름 |
| P-3 | 수납 전용 대시보드 없음 | 원무과 업무 효율 저하 |
| P-4 | 수납→약국 자동 연동 없음 | 처방 수령 안내 불가 |
| P-5 | 환자 여정 완료(퇴원) 프로세스 없음 | 진료 완료 추적 불가 |

### 2.2 기능 부재

| # | 기능 | 현황 |
|---|------|------|
| F-1 | 결제 수단 (카드/현금/이체) | 미구현 — 금액만 기록 |
| F-2 | 수납 취소/환불 | 미구현 — 취소(원복)와 환불(반환) 구분 필요 |
| F-3 | 미수금 관리 (독촉/분할납부) | 미구현 |
| F-4 | 일일 마감 정산 | 미구현 |
| F-5 | 현금영수증 발행 | 미구현 |
| F-6 | 카드 승인번호 기록 | 미구현 |
| F-7 | 분할 납부 스케줄 | 미구현 — 미수금 월별 분할 |
| F-8 | 선납/예치금 관리 | 미구현 — 입원 환자 예치금 |
| F-9 | 급여/비급여 구분 표시 | 미구현 — 환자 알 권리 |
| F-10 | 세금계산서 발행 | 미구현 — 법인 자비 환자 |

### 2.3 코드 이슈

| # | 이슈 | 상세 |
|---|------|------|
| C-1 | claim vs insurance-claim 중복 | 동일 경로 `/api/v1/claims`에 2개 컨트롤러 |
| C-2 | billing 목록 응답 구조 불일치 | `{ data, pagination }` vs `{ data: { data } }` |
| C-3 | 프론트엔드 `any` 타입 | billing/claims 페이지에 타입 미정의 |

---

## 3. 목표 워크플로우

```
[접수] → [대기] → [진료] → [의사 서명]
                                ↓ (자동)
                        ┌───────────────────┐
                        │  수납 자동 생성     │
                        │  대기열 자동 등록   │
                        │  여정 이벤트 발행   │
                        └───────┬───────────┘
                                ↓
                    ┌─ 원무과 수납 대시보드 ─┐
                    │  대기열 | 현황 | 미수납 │
                    └───────┬───────────────┘
                            ↓
                    ┌─ 수납 처리 ──────────┐
                    │  카드/현금/이체/미수   │
                    │  현금영수증 발행       │
                    │  카드 승인번호 기록    │
                    └───────┬──────────────┘
                            ↓
                    ┌─ 수납 후 처리 ────────┐
                    │  영수증 출력           │
                    │  처방전 출력           │
                    └───┬───────────┬───────┘
                        ↓           ↓
                  [처방 있음]    [처방 없음]
                    ↓              ↓
              약국 대기열      퇴원 완료
                    ↓
              약 수령 → 퇴원
```

---

## 4. 구현 계획

### Phase 1: 데이터 모델 확장 (난이도: 낮음)

**Billing 모델에 결제 관련 필드 추가:**

```prisma
model Billing {
  // 기존 필드 유지 ...
  
  // Phase 1: 결제 수단
  paymentMethod    String?   @map("payment_method") @db.VarChar(20)
  // CARD | CASH | TRANSFER | DEFERRED
  cardApprovalNo   String?   @map("card_approval_no") @db.VarChar(30)
  receiptNo        String?   @map("receipt_no") @db.VarChar(30)
  cashReceiptType  String?   @map("cash_receipt_type") @db.VarChar(20)
  // INCOME (소득공제) | EXPENSE (지출증빙)
  cashReceiptNo    String?   @map("cash_receipt_no") @db.VarChar(30)
  
  // Phase 1: 미수/환불
  deferredReason   String?   @map("deferred_reason") @db.Text
  refundAmount     Int?      @map("refund_amount")
  refundedAt       DateTime? @map("refunded_at") @db.Timestamptz()
  refundReason     String?   @map("refund_reason") @db.Text
  
  // Phase 1: 원무과 메모
  cashierNote      String?   @map("cashier_note") @db.Text
  processedBy      String?   @map("processed_by") @db.Uuid
}
```

**WaitingQueue 상태 확장:**

> 참고: `status`는 `String @db.VarChar(20)` (enum 아님) — 마이그레이션 없이 새 상태값 추가 가능.
> 단, `queue-display.service.ts`의 하드코딩된 상태 배열(`defaultStatuses`, step 계산 등) 수정 필요.

```
현재: WAITING → CALLED → IN_CONSULTATION → COMPLETED

확장:
WAITING → CALLED → IN_CONSULTATION → ENCOUNTER_SIGNED
  → CASHIER_WAITING → CASHIER_CALLED → BILLING_PAID
  → PHARMACY_WAITING → PHARMACY_DISPENSED → VISIT_COMPLETED
```

**BillingItem 급여/비급여 구분 필드 추가:**

```prisma
model BillingItem {
  // 기존 필드 유지 ...
  insuranceCategory  String?  @map("insurance_category") @db.VarChar(20)
  // COVERED (급여) | NON_COVERED (비급여) | PARTIALLY_COVERED (일부급여)
}
```

**선납/예치금 모델:**

```prisma
model Deposit {
  id            String    @id @default(uuid()) @db.Uuid
  patientId     String    @map("patient_id") @db.Uuid
  admissionId   String?   @map("admission_id") @db.Uuid
  amount        Int
  balance       Int       // 잔액 (사용 후 감소)
  depositType   String    @map("deposit_type") @db.VarChar(20)
  // ADMISSION (입원 예치금) | PREPAID (선납)
  paymentMethod String?   @map("payment_method") @db.VarChar(20)
  depositedAt   DateTime  @default(now()) @map("deposited_at") @db.Timestamptz()
  refundedAt    DateTime? @map("refunded_at") @db.Timestamptz()
  processedBy   String    @map("processed_by") @db.Uuid
  note          String?   @db.Text
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  patient       Patient   @relation(fields: [patientId], references: [id])

  @@index([patientId])
  @@map("deposits")
}
```

**분할 납부 모델:**

```prisma
model InstallmentPlan {
  id            String    @id @default(uuid()) @db.Uuid
  billingId     String    @map("billing_id") @db.Uuid
  totalAmount   Int       @map("total_amount")
  installments  Int       // 분할 횟수
  paidCount     Int       @default(0) @map("paid_count")
  nextDueDate   DateTime? @map("next_due_date") @db.Date
  status        String    @default("ACTIVE") @db.VarChar(20)
  // ACTIVE | COMPLETED | OVERDUE | CANCELLED
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  billing       Billing   @relation(fields: [billingId], references: [id])
  payments      InstallmentPayment[]

  @@map("installment_plans")
}

model InstallmentPayment {
  id         String   @id @default(uuid()) @db.Uuid
  planId     String   @map("plan_id") @db.Uuid
  seqNo      Int      @map("seq_no")
  amount     Int
  dueDate    DateTime @map("due_date") @db.Date
  paidAt     DateTime? @map("paid_at") @db.Timestamptz()
  status     String   @default("PENDING") @db.VarChar(20)
  // PENDING | PAID | OVERDUE

  plan       InstallmentPlan @relation(fields: [planId], references: [id])

  @@map("installment_payments")
}
```

### Phase 2: 수납 자동 생성 + API 확장 (난이도: 중간)

**새 API:**

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | GET | `/api/v1/billing/cashier-queue` | 수납 대기열 (PENDING, 서명 완료 순) |
| 2 | GET | `/api/v1/billing/cashier-stats` | 오늘 현황 (대기/완료/미수/매출) |
| 3 | PATCH | `/api/v1/billing/:id/pay` | 수납 처리 (결제수단 포함) — 기존 확장 |
| 4 | PATCH | `/api/v1/billing/:id/cancel` | 수납 취소 (PENDING/PARTIAL → CANCELLED) |
| 5 | PATCH | `/api/v1/billing/:id/refund` | 환불 처리 (PAID → REFUNDED, 전액/부분) |
| 6 | PATCH | `/api/v1/billing/:id/defer` | 수납 보류 (미수 처리) |
| 7 | GET | `/api/v1/billing/daily-summary` | 일일 정산 (매출/결제수단별/미수) |
| 8 | GET | `/api/v1/billing/deferred` | 미수금 목록 |
| 9 | POST | `/api/v1/billing/:id/installment` | 분할 납부 계획 생성 |
| 10 | PATCH | `/api/v1/billing/installment/:planId/pay` | 분할 납부 회차 결제 |
| 11 | POST | `/api/v1/deposits` | 선납/예치금 등록 |
| 12 | GET | `/api/v1/deposits/:patientId` | 환자 예치금 조회 |
| 13 | PATCH | `/api/v1/deposits/:id/refund` | 예치금 환불 |

**자동 생성 로직 (encounter.sign 이벤트):**

> 주의: BillingService를 EncounterService에 직접 주입하면 **순환 의존성** 발생 가능.
> **권장 방식**: NestJS `EventEmitter2`를 사용한 이벤트 기반 연동.

```typescript
// encounter.service.ts — sign() 메서드 (이벤트 발행)
async sign(id: string) {
  const signed = await this.prisma.encounter.update({ ... });
  
  // 이벤트 발행 → BillingListener에서 처리
  this.eventEmitter.emit('encounter.signed', {
    encounterId: id,
    patientId: existing.patientId,
  });
  
  return signed;
}

// billing.listener.ts — 이벤트 수신 (새 파일)
@Injectable()
export class BillingListener {
  constructor(
    private readonly billingService: BillingService,
    private readonly waitingQueueService: WaitingQueueService,
  ) {}

  @OnEvent('encounter.signed')
  async handleEncounterSigned(payload: { encounterId: string; patientId: string }) {
    // 1. Billing 자동 생성
    await this.billingService.createFromEncounter(payload.encounterId);
    // 2. WaitingQueue → CASHIER_WAITING
    await this.waitingQueueService.updateStatusByEncounter(
      payload.encounterId, 'CASHIER_WAITING'
    );
  }
}
```

**수납 취소 vs 환불 구분:**

```
수납 취소 (Cancel):
- 대상: PENDING/PARTIAL 상태 수납
- 동작: status → CANCELLED, 금액 원복
- 사유: 진료 취소, 오등록 등

환불 (Refund):
- 대상: PAID 상태 수납
- 동작: refundAmount/refundedAt 기록, status → REFUNDED
- 사유: 과오납, 진료 부분 취소 등
- 전액 환불 또는 부분 환불 가능
```

### Phase 3: 수납 대시보드 개편 (난이도: 중간)

**`/billing` 페이지 개편:**

```
┌─ 수납 대시보드 ──────────────────────────────────────────────────────┐
│                                                                      │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────────┐              │
│  │ 수납대기 │  │ 오늘완료│  │ 미수납  │  │ 오늘 매출     │              │
│  │   5     │  │   23   │  │   3    │  │ ₩2,450,000  │              │
│  └────────┘  └────────┘  └────────┘  └──────────────┘              │
│                                                                      │
│  [수납 대기열] [미수납 관리] [일일 정산] [예치금]             ← 탭    │
│                                                                      │
│  ── 수납 대기열 (실시간 10초 새로고침) ──                            │
│  #  대기번호  환자명    진료과   본인부담금   대기시간   작업          │
│  1  A-045   김영수    내과    ₩10,500     3분     [수납] [상세]    │
│  2  A-046   박철수    정형외과 ₩45,000     1분     [수납] [상세]    │
│                                                                      │
│  ── 수납 처리 (선택 시 슬라이드 패널) ──                            │
│  환자: 김영수 (P2026-0001) │ 보험: 건강보험                        │
│                                                                      │
│  항목              수량   구분    금액      보험부담    본인부담      │
│  재진 진찰료        1    급여   ₩12,000   ₩8,400    ₩3,600       │
│  일반혈액검사(CBC)  1    급여   ₩8,000    ₩5,600    ₩2,400       │
│  아모디핀 5mg      30일  급여   ₩15,000   ₩10,500   ₩4,500       │
│  ──────────────────────────────────────────                         │
│  급여 소계                      ₩35,000   ₩24,500   ₩10,500       │
│  비급여 소계                    ₩0                   ₩0            │
│  합계                           ₩35,000   ₩24,500   ₩10,500       │
│                                                                      │
│  결제수단: [● 카드  ○ 현금  ○ 계좌이체  ○ 미수  ○ 예치금 차감]   │
│  카드 승인번호: [____________]                                       │
│  현금영수증: [○ 소득공제  ○ 지출증빙  ○ 미발행]                   │
│  결제금액: [₩10,500]                                                │
│                                                                      │
│  [수납 완료]  [수납 보류]  [수납 취소]                                │
│  [영수증 출력]  [처방전 출력]  [세금계산서]                           │
│  [분할 납부 설정]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Phase 4: 미수금 관리 + 일일 정산 + 예치금 (난이도: 낮음~중간)

**미수납 관리 탭:**

```
┌─ 미수납 관리 ──────────────────────────────────────────────────────┐
│  환자명     날짜         금액      사유         분할여부     작업    │
│  홍길동    2026-05-15  ₩25,000  보험 대기     -          [수납]   │
│  최순자    2026-05-18  ₩8,000   카드 오류     -          [수납]   │
│  박영희    2026-05-10  ₩120,000 경제적 사유   3회 분할    [납부]   │
│                                                                    │
│  미수금 합계: ₩153,000  (3건)  │  분할 진행: 1건                  │
│  [독촉 문자 발송]  [미수금 보고서]                                 │
└────────────────────────────────────────────────────────────────────┘
```

**분할 납부 상세:**

```
┌─ 분할 납부 상세 — 박영희 ────────────────────────────┐
│  원래 금액: ₩120,000  │  분할: 3회  │  상태: 진행중  │
│                                                       │
│  회차  금액      납부일       상태    작업             │
│  1/3  ₩40,000  2026-05-10   납부완료  -               │
│  2/3  ₩40,000  2026-06-10   대기     [납부 처리]      │
│  3/3  ₩40,000  2026-07-10   대기     -                │
│                                                       │
│  납부 진행률: 33% (₩40,000 / ₩120,000)              │
└───────────────────────────────────────────────────────┘
```

**일일 정산 탭:**

```
┌─ 일일 정산 (2026-05-20) ────────────────────────────────┐
│                                                          │
│  총 수납 건수: 23건                                      │
│  총 매출: ₩2,450,000                                    │
│                                                          │
│  결제수단별:                                             │
│  ├── 카드:     ₩1,850,000 (18건)                        │
│  ├── 현금:     ₩350,000  (3건)                          │
│  ├── 계좌이체: ₩200,000  (1건)                          │
│  └── 예치금:   ₩50,000   (1건)                          │
│                                                          │
│  보험유형별:                                             │
│  ├── 건강보험: ₩2,100,000 (20건)                        │
│  ├── 의료급여: ₩150,000  (2건)                          │
│  └── 자비:     ₩200,000  (1건)                          │
│                                                          │
│  급여/비급여:                                            │
│  ├── 급여:     ₩2,200,000                               │
│  └── 비급여:   ₩250,000                                 │
│                                                          │
│  환불: ₩0 (0건)  │  취소: ₩0 (0건)                     │
│  미수 발생: ₩0 (0건)  │  분할 납부 회수: ₩40,000 (1건) │
│  세금계산서: 0건                                         │
│                                                          │
│  [마감 확인]  [인쇄]  [CSV 다운로드]                     │
└──────────────────────────────────────────────────────────┘
```

**예치금 관리 탭:**

```
┌─ 예치금 관리 ───────────────────────────────────────────┐
│  환자명     유형      입금액     잔액       날짜    작업  │
│  이철수    입원예치  ₩500,000  ₩350,000  05-18  [환불] │
│  김미영    선납     ₩100,000  ₩100,000  05-19  [환불] │
│                                                          │
│  총 예치금: ₩600,000  │  총 잔액: ₩450,000             │
│  [예치금 등록]                                           │
└──────────────────────────────────────────────────────────┘
```

### Phase 5: 여정 연동 + 퇴원 (난이도: 중간)

**여정 이벤트 흐름:**

```
ENCOUNTER_SIGNED → BILLING_CREATED (수납 대기열 등록)
  → CASHIER_CALLED (수납 호출)
  → BILLING_PAID (수납 완료)
  → PHARMACY_WAITING (처방 있을 때) 또는 VISIT_COMPLETED (처방 없을 때)
  → PHARMACY_DISPENSED (약 수령)
  → VISIT_COMPLETED (퇴원)
```

### Phase 6: 청구 모듈 통합 (난이도: 낮음)

**claim / insurance-claim 컨트롤러 통합:**

동일 경로 `/api/v1/claims`에 2개 컨트롤러가 등록되어 라우트 충돌 가능.

```
중복 API (3개):
├── create  — claim.generate() vs insurance-claim.create()
├── submit  — claim.submit() vs insurance-claim.submit()
└── review  — claim.review() vs insurance-claim.review()

claim 고유 (4개 — 유지):
├── findAll (목록 + 페이지네이션)
├── getSummary (월별 요약)
├── generateHiraXml (개별 XML)
└── generateBatchHiraXml (일괄 XML)

insurance-claim 고유 (4개 — claim에 병합):
├── getQueue (청구 대기열)
├── getPatientHistory (환자별 이력)
├── recordPayment (지급 기록)
└── updateClaimData (청구 데이터 수정)
```

**통합 방향:**
1. `claim` 모듈에 insurance-claim 고유 4개 API 병합
2. 중복 3개는 claim 버전 유지 (더 완성도 높음)
3. `insurance-claim` 모듈 삭제
4. DTO는 insurance-claim의 것이 더 정교하므로 이관

---

## 5. 구현 우선순위

| Phase | 항목 | 난이도 | 예상 | 의존성 |
|:-----:|------|:------:|:----:|--------|
| 1 | 데이터 모델 확장 (결제수단/환불/미수/예치금/분할/급여구분) | 낮음 | 2h | - |
| 2 | 수납 자동 생성 + API 확장 (13개) — EventEmitter2 기반 | 중간 | 4h | Phase 1 |
| 3 | 수납 대시보드 개편 (4탭 + 급여/비급여 구분) | 중간 | 4h | Phase 2 |
| 4 | 미수금 관리 + 분할 납부 + 예치금 + 일일 정산 | 중간 | 3h | Phase 3 |
| 5 | 여정 연동 + 퇴원 프로세스 | 중간 | 2h | Phase 2 |
| 6 | 청구 모듈 통합 (claim + insurance-claim 병합) | 낮음 | 1h | - |

**총 예상: 16시간 (6 Phase)**

---

## 6. 비기능 요구사항

| 항목 | 요구 |
|------|------|
| 실시간성 | 수납 대기열 10초 자동 갱신 (TanStack Query refetchInterval) |
| 동시성 | 동일 수납 건 중복 처리 방지 (Prisma optimistic lock — version 필드) |
| 보안 | 수납: ADMIN/NURSE, 환불/취소: ADMIN만, 예치금 환불: ADMIN만 |
| 감사 | 수납/환불/취소/미수/분할/예치금 모든 행위 audit 기록 |
| 출력 | 영수증 A4, 처방전 A5, 세금계산서 A4, CSS @media print |
| 금액 정확성 | 원 단위 반올림, Int (Prisma), 급여/비급여 소계 별도 |
| 이벤트 | encounter.signed → billing 자동 생성 (EventEmitter2, 순환의존 방지) |
| 상태확장 | WaitingQueue status는 VarChar(20) — 마이그레이션 없이 추가 가능 |

---

## 7. 연관 시스템

| 시스템 | 연동 포인트 |
|--------|------------|
| encounter | 서명 시 EventEmitter2로 billing 자동 생성 트리거 |
| waiting-queue | 수납 대기 상태 관리 (VarChar → CASHIER_WAITING 등) |
| journey | 여정 이벤트 발행/추적 |
| pharmacy | 수납 완료 → 약국 대기열 연동 |
| portal | 환자 포털 수납 이력 + 예치금 잔액 조회 |
| inpatient | 입원 예치금 관리 연동 |
| floor/metaverse | 수납 창구 위치 안내 |
| executive | 경영 대시보드 매출 + 급여/비급여 비율 |
| audit | 수납/환불/취소/예치금 감사 추적 |

---

## 8. BillingStatus 확장

```
현재: PENDING | PAID | PARTIAL | CANCELLED

확장:
PENDING     — 미수납 (자동 생성 직후)
PAID        — 수납 완료
PARTIAL     — 부분 수납
DEFERRED    — 수납 보류 (미수)
CANCELLED   — 수납 취소 (미수납 상태에서 원복)
REFUNDED    — 환불 완료 (수납 후 전액 반환)
INSTALLMENT — 분할 납부 진행 중
```

---

## 9. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-05-09 | 초기 기획 — 수납 워크플로우 + 환자 퇴원 |
| v2 | 2026-05-20 | 종합 기획서 — 현행 분석 + 6 Phase |
| v3 | 2026-05-20 | 검토 반영 — 순환의존 해소(EventEmitter2), 분할납부, 예치금, 급여/비급여, 세금계산서, 취소/환불 구분, claim 통합 상세 |
