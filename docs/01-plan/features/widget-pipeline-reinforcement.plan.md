# 위젯 권한/데이터 파이프라인 보강 실행 계획

> 작성일: 2026-05-30
> 근거: WIDGET-PERMISSION-PIPELINE-REPORT.md의 발견 사항 3건 (roles 불일치 12건, 403 핸들링 없음, BE 보안 취약점 6건)

---

## 현재 상태

```
사용자 로그인
  ↓
auth/me → { role: "DOCTOR" }    ← 역할만 반환, 권한 목록 없음
  ↓
팔레트 표시 → widget.roles.includes(role)  ← 수동 입력값, API 가드와 불일치 가능
  ↓
위젯 렌더링 → useQuery(API 호출)
  ↓
API 403 발생 → ❌ 에러 화면 (graceful 처리 없음)
```

## 목표 상태

```
사용자 로그인
  ↓
auth/me → { role, permissions: ["dashboard:view", "billing:view", ...] }
  ↓
팔레트 표시 → canShowWidget(widget, role, permissions)    ← 이중 검증
  ↓                                                       (roles + permissions)
위젯 렌더링 → useWidgetQuery(API 호출)
  ↓
API 403 → "권한이 없습니다" 안내 + 위젯 숨김 제안    ← graceful degradation
```

---

## 실행 단계 (4단계)

### Step 1: BE — auth/me 응답에 permissions 추가 (30분)

현재 `/api/v1/auth/me`는 `{ id, email, familyName, givenName, role, department, specialty }`만 반환합니다. 권한 목록을 추가합니다.

**파일**: `apps/api/src/modules/auth/auth.controller.ts`

```typescript
// 기존
@Get('me')
async getMe(@CurrentUser() user: any) {
  return { data: { id: user.id, email: user.email, ... } };
}

// 변경
@Get('me')
async getMe(@CurrentUser() user: any) {
  const permissions = ROLE_PERMISSIONS[user.role] ?? [];
  return {
    data: {
      id: user.id,
      email: user.email,
      familyName: user.familyName,
      givenName: user.givenName,
      role: user.role,
      department: user.department,
      specialty: user.specialty,
      permissions,  // ← NEW: ["dashboard:view", "patient:view", ...]
    },
  };
}
```

**파일**: `apps/api/src/modules/auth/rbac/permission.types.ts` — ROLE_PERMISSIONS는 이미 정의되어 있으므로 import만 하면 됨.

---

### Step 2: FE — auth-store에 permissions 저장 + 권한 유틸 (30분)

**파일**: `apps/web/src/stores/auth-store.ts`

```typescript
interface UserProfile {
  id: string;
  email: string;
  familyName: string;
  givenName: string;
  role: string;
  department?: string;
  specialty?: string;
  permissions: string[];  // ← NEW
}
```

**파일**: `apps/web/src/lib/permissions.ts` (NEW)

```typescript
import { useAuthStore } from '@/stores/auth-store';

/** 현재 사용자가 특정 권한을 가지고 있는지 확인 */
export function useHasPermission(permission: string): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return permissions.includes(permission);
}

/** 현재 사용자가 모든 권한을 가지고 있는지 확인 */
export function useHasAllPermissions(required: string[]): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return required.every((p) => permissions.includes(p));
}

/** 역할 + 권한 동시 체크 (위젯 팔레트용) */
export function canAccessWidget(
  widgetRoles: string[],
  widgetPermissions: string[],
  userRole: string,
  userPermissions: string[],
): boolean {
  // roles 체크 (빈 배열 = ALL)
  if (widgetRoles.length > 0 && !widgetRoles.includes(userRole)) return false;
  // permissions 체크 (빈 배열 = 없음)
  if (widgetPermissions.length > 0) {
    if (!widgetPermissions.every((p) => userPermissions.includes(p))) return false;
  }
  return true;
}
```

---

### Step 3: widget-registry 보강 + 팔레트 필터링 (1시간)

**파일**: `apps/web/src/app/(main)/dashboard/components/widget-registry.ts`

```typescript
export interface WidgetDef {
  id: string;
  name: string;
  category: WidgetCategory;
  roles: string[];                // 팔레트 표시 역할 (빈 = ALL)
  requiredPermissions: string[];  // ← NEW: API가 요구하는 Permission
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  defaultW: number;
  defaultH: number;
}
```

**각 위젯의 roles + requiredPermissions 수정** (보고서 매트릭스 기준):

```typescript
const WIDGETS: WidgetDef[] = [
  // 공통 — DASHBOARD_VIEW 필요
  { id: 'stat-bar',   roles: [], requiredPermissions: ['dashboard:view'], ... },
  { id: 'charts',     roles: [], requiredPermissions: ['dashboard:view'], ... },

  // 의사 전용
  { id: 'census',     roles: ['DOCTOR'], requiredPermissions: ['patient:view'], ... },
  { id: 'schedule',   roles: ['DOCTOR'], requiredPermissions: [], ... },
  { id: 'draft-charts', roles: ['DOCTOR'], requiredPermissions: ['encounter:view'], ... },

  // 경영 — BILLING_VIEW 필요
  { id: 'revenue-today', roles: ['NURSE', 'ADMIN'], requiredPermissions: ['billing:view'], ... },
  { id: 'claims',     roles: ['ADMIN'], requiredPermissions: ['billing:view'], ... },

  // 응급 — PATIENT_VIEW + 역할 제한
  { id: 'er-status',  roles: ['DOCTOR', 'NURSE', 'ADMIN'], requiredPermissions: ['patient:view'], ... },
  { id: 'er-queue',   roles: ['DOCTOR', 'NURSE', 'ADMIN'], requiredPermissions: ['patient:view'], ... },

  // ICU — 가드 보강 후
  { id: 'icu-dashboard', roles: ['DOCTOR', 'NURSE', 'ADMIN'], requiredPermissions: ['patient:view'], ... },

  // 약국 — ORDER_VIEW + PHARMACIST/ADMIN
  { id: 'pharmacy-queue', roles: ['PHARMACIST', 'ADMIN'], requiredPermissions: ['order:view'], ... },
  { id: 'low-stock',  roles: ['PHARMACIST', 'ADMIN'], requiredPermissions: ['order:view'], ... },

  // 품질/만족도 — DOCTOR, NURSE, ADMIN만
  { id: 'qi-dashboard', roles: ['DOCTOR', 'NURSE', 'ADMIN'], requiredPermissions: ['audit:view'], ... },
  { id: 'satisfaction', roles: ['DOCTOR', 'NURSE', 'ADMIN'], requiredPermissions: ['audit:view'], ... },

  // 혈액은행 — PHARMACIST 제외
  { id: 'blood-bank', roles: ['DOCTOR', 'NURSE', 'ADMIN', 'LAB_TECH'], requiredPermissions: ['patient:view'], ... },

  // 통계 차트 (executive/) — ADMIN only
  { id: 'chart-top-dx', roles: ['ADMIN'], requiredPermissions: ['dashboard:view'], ... },

  // 재고 — ADMIN only
  { id: 'reorder-suggest', roles: ['ADMIN'], requiredPermissions: ['system:manage'], ... },
  // ...
];
```

**팔레트 필터링 변경**:

```typescript
// WidgetCatalog.tsx
import { canAccessWidget } from '@/lib/permissions';

const { user } = useAuthStore();
const availableWidgets = WIDGET_LIST.filter((w) =>
  canAccessWidget(w.roles, w.requiredPermissions, user?.role ?? '', user?.permissions ?? [])
);
```

---

### Step 4: 위젯 내부 403 graceful 처리 (1시간)

**파일**: `apps/web/src/app/(main)/dashboard/hooks/use-widget-query.ts` (NEW)

```typescript
'use client';

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface WidgetQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  isForbidden: boolean;
  error: unknown;
}

export function useWidgetQuery<T>(
  queryKey: string[],
  endpoint: string,
  options?: Partial<UseQueryOptions>,
): WidgetQueryResult<T> {
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<{ data: T }>(endpoint);
        const raw = res?.data as any;
        return { __data: raw?.data ?? raw, __forbidden: false };
      } catch (err: any) {
        if (err?.code === 'UNAUTHORIZED' || err?.code === 'FORBIDDEN' || err?.message?.includes('403')) {
          return { __data: null, __forbidden: true };
        }
        throw err;
      }
    },
    retry: (count, err: any) => {
      // 403은 재시도 불필요
      if (err?.code === 'FORBIDDEN' || err?.code === 'UNAUTHORIZED') return false;
      return count < 2;
    },
    ...options,
  });

  return {
    data: (query.data as any)?.__data ?? null,
    isLoading: query.isLoading,
    isForbidden: (query.data as any)?.__forbidden ?? false,
    error: query.error,
  };
}
```

**파일**: `apps/web/src/app/(main)/dashboard/components/WidgetForbidden.tsx` (NEW)

```typescript
'use client';

import { useDashboardStore } from '../stores/dashboard-store';

export default function WidgetForbidden({ widgetId }: { widgetId: string }) {
  const { isEditing, hideWidget } = useDashboardStore();

  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-4">
      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mb-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-xs text-gray-500">이 위젯에 접근 권한이 없습니다</p>
      {isEditing && (
        <button
          onClick={() => hideWidget(widgetId)}
          className="mt-2 text-[10px] text-blue-600 hover:text-blue-700"
        >
          위젯 제거
        </button>
      )}
    </div>
  );
}
```

**기존 위젯에서 useWidgetQuery 사용 예시**:

```typescript
// widgets/LabResultsWidget.tsx — 변경 전
const { data } = useQuery({ queryKey: [...], queryFn: ... });

// 변경 후
import { useWidgetQuery } from '../../hooks/use-widget-query';
import WidgetForbidden from '../WidgetForbidden';

function LabResultsWidget({ settings }: { settings?: Record<string, unknown> }) {
  const { data, isForbidden } = useWidgetQuery<OrderResult[]>(
    ['orders-lab-completed'],
    '/api/v1/orders?department=LAB&status=COMPLETED&limit=10&mine=true',
    { refetchInterval: 15000 },
  );

  if (isForbidden) return <WidgetForbidden widgetId="lab-results" />;
  // ... 정상 렌더링
}
```

---

## 실행 순서 및 의존 관계

```
Step 1: BE auth/me + permissions
  ↓ (FE가 permissions 수신 가능해짐)
Step 2: FE auth-store + permissions 유틸
  ↓ (canAccessWidget 함수 사용 가능)
Step 3: widget-registry roles/permissions 보강 + 팔레트 필터링
  ↓ (팔레트에서 권한 없는 위젯 숨김)
Step 4: useWidgetQuery + WidgetForbidden
  ↓ (위젯이 403 받아도 crash 안 함)

[별도] BE 보안 보강 (ICU/Safety 가드 추가)
  → 위젯 파이프라인과 독립적으로 진행 가능
  → 보강 전에도 Step 3의 roles 제한으로 FE에서 차단
```

## 공수 요약

| Step | 작업 | 공수 | 파일 수 |
|:----:|------|:----:|:-------:|
| 1 | BE auth/me + permissions | 30분 | 1~2 |
| 2 | FE auth-store + permissions.ts | 30분 | 2 |
| 3 | widget-registry roles 수정 + 팔레트 필터링 | 1시간 | 2 |
| 4 | useWidgetQuery + WidgetForbidden | 1시간 | 2 + 위젯 6종 수정 |
| 별도 | BE 보안 보강 (ICU/Safety) | 30분 | 2~3 |
| **합계** | | **~3.5시간** | **~15파일** |

## 보강 후 데이터 흐름

```
[로그인] → auth/me → { role: "NURSE", permissions: ["dashboard:view", "patient:view", "billing:view", ...] }
    ↓
[auth-store] → user.role + user.permissions 저장
    ↓
[팔레트] → canAccessWidget(widget.roles, widget.requiredPermissions, user.role, user.permissions)
    ↓ (3중 필터: roles + permissions + 카테고리)
    ├ 통과 → 팔레트에 표시 → 사용자가 "추가" 클릭
    └ 실패 → 팔레트에서 숨김 (사용자는 위젯 존재 자체를 모름)
    ↓
[위젯 렌더링] → useWidgetQuery(endpoint)
    ├ 200 OK → 정상 표시
    ├ 403 Forbidden → WidgetForbidden 컴포넌트 표시 ("권한이 없습니다" + 편집 시 "제거" 버튼)
    └ 5xx/네트워크 → ErrorBoundary fallback
```
