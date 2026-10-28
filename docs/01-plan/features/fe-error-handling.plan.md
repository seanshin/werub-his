# FE 에러 처리 체계 구축 Plan

> 작성일: 2026-05-30
> 기능명: fe-error-handling
> 우선순위: P0 (운영 안정성)

---

## 1. 현황 분석

### 수치 요약

| 항목 | 현재 | 목표 |
|------|:----:|:----:|
| useQuery/useMutation 사용 페이지 | 159개 | 159개 |
| isError 처리 있는 페이지 | ~6개 (4%) | 159개 (100%) |
| 로딩 상태 처리 있는 페이지 | ~30개 (19%) | 159개 (100%) |
| route-level error.tsx | 2개 (root, main) | 2개 (충분) |
| ErrorBoundary 컴포넌트 | 0개 | 1개 (QueryErrorBoundary) |
| Skeleton 사용 페이지 | ~10개 | 유지 |

### 문제점

1. **API 실패 시 빈 화면** — 159개 페이지 중 153개가 에러 상태 무시
2. **로딩 UX 불일치** — 페이지마다 로딩 표현이 다르거나 없음
3. **mutation 실패 무음** — toast/알림 없이 실패가 묻힘
4. **네트워크 단절 감지 없음** — 오프라인 시 아무 안내 없음

---

## 2. 구현 전략

### 접근: 중앙 집중 + 점진 적용

개별 159개 페이지를 하나씩 수정하는 것은 비효율. **공통 컴포넌트/훅으로 중앙 처리**하고, 기존 페이지는 최소 변경.

### Phase 1: 공통 인프라 (핵심)

| 항목 | 설명 |
|------|------|
| **QueryErrorFallback** | useQuery 에러 시 표시할 공통 UI (아이콘 + 메시지 + 재시도 버튼) |
| **MutationToast** | useMutation onError 글로벌 핸들러 → toast 알림 |
| **QueryClient 글로벌 onError** | 모든 쿼리 에러를 자동 캐치 |
| **LoadingFallback** | 공통 로딩 UI (스피너 or 스켈레톤) |

### Phase 2: 글로벌 적용

| 항목 | 설명 |
|------|------|
| **QueryClient defaultOptions** | retry, onError, throwOnError 설정 |
| **Toast Provider** | 앱 루트에 toast 컨테이너 추가 |
| **네트워크 상태 감지** | navigator.onLine + 배너 표시 |

### Phase 3: 주요 페이지 개별 보강

| 대상 | 수량 | 작업 |
|------|:----:|------|
| workstation 계열 | 22개 | 커스텀 에러 메시지 |
| patients/[id] 탭 | 35탭 | 탭별 독립 에러 처리 |
| 검진센터 | 14개 | 검진 특화 에러 |

---

## 3. 구현 상세

### 3.1 QueryClient 글로벌 설정

```typescript
// lib/query-client.ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      // 글로벌 에러 → 공통 UI가 처리
    },
    mutations: {
      onError: (error) => {
        // 글로벌 toast
        toast.error(extractErrorMessage(error));
      },
    },
  },
});
```

### 3.2 QueryErrorFallback 컴포넌트

```typescript
// components/QueryErrorFallback.tsx
function QueryErrorFallback({ error, onRetry, size = 'md' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
      <p className="text-sm text-gray-600 mb-4">
        {extractErrorMessage(error) || '데이터를 불러올 수 없습니다'}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm text-blue-600 hover:underline">
          다시 시도
        </button>
      )}
    </div>
  );
}
```

### 3.3 useApiQuery 래퍼 훅

```typescript
// hooks/use-api-query.ts — 기존 useQuery를 감싸서 에러/로딩 처리 표준화
function useApiQuery<T>(key, fn, options?) {
  const query = useQuery({ queryKey: key, queryFn: fn, ...options });
  return {
    ...query,
    ErrorFallback: query.isError
      ? () => <QueryErrorFallback error={query.error} onRetry={query.refetch} />
      : null,
    LoadingFallback: query.isLoading
      ? () => <LoadingFallback />
      : null,
  };
}
```

### 3.4 Toast 시스템

```
sonner (경량 toast 라이브러리, ~3KB) 사용
→ mutation 에러 자동 toast
→ 성공 시 toast (선택적)
```

### 3.5 네트워크 감지

```typescript
// components/NetworkStatusBanner.tsx
// navigator.onLine 변화 감지 → 화면 상단 배너
// "네트워크 연결이 끊어졌습니다" / "다시 연결되었습니다"
```

---

## 4. 변경 범위

### 신규 파일 (~6개)

| 파일 | 용도 |
|------|------|
| `components/QueryErrorFallback.tsx` | 쿼리 에러 공통 UI |
| `components/LoadingFallback.tsx` | 로딩 공통 UI |
| `components/NetworkStatusBanner.tsx` | 네트워크 상태 배너 |
| `hooks/use-api-query.ts` | useQuery 래퍼 |
| `lib/error-utils.ts` | 에러 메시지 추출 유틸 |
| `components/ToastProvider.tsx` | Toast 컨테이너 (sonner) |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `lib/query-client.ts` | defaultOptions에 mutation onError 추가 |
| `app/layout.tsx` 또는 `providers.tsx` | Toast + NetworkBanner 추가 |
| 주요 페이지 ~30개 | isError 분기 추가 (Phase 3) |

---

## 5. 의존성

| 패키지 | 용도 | 크기 |
|--------|------|------|
| `sonner` | Toast 알림 | ~3KB gzip |

기존 의존성 (TanStack Query, Tailwind, Lucide) 활용. 추가 의존성 최소화.

---

## 6. 제외 사항

| 항목 | 사유 |
|------|------|
| Sentry/에러 추적 서비스 | 운영 규모 확정 후 도입 |
| 페이지별 커스텀 스켈레톤 | ROI 낮음, 공통 스피너로 충분 |
| FE 테스트 | 별도 PDCA로 분리 |
| retry UI (재시도 횟수 표시) | 과잉 설계 |

---

## 7. 실행 순서

```
Phase 1 (인프라)     → Phase 2 (글로벌 적용)  → Phase 3 (개별 보강)
error-utils.ts          QueryClient 수정          workstation 22개
QueryErrorFallback      Toast Provider            patients/[id] 35탭
LoadingFallback         NetworkBanner             검진센터 14개
sonner 설치             layout.tsx 수정
```

**예상 변경량**: 신규 ~6파일, 수정 ~35파일
