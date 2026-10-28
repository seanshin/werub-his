# Hospital RUN Phase 3 Planning Document

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/pharmacy/ · apps/api/src/modules/imaging/ · 잔여: 없음

> **Summary**: 약국 + 검사실 + 영상 + 건강보험 청구 + 대시보드 구현
>
> **Project**: Hospital RUN
> **Version**: 0.1.0
> **Author**: user
> **Date**: 2026-05-06
> **Status**: Draft
> **Prerequisites**: Phase 2 완료 (진료기록, OCS, DUR, 수납, FormEngine)

---

## 1. Overview

### 1.1 Purpose

Phase 2에서 완성된 OCS(처방전달시스템)의 실제 수신 부서(약국/검사실/영상실)를 구현하고, 건강보험 청구 연동과 운영 대시보드를 추가한다.

### 1.2 Phase 3 Goals

- **약국** — 처방약 디스펜싱 워크플로우, 재고 기본 관리
- **검사실** — 검사 접수, 결과 입력, 결과 확인 연동
- **영상실** — 영상 요청 접수, 결과 판독 기록
- **건강보험 청구** — HIRA 청구 포털 연동, 청구/심사/지급 관리
- **대시보드** — 환자 통계, 진료 현황, 수납 현황, 실시간 모니터링

---

## 2. Scope

### 2.1 Functional Requirements

| ID | Requirement | Priority | 의존성 |
|----|-------------|----------|--------|
| FR-05 | **약국** — OCS 약 오더 접수 → 조제 → 디스펜싱 → 투약확인 | High | Phase 2 OrderModule |
| FR-06 | **검사실** — OCS 검사 오더 접수 → 채혈/검사 → 결과 입력 → 결과 확인 | High | Phase 2 OrderModule |
| FR-07 | **영상실** — OCS 영상 오더 접수 → 촬영 → 판독 결과 기록 | Medium | Phase 2 OrderModule |
| FR-15 | **건강보험 청구** — 진료비 명세서 생성, HIRA 청구 데이터 포맷 변환, 청구/심사/지급 상태 관리 | High | Phase 2 BillingModule, FR-20 |
| FR-09 | **대시보드** — 환자 수, 오늘 예약/진료, 수납 현황, 부서별 오더 현황 실시간 표시 | Medium | 전체 데이터 |

### 2.2 Out of Scope

- 약품 자동 발주 시스템 → Phase 4+
- PACS 연동 (외부 영상 시스템) → Phase 4+
- HIRA DUR API 실시간 연동 → Phase 4 (현재 내부 룰만)
- 청구 심사 결과 자동 반영 → 수동 관리

---

## 3. Architecture — 새 모듈

| Module | Responsibility | Dependencies |
|--------|---------------|-------------|
| `PharmacyModule` | 약국 디스펜싱, 재고 기본 | OrderModule, CodeMasterModule |
| `LabModule` | 검사 접수/결과 입력 | OrderModule |
| `ImagingModule` | 영상 접수/판독 결과 | OrderModule |
| `ClaimModule` | 건강보험 청구 데이터 생성/관리 | BillingModule, CodeMasterModule |
| `DashboardModule` | 집계 쿼리, 실시간 현황 | 전체 모듈 |

---

## 4. Key Workflows

### 4.1 약국 디스펜싱

```
OCS 약 오더(ORDERED) → 약사 접수(RECEIVED) → 조제(IN_PROGRESS) → 투약 확인(COMPLETED)
                                                                     ↓
                                                              재고 차감
```

### 4.2 검사실

```
OCS 검사 오더 → 접수 → 채혈/검사 → 결과 입력(수치값) → 정상/이상 자동 판정 → 의사 확인
```

### 4.3 건강보험 청구

```
진료 완료 → 수납 완료 → 청구 데이터 생성 (진료비 명세서)
    → 배치 취합 → HIRA 포맷 변환 (XML/JSON)
    → 청구 제출 → 심사 중 → 지급 완료 (또는 삭감/반려)
```

---

## 5. Timeline

| Step | Scope | Duration |
|------|-------|----------|
| 1 | Prisma 스키마 확장 (Dispensing, LabResult, ImagingResult, Claim) | 2일 |
| 2 | PharmacyModule — 디스펜싱 + 기본 재고 | 4일 |
| 3 | LabModule — 결과 입력 + 정상/이상 판정 | 3일 |
| 4 | ImagingModule — 판독 결과 기록 | 2일 |
| 5 | ClaimModule — 청구 데이터 생성 + 상태 관리 | 5일 |
| 6 | DashboardModule — 집계 API | 3일 |
| 7 | Frontend — 약국/검사/영상 화면 | 5일 |
| 8 | Frontend — 청구 관리 화면 | 4일 |
| 9 | Frontend — 대시보드 (차트/통계) | 4일 |
| 10 | 테스트 + QA | 4일 |

**총 예상: ~12주 (36 working days)**

---

## 6. Success Criteria

- [ ] 약국 디스펜싱 워크플로우 동작 (오더→조제→투약확인)
- [ ] 검사 결과 입력 + 정상/이상 자동 판정
- [ ] 영상 판독 결과 기록
- [ ] 건강보험 청구 데이터 생성 (HIRA 포맷)
- [ ] 대시보드 실시간 현황 표시
- [ ] TypeScript 0 errors
- [ ] 테스트 커버리지 60%+

---

## 7. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| HIRA 청구 포맷 복잡성 | High | 초기 CSV/JSON 기본 포맷만 지원, XML 변환은 점진 추가 |
| 검사 결과 정상범위 데이터 | Medium | 기본 10개 검사 항목만 초기 시딩 |
| 약품 재고 실시간 동기화 | Medium | Phase 3은 기본 차감만, 발주/입고는 Phase 4+ |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial draft — Phase 3 기획 | user |
