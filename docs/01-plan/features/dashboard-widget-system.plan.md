# 대시보드 위젯 시스템 기획서 v1.2

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:265 model UserDashboardConfig · apps/web/src/app/(main)/dashboard/components/widgets/ · apps/web/src/app/(main)/dashboard/components/DashboardShell.tsx · 잔여: 없음

> 작성일: 2026-05-30 | 갱신: v1.1 검토 보완 (인터페이스 정합성, 위젯 수 정정, 조건부 위젯, 관리자 프리셋)
> 목표: 대시보드 레이아웃을 사용자가 드래그&드롭으로 자유 편집, 위젯 단위로 배치/크기 조정/표시 관리

---

## 1. 현황 분석

### 1.1 현재 구조

| 항목 | 현재 상태 |
|------|----------|
| 레이아웃 | Tailwind grid 하드코딩 (역할별 고정 배치) |
| 역할별 대시보드 | 5종 (Doctor, Nurse, Admin, Pharmacist, LabTech) |
| 위젯 수 | **27종** (역할별 6~12개 조합) |
| 역할별 위젯 수 | Doctor 12개, Nurse 12개, Admin 10개, Pharmacist 7개, LabTech 7개 |
| 사용자 설정 저장 | 없음 (localStorage에 토큰만 저장) |
| 드래그&드롭 라이브러리 | 미사용 |
| React 버전 | **19.1.0** |
| Prisma Json 패턴 | JSONB 필드 20+ 이미 사용 중 |

### 1.2 문제점

1. **개인화 불가** — 모든 의사가 동일한 대시보드, 사용 패턴 반영 불가
2. **불필요한 위젯 표시** — 수술 안 하는 의사에게도 수술 일정 표시
3. **크기 고정** — 센서스 중심 의사 vs 검사결과 중심 의사 차이 반영 불가
4. **역할 간 위젯 공유 불가** — 간호사가 수술 일정을 보고 싶어도 NURSE 대시보드에 없으면 불가
5. **위젯 내 설정 불가** — 목록 표시 건수, 자동 새로고침 간격 등 조정 불가

---

## 2. 목표 아키텍처

### 2.1 핵심 개념

```
┌─────────────────────────────────────────────────────┐
│  Dashboard Shell (편집 모드 토글)                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  [stat-bar ─────────────── static, 항상 최상단]  │  │
│  ├────────────────────────────────────────────────┤  │
│  │  Grid Container (react-grid-layout)            │  │
│  │  ┌──────┐ ┌──────────┐ ┌──────┐               │  │
│  │  │Widget│ │  Widget   │ │Widget│  ← 드래그 이동 │  │
│  │  │ 1x1  │ │   2x1    │ │ 1x1  │               │  │
│  │  └──────┘ └──────────┘ └──────┘               │  │
│  │  ┌─────────────┐ ┌──────────────────┐         │  │
│  │  │   Widget    │ │     Widget       │← 리사이즈│  │
│  │  │    1x2      │ │      2x2    ◢    │         │  │
│  │  └─────────────┘ └──────────────────┘         │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  [+ 위젯 추가]  [실행 취소]  [기본으로 초기화]  [취소] [저장] │
└─────────────────────────────────────────────────────┘
```

### 2.2 사용자 플로우

```
1. 최초 접속
   → DB에 저장된 레이아웃이 없으면 역할별 기본 레이아웃 표시
   → 기본 레이아웃은 현재 하드코딩된 배치와 동일

2. 편집 모드 진입  (헤더 "편집" 버튼 클릭)
   → 위젯에 드래그 핸들 + 리사이즈 핸들 + × 버튼 표시
   → 전체 배경 블루 틴트, 위젯 테두리 대시 점선
   → 하단에 "위젯 추가" 카탈로그 패널 표시

3. 위젯 조작
   → 드래그: 위젯 헤더 잡고 이동 (다른 위젯은 자동 재배치)
   → 리사이즈: 우하단 핸들 드래그 (minW/minH ~ maxW/maxH 범위)
   → 숨기기: × 버튼 → 위젯 숨김 (카탈로그에서 다시 추가 가능)
   → 추가: 카탈로그에서 위젯 클릭 → 그리드 하단에 기본 크기로 추가

4. 위젯 내부 설정 (⚙ 버튼, 선택적)
   → 표시 건수 (5건 / 10건 / 전체)
   → 새로고침 간격 (10초 / 30초 / 60초 / 수동)
   → 설정값은 DashboardConfig.widgetSettings에 저장

5. 저장 / 취소
   → "저장" → API PUT → 편집 모드 종료
   → "취소" → 변경 사항 버리고 저장된 상태로 복원 (확인 다이얼로그)
   → "기본으로 초기화" → 확인 다이얼로그 → API DELETE → 역할별 기본값

6. 실행 취소 (Undo)
   → 편집 중 Ctrl+Z → 직전 조작 되돌리기 (히스토리 스택)
   → 최대 20단계
```

---

## 3. 위젯 카탈로그

### 3.1 위젯 정의 구조

```typescript
interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;                  // lucide 아이콘 이름
  component: React.LazyExoticComponent<React.ComponentType<WidgetProps>>;
  roles: Role[];                 // 빈 배열 = ALL
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
  category: WidgetCategory;
  settingsSchema: WidgetSettingDef[];  // 사용자 설정 가능 속성 (빈 배열 = 설정 없음)
  sizeModes: SizeMode[];         // 크기별 표시 모드
  dataSource: DataSourceDef | null; // API + 새로고침 정보 (null = 클라이언트 전용)
  collapseWhenEmpty: boolean;    // 데이터 없을 때 자동 축소 (h=1 mini 모드)
}

// 위젯별 사용자 설정 가능 속성
interface WidgetSettingDef {
  key: string;                   // 'maxItems' | 'refreshSec' | ...
  label: string;                 // '표시 건수'
  type: 'number' | 'select' | 'toggle';
  defaultValue: unknown;
  options?: { label: string; value: unknown }[];  // select용
  min?: number;                  // number용
  max?: number;
}

// 크기별 자동 표시 모드
interface SizeMode {
  condition: string;             // 'w<=3' | 'w>=8 && h>=3' | ...
  mode: string;                  // 'compact' | 'standard' | 'expanded'
  description: string;           // 사람이 읽을 수 있는 설명
}

// 데이터 소스 정보
interface DataSourceDef {
  queryKey: string;
  endpoint: string;
  defaultRefreshSec: number;
  refreshable: boolean;          // 사용자가 새로고침 간격 변경 가능
}

// 위젯 컴포넌트가 받는 props
interface WidgetProps {
  widgetId: string;
  width: number;                 // 현재 그리드 폭 (columns) — onResize로 추적
  height: number;                // 현재 그리드 높이 (rows) — onResize로 추적
  settings: Record<string, unknown>;
}

type WidgetCategory = 'patient' | 'clinical' | 'orders' | 'admin' | 'chart' | 'system';
type Role = 'DOCTOR' | 'NURSE' | 'ADMIN' | 'PHARMACIST' | 'LAB_TECH';
```

> **v1.1 대비 변경**: `hasSettings` 제거 → `settingsSchema.length > 0`으로 판단, `collapseWhenEmpty` 추가, `dataSource: null` 허용, WidgetProps에 width/height 전달 방법 주석

### 3.2 위젯 상세 명세 (27종)

> 각 위젯의 크기 제약, 설정 가능 속성, 크기별 표시 모드를 정의합니다.

---

#### `stat-bar` — 요약 통계

| 속성 | 값 |
|------|-----|
| 카테고리 | system |
| 역할 | ALL |
| 기본 WxH | **12x1** |
| 최소/최대 | 6x1 ~ 12x1 |
| static | **true** (이동/리사이즈 불가) |
| API | `GET /api/v1/dashboard/overview` (30초) |

**설정 속성**: 없음 (역할에 따라 자동 결정)

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w >= 10 | full | 5~6개 통계 카드 가로 나열 |
| w >= 6 | compact | 3개 + 나머지 축약 |

---

#### `census` — 담당 환자 센서스

| 속성 | 값 |
|------|-----|
| 카테고리 | patient |
| 역할 | DOC |
| 기본 WxH | 12x3 |
| 최소/최대 | 6x2 ~ 12x6 |
| API | `GET /api/v1/doctors/my-census` (30초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 환자 수 | number | 8 | 3~20 |
| `showVitals` | 바이탈 표시 | toggle | true | — |
| `showAlerts` | 검사/처방 건수 | toggle | true | — |
| `sortBy` | 정렬 기준 | select | status | status / ward / name / admitDate |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 6 | compact | 이름 + 상태배지 + 병실만 (1줄) |
| w >= 7 && h <= 2 | standard | 이름 + 상태 + 진단 + 병실 (1줄) |
| w >= 7 && h >= 3 | expanded | 이름 + 상태 + 진단 + 바이탈 + 검사/처방 건수 + 병실 |
| w >= 10 && h >= 4 | full | expanded + 회진시간 + 간호기록건수 + 재원일수 |

---

#### `my-queue` — 내 대기 환자

| 속성 | 값 |
|------|-----|
| 카테고리 | patient |
| 역할 | DOC, ADMIN |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x4 |
| API | `GET /api/v1/queue/my` (10초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `showVisitType` | 초진/재진 표시 | toggle | true | — |
| `autoCallNext` | 다음 환자 호출 버튼 | toggle | true | — |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | mini | 대기 인원 숫자 + "호출" 버튼만 |
| w <= 3 | compact | 번호 + 이름 + 대기시간 (버튼 축소) |
| w >= 4 | standard | 번호 + 이름 + 초진/재진 + 대기시간 + 호출/진료 버튼 |
| h >= 3 | expanded | standard + "다음 환자 호출 → 진료 시작" 풀 버튼 |

---

#### `schedule` — 오늘 진료표

| 속성 | 값 |
|------|-----|
| 카테고리 | clinical |
| 역할 | DOC |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x2 |
| API | `GET /api/v1/clinic-schedule/today` (60초) |

**설정 속성**: 없음

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | mini | `오전 09:00~12:30 · 오후 없음` 한 줄 |
| w <= 3 | compact | 오전/오후 각 1줄 (시간만) |
| w >= 4 | standard | 오전/오후 + 진료실 배지 |

---

#### `draft-charts` — 미완료 차트

| 속성 | 값 |
|------|-----|
| 카테고리 | clinical |
| 역할 | DOC |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x4 |
| API | `GET /api/v1/encounters?status=DRAFT&mine=true` (15초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 5 | 3~15 |
| `showReason` | 주소(CC) 표시 | toggle | false | — |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | mini | 건수 배지만 ("서명 필요 10건") |
| w <= 3 | compact | 이름 + 날짜 |
| w >= 4 | standard | 이름 + CC/사유 + 날짜 |

---

#### `inpatients` — 담당 입원환자

| 속성 | 값 |
|------|-----|
| 카테고리 | patient |
| 역할 | DOC, NURSE |
| 기본 WxH | 6x2 |
| 최소/최대 | 4x1 ~ 12x5 |
| API | `GET /api/v1/inpatient` (30초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 환자 수 | number | 5 | 3~15 |
| `showDiet` | 식이 표시 | toggle | true | — (NURSE 기본 true) |
| `showAdmitDays` | 재원일수 | toggle | true | — |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 4 | compact | 병실 + 이름만 |
| w >= 5 && w <= 8 | standard | 병실 + 이름 + 진단 + 입원일 |
| w >= 9 | expanded | 병실 + 이름 + 진단 + 식이배지 + 재원일수 + 입원일 |
| h >= 4 | tall | 표시 건수 자동 증가 (maxItems × 1.5) |

---

#### `surgery` — 오늘 수술 일정

| 속성 | 값 |
|------|-----|
| 카테고리 | clinical |
| 역할 | DOC, NURSE, ADMIN |
| 기본 WxH | 6x2 |
| 최소/최대 | 4x1 ~ 12x3 |
| API | `GET /api/v1/surgery/schedule` (30초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `filterMine` | 내 수술만 | toggle | true | — (DOC: true, ADMIN: false) |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 4 | compact | 시간 + 환자명 + 상태배지 |
| w >= 5 | standard | 시간 + 환자명 + 수술명 + 상태배지 |

---

#### `lab-results` — 검사결과 도착

| 속성 | 값 |
|------|-----|
| 카테고리 | orders |
| 역할 | DOC, LAB |
| 기본 WxH | 12x2 |
| 최소/최대 | 6x1 ~ 12x4 |
| API | `GET /api/v1/orders?department=LAB&status=COMPLETED&mine=true` (15초) + IMAGING |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 8 | 3~20 |
| `departments` | 표시 부서 | select | all | all / LAB / IMAGING |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 6 | compact | 검사/영상 배지 + 환자명 + 시간 |
| w >= 7 | standard | 배지 + 환자명 + 검사명 + 완료시간 |
| h >= 3 | tall | maxItems 자동 증가 |

---

#### `handoff` — 인수인계

| 속성 | 값 |
|------|-----|
| 카테고리 | clinical |
| 역할 | DOC, NURSE |
| 기본 WxH | 6x2 |
| 최소/최대 | 4x1 ~ 12x4 |
| API (DOC) | `GET /api/v1/handoffs/pending` (30초) |
| API (NURSE) | `GET /api/v1/inpatient/handoffs?limit=3` (60초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 3 | 1~10 |
| `showWriteButton` | 작성 버튼 | toggle | true | — (NURSE 전용) |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | banner | "미확인 인수인계 N건" 한 줄 배너 |
| w <= 4 | compact | 유형 + 환자명 + 미확인 표시 |
| w >= 5 | standard | 유형 + 인계자→인수자 + 환자명 + 요약 + 시간 |
| w >= 8 && h >= 3 | expanded | standard + 인계 항목 2건 미리보기 |

---

#### `bed-status` — 병동/병상 현황

| 속성 | 값 |
|------|-----|
| 카테고리 | admin |
| 역할 | NURSE, ADMIN |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x3 |
| API | `GET /api/v1/beds/status` (15초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `showProgressBar` | 가동률 바 | toggle | true | — |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | mini | `총 N · 사용 N · 가용 N` 한 줄 |
| w <= 3 | compact | 총/사용/가용 3행 + 가동률 바 |
| w >= 4 | standard | compact + 가동률 % + 색상별 경고 |

---

#### `med-alert` — 투약 경고

| 속성 | 값 |
|------|-----|
| 카테고리 | orders |
| 역할 | NURSE |
| 기본 WxH | 4x1 |
| 최소/최대 | 3x1 ~ 12x3 |
| API | `GET /api/v1/orders?department=PHARMACY&status=PENDING` (15초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 4 | 2~10 |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | banner | "투약 대기 N건" 빨간 배너 (아이콘 + 숫자) |
| h >= 2 | list | 병실 + 환자명 + 약물명 + 예정시간 리스트 |
| w >= 8 | wide-list | list + 투여량 + 경로 칼럼 추가 |

---

#### `med-schedule` — 투약/바이탈 예정

| 속성 | 값 |
|------|-----|
| 카테고리 | orders |
| 역할 | NURSE |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x4 |
| API | `GET /api/v1/nurse/upcoming-medications` (60초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxGroups` | 표시 시간대 수 | number | 4 | 2~8 |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | mini | "N건 투약 예정" 숫자만 |
| w <= 3 | compact | 시간 + 환자명 |
| w >= 4 | standard | 시간별 그룹 + 환자명 + 투여량 + 경로 |

---

#### `shift-info` — 근무 현황

| 속성 | 값 |
|------|-----|
| 카테고리 | system |
| 역할 | NURSE |
| 기본 WxH | 4x1 |
| 최소/최대 | 3x1 ~ 6x2 |
| API | 없음 (클라이언트 시간 계산) |

**설정 속성**: 없음

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 3 | compact | 근무조 배지 + 날짜 |
| w >= 4 && h == 1 | standard | 근무조 배지 + 날짜 + 담당환자 N / 투약대기 N |
| h >= 2 | expanded | standard + 통계 2x2 그리드 (담당환자/투약대기/바이탈미체크/인수인계) |

---

#### `revenue` — 매출/수납 현황

| 속성 | 값 |
|------|-----|
| 카테고리 | admin |
| 역할 | ADMIN |
| 기본 WxH | 6x2 |
| 최소/최대 | 4x1 ~ 12x3 |
| API | `GET /api/v1/dashboard/summary` (15초) + `GET /api/v1/billings?status=PENDING` |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `showPending` | 미수납 목록 | toggle | true | — |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 4 | compact | 오늘 매출 + 미수납 건수 숫자 |
| w >= 5 | standard | 통계 카드 4개 (환자수/진료수/예약/미수납) |
| w >= 8 | expanded | standard + 미수납 환자 목록 |

---

#### `claims` — 보험 청구 요약

| 속성 | 값 |
|------|-----|
| 카테고리 | admin |
| 역할 | ADMIN |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x3 |
| API | `GET /api/v1/claims/summary` (30초) |

**설정 속성**: 없음

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | mini | 미청구 N / 심사중 N / 승인 N 한 줄 |
| w <= 3 | compact | 3행 (미청구/심사중/승인) |
| w >= 4 | standard | 4행 + 수납 추가 + 비율 바 |

---

#### `pharmacy-queue` — 조제 대기

| 속성 | 값 |
|------|-----|
| 카테고리 | orders |
| 역할 | PHARM |
| 기본 WxH | 8x2 |
| 최소/최대 | 4x1 ~ 12x5 |
| API | `GET /api/v1/pharmacy/queue` (10초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 10 | 5~30 |
| `highlightStat` | 긴급 강조 | toggle | true | — |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 4 | compact | 환자명 + 상태배지 (1줄) |
| w >= 5 && w <= 8 | standard | 환자명 + 약물명 + 우선순위배지 + 대기시간 |
| w >= 9 | expanded | standard + 투여량/용법 칼럼 |
| h >= 3 | tall | maxItems 자동 증가 |

---

#### `low-stock` — 재고 부족 알림

| 속성 | 값 |
|------|-----|
| 카테고리 | admin |
| 역할 | PHARM |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x1 ~ 6x4 |
| API | `GET /api/v1/inventory` (60초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 5 | 3~15 |
| `threshold` | 부족 기준 | select | safety | safety / 50% / 30% |

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| h == 1 | banner | "재고 부족 N건" 경고 배너 |
| w <= 3 | compact | 약품명 + 현재재고/안전재고 |
| w >= 4 | standard | 약품명 + 현재재고 + 안전재고 + 부족비율 바 |

---

#### `lab-queue` — 검사 대기

| 속성 | 값 |
|------|-----|
| 카테고리 | orders |
| 역할 | LAB |
| 기본 WxH | 6x3 |
| 최소/최대 | 4x1 ~ 12x5 |
| API | `GET /api/v1/lab/queue` (10초) |

**설정 속성**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `maxItems` | 표시 건수 | number | 10 | 5~30 |

**크기별 표시 모드**: pharmacy-queue와 동일 패턴

---

#### `imaging-queue` — 영상 대기

| 속성 | 값 |
|------|-----|
| 카테고리 | orders |
| 역할 | LAB |
| 기본 WxH | 6x3 |
| 최소/최대 | 4x1 ~ 12x5 |
| API | `GET /api/v1/orders?department=IMAGING&status=ORDERED` (15초) |

**설정 속성/크기별 모드**: lab-queue와 동일 패턴

---

#### `chart-hourly` / `chart-weekly` / `chart-dept` / `chart-ktas` / `chart-revenue` / `chart-beds` — 차트 위젯 (6종 공통)

| 속성 | 값 |
|------|-----|
| 카테고리 | chart |
| 기본 WxH | 6x2 |
| 최소/최대 | 4x2 ~ 12x4 |
| API | `GET /api/v1/dashboard/charts` (60초), revenue (300초), beds (300초) |

**설정 속성 (공통)**:

| key | label | type | 기본값 | 범위/옵션 |
|-----|-------|------|--------|-----------|
| `chartHeight` | 차트 높이 | select | auto | auto / 120 / 160 / 200 |
| `showLegend` | 범례 표시 | toggle | 차트별 상이 | — |

**크기별 표시 모드 (공통)**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 5 | compact | 차트만, 범례 숨김, 축 라벨 최소화 |
| w >= 6 && w <= 8 | standard | 차트 + 제목, 범례 선택적 |
| w >= 9 | expanded | 차트 + 범례 + 축 라벨 전체 |
| h >= 3 | tall | chartHeight 자동 증가 |

**차트별 고유 속성**:

| 위젯 | 추가 설정 | 역할 |
|------|----------|------|
| `chart-hourly` | — | ALL |
| `chart-weekly` | `period`: 7일/14일/30일 (기본 7) | ALL |
| `chart-dept` | — | ALL |
| `chart-ktas` | — | ALL |
| `chart-revenue` | `period`: 6개월/12개월 (기본 6) | ADMIN |
| `chart-beds` | — | ADMIN, NURSE |

---

#### `quick-actions` — 바로가기

| 속성 | 값 |
|------|-----|
| 카테고리 | system |
| 역할 | ALL |
| 기본 WxH | 8x1 |
| 최소/최대 | 4x1 ~ 12x2 |

**설정 속성**: 없음 (역할에 따라 자동)

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 4 | compact | 4개 아이콘 (2x2 그리드) |
| w >= 5 && h == 1 | standard | 4개 아이콘 가로 나열 |
| h >= 2 | expanded | 8개 아이콘 (4x2 그리드) |

---

#### `session-info` — 접속 정보

| 속성 | 값 |
|------|-----|
| 카테고리 | system |
| 역할 | ALL |
| 기본 WxH | 4x2 |
| 최소/최대 | 3x2 ~ 6x3 |

**설정 속성**: 없음

**크기별 표시 모드**:

| 조건 | 모드 | 표시 |
|------|------|------|
| w <= 3 | compact | 이름 + 역할 + 시스템 상태만 |
| w >= 4 | standard | 아바타 + 이름/이메일 + 직책/부서/사번 + 시스템 정보 |
| h >= 3 | expanded | standard + 면허번호 + 전문분야 + 오늘 진료실 |

---

### 3.3 크기 모드 구현 패턴

위젯 컴포넌트는 `width`/`height` props를 받아 자동으로 표시 모드를 결정합니다:

```typescript
// 위젯 내부에서 크기 모드 결정
function useSizeMode(width: number, height: number, modes: SizeMode[]): string {
  for (const mode of modes) {
    // condition 파싱: 'w<=3' → width <= 3, 'w>=8 && h>=3' → width >= 8 && height >= 3
    if (evaluateCondition(mode.condition, width, height)) {
      return mode.mode;
    }
  }
  return 'standard';
}

// 위젯 사용 예시
function CensusWidget({ width, height, settings }: WidgetProps) {
  const mode = useSizeMode(width, height, CENSUS_SIZE_MODES);
  const maxItems = (settings.maxItems as number) ?? 8;

  return (
    <div>
      {mode === 'compact' && <CensusCompact items={items} max={maxItems} />}
      {mode === 'standard' && <CensusStandard items={items} max={maxItems} showVitals={false} />}
      {mode === 'expanded' && <CensusExpanded items={items} max={maxItems} showVitals showAlerts />}
      {mode === 'full' && <CensusFull items={items} max={maxItems} />}
    </div>
  );
}
```

> **27종** (cert-banner는 조건부 배너로 그리드 외부 유지)

### 3.3 역할별 기본 레이아웃 + 위젯 설정 (Default Configs) — 전 5종

편집하지 않은 사용자는 현재 하드코딩 배치와 동일한 기본값을 보게 됩니다.
`default-layouts.ts`에 아래 JSON을 역할별로 export합니다.

---

#### DOCTOR 기본 구성 (11위젯)

**레이아웃 (12-column grid)**:
```
Row 0:  [stat-bar ──────────────────────────── 12x1] static
Row 1:  [census ────────────────────────────── 12x3]
Row 4:  [schedule 4x2] [draft-charts 4x2] [my-queue 4x2]
Row 6:  [inpatients ──── 6x2] [surgery ──── 6x2]
Row 8:  [lab-results ──────────────────────── 12x2]
Row 10: [chart-hourly ── 6x2] [chart-weekly ── 6x2]
Row 12: [quick-actions ── 8x1] [session-info ── 4x2]
```

**위젯별 기본 설정**:

| 위젯 | 설정 key | 기본값 | 의사 전용 사유 |
|------|---------|--------|---------------|
| `stat-bar` | (자동) | 5칼럼: 대기/예약/진료/미완료차트/검사결과 | 의사 KPI |
| `census` | maxItems | **8** | 담당 환자 전체 조망 |
| | showVitals | **true** | 회진 전 바이탈 확인 |
| | showAlerts | **true** | 미확인 검사/처방 확인 |
| | sortBy | **status** | 위급→안정 순 |
| `my-queue` | showVisitType | **true** | 초진/재진 구분 중요 |
| | autoCallNext | **true** | 빠른 환자 호출 |
| `schedule` | (없음) | — | |
| `draft-charts` | maxItems | **5** | |
| | showReason | **false** | 공간 절약 |
| `inpatients` | maxItems | **5** | |
| | showDiet | **false** | 의사는 식이보다 진단 중심 |
| | showAdmitDays | **true** | |
| `surgery` | filterMine | **true** | 내 수술만 |
| `lab-results` | maxItems | **8** | |
| | departments | **all** | 검사+영상 모두 |
| `chart-hourly` | showLegend | **false** | |
| `chart-weekly` | period | **7** | |
| | showLegend | **false** | |

**숨김 위젯** (hiddenWidgets): `[]` — 없음

```typescript
export const DOCTOR_DEFAULT: DashboardConfig = {
  version: 1,
  layouts: {
    lg: [
      { i: 'stat-bar',      x: 0,  y: 0,  w: 12, h: 1, static: true },
      { i: 'census',        x: 0,  y: 1,  w: 12, h: 3 },
      { i: 'schedule',      x: 0,  y: 4,  w: 4,  h: 2 },
      { i: 'draft-charts',  x: 4,  y: 4,  w: 4,  h: 2 },
      { i: 'my-queue',      x: 8,  y: 4,  w: 4,  h: 2 },
      { i: 'inpatients',    x: 0,  y: 6,  w: 6,  h: 2 },
      { i: 'surgery',       x: 6,  y: 6,  w: 6,  h: 2 },
      { i: 'lab-results',   x: 0,  y: 8,  w: 12, h: 2 },
      { i: 'chart-hourly',  x: 0,  y: 10, w: 6,  h: 2 },
      { i: 'chart-weekly',  x: 6,  y: 10, w: 6,  h: 2 },
      { i: 'quick-actions', x: 0,  y: 12, w: 8,  h: 1 },
      { i: 'session-info',  x: 8,  y: 12, w: 4,  h: 2 },
    ],
    md: [], // lg에서 자동 재배치
    sm: [], // lg에서 자동 재배치
  },
  hiddenWidgets: [],
  widgetSettings: {
    'census':       { maxItems: 8, showVitals: true, showAlerts: true, sortBy: 'status' },
    'my-queue':     { showVisitType: true, autoCallNext: true },
    'draft-charts': { maxItems: 5, showReason: false },
    'inpatients':   { maxItems: 5, showDiet: false, showAdmitDays: true },
    'surgery':      { filterMine: true },
    'lab-results':  { maxItems: 8, departments: 'all' },
    'chart-hourly': { showLegend: false },
    'chart-weekly': { period: 7, showLegend: false },
  },
};
```

---

#### NURSE 기본 구성 (11위젯)

**레이아웃**:
```
Row 0:  [stat-bar ──────────────────────────── 12x1] static
Row 1:  [shift-info 4x1] [med-alert ──── 4x1] [bed-status 4x2]
Row 2:  [med-schedule 4x2] [my-queue ──── 4x2]
Row 4:  [inpatients ──── 8x2] [handoff ──── 4x2]
Row 6:  [chart-hourly ── 6x2] [chart-ktas ── 6x2]
Row 8:  [quick-actions ── 8x1] [session-info ── 4x2]
```

**위젯별 기본 설정**:

| 위젯 | 설정 key | 기본값 | 간호사 전용 사유 |
|------|---------|--------|----------------|
| `stat-bar` | (자동) | 5칼럼: 대기/예약/투약대기/입원환자/미수납 | 간호 KPI |
| `shift-info` | (없음) | — | |
| `med-alert` | maxItems | **4** | 긴급 투약 즉시 확인 |
| `bed-status` | showProgressBar | **true** | 가동률 시각화 |
| `med-schedule` | maxGroups | **4** | 시간대별 4그룹 |
| `my-queue` | showVisitType | **true** | |
| | autoCallNext | **false** | 간호사는 직접 호출 안 함 |
| `inpatients` | maxItems | **8** | 병동 환자 전체 |
| | showDiet | **true** | **식이 관리 핵심** |
| | showAdmitDays | **true** | |
| `handoff` | maxItems | **3** | |
| | showWriteButton | **true** | 근무교대 시 작성 |
| `chart-hourly` | showLegend | **false** | |
| `chart-ktas` | showLegend | **false** | |

```typescript
export const NURSE_DEFAULT: DashboardConfig = {
  version: 1,
  layouts: {
    lg: [
      { i: 'stat-bar',      x: 0,  y: 0,  w: 12, h: 1, static: true },
      { i: 'shift-info',    x: 0,  y: 1,  w: 4,  h: 1 },
      { i: 'med-alert',     x: 4,  y: 1,  w: 4,  h: 1 },
      { i: 'bed-status',    x: 8,  y: 1,  w: 4,  h: 2 },
      { i: 'med-schedule',  x: 0,  y: 2,  w: 4,  h: 2 },
      { i: 'my-queue',      x: 4,  y: 2,  w: 4,  h: 2 },
      { i: 'inpatients',    x: 0,  y: 4,  w: 8,  h: 2 },
      { i: 'handoff',       x: 8,  y: 4,  w: 4,  h: 2 },
      { i: 'chart-hourly',  x: 0,  y: 6,  w: 6,  h: 2 },
      { i: 'chart-ktas',    x: 6,  y: 6,  w: 6,  h: 2 },
      { i: 'quick-actions', x: 0,  y: 8,  w: 8,  h: 1 },
      { i: 'session-info',  x: 8,  y: 8,  w: 4,  h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {
    'med-alert':    { maxItems: 4 },
    'bed-status':   { showProgressBar: true },
    'med-schedule': { maxGroups: 4 },
    'my-queue':     { showVisitType: true, autoCallNext: false },
    'inpatients':   { maxItems: 8, showDiet: true, showAdmitDays: true },
    'handoff':      { maxItems: 3, showWriteButton: true },
    'chart-hourly': { showLegend: false },
    'chart-ktas':   { showLegend: false },
  },
};
```

---

#### ADMIN 기본 구성 (9위젯)

**레이아웃**:
```
Row 0:  [stat-bar ──────────────────────────── 12x1] static
Row 1:  [revenue ──── 6x2] [bed-status ── 6x2]
Row 3:  [inpatients ── 4x2] [claims ── 4x2] [surgery ── 4x2]
Row 5:  [chart-hourly ── 6x2] [chart-revenue ── 6x2]
Row 7:  [quick-actions ── 8x1] [session-info ── 4x2]
```

**위젯별 기본 설정**:

| 위젯 | 설정 key | 기본값 | 관리자 전용 사유 |
|------|---------|--------|----------------|
| `stat-bar` | (자동) | 6칼럼: 대기/예약/진료/미완료/오더/미수납 | 경영 KPI 전체 |
| `revenue` | showPending | **true** | 미수납 목록 |
| `bed-status` | showProgressBar | **true** | |
| `inpatients` | maxItems | **5** | |
| | showDiet | **false** | |
| | showAdmitDays | **true** | |
| `claims` | (없음) | — | |
| `surgery` | filterMine | **false** | **전체 수술 일정** |
| `chart-hourly` | showLegend | **false** | |
| `chart-revenue` | period | **6** | 6개월 |
| | showLegend | **false** | |

```typescript
export const ADMIN_DEFAULT: DashboardConfig = {
  version: 1,
  layouts: {
    lg: [
      { i: 'stat-bar',       x: 0,  y: 0,  w: 12, h: 1, static: true },
      { i: 'revenue',        x: 0,  y: 1,  w: 6,  h: 2 },
      { i: 'bed-status',     x: 6,  y: 1,  w: 6,  h: 2 },
      { i: 'inpatients',     x: 0,  y: 3,  w: 4,  h: 2 },
      { i: 'claims',         x: 4,  y: 3,  w: 4,  h: 2 },
      { i: 'surgery',        x: 8,  y: 3,  w: 4,  h: 2 },
      { i: 'chart-hourly',   x: 0,  y: 5,  w: 6,  h: 2 },
      { i: 'chart-revenue',  x: 6,  y: 5,  w: 6,  h: 2 },
      { i: 'quick-actions',  x: 0,  y: 7,  w: 8,  h: 1 },
      { i: 'session-info',   x: 8,  y: 7,  w: 4,  h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {
    'revenue':       { showPending: true },
    'bed-status':    { showProgressBar: true },
    'inpatients':    { maxItems: 5, showDiet: false, showAdmitDays: true },
    'surgery':       { filterMine: false },
    'chart-hourly':  { showLegend: false },
    'chart-revenue': { period: 6, showLegend: false },
  },
};
```

---

#### PHARMACIST 기본 구성 (6위젯)

**레이아웃**:
```
Row 0:  [stat-bar ──────────────────────────── 12x1] static
Row 1:  [pharmacy-queue ──────── 8x3] [low-stock ── 4x3]
Row 4:  [chart-hourly ── 6x2] [chart-ktas ── 6x2]
Row 6:  [quick-actions ── 8x1] [session-info ── 4x2]
```

**위젯별 기본 설정**:

| 위젯 | 설정 key | 기본값 | 약사 전용 사유 |
|------|---------|--------|---------------|
| `stat-bar` | (자동) | 5칼럼: 대기/예약/진료/오더/미수납 | |
| `pharmacy-queue` | maxItems | **10** | 조제 대기 전체 |
| | highlightStat | **true** | 긴급 처방 강조 |
| `low-stock` | maxItems | **5** | |
| | threshold | **safety** | 안전재고 기준 |
| `chart-hourly` | showLegend | **false** | |
| `chart-ktas` | showLegend | **false** | |

```typescript
export const PHARMACIST_DEFAULT: DashboardConfig = {
  version: 1,
  layouts: {
    lg: [
      { i: 'stat-bar',       x: 0,  y: 0, w: 12, h: 1, static: true },
      { i: 'pharmacy-queue', x: 0,  y: 1, w: 8,  h: 3 },
      { i: 'low-stock',      x: 8,  y: 1, w: 4,  h: 3 },
      { i: 'chart-hourly',   x: 0,  y: 4, w: 6,  h: 2 },
      { i: 'chart-ktas',     x: 6,  y: 4, w: 6,  h: 2 },
      { i: 'quick-actions',  x: 0,  y: 6, w: 8,  h: 1 },
      { i: 'session-info',   x: 8,  y: 6, w: 4,  h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {
    'pharmacy-queue': { maxItems: 10, highlightStat: true },
    'low-stock':      { maxItems: 5, threshold: 'safety' },
    'chart-hourly':   { showLegend: false },
    'chart-ktas':     { showLegend: false },
  },
};
```

---

#### LAB_TECH 기본 구성 (6위젯)

**레이아웃**:
```
Row 0:  [stat-bar ──────────────────────────── 12x1] static
Row 1:  [lab-queue ──── 6x3] [imaging-queue ── 6x3]
Row 4:  [chart-hourly ── 6x2] [chart-ktas ── 6x2]
Row 6:  [quick-actions ── 8x1] [session-info ── 4x2]
```

**위젯별 기본 설정**:

| 위젯 | 설정 key | 기본값 | 검사실 전용 사유 |
|------|---------|--------|----------------|
| `stat-bar` | (자동) | 6칼럼: 대기/예약/진료/미완료/오더/미수납 | |
| `lab-queue` | maxItems | **10** | 검사 대기 전체 |
| `imaging-queue` | maxItems | **10** | 영상 대기 전체 |
| `chart-hourly` | showLegend | **false** | |
| `chart-ktas` | showLegend | **false** | |

```typescript
export const LAB_TECH_DEFAULT: DashboardConfig = {
  version: 1,
  layouts: {
    lg: [
      { i: 'stat-bar',       x: 0,  y: 0, w: 12, h: 1, static: true },
      { i: 'lab-queue',      x: 0,  y: 1, w: 6,  h: 3 },
      { i: 'imaging-queue',  x: 6,  y: 1, w: 6,  h: 3 },
      { i: 'chart-hourly',   x: 0,  y: 4, w: 6,  h: 2 },
      { i: 'chart-ktas',     x: 6,  y: 4, w: 6,  h: 2 },
      { i: 'quick-actions',  x: 0,  y: 6, w: 8,  h: 1 },
      { i: 'session-info',   x: 8,  y: 6, w: 4,  h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {
    'lab-queue':     { maxItems: 10 },
    'imaging-queue': { maxItems: 10 },
    'chart-hourly':  { showLegend: false },
    'chart-ktas':    { showLegend: false },
  },
};
```

---

#### 기본 설정 로더 함수

```typescript
// default-layouts.ts

const DEFAULT_CONFIGS: Record<string, DashboardConfig> = {
  DOCTOR:     DOCTOR_DEFAULT,
  NURSE:      NURSE_DEFAULT,
  ADMIN:      ADMIN_DEFAULT,
  PHARMACIST: PHARMACIST_DEFAULT,
  LAB_TECH:   LAB_TECH_DEFAULT,
};

export function getDefaultConfig(role?: string): DashboardConfig {
  return structuredClone(DEFAULT_CONFIGS[role ?? 'DOCTOR'] ?? DOCTOR_DEFAULT);
}

// 역할별 stat-bar 칼럼 구성
export const STAT_BAR_COLUMNS: Record<string, Array<{ label: string; key: string; color: string; href: string }>> = {
  DOCTOR: [
    { label: '내 대기 환자', key: 'myWaiting',         color: 'blue',    href: '/reception' },
    { label: '오늘 내 예약', key: 'todayAppointments',  color: 'indigo',  href: '/schedule' },
    { label: '오늘 진료',    key: 'todayEncounters',    color: 'emerald', href: '/patients' },
    { label: '내 미완료 차트', key: 'draftEncounters',  color: 'amber',   href: '/patients' },
    { label: '내 검사결과',  key: 'pendingOrders',      color: 'rose',    href: '/orders' },
  ],
  NURSE: [
    { label: '대기 환자',    key: 'myWaiting',          color: 'blue',    href: '/reception' },
    { label: '오늘 예약',    key: 'todayAppointments',  color: 'indigo',  href: '/schedule' },
    { label: '투약 대기',    key: 'pendingOrders',      color: 'rose',    href: '/orders' },
    { label: '입원 환자',    key: 'draftEncounters',    color: 'amber',   href: '/inpatient' },
    { label: '미수납',       key: 'pendingBillings',    color: 'gray',    href: '/billing' },
  ],
  ADMIN: [
    { label: '대기 환자',    key: 'myWaiting',          color: 'blue',    href: '/reception' },
    { label: '오늘 예약',    key: 'todayAppointments',  color: 'indigo',  href: '/schedule' },
    { label: '오늘 진료',    key: 'todayEncounters',    color: 'emerald', href: '/patients' },
    { label: '미완료 차트',  key: 'draftEncounters',    color: 'amber',   href: '/patients' },
    { label: '대기 오더',    key: 'pendingOrders',      color: 'rose',    href: '/orders' },
    { label: '미수납',       key: 'pendingBillings',    color: 'gray',    href: '/billing' },
  ],
  PHARMACIST: [
    { label: '대기 환자',    key: 'myWaiting',          color: 'blue',    href: '/reception' },
    { label: '오늘 예약',    key: 'todayAppointments',  color: 'indigo',  href: '/schedule' },
    { label: '오늘 진료',    key: 'todayEncounters',    color: 'emerald', href: '/patients' },
    { label: '대기 오더',    key: 'pendingOrders',      color: 'rose',    href: '/orders' },
    { label: '미수납',       key: 'pendingBillings',    color: 'gray',    href: '/billing' },
  ],
  LAB_TECH: [
    { label: '대기 환자',    key: 'myWaiting',          color: 'blue',    href: '/reception' },
    { label: '오늘 예약',    key: 'todayAppointments',  color: 'indigo',  href: '/schedule' },
    { label: '오늘 진료',    key: 'todayEncounters',    color: 'emerald', href: '/patients' },
    { label: '미완료 차트',  key: 'draftEncounters',    color: 'amber',   href: '/patients' },
    { label: '대기 오더',    key: 'pendingOrders',      color: 'rose',    href: '/orders' },
    { label: '미수납',       key: 'pendingBillings',    color: 'gray',    href: '/billing' },
  ],
};
```

### 3.4 역할별 기본 설정 차이 요약

| 설정 key | DOCTOR | NURSE | ADMIN | PHARM | LAB |
|---------|--------|-------|-------|-------|-----|
| census.maxItems | 8 | — | — | — | — |
| census.showVitals | true | — | — | — | — |
| inpatients.showDiet | **false** | **true** | false | — | — |
| inpatients.maxItems | 5 | **8** | 5 | — | — |
| surgery.filterMine | **true** | — | **false** | — | — |
| my-queue.autoCallNext | **true** | **false** | — | — | — |
| handoff.showWriteButton | — | **true** | — | — | — |
| pharmacy-queue.maxItems | — | — | — | **10** | — |
| lab-queue.maxItems | — | — | — | — | **10** |
| stat-bar 칼럼 수 | 5 | 5 | **6** | 5 | 6 |

> 같은 위젯이라도 역할에 따라 **기본 설정이 다름** — 의사는 진단 중심, 간호사는 투약/식이 중심, 관리자는 전체 조망

---

## 4. 기술 설계

### 4.1 라이브러리 선택

| 후보 | 장점 | 단점 | 판정 |
|------|------|------|:----:|
| **react-grid-layout** | Grid+리사이즈 내장, npm 주간 100만+, JSON 직렬화 | CSS import 필요, React 19 공식 미지원(동작은 함) | **채택** |
| @dnd-kit/core | 모던, 접근성, 트리셰이킹, React 19 지원 | 리사이즈 없음, 그리드 레이아웃 직접 구현 필요 | 부적합 |
| react-beautiful-dnd | 리스트 DnD 최적화 | 그리드 미지원, 메인테이너 종료, React 18+ 미지원 | 부적합 |
| react-mosaic | IDE 스타일 분할 | HIS 대시보드 UX와 부적합 | 부적합 |

**react-grid-layout 채택 이유**:
- 12-column 그리드 시스템 (현재 Tailwind grid와 개념 동일)
- 드래그 + 리사이즈 모두 내장
- `<ResponsiveGridLayout>` — 반응형 브레이크포인트 지원
- 레이아웃을 JSON 배열로 직렬화 → DB 저장 용이
- Next.js App Router + 'use client' 호환

**React 19 호환 대응**:
- react-grid-layout이 React 19를 공식 지원하지 않을 경우 `--legacy-peer-deps`로 설치
- 설치 후 드래그/리사이즈/반응형 동작 검증 필수
- 대안: `react-grid-layout` 대신 `@dnd-kit/core` + 자체 그리드 엔진 (공수 2배)

### 4.2 레이아웃 데이터 모델

```typescript
// 단일 위젯의 그리드 위치/크기
interface WidgetLayout {
  i: string;     // 위젯 ID ('census', 'schedule', ...)
  x: number;     // 그리드 X 위치 (0~11)
  y: number;     // 그리드 Y 위치
  w: number;     // 그리드 폭 (1~12)
  h: number;     // 그리드 높이
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean; // true면 이동/리사이즈 불가 (stat-bar)
}

// 사용자 대시보드 설정 전체
interface DashboardConfig {
  version: number;           // 스키마 버전 (마이그레이션용)
  layouts: {
    lg: WidgetLayout[];      // >= 1200px
    md: WidgetLayout[];      // >= 996px
    sm: WidgetLayout[];      // >= 768px
  };
  hiddenWidgets: string[];   // 숨긴 위젯 ID 목록
  widgetSettings: Record<string, Record<string, unknown>>; // 위젯별 설정
  // 예: { "census": { "maxItems": 10 }, "lab-results": { "refreshSec": 15 } }
}
```

**버전 마이그레이션 규칙**:
- `version: 1` — 초기 릴리스
- 위젯 ID가 변경/삭제되면 version 증가 + 마이그레이션 함수 작성
- 저장된 config의 version < 현재 version이면 `migrateConfig(saved, currentVersion)` 실행
- 삭제된 위젯 ID는 layouts에서 자동 제거, 신규 위젯은 기본 위치에 추가

```typescript
// 마이그레이션 예시
function migrateConfig(config: DashboardConfig): DashboardConfig {
  if (config.version < 2) {
    // v2에서 'nurse-handoff' → 'handoff'로 통합됨
    for (const bp of ['lg', 'md', 'sm'] as const) {
      config.layouts[bp] = config.layouts[bp].map(l =>
        l.i === 'nurse-handoff' ? { ...l, i: 'handoff' } : l
      );
    }
    config.version = 2;
  }
  return config;
}
```

### 4.3 저장소 (Backend)

**Prisma 모델 추가**:
```prisma
model UserDashboardConfig {
  id        String   @id @default(uuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  config    Json     @db.JsonB   // DashboardConfig JSON
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())

  @@map("user_dashboard_configs")
}
```

> 기존 Prisma 스키마에 Json @db.JsonB 패턴이 20+ 필드에서 사용 중이므로 일관성 유지

**User 모델에 relation 추가**:
```prisma
model User {
  // ... 기존 필드
  dashboardConfig UserDashboardConfig?  @relation("UserDashboard")
}
```

**API 엔드포인트 (3개)**:
```
GET    /api/v1/dashboard/config       → 내 레이아웃 조회 (없으면 역할별 기본값 반환)
PUT    /api/v1/dashboard/config       → 레이아웃 저장 (body: DashboardConfig)
DELETE /api/v1/dashboard/config       → 기본값으로 초기화 (DB 레코드 삭제)
```

**요청/응답 예시**:
```jsonc
// PUT /api/v1/dashboard/config
// Request Body
{
  "version": 1,
  "layouts": {
    "lg": [
      { "i": "stat-bar", "x": 0, "y": 0, "w": 12, "h": 1, "static": true },
      { "i": "census",   "x": 0, "y": 1, "w": 12, "h": 3 },
      { "i": "schedule", "x": 0, "y": 4, "w": 4,  "h": 2 }
    ],
    "md": [ /* ... */ ],
    "sm": [ /* ... */ ]
  },
  "hiddenWidgets": ["surgery", "chart-dept"],
  "widgetSettings": {
    "census": { "maxItems": 10 },
    "lab-results": { "refreshSec": 15 }
  }
}

// Response
{ "data": { "id": "uuid", "config": { ... }, "updatedAt": "..." } }
```

**저장 전략 (3계층)**:
1. **API → PostgreSQL JSONB** — 영구, 기기 간 동기화
2. **localStorage 폴백** — API 실패 시 임시 저장, 다음 접속 시 동기화 시도
3. **Zustand 메모리** — 편집 중 임시 상태 + 실행 취소(undo) 히스토리

**Config JSON 크기 제한**: 최대 64KB (위젯 27종 × 3 브레이크포인트 ≈ 약 5KB이므로 충분)

### 4.4 프론트엔드 구조

```
dashboard/
├── page.tsx                    ← 기존 → DashboardShell import로 교체
├── components/
│   ├── DashboardShell.tsx      ← NEW: 그리드 컨테이너 + 편집 모드
│   ├── WidgetWrapper.tsx       ← NEW: 위젯 프레임 (핸들, ×, ⚙)
│   ├── WidgetCatalog.tsx       ← NEW: 위젯 추가 패널
│   ├── EditToolbar.tsx         ← NEW: 편집 모드 툴바
│   ├── WidgetSettingsDialog.tsx← NEW: 위젯별 설정 다이얼로그
│   ├── widget-registry.ts     ← NEW: 위젯 정의 맵 + 기본 레이아웃
│   ├── default-layouts.ts     ← NEW: 역할별 기본 레이아웃 JSON (5종)
│   │
│   ├── widgets/                ← NEW: 위젯 컴포넌트 (기존 코드 이동)
│   │   ├── StatBarWidget.tsx        (← page.tsx 인라인 → 분리)
│   │   ├── CensusWidget.tsx         (← MyCensusPanel.tsx)
│   │   ├── QueueWidget.tsx          (← MyWaitingQueueWidget)
│   │   ├── ScheduleWidget.tsx       (← DoctorDashboard 인라인)
│   │   ├── DraftChartsWidget.tsx    (← DoctorDashboard 인라인)
│   │   ├── InpatientsWidget.tsx     (← DoctorDashboard + NurseDashboard 통합)
│   │   ├── SurgeryWidget.tsx        (← DoctorDashboard + AdminDashboard 통합)
│   │   ├── LabResultsWidget.tsx     (← DoctorDashboard 인라인)
│   │   ├── HandoffWidget.tsx        (← PendingHandoffBanner + NurseDashboard 통합)
│   │   ├── BedStatusWidget.tsx      (← NurseDashboard 인라인)
│   │   ├── MedAlertWidget.tsx       (← NurseDashboard 과투약 알림)
│   │   ├── MedScheduleWidget.tsx    (← NurseDashboard upcoming-meds)
│   │   ├── ShiftInfoWidget.tsx      (← NurseDashboard 근무조)
│   │   ├── RevenueWidget.tsx        (← AdminDashboard 인라인)
│   │   ├── ClaimsWidget.tsx         (← AdminDashboard 인라인)
│   │   ├── PharmacyQueueWidget.tsx  (← PharmacistDashboard 인라인)
│   │   ├── LowStockWidget.tsx       (← PharmacistDashboard 인라인)
│   │   ├── LabQueueWidget.tsx       (← LabTechDashboard 인라인)
│   │   ├── ImagingQueueWidget.tsx   (← LabTechDashboard 인라인)
│   │   ├── ChartHourlyWidget.tsx    (← DashboardCharts 분리)
│   │   ├── ChartWeeklyWidget.tsx    (← DashboardCharts 분리)
│   │   ├── ChartDeptWidget.tsx      (← DashboardCharts 분리)
│   │   ├── ChartKtasWidget.tsx      (← DashboardCharts 분리)
│   │   ├── ChartRevenueWidget.tsx   (← DashboardCharts 분리)
│   │   ├── ChartBedsWidget.tsx      (← DashboardCharts 분리)
│   │   ├── QuickActionsWidget.tsx   (← QuickActions)
│   │   └── SessionInfoWidget.tsx    (← SessionInfo)
│   │
│   ├── DoctorDashboard.tsx     ← 삭제 (위젯으로 대체)
│   ├── NurseDashboard.tsx      ← 삭제
│   ├── AdminDashboard.tsx      ← 삭제
│   ├── PharmacistDashboard.tsx ← 삭제
│   ├── LabTechDashboard.tsx    ← 삭제
│   ├── DashboardCharts.tsx     ← 삭제 (차트 위젯 6개로 분리)
│   ├── MyCensusPanel.tsx       ← 삭제 (CensusWidget으로 이동)
│   ├── MyWaitingQueueWidget.tsx← 삭제 (QueueWidget으로 이동)
│   ├── PendingHandoffBanner.tsx← 삭제 (HandoffWidget으로 통합)
│   ├── shared.tsx              ← 유지 (MiniStat, StatCard 등 공유 컴포넌트)
│   ├── QuickActions.tsx        ← 삭제 (QuickActionsWidget으로 이동)
│   └── SessionInfo.tsx         ← 삭제 (SessionInfoWidget으로 이동)
│
├── stores/
│   └── dashboard-store.ts      ← NEW: 편집 상태 + undo 히스토리
│
└── hooks/
    └── use-dashboard-config.ts ← NEW: API 연동 + localStorage 폴백
```

### 4.5 핵심 컴포넌트 설계

**DashboardShell.tsx**:
```tsx
'use client';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useDashboardStore } from '../stores/dashboard-store';
import { useDashboardConfig } from '../hooks/use-dashboard-config';
import WidgetWrapper from './WidgetWrapper';
import WidgetCatalog from './WidgetCatalog';
import EditToolbar from './EditToolbar';
import { WIDGET_REGISTRY } from './widget-registry';
import CertOnboardBanner from './CertOnboardBanner'; // 그리드 외부 유지

// react-grid-layout은 SSR 미지원 → dynamic import
const ResponsiveGrid = dynamic(
  () => import('react-grid-layout').then(mod => {
    const { WidthProvider, Responsive } = mod;
    return WidthProvider(Responsive);
  }),
  { ssr: false, loading: () => <GridSkeleton /> }
);

export default function DashboardShell() {
  const { isEditing, layouts, setLayouts, hiddenWidgets, widgetSettings } = useDashboardStore();
  const { save, reset, isLoading } = useDashboardConfig();
  // 위젯별 현재 크기를 추적 (onResize 이벤트로 갱신)
  const [widgetSizes, setWidgetSizes] = useState<Record<string, { w: number; h: number }>>({});

  if (isLoading) return <GridSkeleton />;

  const visibleWidgets = layouts.lg.filter(item =>
    !hiddenWidgets.includes(item.i) && WIDGET_REGISTRY[item.i]
  );

  return (
    <main className="max-w-7xl" aria-label="대시보드">
      <DashboardHeader />
      <CertOnboardBanner />

      {isEditing && <EditToolbar onSave={save} onReset={reset} />}

      <ResponsiveGrid
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 8, sm: 4 }}
        rowHeight={72}
        isDraggable={isEditing}
        isResizable={isEditing}
        draggableHandle=".widget-drag-handle"
        onLayoutChange={(_, allLayouts) => setLayouts(allLayouts)}
        onResize={(layout) => {
          // 위젯별 현재 크기 추적 → WidgetProps.width/height로 전달
          const sizes: Record<string, { w: number; h: number }> = {};
          layout.forEach(l => { sizes[l.i] = { w: l.w, h: l.h }; });
          setWidgetSizes(sizes);
        }}
        compactType="vertical"
        margin={[12, 12]}
        containerPadding={[0, 0]}
        useCSSTransforms
      >
        {visibleWidgets.map(item => {
          const def = WIDGET_REGISTRY[item.i];
          const size = widgetSizes[item.i] ?? { w: item.w, h: item.h };
          const settings = widgetSettings[item.i] ?? {};
          return (
            <div key={item.i}>
              <WidgetWrapper id={item.i} definition={def} isEditing={isEditing}>
                <Suspense fallback={<WidgetSkeleton />}>
                  <def.component
                    widgetId={item.i}
                    width={size.w}
                    height={size.h}
                    settings={settings}
                  />
                </Suspense>
              </WidgetWrapper>
            </div>
          );
        })}
      </ResponsiveGrid>

      {isEditing && <WidgetCatalog />}
    </main>
  );
}
```

**WidgetWrapper.tsx**:
```tsx
interface Props {
  id: string;
  definition: WidgetDefinition;
  isEditing: boolean;
  children: React.ReactNode;
}

export default function WidgetWrapper({ id, definition, isEditing, children }: Props) {
  const { hideWidget } = useDashboardStore();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className={`h-full flex flex-col overflow-hidden rounded-xl border transition-colors
      ${isEditing ? 'border-blue-300 border-dashed shadow-blue-100 shadow-md' : 'border-gray-100 bg-white'}`}>

      {/* 헤더: 일반 모드에서는 타이틀만, 편집 모드에서는 드래그 핸들 + 버튼 */}
      <div className={`flex items-center justify-between px-3 py-2 flex-shrink-0
        ${isEditing ? 'widget-drag-handle cursor-grab active:cursor-grabbing bg-blue-50/80' : ''}`}>
        <div className="flex items-center gap-2">
          {isEditing && (
            <svg className="w-3.5 h-3.5 text-blue-400" /* grip dots icon */ />
          )}
          <span className="text-sm font-bold text-gray-900">{definition.name}</span>
        </div>
        {isEditing && (
          <div className="flex items-center gap-1">
            {definition.settingsSchema.length > 0 && (
              <button onClick={() => setShowSettings(true)}
                className="p-1 text-gray-400 hover:text-blue-600" aria-label="위젯 설정">
                <CogIcon className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => hideWidget(id)}
              className="p-1 text-gray-400 hover:text-red-500" aria-label="위젯 숨기기">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-auto p-3">
        <ErrorBoundary fallback={<WidgetErrorFallback widgetId={id} />}>
          {children}
        </ErrorBoundary>
      </div>

      {/* 설정 다이얼로그 */}
      {showSettings && (
        <WidgetSettingsDialog
          widgetId={id}
          schema={definition.settingsSchema}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
```

**WidgetCatalog.tsx** (위젯 추가 패널):
```tsx
// 편집 모드에서 대시보드 하단에 고정 표시
// 구조:
// ┌──────────────────────────────────────────────────┐
// │ + 위젯 추가                                       │
// │ [환자] [임상] [오더] [관리] [차트] [시스템]  카테고리 탭 │
// │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐             │
// │ │🏥    │ │📋    │ │💊    │ │📊    │             │
// │ │센서스 │ │진료표 │ │투약   │ │시간별 │ ← 클릭=추가 │
// │ │✓배치됨│ │      │ │      │ │✓배치됨│             │
// │ └──────┘ └──────┘ └──────┘ └──────┘             │
// └──────────────────────────────────────────────────┘
//
// - 현재 역할에서 사용 가능한 위젯만 표시
// - 이미 배치된 위젯은 체크 표시 + 비활성 (중복 방지)
// - 숨긴 위젯은 "다시 추가" 가능
// - 클릭 시 layouts에 기본 크기로 추가 (y: Infinity → 자동으로 하단 배치)
```

### 4.6 Zustand Store

```typescript
// 스냅샷 (undo/취소용)
interface ConfigSnapshot {
  layouts: ReactGridLayout.Layouts;
  hiddenWidgets: string[];
  widgetSettings: Record<string, Record<string, unknown>>;
}

interface DashboardState {
  // 편집 상태
  isEditing: boolean;
  isDirty: boolean;

  // 레이아웃
  layouts: ReactGridLayout.Layouts;
  hiddenWidgets: string[];
  widgetSettings: Record<string, Record<string, unknown>>;

  // 실행 취소
  undoStack: ConfigSnapshot[];     // 최대 20단계
  originalSnapshot: ConfigSnapshot | null; // 편집 시작 시점 백업

  // 액션
  startEditing: () => void;       // 편집 시작 + 원본 스냅샷 저장
  cancelEditing: () => void;      // 원본 복원 + 편집 종료
  finishEditing: () => void;      // 편집 종료 (저장 후 호출)
  setLayouts: (layouts: ReactGridLayout.Layouts) => void;
  hideWidget: (id: string) => void;
  showWidget: (id: string, defaultLayout: WidgetLayout) => void; // 카탈로그에서 추가
  undo: () => void;               // Ctrl+Z — layouts + hiddenWidgets + widgetSettings 모두 복원
  setWidgetSetting: (widgetId: string, key: string, value: unknown) => void;

  // 초기화 / 직렬화
  loadConfig: (config: DashboardConfig) => void;
  resetToDefault: (role: string) => void;
  getConfig: () => DashboardConfig; // 현재 상태 → 저장용 DashboardConfig 변환
}
```

> **v1.1 대비 변경**: `ConfigSnapshot`에 `widgetSettings` 추가 (undo 시 설정도 복원), `getConfig()` 함수 명시, `showWidget`에 `defaultLayout` 파라미터 추가

### 4.7 API 연동 훅

```typescript
function useDashboardConfig() {
  const { user } = useAuthStore();
  const store = useDashboardStore();

  // 1. 서버에서 설정 로드
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-config'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/api/v1/dashboard/config');
        return res.data;
      } catch {
        // API 실패 → localStorage 폴백
        const saved = localStorage.getItem('dashboard-config');
        return saved ? JSON.parse(saved) : null;
      }
    },
    staleTime: Infinity, // 수동 갱신만
  });

  // 2. 설정이 없으면 역할별 기본값 로드
  useEffect(() => {
    if (!isLoading) {
      const config = data ? migrateConfig(data) : getDefaultConfig(user?.role);
      store.loadConfig(config);
    }
  }, [data, isLoading]);

  // 3. 저장
  const saveMutation = useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiClient.put('/api/v1/dashboard/config', config),
    onSuccess: () => {
      store.finishEditing();
      toast.success('대시보드 레이아웃이 저장되었습니다');
    },
    onError: () => {
      // API 실패 → localStorage에 임시 저장
      localStorage.setItem('dashboard-config', JSON.stringify(store.getConfig()));
      toast.error('저장 실패 — 로컬에 임시 저장되었습니다');
    },
  });

  // 4. 초기화
  const resetMutation = useMutation({
    mutationFn: () => apiClient.delete('/api/v1/dashboard/config'),
    onSuccess: () => {
      store.resetToDefault(user?.role ?? 'DOCTOR');
      localStorage.removeItem('dashboard-config');
      toast.success('기본 레이아웃으로 초기화되었습니다');
    },
  });

  return {
    isLoading,
    save: () => saveMutation.mutate(store.getConfig()),
    reset: resetMutation.mutate,
    isSaving: saveMutation.isPending,
  };
}
```

---

## 5. UX 세부 사항

### 5.1 편집 모드 시각 피드백

| 요소 | 일반 모드 | 편집 모드 |
|------|----------|----------|
| 위젯 헤더 | 투명, 타이틀만 | 파란 배경 + grip 아이콘 + 드래그 커서 |
| 위젯 테두리 | border-gray-100 solid | border-blue-300 dashed + shadow-blue |
| 리사이즈 핸들 | 숨김 | 우하단 대각선 ◢ 아이콘 |
| × 버튼 | 숨김 | 헤더 우측 표시 |
| ⚙ 버튼 | 숨김 | hasSettings인 위젯에만 표시 |
| 전체 배경 | bg-transparent | bg-blue-50/20 (편집 중 힌트) |
| 상단 툴바 | 숨김 | sticky 고정 바 |
| 드래그 중 원본 | — | 반투명 placeholder (border-blue-200 dashed) |

### 5.2 편집 툴바

```
┌────────────────────────────────────────────────────────────────┐
│  ✏️ 대시보드 편집 중        [Ctrl+Z 실행 취소] [기본으로 초기화] [취소] [저장] │
└────────────────────────────────────────────────────────────────┘
```

- sticky top-0, z-40, bg-blue-600 text-white
- "취소" 클릭 시 isDirty면 확인 다이얼로그 표시
- "기본으로 초기화" 클릭 시 확인 다이얼로그 (되돌릴 수 없음)

### 5.3 반응형 동작

| 화면 폭 | 컬럼 수 | 편집 | 동작 |
|---------|:-------:|:----:|------|
| >= 1200px (lg) | 12 | O | 전체 그리드, 자유 편집 |
| >= 996px (md) | 8 | O | 축소 그리드, 편집 가능 |
| >= 768px (sm) | 4 | X | 모바일 뷰, 편집 불가, 위젯 세로 스택 |
| < 768px | 4 | X | 편집 버튼 숨김, 단일 컬럼 |

> md/sm 레이아웃은 lg 레이아웃에서 **자동 재배치** (react-grid-layout 기본 동작)
> 사용자가 md/sm을 별도 편집할 필요 없음

### 5.4 위젯 크기 제약

- **rowHeight**: 72px (1 row unit = 72px + 12px margin = 84px 실제 높이)
- **margin**: [12, 12] px
- stat-bar는 `static: true` — 항상 최상단, 이동/리사이즈 불가
- cert-banner는 **그리드 외부** (조건부 표시 배너, 위젯 아님)
- 위젯별 minW/minH/maxW/maxH로 비현실적 크기 방지

### 5.5 위젯 내부 설정 (선택적 기능)

| 설정 | 적용 위젯 | 기본값 |
|------|----------|--------|
| 표시 건수 | census, inpatients, lab-results, pharmacy-queue, lab-queue | 5 |
| 자동 새로고침 | my-queue, lab-results, pharmacy-queue | 위젯별 기본값 |
| 차트 기간 | chart-weekly | 7일 |

### 5.6 키보드/접근성

- 편집 모드 진입/종료: 헤더 버튼 (Tab 접근 가능)
- 실행 취소: `Ctrl+Z` / `Cmd+Z`
- 위젯 순서 변경: **드래그 전용** (키보드 재배치는 v2 로드맵)
- 각 위젯에 `role="region"` + `aria-label` 부여
- 편집 모드 전환 시 `aria-live="polite"` 알림

### 5.7 에러 처리

| 상황 | 동작 |
|------|------|
| 레이아웃 API 로드 실패 | localStorage 폴백 → 그것도 없으면 역할별 기본값 |
| 레이아웃 저장 실패 | localStorage 임시 저장 + toast 경고 |
| 위젯 렌더링 에러 | ErrorBoundary → "위젯 로드 실패" 메시지 + 재시도 버튼 |
| 저장된 위젯 ID가 레지스트리에 없음 | 자동 제거 (삭제된 위젯) |
| 다중 기기 동시 편집 | 마지막 저장 우선 (last-write-wins), 충돌 감지 안 함 |

---

## 6. 구현 단계

### Phase 1: 기반 (BE + 인프라)
- [x] `UserDashboardConfig` Prisma 모델 + User relation 추가
- [ ] `prisma db push` (스키마 반영)
- [ ] Dashboard config controller/service (GET/PUT/DELETE)
- [ ] `react-grid-layout` + `@types/react-grid-layout` 설치 (React 19 호환 검증)
- [ ] CSS import 설정 (`react-grid-layout/css/styles.css`)
- [x] `dashboard-store.ts` Zustand 스토어
- [x] `use-dashboard-config.ts` API 연동 훅

### Phase 2: 위젯 분리
- [x] `widgets/` 디렉토리 생성
- [ ] DoctorDashboard → 8개 위젯 분리 (Schedule, DraftCharts, Inpatients, Surgery, LabResults 등)
- [ ] NurseDashboard → 8개 위젯 분리 (BedStatus, MedAlert, MedSchedule, ShiftInfo 등)
- [ ] AdminDashboard → 7개 위젯 분리 (Revenue, Claims 등)
- [ ] PharmacistDashboard → 4개 위젯 분리
- [ ] LabTechDashboard → 4개 위젯 분리
- [ ] DashboardCharts → 6개 차트 위젯 분리
- [ ] 공통 위젯: StatBar, QuickActions, SessionInfo
- [ ] `widget-registry.ts` 작성 (27종 등록)
- [x] `default-layouts.ts` 작성 (5종 기본 레이아웃)

### Phase 3: 그리드 시스템
- [ ] `DashboardShell.tsx` — `next/dynamic`으로 ResponsiveGrid SSR-safe 로드
- [x] `WidgetWrapper.tsx` — 위젯 프레임 + ErrorBoundary
- [ ] page.tsx → DashboardShell 교체
- [ ] 그리드 CSS 커스터마이징 (placeholder, 리사이즈 핸들)
- [ ] 기존 역할별 Dashboard 파일 삭제

### Phase 4: 편집 UX
- [x] `EditToolbar.tsx` — sticky 바, 저장/취소/초기화/undo
- [x] `WidgetCatalog.tsx` — 카테고리별 위젯 추가 패널
- [ ] 편집 모드 시각 피드백 (dashed border, blue tint, grip icon)
- [ ] 취소 확인 다이얼로그 (isDirty 시)
- [ ] 초기화 확인 다이얼로그
- [ ] Ctrl+Z undo 지원

### Phase 5: 고도화
- [ ] `WidgetSettingsDialog.tsx` — 위젯별 설정 (표시 건수, 새로고침)
- [ ] localStorage 폴백 + 동기화
- [ ] 레이아웃 버전 마이그레이션 함수
- [ ] 위젯 React.lazy + Suspense 지연 로딩
- [ ] 위젯별 ErrorBoundary
- [ ] 조건부 위젯 collapseWhenEmpty 구현
- [ ] 반응형 테스트 (lg/md/sm)
- [ ] 위젯 마이그레이션 검증 체크리스트 (섹션 11) 수행

### Phase 6: 관리자 프리셋 (로드맵)
- [ ] `DashboardPreset` Prisma 모델 추가
- [ ] 프리셋 CRUD API (5개)
- [ ] 관리자 프리셋 관리 UI (설정 > 대시보드 프리셋)
- [ ] 사용자 "기본으로 초기화" 시 부서별 추천 우선 적용
- [ ] 내 레이아웃 → 프리셋으로 저장 기능

---

## 7. 영향도 분석

| 구분 | 파일 수 | 설명 |
|------|:-------:|------|
| **신규 BE** | 4 | Prisma model, controller, service, module |
| **신규 FE** | ~35 | Shell, Wrapper, Catalog, Toolbar, SettingsDialog, store, hook, default-layouts, registry, 위젯 27종 |
| **수정 FE** | 2 | page.tsx, schema.prisma |
| **삭제 FE** | 11 | Doctor/Nurse/Admin/Pharmacist/LabTech Dashboard, DashboardCharts, MyCensusPanel, MyWaitingQueueWidget, PendingHandoffBanner, QuickActions, SessionInfo |
| **유지 FE** | 1 | shared.tsx (MiniStat, StatCard 등 공유 컴포넌트) |
| **패키지** | 1 | react-grid-layout (+ @types) |

### 리스크

| 리스크 | 심각도 | 대응 |
|--------|:------:|------|
| react-grid-layout React 19 호환 | **높음** | Phase 1에서 설치 후 드래그/리사이즈 동작 검증 필수. 실패 시 @dnd-kit + 자체 그리드로 전환 (공수 2배) |
| 기존 대시보드 기능 손실 | 중 | 위젯 분리 시 기존 코드 1:1 이동, E2E 비교 테스트 |
| SSR hydration mismatch | 중 | `next/dynamic` ssr:false로 그리드만 클라이언트 렌더링 |
| 레이아웃 깨짐 (sm 브레이크포인트) | 낮음 | sm에서는 편집 불가 + 세로 스택 자동 배치 |
| 위젯 지연 로딩 시 깜빡임 | 낮음 | Suspense fallback에 크기 맞춤 스켈레톤 |
| 저장된 config와 코드 불일치 (위젯 삭제 등) | 낮음 | version 마이그레이션 + 미존재 위젯 자동 제거 |

---

## 8. 조건부 위젯 처리

현재 NurseDashboard에는 **데이터가 있을 때만 표시**되는 위젯이 있습니다:
- `med-alert` — 투약 대기 0건이면 렌더링 안 함
- `VitalUncheckedWidget` — 미체크 환자 0명이면 렌더링 안 함
- `UpcomingMedsWidget` — 투약 예정 0건이면 렌더링 안 함

### 그리드 시스템에서의 처리

그리드에서는 빈 위젯이 공간을 차지하면 안 됩니다. 해결 방법:

1. **`collapseWhenEmpty: true`** — WidgetDefinition에 플래그 추가
2. 위젯 컴포넌트가 데이터 0건이면 `onEmpty` 콜백 호출
3. DashboardShell이 해당 위젯의 `h`를 `0`으로 동적 변경 (숨김 처리)
4. 데이터가 생기면 원래 `h`로 복원

```typescript
// 위젯 내부
function MedAlertWidget({ widgetId, width, height, settings }: WidgetProps) {
  const { data } = useQuery(/* ... */);
  const { setWidgetEmpty } = useDashboardStore();

  useEffect(() => {
    setWidgetEmpty(widgetId, data?.length === 0);
  }, [data?.length]);

  if (!data?.length) return <EmptyState message="투약 대기 없음" />;
  // ...
}
```

**collapseWhenEmpty 적용 위젯**:

| 위젯 | collapseWhenEmpty | 사유 |
|------|:-----------------:|------|
| `med-alert` | **true** | 투약 대기 없으면 숨김 |
| `handoff` | **true** | 미확인 인수인계 없으면 숨김 (DOCTOR 배너형) |
| `chart-revenue` | false | 항상 표시 (0이어도 차트 보여줌) |
| `census` | false | 환자 0명이어도 "담당 환자 없음" 표시 |
| 기타 | false | 빈 상태에서도 카드 유지 |

---

## 9. 관리자 프리셋 관리 (Phase 6 로드맵)

> Phase 1~5에서는 **개인 레이아웃**만 지원. 아래는 추후 확장 로드맵.

### 9.1 프리셋 개념

```
┌──────────────────────────────────────────────┐
│  레이아웃 관리 (ADMIN 전용)                    │
│                                               │
│  [시스템 기본값]  5종 — 수정 불가               │
│  [부서별 추천]    관리자가 생성                  │
│    ├ 내과 추천 레이아웃                         │
│    ├ 외과 추천 레이아웃                         │
│    └ 응급실 추천 레이아웃                       │
│  [내 레이아웃]    현재 배치 → 프리셋으로 저장    │
│                                               │
│  사용자가 "기본으로 초기화" 시:                  │
│    1순위: 부서별 추천 (있으면)                   │
│    2순위: 시스템 기본값 (역할별)                 │
└──────────────────────────────────────────────┘
```

### 9.2 프리셋 데이터 모델 (Phase 6)

```prisma
model DashboardPreset {
  id          String   @id @default(uuid())
  name        String                      // '내과 추천 레이아웃'
  description String?
  role        String                      // 'DOCTOR'
  department  String?                     // '내과' (부서별 추천)
  config      Json     @db.JsonB          // DashboardConfig
  isSystem    Boolean  @default(false)    // 시스템 기본값 (삭제 불가)
  createdBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("dashboard_presets")
}
```

### 9.3 프리셋 API (Phase 6)

```
GET    /api/v1/dashboard/presets              → 프리셋 목록 (역할+부서 필터)
POST   /api/v1/dashboard/presets              → 프리셋 생성 (ADMIN 전용)
PUT    /api/v1/dashboard/presets/:id          → 프리셋 수정
DELETE /api/v1/dashboard/presets/:id          → 프리셋 삭제
POST   /api/v1/dashboard/presets/:id/apply    → 프리셋 내 레이아웃에 적용
```

---

## 10. API 유효성 검증

### PUT /api/v1/dashboard/config 검증 규칙

| 규칙 | 검증 | 실패 시 |
|------|------|--------|
| config.version | 정수, >= 1 | 400 Bad Request |
| layouts.lg | 배열, 각 항목에 i/x/y/w/h 필수 | 400 |
| 위젯 ID | widget-registry에 존재하는 ID만 | 미존재 ID 자동 제거 (경고 로그) |
| 좌표 범위 | x: 0~11, w: 1~12, x+w <= 12 | 400 |
| 높이 범위 | h: 1~10, y >= 0 | 400 |
| static 위젯 | stat-bar는 항상 static: true | 서버에서 강제 설정 |
| JSON 크기 | <= 64KB | 413 Payload Too Large |
| 권한 | 본인 config만 수정 | 403 Forbidden |
| hiddenWidgets | 문자열 배열 | 빈 배열로 기본값 |
| widgetSettings | 각 값이 객체 | 빈 객체로 기본값 |

---

## 11. 테스트 전략

### 11.1 위젯 마이그레이션 검증 (Phase 2)

기존 대시보드와 위젯 시스템의 **기능 동등성**을 보장하기 위한 체크리스트:

| 검증 항목 | 방법 |
|----------|------|
| 위젯 렌더링 | 각 위젯이 데이터 있을 때 / 없을 때 / 로딩 중 3가지 상태 정상 표시 |
| API 호출 | 기존과 동일한 queryKey + endpoint + refetchInterval 사용 확인 |
| 사용자 인터랙션 | 클릭/링크/버튼 동작이 기존과 동일 (호출, 진료 시작 등) |
| 역할별 필터링 | DOCTOR 로그인 시 DOCTOR 기본 위젯만 표시, 다른 역할 동일 |
| 모달 | NurseDashboard의 HandoffFormModal이 HandoffWidget에서 동작 |

### 11.2 그리드 시스템 검증 (Phase 3)

| 검증 항목 | 방법 |
|----------|------|
| 드래그 | 위젯 헤더 잡고 이동 → 다른 위젯 자동 재배치 |
| 리사이즈 | 우하단 핸들 → min/max 범위 내에서만 크기 변경 |
| 크기별 모드 | 위젯 확대 시 expanded 모드, 축소 시 compact 모드 자동 전환 |
| 반응형 | 브라우저 폭 변경 시 lg → md → sm 자동 재배치 |
| SSR | 서버 렌더링 시 hydration 에러 없음 |

### 11.3 저장/복원 검증 (Phase 4)

| 검증 항목 | 방법 |
|----------|------|
| 저장 | 편집 → 저장 → 새로고침 → 레이아웃 유지 |
| 취소 | 편집 → 위젯 이동 → 취소 → 원래 위치 복원 |
| Undo | 편집 → 3단계 조작 → Ctrl+Z 3회 → 원래 상태 |
| 초기화 | 저장된 레이아웃 → 초기화 → 역할별 기본값 복원 |
| 다른 기기 | PC에서 저장 → 다른 PC에서 로그인 → 동일 레이아웃 |
| API 실패 | 네트워크 끊김 → localStorage에 임시 저장 → 복구 후 동기화 |

---

## 12. 의존성

```json
{
  "react-grid-layout": "^1.4.4",
  "@types/react-grid-layout": "^1.3.5"
}
```

- CSS: `react-grid-layout/css/styles.css` + `react-resizable/css/styles.css`
- Next.js: `next/dynamic` with `ssr: false`
- 기존 의존: Zustand (이미 사용), TanStack Query (이미 사용)

---

## 13. 변경 이력

### v1.1 → v1.2

| 항목 | v1.0 | v1.1 |
|------|------|------|
| 위젯 수 | "20종" (실제 28행으로 불일치) | **27종** (정확한 카운트) |
| React 버전 | 미확인 | **19.1.0** 확인, 호환 리스크 명시 |
| 기본 레이아웃 | 의사/간호사 2종만 | **5종 전체** (Admin/Pharmacist/LabTech 추가) |
| 중복 위젯 | handoff + nurse-handoff 별도 | **handoff 하나로 통합** |
| 누락 위젯 | med-alert, shift-info 미포함 | **추가** (NurseDashboard 분석 반영) |
| stat-bar 기본 크기 | 6x1 (오류) | **12x1** (전폭 수정) |
| cert-banner | 위젯 목록에 포함 | **그리드 외부** (조건부 배너이므로 위젯 부적합) |
| 위젯 내 설정 | 없음 | **widgetSettings** 추가 (표시 건수, 새로고침) |
| 실행 취소 | 없음 | **Ctrl+Z undo** 스택 추가 |
| 취소 확인 | 없음 | **isDirty 시 확인 다이얼로그** |
| 에러 처리 | 미명시 | **5개 상황별 대응** 추가 |
| SSR 대응 | 'use client' 언급만 | **next/dynamic ssr:false** 구체화 |
| 버전 마이그레이션 | 언급만 | **migrateConfig 함수 예시** 추가 |
| 저장소 폴백 | 언급만 | **3계층 전략** 구체화 (API → localStorage → 기본값) |
| 프론트 구조 | 삭제 5파일 | **삭제 11파일** (DashboardCharts, 개별 컴포넌트 포함) |
| WidgetWrapper | 기본형 | **⚙ 설정 + ErrorBoundary** 추가 |
| WidgetCatalog | 주석만 | **카테고리 탭 + 배치 상태 표시** 구체화 |
| 키보드/접근성 | 없음 | **섹션 추가** |
| Config 크기 제한 | 없음 | **64KB 제한** 명시 |
| 다중 기기 | 없음 | **last-write-wins** 정책 명시 |

### v1.1 → v1.2

| 항목 | v1.1 | v1.2 |
|------|------|------|
| 위젯 수 표기 | 1.1절 "23종" vs 3.2절 "27종" 불일치 | **27종 통일** |
| WidgetDefinition.hasSettings | 별도 boolean 필드 | **settingsSchema.length > 0**으로 판단, 필드 제거 |
| WidgetProps 전달 | widgetId만 전달 | **width/height/settings** 전달, onResize로 크기 추적 |
| WidgetWrapper ErrorBoundary | 없음 | **ErrorBoundary 내장** |
| Zustand undo | layouts+hiddenWidgets만 | **widgetSettings도 포함** (ConfigSnapshot 타입) |
| Zustand getConfig() | 미정의 (호출만 존재) | **인터페이스에 명시** |
| showWidget 파라미터 | id만 | **defaultLayout 추가** (기본 크기/위치) |
| 조건부 위젯 | 미언급 | **collapseWhenEmpty + setWidgetEmpty** 패턴 (섹션 8) |
| 관리자 프리셋 | 없음 | **Phase 6 로드맵** 추가 (섹션 9) |
| API 유효성 검증 | 없음 | **10개 규칙** 명시 (섹션 10) |
| 테스트 전략 | 없음 | **3단계 검증 체크리스트** (섹션 11) |
| dataSource null | 불허 | **null 허용** (shift-info 등 클라이언트 전용 위젯) |
