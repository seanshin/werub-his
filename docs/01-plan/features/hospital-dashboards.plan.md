# 원내 대시보드 정보 체계 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/(main)/executive/page.tsx:88 · apps/api/src/app.module.ts:42 · 잔여: 화면별 1:1 대조 안 함

> **Feature**: hospital-dashboards
> **Version**: 1.0 (Plan)
> **Date**: 2026-06-22
> **Status**: Plan (설계 전 검토)
> **근거 조사**: 기존 모듈 `dashboard`·`executive`·`operational-stats`·`journey-console`·`qi`·`quality`·`chronic`(P2) + FE `/dashboard`(위젯·stores·hooks)·`/executive`·`/journey-console`

---

## 0. 목적
원내에서 **역할별로 즉시 의사결정에 쓰이는 정보**를 대시보드로 체계화한다. 신규 난립이 아니라 **기존 자산 인벤토리 → 갭/중복 정리 → 표준 정보 모델(대상×지표×데이터소스×실시간성) 정의 → 단계 구현**이 목표.

---

## 1. 현황 (기존 자산 인벤토리)

| 영역 | 위치 | 제공 정보 | 상태 |
|------|------|-----------|------|
| 메인 대시보드 | FE `/dashboard`(위젯·stores·hooks) | 위젯 51종·탭 설정·드래그(dnd-kit) | ✅ 구조 완성, **실데이터 연동 일부 백로그** |
| 경영진 | `executive` + `/executive`·`/executive/clinical` | overview·revenue(weekly/monthly)·departments·staff-summary·kpi·claims·alerts·clinical(overview/doctors/safety/infection/weekly-trend)·board | ✅ 광범위 |
| 운영 통계 | `operational-stats` | hourly·top-diagnoses·insurance-breakdown | ✅ |
| 환자 여정 | `journey-console`·`journey` | ward·admission-trends·patient-flow·disease·financial(집계) | ✅ EXECUTIVE 역할 |
| 질·안전 | `qi`·`quality` | QI 지표·질 관리 | ✅(부분) |
| 만성질환 | `chronic`(P2) `/chronic` | 코호트 최신값·조절상태·CDSS 경고 | ✅ 신규 완료 |
| 검진/청구 통계 | `/his-checkup/stats`·`/claims/stats` | 도메인 통계 | ✅ |

**관찰**: 경영/운영/임상 매크로 지표는 이미 풍부. **갭은 ① 실시간 운영(현재 시점) 보드 ② 부서/현장(간호 스테이션·약국·검사·응급) 실무 보드 ③ 데이터 신선도(실데이터 연동·갱신주기) ④ 단일 진입점(역할별 기본 대시보드 라우팅).**

---

## 2. 대상별 대시보드 (역할 기반)

| # | 대시보드 | 주 사용자(RBAC) | 성격 | 기존/신규 |
|---|----------|------------------|------|-----------|
| D1 | **경영 대시보드** | ADMIN·EXECUTIVE | 매크로·재무·KPI | 기존(executive) 정비 |
| D2 | **진료(과별) 대시보드** | DOCTOR·과장 | 외래/입원량·대기·진단분포·내 환자 | 부분→확장 |
| D3 | **간호 스테이션 보드** | NURSE | 병동 현황·V/S 경보·투약(MAR)·낙상/욕창 위험 | 신규(현장 실시간) |
| D4 | **원무·수납 보드** | ADMIN·RECEPTION·CASHIER | 접수/대기·수납 현황·미수·보험 | 부분→확장 |
| D5 | **병상·입원 보드** | ADMIN·NURSE·DOCTOR | 병상 가동률·입퇴원·전동·재원일 | journey-console 기반 |
| D6 | **응급(ED) 보드** | ADMIN·DOCTOR·NURSE | KTAS 분포·체류시간·재실·overcrowding | 신규 |
| D7 | **약국 보드** | PHARMACIST | 처방 대기·조제·DUR·재고 부족 | 부분→확장 |
| D8 | **검사·영상 보드** | LAB_TECH·DOCTOR | 오더 대기·TAT·위험값(critical)·판독 대기 | 부분→확장 |
| D9 | **감염·질·안전 보드** | ADMIN·감염관리 | 감염 지표·QI·환자안전 사건·지표 트렌드 | 기존(qi/quality) 정비 |
| D10 | **만성질환 관리 보드** | DOCTOR·NURSE | 코호트 조절상태·CDSS | ✅ 완료(P2) |

---

## 3. 정보 카테고리 & 핵심 지표(KPI)

> 각 지표는 **데이터소스(모델/모듈)** 와 **신선도**(🔴실시간 SSE / 🟡준실시간 폴링 / 🟢일배치 MV) 표기.

### D1 경영 대시보드
- 일/월 매출·수납률·미수금 🟢 (Billing·Claim) · 진료과별 수익 🟢 · 환자수(외래/입원/응급) 🟡 · 병상가동률 🟡 · 청구 반려율 🟢 · 인력 요약 🟢 (executive 기존 재사용)

### D2 진료(과별)
- 금일 예약/접수/대기 🔴 (WaitingQueue·Encounter) · 평균 대기시간 🟡 · 주요 진단 분포 🟢 (operational-stats top-diagnoses) · 미서명 차트 수 🟡 (Encounter status) · 내 환자 알림(위험값·결과도착) 🔴

### D3 간호 스테이션 (현장 실시간)
- 병동 환자 보드 🔴 (Admission·Bed) · **V/S 위험 경보** 🔴 (VitalSign·CriticalValue) · 투약 일정/지연(MAR) 🔴 (MedicationAdministration) · 낙상·욕창 위험 🟡 (간호 사정) · 인계(SBAR) 미완 🟡

### D4 원무·수납
- 접수 대기/처리 🔴 (Reception·WaitingQueue) · 금일 수납/환불 🟡 (Billing) · 미수 현황 🟢 · 보험 자격 미확인 🟡 (Eligibility) · 증명서 발급 대기 🟡 (DocumentRequest)

### D5 병상·입원
- 병상 가동률·공실/배정 🔴 (Bed) · 금일 입/퇴원·전동 🟡 (Admission) · 재원일수 분포·장기재원 🟢 · 퇴원 예정/지연 🟡 (journey-console ward/admission-trends 재사용)

### D6 응급(ED)
- KTAS 등급 분포 🔴 (Triage·Emergency) · ED 체류시간·재실 인원 🔴 · 입원 대기(boarding) 🔴 · overcrowding 지수(NEDOCS류) 🟡

### D7 약국
- 처방 검수/조제 대기 🔴 (Prescription·Pharmacy) · DUR 경고 건 🟡 · 분할조제/반납 🟡 · 재고 부족·유효기간 임박 🟢 (Inventory)

### D8 검사·영상
- 오더 대기/진행 🔴 (Order·Lab·Imaging) · **위험값(critical) 미보고** 🔴 (LabResult flag) · TAT(접수→결과) 🟢 · 판독 대기·미판독 🟡 (Imaging)

### D9 감염·질·안전
- 감염 지표(HAI·격리) 🟢 (InfectionControl) · QI 지표 달성률 🟢 (qi) · 환자안전 사건(낙상·투약오류) 🟢 (PatientSafety) · 지표 주간 트렌드 🟢 (executive clinical/weekly-trend)

### D10 만성질환 ✅
- 코호트 조절상태·CDSS(완료, `chronic/dashboard`)

---

## 4. 데이터 소스 매핑 (기존 모델/모듈 재사용)
- 진료량/대기: `Encounter`·`WaitingQueue`·`ClinicSchedule`
- 재무/청구: `Billing`·`BillingItem`·`Claim`·`Eligibility`
- 병상/입원: `Bed`·`Admission`·`journey-console`
- 간호/안전: `VitalSign`·`NursingNote`·`MedicationAdministration`·`PatientSafety`·`CriticalValue`
- 검사/영상/약국: `Order`·`LabResult`·`Imaging`·`Prescription`·`Pharmacy`·`Inventory`
- 응급: `Triage`·`Emergency`
- 집계 매크로: `executive`·`operational-stats`·`qi`·`quality`

---

## 5. 기술 접근
- **위젯 시스템 재사용**: 기존 `/dashboard` 위젯(51종)·탭 설정·dnd-kit 레이아웃을 **역할별 기본 프리셋**으로 구성. 신규 위젯은 같은 계약(데이터훅)으로 추가.
- **신선도 계층**:
  - 🔴 실시간 → 기존 SSE 알림 인프라(`notification`·floor SSE) 확장 또는 짧은 폴링(TanStack staleTime)
  - 🟢 일배치 → **Materialized View**(이미 일부 MV 존재)로 무거운 집계 분리, cron refresh
  - 🟡 준실시간 → 30~60s 폴링
- **단일 진입점**: 로그인 후 역할 기본 대시보드 라우팅(예: NURSE→D3, PHARMACIST→D7). [[feature_access_matrix]] 가드와 정합.
- **성능**: 집계 쿼리 인덱스/MV([[db_performance_review]] 참고), N+1 회피, Redis 캐시(짧은 TTL).
- **PHI 최소화**: 보드 카드엔 식별 최소(이름·MRN·핵심수치)만, 상세는 권한 내 드릴다운.

---

## 6. 단계
| 단계 | 범위 |
|------|------|
| **P0** | 인벤토리 확정 + **역할별 기본 대시보드 라우팅**(기존 위젯 프리셋) + 데이터 신선도/실데이터 연동 갭 점검(메인 `/dashboard` 백로그 해소 우선) |
| **P1** | **현장 실시간 보드 3종**: D3 간호 스테이션·D8 검사/영상 위험값·D6 응급(KTAS/체류) — 실시간성이 임상 가치 큼 |
| **P2** | D4 원무·수납 / D7 약국 / D5 병상·입원 보드 정비(기존 journey-console·billing 재사용) |
| **P3** | D9 감염·질·안전 통합 + 경영 D1 정비(MV 표준화·KPI 정의서) + 알림 연계(임계 초과 푸시) |

---

## 7. 권한/보안 (RBAC)
- 역할×대시보드 매트릭스를 [[feature_access_matrix]]에 등록(중앙 관리). 경영/재무 보드는 ADMIN·EXECUTIVE 한정.
- 보드 카드 PHI 최소노출 + 드릴다운 시 감사 로그(AuditAction).
- 외화/통화 정밀 지표는 [[foreign_currency_separate_track]] 정책상 ERP 담당 → HIS 보드는 표기만/생략.

---

## 8. 리스크 / 결정 필요
1. **중복 정리**: executive vs operational-stats vs journey-console 지표 경계 — 단일 KPI 사전(정의·계산식·소스) 필요.
2. **신선도 비용**: 실시간(🔴) 범위가 넓으면 SSE/폴링 부하 — D3/D6/D8 위험값 위주로 한정.
3. **실데이터 연동**: 메인 `/dashboard` 위젯 일부가 더미/백로그 — P0에서 실연동 우선순위 결정.
4. **단일 진입점 UX**: 역할 기본 대시보드 강제 vs 사용자 선택 — 기본 프리셋 + 사용자 커스텀(기존 탭 설정) 병행 권장.
5. **MV 갱신 주기**: 일배치 vs 시간배치 — 지표별 합의.

---

## 부록: KPI 사전 (P0 산출물 예시)
| KPI | 정의 | 계산식 | 소스 | 신선도 |
|-----|------|--------|------|--------|
| 병상가동률 | 재원/가용 병상 | occupied/total beds | Bed·Admission | 🟡 |
| 외래 평균대기 | 접수→호출 평균(분) | avg(calledAt-arrivedAt) | WaitingQueue | 🟡 |
| 검사 TAT | 접수→결과 중위(시간) | median(resultAt-collectedAt) | Order·LabResult | 🟢 |
| 위험값 미보고 | critical flag 미확인 건 | count(flag in H/L, ack=false) | LabResult | 🔴 |
| 수납률 | 수납/청구 | paid/billed | Billing | 🟢 |
