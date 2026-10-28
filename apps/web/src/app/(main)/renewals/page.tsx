'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';
import { RenewDialog } from '@/components/prescription/RenewDialog';
import { DiscontinueDialog } from '@/components/prescription/DiscontinueDialog';

type Bucket = 'EXPIRED' | 'ENDING_SOON' | 'NO_END';
interface DueItem {
  id: string;
  bucket: Bucket;
  createdAt: string;
  duration: number | null;
  quantity: number | null;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  medicationCode: { nameKo?: string; code?: string } | null;
  dosing: { state: string; endsAt: string | null; daysSinceEnd: number | null };
  encounter: { id: string; patient: { id: string; mrn?: string; familyName?: string; givenName?: string } };
}
interface DueRes { items: DueItem[]; counts: Record<Bucket, number>; soonHours: number; noEndReviewDays: number | null; scanned: number; totalActive: number; truncated: boolean }

const SECTIONS: { key: Bucket; title: string; tone: string }[] = [
  { key: 'EXPIRED', title: '만료됨 — 기간이 끝났는데 아직 활성', tone: 'border-red-200 bg-red-50/40' },
  { key: 'ENDING_SOON', title: '곧 만료', tone: 'border-amber-200 bg-amber-50/40' },
  { key: 'NO_END', title: '기간 없음(PRN·지속)', tone: 'border-gray-200 bg-gray-50/60' },
];

/**
 * 지속 처방 갱신 대기 — 2026-09-30.
 *
 * 내 입원 환자의 활성 약 처방 중 **만료됨·곧 만료·기간 없음**을 줄어드는 목록으로 보여 준다(갱신하거나 중단하면 사라진다).
 * 🔴 시스템은 만료된 처방을 자동으로 끊지 않는다(사람 결정 `order.renewal.autoExpire`) — 그래서 이 목록이 필요하다.
 * 기준값(곧 만료 시간·기간 없는 처방 재검토 기한)은 원내 설정이고, 미설정이면 그렇다고 말한다.
 */
export default function RenewalsPage() {
  const q = useQuery({
    queryKey: ['renewals-due'],
    queryFn: () => apiClient.get<{ data: DueRes }>('/api/v1/prescriptions/renewals/due'),
  });
  const raw = q.data?.data as (Partial<DueRes> & { data?: DueRes }) | undefined;
  const data: DueRes | undefined = raw?.items ? (raw as DueRes) : raw?.data;
  const [renew, setRenew] = useState<DueItem | null>(null);
  const [stop, setStop] = useState<DueItem | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="처방 갱신 대기" /></h2>
        <p className="mt-1 text-sm text-gray-500"><T k="내 입원 환자의 활성 약 처방 중 갱신이나 중단이 필요한 것입니다. 시스템은 만료된 처방을 자동으로 끊지 않습니다." /></p>
        {data && (
          <p className="mt-1 text-xs text-gray-400" data-renew-policy>
            <Tf k="곧 만료 기준 {h}시간" params={{ h: data.soonHours }} /> · {data.noEndReviewDays != null
              ? <Tf k="기간 없는 처방 재검토 기한 {d}일" params={{ d: data.noEndReviewDays }} />
              : <T k="기간 없는 처방 재검토 기한 미설정 — 전부 표시" />}
            {data.truncated && <> · <Tf k="활성 처방 {n}건 중 앞의 {m}건만 살폈습니다" params={{ n: data.totalActive, m: data.scanned }} /></>}
          </p>
        )}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>
      ) : q.isError ? (
        <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon="✅" title="갱신이나 중단이 필요한 처방이 없습니다." />
      ) : (
        SECTIONS.map((sec) => {
          const rows = data.items.filter((i) => i.bucket === sec.key);
          if (rows.length === 0) return null;
          return (
            <section key={sec.key} className={`rounded-2xl border ${sec.tone} p-4`} data-renew-bucket={sec.key}>
              <h3 className="mb-2 text-sm font-semibold text-gray-900"><T k={sec.title} /> <span className="text-gray-400">({rows.length})</span></h3>
              <ul className="divide-y divide-gray-100 rounded-xl bg-white">
                {rows.map((it) => {
                  const pt = it.encounter.patient;
                  return (
                    <li key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-renew-row={it.id}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{it.medicationCode?.nameKo ?? '—'}</p>
                        <p className="text-xs text-gray-500">
                          {[it.dosage, it.frequency, it.duration != null ? `${it.duration}일` : null, it.route].filter(Boolean).join(' · ') || '—'}
                          {' · '}
                          {it.dosing.endsAt
                            ? (it.bucket === 'EXPIRED'
                              ? <><T k="종료" /> <KDate value={it.dosing.endsAt} mode="datetime" /></>
                              : <><T k="종료 예정" /> <KDate value={it.dosing.endsAt} mode="datetime" /></>)
                            : <><T k="시작" /> <KDate value={it.createdAt} mode="datetime" /> · <T k="기간 미기재" /></>}
                        </p>
                      </div>
                      <Link href={`/patients/${pt.id}?tab=medications`} className="text-xs text-blue-600 hover:underline" data-inbox-chart-link="medications"><PatientName familyName={pt.familyName} givenName={pt.givenName} mrn={pt.mrn} /></Link>
                      <button type="button" onClick={() => setRenew(it)} className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700" data-renew-open={it.id}><T k="갱신" /></button>
                      <button type="button" onClick={() => setStop(it)} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100" data-stop-open={it.id}><T k="중단" /></button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {renew && (
        <RenewDialog prescriptionId={renew.id} name={renew.medicationCode?.nameKo ?? ''}
          current={{ dosage: renew.dosage, frequency: renew.frequency, duration: renew.duration, quantity: renew.quantity }}
          onClose={() => setRenew(null)} onDone={() => void q.refetch()} />
      )}
      {stop && (
        <DiscontinueDialog prescriptionId={stop.id} name={stop.medicationCode?.nameKo ?? ''}
          onClose={() => setStop(null)} onDone={() => void q.refetch()} />
      )}
    </div>
  );
}
