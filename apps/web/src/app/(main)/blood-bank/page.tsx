'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatusBadge from '@/components/ui/StatusBadge';
import { KDate, EmptyState } from '@/components/ui/display';
import { usePollInterval } from '@/lib/ui-settings';
import { bloodTypeText, BLOOD_PRODUCT_LABEL as PRODUCT_LABEL } from '@hospital-run/shared';
import BloodBankEnhancement from './BloodBankEnhancement';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface BloodUnit {
  id: string;
  unitNumber: string;
  productType: string;
  bloodType: string;
  rhFactor?: string;
  volume: number;
  expiresAt: string;
  status: string;
}

interface TransfusionOrder {
  id: string;
  urgency: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  productType: string;
  units: number;
  indication?: string;
  status: string;
  transfusions?: { id: string; status?: string }[]; // 서버가 include 하는 출고 이력 — 진척 표시용
}

interface BloodDashboard {
  inventoryMatrix?: Record<string, Record<string, number>>;
  totalInventory?: number;
  todayOrders?: number;
  pendingCrossmatch?: number;
}

// 제제 라벨 정본 = shared BLOOD_PRODUCT_LABEL (로컬 재정의 제거 — P12 예방)
const STATUS_LABEL: Record<string, string> = { AVAILABLE: '가용', RESERVED: '예약', CROSSMATCHED: '교차완료', ISSUED: '출고', TRANSFUSED: '수혈', RETURNED: '반환', EXPIRED: '만료', DISCARDED: '폐기' };
const STATUS_COLOR: Record<string, string> = { AVAILABLE: 'bg-emerald-100 text-emerald-700', RESERVED: 'bg-indigo-100 text-indigo-700', CROSSMATCHED: 'bg-violet-100 text-violet-700', ISSUED: 'bg-amber-100 text-amber-700', TRANSFUSED: 'bg-blue-100 text-blue-700', EXPIRED: 'bg-red-100 text-red-700', DISCARDED: 'bg-gray-200 text-gray-600' };
// 수혈오더 상태 — shared TRANSFUSION_ORDER_STATUS_LABEL + StatusBadge(domain='transfusionOrder')로 일원화(UX 파일럿)
const URGENCY_COLOR: Record<string, string> = { EMERGENT: 'bg-red-600 text-white', URGENT: 'bg-orange-500 text-white', ROUTINE: 'bg-gray-100 text-gray-600' };

type BloodTab = 'inventory' | 'orders' | 'dashboard' | 'safety';

export default function BloodBankPage() {
  const tAttr = useTAttr();
  /** 🔴 혈액 입고 등록은 혈액은행 실무(서버 `@Roles(LAB_TECH, ADMIN)`) — 의사·간호사는 조회다 */
  const canReceive = useHasRole('LAB_TECH');
  const qc = useQueryClient();
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [issueOrder, setIssueOrder] = useState<TransfusionOrder | null>(null);
  // 🔴 서버 계약(AddBloodProductDto): bloodType=ABO('A'…'AB')·rhFactor(POS/NEG)·collectedAt·supplierName 이
  //    전부 별도 필드다. 종전 폼은 bloodType='A+' 합성값에 rhFactor/collectedAt 부재·supplier 오키라
  //    ValidationPipe 400 → 화면 경로로는 입고가 구조적으로 100% 실패했다(P11).
  const [rcvForm, setRcvForm] = useState({ unitNumber: '', productType: 'PRBC', bloodType: 'A', rhFactor: 'POS', volume: '', collectedAt: '', expiresAt: '', supplierName: '' });

  const receiveBlood = useMutation({
    mutationFn: (body: any) => apiClient.post('/api/v1/blood-bank/inventory', body),
    onSuccess: () => { toast.success(tAttr('혈액 입고 완료')); qc.invalidateQueries({ queryKey: ['blood-inventory'] }); setShowReceiveModal(false); },
    onError: () => toast.error(tAttr('입고 실패')),
  });
  const [tab, setTab] = useState<BloodTab>('dashboard');
  const pollNormal = usePollInterval('normal');
  const pollFast = usePollInterval('fast');
  const pollSlow = usePollInterval('slow');

  const { data: dashData, isError, error, refetch: refetchDash } = useQuery({
    queryKey: ['blood-dashboard'],
    queryFn: () => apiClient.get<{ data: BloodDashboard }>('/api/v1/blood-bank/dashboard'),
    refetchInterval: pollNormal,
  });

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['blood-inventory'],
    queryFn: () => apiClient.get<{ data: BloodUnit[] }>('/api/v1/blood-bank/inventory'),
    enabled: tab === 'inventory',
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['transfusion-orders'],
    queryFn: () => apiClient.get<{ data: TransfusionOrder[] }>('/api/v1/blood-bank/orders'),
    enabled: tab === 'orders',
    refetchInterval: pollFast,
  });

  const { data: expiringData } = useQuery({
    queryKey: ['blood-expiring'],
    queryFn: () => apiClient.get<{ data: BloodUnit[] }>('/api/v1/blood-bank/inventory/expiring'),
    refetchInterval: pollSlow,
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetchDash} />;

  const dash: BloodDashboard | null = dashData?.data ? ((dashData.data as unknown as Record<string, unknown>)?.data as BloodDashboard ?? dashData.data) : null;
  const inventory: BloodUnit[] = (() => { const r = invData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as BloodUnit[] ?? []; })();
  const orders: TransfusionOrder[] = (() => { const r = ordersData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as TransfusionOrder[] ?? []; })();
  const expiring: BloodUnit[] = (() => { const r = expiringData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as BloodUnit[] ?? []; })();

  return (
    <div>
      <PageHeader title={tAttr('혈액은행')} />

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'dashboard' as BloodTab, label: '대시보드' },
          { key: 'inventory' as BloodTab, label: '재고 관리' },
          { key: 'orders' as BloodTab, label: '수혈 관리' },
          { key: 'safety' as BloodTab, label: '안전·MTP·발주' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* 대시보드 */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {/* 긴급 알림 */}
          {expiring.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-red-800"><T k="유효기간 임박" /></span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">{expiring.length}단위</span>
              </div>
              <div className="space-y-1">
                {expiring.slice(0, 5).map((p: BloodUnit) => (
                  <div key={p.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/80">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{p.unitNumber}</span>
                      <span className="text-gray-500"><T k={PRODUCT_LABEL[p.productType] ?? p.productType} /></span>
                      <span className="text-gray-500">{bloodTypeText(p.bloodType, p.rhFactor)}</span>
                    </div>
                    <KDate value={p.expiresAt} className="text-red-600 font-medium" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 재고 매트릭스 */}
          {dash?.inventoryMatrix && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="재고 현황" /></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500"><T k="유형" /></th>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bt => (
                      <th key={bt} className="px-2 py-2 text-center text-gray-500 w-[50px]">{bt}</th>
                    ))}
                    <th className="px-3 py-2 text-center text-gray-700 font-bold"><T k="합계" /></th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(dash.inventoryMatrix).map(([type, counts]: [string, Record<string, number>]) => {
                      const total = Object.values(counts as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
                      return (
                        <tr key={type} className="border-b border-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-700"><T k={PRODUCT_LABEL[type] ?? type} /></td>
                          {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bt => (
                            <td key={bt} className={`px-2 py-2 text-center ${(counts[bt] ?? 0) === 0 ? 'text-gray-300' : (counts[bt] ?? 0) <= 3 ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
                              {counts[bt] ?? 0}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center font-bold text-gray-900">{total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 오늘 현황 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard title={tAttr('전체 재고')} value={dash?.totalInventory ?? '-'} color="gray" />
            <StatCard title={tAttr('수혈 오더')} value={dash?.todayOrders ?? '-'} color="blue" />
            <StatCard title={tAttr('교차시험 대기')} value={dash?.pendingCrossmatch ?? '-'} color="amber" />
            <StatCard title={tAttr('유효기간 임박')} value={expiring.length} color="red" />
          </div>
        </div>
      )}

      {/* 재고 관리 */}
      {tab === 'inventory' && (
        <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setShowReceiveModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"><T k="+ 혈액 입고" /></button>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="혈액번호" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="제제" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="혈액형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="용량" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="유효기간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
            </tr></thead>
            <tbody>
              {invLoading ? Array.from({length:5}).map((_,i)=><tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse"/></td></tr>)
              : inventory.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="재고 없음" /></td></tr>
              : inventory.map((p: BloodUnit) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.unitNumber}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 whitespace-nowrap"><T k={PRODUCT_LABEL[p.productType] ?? p.productType} /></span></td>
                  <td className="px-4 py-3 text-xs font-bold text-gray-900">{bloodTypeText(p.bloodType, p.rhFactor)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.volume}mL</td>
                  <td className="px-4 py-3 text-xs text-gray-500"><KDate value={p.expiresAt} /></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[p.status] ?? 'bg-gray-100'}`}><T k={STATUS_LABEL[p.status] ?? p.status} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* 수혈 관리 */}
      {tab === 'orders' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="긴급도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="제제" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[50px]"><T k="단위" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사유" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="출고" /></th>
            </tr></thead>
            <tbody>
              {ordersLoading ? Array.from({length:3}).map((_,i)=><tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse"/></td></tr>)
              : orders.length === 0 ? <tr><td colSpan={7}><EmptyState icon="🩸" title="수혈 오더가 없습니다" /></td></tr>
              : orders.map((o: TransfusionOrder) => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">{o.urgency !== 'ROUTINE' && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${URGENCY_COLOR[o.urgency] ?? ''}`}><T k={o.urgency === 'EMERGENT' ? '응급' : o.urgency === 'URGENT' ? '긴급' : o.urgency} /></span>}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{o.patient?.familyName}{o.patient?.givenName}</p>
                    <p className="text-[10px] text-gray-400">{o.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700"><T k={PRODUCT_LABEL[o.productType] ?? o.productType} /></td>
                  <td className="px-4 py-3 text-xs text-gray-700 font-medium">
                    {o.units}U
                    {/* 출고 진척 — 서버가 주는 transfusions 를 종전엔 버려서 1/2U 진행 상황이 침묵했다(P1-ⓑ) */}
                    {(o.transfusions?.length ?? 0) > 0 && <span className="ml-1 text-[10px] text-rose-600 font-bold"><T k="출고" /> {o.transfusions!.length}/{o.units}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]">{o.indication ?? '-'}</td>
                  <td className="px-4 py-3"><StatusBadge domain="transfusionOrder" status={o.status} className="text-[10px] font-bold whitespace-nowrap" /></td>
                  <td className="px-4 py-3">
                    {['ORDERED', 'CROSSMATCHING', 'READY'].includes(o.status) && (
                      <button onClick={() => setIssueOrder(o)}
                        className="px-2.5 py-1 text-[11px] font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"><T k="출고" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 출고 모달 — 후보 유닛 자동매칭(A-7) */}
      {issueOrder && (
        <IssueUnitModal order={issueOrder} onClose={() => setIssueOrder(null)}
          onIssued={() => { setIssueOrder(null); qc.invalidateQueries({ queryKey: ['transfusion-orders'] }); qc.invalidateQueries({ queryKey: ['blood-inventory'] }); }} />
      )}

      {/* 안전·MTP·발주 (P1~P3 보강) */}
      {tab === 'safety' && <BloodBankEnhancement />}

      {/* 혈액 입고 모달 */}
      {showReceiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowReceiveModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="혈액제제 입고" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="혈액번호 *" /></label>
                <input value={rcvForm.unitNumber} onChange={e => setRcvForm(f => ({ ...f, unitNumber: e.target.value }))} placeholder="K-2026-0522-001" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="제제 유형 *" /></label>
                <select value={rcvForm.productType} onChange={e => setRcvForm(f => ({ ...f, productType: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="PRBC">{tAttr('농축적혈구 (pRBC)')}</option><option value="FFP">{tAttr('신선동결혈장 (FFP)')}</option>
                  <option value="PC">{tAttr('혈소판 (PC)')}</option><option value="CRYO">{tAttr('동결침전 (Cryo)')}</option>
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="혈액형(ABO) *" /></label>
                <select value={rcvForm.bloodType} onChange={e => setRcvForm(f => ({ ...f, bloodType: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  {['A', 'B', 'O', 'AB'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Rh *</label>
                <select value={rcvForm.rhFactor} onChange={e => setRcvForm(f => ({ ...f, rhFactor: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="POS">{tAttr('Rh+ (양성)')}</option><option value="NEG">{tAttr('Rh− (음성)')}</option>
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="용량 (mL)" /></label>
                <input value={rcvForm.volume} onChange={e => setRcvForm(f => ({ ...f, volume: e.target.value }))} type="number" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="채혈일 *" /></label>
                <input value={rcvForm.collectedAt} onChange={e => setRcvForm(f => ({ ...f, collectedAt: e.target.value }))} type="date" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="유효기한 *" /></label>
                <input value={rcvForm.expiresAt} onChange={e => setRcvForm(f => ({ ...f, expiresAt: e.target.value }))} type="date" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="공급처" /></label>
                <input value={rcvForm.supplierName} onChange={e => setRcvForm(f => ({ ...f, supplierName: e.target.value }))} placeholder={tAttr('대한적십자사')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex gap-2">
              {canReceive && <button onClick={() => receiveBlood.mutate({ ...rcvForm, volume: Number(rcvForm.volume) || 320 })} disabled={receiveBlood.isPending || !rcvForm.unitNumber || !rcvForm.expiresAt || !rcvForm.collectedAt}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                <T k={receiveBlood.isPending ? '입고 중...' : '입고 등록'} /></button>}
              <button onClick={() => setShowReceiveModal(false)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 출고 모달 — 후보 유닛 자동매칭(A-7): 오더 요건(ABO/Rh·특수요구) 적합 유닛 추천·교차상태·FEFO ──
interface CandidateUnit {
  id: string; unitNumber: string; bloodType: string; rhFactor: string; volume: number; expiresAt: string;
  irradiated: boolean; leukoreduced: boolean; cmvNegative: boolean; washed: boolean;
  crossmatch: 'NOT_REQUIRED' | 'COMPATIBLE_VALID' | 'NONE' | 'EXPIRED' | 'INCOMPATIBLE';
  readyToIssue: boolean;
}
interface CandidateResponse {
  patientTyping?: { abo: string; rh: string } | null;
  specialReqs?: Record<string, unknown>; total: number; items: CandidateUnit[];
}

const XM_LABEL: Record<string, { label: string; cls: string }> = {
  NOT_REQUIRED: { label: '교차 불요', cls: 'bg-gray-100 text-gray-500' },
  COMPATIBLE_VALID: { label: '교차 적합', cls: 'bg-emerald-100 text-emerald-700' },
  NONE: { label: '교차 미시행', cls: 'bg-amber-100 text-amber-700' },
  EXPIRED: { label: '교차 만료(유효기간 경과)', cls: 'bg-amber-100 text-amber-700' },
  INCOMPATIBLE: { label: '교차 부적합', cls: 'bg-red-100 text-red-700' },
};

function IssueUnitModal({ order, onClose, onIssued }: { order: TransfusionOrder; onClose: () => void; onIssued: () => void }) {
  const tAttr = useTAttr();
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['candidate-units', order.id],
    queryFn: () => apiClient.get<{ data: CandidateResponse }>(`/api/v1/blood-bank/orders/${order.id}/candidate-units`),
  });
  const res: CandidateResponse | undefined = (() => { const r = data?.data as unknown as Record<string, unknown> | undefined; return (r?.items ? r : r?.data) as CandidateResponse | undefined; })();
  const items = res?.items ?? [];
  const reqBadges = Object.entries(res?.specialReqs ?? {}).filter(([, v]) => v === true || v === 'true').map(([k]) => k);

  const issue = async (unit: CandidateUnit, emergency: boolean) => {
    let reason = '';
    if (emergency) {
      reason = window.prompt(tAttr('긴급 출고 사유(필수) — 교차시험·ABO 확정을 우회합니다(비교차 O음성 등)')) ?? '';
      if (!reason.trim()) return;
    }
    setBusy(true);
    try {
      const r = emergency
        ? await apiClient.post<{ data: { warnings?: string[] } }>(`/api/v1/blood-bank/orders/${order.id}/issue-emergency`, { bloodProductId: unit.id, reason: reason.trim() })
        : await apiClient.post<{ data: { warnings?: string[] } }>(`/api/v1/blood-bank/orders/${order.id}/issue`, { bloodProductId: unit.id });
      const warnings = (r.data as { warnings?: string[] })?.warnings ?? [];
      if (warnings.length) toast.warning(`${tAttr('출고 완료(경고 동반)')}: ${warnings.join(' / ')}`);
      else toast.success(`${unit.unitNumber} ${tAttr('출고 완료')}`);
      onIssued();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || tAttr('출고에 실패했습니다.'));
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="font-bold text-gray-900"><T k="혈액 출고 — 적합 유닛 자동매칭" /></h3>
          <p className="text-xs text-gray-500 mt-1">
            {order.patient?.familyName}{order.patient?.givenName} ({order.patient?.mrn}) · <T k={PRODUCT_LABEL[order.productType] ?? order.productType} /> {order.units}U
            {/* 🔴 Rh 는 정본(bloodTypeText)으로 — DB 값은 POS/NEG. 'NEGATIVE' 비교는 영원히 거짓이라 Rh음성 환자가 "+"로 표시됐다 */}
            {res?.patientTyping ? <> · <T k="환자 혈액형" /> {bloodTypeText(res.patientTyping.abo, res.patientTyping.rh)}</> : <> · <T k="혈액형 미확정" /></>}
            {reqBadges.length > 0 && <span className="ml-1 text-violet-600"><T k="특수요구" />: {reqBadges.join('·')}</span>}
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <p className="text-sm text-amber-800 font-medium"><T k="요건에 맞는 가용 유닛이 없습니다" /></p>
            <p className="text-xs text-amber-600 mt-1"><T k="재고 입고·특수제제 속성 확인 또는 혈액원 발주(안전·MTP·발주 탭)를 검토하세요" /></p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(u => (
              <div key={u.id} className={`border rounded-xl p-3 flex items-center justify-between gap-3 ${u.readyToIssue ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-gray-900">{u.unitNumber}</span>
                    <span className="text-xs font-bold text-rose-600">{bloodTypeText(u.bloodType, u.rhFactor)}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${XM_LABEL[u.crossmatch]?.cls ?? ''}`}><T k={XM_LABEL[u.crossmatch]?.label ?? u.crossmatch} /></span>
                    {u.irradiated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700"><T k="방사선조사" /></span>}
                    {u.leukoreduced && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700"><T k="백혈구제거" /></span>}
                    {u.cmvNegative && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700"><T k="CMV음성" /></span>}
                    {u.washed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700"><T k="세척" /></span>}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{u.volume}mL · 만료 <KDate value={u.expiresAt} /> (FEFO)</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => issue(u, false)} disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"><T k="출고" /></button>
                  {!u.readyToIssue && (
                    <button onClick={() => issue(u, true)} disabled={busy} title={tAttr('교차시험 우회 — 사유 필수·감사 기록')}
                      className="px-2 py-1.5 text-[11px] font-medium bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 disabled:opacity-50"><T k="긴급" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} className="w-full py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
      </div>
    </div>
  );
}
