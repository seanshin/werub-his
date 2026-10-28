'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { EmptyState, StaffName, KDate } from '@/components/ui/display';
import { pollMs } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 스태프 포털 — 인수인계 확인(상번) (nurse-workstation-notes-handoff.plan.md v2).
 *
 * 워크스테이션(PC)에 이어 **폰에서도** 받은 인계를 확인·인수 처리한다 — 출근길·병동 이동 중에도
 * 인계가 묻히지 않게. 알림(인앱)이 정본 통지 경로이고 이 화면이 처리 지점이다.
 * 작성(하번)은 워크스테이션에서 — 폰은 확인에 집중(긴 요약 작성은 PC가 낫다).
 */
interface HandoffRow {
  id: string;
  type?: string;
  kind?: string;
  summary?: string;
  createdAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  fromDoctor?: { familyName?: string; givenName?: string };
  pendingItems?: { items?: string[] } | null;
}

const LOGIN_RETURN = '/staff/login?next=/staff/handoffs';

export default function StaffHandoffsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const tAttr = useTAttr();

  const pendingQ = useQuery({
    queryKey: ['staff-handoffs-pending'],
    queryFn: () => apiClient.get<{ data: HandoffRow[] | { data: HandoffRow[] } }>('/api/v1/handoffs/pending'),
    enabled: !!user,
    refetchInterval: pollMs('normal'),
  });
  // 이중 {data} 래핑 방어(서비스+컨트롤러 — 워크스테이션 인계 탭과 동일)
  const raw = pendingQ.data?.data;
  const pending: HandoffRow[] = Array.isArray(raw) ? raw : raw?.data ?? [];

  const ack = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/handoffs/${id}/acknowledge`),
    onSuccess: () => {
      toast.success(tAttr('인수 확인했습니다.'));
      queryClient.invalidateQueries({ queryKey: ['staff-handoffs-pending'] });
    },
    onError: () => toast.error(tAttr('인수 확인에 실패했습니다.')),
  });

  if (!user) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-500 mb-3"><T k="로그인이 필요합니다." /></p>
        <Link href={LOGIN_RETURN} className="inline-block px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold">
          <T k="스태프 로그인" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900"><T k="인수인계" /></h1>
          <p className="text-xs text-gray-500"><T k="받은 인계를 확인하고 인수 처리하세요." /></p>
        </div>
        {pending.length > 0 && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-600"><Tf k="{건수}건 미확인" params={{ 건수: pending.length }} /></span>
        )}
      </div>

      {pendingQ.isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : pending.length === 0 ? (
        <EmptyState icon="✅" title="미확인 인계가 없습니다." hint="새 인계가 오면 알림으로 안내됩니다." />
      ) : (
        pending.map((h) => (
          <div key={h.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {h.patient?.familyName}{h.patient?.givenName}
                </span>
                <span className="text-[10px] text-gray-400 font-mono shrink-0">{h.patient?.mrn}</span>
                {(h.kind ? h.kind === 'NURSING_SHIFT' : h.type === 'NURSING_SHIFT') && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 shrink-0"><T k="교대" /></span>}
              </div>
              <span className="text-[11px] text-gray-400 shrink-0"><KDate value={h.createdAt} mode="datetime" /></span>
            </div>
            <p className="text-[11px] text-gray-400 mb-1.5">
              {/* 이름이 있을 때만 문장 — 이름 미상은 종전처럼 StaffName 의 '기록 없음' 표시만(접미어 없이) 둔다 */}
              {`${h.fromDoctor?.familyName ?? ''}${h.fromDoctor?.givenName ?? ''}`.trim()
                ? <Tf k="{이름} 님이 인계" params={{ 이름: <StaffName familyName={h.fromDoctor?.familyName} givenName={h.fromDoctor?.givenName} /> }} />
                : <StaffName familyName={h.fromDoctor?.familyName} givenName={h.fromDoctor?.givenName} />}
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{h.summary}</p>
            {!!h.pendingItems?.items?.length && (
              <ul className="mt-2 space-y-0.5">
                {h.pendingItems.items.map((it, i) => (
                  <li key={i} className="text-xs text-amber-700">▫ {it}</li>
                ))}
              </ul>
            )}
            <button
              onClick={() => ack.mutate(h.id)}
              disabled={ack.isPending}
              className="mt-3 w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              <T k="인수 확인" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
