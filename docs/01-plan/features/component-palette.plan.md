# 컴포넌트 팔레트 기획서 v1.2 — 2차 검토 보완

> 작성일: 2026-05-30
> 근거: v1.1 자체 검토 — **13개 추가 문제점** 발견 및 보완
> 누적: v1.0(15건) + v1.2(13건) = **총 28건** 검토 완료

---

## 1. 발견된 문제점 목록

### 치명 (구현 불가 수준) — 4건

| # | 문제 | v1.0 현재 | 영향 |
|:-:|------|----------|------|
| **C1** | **슬롯 컴포넌트는 자유 배치 불가** | SOAP 노트, 처방 입력을 "슬롯"으로 분류하고 드래그 배치 가능하다고 명시 | SOAP/처방은 순차적 워크플로우 (진단→처방→검사)이며 폼 제출 핸들러가 encounter 컨텍스트에 강하게 결합. 자유 배치하면 **제출 순서, 유효성 검증, 데이터 무결성이 깨짐** |
| **C2** | **탭 기반 페이지와의 충돌** | patient-detail을 편집 가능 화면으로 포함 | patient-detail은 35+ 동적 탭으로 구성. 팔레트가 **페이지 레벨**에서 동작하면 탭 구조와 충돌, **탭 레벨**에서 동작하면 저장 복잡도 35배 증가 |
| **C3** | **동적 컨텍스트 변동** | requiredContext는 페이지 접속 시 고정 값 | 환자 상세에서 치과 차트를 배치해도, **비치과 환자를 볼 때** 치과 차트는 무의미. 컨텍스트가 **환자마다 달라지는** 경우를 미처리 |
| **C4** | **컴포넌트 간 데이터 흐름 의존성** | constraints.incompatibleWith만 정의 | CDSS 경고는 활성 처방+진단에 의존, 약물 상호작용은 처방 목록에 의존. **단순 비호환이 아닌 데이터 파이프라인 의존성**이 존재하며 이를 incompatibleWith으로 표현 불가 |

### 높음 — 5건

| # | 문제 | v1.0 현재 | 영향 |
|:-:|------|----------|------|
| **H1** | **저장/영속화 모델 미정의** | DashboardConfig만 정의 | 편집 가능 화면 9개 × 사용자 수 = 잠재적으로 수천 건의 config. 탭 단위까지 저장하면 × 35. **DB 모델, API 구조, 성능 미설계** |
| **H2** | **편집 모드와 기존 인터랙션 충돌** | "편집 버튼 → 편집 모드 진입" 만 언급 | patient-detail은 클릭 가능한 요소가 수백 개 (탭, 링크, 버튼, 폼). 편집 모드에서 **기존 인터랙션을 모두 억제**해야 하지만, 이 방법이 미정의 |
| **H3** | **컴포넌트 수 과대 산정** | 78종 | info-patient-avatar, info-demographics 등은 이미 PatientHeader에 포함된 **하위 요소**. 독립 배치하면 데이터 중복. **실제 독립 배치 가능한 컴포넌트는 ~45종** |
| **H4** | **전문과 제한 기준 모호** | "전문과 제한: 치과, 안과..." | 사용자의 department? 환자의 진료과? 현재 encounter의 진료과? **3가지 기준이 혼재**되어 있고 어느 것을 쓸지 미정의 |
| **H5** | **인쇄/법적 서식 영향** | 미언급 | 커스텀 레이아웃이 의료 기록 인쇄에 영향. **법정 EMR 인증 서식** (진단서, 처방전, 입퇴원 기록)은 레이아웃 변경 불가 |

### 중간 — 4건

| # | 문제 | v1.0 현재 | 영향 |
|:-:|------|----------|------|
| **M1** | **Undo 복잡도 폭증** | 대시보드의 단순 flat layout undo | 페이지 + 탭 + 컴포넌트 위치 + 컴포넌트 설정 = 중첩 상태. undo 스택 설계 미반영 |
| **M2** | **태블릿 사용 미고려** | sm에서 편집 불가 | 간호사는 **태블릿으로 bedside care** 중 입원 환자 상세를 사용. 편집 불가이면 핵심 사용자층 제외 |
| **M3** | **블록의 props 전달 방식 미정의** | "context.routeParams를 props로 전달" | VitalTrendChart는 patientId만 필요하지만, PerioChart는 patientId + encounterDate + selectedTeeth가 필요. **컴포넌트별 필수 props가 다른데 이를 어떻게 매핑하는지 미정의** |
| **M4** | **버전 마이그레이션 미정의** | 없음 | 컴포넌트 ID 변경/삭제 시 저장된 레이아웃과 불일치. 대시보드에서는 version 필드로 처리하지만 페이지별 config에 대한 마이그레이션 전략 없음 |

### 낮음 — 2건

| # | 문제 | 비고 |
|:-:|------|------|
| **L1** | 카테고리 "운영" 6종 중 smart-search, ai-chat은 이미 TopBar/Sidebar에 전역 존재 | 중복 배치 시 혼란 |
| **L2** | previewType "diagram"은 미니 미리보기로 표현 불가 (SVG/Canvas가 너무 복잡) | placeholder 이미지 필요 |

---

## 2. 수정 방안

### 2.1 [C1] 슬롯 컴포넌트 재분류 → "편집 불가 고정 영역"

**문제**: SOAP 노트, 처방 입력 등 워크플로우 컴포넌트를 자유 배치하면 임상 안전 위험

**수정**:

```
v1.0: 위젯 / 블록 / 슬롯 (3계층, 슬롯도 드래그 가능)

v1.1: 위젯 / 블록 / 고정 영역 (3계층)
  ├─ 위젯: 독립 데이터 소스, 자유 배치 ✅
  ├─ 블록: UI 프리미티브, 자유 배치 ✅ (차트, 테이블, 다이어그램, 알림)
  └─ 고정 영역: 워크플로우 컴포넌트, 편집 불가 ❌
       ├─ SOAP 노트, 처방 입력, 검사 오더 등 9종
       ├─ 페이지에 기본 위치에 항상 표시 (static)
       └─ 팔레트에 표시하되 "고정 — 이동 불가" 라벨
```

**임상 기록 9종 + 오더/처방 6종 = 15종 → 고정 영역으로 재분류**

```typescript
interface ComponentDef {
  // ... 기존
  placement: 'free' | 'fixed';  // NEW
  // free: 위젯/블록 — 드래그 배치 가능
  // fixed: 고정 영역 — 이동/삭제 불가, 표시/숨기기만 가능
}
```

**수정 후 팔레트 표시**:

| 유형 | 팔레트 동작 | 수량 |
|------|-----------|:----:|
| 위젯 (free) | 클릭 추가, 드래그 이동 | 57 |
| 블록 (free) | 클릭 추가, 드래그 이동 | ~30 |
| 고정 영역 (fixed) | 표시/숨기기 토글만 | 15 |
| **합계** | | **~102** |

팔레트에 고정 영역은 별도 섹션:
```
┌────────────────────────────────────┐
│ 📌 고정 영역 (표시/숨기기만 가능)    │
│ ☑ SOAP 노트    ☑ 처방 입력        │
│ ☐ 수술 기록    ☑ 바이탈 입력       │
│ (체크박스 토글 — 드래그 불가)        │
└────────────────────────────────────┘
```

### 2.2 [C2] 탭 기반 페이지 → 편집 범위 제한

**문제**: patient-detail의 35+ 탭 전체를 편집 대상으로 하면 복잡도 폭증

**수정**: 편집 가능 범위를 **페이지 최상위 레이아웃**으로 제한

```
v1.0: 페이지 전체 (탭 내부 포함) 편집 가능

v1.1: 편집 가능 범위
  ├─ dashboard: 전체 그리드 ✅
  ├─ executive: 전체 그리드 ✅
  ├─ workstation: 카드 순서 ✅
  ├─ patient-detail: ❌ 편집 불가 (탭 구조가 워크플로우)
  │   → 대신: 탭 순서/표시 설정만 가능 (팔레트 아닌 설정 패널)
  ├─ encounter-new: ❌ 편집 불가 (순차 워크플로우)
  ├─ inpatient-detail: ❌ 편집 불가 (간호 워크플로우)
  ├─ reception: 섹션 순서 ✅
  ├─ his-checkup: stat 카드 + 테이블 ✅
  └─ nurse-station: 카드 순서 ✅
```

**편집 가능 화면: 9개 → 6개로 축소**

탭 기반 페이지(patient-detail, encounter-new, inpatient-detail)는 **탭 설정 패널**로 대체:
```
┌────────────────────────────────────┐
│ ⚙ 탭 설정                          │
│ ☑ 바이탈    ☑ 검사결과   ☑ 영상    │
│ ☐ 피부과    ☐ 치과       ☑ 수술    │
│ (전문과에 맞는 탭만 선택)            │
│                                    │
│ 순서: [위로▲] [아래로▼] 버튼       │
└────────────────────────────────────┘
```

### 2.3 [C3] 동적 컨텍스트 → 조건부 렌더링 규칙

**문제**: 치과 차트를 배치해도 비치과 환자에게는 무의미

**수정**: `constraints`에 `dynamicContext` 추가

```typescript
interface ComponentDef {
  constraints: {
    // ... 기존 (정적 체크)
    dynamicContext?: {
      field: string;         // 런타임에 체크할 데이터 필드
      source: 'patient' | 'encounter' | 'admission';
      condition: string;     // 조건식
      fallbackBehavior: 'hide' | 'placeholder' | 'message';
      fallbackMessage?: string;
    }[];
  };
}

// 예시: 치과 차트
{
  id: 'diag-dental',
  constraints: {
    requiredContext: ['patient'],
    dynamicContext: [{
      field: 'encounter.department',
      source: 'encounter',
      condition: "includes('치과')",
      fallbackBehavior: 'placeholder',
      fallbackMessage: '현재 진료과에서는 치아 차트를 사용하지 않습니다',
    }],
  },
}
```

**런타임 동작**:
- 배치된 컴포넌트가 렌더링될 때 `dynamicContext` 체크
- 조건 불만족 시 `fallbackBehavior`에 따라:
  - `hide`: 완전 숨김 (공간도 차지 안 함)
  - `placeholder`: 빈 카드 + 안내 메시지
  - `message`: 안내 메시지만 표시

### 2.4 [C4] 데이터 의존성 → 의존성 그래프

**문제**: CDSS는 처방+진단에 의존, 약물 상호작용은 처방에 의존

**수정**: `constraints.incompatibleWith` → `constraints.dependencies`로 확장

```typescript
interface ComponentDef {
  constraints: {
    // 기존
    incompatibleWith: string[];

    // NEW: 데이터 의존성
    dependencies?: {
      componentId: string;   // 의존하는 컴포넌트 ID
      type: 'requires' | 'enhancedBy';
      // requires: 없으면 작동 안 함
      // enhancedBy: 없어도 작동하지만 있으면 더 좋음
    }[];
  };
}

// 예시
{ id: 'alert-cdss', constraints: {
  dependencies: [
    { componentId: 'ord-prescription', type: 'requires' },
    { componentId: 'info-problem-list', type: 'enhancedBy' },
  ],
}}
```

**팔레트 표시**: 의존 컴포넌트가 미배치 시 경고
```
⚠ CDSS 임상 경고
  "처방 입력" 컴포넌트가 필요합니다
  [처방 입력과 함께 추가]  ← 원클릭으로 둘 다 추가
```

### 2.5 [H1] 저장 모델 → 범용 UserPageConfig

```prisma
model UserPageConfig {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  pageId    String   @map("page_id") @db.VarChar(50)  // 'dashboard', 'executive', ...
  config    Json     @db.JsonB
  updatedAt DateTime @updatedAt @map("updated_at")
  createdAt DateTime @default(now()) @map("created_at")

  user      User     @relation(fields: [userId], references: [id])

  @@unique([userId, pageId])
  @@map("user_page_configs")
}
```

- 기존 `UserDashboardConfig` → `UserPageConfig`로 통합
- `pageId` = 'dashboard' | 'executive' | 'workstation' | 'reception' | 'his-checkup' | 'nurse-station'
- **탭 기반 페이지(patient-detail 등)는 별도 `UserTabConfig`** (탭 표시/순서만):

```prisma
model UserTabConfig {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  pageId    String   @map("page_id") @db.VarChar(50)
  tabOrder  Json     @db.JsonB  // ["vitals", "lab", "imaging", ...]
  hiddenTabs Json    @db.JsonB  // ["dental", "dermatology", ...]
  updatedAt DateTime @updatedAt @map("updated_at")

  user      User     @relation(fields: [userId], references: [id])

  @@unique([userId, pageId])
  @@map("user_tab_configs")
}
```

### 2.6 [H2] 편집 모드 인터랙션 억제 → 오버레이 방식

```
편집 모드 시:
┌──────────────────────────────────┐
│ [기존 페이지 콘텐츠]              │ ← pointer-events: none
│                                  │
│  ┌───────────┐  ┌───────────┐   │ ← 위젯/블록에만 드래그 핸들
│  │ 위젯 A    │  │ 위젯 B    │   │    pointer-events: auto (핸들만)
│  │     ⠿    │  │     ⠿    │   │
│  └───────────┘  └───────────┘   │
│                                  │
│ 반투명 오버레이 (blue tint)       │ ← 클릭 억제
└──────────────────────────────────┘
```

- 편집 모드 진입 시 **페이지 전체에 반투명 오버레이**
- 위젯/블록의 **드래그 핸들만** `pointer-events: auto`
- 기존 링크/버튼/폼은 오버레이 아래에서 클릭 불가
- ESC 키로 편집 모드 종료

### 2.7 [H3] 컴포넌트 수 조정 → 독립 배치 가능한 것만

**제거 대상 (이미 다른 컴포넌트에 포함)**:

| ID | 사유 | 대안 |
|----|------|------|
| `info-patient-avatar` | PatientHeader에 포함 | info-patient-header만 유지 |
| `info-demographics` | PatientHeader에 포함 | 동일 |
| `info-contacts` | 환자 상세 탭에 포함 | 탭 설정으로 제어 |
| `ops-smart-search` | TopBar에 전역 존재 | 중복 제거 |
| `ops-ai-chat` | FloatingAiChatBar에 전역 존재 | 중복 제거 |

**수정 후 수량**:

| 유형 | v1.0 | v1.1 | 변경 |
|------|:----:|:----:|------|
| 위젯 (free) | — | 57 | 기존 위젯 팔레트 그대로 |
| 블록 (free) | 63 | **25** | 독립 불가 5종 제거, 고정 15종 분리, 중복 제거 |
| 고정 영역 (fixed) | — | **15** | 워크플로우 컴포넌트 (표시/숨기기만) |
| **합계** | 78 | **97** (위젯 포함) | |

### 2.8 [H4] 전문과 제한 기준 → 명확화

```typescript
interface SpecialtyConstraint {
  basis: 'user-department' | 'encounter-department' | 'manual';
  departments: string[];  // ['치과', '보철과', '교정과']
}

// 판정 순서:
// 1. encounter-department (진료 중이면 해당 진료과 기준)
// 2. user-department (진료 외 화면이면 사용자 소속과 기준)
// 3. manual (사용자가 팔레트에서 필터 선택)
```

### 2.9 [H5] 인쇄 영향 → 편집 레이아웃과 인쇄 레이아웃 분리

```
화면 표시: 사용자 커스텀 레이아웃 (편집 가능)
인쇄 시:   법정 고정 레이아웃 (편집 불가)

// print 감지
@media print {
  .editable-layout { display: none; }
  .print-layout { display: block; }
}
```

**규칙**: 인쇄 대상 페이지(진단서, 처방전, 입퇴원 기록 등)는 `PrintLayout` 컴포넌트가 커스텀 레이아웃을 무시하고 법정 서식을 렌더링.

---

## 3. 수정된 편집 가능 범위

### v1.0 → v1.1 비교

| 화면 | v1.0 | v1.1 | 사유 |
|------|:----:|:----:|------|
| dashboard | 그리드 편집 | 그리드 편집 | 현행 유지 |
| executive | 그리드 편집 | 그리드 편집 | 독립 카드 구조 |
| workstation | 그리드 편집 | **카드 순서만** | 카드가 단순 네비게이션 |
| reception | 그리드 편집 | 섹션 순서 | 탭+큐 구조 |
| his-checkup | 그리드 편집 | 그리드 편집 | stat+테이블 구조 |
| nurse-station | 그리드 편집 | **카드 순서만** | workstation과 동일 패턴 |
| patient-detail | 그리드 편집 | **탭 설정만** | 35+ 탭 → 편집 불가, 탭 표시/순서만 |
| encounter-new | 그리드 편집 | **편집 불가** | 순차 워크플로우 |
| inpatient-detail | 그리드 편집 | **편집 불가** | 간호 워크플로우 |

### 편집 유형 3가지

```
1. 그리드 편집 (dashboard, executive, his-checkup)
   → 위젯/블록을 자유 배치, 크기 조정, 순서 변경
   → 컴포넌트 팔레트 표시

2. 순서 편집 (workstation, reception, nurse-station)
   → 카드/섹션의 순서만 변경 (드래그)
   → 컴포넌트 추가/제거 불가
   → 간소화된 팔레트 (순서만)

3. 탭 설정 (patient-detail)
   → 탭 표시/숨기기 + 순서 변경
   → 컴포넌트 팔레트 대신 설정 패널
```

---

## 4. 수정된 구현 단계

| Phase | 내용 | 공수 | 비고 |
|:-----:|------|:----:|------|
| 1 | `PageContext` + `canPlaceComponent()` + `placement` 필드 | 2시간 | C1 반영 |
| 2 | 블록 25종 등록 + 고정 영역 15종 분류 | 3시간 | H3 반영 |
| 3 | `ComponentPalette` (가능/불가능 + 고정영역 토글) | 3시간 | |
| 4 | `EditablePageShell` + 오버레이 편집 모드 | 3시간 | H2 반영 |
| 5 | `dynamicContext` 런타임 체크 + fallback | 2시간 | C3 반영 |
| 6 | `UserPageConfig` + `UserTabConfig` Prisma 모델 | 1시간 | H1 반영 |
| 7 | 탭 설정 패널 (patient-detail용) | 2시간 | C2 반영 |
| 8 | executive 페이지 적용 (첫 확장) | 3시간 | |
| 9 | 인쇄 레이아웃 분리 | 1시간 | H5 반영 |

---

## 5. v1.0 → v1.1 변경 이력

| 항목 | v1.0 | v1.1 |
|------|------|------|
| 슬롯 유형 | 자유 배치 가능 | **고정 영역 (표시/숨기기만)** — 임상 안전 |
| 편집 가능 화면 | 9개 | **6개** (워크플로우 3개 제외) |
| 편집 유형 | 그리드 편집만 | **3가지** (그리드/순서/탭설정) |
| 컴포넌트 수 | 78종 | **97종** (위젯 57 + 블록 25 + 고정 15, 중복 5종 제거) |
| 컨텍스트 체크 | 정적만 (페이지 접속 시) | **정적 + 동적** (환자/진료과별 런타임) |
| 데이터 의존성 | incompatibleWith | **dependencies** (requires / enhancedBy) |
| 전문과 기준 | 미정의 | **encounter → user → manual** 3단계 |
| 저장 모델 | 미정의 | **UserPageConfig + UserTabConfig** 2종 |
| 인터랙션 억제 | 미정의 | **오버레이 + pointer-events 제어** |
| 인쇄 영향 | 미고려 | **법정 서식 분리 (@media print)** |
| 태블릿 | 편집 불가 | 순서 편집은 **태블릿에서도 가능** (Phase 2+) |
| 탭 기반 페이지 | 그리드 편집 | **탭 설정 패널** (표시/순서만) |

---

## 6. v1.2 추가 검토 — 13개 문제점 보완

### 6.1 [수량 불일치] 위젯 57 + 블록 25 + 고정 15 = 97 — 산출 근거 불명

**문제**: v1.0의 78종에서 5종 제거 = 73종. 그 중 15종이 고정 → 나머지 58종이 free 블록이어야 하는데 "25"로 표기. 위젯 팔레트의 57종과의 중복 관계가 불명확.

**수정**: 명확한 분류 체계

```
전체 컴포넌트 풀
  ├─ A. 위젯 (widget-registry 기존) ──── 57종 (독립 데이터 소스)
  │     이미 위젯 팔레트에 등록, 컴포넌트 팔레트에서는 "위젯" 탭으로 표시
  │
  ├─ B. 블록 (component-registry 신규) ── 25종 (외부 props 필요)
  │     위젯과 중복 없음. patient/encounter 컨텍스트 전용
  │     ├ 환자 정보 5종 (header, insurance, allergy-list, problem-list, medication-list)
  │     ├ 차트 (patient) 5종 (vitals, growth, iop, score, fetal)
  │     ├ 임상 다이어그램 12종 (dental~burns, 중복 4종 제거: growth-curve≒chart-line-growth 등)
  │     └ 알림 (patient) 3종 (allergy, fall-risk, news2)
  │
  ├─ C. 고정 영역 ──── 15종 (표시/숨기기만)
  │     임상 기록 9종 + 오더/처방 6종
  │
  └─ D. 제거됨 ──── 9종
        중복 5종 + 고정에서 분류 변경 시 v1.0→v1.1 매핑 불일치 4종

위젯 탭 표시: A (57종)
블록 탭 표시: B (25종) + 배치 불가 사유 표시
고정 탭 표시: C (15종) — 체크박스 토글
────────────────────────
합계: 97종 (팔레트에 표시되는 총 항목)
```

### 6.2 [인터페이스 이중 정의] ComponentDef vs WidgetDef

**문제**: widget-registry에 `WidgetDef`, 컴포넌트 팔레트에 `ComponentDef` — 두 타입이 공존하면 유지보수 혼란

**수정**: 통합 인터페이스

```typescript
// 통합: ComponentDef가 WidgetDef를 포함
interface ComponentDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: ComponentCategory;
  type: ComponentType;          // 'widget' | 'block' | 'fixed'
  placement: 'free' | 'fixed';

  // 위젯 전용 (type === 'widget')
  defaultW?: number;
  defaultH?: number;

  // 블록 전용 (type === 'block')
  requiredProps?: string[];     // ['patientId', 'encounterId']

  // 공통
  constraints: ComponentConstraints;
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  previewType: PreviewType;
}

// WidgetDef는 ComponentDef의 alias
type WidgetDef = ComponentDef & { type: 'widget' };
```

기존 `widget-registry.ts`는 `component-registry.ts`로 통합하거나, widget-registry가 component-registry를 import하여 위젯만 필터.

### 6.3 [보안] dynamicContext.condition이 문자열 eval

**문제**: `condition: "includes('치과')"` — 문자열을 런타임에 평가하면 XSS/코드 인젝션 위험

**수정**: 구조화된 조건 객체

```typescript
// 문자열 대신 타입 안전한 조건 객체
interface DynamicCondition {
  field: string;
  operator: 'equals' | 'includes' | 'startsWith' | 'in' | 'exists' | 'gt' | 'lt';
  value: string | string[] | number | boolean;
}

// 예시
dynamicContext: [{
  field: 'encounter.department',
  source: 'encounter',
  condition: { field: 'department', operator: 'includes', value: '치과' },
  fallbackBehavior: 'placeholder',
  fallbackMessage: '현재 진료과에서는 치아 차트를 사용하지 않습니다',
}]
```

### 6.4 [논리] dependencies 순환 참조 위험

**문제**: A requires B, B requires A → 무한 루프

**수정**: 등록 시 순환 감지

```typescript
function validateDependencies(registry: ComponentDef[]): string[] {
  const errors: string[] = [];
  for (const comp of registry) {
    for (const dep of comp.constraints.dependencies ?? []) {
      if (dep.type !== 'requires') continue;
      const target = registry.find(c => c.id === dep.componentId);
      if (!target) { errors.push(`${comp.id}: 의존 대상 ${dep.componentId} 미존재`); continue; }
      // 순환 체크
      const targetDeps = target.constraints.dependencies?.filter(d => d.type === 'requires') ?? [];
      if (targetDeps.some(d => d.componentId === comp.id)) {
        errors.push(`순환 의존: ${comp.id} ↔ ${dep.componentId}`);
      }
    }
  }
  return errors;
}
// 개발 모드에서 registry 초기화 시 실행, 오류 있으면 console.error
```

### 6.5 [마이그레이션] UserDashboardConfig → UserPageConfig 전환

**문제**: 이미 프로덕션에 `UserDashboardConfig` 테이블이 존재. 새 `UserPageConfig`로 전환 시 기존 데이터 유실 가능

**수정**: 단계적 마이그레이션

```
Phase 1 (현재): UserDashboardConfig 유지 (pageId 없음)
Phase 2 (확장 시): UserPageConfig 신규 생성
  → 마이그레이션 스크립트:
    INSERT INTO user_page_configs (user_id, page_id, config)
    SELECT user_id, 'dashboard', config FROM user_dashboard_configs;
  → 이후 UserDashboardConfig deprecated
Phase 3: UserDashboardConfig 테이블 삭제
  → FE 코드에서 endpoint를 /page-config/dashboard로 변경
```

**API 하위 호환**:
```
GET /api/v1/dashboard/config       → 기존 유지 (Phase 1~2)
GET /api/v1/page-config/dashboard  → 신규 (Phase 2+), 내부적으로 같은 데이터
GET /api/v1/page-config/:pageId    → 범용 (Phase 2+)
```

### 6.6 [미해결] M1 — Undo 복잡도

v1.1에서 "미해결"로 남아있던 항목. 수정:

```
편집 유형별 undo 전략:
  그리드 편집: 기존 대시보드와 동일 (layout + hiddenWidgets + settings 스냅샷)
  순서 편집:  배열 순서 스냅샷 (단순)
  탭 설정:    tabOrder + hiddenTabs 스냅샷 (단순)

→ 모두 단일 레벨 스냅샷으로 충분
→ 중첩 상태 (페이지+탭+컴포넌트)는 발생하지 않음
   (편집 유형을 분리했으므로 한 번에 하나의 수준만 편집)
```

### 6.7 [미해결] M3 — 블록 props 매핑

수정: `requiredProps` + `propMapping` 정의

```typescript
interface ComponentDef {
  // 블록이 필요로 하는 props
  requiredProps?: string[];   // ['patientId']

  // PageContext에서 props로 자동 매핑
  propMapping?: Record<string, string>;
  // 예: { patientId: 'routeParams.id', encounterId: 'routeParams.encounterId' }
}

// 렌더링 시 자동 변환
function resolveProps(def: ComponentDef, context: PageContext): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [propKey, contextPath] of Object.entries(def.propMapping ?? {})) {
    props[propKey] = getNestedValue(context, contextPath);
  }
  return props;
}
```

### 6.8 [미해결] M4 — 버전 마이그레이션

수정: 대시보드와 동일 패턴 적용

```typescript
// 모든 PageConfig에 version 필드
interface PageConfig {
  version: number;
  layout: WidgetLayout[];
  hiddenComponents: string[];
  componentSettings: Record<string, Record<string, unknown>>;
}

// 페이지별 마이그레이션 함수 registry
const PAGE_MIGRATIONS: Record<string, (config: PageConfig) => PageConfig> = {
  dashboard: migrateDashboardConfig,
  executive: migrateExecutiveConfig,
  // ...
};
```

### 6.9 [UX] "순서 편집"에 팔레트 불필요

**문제**: workstation/nurse-station은 카드 순서만 변경. "간소화된 팔레트"라고 했으나 이는 팔레트가 아님

**수정**: 순서 편집은 **팔레트 없이 드래그 핸들만** 표시

```
순서 편집 모드:
┌──────────────────────────────────┐
│ [순서 편집 중]  [저장] [취소]      │ ← 간소 툴바
├──────────────────────────────────┤
│ ⠿ 채혈실      ← 드래그 핸들      │
│ ⠿ 혈액검사                       │
│ ⠿ X-ray                         │
│ ⠿ CT                            │
│ (팔레트 없음 — 카드 추가/제거 불가) │
└──────────────────────────────────┘
```

### 6.10 [안전] 긴급 초기화 (편집 모드 밖에서)

**문제**: 커스텀 레이아웃이 페이지 crash를 유발하면 편집 모드에 진입 불가

**수정**: URL 파라미터 기반 긴급 초기화

```
/dashboard?resetLayout=true → 레이아웃 초기화 후 리다이렉트
```

```typescript
// page.tsx에서
const searchParams = useSearchParams();
if (searchParams.get('resetLayout') === 'true') {
  await apiClient.del('/api/v1/page-config/dashboard');
  router.replace('/dashboard');
}
```

### 6.11 [권한] 관리자 기본 레이아웃 강제

**문제**: 관리자가 "모든 의사는 이 레이아웃을 기본으로" 설정하는 기능 없음

**수정**: 프리셋 시스템(이전 기획서 Phase 6)과 연계

```
관리자 설정 > 대시보드 프리셋 관리
  ├ 시스템 기본값 (읽기 전용)
  ├ 부서별 추천 레이아웃 (관리자 설정)
  └ 사용자 개인 레이아웃 (개인 설정)

사용자가 "초기화" 시 우선순위:
  1. 부서별 추천 (있으면)
  2. 시스템 기본값
```

v1.2에서는 **설계만 명시**, 구현은 Phase 후반 로드맵.

### 6.12 [UX] 대시보드에서 "고정 영역" 섹션이 비어 보이는 문제

**문제**: 대시보드 편집 시 고정 영역 15종은 모두 encounter/admission 컨텍스트 필요 → 대시보드에는 해당 컨텍스트 없음 → 고정 영역 탭이 빈 상태

**수정**: 팔레트의 탭을 **컨텍스트에 따라 동적 표시**

```
대시보드 편집 시:    [위젯 57종] [블록 3종(global)]  ← 고정 영역 탭 숨김
환자 상세 탭 설정 시: [탭 설정 패널]                  ← 위젯/블록 탭 숨김
executive 편집 시:   [위젯 20종] [블록 2종]          ← 역할 필터 적용
```

### 6.13 [성능] 레지스트리 코드 분할

**문제**: 97종 ComponentDef를 단일 파일에 등록하면 초기 파싱 비용

**수정**: 카테고리별 분할 import

```typescript
// component-registry.ts — 인덱스만
export async function loadCategoryRegistry(category: string): Promise<ComponentDef[]> {
  switch (category) {
    case 'clinical': return (await import('./registries/clinical')).default;
    case 'diagnostic': return (await import('./registries/diagnostic')).default;
    // ...
  }
}

// 팔레트에서 카테고리 탭 전환 시 해당 카테고리만 로드
```

---

## 7. v1.1 → v1.2 변경 이력

| 항목 | v1.1 | v1.2 |
|------|------|------|
| 수량 산출 | 합계만 표기 | **A(57위젯)+B(25블록)+C(15고정)=97 분류 체계** 명확화 |
| 타입 시스템 | ComponentDef + WidgetDef 병존 | **ComponentDef로 통합**, WidgetDef는 alias |
| dynamicContext.condition | 문자열 eval | **구조화 조건 객체** (operator + value) |
| 순환 참조 | 미고려 | **validateDependencies** 등록 시 검증 |
| DB 마이그레이션 | "통합" 명시만 | **3단계 전환** (유지→병행→삭제) + 하위 호환 API |
| M1 Undo | 미해결 | **편집 유형별 단일 레벨** (중첩 없음) |
| M3 Props | 미해결 | **propMapping** 자동 컨텍스트→props 변환 |
| M4 버전 | 미해결 | 페이지별 **마이그레이션 함수 registry** |
| 순서 편집 | "간소화된 팔레트" | **팔레트 없음** — 드래그 핸들만 |
| 긴급 초기화 | 없음 | `?resetLayout=true` **URL 파라미터** |
| 관리자 강제 | 없음 | **프리셋 시스템 연계** (설계만, 구현 로드맵) |
| 빈 고정 탭 | 항상 표시 | **컨텍스트 없으면 탭 자동 숨김** |
| 레지스트리 성능 | 단일 파일 | **카테고리별 동적 import** |
