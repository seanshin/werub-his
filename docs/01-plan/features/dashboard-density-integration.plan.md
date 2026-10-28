# 대시보드 밀도 개선·통합 정보 배치 기획

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/(main)/dashboard/components/default-layouts.ts · apps/web/src/app/(main)/dashboard/components/default-layouts.ts:42 · apps/web/src/app/(main)/dashboard/components/default-layouts.ts:43 · 잔여: 없음

- **버전**: v0.1 (2026-07-09)
- **대상**: `/dashboard` (Hero + 인증서배너 + DashboardShell 위젯 그리드 12칸·드래그편집·역할별)
- **목표**: 공백 축소 + 통합 정보 고밀도 배치

## 1. 현황·공백 원인 진단
- 위젯 라이브러리 **~50종**(system/chart/patient/clinical/orders/admin/emergency/bed/quality) — 위젯 부족 아님.
- 역할별 기본 레이아웃(`default-layouts.ts`): DOCTOR/NURSE/NURSE_NONWARD/ADMIN/PHARMACIST/LAB_TECH만 정의.
- **공백 원인**:
  1. **미정의 역할 fallback**(`?? DOCTOR_DEFAULT`) — EXECUTIVE·CRM_MANAGER·CRM_STAFF·READ가 **DOCTOR 레이아웃**을 받아 census·draft-charts·my-queue·surgery 등 **무관/빈 위젯이 큰 공백**으로 렌더.
  2. **레이아웃 갭** — `quick-actions`(w:8,h:1) + `session-info`(w:4,h:2) 조합이 L자 빈공간. 여러 위젯 h가 콘텐츠 대비 과다.
  3. **빈 위젯 미압축** — 데이터 0건이어도 카드 높이 고정 → 공백.

## 2. 개선안

### A. 역할별 기본 레이아웃 전 역할 정의 (fallback 제거)
| 역할 | 기본 위젯 구성(안) |
|---|---|
| EXECUTIVE | stat-bar·revenue-today·claims·daily-settlement·admission-trend·patient-flow·bed-status·qi-dashboard·ipsg-summary·satisfaction·chart-dept |
| CRM_MANAGER/STAFF | stat-bar·appointments·satisfaction·notifications·chart-weekly·patient-flow |
| READ | stat-bar·census·bed-status·notifications (읽기 요약) |
- DOCTOR fallback 제거 → 무관 빈 위젯 공백 해소.

### B. 밀도 개선(기존 역할 레이아웃 재배치)
- **통합 요약 스트립**: 상단 stat-bar를 핵심 KPI 12칸으로 확정(재원·외래·수술·응급대기·미서명·위험EWS·미확인알림).
- **갭 제거**: quick-actions를 full-width(w:12,h:1) 또는 session-info와 동일 행 정렬. 12칸을 빈틈없이 채우도록 x/w 재계산.
- **h 최적화**: 콘텐츠 짧은 위젯(schedule·session-info) h 축소, 표형 위젯은 내부 스크롤.

### C. 통합 정보 신규 위젯(우리 세션 데이터 활용)
1. **`my-today`(개인 통합)** — 오늘 내 일정+미서명+내 큐+근무상태(ESS clock)를 한 카드로(중복 위젯 대체·밀도↑).
2. **`my-pay-snapshot`(ESS/ERP)** — 내 급여명세 실수령·당직(오늘/이번주)·원천징수 상태 요약 → /staff/payroll 링크. (이미 배선한 `/ess/payslip`·`/ess/duties` 재사용)
3. **`hospital-pulse`(병원 현황 통합)** — 재원/공실(bed-status)+외래흐름(patient-flow)+응급(er-status)을 압축 1카드.
4. **`safety-alerts`(안전 통합)** — notifications+safety-incidents+ews-high-risk 통합 스트림.

### D. 빈 위젯 empty-state 압축
- 데이터 0건 위젯은 카드 h를 min(1)로 자동 축소하거나 "항목 없음" 슬림 표시 → 세로 공백 제거.
- 옵션: 빈 위젯 자동 숨김 토글(설정).

## 3. 단계
- **P0(공백 즉효)**: A(역할 기본 정의)+B(갭 제거·h 최적화)+D(빈 위젯 압축). default-layouts만 수정 — 저위험.
- **P1(통합 밀도)**: C 신규 위젯 1~2종(my-today·my-pay-snapshot) — ApiWidget/RowListWidget 패턴 재사용.
- **P2**: hospital-pulse·safety-alerts 통합 위젯.

## 4. 범위 밖
- 위젯 편집/카탈로그 시스템(이미 존재)·react-grid-layout 교체(React19 비호환 [[feedback_rgl_react19]]).
