# 전문과 차트 통합 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/(main)/patients/[id]/page.tsx:113 · apps/web/src/app/(main)/dental/page.tsx:40 · 잔여: 없음

> **Summary**: 독립 전문과 페이지를 환자 차트 탭으로 통합하고, 기존 페이지는 전문과 대시보드로 역할을 전환한다.
>
> **Project**: Hospital RUN
> **Version**: 1.0
> **Author**: Product Manager
> **Date**: 2026-05-19
> **Status**: Draft

---

## 1. 개요

### 1.1 목적

현재 4개 전문과(치과/안과/피부과/이비인후과)는 독립 URL(`/dental`, `/ophthalmology`, `/dermatology`, `/ent`)에 구현되어 있어, 의사가 특정 환자의 전문과 기록을 보려면 해당 페이지로 이동한 후 환자 ID를 별도 입력해야 한다. 이 단절 구조를 해소하고, 메인 환자 차트(`/patients/[id]`)에서 전문과 기록을 직접 열람·입력할 수 있도록 통합한다.

### 1.2 배경

**현재 구조 분석 결과**

| 페이지 | 경로 | 현재 탭 | 환자 선택 방식 |
|--------|------|---------|--------------|
| 치과 | `/dental` | 치아차트 / 치료계획 / 치료기록 / 기공의뢰 | 수동 ID 입력 |
| 안과 | `/ophthalmology` | 검사기록 / 수술기록 / 안압추이 / 처방전 | 수동 ID 입력 |
| 피부과 | `/dermatology` | 병변 / 치료 / 사진 | 수동 ID 입력 |
| 이비인후과 | `/ent` | 검사기록 / 청력도 / 수면검사 | 수동 ID 입력 |

**백엔드 API 확인**

4개 전문과 모두 `patientId`를 URL 파라미터 또는 Body로 전달하는 구조가 이미 구현되어 있다 (`GET /api/v1/dental/chart/:patientId` 등). API 변경 없이 프론트엔드 재구성만으로 통합이 가능하다.

**환자 차트 현행 탭 (11개)**

```
개요 / 문제목록 / 알레르기 / 검사결과 / 영상 / 진료이력 / 문진표 / 처방·수납 / 동의서 / 여정 / 환자정보
```

**전문과 시각화 컴포넌트 현황**

`apps/web/src/components/specialty/`에 12개 SVG/Chart 컴포넌트가 구현 완료 상태이다 (DentalChartDiagram, AudiogramChart, BodyMapDiagram, EyeDiagram 등). 이 컴포넌트들은 현재 독립 페이지에서만 사용 중이며, 환자 차트 탭으로 이전해도 재사용 가능하다.

### 1.3 관련 문서

- 전문과 차트 시각화: `docs/01-plan/features/specialty-charts.plan.md`
- 환자 차트 컴포넌트 위치: `apps/web/src/app/(main)/patients/[id]/page.tsx`

---

## 2. 현재 문제점

### P-01 환자 컨텍스트 단절 (High)

의사가 환자 차트(`/patients/abc-123`) 열람 중 치과 기록을 보기 위해 `/dental`로 이동 시, 환자 정보가 초기화되어 환자 ID를 재입력해야 한다. 한 환자를 여러 전문과에서 볼 때마다 이 과정이 반복된다.

### P-02 네비게이션 구조 불일치 (High)

사이드바에서 전문과 4개 메뉴는 "전문진료" 그룹(`DOCTOR_ADMIN` Role 제한)으로 분리되어 있다. 그러나 실제 운영에서는 환자 페이지 내에서 전문과 기록에 직접 접근하는 패턴이 자연스럽다. 메뉴 구조가 실제 업무 흐름과 어긋난다.

### P-03 전문과 페이지 활용도 부족 (Medium)

현재 전문과 페이지에는 통계, 금일 예약 목록, 대기 중인 기공의뢰 등 전문과 대시보드 기능이 없다. 치과 의사가 오늘 치료할 환자 목록을 한눈에 보거나, 진행 중인 임플란트 케이스를 추적하는 화면이 존재하지 않는다.

### P-04 탭 수 증가에 따른 UX 대응 필요 (Low)

전문과 탭 4개를 환자 차트에 추가하면 탭이 최대 15개가 된다. 모든 환자에게 전문과 탭을 노출하면 탭 바가 과도하게 넓어지고, 내과 외래 환자에게 치과 탭을 보여주는 것은 불필요하다.

---

## 3. 목표 구조

### 3.1 환자 차트 통합 탭 구조

환자 차트 탭에 전문과별 탭을 조건부로 추가한다. 담당 의사의 진료과(department)에 따라 해당 전문과 탭만 표시한다.

**변경 후 탭 구성 (예시: 치과 의사 접속 시)**

```
개요 | 문제목록 | 알레르기 | 검사결과 | 영상 | 진료이력 | 문진표 | 처방·수납 | 동의서 | 여정 | 환자정보 | [치과]
```

**전문과 탭 표시 조건**

| 전문과 탭 | 표시 조건 |
|----------|---------|
| 치과 | `user.department === '치과'` 또는 `ADMIN` Role |
| 안과 | `user.department === '안과'` 또는 `ADMIN` Role |
| 피부과 | `user.department === '피부과'` 또는 `ADMIN` Role |
| 이비인후과 | `user.department === '이비인후과'` 또는 `ADMIN` Role |

관리자(ADMIN)는 모든 전문과 탭 접근 가능. 향후 다진료과 접근 권한 정책은 Role 설정에서 확장 가능.

### 3.2 전문과 페이지 역할 변경 (대시보드화)

기존 `/dental`, `/ophthalmology`, `/dermatology`, `/ent` 페이지는 **전문과 대시보드**로 전환한다. 특정 환자에 종속되지 않는 전과적 정보(오늘 일정, 통계, 케이스 트래킹)를 제공한다.

**치과 대시보드 예시**

```
┌─ 오늘의 치과 현황 ──────────────────────────────────┐
│  진료 예정: 8명  |  완료: 3명  |  기공의뢰 진행 중: 5건  │
└────────────────────────────────────────────────────┘
┌─ 오늘 환자 목록 ─────────────────────────────────────┐
│  09:00  김철수  임플란트 2차   [차트 열기 →]           │
│  10:00  이영희  RCT 3차       [차트 열기 →]           │
│  ...                                                 │
└────────────────────────────────────────────────────┘
┌─ 진행 중인 기공의뢰 ──────────────────────────────────┐
│  박민수  #16 Crown  지르코니아  납기: 2026-05-25       │
│  ...                                                 │
└────────────────────────────────────────────────────┘
```

---

## 4. 범위

### 4.1 포함 범위

- [ ] 환자 차트 페이지에 전문과별 탭 컴포넌트 4개 추가
- [x] 탭 표시 조건: 로그인 사용자의 `department` 기반 동적 렌더링
- [ ] 전문과 탭 내에 기존 페이지의 차트/기록 기능 이전 (컴포넌트 재사용)
- [ ] 기존 전문과 페이지를 대시보드 레이아웃으로 변경
- [ ] 대시보드: 금일 예약 환자 목록 (스케줄 API 연동)
- [ ] 대시보드: 전문과별 통계 카드 (케이스 수, 진행 중 기공의뢰 등)
- [ ] 대시보드 환자 행에 "차트 열기" 링크 (`/patients/[id]?tab=dental` 등)
- [ ] 사이드바 전문과 메뉴는 대시보드로 유지 (삭제하지 않음)

### 4.2 제외 범위

- API 변경 없음 (이미 patientId 기반으로 구현됨)
- DB 스키마 변경 없음
- 새로운 시각화 컴포넌트 개발 없음 (specialty/ 기존 12개 재사용)
- 모바일 앱 대응 (별도 로드맵)
- RBAC 세분화 (다진료과 접근 정책) — 향후 별도 기획

---

## 5. 요구사항

### 5.1 기능 요구사항

| ID | 요구사항 | 우선순위 | 비고 |
|----|---------|---------|------|
| FR-01 | 환자 차트에 치과 탭 추가 — 치아차트/치료계획/치료기록/기공의뢰 | Must | 기존 DentalPage 로직 이전 |
| FR-02 | 환자 차트에 안과 탭 추가 — 검사기록/수술기록/안압추이/처방전 | Must | 기존 OphthalmologyPage 로직 이전 |
| FR-03 | 환자 차트에 피부과 탭 추가 — 병변/치료기록/전후사진 | Must | 기존 DermatologyPage 로직 이전 |
| FR-04 | 환자 차트에 이비인후과 탭 추가 — 검사기록/청력도/수면검사 | Must | 기존 EntPage 로직 이전 |
| FR-05 | 전문과 탭 조건부 표시 — 로그인 사용자 department 기반 | Must | useUser 훅 활용 |
| FR-06 | 전문과 페이지 대시보드 전환 — 금일 환자 목록 | Should | 스케줄 API 연동 필요 |
| FR-07 | 대시보드 통계 카드 — 케이스 수, 기공의뢰 현황 등 | Should | 집계 API 필요 또는 클라이언트 집계 |
| FR-08 | 대시보드 "차트 열기" 딥링크 — `/patients/[id]?tab=dental` | Should | URL 쿼리 파라미터로 탭 자동 활성화 |
| FR-09 | 탭 URL 동기화 — 전문과 탭 진입 시 URL 쿼리 반영 | Could | SEO/북마크 지원 |
| FR-10 | ADMIN 사용자는 모든 전문과 탭 접근 가능 | Must | |

### 5.2 비기능 요구사항

| 분류 | 기준 | 측정 방법 |
|------|------|---------|
| 성능 | 전문과 탭 초기 로드 < 500ms | TanStack Query 캐싱 활용 |
| 타입 안전성 | TypeScript strict 모드 준수 | tsc --noEmit |
| 코드 재사용 | 기존 specialty/ 컴포넌트 100% 재사용 | 신규 SVG 컴포넌트 0개 |
| UX | 탭 수 과부하 방지 — 비전문과 탭 미노출 | 조건부 렌더링 |

---

## 6. 구현 계획 (Phase 분리)

### Phase 1 — 환자 차트 탭 통합 (Must)

**목표**: 환자 차트에서 전문과 기록을 직접 열람·입력할 수 있도록 한다.

**작업 목록**

1. `apps/web/src/app/(main)/patients/[id]/components/` 하위에 전문과 탭 컴포넌트 4개 생성
   - `DentalTab.tsx` — DentalPage에서 탭 콘텐츠 부분만 추출
   - `OphthalmologyTab.tsx` — OphthalmologyPage에서 탭 콘텐츠 부분만 추출
   - `DermatologyTab.tsx` — DermatologyPage에서 탭 콘텐츠 부분만 추출
   - `EntTab.tsx` — EntPage에서 탭 콘텐츠 부분만 추출

2. 각 탭 컴포넌트 인터페이스 통일
   ```typescript
   // props: patientId를 직접 받아 사용 (수동 입력 필드 제거)
   interface SpecialtyTabProps {
     patientId: string;
   }
   ```

3. `patients/[id]/page.tsx`에서 탭 조건부 추가
   ```typescript
   // useUser() 또는 useAuthStore()로 현재 사용자 department 조회
   const specialtyTabs = [
     { key: 'dental', label: '치과', dept: '치과' },
     { key: 'ophthalmology', label: '안과', dept: '안과' },
     { key: 'dermatology', label: '피부과', dept: '피부과' },
     { key: 'ent', label: '이비인후과', dept: '이비인후과' },
   ].filter(t => user.role === 'ADMIN' || user.department === t.dept);
   ```

4. TABS 배열에 필터링된 전문과 탭 병합

5. 탭 콘텐츠 렌더링 블록에 전문과 탭 분기 추가

**완료 기준**
- 치과 의사 로그인 시 환자 차트에 "치과" 탭 표시
- 해당 탭에서 patientId 수동 입력 없이 치아차트/치료계획/기록/기공의뢰 조회 가능
- 내과 의사 로그인 시 전문과 탭 미표시

### Phase 2 — 전문과 페이지 대시보드 전환 (Should)

**목표**: 기존 전문과 페이지를 전과적 운영 현황 파악 화면으로 전환한다.

**작업 목록**

1. 각 전문과 페이지 상단에 대시보드 섹션 추가
   - 금일 예약 환자 목록 (스케줄 모듈 `GET /api/v1/schedule?date=today&dept=dental`)
   - 통계 카드: 이번 주 케이스 수, 진행 중인 기공의뢰/수술 수 등

2. 환자 행에 "차트 열기" 링크 추가
   ```tsx
   <Link href={`/patients/${patient.id}?tab=dental`}>
     차트 열기
   </Link>
   ```

3. 기존 "환자 ID 수동 입력" 섹션은 대시보드 하단에 "개별 환자 조회" 섹션으로 축소 유지 (접기/펼치기)

**완료 기준**
- `/dental` 접속 시 금일 치과 예약 환자 목록 표시
- "차트 열기" 클릭 시 해당 환자 차트의 치과 탭으로 이동

### Phase 3 — URL 쿼리 파라미터 탭 동기화 (Could)

**목표**: `?tab=dental` URL 파라미터를 통해 특정 탭을 직접 활성화할 수 있도록 한다.

**작업 목록**

1. `patients/[id]/page.tsx`에서 `useSearchParams()`로 초기 탭 결정
   ```typescript
   const searchParams = useSearchParams();
   const initialTab = searchParams.get('tab') as TabKey ?? 'overview';
   const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
   ```

2. 탭 변경 시 URL 쿼리 파라미터 업데이트 (`router.replace` 사용)

**완료 기준**
- `/patients/abc-123?tab=dental` 직접 접근 시 치과 탭 활성화
- 브라우저 뒤로가기 시 이전 탭 복원

---

## 7. 성공 기준

### 7.1 완료 정의

- [ ] 전문과 4개 탭 컴포넌트 생성 완료
- [ ] 환자 차트에서 조건부 탭 렌더링 동작 확인
- [ ] 각 탭에서 patientId 수동 입력 없이 데이터 조회 성공
- [ ] ADMIN 사용자 모든 탭 접근 가능 확인
- [ ] 비전문과 의사 로그인 시 전문과 탭 미표시 확인

### 7.2 품질 기준

- [x] TypeScript 타입 오류 없음 (`tsc --noEmit` 통과)
- [ ] 기존 전문과 페이지 기능 회귀 없음
- [x] 빌드 성공 (`npm run build`)

---

## 8. 리스크 및 고려사항

| 리스크 | 영향도 | 가능성 | 대응 |
|--------|--------|--------|------|
| **TabKey 타입 확장** — TABS `as const` union과 동적 탭 병합 시 TS 에러 | **High** | **High** | `string` union 확장 또는 별도 specialtyTabs 배열 + 합성 타입 |
| 탭 과부하 — 전문과 탭 추가 후 탭 바 레이아웃 깨짐 | Medium | Medium | 탭 영역 스크롤 또는 드롭다운 그룹화 검토 |
| **탭 컴포넌트 규모** — 각 300-400줄, 내부 서브탭+state+mutation 포함 | **Medium** | **High** | 서브탭 state를 컴포넌트 내부에서 독립 관리, props는 patientId만 |
| department 필드 미설정 사용자 — 탭이 아무것도 표시되지 않음 | High | Low | department가 null인 경우 기본 탭 구성(전문과 탭 없음)으로 폴백; 설정 안내 |
| 전문과 페이지 대시보드 — 기존 today/stats API 활용 | Low | Low | 각 전문과에 `GET today`, `GET stats` API 이미 존재 → 스케줄 API 불필요 |
| 기존 전문과 페이지를 직접 링크한 외부 참조 | Low | Low | 기존 URL 유지 (삭제하지 않음), 대시보드 역할 추가만 |

> **확인 완료**: department 값은 한글 ('치과', '안과', '피부과', '이비인후과') — seed 데이터 검증됨.
> **확인 완료**: 전문과별 `GET today`, `GET stats` API가 이미 구현되어 있어 Phase 2 난이도가 예상보다 낮음.

---

## 9. 아키텍처 고려사항

### 9.1 프로젝트 레벨

Enterprise Clean Architecture 적용 (CLAUDE.md 기준)

### 9.2 핵심 아키텍처 결정

| 항목 | 선택 | 이유 |
|------|------|------|
| 컴포넌트 위치 | `patients/[id]/components/` 하위 | 기존 탭 컴포넌트와 동일 패턴 |
| patientId 전달 | props 직접 전달 | Context 오용 방지, 명시적 데이터 흐름 |
| API 쿼리 | TanStack Query (기존 패턴) | 캐싱 + 로딩 상태 재사용 |
| 사용자 정보 | `useAuthStore` 또는 `useUser` hook | 기존 인증 흐름 준수 |
| 탭 동적 구성 | 런타임 필터링 (빌드 타임 아님) | department 변경 즉시 반영 |

### 9.3 폴더 구조 변경 (예상)

```
apps/web/src/app/(main)/patients/[id]/
├── page.tsx                     # 탭 배열에 전문과 탭 추가
└── components/
    ├── (기존 탭 컴포넌트들)
    ├── DentalTab.tsx            # 신규 — dental/page.tsx 탭 콘텐츠 추출
    ├── OphthalmologyTab.tsx     # 신규
    ├── DermatologyTab.tsx       # 신규
    └── EntTab.tsx               # 신규

apps/web/src/app/(main)/
├── dental/page.tsx              # 변경 — 대시보드 레이아웃으로 전환
├── ophthalmology/page.tsx       # 변경
├── dermatology/page.tsx         # 변경
└── ent/page.tsx                 # 변경
```

### 9.4 컨벤션 준수 항목

- 컴포넌트: PascalCase
- 파일: kebab-case (기존 패턴 유지)
- API 호출: `apiClient.get('/api/v1/...')` 형식
- 응답 구조: `{ data: ... }` 추출 패턴 (기존 전문과 페이지와 동일)

---

## 10. 다음 단계

1. [ ] Design 문서 작성 — `specialty-chart-integration.design.md`
2. [ ] 팀 검토 및 승인
3. [ ] Phase 1 구현 시작 (환자 차트 탭 통합)

---

## 버전 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|---------|--------|
| 0.1 | 2026-05-19 | 초안 작성 | Product Manager |
