# 모바일 환자 여정 앱 Design Document

> **Summary**: 환자 여정 상태별 분기 UI — 외래/입원/퇴원후/일반 맞춤 화면 설계
>
> **Project**: Hospital RUN
> **Version**: 2.4.0
> **Author**: AI Assistant
> **Date**: 2026-05-29
> **Status**: Draft
> **Planning Doc**: [mobile-journey-app.plan.md](../../01-plan/features/mobile-journey-app.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 환자 여정 상태(`phase`)에 따라 홈화면 자동 분기
- 단일 API 호출(`/portal/journey/status`)로 상태 판별 + 필요 데이터 일괄 수신
- 기존 19개 화면 유지하면서 여정 화면 5개 추가

### 1.2 Design Principles

- **Context-First**: 환자의 현재 맥락에 맞는 정보만 우선 표시
- **Progressive Disclosure**: 상세 정보는 터치로 진입
- **API 최소화**: 홈 진입 시 1 API 호출, 상세 진입 시 추가 호출

---

## 2. Component Architecture

### 2.1 홈화면 분기 구조

```
(tabs)/index.tsx — JourneyHome
  │
  ├── useJourneyStatus() ← GET /portal/journey/status
  │
  ├── phase === 'OUTPATIENT_*'
  │   └── <OutpatientCard />
  │       ├── QueueStatusBanner (순번/대기수/예상시간)
  │       ├── TodayAppointmentList
  │       └── JourneyTimeline (mini)
  │
  ├── phase === 'INPATIENT'
  │   └── <InpatientCard />
  │       ├── AdmissionInfoBanner (입원일수/병실/주치의)
  │       ├── VitalsCard (최근 바이탈)
  │       ├── TodayMedicationCard (오늘 투약)
  │       ├── RecentLabCard (최근 검사)
  │       └── NextSurgeryCard (예정 수술)
  │
  ├── phase === 'POST_DISCHARGE'
  │   └── <PostDischargeCard />
  │       ├── DischargeSummaryBanner (퇴원일수/진단)
  │       ├── FollowUpCard (추적계획/다음예약)
  │       ├── MedicationCard (퇴원약)
  │       └── HealthDashboardCard
  │
  └── phase === 'IDLE'
      └── <IdleCard />
          ├── NextAppointmentCard
          ├── MedicationCard (활성 복약)
          ├── LastEncounterCard
          └── HealthDashboardCard
```

### 2.2 공통 컴포넌트

| Component | Props | 용도 |
|-----------|-------|------|
| `JourneyPhaseBadge` | `phase: string` | 상태 배지 (색상 분기) |
| `InfoCard` | `title, icon, children` | 범용 정보 카드 |
| `TimelineItem` | `type, at, description` | 여정 이벤트 아이템 |
| `DoctorInfo` | `familyName, givenName` | 의사 이름 표시 |
| `LoadingState` | - | 스켈레톤 로딩 |
| `EmptyState` | `message, icon` | 데이터 없음 |
| `ErrorState` | `message, onRetry` | 에러 + 재시도 |

---

## 3. 화면별 상세 설계

### 3.1 OUTPATIENT (외래) 화면

#### 3.1.1 OUTPATIENT_WAITING

```
┌─────────────────────────────┐
│ 🏥 내과 진료 대기 중          │
│                              │
│  ┌──────────────────────┐   │
│  │   대기번호  #12       │   │
│  │   앞 대기  3명        │   │
│  │   예상 시간  ~24분     │   │
│  └──────────────────────┘   │
│                              │
│  📋 오늘 예약                │
│  ├ 10:00 내과 - 김내과       │
│  └ 14:00 영상의학과          │
│                              │
│  ⏱ 오늘 여정                 │
│  ├ 09:30 접수 완료           │
│  └ 09:31 대기 시작           │
└─────────────────────────────┘
```

#### 3.1.2 OUTPATIENT_CALLED

```
┌─────────────────────────────┐
│ 🔔 호출되었습니다!            │
│    내과 2진료실로 오세요       │
│                              │
│  [진료실 위치 보기]           │
└─────────────────────────────┘
```

#### 3.1.3 OUTPATIENT_IN_CONSULTATION

```
┌─────────────────────────────┐
│ 💊 진료 진행 중               │
│    내과 · 김내과 선생님        │
│                              │
│  ⏱ 오늘 여정                 │
│  ├ 09:30 접수 완료           │
│  ├ 09:45 호출                │
│  ├ 09:47 진료 시작 ← 현재    │
│  └ ...                       │
└─────────────────────────────┘
```

### 3.2 INPATIENT (입원) 화면

```
┌─────────────────────────────┐
│ 🏨 입원 6일차                 │
│    3층 내과병동 301호 A침대    │
│    주치의: 김내과              │
│                              │
│  ❤️ 최근 바이탈              │
│  BP 130/85  HR 72  T 36.5   │
│  SpO2 98%                    │
│                              │
│  💊 오늘 투약 (3/5)          │
│  ├ ✅ 08:00 아스피린 100mg   │
│  ├ ✅ 08:00 메트포르민 500mg │
│  ├ ✅ 12:00 메트포르민 500mg │
│  ├ ⬜ 18:00 메트포르민 500mg │
│  └ ⬜ 20:00 아스피린 100mg   │
│                              │
│  🔬 최근 검사 결과            │
│  ├ CBC — 정상                │
│  ├ 혈당 — ⚠️ 높음 (180)     │
│  └ [전체 보기]               │
│                              │
│  📝 최근 경과기록             │
│  └ 05/28 활력징후 안정...     │
│                              │
│  🔪 예정 수술                │
│  └ 없음                      │
└─────────────────────────────┘
```

### 3.3 POST_DISCHARGE (퇴원후) 화면

```
┌─────────────────────────────┐
│ 🏠 퇴원 5일차                 │
│    주치의: 김내과              │
│                              │
│  📋 퇴원 진단                │
│  └ 심부전 (I50.9)           │
│                              │
│  📅 추적 계획                │
│  └ 2주 후 외래 재진          │
│     2026-06-10 내과 예약     │
│                              │
│  💊 퇴원약                   │
│  ├ 아스피린 100mg 1일1회     │
│  ├ 메트포르민 500mg 1일2회   │
│  └ [복약 스케줄 보기]        │
│                              │
│  📊 건강 대시보드             │
│  └ [상세 보기]               │
└─────────────────────────────┘
```

### 3.4 IDLE (일반) 화면

```
┌─────────────────────────────┐
│ 👋 안녕하세요, 김영수님       │
│                              │
│  📅 다음 예약                │
│  └ 2026-06-10 내과 김내과    │
│     [예약 변경] [취소]       │
│                              │
│  💊 복용 중인 약 (2)         │
│  ├ 아스피린 100mg            │
│  └ 메트포르민 500mg          │
│                              │
│  🩺 마지막 진료              │
│  └ 2026-05-20 내과 — 정기검진│
│                              │
│  📊 건강 관리                │
│  ├ 건강 스코어 보기          │
│  ├ 검사 결과 추이            │
│  └ 건강 메모                 │
│                              │
│  🔔 알림 (3)                 │
└─────────────────────────────┘
```

---

## 4. 데이터 흐름

### 4.1 Custom Hook

```typescript
// src/hooks/useJourneyStatus.ts
function useJourneyStatus() {
  return useQuery({
    queryKey: ['journey', 'status'],
    queryFn: () => apiClient.get('/api/v1/portal/journey/status'),
    staleTime: 30_000,    // 30초 캐시
    refetchInterval: 60_000, // 1분 자동 갱신
  });
}
```

### 4.2 API 호출 맵

| 화면 | 진입 시 호출 | 추가 액션 |
|------|------------|----------|
| 홈 | `journey/status` | pull-to-refresh |
| 외래 상세 | `journey/timeline` | - |
| 입원 상세 | `journey/inpatient` | - |
| 여정 타임라인 | `journey/timeline?from=&to=` | 날짜 필터 |
| 문진표 | `questionnaire/active` | `questionnaire/submit` |

---

## 5. 파일 구조 (신규/수정)

### 5.1 신규 파일

```
apps/mobile/
├── src/
│   ├── hooks/
│   │   └── useJourneyStatus.ts          # 여정 상태 hook
│   └── components/
│       ├── journey/
│       │   ├── OutpatientCard.tsx        # 외래 상태 카드
│       │   ├── InpatientCard.tsx         # 입원 상태 카드
│       │   ├── PostDischargeCard.tsx     # 퇴원후 카드
│       │   ├── IdleCard.tsx             # 일반 상태 카드
│       │   ├── QueueStatusBanner.tsx     # 대기 순번 배너
│       │   ├── VitalsCard.tsx           # 바이탈 카드
│       │   ├── MedicationCard.tsx       # 투약/복약 카드
│       │   ├── LabResultCard.tsx        # 검사 결과 카드
│       │   └── TimelineItem.tsx         # 타임라인 아이템
│       └── common/
│           ├── InfoCard.tsx             # 범용 카드
│           ├── JourneyPhaseBadge.tsx    # 상태 배지
│           ├── LoadingState.tsx         # 로딩
│           └── EmptyState.tsx           # 빈 상태
├── app/
│   ├── (tabs)/
│   │   └── index.tsx                    # 🔄 여정 기반 홈으로 교체
│   └── journey/
│       ├── timeline.tsx                 # 여정 타임라인 전체
│       └── inpatient-detail.tsx         # 입원 상세
```

### 5.2 수정 파일

| 파일 | 수정 내용 |
|------|----------|
| `app/(tabs)/index.tsx` | 정적 홈 → 여정 기반 홈 |
| `app/telehealth.tsx` | `/telehealth/sessions` → `/telehealth` |
| `app/documents.tsx` | `/documents` → `/documents/requests` |
| `app/questionnaire.tsx` | 실제 API 연동 |

---

## 6. 색상 시스템 (여정 상태별)

| Phase | Primary Color | Badge Color | Icon |
|-------|:------------:|:-----------:|:----:|
| OUTPATIENT_WAITING | `#F59E0B` (amber) | `#FEF3C7` | ⏳ |
| OUTPATIENT_CALLED | `#EF4444` (red) | `#FEE2E2` | 🔔 |
| OUTPATIENT_IN_CONSULTATION | `#3B82F6` (blue) | `#DBEAFE` | 💊 |
| INPATIENT | `#8B5CF6` (violet) | `#EDE9FE` | 🏨 |
| POST_DISCHARGE | `#10B981` (emerald) | `#D1FAE5` | 🏠 |
| IDLE | `#6B7280` (gray) | `#F3F4F6` | 👋 |

---

## 7. 구현 순서 (Do Phase 가이드)

| Step | 작업 | 파일 | 의존성 |
|:----:|------|------|--------|
| 1 | FE API 경로 수정 | telehealth.tsx, documents.tsx | 없음 |
| 2 | useJourneyStatus hook | hooks/useJourneyStatus.ts | 없음 |
| 3 | 공통 컴포넌트 | components/common/, journey/ | Step 2 |
| 4 | 홈화면 재설계 | (tabs)/index.tsx | Step 2, 3 |
| 5 | 외래 카드 구현 | OutpatientCard.tsx | Step 3 |
| 6 | 입원 카드 구현 | InpatientCard.tsx | Step 3 |
| 7 | 퇴원후 카드 구현 | PostDischargeCard.tsx | Step 3 |
| 8 | IDLE 카드 구현 | IdleCard.tsx | Step 3 |
| 9 | 여정 타임라인 화면 | journey/timeline.tsx | Step 3 |
| 10 | 문진표 연동 수정 | questionnaire.tsx | Step 1 |
| 11 | 통합 검증 + 배포 | - | Step 1~10 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-29 | Initial design — 5상태 분기 UI + 컴포넌트 구조 | AI Assistant |
