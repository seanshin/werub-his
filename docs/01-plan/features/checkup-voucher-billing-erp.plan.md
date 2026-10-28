# 건강검진권 — HIS 수납 통합 & ERP 딜러·거래 상세 관리 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:13680 model VoucherRedemption · apps/api/prisma/schema.prisma:13702 model BillingPayment · apps/api/prisma/schema.prisma:13783 model VoucherAllocation · 잔여: DA-1~4 수납 정책 · B-G1 ERP event_type 합의 · DB-1~4 세무·환율·지급(사람); LEGAL_FLOORS 잠정값 법무 확정(사람)

> 작성일: 2026-06-18 · 상태: REVIEWED(design-validator 82/100) → A1 착수 · 후속: design → do
> 범위: 검진권을 (A) **HIS 수납에서 실제 결제수단으로 처리**, (B) **ERP에서 딜러·거래를 상세 관리**
> 상위 문서: checkup-voucher-blockchain.{plan,design} · checkup-voucher-purchase-flow.design
> 코드 grounded: 2026-06-18 현재 운영 배포본 기준

---

## 0. 배경 — 왜 두 축으로 나누는가

검진권은 **두 세계**에서 처리되어야 한다.

| 축 | 주체 | 처리 내용 | 회계 의미 |
|----|------|-----------|-----------|
| **A. HIS 수납** | 병원 원무/검진센터 | 환자가 검진권으로 **결제**, 잔액·차액·환불 관리 | 매출 인식(검진 수익) |
| **B. ERP 딜러** | 본사 재무/정산 | 딜러 **거래처·매입·재판매·수수료·정산(AP)** | 매입원가·수수료·지급채무 |

현재 상태(grounded):
- 검진권 **발행·유통·재판매·활성화·상환**의 상태머신은 완성(P1~P4 + 구매흐름 G1/G2).
- 그러나 **redeem(상환)이 HIS Billing과 단절** — `voucher.service.ts:150` redeem은 잔액만 차감하고 `billing.line_recorded` outbox만 발행, **실제 수납 화면(Billing.pay)에서 검진권을 쓸 수 없음**(직원보조 EP `POST /voucher/vouchers/:serial/redeem`만 존재).
- ERP로는 거래 라인(resale/commission/redeem/topup/refund/settlement) + 딜러 마스터(vendor.synced/changed)가 발행되나, **선결제 매입(allocate) 미발행·원천징수 미계산·환율(fxRate) 미사용·AR 미추적** 등 정산 디테일이 비어 있음.

→ A축은 "환자 결제 경험", B축은 "본사 정산 회계"로 **목적·데이터·담당이 다르므로** 별도 기획한다.

---

## 0-1. 검토 반영 (design-validator 82/100, 2026-06-18) + 결정

**확정 결정**:
- **DEC-1 복합결제 데이터 모델 = `BillingPayment` 분할라인 신규** — 결제건당 다중 라인(검진권+카드+현금), 이중계상 근본해소·일마감 정확.
- **DEC-2 A1 범위 = 충당+차액 복합결제** — 잔액<검진가면 검진권 충당 후 잔여를 카드/현금 추가결제(PARTIAL→PAID). **환불·취소 정합(C-3/C-4)은 A2 이연**.
- **DEC-3 DA-1 = 비급여 클램프 기본값** — 검진권은 비급여 한정 발행(voucher.service:44)이라 "전액 본인부담=충당" 디폴트. A1 게이트 해제.

**validator 보완 반영(설계 단계 해소 항목)**:
- C-1: redeem DTO `visitId XOR billingId` 완화(둘 중 하나 필수) — A-4 반영.
- C-2: 멱등키 = `billingId + voucherSerial` 조합(복합결제 2회 호출 충돌 방지) — A-4 반영.
- C-3/C-4: 검진권 결제 취소·환불 4자 정합 + ledger `REVERSAL` 이벤트 → **신규 §A-7(A2)**.
- W-2/W-3: allocate emit은 커밋 후 + idempotent-return 경로 누락 방지 → B-3-1 반영.
- B-G1: **ERP 핸들러 합의는 B축(B1~B3) 전체 선결 게이트** — 미합의 시 발행 무의미.

**축 독립성**: A축(Billing/VoucherRedemption)·B축(Distributor/Settlement/Policy)은 데이터·배포 완전 독립 → 병렬 가능. A1은 B-G1과 무관하게 단독 착수.

---

# PART A. HIS 수납 통합 기획

## A-1. 현황 (grounded)

| 구성 | 위치 | 현재 |
|------|------|------|
| 수납 모델 `Billing` | schema.prisma:1308 | `paymentMethod String(20)`=CARD/CASH/TRANSFER/DEPOSIT, patientCopay·discountAmount·status(PENDING/PAID/PARTIAL/…) |
| 수납 처리 `pay()` | billing.service.ts:834 | 본인부담−감면 계산→PAID/PARTIAL, 결제수단 기록, 여정이벤트 |
| 청구 자동생성 | billing.service.ts:196 `createFromEncounter` | encounter.signed 이벤트→13개 법정 카테고리 BillingItem |
| 검진 연계 | `CheckupVisit`(schema:8458) | programId·encounterId·totalPrice, 검진완료→Encounter→Billing |
| 검진권 상환 | voucher.service.ts:150 `redeem` | balance 차감·VoucherRedemption(visitId)·outbox emit. **Billing 미연결** |
| 영수증 | billing.service.ts:794 `issueReceipt` | IssuedDocument 스냅샷·SHA256·QR |

**핵심 갭**: 검진권은 "제5의 결제수단"이어야 하나 `pay()`가 검진권을 모름. redeem과 Billing이 양방향 링크 없음. 액면 초과 차액(topup)이 별도 청구로 안 이어짐.

## A-2. 목표 흐름 (To-Be)

```
검진 완료 → Billing 생성(미수납, patientCopay=검진가)
   ↓ 원무 수납 화면
[결제수단 선택] → "검진권" 선택 → 보유/입력 시리얼 조회
   ↓
Billing.pay(method=VOUCHER, voucherSerial)
   ├─ VoucherService.redeem(serial, {billingId, actualPrice=patientCopay})  ← 양방향 링크
   ├─ useAmount = min(balance, patientCopay) 만큼 검진권 충당
   ├─ 잔여 부담액 = patientCopay − useAmount
   │     · 0 → Billing PAID (검진권 완납)
   │     · >0 → Billing PARTIAL → 추가 결제(카드 등)로 잔액 수납(복합결제)
   └─ 액면 초과(actualPrice>balance) → topup 차액을 별도 BillingItem/라인으로 환자 청구
   ↓
영수증: 결제수단=검진권 + 시리얼 + 충당액 + 차액 표시
```

## A-3. 데이터 모델 변경 (DEC-1: BillingPayment 분할라인)

```prisma
model BillingPayment {   // 신규 — 결제건당 다중 결제수단 라인(복합결제 SoT)
  id           String   @id @default(uuid()) @db.Uuid
  billingId    String   @map("billing_id") @db.Uuid
  method       String   @db.VarChar(20)   // CARD|CASH|TRANSFER|DEPOSIT|VOUCHER
  amount       Int                          // 이 수단으로 결제한 금액
  voucherSerial        String? @map("voucher_serial") @db.VarChar(40)
  voucherRedemptionId  String? @map("voucher_redemption_id") @db.Uuid
  cardApprovalNo       String? @map("card_approval_no") @db.VarChar(30)
  cashReceiptNo        String? @map("cash_receipt_no") @db.VarChar(30)
  processedBy  String?  @map("processed_by") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()
  billing      Billing  @relation(fields:[billingId], references:[id])
  @@index([billingId])
  @@map("billing_payments")
}
model Billing {
  // ...기존 유지...
  paymentMethod  String?  // 요약 라벨: 단일='VOUCHER'/'CARD', 복합='MIXED'
  // paidAmount = sum(payments.amount) 로 누적(분할라인이 SoT)
  payments       BillingPayment[]   // 역참조(신규)
}
model VoucherRedemption {
  // ...
  billingId  String?  @map("billing_id") @db.Uuid   // redeem→Billing 역링크(신규, visitId XOR billingId)
}
```
- 비파괴: BillingPayment 신규 테이블 + Billing/VoucherRedemption nullable 컬럼. manual SQL.
- paidAmount/status는 분할라인 합으로 갱신(매 pay 호출 누적). 기존 단일결제도 BillingPayment 1라인으로 표현.

## A-4. API/서비스 변경

| 변경 | 위치 | 내용 |
|------|------|------|
| `PayBillingDto` 확장 | billing/dto/pay-billing.dto.ts | `voucherSerial?`·`voucherId?` 필드 추가. paymentMethod enum에 VOUCHER |
| `BillingService.pay()` | billing.service.ts:834 | method=VOUCHER 분기 → VoucherService.redeem 호출, 충당/차액 계산, PARTIAL 복합결제 |
| **신규** `GET /billings/:id/payment-options` | billing.controller | 환자 보유 활성 검진권(boundPatientId) + 적용가능액 + 결제수단 목록 반환 |
| `VoucherService.redeem()` 시그니처 보강 | voucher.service.ts:150 | `billingId` 수용, VoucherRedemption.billingId 기록, 멱등키=billing 기반 |
| `issueReceipt()` 스냅샷 | billing.service.ts:811 | voucherSerial·voucherAmountUsed 포함 |
| 환불 연동 | billing.service.ts:989 `refund` | 검진권 결제 Billing 환불 시 → 검진권 잔액 복원 정책(부분/전액) 연계 |
| 일마감 집계 | billing.service.ts:1055 | 결제수단별 합계에 VOUCHER 라인 분리 |

## A-5. 모듈 의존성
- billing 모듈이 VoucherService(redeem) 호출 필요 → **순환참조 주의**: voucher 모듈은 billing(outbox)에 의존하지 않고 VoucherBillingService(outbox)만 사용. billing→voucher 단방향 의존으로 설계(VoucherModule이 VoucherService export 중). forwardRef 불요 예상(검증 필요).

## A-6. 엣지·정책 결정 필요(A)
- **DA-1** 검진권 결제 시 보험청구(Claim) 분리: 검진은 대개 비급여 100% 본인부담이나, 일부 급여 검진 항목이 섞이면 검진권 충당 범위(비급여만? 전체?) 결정.
- **DA-2** 차액(topup) 청구 주체: actualPrice>balance 시 차액을 환자에게 즉시 청구(복합결제) vs 별도 미수. 현재 redeem은 `TOPUP-` ref만 — 실제 BillingItem 생성 미연결.
- **DA-3** 검진권 환불 시 Billing 정합: 수납 후 검진권 결제 취소 → 잔액 복원 + Billing 환불 동시성.
- **DA-4** 부분 충당 후 복합결제 UX(검진권+카드) 영수증 표기 형식.

---

# PART B. ERP 딜러·거래 상세 관리 기획

## B-1. 현황 (grounded)

ERP(별도 infra-core)로 발행되는 것 / 빠진 것:

| 거래/마스터 | 발행 메서드 | ERP 이벤트 | 상태 |
|-------------|-------------|------------|------|
| 딜러 거래처 마스터 | distributor.service emitDealer | `vendor.synced`/`vendor.changed`(domain voucher→finance) | ✅ 발행(2026-06-18) |
| 재판매 매출 | voucher-trade.sell | `billing.line_recorded` lineType=resale | ✅ |
| 수수료(+) | sell | lineType=commission | ✅ |
| 수수료 회수(−) | settlement.refund | lineType=commission(clawback) | ✅ |
| 검진권 사용 수익 | voucher.redeem | lineType=redeem | ✅ |
| 액면 초과 | redeem | lineType=topup | ✅ |
| 소비자 환급 | settlement.refund | lineType=refund | ✅ |
| 딜러 정산 | settlement.generate | lineType=settlement(net payable) | ✅ |
| **선결제 매입(allocate)** | voucher-trade.allocate | ❌ **미발행** | **누락** |
| **하위배분(sub-allocate)** | allocate(DISTRIBUTOR) | ❌ 미발행 | **누락** |
| **원천징수(국내 딜러)** | — | ❌ 미계산 | **누락** |
| **환율 스냅샷(외화)** | settlement(fxRate=null) | ❌ 미포함 | **누락** |
| **선결제 AR/지급 AP 추적** | paymentRef(문자열만) | ❌ 미링크 | **누락** |

webhook 계약: `POST {erp}/api/v1/integrations/his/finance/webhook` body=`{event_type, event_id, source_ref, payload}`. ERP ALLOWED_DOMAINS=finance/materials/assets/procurement/hr. `erp.webhookEnabled` ON일 때만 큐잉(integration-outbox.service.ts:40).

## B-2. ERP 측이 관리해야 할 딜러 회계 모델(목표)

ERP가 검진권 딜러를 **거래처(Vendor/Partner)**로 두고 다음을 관리:
1. **거래처 마스터**: 딜러 식별·유형(국내/해외)·수수료율·등록/계약·은행/송금정보·세무구분.
2. **매입(AP↔재고)**: 병원→딜러 선결제 매입(딜러가 병원에 선지급) — ERP 관점 병원은 **선수금(부채)**, 딜러는 매입.
3. **매출(AR)**: 딜러→환자 재판매 — 병원 수취 수수료는 **수익**, 딜러 매출은 딜러 장부.
4. **수수료 정산(AP)**: 딜러에게 지급할 net payable — 원천징수(국내)·외화송금(해외) 처리.
5. **자금흐름**: 선결제 입금 → 검진 사용(수익인식) → 정산 지급의 매칭.

## B-3. 보완 발행 항목(HIS→ERP)

### B-3-1. 선결제 매입(allocate) 이벤트 신규
`voucher-trade.allocate()`에 매입 이벤트 추가:
```
lineType=purchase(병원→딜러) / sub_purchase(딜러→하위)
payload: { allocationId, fromType, fromId, toDistributorId, quantity, supplyPrice,
           totalAmount=supplyPrice*quantity, paymentRef, paidAt, currency, dealerType }
```
→ ERP가 선결제(딜러 선지급=병원 선수금) AR/선수금 인식. 현재 완전 누락된 핵심 갭.

### B-3-2. 정산 payload에 세무·환율 보강
`settlement` payload 확장:
```
+ withholdingTax: 국내(DOMESTIC) 딜러 commissionTotal × 원천징수율(잠정 3.3%) — 법무 확정 후 교체
+ netPayableAfterTax: netPayable − withholdingTax
+ fxRate: 외화(해외) 딜러 정산 시 환율 스냅샷(소스·시점 정의 필요)
+ payableCurrency / baseCurrency(KRW)
+ taxInvoiceRequired: 국내 세금계산서 발행 대상 여부
```

### B-3-3. 딜러 마스터 보강(송금/세무)
`vendor.synced` payload에 추가(현재 없음):
```
+ bankInfo(해외 송금 SWIFT/IBAN·국내 계좌) — 별도 입력 필드/모델 필요
+ taxId(사업자번호/TIN)
+ withholdingApplicable: dealerType==DOMESTIC
```
→ Distributor 모델에 `bankInfo Json?`·`taxId String?` 추가(신규 컬럼).

## B-4. 데이터 모델 변경(B)
```prisma
model Distributor {
  // ...
  taxId     String?  @map("tax_id") @db.VarChar(40)   // 사업자번호/TIN(원천징수·세금계산서)
  bankInfo  Json?    @map("bank_info")                // 송금정보(국내 계좌/해외 SWIFT)
}
model VoucherSettlement {
  // ...
  withholdingTax     Int?    @map("withholding_tax")     // 국내 원천징수액
  netPayableAfterTax Int?    @map("net_payable_after_tax")
  fxRate             Float?  // 기존 존재 — 외화 정산 시 채움
  paidAt             DateTime? @map("paid_at")           // ERP 지급 완료 회신(역동기화)
  erpVoucherRef      String? @map("erp_voucher_ref")     // ERP 전표 번호 회신
}
model VoucherPolicy {
  // ...
  domesticWithholdingRate Int @default(3) @map("domestic_withholding_rate")  // 국내 원천징수율(%)·잠정
}
```

## B-5. 정산 지급 양방향(ERP→HIS 회신)
- 현재 outbox는 HIS→ERP 단방향. 정산 **지급 완료(PAID)**는 ERP가 실행 → ERP→HIS 웹훅(또는 폴링)으로 `settlement.paid` 회신받아 `VoucherSettlement.status=PAID`·paidAt·erpVoucherRef 기록.
- ERP-access-sync(erp-access-sync.service.ts) 또는 신규 인바운드 EP 설계 필요.

## B-6. ERP 측 핸들러 계약(infra-core 협의 필요)
HIS는 다음 event_type을 finance 웹훅으로 발행 → ERP가 수신 핸들러 구비해야 실제 처리:
| event_type | ERP 처리 |
|------------|----------|
| vendor.synced / vendor.changed | 거래처 마스터 upsert(국내/해외·수수료·세무) |
| billing.line_recorded(lineType=purchase) | 선결제 매입/선수금 |
| …(resale) | 재판매 매출/수수료 수익 |
| …(commission) | 수수료(±clawback) |
| …(settlement) | AP 정산전표(원천징수·외화) |
| …(refund/topup/redeem) | 환급·차액·수익인식 |
→ **게이트 B-G1**: ERP 측 event_type 처리 스펙 합의(현재 HIS는 발행만, ERP 핸들러 미확인).

## B-7. 정책 결정 필요(B)
- **DB-1** 국내 원천징수율·세금계산서 발행 주체(병원 발행? 딜러 발행?) — 세무 자문.
- **DB-2** 외화 환율 소스(BOK 기준환율/실적환율)·적용 시점(정산 산출/확정/지급).
- **DB-3** 선결제 매입의 회계 처리(병원 선수금 vs 딜러 매입) ERP 계정 매핑.
- **DB-4** 정산 지급 실행 주체·승인 단계(ERP AP 워크플로우 vs HIS 4-eyes 후 ERP 자동).

---

## C. 통합 데이터 모델 변경 요약(마이그레이션)

| 테이블 | 컬럼 | 축 | 비고 |
|--------|------|----|------|
| Billing | voucher_redemption_id, voucher_amount_used | A | 수납↔상환 링크 |
| VoucherRedemption | billing_id | A | 역링크 |
| Distributor | tax_id, bank_info | B | 세무·송금 |
| VoucherSettlement | withholding_tax, net_payable_after_tax, paid_at, erp_voucher_ref | B | 정산 세무·지급회신 |
| VoucherPolicy | domestic_withholding_rate | B | 원천징수율 |

모두 비파괴 ADD COLUMN. 기존 패턴대로 `prisma/manual/*.sql` + db execute(서버 procedure_codes 무드리프트 확인됨).

## D. 단계별 로드맵

| Phase | 내용 | 산출 |
|-------|------|------|
| **A1** | 수납 결제수단 VOUCHER — pay() 검진권 분기·redeem 양방향 링크·payment-options EP | 환자가 수납에서 검진권 사용 |
| **A2** | 차액(topup) 청구·복합결제·영수증 반영·환불 정합 | 수납 완결 |
| **B1** | 선결제 매입(allocate) ERP 발행·하위배분 발행 | 매입 거래 ERP 가시화 |
| **B2** | 정산 세무(원천징수)·환율 보강·딜러 송금/세무 마스터 | AP 정산 디테일 |
| **B3** | 정산 지급 ERP→HIS 회신(settlement.paid)·전표번호 | 양방향 정합 |
| **G** | ERP 측 핸들러 합의(B-G1)·세무 자문(DB-1~2)·법무(원천징수율) | 게이트 |

## E. 비범위(이번 기획 외)
- ERP 내부 회계 전표·재무제표 로직(infra-core 책임).
- 실 PG 결제(G3)·외부 퍼블릭체인 앵커.
- 다국어 딜러 포털·claim 무차별 대입 잠금(별도 후속).

## F. 검토 체크리스트
- [ ] billing→voucher 모듈 의존(순환참조) 검증
- [ ] DA-1~4 수납 정책 결정
- [ ] B-G1 ERP event_type 핸들러 합의
- [ ] DB-1~4 세무·환율·지급 워크플로우 결정
- [ ] LEGAL_FLOORS 잠정값(수수료 상한·원천징수율) 법무 확정
