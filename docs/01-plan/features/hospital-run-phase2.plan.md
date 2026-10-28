# Hospital RUN Phase 2 Planning Document

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:2094 · apps/api/src/modules/billing/ · 잔여: 없음

> **Summary**: OCS(처방전달시스템) + 진료기록(SOAP) + DUR 점검 + 기본 수납 + JSON Form Engine 구현
>
> **Project**: Hospital RUN
> **Version**: 0.1.0
> **Author**: user
> **Date**: 2026-05-06
> **Status**: Draft
> **Prerequisites**: Phase 1 MVP 완료 (91% Match Rate)

---

## 1. Overview

### 1.1 Purpose

Phase 1(환자관리, RBAC, 예약, FHIR Patient, 코드 마스터)이 완료되었으므로, 한국형 HIS의 핵심인 **진료 워크플로우**를 구현한다. 의사의 처방이 약국/검사실/영상실로 자동 전달되는 OCS와, 처방 시 실시간 DUR 점검, 그리고 진료 후 기본 수납까지의 전체 흐름을 완성한다.

### 1.2 Phase 2 Goals

- **진료기록(EMR)** — SOAP 노트 기반 진료 기록 작성/조회
- **OCS** — 의사 처방 → 약국/검사실/영상실 자동 전달 워크플로우
- **DUR** — 처방 시 약물 상호작용/중복/금기 실시간 점검
- **기본 수납** — 정액제 기반 본인부담금 계산, 수납/미수 관리
- **JSON Form Engine** — O3 스타일 동적 의료 폼 렌더링 시스템

### 1.3 Phase 1 의존성

| Phase 1 모듈 | Phase 2 활용 |
|-------------|-------------|
| PatientModule | 진료기록의 대상 환자 |
| ScheduleModule | 예약 → 접수 → 진료 워크플로우 연결 |
| CodeMasterModule | 진단(KCD), 처방(약품코드), 수가(EDI) 참조 |
| AuthModule + RBAC | 의사만 처방, 간호사 접수/수납 |
| AuditModule | 진료기록/처방 변경 감사 |

---

## 2. Scope

### 2.1 In Scope (FR)

| ID | Requirement | Priority | 의존성 |
|----|-------------|----------|--------|
| FR-02 | **진료기록** — SOAP 노트(Subjective, Objective, Assessment, Plan) 작성/이력 조회 | High | FR-01(Patient) |
| FR-14 | **OCS** — 의사 처방 입력 → 약국/검사실/영상실 오더 자동 전달 | High | FR-02, FR-20(코드) |
| FR-16 | **DUR 점검** — 처방 시 약물 상호작용/중복/금기 실시간 경고 | High | FR-14, FR-20(약품코드) |
| FR-17 | **기본 수납** — 정액제 본인부담금 계산, 수납 처리, 미수 관리, 영수증 | Medium | FR-02, FR-20(수가) |
| FR-13 | **JSON Form Engine** — JSON 스키마 기반 동적 폼 정의/렌더링/저장 | Medium | FR-02 |

### 2.2 Out of Scope

- 수가 기반 정밀 계산 (행위별 수가, DRG 포괄수가) → Phase 3 건강보험 청구와 연계
- HIRA 청구 포털 연동 → Phase 3
- 외래 처방전 출력/전자서명 → Phase 3
- 약국 재고 관리 → Phase 3 (FR-05)
- 검사 결과 입력/영상 결과 조회 → Phase 3 (FR-06, FR-07)

---

## 3. Functional Requirements Detail

### 3.1 FR-02: 진료기록 (SOAP Note)

**워크플로우:**
```
예약(SCHEDULED) → 접수(CHECKED_IN) → 진료시작(IN_PROGRESS)
    → 의사가 SOAP 노트 작성 → 처방 입력 → 진료완료(COMPLETED)
```

**기능:**
- SOAP 노트 생성 (Subjective, Objective, Assessment, Plan 각 섹션)
- 진단코드(KCD) 연결 (다건 가능)
- 이전 진료기록 타임라인 조회
- 진료기록 수정 (bi-temporal 이력)

### 3.2 FR-14: OCS (처방전달시스템)

**처방 유형:**
| 유형 | 전달 대상 | 예시 |
|------|----------|------|
| 약 처방 (Medication Order) | 약국 | 아목시실린 500mg 1일 3회 5일분 |
| 검사 처방 (Lab Order) | 검사실 | CBC, 간기능검사 |
| 영상 처방 (Imaging Order) | 영상실 | 흉부 X-ray |

**오더 상태:**
```
ORDERED → RECEIVED → IN_PROGRESS → COMPLETED / CANCELLED
```

**기능:**
- 처방 입력 시 약품/검사/영상 코드 검색 (CodeMasterModule 연동)
- 처방 저장 시 자동으로 해당 부서에 오더 생성
- 부서별 오더 목록(대기열) 조회
- 오더 상태 변경 (접수 → 진행 → 완료)

### 3.3 FR-16: DUR 점검

**점검 항목:**
| 점검 유형 | 설명 | 심각도 |
|----------|------|--------|
| 약물 상호작용 | 동시 처방 약물 간 상호작용 | Error/Warning |
| 중복 처방 | 동일 성분 중복 | Warning |
| 연령 금기 | 소아/고령자 금기 약물 | Error |
| 임부 금기 | 임신부 금기 약물 | Error |

**MVP 범위 (Phase 2):**
- 내부 룰 기반 기본 DUR (약물 상호작용 테이블)
- 처방 저장 전 경고 표시, 의사 확인 후 강제 저장 가능
- 추후 HIRA DUR API 연동은 Phase 3

### 3.4 FR-17: 기본 수납 (정액제)

**워크플로우:**
```
진료 완료 → 수납 대기 목록 → 금액 확인 → 수납 처리 → 영수증
```

**Phase 2 범위 (정액제 기본):**
- 진찰료 (초진/재진) 자동 산정
- 처방 약품/검사/영상별 정액 합산
- 본인부담률 적용 (보험 유형별: NHI 30%, MEDICAID 0%, SELF_PAY 100%)
- 수납/미수 상태 관리
- 간단 영수증 데이터 생성

### 3.5 FR-13: JSON Form Engine

**설계 (ADR-004 참조):**
- JSON 스키마로 폼 정의 (OpenMRS O3 Form Engine 참고)
- 런타임에 JSON → React 컴포넌트 동적 렌더링
- 유효성 검사, 조건부 렌더링, 다국어 지원
- 폼 데이터를 JSONB로 저장 (유연한 스키마 확장)

**초기 폼 종류:**
- 바이탈 사인 (혈압, 체온, 맥박, 호흡, SpO2)
- 문진표 (기본 증상 체크리스트)
- SOAP 노트 템플릿

---

## 4. Architecture Decisions

### 4.1 진료기록 + 처방의 데이터 흐름

```
의사 UI
  │
  ▼
┌──────────────────────────────────────────────────────┐
│                  EncounterModule                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ SOAP Note   │  │ Prescriptions│  │  Diagnoses │  │
│  │ (진료기록)   │  │  (처방목록)   │  │  (진단코드) │  │
│  └─────────────┘  └──────┬───────┘  └────────────┘  │
└──────────────────────────┼───────────────────────────┘
                           │ OCS 전달
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌───────────┐ ┌──────────┐ ┌──────────┐
       │ PharmOrder│ │ LabOrder │ │ ImgOrder │
       │  (약국)    │ │ (검사실)  │ │ (영상실)  │
       └─────┬─────┘ └─────┬────┘ └─────┬────┘
             │              │            │
             ▼              ▼            ▼
       ┌──────────────────────────────────────┐
       │         BillingModule (수납)          │
       │  진찰료 + 약품비 + 검사비 + 영상비     │
       │  × 본인부담률 = 본인부담금              │
       └──────────────────────────────────────┘
```

### 4.2 새 NestJS 모듈

| Module | Responsibility | Dependencies |
|--------|---------------|-------------|
| `EncounterModule` | 진료기록(SOAP), 진단 연결 | PatientModule, CodeMasterModule |
| `PrescriptionModule` | 처방 입력, DUR 점검 | EncounterModule, CodeMasterModule |
| `OrderModule` | OCS 오더 관리 (약국/검사/영상) | PrescriptionModule |
| `BillingModule` | 수납 계산, 수납 처리 | EncounterModule, OrderModule, CodeMasterModule |
| `FormEngineModule` | JSON 폼 스키마 CRUD, 데이터 저장 | PrismaModule |

---

## 5. Success Criteria (Phase 2 DoD)

- [ ] 의사가 SOAP 노트 작성 + 진단코드 연결 가능
- [ ] 약/검사/영상 처방 입력 → 해당 부서 오더 자동 생성
- [ ] 처방 저장 시 기본 DUR 경고 표시
- [ ] 진료 완료 후 정액제 수납 금액 자동 산정
- [ ] 수납 처리 + 영수증 데이터 생성
- [ ] JSON Form Engine으로 바이탈 사인 폼 동적 렌더링
- [ ] 테스트 커버리지 60% 이상 (서비스 레이어)
- [ ] TypeScript 0 errors

---

## 6. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| DUR 룰 데이터 부족 (약물 상호작용 DB) | High | 기본 10~20건 상호작용 데이터로 시작, 추후 HIRA DUR 연동 |
| 수납 로직 복잡화 방지 | Medium | Phase 2는 정액제만, 수가 기반은 Phase 3으로 명확 분리 |
| OCS 오더 상태 동기화 | Medium | 이벤트 기반 상태 전파 (Phase 2는 동기 처리, Phase 4에서 Bots 비동기화) |
| Form Engine 범위 확장 | Medium | 초기 3종 폼만 구현, 확장은 JSON 스키마 추가로 해결 |

---

## 7. Timeline

| Step | Scope | Duration |
|------|-------|----------|
| 1 | EncounterModule — SOAP + 진단 | 4일 |
| 2 | PrescriptionModule — 처방 입력 + DUR 기본 룰 | 4일 |
| 3 | OrderModule — OCS 오더 전달 + 상태 관리 | 3일 |
| 4 | BillingModule — 정액제 수납 계산 + 처리 | 4일 |
| 5 | FormEngineModule — JSON 스키마 CRUD + 렌더러 | 5일 |
| 6 | Frontend — 진료 화면 (SOAP + 처방 + DUR) | 5일 |
| 7 | Frontend — 오더 대기열 + 수납 화면 | 4일 |
| 8 | Frontend — Form Engine 렌더러 (바이탈) | 3일 |
| 9 | 테스트 + 통합 QA | 4일 |

**총 예상: ~10주 (36 working days)**

---

## 8. Next Steps

1. [ ] Design 문서 작성 (`hospital-run-phase2.design.md`)
2. [ ] DB 스키마 확장 (Encounter, Prescription, Order, Billing, FormSchema)
3. [ ] DUR 기본 룰 데이터 준비

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial draft — Phase 2 기획 | user |
