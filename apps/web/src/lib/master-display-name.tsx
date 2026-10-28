'use client';

import { useQuery } from '@tanstack/react-query';
import { useUiLocale } from '@/stores/ui-locale-store';
import { apiClient } from '@/lib/api-client';

/**
 * 마스터 데이터 표시명 — **진료과 등 코드 마스터의 영문명을 화면이 실제로 쓰게 한다.**
 *
 * 🔴 원 결함(2026-09-10 운영 실측): 화면 언어를 English 로 둬도 진료과가 전부 한국어로 나왔다.
 *    데이터 공백이 아니었다 — `GET /api/v1/codes/departments` 실측 결과 **36건 전건에 `nameEn`** 이
 *    이미 있었다(내과=Internal Medicine …). **화면이 그 값을 쓰지 않는 배선 공백**이었다.
 *
 * 규약
 *   · 🔴 **정본은 마스터다.** ko→en 을 카탈로그에 복제하지 않는다(복제하면 같은 사실에 정본이 둘이 되고,
 *     마스터가 바뀌어도 화면은 옛 값을 그린다).
 *   · 🔴 **없으면 지어내지 않는다** — 맵에 없는 이름은 한국어 원문 그대로. 로마자 변환·추측 금지
 *     (용어 토글 축의 `EN×` 선례와 같은 규율).
 *   · 🔴 **조회 실패를 "영문명 없음"으로 번역하지 않는다** — `.catch(() => [])` 로 접지 않는다.
 *     실패하면 원문으로 그리되 `isError` 를 살려 소비처가 그 사실을 말할 수 있게 둔다.
 *   · ko 화면에서는 **글자가 하나도 바뀌지 않는다**(표시만 바꾸는 축이다).
 */
interface DepartmentCodeRow {
  code?: string;
  nameKo?: string;
  nameEn?: string | null;
}

/** `{ data: [...] }` / `{ data: { data: [...] } }` 양쪽 언랩 — 봉투가 바뀌어도 조용히 0건이 되지 않게 */
function unwrapRows(res: unknown): DepartmentCodeRow[] | null {
  const d = (res as { data?: unknown } | undefined)?.data;
  if (Array.isArray(d)) return d as DepartmentCodeRow[];
  const inner = (d as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as DepartmentCodeRow[]) : null;
}

export interface MasterNameLookup {
  /** 한국어 표시명 → 그 로케일의 표시명. 모르면 **원문을 그대로 돌려준다** */
  nameOf: (ko: string | null | undefined) => string;
  /** 이 이름이 마스터 영문명으로 바뀐 것인가(가드·화면이 출처를 물을 수 있게) */
  isTranslated: (ko: string | null | undefined) => boolean;
  /** 🔴 조회 실패 — 화면은 원문으로 그려지고 있다는 사실을 소비처가 말할 수 있게 */
  isError: boolean;
  isLoading: boolean;
}

export function useDepartmentNames(): MasterNameLookup {
  const locale = useUiLocale();
  const q = useQuery({
    queryKey: ['codes', 'departments', 'display-name'],
    // 🔴 `.catch(() => [])` 로 접지 않는다 — 접으면 isError 가 영원히 false 가 되어
    //    "영문명이 없다"와 "불러오지 못했다"가 같은 그림이 된다(이 저장소의 반복 결함).
    queryFn: () => apiClient.get<unknown>('/api/v1/codes/departments'),
    staleTime: 30 * 60 * 1000,
    // ko 화면은 이 조회가 필요 없다 — 부르지 않는 것이 맞다
    enabled: locale !== 'ko',
  });

  const rows = unwrapRows(q.data) ?? [];
  const map = new Map<string, string>();
  if (locale === 'en') {
    for (const r of rows) {
      if (r.nameKo && r.nameEn) map.set(r.nameKo, r.nameEn);
    }
  }
  // 🔴 ja·ar 은 마스터에 그 언어 이름이 없다 — **영문으로 대신 채우지 않는다**(다른 언어를 그 언어인 척하지 않는다).

  return {
    nameOf: (ko) => (ko ? (map.get(ko) ?? ko) : ''),
    isTranslated: (ko) => !!ko && map.has(ko),
    isError: q.isError,
    isLoading: q.isLoading,
  };
}

/**
 * 진료과 표시명 한 개 — 마스터 영문명이 있으면 그것으로, 없으면 **원문 그대로**.
 * 🔴 원문으로 떨어진 것을 조용히 두지 않는다: `title` 로 "마스터에 영문명이 없다"를 말한다.
 */
export function DeptName({ ko, className }: { ko: string | null | undefined; className?: string }) {
  const locale = useUiLocale();
  const { nameOf, isTranslated, isError } = useDepartmentNames();
  if (!ko) return null;
  if (locale === 'ko') return <span className={className}>{ko}</span>;
  const shown = nameOf(ko);
  if (isTranslated(ko)) return <span className={className} dir="auto">{shown}</span>;
  return (
    <span
      className={className}
      dir="auto"
      title={isError
        ? '진료과 마스터를 불러오지 못해 한국어 원문을 표시합니다'
        : '이 진료과는 마스터에 해당 언어 이름이 없어 한국어 원문을 표시합니다'}
      data-master-name-fallback={isError ? 'FETCH_FAILED' : 'NO_MASTER_NAME'}
    >
      {shown}
    </span>
  );
}
