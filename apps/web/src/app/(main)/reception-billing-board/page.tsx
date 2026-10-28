'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';

import { Duration, EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQueueThresholds, waitTone, WAIT_TONE_TEXT } from '@/lib/queue-thresholds';

/** waitMins: 아직 도착 전이면 null — 0 도 '방금'도 아니다 */
type Wait = { id: string; patientId: string; name: string; mrn: string; department: string; waitMins: number | null; eligibility: string };
type Resp = {
  summary: { waiting: number; eligUnchecked: number; todayPaidAmount: number; todayPaidCount: number; outstandingAmount: number; outstandingCount: number; docPending: number };
  waitingList: Wait[];
  listLimit?: number;
  listTruncated?: boolean;
};

const won = (n: number) => `${n.toLocaleString('ko')}원`;
const ELIG_TONE: Record<string, string> = { VERIFIED: 'text-emerald-600', EXPIRED: 'text-rose-600', NOT_FOUND: 'text-rose-600', ERROR: 'text-amber-600', NOT_CHECKED: 'text-gray-400' };
const ELIG_LABEL: Record<string, string> = { VERIFIED: '확인', EXPIRED: '만료', NOT_FOUND: '미발견', ERROR: '오류', NOT_CHECKED: '미확인' };

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    /* 🔴 금액(`12,345,600원`)이 최소폭 150px 카드에서 상시 2줄이 됐다 — 값은 한 줄 고정하고
       넘치면 가로 스크롤로(숫자를 조용히 자르지 않는다). 늘어난 카드는 수직 중앙 정렬. */
    <div className={`flex flex-col justify-center rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`}>
      <div className="overflow-x-auto whitespace-nowrap text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5"><T k={label} /></div>
    </div>
  );
}

export default function ReceptionBillingBoard() {
  const tAttr = useTAttr();
  const qThresholds = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2)
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['reception-billing-board'],
    queryFn: () => apiClient.get<{ data: Resp }>('/api/v1/reception-billing/board'),
    refetchInterval: pollMs('normal'),
  });
  const r = data?.data;
  const s = r?.summary;
  const list = r?.waitingList ?? [];
  const truncated = !!r?.listTruncated;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="원무·수납 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="접수 대기·보험 자격·금일 수납·미수금·증명서 발급 현황" /></p>
        </div>
        <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={35000} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="접수 대기@원무" value={`${s?.waiting ?? 0}명`} />
        <Stat label="자격 미확인" value={`${s?.eligUnchecked ?? 0}명`} tone="border-amber-200 bg-amber-50" />
        <Stat label="금일 수납" value={won(s?.todayPaidAmount ?? 0)} tone="border-emerald-200 bg-emerald-50" />
        <Stat label="미수금" value={won(s?.outstandingAmount ?? 0)} tone="border-rose-200 bg-rose-50" />
        <Stat label="증명서 발급 대기" value={`${s?.docPending ?? 0}건`} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        {/* 🔴 헤더는 196 인데 표는 50행에서 끝났다 — 잘렸다는 사실을 밝힌다 */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-baseline gap-2">
          <span className="text-sm font-bold text-gray-700"><T k="접수 대기@원무" /> ({s?.waiting ?? 0})</span>
          {truncated && (
            <span className="text-[11px] text-gray-400">
              대기시간이 긴 {list.length}명만 표시 — 전체 {s?.waiting}명
            </span>
          )}
        </div>
        {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        : !list.length ? <EmptyState icon="👤" title="대기 환자가 없습니다." />
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium"><T k="환자" /></th>
                <th className="px-3 py-2 font-medium"><T k="진료과" /></th>
                <th className="px-3 py-2 font-medium"><T k="대기시간" /></th>
                <th className="px-3 py-2 font-medium"><T k="보험 자격" /></th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className={`border-b border-gray-50 hover:bg-gray-50/60 ${w.waitMins != null && waitTone(w.waitMins, qThresholds) ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-2.5">
                    <Link href={`/patients/${w.patientId}`} className="font-medium text-blue-700 hover:underline">{w.name}</Link>
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{w.mrn}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{w.department}</td>
                  <td className="px-3 py-2.5">
                    {w.waitMins == null ? (
                      <span className="text-gray-400"><T k="도착 전" /></span>
                    ) : (
                      <span className={waitTone(w.waitMins, qThresholds) ? 'text-amber-700 font-semibold' : 'text-gray-600'}>
                        <Duration minutes={w.waitMins} />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><span className={`text-xs font-medium ${ELIG_TONE[w.eligibility] ?? 'text-gray-400'}`}>{ELIG_LABEL[w.eligibility] ?? w.eligibility}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
