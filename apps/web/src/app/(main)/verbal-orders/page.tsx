'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

interface PendingItem {
  id: string;
  type: string;
  orderSource: 'VERBAL' | 'TELEPHONE' | string;
  createdAt: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: number | null;
  route?: string | null;
  instructions?: string | null;
  readBackConfirmedAt?: string | null;
  medicationCode?: { nameKo?: string } | null;
  procedureCode?: { nameKo?: string } | null;
  encounter?: { id: string; patient?: { id: string; mrn?: string; familyName?: string; givenName?: string } } | null;
}
interface PendingRes { items: PendingItem[]; total: number; cap: number; truncated: boolean }

/**
 * 구두·전화 처방 **처방의 사후 확인** — 2026-09-30 의사 업무 점검.
 *
 * 🔴 복창(readBack)은 받은 간호사의 확인이다. 낸 의사가 "내가 낸 것이 맞다"고 확인할 목록이 없어 의사는 기억에 의존했다.
 *    이 목록은 **줄어드는 목록**이다(확인하면 사라진다) — 사라지는 알림이 아니라 남은 일을 센다.
 * 목록·확인 모두 서버가 **책임 처방의 본인**으로 좁힌다(남의 처방을 대신 확인할 수 없다).
 */
export default function VerbalOrdersPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['verbal-cosign-pending'],
    queryFn: () => apiClient.get<{ data: PendingRes }>('/api/v1/prescriptions/verbal-cosign/pending'),
  });
  const res = q.data?.data as (Partial<PendingRes> & { data?: PendingRes }) | undefined;
  const data: PendingRes | undefined = res?.items ? (res as PendingRes) : res?.data;
  const items = data?.items ?? [];

  const cosign = useMutation({
    mutationFn: (id: string) => apiClient.patch<{ data: { alreadyCosigned: boolean } }>(`/api/v1/prescriptions/verbal-cosign/${id}`),
    onSuccess: (r) => {
      const already = (r?.data as { alreadyCosigned?: boolean } | undefined)?.alreadyCosigned;
      if (already) toast.info('이미 확인된 처방입니다.'); else toast.success('확인했습니다.');
      qc.invalidateQueries({ queryKey: ['verbal-cosign-pending'] });
    },
    onError: (e) => toast.error(extractErrorMessage(e) || '확인에 실패했습니다.'),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="구두·전화 처방 확인" /></h2>
        <p className="mt-1 text-sm text-gray-500"><T k="내가 책임 처방의인 구두·전화 처방 중 아직 확인하지 않은 것입니다. 확인하면 목록에서 사라집니다." /></p>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>
      ) : q.isError ? (
        <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="✅" title="확인할 구두·전화 처방이 없습니다." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-verbal-list>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 text-xs text-gray-500">
            <span><Tf k="확인 대기 {n}건" params={{ n: data?.total ?? items.length }} /></span>
            {data?.truncated && <span className="text-amber-700"><Tf k="오래된 순 {cap}건만 표시 — 확인하면 다음 건이 올라옵니다" params={{ cap: data.cap }} /></span>}
          </div>
          <ul className="divide-y divide-gray-50">
            {items.map((it) => {
              const name = it.medicationCode?.nameKo ?? it.procedureCode?.nameKo ?? it.instructions ?? it.type;
              const pt = it.encounter?.patient;
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-verbal-row={it.id}>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${it.orderSource === 'TELEPHONE' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
                    <T k={it.orderSource === 'TELEPHONE' ? '전화 처방' : '구두 처방'} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-500">
                      {[it.dosage, it.frequency, it.duration != null ? `${it.duration}일` : null, it.route].filter(Boolean).join(' · ') || '—'}
                      {' · '}<KDate value={it.createdAt} mode="datetime" />
                      {' · '}{it.readBackConfirmedAt ? <T k="복창 확인됨" /> : <span className="text-amber-700"><T k="복창 기록 없음" /></span>}
                    </p>
                  </div>
                  {pt && (
                    // 약 처방 → 차트 투약 이력 · 그 밖 오더 → 오더 추적(종전엔 개요)
                    <Link href={`/patients/${pt.id}?tab=${it.type === 'MEDICATION' ? 'medications' : 'orders'}`} className="text-xs text-blue-600 hover:underline" data-inbox-chart-link={it.type === 'MEDICATION' ? 'medications' : 'orders'}>
                      <PatientName familyName={pt.familyName} givenName={pt.givenName} mrn={pt.mrn} />
                    </Link>
                  )}
                  <button type="button" onClick={() => cosign.mutate(it.id)} disabled={cosign.isPending}
                    className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    <T k="내가 낸 처방 확인" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
