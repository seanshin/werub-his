'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Dash {
  vouchers: Record<string, { count: number; faceValue: number }>;
  sales: { count: number; gross: number; commission: number };
  refunds: { count: number; amount: number; clawback: number };
  batches: number; anchors: number; dealers: Record<string, number>; dealersByType?: Record<string, number>;
}
interface Dealer { id: string; name: string; currency: string; status: string }
interface Settlement { id: string; distributorId: string; periodStart: string; periodEnd: string; grossSales: number; commissionTotal: number; refundClawback: number; netPayable: number; currency: string; status: string }

const won = (n: number) => n.toLocaleString();

export default function VoucherDashboardPage() {
  const tAttr = useTAttr();
  const [d, setD] = useState<Dash | null>(null);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [sel, setSel] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('');

  const load = () => {
    apiClient.get<{ data: Dash }>('/api/v1/voucher/dashboard').then((r) => setD(r.data)).catch(() => toast.error(tAttr('대시보드 실패')));
    apiClient.get<{ data: Dealer[] }>('/api/v1/voucher/distributors').then((r) => setDealers(r.data ?? [])).catch(() => {});
    apiClient.get<{ data: Settlement[] }>('/api/v1/voucher/settlements').then((r) => setSettlements(r.data ?? [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const generate = async () => {
    if (!sel || !start || !end) { toast.error(tAttr('딜러·기간 선택')); return; }
    try { await apiClient.post('/api/v1/voucher/settlements', { distributorId: sel, periodStart: start, periodEnd: end }); toast.success(tAttr('정산 산출')); load(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('정산 실패')); }
  };
  const confirm = async (id: string) => { try { await apiClient.post(`/api/v1/voucher/settlements/${id}/confirm`, {}); toast.success(tAttr('확정')); load(); } catch { toast.error(tAttr('확정 실패')); } };

  const VST: Record<string, string> = { ISSUED: 'text-gray-500', ALLOCATED: 'text-blue-600', SOLD: 'text-indigo-600', ACTIVE: 'text-emerald-600', REDEEMED: 'text-teal-600', REFUNDED: 'text-red-500', REVOKED: 'text-gray-400', EXPIRED: 'text-gray-400' };

  return (
    <div className="w-full p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="검진권 대시보드" /></h1>
        <p className="text-sm text-gray-500"><T k="발행·유통·사용·환불·정산 현황" /></p>
      </div>

      {!d ? <div className="text-sm text-gray-400"><T k="불러오는 중..." /></div> : (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            {[
              ['배치', d.batches, ''], ['앵커', d.anchors, ''],
              ['재판매', d.sales.count, `${won(d.sales.gross)} gross`],
              ['수수료', won(d.sales.commission), ''], ['환불', d.refunds.count, `claw ${won(d.refunds.clawback)}`],
            ].map(([l, v, sub]) => (
              <div key={l as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="text-[11px] text-gray-400"><T k={l as string} /></div>
                <div className="text-xl font-bold text-gray-900">{v}</div>
                {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
              </div>
            ))}
          </div>

          {/* 검진권 상태 분포 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
            <h2 className="text-sm font-bold text-gray-800 mb-3"><T k="검진권 상태" /></h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {Object.entries(d.vouchers).map(([s, v]) => (
                <div key={s} className="px-3 py-2 rounded-xl bg-gray-50">
                  <div className={`text-sm font-bold ${VST[s] ?? 'text-gray-600'}`}>{s}</div>
                  <div className="text-xs text-gray-500">{v.count}<Unit>건</Unit> · <T k="액면" /> {won(v.faceValue)}</div>
                </div>
              ))}
              {Object.keys(d.vouchers).length === 0 && <p className="text-xs text-gray-400"><T k="발행 없음" /></p>}
            </div>
            <div className="mt-3 pt-3 border-t flex flex-wrap gap-1.5">
              {Object.entries(d.dealers).map(([s, n]) => <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"><T k="딜러" /> {s} {n}</span>)}
              {d.dealersByType && Object.entries(d.dealersByType).map(([t, n]) => <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border ${t === 'DOMESTIC' ? 'bg-violet-50 text-violet-600 border-violet-100' : 'bg-sky-50 text-sky-600 border-sky-100'}`}><T k={t === 'DOMESTIC' ? '국내' : '해외'} /> {n}</span>)}
            </div>
          </div>

          {/* 정산 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-3"><T k="딜러 정산" /></h2>
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <select value={sel} onChange={(e) => setSel(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg">
                <option value="">{tAttr('딜러 선택…')}</option>
                {dealers.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}
              </select>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600" />
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600" />
              <button onClick={generate} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><T k="정산 산출" /></button>
            </div>
            <div className="space-y-1.5">
              {settlements.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-xl border border-gray-100 text-sm">
                  <span className="text-gray-600">{s.periodStart?.slice(0, 10)}~{s.periodEnd?.slice(0, 10)}</span>
                  <span className="text-gray-700">gross {won(s.grossSales)} − <T k="수수료" /> {won(s.commissionTotal)} − claw {won(s.refundClawback)} = <b>{won(s.netPayable)} {s.currency}</b></span>
                  <span className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{s.status}</span>
                    {s.status === 'DRAFT' && <button onClick={() => confirm(s.id)} className="text-[11px] text-blue-600 border border-blue-200 rounded-lg px-2 py-0.5"><T k="확정@정산버튼" /></button>}
                  </span>
                </div>
              ))}
              {settlements.length === 0 && <p className="text-xs text-gray-400 py-2"><T k="정산 없음" /></p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
