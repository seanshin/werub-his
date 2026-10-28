# 환자 차트 '큰 화면 보기' (멀티패널 board) 설계서 — P0

> **Feature**: patient-chart-large-screen-view
> **Version**: 1.1 (Design · P0 본체 — 멀티패널 그리드 / v1.0 상세검토 반영: 임상 안전신호·밀도 메커니즘·인터랙션 세부)
> **Date**: 2026-07-06
> **Status**: Design (진입점 버튼·store·폭캡해제는 구현 완료·커밋 대기 / 본 설계는 §3.3 멀티패널 렌더)
> **기획**: [patient-chart-large-screen-view.plan.md](../../01-plan/features/patient-chart-large-screen-view.plan.md) (v1.5) · [P2 상세](../../01-plan/features/patient-chart-large-screen-view-p2.plan.md)
> **한 줄**: 기획 A안(페이지 내 레이아웃 모드)을 **패널 레지스트리 + `<ChartBoard>` 그리드 + 안전 sticky 존**으로 구현. 기존 48탭 컴포넌트를 **prop 주입 어댑터**로 재사용(신규 데이터·BE 0).
>
> **v1.1 상세검토 반영(의료진 세밀도)**: (D1) 🔴 안전 존에 **임상 안전신호**(격리·DNR·낙상·EWS — 데이터 존재·환자스코프) 반영(§4.1) — 기존 안전존은 알러지+행정플래그만이라 접촉/코드/낙상 안전 신호 누락. (D2) **밀도 메커니즘 정정**(§5.1) — `text-xs` 고정 rem이라 부모 font-size로 안 커짐 → P0 comfortable=기본 렌더, 실제 스케일은 P1 CSS override. (D3) 위험카드 board 응축·식별 스트립 1행. (D4) 이상치·위급 강조 상속을 수용기준화. (D5) 진입/이탈 focus·aria·인쇄·`?tab=` 정의(§7). (D6~D10) 빈패널 신호·레지스트리 lazy·초광폭 가독폭·좁은화면 강제·프라이버시.

---

## 0. 전제 — 관련 작업 반영 (다른 CLI G-그룹 커밋 후)

| 항목 | 상태 | board 영향 |
|------|------|-----------|
| 패널 재사용 계약 | `VitalsTab`·`FamilyHistoryTab`·`LabResultsTab`·`MedicationTab`·`ProblemListTab`·`AllergyTab` = **`({ patientId })` 유지** | ✅ 무영향 |
| G4-2 구조화 가족력 | **기존 `FamilyHistoryTab`에 병합**(새 탭 아님) | ✅ 패널 더 풍부·시그니처 동일 |
| G3-3 바이탈 정상범위 통일 | `VitalsTab` 내부 변경 | ✅ 호환(prop 불변) |
| 48탭 목록 | **변화 없음** | ✅ 기획 참조 유효 |
| OverviewTab | 다중 prop(요약 데이터 주입형) | ⚠ 레지스트리에서 **주입 처리**(§2) |
| 진입점(§3.1) | **구현 완료**: `store.boardEnabled` 토글 버튼(PatientHeader)·`page.tsx` 폭 캡 해제(`max-w-none`) | 본 설계가 그 위에 그리드 렌더 |

→ 재작업 0. 본 설계는 **P0 멀티패널 렌더**에 집중.

---

## 1. 컴포넌트 트리·파일

```
patients/[id]/page.tsx  (PatientDetailContent)
├─ boardEnabled === false → (기존) 탭 바 + activeTab 단일 렌더        ← 불변
└─ boardEnabled === true  → <ChartBoard ctx={boardCtx} />            ← 신규 분기
      ├─ <BoardSafetyZone/>   sticky: PatientHeader(compact)+PatientFlagBar+TwinCdsCards  (P-1/P-2)
      └─ <div grid>           반응형 컬럼
          └─ PANEL_KEYS.map → <BoardPanel key title>
                                 └─ renderPanel(key, ctx)   ← 레지스트리(§2)
```

**신규 파일**
| 파일 | 역할 |
|------|------|
| `components/board/panel-registry.tsx` | key → { label, suitability, render(ctx) } 단일 소스 |
| `components/board/ChartBoard.tsx` | 안전 존 + 반응형 그리드 + 레지스트리 렌더 |
| `components/board/BoardPanel.tsx` | 패널 셸(제목·컨트롤·독립 스크롤·에러 경계·lazy) |
| `components/board/board-constants.ts` | `BOARD_P0_PRESET`·staleTime 정책·컬럼 브레이크포인트 |

**수정 파일**
| 파일 | 변경 | 위험 |
|------|------|------|
| `page.tsx` | `boardEnabled` 시 `<ChartBoard>` 렌더 분기 + `boardCtx` 구성(이미 계산된 patient/encounters/billings 주입) | 낮음(분기 추가·기존 경로 불변) |
| `stores/patient-tab-store.ts` | (P1) `boardDensity`·`boardLayout` 추가 | P0는 `boardEnabled`만(구현됨) |

---

## 2. 패널 레지스트리 (DRY 핵심 설계)

**문제**: `page.tsx`는 48개 `activeTab === 'x' && <XTab/>` 매핑을 이미 보유. board가 같은 매핑을 복제하면 이원화. **해결**: 단일 레지스트리에서 렌더 함수를 공유.

**계약**: 탭마다 prop이 다르다 — 대부분 `({ patientId })`이나 `OverviewTab`은 요약 데이터 주입형. 그래서 레지스트리는 **`render(ctx)`** 로 통일:

```ts
interface BoardCtx {
  patientId: string;
  // 이미 page.tsx가 조회·계산한 공유 데이터(§6 캐시 재사용·재조회 0)
  recentEncounters: EncounterListItem[]; encountersLoading: boolean;
  billings: BillingWithRelations[]; billingsLoading: boolean;
  totalBillingAmount: number; paidBillings: number;
  userRole?: string;
  onTabChange: (tab: string) => void;   // 패널 내 액션 → 좁은 뷰 진입(P-5 안전 실행)
}

type Suitability = 'optimal' | 'list' | 'wide' | 'unfit';   // §3.9

const PANEL_REGISTRY: Record<string, {
  label: string; suitability: Suitability; render: (ctx: BoardCtx) => JSX.Element;
}> = {
  vitals:     { label: '바이탈',   suitability: 'optimal', render: c => <VitalsTab patientId={c.patientId} /> },
  labresults: { label: '검사결과', suitability: 'optimal', render: c => <LabResultsTab patientId={c.patientId} /> },
  medications:{ label: '투약',     suitability: 'optimal', render: c => <MedicationTab patientId={c.patientId} /> },
  problems:   { label: '문제목록', suitability: 'optimal', render: c => <ProblemListTab patientId={c.patientId} /> },
  allergies:  { label: '알레르기', suitability: 'optimal', render: c => <AllergyTab patientId={c.patientId} /> },
  overview:   { label: '요약',     suitability: 'optimal', render: c => (
                  <OverviewTab patientId={c.patientId}
                    recentEncounters={c.recentEncounters} encountersLoading={c.encountersLoading}
                    billings={c.billings} billingsLoading={c.billingsLoading}
                    totalBillingAmount={c.totalBillingAmount} paidBillings={c.paidBillings}
                    onTabChange={c.onTabChange} userRole={c.userRole} /> ) },
  // … P1에서 목록/광폭 탭 확장(orders·nursing·admissions·imaging(wide)…)
};
```

- **P0 범위**: 레지스트리에 **6개 프리셋 패널만** 등록. 나머지 42탭은 P1(편집기 도입 시) 추가.
- **좁은 뷰 리팩터**: `page.tsx`의 48-매핑을 이 레지스트리로 치환하는 것은 **P1 이후**(회귀 위험 최소화). P0는 board만 레지스트리 사용.
- **🔑 코드분할 유지(D7)**: `render`는 `page.tsx`가 이미 선언한 **`dynamic()` 지연 컴포넌트를 참조**(직접 import 금지). 그래야 board가 6청크를 동시 로드하지 않고 기존 스플릿을 유지. 레지스트리는 `page.tsx`에서 dynamic 심볼을 주입받거나, board 전용 dynamic 재선언(단일 인스턴스 보장).

---

## 3. 상태 모델

| 필드 | 시점 | 저장 | 비고 |
|------|------|------|------|
| `boardEnabled: boolean` | **P0(구현됨)** | localStorage `patient-board-enabled` | 사용자 뷰 선호 |
| `BOARD_P0_PRESET: string[]` | P0 | 상수 | `['overview','vitals','labresults','medications','problems','allergies']` |
| `boardDensity` | P1 | localStorage | 기본 `comfortable`(P-4) |
| `boardLayout`(패널·순서·폭·컬럼) | P1 | localStorage | 편집기(§3.8) |
| 서버 동기화 | P1.5 | `UserDashboardConfig` | 로밍 |

→ P0는 **무편집·고정 프리셋**. 상태 추가 없음(기구현 `boardEnabled`만 소비).

---

## 4. 레이아웃 — 안전 sticky 존 + 반응형 그리드

```
<ChartBoard>  (page.tsx가 boardEnabled 시 컨테이너 max-w-none 이미 적용)
  <BoardSafetyZone>            ← sticky top-0 z-20, 항상 노출(P-1/P-2)
     PatientHeader(compact)  ·  PatientFlagBar  ·  TwinCdsCards
  </BoardSafetyZone>
  <div class="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 min-[2560px]:grid-cols-4 gap-4">
     {PRESET.map(k => <BoardPanel .../>)}
  </div>
</ChartBoard>
```
- **컬럼**: `xl(1280)→2`, `2xl(1536)→3`, `≥2560px→4`. `xl` 미만(노트북)은 1컬럼 폴백.
- **초광폭 가독폭(D8)**: 3440 울트라와이드·4열에서 한 줄이 과도하게 길어지면 판독 피로 → **패널 콘텐츠 `max-w`(예 `max-w-[46rem]`) 또는 열 상한 4**로 가독폭(≈65~90자) 유지. 패널 셀은 늘되 내용은 안 늘어지게.
- **좁은 화면 강제 폴백(D9)**: `boardEnabled`는 전역 지속 → 좁은 단말(태블릿·노트북)에서도 켜진 상태. **`< xl`에서는 `boardEnabled` 무시하고 기존 좁은 뷰 강제 렌더**(board는 넓은 화면 전용). 진입 버튼도 `< xl` 비활성(§3.1). 사용자가 회진 태블릿에서 열어도 깨지지 않음.
- **패널 독립 스크롤**: `max-h-[calc(100vh - var(--safezone-h) - 2rem)] overflow-y-auto` → 전체 페이지 스크롤 대신 패널별. `--safezone-h`는 안전 존 실측 높이(§4.1).
- **밀도**: 루트 `data-density="comfortable"`(P0) — 단 실제 폰트 스케일 메커니즘은 §5.1 참조(하드코딩 `text-xs`엔 자동 적용 안 됨).

### 4.1 안전 sticky 존 상세 (P-1/P-2 — 임상 안전의 핵심, D1·D3)

> 대형 화면·회진에서 **접촉 전 격리 확인·코드 전 DNR·낙상 주의·악화(EWS)**는 알러지만큼 중요하다. 그런데 기존 `PatientHeader`+`PatientFlagBar`는 **알러지 + 행정 플래그(악성·VIP·지인)만** 노출하고 **임상 안전신호가 빠져 있다**(데이터엔 존재).

**구성(위→아래, 항상 sticky·비제거)**
1. **식별 스트립(1행·필수·P-2)**: `이름 · 성별/나이 · MRN · 생년월일 · 혈액형`. 어느 패널을 봐도 "누구 차트"인지 IPSG-1. board에선 `PatientHeader` 전체가 아니라 **슬림 식별 바**(액션바·사진 제외)를 별도 렌더 권장 → sticky 높이 최소화. (전체 `PatientHeader` 재사용 시 하단 액션바가 sticky에 중복 노출·과대 → 지양.)
2. **알러지 배지(필수·P-1)**: 있으면 적색 `알레르기 N건`(펼침), 없으면 `NKDA`. 기존 렌더 재사용.
3. **임상 안전 배지 줄(신규·D1)** — **있을 때만** 표시(대개 재원/특수):
   | 신호 | 소스(환자스코프) | 표기 |
   |------|------------------|------|
   | 격리 | `Admission.isolation`/`isolationType` | 🟧 `격리: <유형>`(접촉/비말/공기) |
   | DNR/코드 | `AdvanceDirective.cprDecision`(DO/DNR)·`HospiceRegistration.dnrStatus` | 🟥 `DNR` / `Full code` |
   | 낙상 | `FallRiskAssessment`(patientId·score) | 🟨 `낙상위험 고` |
   | 악화점수 | `EarlyWarningScore`(patientId) | EWS 점수(색) |
   | 행정 플래그 | `PatientFlagBar`(악성·VIP·지인) | 기존 |
4. **위험 카드 응축(D3)**: `TwinCdsCards`는 개수·높이 가변 → sticky에 전량 노출 금지. **`critical`만 1행 경고 스트립**으로 압축(예 `🚨 2건`), 클릭 시 펼침. `warning/info`는 접힘 기본. → sticky 높이 상한(예 `max-h-[132px]`) 보장.

**구현 범위(현실적 phasing)**
- **P0**: 식별 스트립 + 알러지 + 기존 `PatientFlagBar` + `TwinCdsCards`. **추가 쿼리 0**(기존 데이터/컴포넌트).
- **✅ 구현(2026-07-06) — 임상 안전 배지 줄(D1 본체 일부)**: `PatientSafetyBar` 신규 컴포넌트. **DNR·낙상·EWS**를 기존 환자별 EP(`GET /api/v1/safety/ews/patient/:id`·`/safety/fall-risk/:id`·`/hospice/directives/:id`)로 조회, **심각(MEDIUM/HIGH·DNR)일 때만 배지 노출**(외래·안정 환자는 렌더 0 → 시각 변화·리스크 없음). 안전 존(sticky)에 배치 → board·좁은 뷰 **공통** 적용. **BE 변경 0·순수 FE**(retry:false·staleTime 5분).
- **✅ 격리 배지(구현 2026-07-06·PR#273)**: `GET /safety/isolation/:patientId` 신설(MDRO active+감염감시 미해소 병합) → PatientSafetyBar 격리 배지(주황·최우선 순서). 잔여(선택): 4쿼리→1 집계 EP 최적화.

---

## 5. `<BoardPanel>` 스펙

```
<section class="board-panel rounded-2xl border bg-white flex flex-col max-h-…">
  <header hover-controls>
     <h3>{title}</h3>  <FreshnessBadge/>(P1)  <div class="controls">↻ ⤢ ∨</div>
  </header>
  <div class="body overflow-y-auto">
     <ErrorBoundary fallback=…>{render(ctx)}</ErrorBoundary>   ← 한 패널 실패 격리(§3.7)
  </div>
</section>
```
- **에러 격리**: `ErrorBoundary`로 감싸 한 패널 예외가 board 전체를 깨지 않음. 대부분 탭은 자체 `QueryErrorFallback` 보유 → 이중 안전망.
- **lazy**: 패널 컴포넌트는 기존 `dynamic()` 유지(page.tsx가 이미 dynamic import) → 청크 분할 유지. below-fold 패널은 뷰포트 진입 시 마운트(P1 §6-C).
- **컨트롤 절제(§3.10)**: 평상시 제목만, hover 시 `↻`(새로고침 P2)·`⤢`(최대화)·`∨`(접기) 등장. P0는 접기만 필수, 나머지 P1/P2.
- **✅ 접기·빈패널 자동축소(구현 2026-07-06, D6 해소)**: BoardPanel에 우상단 **접기 버튼** + 접힘 시 registry label **컴팩트 바**. 빈 패널은 **콘텐츠를 항상 마운트한 채 자연 높이 측정**(ResizeObserver, `h-0` 클립이라 로딩→로드 전환에도 측정 정확) → 임계(150px) 미만이면 **자동 축소 + "기록 없음"**. 사용자 수동 접기/펼치기가 자동 규칙을 오버라이드(`manual ?? autoEmpty`). 탭 컴포넌트 수정 0(신호 계약 불요).

### 5.1 밀도 메커니즘 — 정직한 정의 (D2)
- **결함**: 패널 탭들은 `text-xs`/`text-sm`(Tailwind = 고정 `rem`, root 기준). 루트 `data-density`에 `font-size`를 줘도 **자식의 `text-xs`는 스케일되지 않는다**(rem은 부모 font-size 무시). → "comfortable/compact를 font-size로 전환"은 **그대로는 동작 안 함**.
- **P0 정의**: `comfortable` = **기본 렌더 그대로 + 넉넉한 그리드 셀**(패딩·gap). 별도 폰트 축소 없음(오독 방지 P-4에 부합). 즉 P0에서 밀도 토글은 제공하지 않고 comfortable 하나.
- **✅ 회진 밀도 구현(2026-07-06)**: 위 ⓐ 채택 — `globals.css`의 `.chart-board-round .text-xs/.text-sm/…{font-size:…}`로 **board scope 한정** 폰트 확대(전역 무영향). `store.boardRound`(localStorage) + BoardHeaderBar `회진↔보통` 토글. `compact`(축소)는 미도입(오독 위험·수요 없음). 기본 comfortable 유지(P-4).

### 5.2 임상 강조 상속 — board에서도 유지 보장 (D4)
- **이상치·임계 강조**: `VitalsTab`은 G3-3/G3-4로 **정상범위·이상 임계 색강조**를 이미 내장 → board는 컴포넌트 재사용이라 **자동 상속**. Lab·만성도 각 탭의 이상치 표기 상속. (별도 작업 불요, **수용기준으로 검증**.)
- **위급치 배너 전역**: `CriticalValueAlertBanner`는 `(main)/layout.tsx`에서 board 콘텐츠 **위에 전역 렌더** → board 모드에서도 위급 알림 유지(P-1). 안전 존과 별개로 최상단 유지.
- **추세 우선(P-7)**: 바이탈·만성 패널은 sparkline·추이 내장 → board에서 스냅샷 아닌 추세로 인지.

---

## 6. 동시 쿼리 설계 (기획 §6 반영)

board 진입 시 6패널 동시 마운트. 목표 **신규 요청 ≤12·중복 0**.

- **공유 데이터 주입(B안)**: `OverviewTab`이 쓰는 encounters/billings는 `boardCtx`로 **주입**(page.tsx가 이미 조회) → 재조회 0.
- **캐시 공유(A안)**: `VitalsTab`/`LabResultsTab`/`MedicationTab`은 자체 `useQuery`지만 **queryKey 동일**하면 RQ 자동 캐시 히트(좁은 뷰에서 이미 본 환자면 즉시).
- **중복 dedup**: OverviewTab 내부 `lab/results?days=3`·`prescriptions?status=ACTIVE`가 Lab/Med 패널과 **파라미터 상이** → 알려진 중복(기획 §6.1). P0 완화: 두 패널이 board에 함께 뜰 때 Overview의 요약 위젯을 **동일 queryKey로 정렬**하거나 중복 허용하되 계측 후 판단.
- **staleTime 차등**(P-3·§6.2): 바이탈 60s · 검사/투약 120s · 문제/알러지/요약 300s. `board-constants.ts`에 명시.

### 6.1 로딩 편성 (동시 6패널의 체감)
- **우선순위 로드**: 상단 4패널(요약·바이탈·검사·투약) 먼저 마운트, below-fold 2패널(문제·알러지)은 뷰포트 진입 시(P1 IntersectionObserver). P0는 렌더 순서로 근사.
- **스켈레톤**: 각 패널은 **자체 스켈레톤**(기존 탭 보유) → BoardPanel은 셸만, 로딩 표시는 패널이 담당. 6개 스켈레톤이 동시에 뜨는 인상 완화 위해 셀 배경만 은은히.
- **캐시 히트 우선**: 좁은 뷰에서 이미 조회된 환자를 board로 열면 staleTime 내 즉시 표시(재요청 0) → 전환이 빠르게 느껴짐.

---

## 7. 인터랙션·접근성 상세 (진입·이탈·키보드 — D5)

> 의료진은 마우스 없이 빠르게 전환한다. 진입/이탈·포커스·스크린리더를 명확히.

- **진입/이탈**: 토글 클릭 or `Alt+B`(P1) → `boardEnabled` 전환. **`Esc`로 일반 복귀**(board 활성 시 전역 핸들러, 단 열린 모달·입력 포커스 중이면 무시). 진입 시 포커스를 board 컨테이너로 이동, `aria-live="polite"`로 "큰 화면 보기" 안내.
- **`?tab=` / activeTab 처리(D5)**: board 진입 시 현재 `activeTab`을 **기억**만 하고 board는 프리셋을 렌더(P0는 단일 포커스 개념 없음). **이탈 시 기억한 `activeTab` 복원**. P1에서 `?tab=`을 "초기 강조 패널"로 해석(§3.5).
- **키보드 내비(P1)**: `1~9` 패널 포커스·`↑↓←→` 그리드 이동(`HotkeyProvider` 재사용). P0는 표준 Tab 순서(패널 DOM 순서 = 시각 순서) 보장.
- **인쇄(D5)**: board 활성 중 `window.print()` 시 **멀티컬럼은 인쇄 부적합** → `@media print`에서 `.chart-board .grid{display:block}`로 **단일 컬럼 강제**(패널 세로 나열)하거나, 인쇄는 기존 좁은 레이아웃 안내. 안전 존은 인쇄에도 노출(식별·알러지).
- **어포던스**: 아이콘 버튼 `aria-label`, 토글 `aria-pressed`, 접기 `aria-expanded`. `focus-visible` 링 필수. `prefers-reduced-motion` 시 전환 애니메이션 생략.
- **프라이버시(D10)**: board는 넓은/공용 모니터(간호스테이션)에서 더 많은 PHI를 동시 노출 → shoulder-surfing 유의. 기존 **단말 잠금(DailyPin)·`refetchOnWindowFocus=false`** 승계. 유휴 자동 블러/잠금은 P2 검토(단말 보안 정책 연계).

---

## 8. P0 빌드 순서 & 수용 기준

**순서**
1. `board-constants.ts` — 프리셋·staleTime·브레이크포인트.
2. `panel-registry.tsx` — 6패널 render(ctx).
3. `BoardPanel.tsx` — 셸(헤더·독립 스크롤·ErrorBoundary·접기).
4. `ChartBoard.tsx` — 안전 존 + 그리드 + 레지스트리 map.
5. `page.tsx` — `boardEnabled ? <ChartBoard ctx={boardCtx}/> : (기존 탭 렌더)`; `boardCtx` 구성.
6. comfortable 밀도 scope CSS.

**수용 기준(P0)** — 기능
- 2560px에서 6패널 **3컬럼 동시 표시**, 스크롤 0에서 요약·바이탈·검사·투약 인지.
- 한 패널 쿼리 실패가 다른 패널·전체를 깨지 않음(에러 격리).
- board 진입 신규 요청 **≤12·중복 0**(네트워크 탭 계측).
- 토글 왕복·`< xl` **좁은 뷰 강제**(board 미적용)·기존 좁은 뷰 무회귀·**인쇄 단일컬럼**. **tsc 0**.

**수용 기준(P0) — 🔴 임상 안전(필수 게이트)**
- **환자 식별 편재**: 어느 패널을 스크롤/포커스해도 식별 스트립(이름·MRN·생년월일) 상시(P-2·IPSG-1).
- **알러지 상시**: 스크롤 무관 항상 노출, 커스터마이즈로 숨김 불가(P-1).
- **이상치·위급 강조 유지(D4)**: board 패널에서도 바이탈 이상 임계 색강조·`CriticalValueAlertBanner` 위급 알림이 좁은 뷰와 동일하게 표시.
- **오독 없음(P-4)**: comfortable 렌더에서 숫자·단위 가독(폰트 축소 없음).
- **위험 카드 응축**: `critical` 위험이 sticky 경고 스트립에 항상 보이되 sticky 높이 상한 유지(D3).

---

## 9. 잔여 결정 (구현 중 확정)
1. **안전 존 식별 바**: 전체 `PatientHeader` 재사용 vs **슬림 식별 바 신규**(§4.1 권장 — sticky 높이·액션바 중복 회피). 실측 후 확정.
2. **임상 안전 배지(D1)**: 격리·DNR·낙상·EWS를 P0 포함(추가 쿼리)할지 **P1**(권장)로 둘지 — board 무관 헤더 공통 개선으로 승격 가능.
3. **밀도 스케일 메커니즘(D2)**: 회진 `round` 도입 시 ⓐ CSS override / ⓑ 패널 리팩터 / ⓒ scale 중 택1 — **P1 결정**(P0는 comfortable 단일).
4. OverviewGrid 중복 조회(§6) — P0 **계측 후** dedup 여부(먼저 동작·수치 보고).
5. 좁은 뷰 `page.tsx` 48-매핑의 레지스트리 치환 시점(**P1 이후**·회귀 위험).
6. 안전 존 높이(`--safezone-h`)에 따른 패널 `max-h`·위험카드 응축 상한 — 실측 후 확정.
7. 초광폭 패널 콘텐츠 `max-w` vs 열 상한(D8) — 실측(3440/4K)에서 확정.
