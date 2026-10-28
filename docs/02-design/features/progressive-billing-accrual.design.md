# 진료비 단계적 발생 — 설계서 v1.0

> 작성일: 2026-06-11 · 상태: Design · 기반: [기획서 v1.0](../../01-plan/features/progressive-billing-accrual.plan.md)
> 핵심: **발생/정산을 prescription 기반 stable ref로 통일** → 시행 시점 증분 발행 + 정산 재발행이 **ERP 멱등(106/106 확인)으로 자동 정합**(이중과금 차단).

---

## 0. 설계 원칙
- HIS는 **행위 발생 이벤트마다 라인 1건 발행**, 누적·책정은 ERP(D-6 SoT).
- **ref = `bline:{encounterId}:rx:{prescriptionId}`** 로 통일 → 발생·정산 동일 ref → ERP 멱등 dedup.
- 기존 `billing.line_recorded` 페이로드/계약 **무변경**(발행 빈도·시점만 변경).

## 1. ref 통일 규칙
| 라인 | ref |
|------|-----|
| 처방/검사/영상/처치(Prescription) | `bline:{encounterId}:rx:{prescriptionId}` |
| 진찰료 | `bline:{encounterId}:consult` |
| 입원 일별 정액 | `bline:adm:{admissionId}:{YYYYMMDD}:{code}` |
- 취소/정정: 동일 ref + `cancelled=true` 재송신.

## 2. 스키마 변경 (최소)
```prisma
model BillingItem {
  // ...
  sourcePrescriptionId String? @map("source_prescription_id") @db.Uuid // 정산-발생 ref 정합
  @@index([sourcePrescriptionId])
}
```
- 정산(`createFromEncounter`)이 각 BillingItem에 출처 prescriptionId 기록 → emit 시 동일 ref 생성.
- (입원 일별 라인은 BillingItem 비매핑, 배치가 직접 발행.)

## 3. 발생(accrual) — `emitAccrualLine(prescriptionId, cancelled=false)`
신규 `BillingService.emitAccrualLine`: prescription 1건 → 라인 1건 outbox 발행.
```
1. Prescription + encounter(patient.insuranceType·visitType·doctor·dept) 조회
2. 코드 해석: procedureCodeId→ProcedureCode.code / medicationCodeId→MedicationCode.code
3. unitPrice·copayRate(코드 마스터), count=quantity, coverage=patient.insuranceType(raw)
4. ref=bline:{encounterId}:rx:{prescriptionId} 로 enqueue('billing','billing.line_recorded', ref, payload)
```
- payload는 기존 buildLines 라인과 **동일 스키마**(chartNo·code·codeType·count·unitPrice·amount·coverage·copayRate·cancelled…).

### 3.1 트리거 — `BillingAccrualListener`(신규)
| 이벤트 | 동작 |
|--------|------|
| `lab.result.completed` | `emitAccrualLine(orderId)` |
| `imaging.result.reported` | `emitAccrualLine(orderId)` |
| `dispensing.completed` | `emitAccrualLine(orderId)` |
| 처치·주사·수술 시행 확정 | `emitAccrualLine(prescriptionId)` (해당 이벤트 신설/구독) |
| `order.cancelled` | `emitAccrualLine(prescriptionId, cancelled=true)` |
| 진찰료 | encounter open(또는 첫 오더) 시 `emitConsultLine(encounterId)` 1회 |
> `orderId === prescriptionId`(실측: lab/imaging/pharmacy 이벤트의 orderId가 prescription 참조).

## 4. 입원 일별 정액 — **ERP 책정(census 기반)** 으로 정정 (v1.1)
> 검토 결과: HIS에 **병실등급(roomType/grade) 필드 부재** + 입원료 EDI 코드 4043개(종별·등급·간호등급 의존) → HIS가 코드 추정 발행은 부정확·이중 위험.
> ERP는 이미 **census(0시 재원, 제공됨)** + 간호등급 로직 + 종별을 보유한 책정 SoT.

- **입원료·간호관리료·식대 일별 정액 = ERP가 census + 병실정보로 책정**(HIS 일배치 미발행).
- HIS 제공분: ① **census**(제공 완료) ② 필요 시 **병실등급/식이 일별 상세 EP**(ERP가 입원료 책정에 필요로 하면 추가).
- 입원 **시행분(검사·처치·투약)** 은 §3 발생(P2)으로 이미 즉시 발행 → 입원 진료비도 시행 누적은 동작.
- ▶ ERP 협의(아래): ERP가 census로 **입원료 라인을 invoice에 생성**하는가, 아니면 HIS 추가 제공(병실등급)이 필요한가.

## 5. 정산 재정의 (이중과금 차단 핵심)
- `createFromEncounter`(외래 수납)/퇴원(입원): **확정 Billing 생성** + 각 BillingItem에 `sourcePrescriptionId` 기록.
- `buildLines`/`emitBillingLines`: lineId/ref를 **`sourcePrescriptionId` 우선**(없으면 consult/기존 item.id) → **발생과 동일 ref** → ERP가 멱등 무시(재집계 X, 최종 금액 재확인만).
- 즉 **발생 라인 = 정산 라인 = 동일 ref**. ERP는 마지막 수신값으로 확정.

## 6. 콘솔 연동
- 드릴다운: ERP `getErpInvoice(interim)` 이미 누적 반영(무변경).
- 보드(ERP 무호출): `unpaid` = **확정 Billing 미수납** + (옵션) HIS accrual 합계.
  - v1: 보드는 확정 Billing 기준 유지 + 드릴다운에서 진행 누적 표시.
  - v2(선택): HIS `BillingAccrual` 경량 원장(encounter별 누적합) → 보드 진행중 금액. 

## 7. 시퀀스 (외래)
```
접수 → 진료중 ─(검사오더)─→ lab.result.completed ─emitAccrualLine→ 라인(rx:P1) ─ERP누적
              ─(영상)──────→ imaging.result.reported ─→ 라인(rx:P2)
진료 서명 → createFromEncounter(확정 Billing, item.sourcePrescriptionId=P1,P2)
          → emitBillingLines(동일 ref rx:P1,P2) → ERP 멱등 무시(이중X) → 정산 확정
수납 → balanceDue 정산
```

## 8. 멱등·정합 검증 (P4 필수)
- 동일 prescription 발생+정산 → ERP에 **라인 1건만**(ref 동일). E2E로 검증(발생→정산 후 invoice 합계 == 단일 계산).
- 취소: order.cancelled → cancelled 라인 → ERP 차감.
- 입원 일배치 재실행 → 동일 ref 무중복.

## 9. 구현 순서
| Phase | 내용 |
|-------|------|
| P1 | 스키마(`sourcePrescriptionId`) + `emitAccrualLine`/`emitConsultLine` + ref 통일(buildLines sourcePrescriptionId 우선) |
| P2 | `BillingAccrualListener`(lab/imaging/dispensing/cancel) + 진찰료 발행 |
| P3 | ~~입원 일별 배치~~ → **ERP census 책정으로 정정**(§4). 필요 시 병실등급 상세 EP만 추가 |
| P4 | 정산 재정의 + 멱등 E2E(발생↔정산 이중과금 0 검증) |
| P5 | (선택) HIS accrual 원장 + 콘솔 보드 진행중 금액 |

## 10. 리스크·전제
- **ERP 협의**: 시행 시점 증분 수신 + ref 멱등 누적 + 정산 동일 ref 무시 — ERP가 이미 ref 멱등(106/106) 동작하므로 **계약 무변경으로 충족 예상**(발행 빈도만 증가). ERP 확인 권장.
- 코드 마스터 단가/copayRate가 prescription 시점에 결정 가능해야(진찰료·일부는 규칙). 미결 시 unitPrice 폴백(제안B) 활용.

---
### 다음
- 승인 시 구현 P1 착수. ERP에 §10 협의(발행 빈도 증가·멱등) 통지.
