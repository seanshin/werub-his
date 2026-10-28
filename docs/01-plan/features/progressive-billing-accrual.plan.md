# 진료비 단계적 발생 (Progressive Billing Accrual) — 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/billing/billing-accrual.listener.ts · apps/api/src/modules/billing/billing.module.ts:8 · 잔여: 없음

> 작성일: 2026-06-11 · 상태: Plan · 레벨: Enterprise
> 한 줄: **진료 서명 시 일괄이 아니라, 행위(오더)가 시행될 때마다 진료비 라인을 증분 발행하고 ERP가 누적**하여, 환자여정 전 단계에서 진행 진료비를 실시간 표시한다.

---

## 1. 배경 · 문제

현 구조는 **`encounter.signed` 시점에 `createFromEncounter`가 진료비를 일괄 생성·발행**(billing.service.ts:126·251)한다. 따라서:
- 접수·진료중·검사대기 단계에는 진료비가 **0/미표시**, 진료 서명 시점에 **금액이 통째로 점프**.
- 의료기관 현실(검사·처치·투약이 **반복 시행**, 외래 다회 오더, **입원은 일별 누적**)과 맞지 않음.
- 환자여정 관제 콘솔의 "중간 진료비"가 사실상 정산 직전에만 의미.

## 2. 목표 (Goals)
| # | 목표 |
|---|------|
| G1 | 행위(오더) **시행 시점마다** 진료비 라인 증분 발행 → ERP 누적 → **진행 진료비 실시간** |
| G2 | **반복 시행**(다회 검사·처치)을 각 시행 단위 라인으로 자연 누적 |
| G3 | **입원 일별 정액**(입원료·식대·간호관리료) 자정 배치 발생 + 검사·처치·투약 즉시 |
| G4 | **발생(accrual) ↔ 정산(settlement) 분리** — 이중 과금 없이 정산 확정 |
| G5 | 진료비 **책정·누적 SoT = ERP**(D-6 유지). HIS는 "무엇을·언제 했는가" 발행만 |

## 3. 비목표
- HIS가 진료비 금액을 **누적 계산**(누적은 ERP). HIS는 라인 발행·정산 스냅샷만.
- 수가 마스터/룰 변경. 비급여 책정(ERP SoT 이관 중).

## 4. 과금 모델 (실측 기반)
- **과금 단위 = `Prescription`(오더)** — 이 시스템에서 약·검사·영상·처치 오더가 모두 Prescription(medicationCodeId | procedureCodeId)로 표현됨. + **진찰료**(AA157 초진/AA257 재진) 1회.
- 완료/시행 이벤트(이미 존재): `dispensing.completed`(약), `lab.result.completed`(검사), `imaging.result.reported`(영상) — 모두 `orderId`(=prescriptionId)·`patientId` 보유.

## 5. 핵심 설계 (방식 A)

### 5.1 발생(accrual) 트리거
| 행위 | 발행 시점 |
|------|-----------|
| 진찰료 | 진료 시작(encounter open / 첫 오더) 시 1회 |
| 검사 | `lab.result.completed` |
| 영상 | `imaging.result.reported` |
| 투약/조제 | `dispensing.completed` |
| 처치·주사·수술 | 시행 확정 이벤트(없으면 오더 확정 시) |
| 입원 일별(입원료·식대·간호) | **자정 배치**(0시, census와 동일 기준) |

> 원칙: **오더 생성 ≠ 과금**, **시행/완료 = 과금**. 미시행 오더는 미과금(취소 시 영향 없음).

### 5.2 멱등 ref (정정/반복)
- `ref = bline:{encounterId}:{prescriptionId}`(시행 단위). **반복 시행은 prescription이 각각**이라 자연히 별도 라인.
- 입원 일별: `ref = bline:adm:{admissionId}:{YYYYMMDD}:{code}`.
- 취소/정정: `cancelled=true` 동일 ref 재송신(기 구현).

### 5.3 발생 ↔ 정산 분리 (이중 과금 방지 — 핵심)
- **발생**: 시행 이벤트 → `billing.line_recorded`(prescription-ref). ERP 누적.
- **정산**: `createFromEncounter`(외래 수납) / 퇴원(입원)을 **"이미 누적된 라인의 최종 확정 Billing 생성"으로 재정의**. 
  - 확정 Billing의 BillingItem은 **동일 prescription-ref**를 사용 → **재발행 시 ERP가 멱등 무시**(이중 과금 X).
  - 즉 발행 ref 체계를 BillingItem.id → **prescriptionId 기준으로 통일**.

### 5.4 중앙 accrual 리스너 (결합도 최소)
- 신규 `BillingAccrualListener`가 완료 이벤트 구독 → `emitAccrualLine(prescriptionId)` 1건 발행. 각 오더 모듈은 billing 무지.

### 5.5 콘솔 연동
- 보드 `unpaid` 소스를 **"ERP 누적 interim(진행중) + 확정 Billing(정산후)"** 합산 → 접수~검사~수납 단계마다 진행 진료비 표시.
- 드릴다운 ERP invoice는 이미 누적분 반영(interim).

## 6. 결정 필요 (운영·임상·ERP 합의)
1. **과금 시점**: 시행 시작 vs 결과 완료 (기본: 결과/완료 이벤트 채택). 일부 항목 예외?
2. **입원 일배치 시각**: 0시(census 정합) 권장.
3. **진찰료 발행 시점**: encounter open vs 첫 오더 vs 서명. (권장: 진료 시작)
4. **ERP 누적 정합**: ERP가 prescription-ref 누적 + 정산 시 동일 ref 멱등 — **ERP 협의 필수**.
5. **기존 일괄 발행 제거**: `createFromEncounter`의 emit을 발생분과 중복 안 되게 재정의.

## 7. 단계 로드맵
| Phase | 내용 |
|-------|------|
| P1 | ref 체계 통일(prescriptionId) + `emitAccrualLine` + 단일 완료이벤트(검사) PoC |
| P2 | 완료 이벤트 전 채널(약·영상·처치) accrual 리스너 |
| P3 | 입원 일별 배치(입원료·식대·간호) |
| P4 | 정산 재정의(createFromEncounter 중복 제거) + 멱등 검증 |
| P5 | 콘솔 보드 "진행중+확정" 합산 표시 |

## 8. 리스크
- **이중 과금**: 발생/정산 ref 불일치 시 → ref 통일 + ERP 멱등으로 차단(P4 검증 필수).
- **정정 흐름**: 오더 취소/결과정정 시 cancelled 재송신 누락 → 과대 청구. 취소 이벤트 구독 필수.
- **ERP 누적 합의**: ERP invoice가 prescription-ref 누적·정산 멱등을 지원해야 함(협의).

## 9. ERP 협의 사항
- billing.line_recorded를 **시행 시점 증분 수신** + prescription-ref 멱등 누적 가능 여부.
- 정산(확정 Billing) 시 동일 ref 재수신 → 무시(이중 방지) 동작 확인.
- interim invoice가 누적 라인 실시간 반영하는지.

---
### 다음
- 승인 시 → `/pdca design progressive-billing-accrual`(ref 통일 스키마·accrual 리스너·정산 재정의·배치·멱등 시퀀스). **ERP 협의(§9) 선행 권장**.
