'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogTransitionAllowed } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface AgendaItem { id: string; title: string; status: string; key: string | null; committee?: { code: string; name: string } | null; decision?: { decisionNo: string; status: string } | null }
interface AgendaState { owner: { id: string; code: string; name: string } | null; items: AgendaItem[] }
const OPEN = ['SUBMITTED', 'SCHEDULED', 'DEFERRED'];

/**
 * 약속처방 사용 중 전환 → 담당 위원회 안건(2026-10-21 임상 규칙·템플릿 P5 B4).
 *
 * 🔴 이 단추는 세트를 바꾸지 않는다 — "사용 중으로 / 보류"를 위원회 안건으로 올릴 뿐이다(의결 → 집행 엔진이 반영).
 * 🔴 담당 위원회는 서버의 표면 매핑이 정한다 — 없으면(결정 `catalog.ownership` 미배정) 올릴 수 없다고 말하고 단추를 내지 않는다.
 *    관리자만 부른다(서버 EP 관리자 전용 · 다른 역할은 조회하지 않는다).
 *    사용 중으로 갈 수 있는 상태(초안·승인됨 — shared `catalogTransitionAllowed`)만 후보다.
 */
export function CatalogAgendaPanel({ items }: { items: Array<{ id: string; name: string; status: string }> | undefined }) {
  const tA = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const q = useQuery({
    queryKey: ['catalog-agendas'],
    queryFn: () => apiClient.get<{ data: AgendaState }>('/api/v1/admin/clinical-rules/agendas'),
    enabled: isAdmin,
  });
  const submit = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/admin/clinical-rules/order-sets/${id}/agenda`, {}),
    onSuccess: () => { toast.success(tA('위원회 안건으로 올렸습니다 — 세트는 의결 전까지 바뀌지 않습니다')); qc.invalidateQueries({ queryKey: ['catalog-agendas'] }); },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tA('안건으로 올리지 못했습니다')),
  });
  if (!isAdmin || !items) return null;
  const raw = q.data?.data as AgendaState | { data?: AgendaState } | undefined;
  const st = (raw && 'data' in raw ? raw.data : raw) as AgendaState | undefined;
  const candidates = items.filter((i) => catalogTransitionAllowed(i.status, 'ACTIVE'));
  if (!candidates.length) return null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-950" data-catalog-agenda>
      <p className="font-semibold"><T k="사용 중 전환을 위원회 안건으로" /></p>
      {q.isError && <p className="text-amber-800" data-catalog-agenda-unknown><T k="담당 위원회·안건 상태를 불러오지 못했습니다 — 확인 불가" /></p>}
      {q.isLoading && <p className="text-gray-500"><T k="불러오는 중…" /></p>}
      {st && !st.owner && (
        <p data-catalog-agenda-no-owner>
          <T k="약속처방 사용 중 전환을 맡은 위원회가 정해지지 않아 안건으로 올릴 수 없습니다." />{' '}
          <Link href="/admin/decisions/catalog.ownership" className="text-blue-700 underline"><T k="소유 위원회 결정" /></Link>
        </p>
      )}
      {st?.owner && (
        <>
          <p className="text-gray-700" data-catalog-agenda-owner={st.owner.code}>
            <T k="담당" />: {st.owner.name} — <T k="올려도 세트는 바뀌지 않습니다. 위원회가 「사용 중으로」를 의결하면 그때 반영됩니다." />
          </p>
          <ul className="mt-1 space-y-1">
            {candidates.map((c) => {
              const open = st.items.find((a) => a.key === c.id && OPEN.includes(a.status));
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1" data-catalog-agenda-row={c.id}>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{c.name}</span>
                  {open
                    ? <span className="text-[11px] text-indigo-800" data-catalog-agenda-open={open.status}><T k="안건 진행 중" /></span>
                    : (
                      <button type="button" disabled={submit.isPending} onClick={() => submit.mutate(c.id)}
                        className="min-h-[36px] rounded-lg bg-indigo-700 px-3 text-[12px] font-semibold text-white disabled:opacity-40" data-catalog-agenda-submit={c.id}>
                        <T k="안건으로 올리기" />
                      </button>
                    )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
