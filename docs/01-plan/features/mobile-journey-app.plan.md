# 모바일 환자 여정 앱 (Mobile Journey App) Planning Document

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/mobile/src/hooks/useJourneyStatus.ts · apps/api/src/modules/portal/portal.controller.ts:1379 · 잔여: 없음

> **Summary**: 환자 여정 기반 모바일앱 — 외래/입원/퇴원후 상태별 맞춤 화면 제공
>
> **Project**: Hospital RUN
> **Version**: 2.4.0
> **Author**: AI Assistant
> **Date**: 2026-05-29
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

환자의 병원 내 여정(접수→대기→진료→검사→수납→퇴원)을 실시간으로 추적하고,
현재 상태에 맞는 최적화된 정보를 모바일 앱에서 제공한다.

### 1.2 Background

- 현재 모바일앱은 정적 탭 구조(홈/예약/진료/검사/더보기)로, 환자 상태와 무관하게 동일 화면 표시
- BE에 `PatientJourneyEvent` 모델과 여정 추적 인프라가 완비되어 있으나, 환자(Portal) API로 노출되지 않았음
- `GET /portal/journey/status` API를 신규 구현 완료 — 5단계 상태 자동 판별 가능
- 환자는 자신의 현재 상태를 직관적으로 파악하고, 필요한 행동(대기확인/복약/건강관리 등)을 즉시 수행해야 함

### 1.3 Related Documents

- BE 여정 API: `apps/api/src/modules/portal/portal.service.ts` (getJourneyStatus)
- 여정 이벤트 모델: `PatientJourneyEvent` (schema.prisma L5775)
- 모바일앱 현재 구조: `apps/mobile/app/`

---

## 2. Scope

### 2.1 In Scope

- [x] BE: 환자 여정 통합 API (`/portal/journey/status`, `/timeline`, `/inpatient`) — **완료**
- [x] BE: 문진표 API (`/portal/questionnaire/active`, `/submit`) — **완료**
- [ ] FE: 여정 기반 홈화면 재설계 (상태별 분기 렌더링)
- [ ] FE: 외래 여정 화면 (대기순번/호출알림/진료진행/수납안내)
- [ ] FE: 입원 여정 화면 (입원정보/바이탈/투약/검사/회진/수술)
- [ ] FE: 퇴원후 건강관리 화면 (복약/재진예약/건강스코어/퇴원요약)
- [ ] FE: 기존 화면 API 경로 정합성 수정 (telehealth, documents 등)
- [ ] 서버 배포 및 E2E 검증

### 2.2 Out of Scope

- 푸시 알림 (FCM) — 별도 기획
- 앱 스토어 배포 — 별도 기획
- 오프라인 동기화 — CLAUDE.md Out of Scope (FR-08)
- 네이티브 디바이스 기능 (카메라/NFC) — Phase 2

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 홈화면 진입 시 여정 상태 자동 판별 (API 1회 호출) | High | BE 완료 |
| FR-02 | OUTPATIENT_WAITING: 대기순번, 앞 대기수, 예상시간, 진료과 표시 | High | Pending |
| FR-03 | OUTPATIENT_CALLED: "호출됨" 강조 배너 + 진료실 안내 | High | Pending |
| FR-04 | OUTPATIENT_IN_CONSULTATION: 진행중 표시 + 오늘 여정 타임라인 | High | Pending |
| FR-05 | INPATIENT: 입원일수/병실/주치의/바이탈/투약/검사/회진/수술 카드 | High | Pending |
| FR-06 | POST_DISCHARGE: 퇴원일수/퇴원진단/추적계획/복약/다음예약 | High | Pending |
| FR-07 | IDLE: 다음 예약/최근 진료/건강대시보드/복약/알림 | Medium | Pending |
| FR-08 | 여정 타임라인 뷰 (이벤트 로그 시각화) | Medium | Pending |
| FR-09 | 문진표 작성/제출 (QuestionnaireToken 기반) | Medium | Pending |
| FR-10 | 기존 화면 API 경로 정합성 (telehealth, documents) | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 홈화면 journey/status 응답 < 500ms | API latency |
| UX | 상태 전환 시 자동 새로고침 (pull-to-refresh) | Manual test |
| 접근성 | 폰트 최소 14px, 터치 타겟 44px | 디자인 리뷰 |
| 플랫폼 | iOS/Android/Web 동일 동작 | Expo 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 5개 여정 상태별 분기 화면 구현
- [ ] 기존 19개 화면 + 신규 여정 화면 정상 동작
- [ ] API 경로 32개 전체 정합성 확인
- [ ] TypeScript 에러 0건
- [ ] Expo web export 성공

### 4.2 Quality Criteria

- [ ] 모든 API 호출에 에러 핸들링 + 로딩 상태
- [ ] Pull-to-refresh 지원
- [ ] 빈 상태(empty state) UI 제공

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| CORS 이슈 (localhost ↔ his.example.org) | High | 발생/해결됨 | main.ts CORS origin 추가 완료 |
| expo-secure-store 웹 미지원 | High | 발생/해결됨 | secure-storage.ts 래퍼로 분기 |
| PatientAccount 테스트 데이터 부재 | High | 발생/해결됨 | seed-test-accounts API 추가 |
| Prisma 스키마 필드명 불일치 | Medium | 발생/해결됨 | 전수 조사 후 수정 완료 |
| 네이티브 빌드 호환성 | Medium | Low | Expo Go로 우선 테스트 |

---

## 6. Architecture Considerations

### 6.1 Project Level

| Level | Selected |
|-------|:--------:|
| **Enterprise** | ✅ |

### 6.2 Key Architectural Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| Framework | React Native (Expo SDK 56) | 기존 모바일앱 구조 유지 |
| State | Zustand | 기존 auth-store 패턴 유지 |
| API Client | Custom apiClient (fetch) | 토큰 자동 갱신 포함 |
| Navigation | expo-router (file-based) | Expo SDK 56 표준 |
| Styling | React Native StyleSheet | 네이티브 성능 |

### 6.3 화면 구조 (여정 기반)

```
app/
├── _layout.tsx                    # AuthGate + QueryClientProvider
├── (auth)/
│   ├── login.tsx                  # 로그인 (테스트 계정 포함)
│   ├── signup.tsx                 # 회원가입
│   └── pin.tsx                    # PIN 로그인
├── (tabs)/
│   ├── _layout.tsx                # 하단 탭 네비게이션
│   ├── index.tsx                  # 🆕 여정 기반 홈 (상태별 분기)
│   ├── appointments.tsx           # 예약 관리
│   ├── encounters.tsx             # 진료 이력
│   ├── labs.tsx                   # 검사 결과
│   ├── notifications.tsx          # 알림
│   └── more.tsx                   # 더보기 메뉴
├── journey/
│   ├── outpatient.tsx             # 🆕 외래 상세 (대기/진료/수납)
│   ├── inpatient.tsx              # 🆕 입원 상세 (일지/검사/회진)
│   ├── post-discharge.tsx         # 🆕 퇴원후 건강관리
│   └── timeline.tsx               # 🆕 여정 타임라인
├── questionnaire.tsx              # 문진표 작성
├── telehealth.tsx                 # 원격진료
├── billing.tsx                    # 수납 내역
├── documents.tsx                  # 서류 발급
├── medication.tsx                 # 복약 관리
├── guardians.tsx                  # 보호자 관리
└── profile.tsx                    # 내 정보
```

### 6.4 여정 상태 흐름도

```
┌─────────────────────────────────────────────────────────┐
│                  GET /portal/journey/status              │
│                          │                               │
│              ┌───────────┼───────────┐                   │
│              ▼           ▼           ▼                   │
│      ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│      │ OUTPATIENT│ │ INPATIENT│ │   IDLE   │             │
│      │ _WAITING  │ │          │ │          │             │
│      └────┬─────┘ └────┬─────┘ └────┬─────┘             │
│           │             │             │                   │
│  ┌────────┼────────┐   │    ┌────────┼────────┐         │
│  ▼        ▼        ▼   │    ▼        ▼        ▼         │
│ 대기    호출됨   진료중  │  다음예약  복약    건강관리    │
│ 순번    배너     타임라인 │  카드     스케줄   대시보드   │
│ 예상    진료실            │                               │
│ 시간    안내    ┌────────┤   ┌──────────────┐             │
│               │        │   │ POST_DISCHARGE│             │
│               │ 바이탈  │   └──────┬───────┘             │
│               │ 투약    │          │                      │
│               │ 검사    │    퇴원진단                     │
│               │ 회진    │    추적계획                     │
│               │ 수술    │    퇴원약                       │
│               └────────┘    다음예약                      │
└─────────────────────────────────────────────────────────┘
```

---

## 7. API 매핑

### 7.1 신규 API (구현 완료)

| Endpoint | 용도 | 응답 핵심 필드 |
|----------|------|---------------|
| `GET /portal/journey/status` | 상태 판별 + 상태별 데이터 | `phase`, 상태별 데이터 |
| `GET /portal/journey/timeline` | 여정 이벤트 로그 | `eventType`, `eventAt`, `description` |
| `GET /portal/journey/inpatient` | 입원 상세 | 회진/검사/수술/정산 |
| `GET /portal/questionnaire/active` | 활성 문진표 | `tokenId`, `formSchema` |
| `POST /portal/questionnaire/submit` | 문진표 제출 | `submissionId` |

### 7.2 기존 API 활용

| 화면 | API | 비고 |
|------|-----|------|
| 예약 | `GET /portal/appointments` | 그대로 사용 |
| 진료이력 | `GET /portal/encounters` | 그대로 사용 |
| 검사결과 | `GET /portal/lab-results` | 그대로 사용 |
| 대기현황 | `GET /portal/waiting-status` | journey/status에 통합 |
| 수납 | `GET /portal/billings` | 그대로 사용 |
| 복약 | `GET /portal/medication-schedule` | 그대로 사용 |
| 건강대시보드 | `GET /portal/health-dashboard` | journey/status IDLE에 포함 |
| 원격진료 | `GET /portal/telehealth` | FE 경로 수정 필요 (/sessions 제거) |
| 서류 | `GET /portal/documents/requests` | FE 경로 수정 필요 |
| 알림 | `GET /patient-auth/notifications` | 그대로 사용 |

### 7.3 FE 경로 수정 필요

| 현재 FE 호출 | 수정 후 | 사유 |
|-------------|---------|------|
| `/portal/telehealth/sessions` | `/portal/telehealth` | BE 경로 불일치 |
| `/portal/documents` | `/portal/documents/requests` | BE 경로 불일치 |

---

## 8. 구현 순서

| 단계 | 작업 | 예상 규모 |
|:----:|------|----------|
| 1 | FE API 경로 정합성 수정 (telehealth, documents) | 소 |
| 2 | 여정 기반 홈화면 구현 (상태별 분기 + 카드 UI) | 대 |
| 3 | 외래 여정 상세 화면 (대기→호출→진료→수납) | 중 |
| 4 | 입원 여정 상세 화면 (바이탈/투약/검사/회진) | 대 |
| 5 | 퇴원후 건강관리 화면 (복약/재진/건강스코어) | 중 |
| 6 | 여정 타임라인 뷰 | 소 |
| 7 | 문진표 화면 수정 (실제 API 연동) | 소 |
| 8 | 통합 검증 + 서버 배포 | 소 |

---

## 9. Next Steps

1. [ ] Design 문서 작성 (`mobile-journey-app.design.md`)
2. [ ] 구현 (단계 1~8)
3. [ ] Gap 분석
4. [ ] 완료 보고서

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-29 | Initial draft — BE API 완료, FE 설계 | AI Assistant |
