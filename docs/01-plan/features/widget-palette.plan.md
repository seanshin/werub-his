# 위젯 팔레트 기능 기획서 v1.1

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/app/(main)/dashboard/components/widget-registry.ts · apps/web/src/app/(main)/admin/dashboard-templates/page.tsx:8 · 잔여: Phase 1 previewType·아이콘·미니 미리보기(CLI) — 2026-09-14 previewType grep 0 재확인

> 작성일: 2026-05-30 | 갱신: v1.0 검토 보완 (중복 정리, 권한, 성능, 전환 전략, 접근성)
> 현재 상태: 기본 팔레트 (카테고리 탭 + 위젯 카드 클릭 추가)
> 목표: 105개 API 데이터 소스를 활용한 확장 위젯 팔레트 설계

---

## 1. 현재 팔레트 vs 목표

### 현재 (WidgetCatalog.tsx)
- 카테고리 6개 탭 (환자/임상/오더/관리/차트/시스템)
- 위젯 17종 (역할별 필터링)
- 클릭 → 그리드 하단에 추가
- 아이콘 없음, 설명 없음, 미리보기 없음

### 목표
- 위젯 **60종+** (105개 API 중 대시보드에 적합한 것 선별)
- **9개 도메인** 카테고리
- 위젯 카드에 **아이콘 + 설명 + 미리보기 썸네일**
- **검색** 기능
- **크기 선택** (추가 시 기본/넓은/좁은)
- **실시간 위젯** 배지 (SSE 연동)

---

## 2. 위젯 카탈로그 전체 설계

### 2.1 도메인 카테고리 (9개)

| 카테고리 | 아이콘 | 위젯 수 | 주요 데이터 소스 |
|---------|--------|:-------:|-----------------|
| 진료 현황 | 🏥 | 8 | 대기환자, 진료표, 미완료차트, 센서스, 입원환자 |
| 수술/응급 | 🚨 | 5 | 수술일정, 응급실KTAS, ICU현황, NEWS2 |
| 검사/영상 | 🔬 | 5 | 검사결과, 검사대기, 영상대기, 검사통계 |
| 약국/재고 | 💊 | 7 | 조제대기, 재고부족, 만료임박, 혈액은행, ADR |
| 경영/수납 | 💰 | 6 | 매출, 보험청구, 미수납, 수납큐, 부서별매출 |
| 병동/병상 | 🛏️ | 4 | 가동률, 병동별, 입퇴원추이, 환자흐름 |
| 품질/안전 | ✅ | 7 | 감염감시, 낙상, 안전사건, QI지표, 만족도 |
| 통계 차트 | 📊 | 10 | 시간별접수, 7일추이, 부서분포, KPI, 진단통계 |
| 시스템 | ⚙️ | 5 | 요약통계, 바로가기, 접속정보, 인수인계, 알림 |

### 2.2 전체 위젯 목록 (60종)

---

#### 진료 현황 (8종)

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 |
|----|------|------|-----|:---------:|:------:|
| `stat-bar` | 요약 통계 | 역할별 KPI 수치 바 | dashboard/overview | 12x1 | — |
| `census` | 담당 환자 센서스 | 입원 환자 상태/바이탈/검사 | doctors/my-census | 12x3 | — |
| `my-queue` | 내 대기 환자 | 진료 대기열 + 호출 버튼 | queue/my | 4x2 | SSE |
| `schedule` | 오늘 진료표 | 오전/오후 진료시간 + 진료실 | clinic-schedule/today | 4x1 | — |
| `draft-charts` | 미완료 차트 | 서명 대기 차트 목록 | encounters?status=DRAFT | 4x2 | — |
| `inpatients` | 담당 입원환자 | 병실/이름/진단/식이/재원일 | inpatient | 6x2 | — |
| `handoff` | 인수인계 | 미확인 인수인계 배너 | handoffs/pending | 6x1 | — |
| `appointments` | 오늘 예약 | 예약 목록 (시간순) | appointments?date=today | 6x2 | — |

#### 수술/응급 (5종)

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 |
|----|------|------|-----|:---------:|:------:|
| `surgery` | 오늘 수술 일정 | 시간/환자/수술명/상태 | surgery/schedule | 6x2 | — |
| `er-status` | 응급실 현황 | KTAS별 환자 수 + 대기열 | emergency/stats | 4x2 | — |
| `er-queue` | 응급 대기열 | 응급실 대기 환자 목록 | emergency/queue | 6x2 | — |
| `icu-dashboard` | ICU 현황 | 점유율/인공호흡기/중증도 | icu/dashboard | 4x2 | — |
| `icu-alerts` | ICU NEWS2 경고 | 고위험 조기경보 환자 | icu/alerts/news2 | 6x1 | SSE |

#### 검사/영상 (5종)

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 |
|----|------|------|-----|:---------:|:------:|
| `lab-results` | 검사결과 도착 | 완료된 검사/영상 결과 | orders?status=COMPLETED | 12x2 | — |
| `lab-queue` | 검사 대기열 | 검사 접수 대기 목록 | lab/queue | 6x2 | — |
| `imaging-queue` | 영상 대기열 | 영상 촬영 대기 목록 | imaging/queue | 6x2 | — |
| `lab-pending` | 미매칭 검사결과 | 장비 결과 미매칭 알림 | lab/interface/pending | 4x1 | — |
| `lab-stats` | 검사실 통계 | 검사 상태별 건수 | dashboard/lab/stats | 4x2 | — |

#### 약국/재고 (7종)

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 |
|----|------|------|-----|:---------:|:------:|
| `pharmacy-queue` | 조제 대기열 | 처방 조제 대기 목록 | pharmacy/queue | 8x2 | — |
| `low-stock` | 재고 부족 | 안전재고 미달 약품 | inventory/alerts | 4x2 | — |
| `expiring-drugs` | 만료 임박 약품 | 유효기간 임박 약품 | pharmacy/inventory/expiring | 4x2 | — |
| `blood-bank` | 혈액은행 현황 | 혈액형별 재고 매트릭스 | blood-bank/inventory/stats | 6x2 | — |
| `blood-expiring` | 혈액 만료 임박 | 만료 예정 혈액제제 | blood-bank/inventory/expiring | 4x1 | — |
| `adr-stats` | 약물 이상반응 | ADR 보고 통계 | pharmacy/adr/stats | 4x2 | — |
| `reorder-suggest` | 자동 발주 제안 | AI 기반 재발주 추천 | inventory/purchase-orders/auto-suggest | 6x2 | — |

#### 경영/수납 (6종)

> v1.0의 `revenue-monthly`는 통계차트 `chart-revenue`와 동일 API → **중복 제거**

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 | 역할 |
|----|------|------|-----|:---------:|:------:|------|
| `revenue-today` | 오늘 수납 현황 | 오늘 수납액/건수/미수납 | billing/cashier-stats | 4x2 | — | ADMIN |
| `revenue-dept` | 부서별 매출 | 부서별 매출 비교 | dashboard/department-revenue | 6x2 | — | ADMIN |
| `claims` | 보험 청구 요약 | 미청구/심사중/승인/지급 | claims/summary | 4x2 | — | ADMIN |
| `cashier-queue` | 수납 대기열 | 수납 대기 환자 목록 | billing/cashier-queue | 6x2 | — | ADMIN, NURSE |
| `deferred-billing` | 미수납 목록 | 미결제 청구 목록 | billing/deferred | 6x2 | — | ADMIN |
| `daily-settlement` | 일일 정산 | 오늘 정산 요약 | billing/daily-summary | 4x1 | — | ADMIN |

#### 병동/병상 (4종)

> v1.0의 `bed-occupancy-trend`는 통계차트 `chart-beds`와 동일 API → **중복 제거**

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 | 역할 |
|----|------|------|-----|:---------:|:------:|------|
| `bed-status` | 병상 가동률 | 총/사용/가용 + 가동률 바 | beds/status | 4x2 | — | NURSE, ADMIN |
| `bed-by-ward` | 병동별 현황 | 병동별 점유율 비교 | beds/wards | 6x2 | — | NURSE, ADMIN |
| `admission-trend` | 입퇴원 추이 | 일별 입원/퇴원 라인 차트 | operational-stats/admission-trends | 6x2 | — | ADMIN |
| `patient-flow` | 환자 흐름 | 입원 vs 퇴원 비교 | operational-stats/patient-flow | 4x2 | — | ADMIN |

#### 품질/안전 (7종)

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 |
|----|------|------|-----|:---------:|:------:|
| `infection-dashboard` | 감염감시 현황 | 감염 감시 종합 현황판 | infection-control/dashboard | 6x2 | — |
| `isolation-list` | 격리 환자 | 현재 격리 환자 목록 | infection-control/isolation/list | 4x2 | — |
| `outbreak-alert` | 유행 경보 | 집단 감염 탐지 알림 | infection-control/alerts | 4x1 | SSE |
| `safety-incidents` | 안전 사건 | 안전사건 유형별 통계 | safety/incidents/stats | 4x2 | — |
| `ews-high-risk` | 고위험 환자 | NEWS2 고위험 환자 목록 | safety/ews/high-risk | 6x1 | SSE |
| `qi-dashboard` | QI 지표 | 품질 지표 최신 값 + 추이 | quality/dashboard | 6x2 | — |
| `satisfaction` | 환자 만족도 | 부서별 NPS + 트렌드 | satisfaction/stats/department | 6x2 | — |

#### 통계 차트 (10종)

| ID | 이름 | 설명 | API | 기본 크기 | 차트 |
|----|------|------|-----|:---------:|:----:|
| `chart-hourly` | 시간대별 접수 | 시간대별 접수 환자 바 차트 | dashboard/charts | 6x2 | Bar |
| `chart-weekly` | 7일 진료 추이 | 일별 진료 건수 라인 차트 | dashboard/charts | 6x2 | Line |
| `chart-dept` | 부서별 환자 분포 | 부서별 환자 비율 도넛 | dashboard/charts | 6x2 | Doughnut |
| `chart-ktas` | 오더/KTAS 상태 | 오더 진행률 + KTAS 분포 | dashboard/charts | 6x2 | Bar |
| `chart-revenue` | 월별 매출 | 6개월 매출 추이 바 차트 | dashboard/monthly-revenue | 6x2 | Bar |
| `chart-beds` | 병상 가동률 | 7일 가동률 라인 차트 | dashboard/bed-occupancy | 6x2 | Line |
| `chart-top-dx` | 상위 진단 | 빈도 Top 10 진단 코드 | executive/top-diagnoses | 6x2 | Bar |
| `chart-satisfaction` | 만족도 트렌드 | 월별 NPS 추이 | satisfaction/stats/trend | 6x2 | Line |
| `chart-infection` | 감염 추이 | 감염 발생 추이 차트 | infection-control/analytics | 6x2 | Line |
| `chart-er-analytics` | 응급실 분석 | 응급실 일별 내원 추이 | emergency/analytics | 6x2 | Bar |

#### 시스템 (5종)

| ID | 이름 | 설명 | API | 기본 크기 | 실시간 |
|----|------|------|-----|:---------:|:------:|
| `quick-actions` | 바로가기 | 역할별 빠른 메뉴 | — | 8x1 | — |
| `session-info` | 접속 정보 | 사용자/시스템 상태 | — | 4x2 | — |
| `notifications` | 알림 | 최근 알림 목록 | notifications/stream | 4x2 | SSE |
| `hr-schedule` | 근무 일정 | 이번 주 근무표 | hr/schedule | 6x2 | — |
| `system-health` | 시스템 상태 | API/DB/Redis 상태 | health | 4x1 | — |

---

## 3. 팔레트 UI 설계

### 3.1 레이아웃

```
┌──────────────────────────────────────────────────────────────────┐
│ + 위젯 추가                                     [🔍 위젯 검색...]│
├──────────────────────────────────────────────────────────────────┤
│ [전체] [진료현황] [수술/응급] [검사/영상] [약국/재고]              │
│ [경영/수납] [병동/병상] [품질/안전] [통계차트] [시스템]            │
├──────────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │ 🏥      │ │ 📋      │ │ 📊      │ │ 💊      │ │ 🛏️      │   │
│ │ 담당 환자│ │ 오늘    │ │ 시간대별│ │ 조제    │ │ 병상    │   │
│ │ 센서스  │ │ 진료표  │ │ 접수    │ │ 대기열  │ │ 가동률  │   │
│ │         │ │         │ │ Bar차트 │ │         │ │         │   │
│ │ 12x3    │ │ 4x1     │ │ 6x2    │ │ 8x2    │ │ 4x2    │   │
│ │ ✓배치됨 │ │ [추가]  │ │ [추가] │ │ [추가] │ │ ✓배치됨 │   │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │
│ │ 🚨      │ │ 🔬      │ │ 💰      │ │ ✅      │               │
│ │ 응급실  │ │ 검사결과│ │ 오늘    │ │ QI 지표 │               │
│ │ 현황    │ │ 도착    │ │ 수납    │ │         │               │
│ │ KTAS분포│ │ 검사+영상│ │ 현황    │ │ 13개 지표│               │
│ │ 4x2     │ │ 12x2    │ │ 4x2    │ │ 6x2    │               │
│ │ [추가]  │ │ [추가]  │ │ [추가] │ │ [추가] │               │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘               │
│                                                                 │
│                         [ ▲ 접기 ]                              │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 위젯 카드 상세

```
┌──────────────────────┐
│ 🏥                   │
│ 담당 환자 센서스       │  ← 이름 (볼드)
│ 입원 환자 상태/바이탈  │  ← 설명 (1줄, 그레이)
│ ·······              │  ← 미니 미리보기 (테이블/차트 모양)
│ 12 × 3   의사 전용    │  ← 기본 크기 + 역할 제한
│ ┌──────┐ ┌──────┐    │
│ │ 추가 │ │ 크기▼│    │  ← 추가 버튼 + 크기 드롭다운
│ └──────┘ └──────┘    │
└──────────────────────┘
```

### 3.3 위젯 카드 컴포넌트 인터페이스

```typescript
interface WidgetCardProps {
  widget: WidgetDef;
  isPlaced: boolean;          // 이미 배치됨
  isHidden: boolean;          // 숨김 상태 (다시 추가 가능)
  onAdd: (size: 'small' | 'default' | 'large') => void;
}

// 확장된 WidgetDef
interface WidgetDef {
  id: string;
  name: string;
  description: string;        // NEW: 1줄 설명
  icon: string;               // NEW: lucide 아이콘 이름 또는 이모지
  category: WidgetCategory;
  roles: string[];
  component: React.LazyExoticComponent<...>;
  defaultW: number;
  defaultH: number;
  sizes: WidgetSizeOption[];   // NEW: 선택 가능한 크기
  isRealtime?: boolean;        // NEW: SSE 실시간 위젯 여부
  previewType?: 'table' | 'chart-bar' | 'chart-line' | 'chart-donut' | 'stat' | 'list' | 'alert';  // NEW
}

interface WidgetSizeOption {
  label: string;               // '기본', '넓은', '좁은'
  w: number;
  h: number;
}
```

---

## 4. 팔레트 인터랙션 설계

### 4.1 검색

| 기능 | 설명 |
|------|------|
| 실시간 검색 | 위젯 이름 + 설명에서 키워드 매칭 (300ms 디바운스) |
| 한글 초성 검색 | "ㅎㅈ" → "환자", "ㄱㅅ" → "검사" |
| 검색 결과 | 카테고리 무시, 전체에서 필터링 |
| 빈 결과 | "'{키워드}'에 해당하는 위젯이 없습니다" |

### 4.2 크기 선택

위젯 추가 시 3가지 크기 프리셋 제공:

```
┌────────────────────────────────────────┐
│ 크기 선택                               │
│ ┌──────┐  ┌──────────┐  ┌───────────┐ │
│ │ 좁은 │  │   기본    │  │    넓은    │ │
│ │ 4x2  │  │   6x2    │  │   12x2   │ │
│ │ ···  │  │ ·······  │  │ ··········│ │
│ └──────┘  └──────────┘  └───────────┘ │
└────────────────────────────────────────┘
```

- 클릭 즉시 해당 크기로 추가 (기본값은 하이라이트)
- 차트 위젯은 좁은(4x2) 시 축/범례 자동 숨김

### 4.3 상태 표시

| 상태 | 표시 |
|------|------|
| 사용 가능 | 정상 카드 + 파란 "추가" 버튼 |
| 이미 배치됨 | 회색 + "✓ 배치됨" 텍스트, 비활성 |
| 숨김 상태 | 주황 테두리 + "다시 추가" 버튼 |
| 역할 제한 | 표시 안 함 (필터링) |
| 실시간 위젯 | 초록 점 깜빡임 배지 "LIVE" |

### 4.4 접기/펼치기

- 기본 상태: **접힌 상태** (카테고리 탭 + 위젯 2줄만 표시)
- "더 보기" 클릭 → 전체 펼침
- 카테고리 탭 + 검색 영역은 항상 표시
- 접힌 상태에서 검색 입력 시 자동 펼침

---

## 5. 미리보기 타입별 렌더링

위젯 카드 내부에 표시할 미니 미리보기:

| previewType | 미리보기 모양 | 적용 위젯 |
|-------------|-------------|----------|
| `stat` | `██ 42` 큰 숫자 + 레이블 | stat-bar, bed-status, er-status |
| `table` | 3줄 가로줄 `━━━ ━━` | census, inpatients, my-queue, lab-results |
| `list` | 4줄 텍스트 줄 `— text` | handoff, draft-charts, pharmacy-queue |
| `chart-bar` | 작은 바 차트 `▌▌▌▌▌` | chart-hourly, chart-revenue, chart-top-dx |
| `chart-line` | 작은 라인 `╱╲╱╲` | chart-weekly, chart-beds, admission-trend |
| `chart-donut` | 작은 도넛 `◐` | chart-dept, insurance-breakdown |
| `alert` | 경고 아이콘 `⚠ N건` | outbreak-alert, ews-high-risk, icu-alerts |

```tsx
function WidgetPreview({ type }: { type: string }) {
  switch (type) {
    case 'stat':
      return (
        <div className="flex items-end gap-1 h-6">
          <div className="w-5 h-5 rounded bg-blue-200" />
          <div className="w-8 h-3 rounded bg-gray-200" />
        </div>
      );
    case 'table':
      return (
        <div className="space-y-1 h-6">
          <div className="h-1 w-full bg-gray-200 rounded" />
          <div className="h-1 w-3/4 bg-gray-200 rounded" />
          <div className="h-1 w-5/6 bg-gray-200 rounded" />
        </div>
      );
    case 'chart-bar':
      return (
        <div className="flex items-end gap-px h-6">
          {[3, 5, 2, 6, 4, 5, 3].map((h, i) => (
            <div key={i} className="w-1.5 bg-blue-300 rounded-t" style={{ height: `${h * 4}px` }} />
          ))}
        </div>
      );
    case 'chart-line':
      return (
        <svg className="w-full h-6" viewBox="0 0 40 12">
          <polyline points="0,8 6,5 12,7 18,3 24,6 30,2 36,4 40,5" fill="none" stroke="#93C5FD" strokeWidth="1.5" />
        </svg>
      );
    case 'chart-donut':
      return (
        <svg className="w-6 h-6" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" fill="none" stroke="#E5E7EB" strokeWidth="3" />
          <circle cx="10" cy="10" r="7" fill="none" stroke="#3B82F6" strokeWidth="3" strokeDasharray="22 44" />
        </svg>
      );
    case 'alert':
      return (
        <div className="flex items-center gap-1 h-6">
          <div className="w-4 h-4 rounded-full bg-red-200 flex items-center justify-center">
            <span className="text-[8px] text-red-600">!</span>
          </div>
          <div className="w-6 h-2 bg-red-100 rounded" />
        </div>
      );
    default: // list
      return (
        <div className="space-y-1 h-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-1">
              <div className="w-1 h-1 rounded-full bg-gray-300 mt-0.5" />
              <div className="h-1 flex-1 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      );
  }
}
```

---

## 6. 실시간 위젯 (SSE 연동)

| 위젯 | SSE 엔드포인트 | 갱신 주기 | 표시 |
|------|---------------|:---------:|------|
| `my-queue` | queue/public/stream | 5초 | 대기 환자 수 실시간 갱신 |
| `notifications` | notifications/stream | 이벤트 | 새 알림 즉시 표시 |
| `icu-alerts` | — (polling) | 30초 | NEWS2 경고 자동 갱신 |
| `ews-high-risk` | — (polling) | 30초 | 고위험 환자 목록 |
| `outbreak-alert` | infection-control/alerts | 60초 | 유행 탐지 알림 |

팔레트에서 실시간 위젯은 **"LIVE" 초록 배지**로 구분:
```
┌─────────────┐
│ 🟢 LIVE      │
│ 내 대기 환자  │
│ 5초마다 갱신  │
└─────────────┘
```

---

## 7. 역할별 추천 위젯

팔레트 상단에 "추천" 섹션으로 역할별 핵심 위젯 하이라이트:

| 역할 | 추천 위젯 (최대 5개) |
|------|---------------------|
| DOCTOR | census, my-queue, schedule, lab-results, draft-charts |
| NURSE | my-queue, inpatients, handoff, icu-alerts, ews-high-risk |
| ADMIN | revenue-today, claims, bed-status, chart-revenue, satisfaction |
| PHARMACIST | pharmacy-queue, low-stock, expiring-drugs, adr-stats |
| LAB_TECH | lab-queue, imaging-queue, lab-pending, lab-stats |

```
┌──────────────────────────────────────────────────┐
│ ⭐ 추천 위젯 (의사)                               │
│ [담당환자센서스] [내대기환자] [진료표] [검사결과] [미완료차트] │
├──────────────────────────────────────────────────┤
│ 전체 위젯 ...                                     │
```

---

## 8. 구현 단계

### Phase 1: 기본 확장 (현재 팔레트 보강)
- [ ] WidgetDef에 `description`, `icon`, `previewType`, `sizes` 추가
- [ ] 위젯 카드에 아이콘 + 설명 + 미니 미리보기 표시
- [ ] 카테고리 9개로 확장
- [ ] 팔레트 접기/펼치기

### Phase 2: 위젯 60종 등록
- [ ] 각 도메인별 위젯 컴포넌트 생성 (기존 API 엔드포인트 활용)
- [ ] widget-registry에 60종 등록
- [ ] 역할별 기본 레이아웃 업데이트

### Phase 3: 검색 + 크기 선택
- [ ] 검색 입력 (디바운스 + 초성 지원)
- [ ] 크기 프리셋 선택 드롭다운
- [ ] 역할별 추천 위젯 섹션

### Phase 4: 실시간 + 미리보기
- [ ] SSE 연동 위젯 5종 구현
- [ ] LIVE 배지 표시
- [ ] 미리보기 컴포넌트 7종 (stat/table/list/bar/line/donut/alert)

---

## 9. 위젯별 허용 크기 (sizes) 상세

> v1.0에서 모든 위젯에 동일한 `좁은/기본/넓은`을 제공했으나, 위젯마다 의미 있는 크기가 다름

| 위젯 유형 | 허용 크기 | 사유 |
|----------|----------|------|
| **stat-bar** | 12x1만 허용 | 항상 전폭, static, 크기 선택 불필요 |
| **schedule, daily-settlement** | 4x1, 6x1 | 데이터 2줄이므로 h=1만 유의미 |
| **census** | 6x2, 8x3, 12x3, 12x5 | 환자 수에 따라 넓이+높이 모두 의미 |
| **차트 위젯** (chart-*) | 4x2, 6x2, 6x3, 12x3 | 넓을수록 범례+축 표시, 높을수록 차트 상세 |
| **리스트 위젯** (queue, inpatients 등) | 4x2, 6x2, 6x3, 12x3 | 넓을수록 칼럼 추가, 높을수록 목록 늘어남 |
| **알림 위젯** (alert 타입) | 4x1, 6x1, 12x1 | 배너형이므로 h=1, 넓이만 조정 |
| **통합 패널** (nurse-panel 등) | 12x4, 12x6, 12x8 | 항상 전폭, 높이만 조정 |

```typescript
// sizes 필드 예시
const CENSUS_SIZES: WidgetSizeOption[] = [
  { label: '반폭',   w: 6,  h: 2 },
  { label: '기본',   w: 12, h: 3 },  // default
  { label: '확장',   w: 12, h: 5 },
];

const SCHEDULE_SIZES: WidgetSizeOption[] = [
  { label: '좁은',   w: 4,  h: 1 },  // default
  { label: '넓은',   w: 6,  h: 1 },
];

const CHART_SIZES: WidgetSizeOption[] = [
  { label: '좁은',   w: 4,  h: 2 },
  { label: '기본',   w: 6,  h: 2 },  // default
  { label: '넓은',   w: 12, h: 3 },
];

const ALERT_SIZES: WidgetSizeOption[] = [
  { label: '좁은',   w: 4,  h: 1 },  // default
  { label: '넓은',   w: 12, h: 1 },
];
```

팔레트의 크기 선택 UI에서 위젯의 `sizes` 배열만 표시하고, `sizes`가 1개뿐인 위젯은 크기 드롭다운을 숨김.

---

## 10. 즐겨찾기 + 최근 사용

60종 위젯에서 빠르게 찾기 위한 보조 기능:

### 10.1 즐겨찾기

```
┌──────────────────────────────────────────────────┐
│ ⭐ 즐겨찾기 (3)                          [편집]   │
│ [내 대기 환자] [검사결과 도착] [오늘 수납 현황]      │
├──────────────────────────────────────────────────┤
│ 📌 추천 위젯 (의사)                               │
│ [담당환자센서스] [진료표] [미완료차트] [수술일정]      │
├──────────────────────────────────────────────────┤
│ 전체 위젯 ...                                     │
```

- 위젯 카드에 ☆ 토글 → 즐겨찾기 추가/제거
- `DashboardConfig.favorites: string[]`로 저장
- 즐겨찾기 섹션은 팔레트 최상단에 항상 표시

### 10.2 최근 사용 (v2 로드맵)

- 마지막 추가/제거한 위젯 5개 기록
- localStorage에 저장 (API 호출 불필요)
- 즐겨찾기 다음, 추천 전에 표시

---

## 11. 통합 패널 전환 전략

현재 nurse-panel, admin-panel, pharma-panel, lab-panel 4종은 **기존 역할별 대시보드 컴포넌트를 통째로** 위젯으로 등록한 것입니다. 60종 개별 위젯이 모두 구현되면 이 전환이 필요합니다.

### 전환 순서

```
Phase A: 현재 (통합 패널 + 개별 위젯 혼재)
  ADMIN → stat-bar + admin-panel(통합) + charts + quick-actions + session-info

Phase B: 점진적 분리
  admin-panel에서 revenue-today 개별 위젯 추출
  → admin-panel 내부에서 해당 섹션 제거
  → 기본 레이아웃에 revenue-today 추가 + admin-panel 유지

Phase C: 완전 분리 (최종 목표)
  admin-panel 삭제
  → stat-bar + revenue-today + revenue-dept + bed-status + claims + surgery
    + cashier-queue + charts + quick-actions + session-info
```

### 전환 규칙

| 규칙 | 설명 |
|------|------|
| 통합 패널과 개별 위젯 **동시 사용 가능** | 사용자가 admin-panel + 개별 revenue-today를 동시에 배치 가능 (중복 표시됨) |
| 개별 위젯 3개+ 추가 시 **통합 패널 자동 제안** 제거 | "admin-panel을 제거하시겠습니까?" 토스트 표시 |
| 기본 레이아웃 업데이트 | Phase B에서 역할별 기본 레이아웃도 점진적으로 개별 위젯으로 전환 |
| 마이그레이션 | config.version 증가 + `admin-panel` → 개별 위젯 자동 전환 함수 |

---

## 12. 성능 고려

### 12.1 Lazy Loading

```typescript
// 60종 위젯을 registry에 등록하지만, lazy(() => import(...))이므로
// 실제 대시보드에 배치된 위젯만 번들에 포함
// → 미배치 위젯은 0 바이트 비용

// 단, registry 파일 자체가 60줄 import 선언 → 초기 파싱 비용 미미
```

### 12.2 API 호출 최적화

| 문제 | 대응 |
|------|------|
| 10개 위젯이 각각 useQuery 호출 | TanStack Query가 동일 queryKey 중복 요청 자동 제거 |
| 숨긴 위젯이 API 호출 | 숨긴 위젯은 렌더링되지 않으므로 useQuery 미실행 |
| 편집 모드에서 팔레트 위젯 미리보기 | **API 호출 안 함** — 정적 미리보기(WidgetPreview) 사용 |
| refetchInterval이 많을 때 | 위젯별 staleTime 최소 10초, 차트류는 60~300초 |

### 12.3 번들 크기

| 항목 | 크기 예상 |
|------|----------|
| widget-registry.ts | ~5KB (60종 선언) |
| WidgetPreview 컴포넌트 | ~2KB (SVG 인라인) |
| 개별 위젯 (평균) | ~3KB/종 (useQuery + JSX) |
| 배치된 10개 위젯 | ~30KB (lazy load) |
| 미배치 50개 위젯 | **0KB** (미로드) |

---

## 13. 접근성

| 요소 | 구현 |
|------|------|
| 검색 입력 | `aria-label="위젯 검색"`, `role="searchbox"` |
| 카테고리 탭 | `role="tablist"` + 각 탭 `role="tab"`, `aria-selected` |
| 위젯 카드 | `role="button"`, `aria-label="{위젯이름} 위젯 추가"`, `aria-disabled={isPlaced}` |
| 배치됨 상태 | `aria-label="{위젯이름} — 이미 배치됨"` |
| LIVE 배지 | `aria-label="실시간 위젯"` |
| 접기/펼치기 | `aria-expanded`, 버튼에 `aria-label="위젯 목록 접기/펼치기"` |
| 키보드 | Tab으로 카드 간 이동, Enter/Space로 추가, Escape로 팔레트 닫기 |

---

## 14. 팔레트 내 위젯 정렬 순서

카테고리 내에서 위젯 표시 순서:

| 순서 | 기준 | 사유 |
|:----:|------|------|
| 1 | **즐겨찾기** 위젯 먼저 | 사용자 개인화 |
| 2 | **숨김 상태** (다시 추가 가능) | 복원 접근성 |
| 3 | **미배치** 위젯 | 추가 가능한 것 우선 |
| 4 | **배치됨** 위젯 | 마지막 (비활성) |

같은 그룹 내에서는 **registry 등록 순서** (= 중요도 순) 유지.

---

## 15. 영향도 (v1.1 갱신)

| 구분 | 수량 |
|------|:----:|
| WidgetDef 인터페이스 확장 | 필드 6개 추가 (description, icon, previewType, sizes, isRealtime, tags) |
| 위젯 컴포넌트 신규 | ~40개 (기존 17 → 57, 중복 3개 제거) |
| widget-registry 엔트리 | 17 → **57** |
| 카테고리 | 6 → 9 |
| WidgetCatalog.tsx 재작성 | 1개 (검색+즐겨찾기+크기 선택+접근성) |
| WidgetPreview 신규 | 1개 (7종 렌더러) |
| DashboardConfig 확장 | `favorites: string[]` 필드 추가 |
| 기존 API 추가 | **0** (전부 기존 엔드포인트 활용) |

---

## 16. v1.0 → v1.1 변경 이력

| 항목 | v1.0 | v1.1 |
|------|------|------|
| 위젯 수 | 60종 | **57종** (중복 3개 제거: revenue-monthly, bed-occupancy-trend, insurance-breakdown) |
| 역할 권한 | 경영/수납/병동 위젯에 역할 미정의 | **모든 위젯에 roles 명시** |
| 크기 프리셋 | 모든 위젯 동일 좁은/기본/넓은 | **위젯 유형별 맞춤 sizes** (stat-bar는 12x1 고정 등) |
| 즐겨찾기 | 없음 | **favorites 배열** (DashboardConfig에 저장) |
| 최근 사용 | 없음 | **v2 로드맵** (localStorage) |
| 통합 패널 전환 | 미언급 | **Phase A→B→C 전환 전략** 추가 |
| 성능 | 미언급 | **lazy load + API 중복 제거 + 번들 분석** 추가 |
| 접근성 | 없음 | **aria 속성 + 키보드 탐색** 8항목 |
| 위젯 정렬 | 미정의 | **즐겨찾기 → 숨김 → 미배치 → 배치됨** 순서 |
| 중복 위젯 | revenue-monthly/chart-revenue 동일 API | **중복 제거 (chart-revenue만 유지)** |
