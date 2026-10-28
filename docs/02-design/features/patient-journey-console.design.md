# 환자여정 통합 관제 콘솔 — 설계서 v1.0

> 작성일: 2026-06-11 · 상태: Design · 기반: [기획서 v1.0](../../01-plan/features/patient-journey-console.plan.md)
> 설계 원칙: **비파괴 집계 레이어** — 신규 도메인 모델 0, 기존 서비스 조합 + 콘솔 UI + 집계 API 3종.

---

## 0. 오픈이슈 결정 (기획 §11 → 설계 확정)

| # | 이슈 | 결정 |
|---|------|------|
| 1 | 권한 모델 | **신규 역할 없이** ADMIN + `EXECUTIVE`(읽기) 권한 분리. 콘솔 접근 가드 = role ∈ {ADMIN, EXECUTIVE(읽기), 원무 관리자}. CRED_* 무신설 패턴 준수 |
| 3 | 단계 정의 | **v1: 외래 4단계(RECEPTION/IN_CONSULT/CASHIER_WAITING/DONE) / 입원 4단계(ADMITTED/INWARD/DISCHARGE_PLANNED/DISCHARGED)**. EXAM_PENDING(검사·처치 대기)는 오더 신호 부재로 **IN_CONSULT에 포함(v2 분리)**. 진료과별 변형은 v2 |

> **v1 정합 메모(구현 반영)**: ① 외래 EXAM_PENDING은 v2 이연(현 IN_CONSULT 포함) ② 실시간은 **폴링 확정**(SSE stream EP는 P4+ 옵션, FR-7 폴백 충족) ③ 마스킹은 **v1 전원 강마스킹**(EXECUTIVE 역할 RBAC 도입 전까지 ADMIN도 강마스킹) ④ 임계값 `TH` 상수는 ConfigRuntime 이관 예정(P4 잔여).
| 6 | ERP 중간진료비 보드 성능 | **보드 = HIS `Billing` 미수납 잔액**(빠름), **드릴다운 = ERP `getErpInvoice(interim)` 상세**. 벌크 ERP invoice는 불요(보류) |

## 1. 아키텍처

```
[FE] (main)/journey-console/page.tsx
   ├─ KPI 바  ──────── GET /journey-console/kpi
   ├─ 흐름 보드(칸반) ─ GET /journey-console/board  + SSE /journey-console/stream
   └─ 드릴다운 패널 ─── GET /journey/:patientId/timeline (기존)
                       GET /billing/erp-invoice?encounterId=&chartNo=&interim=true (기존)
                       GET /floor/entities (기존, 선택)
[BE] modules/journey-console/  (신규, 집계 전용 — 모델 0)
   ├─ journey-console.controller.ts  (3 EP + SSE)
   ├─ journey-console.service.ts     (집계: WaitingQueue+Admission+JourneyEvent+Billing)
   └─ journey-console.module.ts      (imports: Prisma, BillingModule, ConfigRuntime)
```

- 신규 BE 모듈은 **읽기 집계만**. 쓰기/업무로직 없음. 기존 모듈 import 또는 Prisma 직접 조회.

## 2. 단계 매핑 규칙 (핵심)

### 외래 트랙 (5단계)
| 단계 | 판정 소스 |
|------|-----------|
| `RECEPTION` 접수/대기 | `WaitingQueue.status ∈ {WAITING, CALLED}` |
| `IN_CONSULT` 진료중 | `WaitingQueue.status = IN_CONSULTATION` (또는 최신 `ENCOUNTER_START` & 미서명) |
| `EXAM_PENDING` 검사·처치 대기 | Encounter 서명 전 + 활성 오더(lab/imaging/처치) 존재. 단순화 v1: `ENCOUNTER_START` 후 `CASHIER_WAITING` 전 |
| `CASHIER_WAITING` 수납 대기 | `WaitingQueue.status = CASHIER_WAITING` 또는 `Billing.status ∈ {PENDING, PARTIAL}` (encounter 서명됨) |
| `DONE` 완료 | `Billing.status = PAID` |

### 입원 트랙 (4단계)
| 단계 | 판정 소스 |
|------|-----------|
| `ADMITTED` 입원 | `Admission.status = ADMITTED` & admitDate ≤ 24h |
| `INWARD` 재원 | `Admission.status = ADMITTED` (병동 체류) |
| `DISCHARGE_PLANNED` 퇴원예정 | `Admission` 퇴원지시 플래그/예정일(있으면) — v1: dischargeSummary 작성됨 & status=ADMITTED |
| `DISCHARGED` 퇴원/정산 | `Admission.status = DISCHARGED` & 미정산(Billing 미수납) → 정산대기 강조 |

> 단계 enum·임계는 `ConfigRuntime` 키로 외부화(`journeyConsole.stage.*`, `journeyConsole.threshold.*`).

## 3. API 설계

### 3.1 `GET /api/v1/journey-console/board`
- Query: `track`(OPD|IPD|ALL), `dept`, `ward`, `insuranceType`, `minStayMin`, `minUnpaid`
- 응답:
```jsonc
{ "data": {
  "asOf": "2026-06-11T13:00:00+09:00",
  "opd": [ { "patientId","name":"홍*동","mrn":"P2026-0001",
            "stage":"CASHIER_WAITING","track":"OPD",
            "dept":"내과","doctorName":"김의사",
            "encounterId","stageSince":"13:10","stayMin":23,
            "unpaid": 34000,            // HIS Billing 미수납(빠름)
            "flags":["CASHIER_DELAY"] } ],
  "ipd": [ { "patientId","name","ward":"5W","bed":"512-1",
            "stage":"INWARD","admitDate","stayDays":6,
            "unpaid": 1240000,"flags":["LONG_STAY"] } ]
} }
```
- 집계 구현(N+1 방지):
  1. `WaitingQueue.findMany({ status ∈ 활성 })` + patient/doctor join
  2. `AdmissionService.getActiveAdmissions()` 재사용
  3. 대상 encounterId/patientId의 `Billing` 일괄 조회(미수납 잔액)
  4. 단계 판정 + 임계 플래그 부여
  5. (중간진료비 잔액은 HIS Billing.patientCopay − paidAmount, ERP 호출 없음)

### 3.2 `GET /api/v1/journey-console/kpi`
```jsonc
{ "data": {
  "activeOpd": 89, "activeIpd": 35,
  "avgWaitMin": 18,            // journey.getMetrics 재사용
  "avgStayDays": 6.2,         // operational-stats/journey
  "unpaidTotal": 12400000, "unpaidCount": 31,   // Billing 집계
  "bedOccupancy": 0.82,       // dashboard.bed-occupancy / executive
  "revenueToday": { "confirmed": 40000000, "interim": 8000000 },
  "alerts": { "CASHIER_DELAY":3, "LONG_STAY":2, "HIGH_UNPAID":2 }
} }
```
- 기존 `executive.*`·`operational-stats.*`·`journey.getMetrics`·`dashboard.getFinancialSummary` 조합.

### 3.3 `GET /api/v1/journey-console/stream` (SSE)
- `notification`/`floor` SSE 패턴 재사용. 15초 스냅샷 + 이벤트 푸시(`encounter.signed`·`billing.paid`·`admission.*` `@OnEvent` 구독 시 보드 무효화 신호).
- 폴백: FE 폴링 20초.

### 3.4 드릴다운 (신규 EP 불요 — 기존 조합)
- 타임라인: `GET /journey/:patientId/timeline`
- **중간 진료비**: `GET /billing/erp-invoice?encounterId=&chartNo=&interim=true` (P0 바인딩 완료분 재사용) — 캐시 TTL 60s.
- 위치: `GET /floor/entities/:floorId` (선택)

## 4. 임계 룰 (ConfigRuntime, 기본값)

| 플래그 | 룰 | 기본 |
|--------|-----|------|
| `CASHIER_DELAY` | 수납대기 체류 > N분 | 30 |
| `CONSULT_DELAY` | 진료중 체류 > N분 | 40 |
| `LONG_STAY` | 재원일수 > 과 ALOS × 배수 | ×1.5 |
| `HIGH_UNPAID` | 미수납 잔액 > 임계 | 500,000 |

## 5. 권한 · 마스킹 매트릭스

| 역할 | 보드 | 드릴다운 타임라인 | 중간진료비 | 딥링크(진료/수납) | 마스킹 |
|------|:---:|:---:|:---:|:---:|------|
| ADMIN | ✓ | ✓ | ✓ | ✓ | 약 |
| EXECUTIVE(읽기) | ✓ | 요약 | 금액만 | ✗ | **강(이름·주민 마스킹)** |
| 원무 관리자(NURSE/ADMIN 범위) | ✓ | ✓ | ✓ | ✓ | 약 |
- 가드: `@Roles(ADMIN, EXECUTIVE)` + 드릴다운 조회 시 `AuditLog`(누가·어느 환자·진료비 열람).
- EXECUTIVE 권한은 RBAC 권한 플래그로 부여(역할 신설 없이) — 운영 합의 후 매핑.

## 6. FE 컴포넌트 구조

```
(main)/journey-console/
  page.tsx                 // 셸: KPI바 + 트랙탭 + 보드 + 드릴다운
  components/
    KpiBar.tsx             // GET kpi + 임계 카운트
    FlowBoard.tsx          // 칸반(OPD/IPD 탭) + 필터
    PatientCard.tsx        // 단계·체류·미수납배지·플래그
    DrilldownPanel.tsx     // 타임라인 + ErpInvoiceBlock(재사용) + 딥링크
    useJourneyStream.ts    // SSE 구독(폴백 폴링)
```
- 사이드바: `{ href:'/journey-console', label:'환자여정 관제', roles:['ADMIN','EXECUTIVE'] }`.
- 비파괴: 기존 `/dashboard`·`/admin/analytics` 유지.

## 7. 비기능 (NFR)

- **성능**: board ≤1.5s — WaitingQueue+Admission+Billing **3 쿼리 배치**, ERP 호출 없음. 드릴다운만 ERP(캐시).
- **회복력**: ERP interim 미가동 → 드릴다운 `{available:false}` graceful, 보드는 HIS 잔액 유지.
- **개인정보**: EXECUTIVE 강마스킹, 드릴다운 감사로그.

## 8. 파일 구조 (산출)

```
apps/api/src/modules/journey-console/{controller,service,module}.ts  (+ dto)
apps/api/test/journey-console.e2e-spec.ts
apps/web/src/app/(main)/journey-console/page.tsx + components/*
apps/web/src/components/layout/Sidebar.tsx (메뉴 1줄)
```

## 9. 구현 순서 (기획 Phase 매핑)

1. **P1** `journey-console.service.getBoard()`/`getKpi()` + controller(2 EP) + 단계 매핑 + 테스트
2. **P2** FE 셸 + KpiBar + FlowBoard(폴링) + 사이드바
3. **P3** DrilldownPanel(타임라인 + ErpInvoice 재사용 + 딥링크) + 감사로그
4. **P4** SSE stream + 임계 룰(ConfigRuntime) + 알림 위젯
5. **P5** EXECUTIVE 권한·마스킹 + QA(gap-detector)

## 10. 미결(설계 후 확인)

1. EXECUTIVE 권한 **부여 대상**(임원 계정) 운영 합의.
2. `DISCHARGE_PLANNED` 판정 — 퇴원예정 플래그 필드 없으면 dischargeSummary 작성 기준 사용(또는 Admission에 `dischargePlannedDate` 추가 검토).
3. 임계 기본값 운영 튜닝.

---
### 다음
- 설계 승인 → 구현 P1(집계 API) 착수. `/pdca do patient-journey-console`.
