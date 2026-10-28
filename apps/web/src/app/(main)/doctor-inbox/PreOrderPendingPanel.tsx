'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

export interface MyPendingPreOrder {
  id: string;
  type: string;
  priority?: string | null;
  createdAt: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  expiresAt?: string | null;
  reason?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  durSnapshot?: unknown;
  source?: string | null;
  patient?: { id: string; mrn?: string | null; familyName?: string | null; givenName?: string | null } | null;
  medicationCode?: { code?: string | null; nameKo?: string | null } | null;
  procedureCode?: { code?: string | null; nameKo?: string | null } | null;
}

/** `GET pre-orders/pending` — 서비스가 `{data}` 를 한 번 더 싸서 `{data:{data:[]}}` 로 온다(봉투 한 겹·두 겹 모두 받는다) */
export const PREORDER_PENDING_KEY = ['my-pre-orders-pending'] as const;
export function fetchMyPendingPreOrders() {
  return apiClient.get<unknown>('/api/v1/pre-orders/pending').then((r) => {
    const a = (r as { data?: unknown })?.data;
    const b = Array.isArray(a) ? a : (a as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(b)) throw new Error('사전처방 응답 형식을 해석하지 못했습니다');
    return b as MyPendingPreOrder[];
  });
}

const TYPE_LABEL: Record<string, string> = { MEDICATION: '약', LAB: '검사', IMAGING: '영상' };

/**
 * 사전처방 승인 대기(내가 낸 PENDING) — 2026-10-07 의사 할 일함.
 * 🔴 `GET pre-orders/pending`(의사 본인) EP 는 있었는데 부르는 화면이 없었다 — 미결 사전처방은 그 환자를 다시 열어야만 보였다.
 * 승인은 **진료에 묶여** 일어난다(`approve {encounterId}` — 처방이 그 진료에 생긴다) — 여기서 승인하지 않고 환자 차트의 사전처방 탭으로 보낸다.
 */
export function PreOrderPendingPanel() {
  const q = useQuery({ queryKey: PREORDER_PENDING_KEY, queryFn: fetchMyPendingPreOrders });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-xl bg-gray-50" />;
  const items = q.data ?? [];
  return (
    <section className="space-y-3" data-preorder-panel>
      <div>
        <h2 className="text-lg font-bold text-gray-900"><T k="사전처방 승인 대기" /></h2>
        <p className="mt-0.5 text-xs text-gray-500"><T k="내가 낸 사전처방 중 아직 승인하지 않은 것입니다. 승인은 진료에 묶여 처방이 생기므로 환자 차트의 사전처방 탭에서 합니다." /></p>
      </div>
      {items.length === 0 ? <EmptyState icon="⏳" title="승인을 기다리는 사전처방이 없습니다" compact className="rounded-2xl border bg-white" /> : (
        <ul className="divide-y rounded-2xl border bg-white">
          {items.map((p) => {
            const name = p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? null;
            const expired = !!p.expiresAt && Date.parse(p.expiresAt) < Date.now();
            const dur = Array.isArray(p.durSnapshot) ? p.durSnapshot.length : 0;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-preorder-row={p.id}>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold text-gray-900">
                    {p.patient ? <PatientName familyName={p.patient.familyName} givenName={p.patient.givenName} mrn={p.patient.mrn} /> : <span className="text-gray-400"><T k="이름 미상" /></span>}
                  </p>
                  <p className="text-xs text-gray-700">
                    <span className="mr-1 rounded bg-gray-100 px-1 text-[10px]"><T k={TYPE_LABEL[p.type] ?? p.type} /></span>
                    {name ?? <span className="text-gray-400"><T k="항목 미기재" /></span>}
                    {p.dosage && <span className="text-gray-500"> · {p.dosage}{p.frequency ? ` ${p.frequency}` : ''}</span>}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    <T k="낸 시각" /> <KDate value={p.createdAt} mode="datetime" />
                    {' · '}<T k="예정일" /> <KDate value={p.scheduledDate} unknown="UNRECORDED" />{p.scheduledTime ? ` ${p.scheduledTime}` : ''}
                    {p.expiresAt && <> · <span className={expired ? 'font-semibold text-red-700' : ''}><T k={expired ? '만료 시각 지남' : '만료'} /> <KDate value={p.expiresAt} mode="datetime" /></span></>}
                  </p>
                  {dur > 0 && <p className="text-[11px] font-semibold text-amber-700"><T k="작성 때 DUR 경고가 있었습니다 — 승인 때 다시 점검합니다" /> ({dur})</p>}
                </div>
                {p.patient?.id && (
                  <Link href={`/patients/${p.patient.id}?tab=pre-orders`} className="min-h-[40px] rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white" data-preorder-open={p.id}>
                    <T k="차트에서 승인" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
