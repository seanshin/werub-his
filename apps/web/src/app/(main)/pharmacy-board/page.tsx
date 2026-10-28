'use client';

import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

import Link from 'next/link';
import { Unit, Duration } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { useQueueThresholds, waitTone, WAIT_TONE_TEXT } from '@/lib/queue-thresholds';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

/** waitMins: 아직 시작 전(미래 시각)이면 null — 음수를 '방금'으로 굴리지 않는다 */
type QueueItem = { id: string; patientId: string | null; name: string; mrn: string; waitMins: number | null };
// 재고 부족 = 약품 재고 정본(MedicationBatch 합산 잔여) — 종전 소모품 마스터(currentStock/safetyStock) 계약은 폐기
type Low = { id: string; name: string; code: string; remainingQty: number };
type Resp = {
  summary: { pending: number; verifyWait: number; verifyWaitExternal: number; dispensedToday: number; lowStockCount: number };
  queue: QueueItem[];
  lowStock: Low[];
};

/**
 * 지표 타일 — `href` 가 있으면 해당 워크리스트로 이동한다.
 * 🔴 종전엔 '검수 대기 5' 를 숫자로만 보여주고 **그 5건을 볼 곳이 이 화면에 없었다**
 *    (목록 패널은 조제 대기·재고 부족 둘뿐). 숫자만 있고 조치 경로가 없으면 관제가 끊긴다.
 */
function Stat({ label, value, tone, href, hint, extra }: { label: string; value: number; tone?: string; href?: string; hint?: string; extra?: React.ReactNode }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const body = (
    <>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5"><T k={label} />{extra}{href && <span className="text-gray-300 ml-1">→</span>}</div>
    </>
  );
  const cls = `rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`;
  if (!href) return <div className={cls}>{body}</div>;
  return <Link href={href} title={hint ? tAttr(hint) : tfAttr('{항목} 목록으로 이동', { 항목: tAttr(label) })} className={`${cls} block hover:shadow-sm transition`}>{body}</Link>;
}

export default function PharmacyBoard() {
  const qThresholds = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2)
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['pharmacy-board'],
    queryFn: () => apiClient.get<{ data: Resp }>('/api/v1/pharmacy-board'),
    refetchInterval: pollMs('normal'),
  });
  const r = data?.data;
  const s = r?.summary;
  const queue = r?.queue ?? [];
  const lowStock = r?.lowStock ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="약국 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="조제 대기·검수 대기·금일 조제·재고 부족 현황" /></p>
        </div>
        <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={35000} />
      </div>

      {/* 🔴 조회 실패를 "대기 0 · 부족 0"으로 그리지 않는다 — 벽걸이 관제 보드라 초록 0 이 곧 안심이 된다 */}
      {isError && (
        <div className="mb-3"><QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /></div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="조제 대기" value={s?.pending ?? 0} tone="border-amber-200 bg-amber-50" href="/pharmacy?status=ORDERED" />
        {/* 딥링크가 여는 것은 원내 탭 — KPI 도 원내로 세고, 원외 검수분은 라벨에 병기한다(KPI>목록 방지) */}
        {/* 🔴 원외 건수는 데이터 — 라벨 뒤에 조각으로 붙이지 않고 자리표시자 문장으로 넘긴다 */}
        <Stat label="검수 대기" extra={(s?.verifyWaitExternal ?? 0) > 0 ? <Tf k=" · 원외 {수}" params={{ 수: s?.verifyWaitExternal ?? 0 }} /> : undefined}
          value={s?.verifyWait ?? 0} href="/pharmacy?status=DISPENSED" hint="원내 조제 완료·검수 대기 목록으로 이동" />
        <Stat label="금일 조제" value={s?.dispensedToday ?? 0} tone="border-emerald-200 bg-emerald-50" />
        <Stat label="재고 부족" value={s?.lowStockCount ?? 0} tone="border-rose-200 bg-rose-50" href="/pharmacy/admin" hint="약품 재고 관리로 이동" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-4">
        {/* 조제 대기 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-gray-700"><Tf k="조제 대기 ({수})" params={{ 수: s?.pending ?? 0 }} /></div>
          {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
          : isError ? <div className="p-8 text-center text-sm text-gray-500"><T k="조회 실패 — 대기가 없는 것이 아닙니다." /></div>
          : !queue.length ? <div className="p-8 text-center text-sm text-gray-400"><T k="대기 없음" /> ✓</div>
          : (
            <table className="w-full text-sm">
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id} className={`border-b border-gray-50 hover:bg-gray-50/60 ${q.waitMins != null && waitTone(q.waitMins, qThresholds) ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2.5">
                      {q.patientId
                        ? <Link href={`/patients/${q.patientId}`} className="font-medium text-blue-700 hover:underline">{q.name}</Link>
                        : <span className="font-medium text-gray-700">{q.name}</span>}
                      <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{q.mrn}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {q.waitMins == null ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <span className={waitTone(q.waitMins, qThresholds) ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
                          <Duration minutes={q.waitMins} />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 재고 부족 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-rose-700 bg-rose-50/40"><Tf k="재고 부족 ({수})" params={{ 수: s?.lowStockCount ?? 0 }} /></div>
          {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
          : isError ? <div className="p-8 text-center text-sm text-gray-500"><T k="조회 실패 — 부족 품목이 없다는 뜻이 아닙니다." /></div>
          : !lowStock.length ? <div className="p-8 text-center text-sm text-emerald-600"><T k="부족 품목 없음" /> ✓</div>
          : (
            <table className="w-full text-sm">
              <tbody>
                {lowStock.map((i) => (
                  <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 text-gray-700 max-w-[260px] truncate" title={`${i.name} (${i.code})`}>{i.name}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><span className="text-rose-600 font-semibold">잔여 {i.remainingQty}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
