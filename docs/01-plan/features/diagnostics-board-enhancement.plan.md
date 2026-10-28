# 진단검사 보드(Diagnostics Board) 보강 기획 — P1·P2·P3

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — P2 취소·보류 전이표·사유/행위자/시각 칸 `apps/api/src/common/errors/domain-error-codes.ts:76` DIAGNOSTIC_HAS_RESULT(A5 `3ca27cb4`) · 위급값 허용시간 초과 기준을 설정 정본으로 `apps/api/src/modules/lab/diagnostics-board.service.ts:26` criticalOverduePolicy(P3 `e0840d8c`) · 잔여: 연령/성별 참조범위(사람)

> 2026-07-04 / Plan v1.0 / 대상: `apps/api/src/modules/lab/diagnostics-board.*`·`diagnostic-test/*`·`apps/web/.../diagnostics-board`
> 계기: 현황 검토 — 위험값·백로그 감시 보드로는 동작하나 영상/기능검사 위험값 미포함·모달별 큐·TAT/우선순위·판독 서명 부재.

## 1. 현황
- **보드**(87줄): 위험값 미보고(CriticalValueAlert)·검사 대기·영상 판독대기 4-스탯·30초 폴링. **lab 편향**.
- **기능검사 관리**(별도 467줄): 11종 오더→수행→판독 전주기.
- DiagnosticTest 상태 4종(ORDERED/SCHEDULED/IN_PROGRESS/COMPLETED)·자원/우선순위/서명 없음.

## 2. 보강 범위 (3가지 모두 · DiagnosticTest 가산 필드 + 보드 확장)

### P1 — 위험값 통합 + 모달별 큐 + TAT/우선순위
- DiagnosticTest += `priority`(STAT/URGENT/ROUTINE)·`targetTatMinutes`·`criticalFlag`/`criticalNote`.
- **보드 확장**: 기능검사 **모달별 큐**(testType×status 집계)·**TAT 초과**(오더→미완 목표 초과)·**기능검사 위험소견**(criticalFlag) 통합.

### P2 — 자원 배정 + 판독 서명/검증 + 상태 확장 + Order 브릿지
- DiagnosticTest += `roomName`·`equipmentName`·`orderId`(브릿지)·`reviewedBy`/`reviewedAt`/`reviewStatus`(PENDING_REVIEW/APPROVED/REJECTED).
- **판독 서명 워크플로**: report 후 검토(승인/반려) EP. 보드에 **검토 대기** 표시.
- **상태 확장**: CANCELLED·ON_HOLD 전이(취소/보류 EP).

### P3 — delta check + 추이
- **delta check**: report 시 직전 동일 검사종류 측정값 대비 >30% 변동 → `deltaFlag`/`deltaNote`.
- **추이**: 환자별 검사종류 측정값 시계열 EP + FE.
- (이연) 연령/성별 참조범위: 참조 데이터 필요 → 후속.

## 3. 안전·정합
- 신규 필드 전부 가산적(nullable/기본값)·기존 흐름 무영향. Order 브릿지는 plain orderId(비파괴).
- 판독 서명·TAT·위험소견은 **환자안전 강화**.

## 4. 배포
DiagnosticTest 필드 추가 → manual SQL(ALTER) → prisma generate → --api → --web.
