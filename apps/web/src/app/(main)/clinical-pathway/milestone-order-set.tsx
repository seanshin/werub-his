'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

/**
 * 마일스톤 ↔ 약속처방 세트 연결(2026-10-07).
 * 연결해 두면 새 처방 입력의 처방 도우미가 그날 항목 옆에 "세트 담기"를 그린다(미리보기 뒤 사람이 담는다 — 자동 처방 없음).
 * 🔴 항목 제목을 오더로 풀어 쓰지 않는다 — 연결은 사람이 고른 세트만.
 */
export type MilestoneOrderSetRef = { id: string; name: string | null; status: string } | null;
export const ORDER_SET_LINK_CATEGORIES = ['ORDER', 'MEDICATION'];

export function MilestoneOrderSetField({ category, value, current, onChange }: {
  category: string;
  /** 고른 세트 id · '' = 연결 안 함 */
  value: string;
  /** 서버가 붙여 준 현재 연결(수정 화면) — 사용 중지·삭제·없음 상태를 말하려고 */
  current?: MilestoneOrderSetRef;
  onChange: (id: string) => void;
}) {
  const linkable = ORDER_SET_LINK_CATEGORIES.includes(category);
  // 목록 EP 는 isActive 세트만 준다 · 연결은 사용 중(ACTIVE)만 서버가 받는다
  const sets = useQuery({
    queryKey: ['pathway-ms-order-sets'],
    queryFn: () => apiClient.get<{ data: { id: string; name: string; category: string; department?: string | null }[] }>('/api/v1/order-sets', { status: 'ACTIVE' }).then((r) => r.data ?? []),
    enabled: linkable,
    staleTime: 60_000,
  });
  if (!linkable) {
    return value ? <p className="text-xs text-amber-700" data-ms-orderset-unlinkable><T k="이 카테고리에서는 세트 연결을 쓰지 않습니다 — 저장하면 연결이 풀립니다" /></p> : null;
  }
  const stale = current && current.id === value && current.status !== 'ACTIVE';
  return (
    <div data-ms-orderset-field>
      <label className="mb-1 block text-sm font-medium text-gray-700"><T k="연결할 약속처방 세트" /></label>
      {sets.isError ? <QueryErrorFallback error={sets.error} onRetry={() => sets.refetch()} />
        : (
          <select value={value} onChange={(e) => onChange(e.target.value)} disabled={sets.isLoading}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" data-ms-orderset-select>
            <option value="">{'—'}</option>
            {stale && <option value={value}>{current?.name ?? value}</option>}
            {(sets.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.department ? ` · ${s.department}` : ''}</option>)}
          </select>
        )}
      {stale && (
        <p className="mt-1 text-xs text-amber-700" data-ms-orderset-stale={current?.status}>
          <T k={current?.status === 'MISSING' ? '연결된 세트를 찾을 수 없습니다 — 다른 세트를 고르거나 연결을 푸세요' : '연결된 세트가 사용 중이 아닙니다 — 처방 도우미에 담기 버튼이 나오지 않습니다'} />
        </p>
      )}
      <p className="mt-1 text-[11px] text-gray-500"><T k="연결하면 새 처방 입력의 처방 도우미에서 그날 항목 옆에 '세트 담기'가 보입니다(미리보기 후 직접 담습니다)." /></p>
    </div>
  );
}

/** 저장 본문의 detail — 바뀐 경우에만 보낸다(`null` = 연결 해제 · 다른 detail 키는 서버가 병합해 보존) */
export function orderSetDetailPatch(category: string, next: string, prev: string | null): { detail: { orderSetId: string | null } } | Record<string, never> {
  const want = ORDER_SET_LINK_CATEGORIES.includes(category) && next ? next : null;
  return want === (prev || null) ? {} : { detail: { orderSetId: want } };
}
