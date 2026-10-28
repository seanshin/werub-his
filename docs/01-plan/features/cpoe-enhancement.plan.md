# CPOE 전면 개선 + CDSS 고도화 통합 기획서 v2.0

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/(main)/orders/page.tsx · apps/web/src/app/(main)/admin/cdss-rules/page.tsx · apps/web/src/app/(main)/patients/[id]/encounter/new/components/ApplyOrderSetModal.tsx · 잔여: 없음

> 기존 `cpoe-cdss.plan.md` 내용 통합 + CPOE 페이지 UI/UX 전면 개선

---

## 1. 현재 구현 상태 감사

### 1.1 CPOE 페이지 (`/orders`)

| 기능 | 상태 | 비고 |
|------|------|------|
| 내 처방 / 부서별 대기열 탭 | ✅ 완료 | mode 토글 |
| 상태별 카운트 카드 (5종) | ✅ 완료 | 전체/대기/접수/진행/완료 |
| 부서 탭 (약국/검사/영상) | ✅ 완료 | PHARMACY/LAB/IMAGING |
| 오더 상태 변경 (접수/시작/완료) | ✅ 완료 | VALID_TRANSITIONS 적용 |
| 새 처방 모달 (QuickOrderModal) | ✅ 완료 | 환자선택→처방→서명 3단계 |
| CDSS 검증 UI (모달 내) | ✅ 완료 | 7개 영역, 레벨별 색상 |
| PACS Worklist 자동 등록 | ✅ 완료 | 영상 오더 시 pushToWorklist |

### 1.2 CDSS/DUR 백엔드

| 기능 | 상태 | 비고 |
|------|------|------|
| `POST /cdss/check` (7개 영역 통합 검증) | ✅ 완료 | DurService 래핑 + 6개 추가 |
| 약물 상호작용 (DUR 46규칙) | ✅ 완료 | dur.service.ts |
| 알레르기 교차반응 | ✅ 완료 | 성분 기반 매칭 |
| 신기능 기반 용량 (eGFR) | ✅ 완료 | Creatinine → eGFR 계산 |
| 연령 금기 (5규칙) | ✅ 완료 | 소아/고령 |
| 중복 처방 | ✅ 완료 | 활성 처방 대조 |
| 진단-처방 적합성 | ✅ 완료 | OrderSet 매칭 |
| 가이드라인 권고 | ✅ 완료 | CP 세트 추천 |
| `GET /cdss/suggest-orderset` | ✅ 완료 | 진단코드 기반 |
| CDSS 규칙 CRUD | ✅ 완료 | CdssRule 테이블 + 4 API |
| 규칙 적용 통계 | ✅ 완료 | hitCount, topHits |

### 1.3 약속처방 (Order Set) 백엔드

| 기능 | 상태 | 비고 |
|------|------|------|
| CP CRUD + 검색 + 복제 | ✅ 완료 | 12개 API |
| CP 상태 관리 (DRAFT→APPROVED→ACTIVE) | ✅ 완료 | 상태 전이 규칙 |
| 즐겨찾기 (FavoriteOrder) CRUD | ✅ 완료 | 4개 API |
| CP 추천 (진단코드 기반) | ✅ 완료 | `GET /order-sets/recommend` |
| 사용 기록 + 통계 | ✅ 완료 | OrderSetUsage + useCount |

---

## 2. 핵심 문제점

### 2.1 CPOE 페이지 UI 문제 (🔴 긴급)

| # | 문제 | 심각도 | 설명 |
|---|------|--------|------|
| 1 | **약물명 미표시 버그** | 🔴 치명 | `OrderRow` L588 연산자 우선순위 오류 → 모든 오더가 "약물 처방"으로만 표시 |
| 2 | **정보 밀도 부족** | 🟡 중요 | 카드 나열 방식 → 환자/약물/용량/상태가 1줄, 한눈에 파악 불가 |
| 3 | **처방 유형 필터 없음** | 🟡 중요 | 내 처방에서 약물/검사/영상 구분 불가 |
| 4 | **날짜 필터 없음** | 🟡 중요 | 전체 기간만 조회 → 데이터 과다 |
| 5 | **STAT 미구분** | 🟡 중요 | 긴급 처방이 시각적으로 구분되지 않음 |
| 6 | **처방 상세 없음** | 🟠 보통 | 클릭 시 용량/빈도/일수 등 상세 없음 |
| 7 | **정렬 불가** | 🟠 보통 | 컬럼별 정렬 미지원 |
| 8 | **DUR 배지 미표시** | 🟠 보통 | 경고 있는 처방에 배지 없음 |

### 2.2 CDSS 미완성 항목 (기존 기획서)

| # | 항목 | 설명 |
|---|------|------|
| 9 | **DUR 경고 무시 사유 기록** | ERROR 레벨에서 durOverridden=true 시 사유 미기록 |
| 10 | **처방 목록 DUR 배지** | 기존 처방에 ⚠️DUR 배지 미표시 |
| 11 | **CDSS 규칙 관리 페이지** | `/admin/cdss-rules` 관리 UI 없음 (API만 존재) |

### 2.3 약속처방 연동 부족

| # | 항목 | 설명 |
|---|------|------|
| 12 | **모달 내 약속처방 탭** | 새 처방 모달에서 CP 세트 조회/적용 불가 |
| 13 | **CDSS 추천 CP 원클릭 적용** | CDSS에서 추천한 CP 세트를 바로 적용 불가 |

---

## 3. 개선 계획 (7 Phase)

### Phase 1: 버그 수정 + 테이블 전환

#### 1-1. OrderRow 약물명 버그 수정
```typescript
// Before (버그 — 연산자 우선순위)
const name = rx?.medicationCode?.nameKo || rx?.procedureCode?.nameKo || rx?.type === 'MEDICATION' ? '약물 처방' : rx?.type === 'LAB' ? '검사 처방' : '처방';

// After (수정)
const name = rx?.medicationCode?.nameKo || rx?.procedureCode?.nameKo || (rx?.type === 'MEDICATION' ? '약물 처방' : rx?.type === 'LAB' ? '검사 처방' : '처방');
```

#### 1-2. 내 처방 — 테이블 레이아웃 전환

카드 나열 → 정보 밀도 높은 테이블로 전환:

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│  상태    │  유형   │  환자             │  처방 내용   │ 용량·빈도   │ 긴급도 │ 시간    │ 액션 │
├──────────┼────────┼──────────────────┼─────────────┼────────────┼───────┼─────────┼──────┤
│ 🟡 대기  │ 💊 약물│ 김미래 P2026-0008│ 아모디핀정  │ 5mg 1일1회 │  일반  │ 30분 전 │[접수]│
│ 🔴 대기  │ 🧪 검사│ 강태윤52 HR-0328 │ CBC+ESR     │     -      │ STAT  │ 1시간전 │[접수]│
│ 🔵 접수  │ 📷 영상│ 김서준34 HR-0055 │ 흉부 X-ray  │     -      │  일반  │ 2시간전 │[시작]│
│ ✅ 완료  │ 💊 약물│ 고재민 HR-0031   │ 타이레놀정  │500mg 1일3회│  일반  │ 13일전  │  -   │
└──────────┴────────┴──────────────────┴─────────────┴────────────┴───────┴─────────┴──────┘
```

**컬럼 설계**:
| 컬럼 | 폭 | 내용 | API 필드 |
|------|-----|------|---------|
| 상태 | 80px | 컬러 배지 (대기/접수/진행중/완료/취소) | `order.status` |
| 유형 | 70px | 💊/🧪/📷 + 라벨 | `prescription.type` |
| 환자 | 180px | 이름 + MRN | `prescription.encounter.patient` |
| 처방 내용 | flex | 약품명 또는 검사/시술명 | `medicationCode.nameKo` / `procedureCode.nameKo` |
| 용량·빈도 | 120px | "5mg 1일3회" (약물만) | `prescription.dosage` + `frequency` |
| 긴급도 | 70px | 일반/STAT(빨강)/PRN | `order.priority` |
| 시간 | 90px | 상대시간 | `order.createdAt` |
| 액션 | 80px | 접수/시작/완료 버튼 | 상태 전이 |

#### 1-3. STAT 행 강조
- STAT 행: `border-l-3 border-red-500 bg-red-50/30`
- STAT 배지: `bg-red-600 text-white px-2 rounded font-bold`
- 기본 정렬: STAT 먼저 → 시간순

#### 1-4. 부서별 대기열 — 동일 테이블 적용
- 동일한 테이블 컴포넌트 재사용
- 약국: 약품명+용량+빈도 강조
- 검사실: 검체+검사항목 강조
- 영상실: 검사부위+모달리티 강조

---

### Phase 2: 필터 + 정렬

#### 2-1. 처방 유형 필터 (내 처방 탭)
상태 카드 아래에 유형 필터 추가:
```
[전체] [💊 약물 (12)] [🧪 검사 (5)] [📷 영상 (3)]
```

#### 2-2. 날짜 필터
```
[오늘] [이번주] [이번달] [전체]
```
- 기본값: **오늘** (현재는 전체 → 수십 건 로드)
- API: `from`, `to` ISO date 파라미터

#### 2-3. 컬럼 정렬
- 컬럼 헤더 클릭 → 오름/내림 토글 (▲▼ 아이콘)
- 기본: 긴급도(STAT 먼저) → 시간(최신순)
- 프론트 정렬 (클라이언트 사이드, 현재 로드된 데이터 내)

---

### Phase 3: 처방 상세 펼침

#### 3-1. 아코디언 상세 패널
행 클릭 → 아래에 상세 정보 펼침:

```
┌──────────────────────────────────────────────────────────────────┐
│  📋 처방 상세                                                    │
│                                                                  │
│  약품: 아모디핀정 5mg (A0001)            DUR: ⚠️ 주의 1건        │
│  용량: 5mg │ 경구 │ 1일 1회 │ 7일 │ 총 7정                      │
│  긴급도: 일반 │ 처방의: 김내과 │ 2026-05-08 14:30               │
│                                                                  │
│  ┌─ CDSS 검증 ────────────────────────────────────────────────┐  │
│  │ ✅ 알레르기 │ ✅ 신기능 │ ⚠️ 상호작용 │ ✅ 연령 │ ✅ 중복 │  │
│  │ ⚠️ 아모디핀 + 심바스타틴 → 횡문근융해증 위험               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [환자 차트] [처방 복사] [오더 취소]                              │
└──────────────────────────────────────────────────────────────────┘
```

#### 3-2. 상세 정보 항목
- 약품/검사 전체명 + 코드
- 용량 / 투여경로 / 빈도 / 일수 / 총 수량 (약물)
- 처방의 / 처방 일시
- DUR/CDSS 검증 결과 (durWarnings, durChecked)
- 오더 타임라인: 처방 → 접수 → 시작 → 완료 시각
- 액션 버튼: 환자 차트 링크, 처방 복사, 오더 취소

#### 3-3. API include 보강 (Phase 5와 연동)
`prescription` include에 추가 필드:
```typescript
prescription: {
  select: {
    type: true,
    dosage: true, frequency: true, duration: true,
    quantity: true, route: true, priority: true,
    durChecked: true, durWarnings: true, durOverridden: true,
    medicationCode: { select: { code: true, nameKo: true, dosageForm: true } },
    procedureCode: { select: { code: true, nameKo: true } },
    encounter: {
      select: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true, department: true } },
      },
    },
  },
},
```

---

### Phase 4: DUR 배지 + 경고 무시 사유

#### 4-1. 처방 목록 DUR 배지
`durWarnings`가 있는 오더에 배지 표시:
```
💊 아모디핀정 5mg  ⚠️DUR  1일1회  7일
```
- `durChecked && durWarnings.length > 0` → 주황 `⚠️DUR` 배지
- `durOverridden` → 빨강 `🚫DUR무시` 배지

#### 4-2. DUR 경고 무시 사유 입력
처방 모달에서 CDSS ERROR 시:
```
┌─ DUR 경고 무시 ─────────────────────────────────┐
│ 🚫 약물 상호작용 위험                            │
│                                                  │
│ 무시 사유: [                                   ] │
│ ☐ 임상적으로 불가피 (대체약 없음)                 │
│ ☐ 이미 모니터링 중                               │
│ ☐ 기타 (직접 입력)                               │
│                                                  │
│ [취소]  [경고 무시하고 처방]                      │
└──────────────────────────────────────────────────┘
```

API: 처방 시 `durOverrideReason` 필드 추가
```typescript
// prescription 생성 시
durOverridden: true,
durOverrideReason: '임상적으로 불가피 — 대체약 없음',
```

---

### Phase 5: 약속처방(CP) 모달 연동

#### 5-1. 처방 모달에 약속처방 탭 추가

Step 2(처방 입력)에 4번째 탭:
```
[💊 약] [🧪 검사] [📷 영상] [📋 약속처방]
```

#### 5-2. 약속처방 탭 내용
```
┌─────────────────────────────────────────────────────────┐
│  🔍 세트 검색...                                        │
├─────────────────────────────────────────────────────────┤
│  ⭐ 내 즐겨찾기                                         │
│  ├ 감기 기본 (3건)                    [미리보기] [적용]   │
│  └ 고혈압 기본 (2건)                  [미리보기] [적용]   │
│                                                         │
│  🏥 과 공통 세트 (내과)                                  │
│  ├ [CP-IM-001] 고혈압 초진 (7건)      [미리보기] [적용]   │
│  ├ [CP-IM-002] 당뇨 초진 (4건)        [미리보기] [적용]   │
│  └ [CP-AD-001] 내과 입원 기본 (5건)   [미리보기] [적용]   │
│                                                         │
│  💡 CDSS 추천                                            │
│  └ I10 고혈압 → CP-IM-001 추천 (적합도 95%)  [적용]      │
└─────────────────────────────────────────────────────────┘
```

#### 5-3. [적용] 동작
1. 세트 상세 로드 (`GET /order-sets/:id`)
2. items 배열 순회 → 각각 처방 API 호출
3. 각 약물마다 CDSS 검증 자동 실행
4. 결과를 prescriptions 리스트에 일괄 추가
5. OrderSet 사용 기록 (`POST /order-sets/:id/use`)

#### 5-4. [미리보기] 팝업
세트 내 약물/검사 목록을 표로 표시:
```
┌─ CP-IM-001 고혈압 초진 기본 처방 ────────┐
│ 💊 아모디핀 5mg  경구 1일1회 30일        │
│ 💊 발사르탄 80mg 경구 1일1회 30일        │
│ 🧪 CBC                                  │
│ 🧪 BMP (전해질)                          │
│ 🧪 Lipid Panel                           │
│ 🧪 HbA1c                                │
│ 📷 흉부 X-ray                            │
│                              [닫기] [적용]│
└──────────────────────────────────────────┘
```

#### 5-5. API 활용 (이미 구현됨)
- `GET /favorite-orders` — 내 즐겨찾기
- `GET /order-sets?department=내과` — 과별 CP 목록
- `GET /order-sets/recommend?diagnosisCodes=I10,E11` — CDSS CP 추천
- `GET /order-sets/:id` — CP 상세 (items 포함)
- `POST /order-sets/:id/use` — 사용 기록

---

### Phase 6: API 보강

#### 6-1. Order 목록 필터 확장

```typescript
// order.controller.ts — @Query 추가
@Query('from') from?: string,       // ISO date (2026-05-21)
@Query('to') to?: string,           // ISO date
@Query('type') type?: string,       // MEDICATION | LAB | IMAGING
@Query('priority') priority?: string, // STAT | ROUTINE | PRN
```

```typescript
// order.service.ts — findAll where 확장
if (filters.from) {
  where.createdAt = { ...(where.createdAt as object), gte: new Date(filters.from) };
}
if (filters.to) {
  where.createdAt = { ...(where.createdAt as object), lte: new Date(filters.to + 'T23:59:59Z') };
}
if (filters.type) {
  where.prescription = { ...(where.prescription as object), type: filters.type as PrescriptionType };
}
if (filters.priority) {
  where.priority = filters.priority;
}
```

#### 6-2. Prescription include 보강

현재 부족한 필드 추가:
```diff
  prescription: {
    include: {
+     // 처방 상세 필드
+     dosage: true, frequency: true, duration: true,
+     quantity: true, route: true, priority: true,
+     durChecked: true, durWarnings: true, durOverridden: true,
      medicationCode: { select: { code: true, nameKo: true, dosageForm: true } },
      procedureCode: { select: { code: true, nameKo: true } },
      encounter: { ... },
    },
  },
```

#### 6-3. useOrders.ts 훅 확장
```typescript
export function useMyOrders(doctorId?: string, status?: string, type?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ['my-orders', doctorId, status, type, from, to],
    queryFn: () => apiClient.get('/api/v1/orders', { doctorId, status, type, from, to, limit: 100 }),
    enabled: !!doctorId,
    refetchInterval: 15000,
  });
}
```

---

### Phase 7: CDSS 규칙 관리 페이지 (관리자)

#### 7-1. 페이지: `/admin/cdss-rules`

```
┌──────────────────────────────────────────────────────────────┐
│  CDSS 규칙 관리                               [+ 규칙 추가]  │
├────────────────────────────────────────────────────────────── │
│  [전체 (54)] [상호작용 (46)] [알레르기 (3)] [연령 (5)]        │
│                                                              │
│  ┌─────┬──────┬───────────────────┬──────────┬──────┬──────┐ │
│  │레벨 │카테고리│ 규칙명            │ 적용횟수  │상태  │ 관리│ │
│  ├─────┼──────┼───────────────────┼──────────┼──────┼──────┤ │
│  │ 🚫  │상호작용│아모디핀+심바스타틴│   23회   │활성  │[편집]│ │
│  │ ⚠️  │용량   │메트포르민 eGFR<30 │   12회   │활성  │[편집]│ │
│  │ 🚫  │연령   │아스피린 18세이하  │    5회   │활성  │[편집]│ │
│  └─────┴──────┴───────────────────┴──────────┴──────┴──────┘ │
│                                                              │
│  📊 통계: 54규칙 | 이번달 적용 340회 | 무시율 12%             │
└──────────────────────────────────────────────────────────────┘
```

#### 7-2. API (이미 구현)
- `GET /cdss/rules` — 목록
- `POST /cdss/rules` — 추가
- `PUT /cdss/rules/:id` — 수정
- `DELETE /cdss/rules/:id` — 삭제 (soft)
- `GET /cdss/rules/stats` — 통계

---

## 4. 구현 순서

```
Phase 1 ─── 버그 수정 + 테이블 전환 + STAT 강조
  │          (핵심: 약물명 표시, 레이아웃, 긴급도)
  │
Phase 2 ─── 필터(유형/날짜) + 정렬
  │          (사용성: 데이터 탐색 효율)
  │
Phase 3 ─── 처방 상세 아코디언 펼침
  │          (정보: 용량/빈도/CDSS 결과 확인)
  │
Phase 4 ─── DUR 배지 + 경고 무시 사유 기록
  │          (안전: 처방 안전성 가시화)
  │
Phase 5 ─── 약속처방(CP) 모달 연동
  │          (효율: 세트 처방 원클릭 적용)
  │
Phase 6 ─── API 보강 (날짜/유형/priority 필터)
  │          (인프라: 백엔드 지원)
  │
Phase 7 ─── CDSS 규칙 관리 페이지 (관리자)
             (관리: 규칙 추가/수정/통계)
```

> Phase 1-3은 프론트 중심, Phase 4-5는 프론트+백엔드, Phase 6은 백엔드, Phase 7은 새 페이지

---

## 5. 수정 대상 파일

| 파일 | Phase | 변경 내용 |
|------|-------|----------|
| `apps/web/src/app/(main)/orders/page.tsx` | 1-5 | 테이블, 필터, 상세, DUR배지, CP탭 |
| `apps/web/src/hooks/useOrders.ts` | 2,6 | 날짜/유형/priority 파라미터 |
| `apps/api/src/modules/order/order.controller.ts` | 6 | from/to/type/priority @Query |
| `apps/api/src/modules/order/order.service.ts` | 3,6 | findAll 확장 + include 보강 |
| `apps/web/src/app/(main)/admin/cdss-rules/page.tsx` | 7 | 신규 페이지 |

## 6. 기존 기획서 통합 상태

| 기존 `cpoe-cdss.plan.md` 항목 | 구현 상태 | 이 기획서 Phase |
|------|------|------|
| CDSS 7개 영역 통합 검증 API | ✅ 완료 | - |
| 처방 모달 CDSS 결과 패널 | ✅ 완료 | - |
| 경고 레벨별 UI (PASS/INFO/WARNING/ERROR) | ✅ 완료 | - |
| 진단 기반 CP 추천 API | ✅ 완료 | - |
| CDSS 규칙 CRUD API | ✅ 완료 | - |
| 처방 목록 DUR 배지 | ❌ 미완 | **Phase 4** |
| DUR 경고 무시 사유 기록 | ❌ 미완 | **Phase 4** |
| CDSS 규칙 관리 UI 페이지 | ❌ 미완 | **Phase 7** |
| CP 세트 모달 내 연동 | ❌ 미완 | **Phase 5** |
