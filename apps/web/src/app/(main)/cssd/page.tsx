'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { escapeHtml } from '@/lib/escape-html';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { QrImage, qrDataUrl } from '@/components/ui/QrImage';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { InstrumentUnitsTab } from './InstrumentUnitsTab';

/* ───── 공통 ───── */
const SET_COLOR: Record<string, string> = {
  DIRTY: 'bg-red-50 text-red-700', WASHING: 'bg-yellow-50 text-yellow-700', STERILIZING: 'bg-orange-50 text-orange-700',
  STERILE: 'bg-emerald-50 text-emerald-700', IN_USE: 'bg-blue-50 text-blue-700', EXPIRED: 'bg-gray-100 text-gray-500',
};
const SET_LABEL: Record<string, string> = { DIRTY: '오염', WASHING: '세척중', STERILIZING: '멸균중', STERILE: '멸균완료', IN_USE: '사용중', EXPIRED: '만료' };
const SET_NEXT: Record<string, { to: string; label: string; cls: string }> = {
  DIRTY: { to: 'WASHING', label: '세척', cls: 'bg-yellow-500' }, WASHING: { to: 'STERILIZING', label: '멸균', cls: 'bg-orange-500' },
  STERILIZING: { to: 'STERILE', label: '완료', cls: 'bg-emerald-600' }, STERILE: { to: 'IN_USE', label: '출고', cls: 'bg-blue-600' },
  IN_USE: { to: 'DIRTY', label: '반납', cls: 'bg-gray-600' },
  // 🔴 서버 전이표는 `EXPIRED → DIRTY` 만 허용한다(cssd.service SET_TRANSITIONS). 종전엔 WASHING 을
  //    보내 만료 세트 10건(전체 16 중)의 '재처리' 버튼이 **구조적으로 100% 실패**했다(2026-08-13 W6).
  EXPIRED: { to: 'DIRTY', label: '재처리(오염 반납)', cls: 'bg-yellow-500' },
};
const PKG_COLOR: Record<string, string> = {
  ASSEMBLING: 'bg-gray-100 text-gray-600', PACKAGED: 'bg-indigo-50 text-indigo-700', IN_LOAD: 'bg-orange-50 text-orange-700',
  STERILE: 'bg-emerald-50 text-emerald-700', IN_USE: 'bg-blue-50 text-blue-700', RETURNED: 'bg-gray-100 text-gray-500',
  EXPIRED: 'bg-red-50 text-red-600', RECALLED: 'bg-red-100 text-red-700',
};
const PKG_LABEL: Record<string, string> = { ASSEMBLING: '조립중', PACKAGED: '포장완료', IN_LOAD: '멸균중', STERILE: '멸균완료', IN_USE: '사용중', RETURNED: '반납', EXPIRED: '만료', RECALLED: '리콜' };
const PACK_LABEL: Record<string, string> = { POUCH: '파우치', WRAP: '랩', CONTAINER: '컨테이너' };

interface Item { name: string; qty: number }
interface Tmpl { id: string; name: string; category?: string; packagingType: string; shelfLifeDays: number; items: Item[]; isActive: boolean }
interface Pkg { id: string; lotNo: string; templateName: string; status: string; packagingType: string; location?: string; sterilizedAt?: string; expiresAt?: string }
interface Load { id: string; loadNo: string; sterilizer: string; program: string; biResult: string; ciResult: string; startedAt?: string; packages: { id: string; lotNo: string; templateName: string; status: string }[] }
interface SetRow { id: string; name: string; status: string; contents: Item[]; location?: string; lastSterilizedAt?: string; expiresAt?: string }

const TABS = [['packages', '패키지'], ['repackage', '재포장'], ['loads', '멸균 로드'], ['compose', '세트 조합'], ['items', '품목·재고'], ['po', '발주'], ['ledger', '입출고 내역'], ['templates', '트레이 마스터'], ['sets', '세트 현황'], ['units', '기구 개체']] as const;
const PO_STATUS: Record<string, { l: string; c: string }> = {
  REQUESTED: { l: '요청', c: 'bg-amber-50 text-amber-700' }, APPROVED: { l: '승인', c: 'bg-blue-50 text-blue-700' },
  RECEIVED: { l: '입고완료', c: 'bg-emerald-50 text-emerald-700' }, CANCELLED: { l: '취소', c: 'bg-gray-100 text-gray-400' },
};
type TabKey = typeof TABS[number][0];
interface ItemRow { id: string; code: string; name: string; category?: string; spec?: string; unit: string; stock: number; safetyStock: number; location?: string; supplier?: { name: string } | null }
interface LedgerRow { id: string; type: string; qty: number; balanceAfter: number; reason?: string; ref?: string; createdAt: string; code?: string; name?: string; unit?: string }

export default function CssdPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('packages');

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="중앙공급실 (CSSD)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="재포장 · 멸균 패키지(LOT) 추적 · 멸균 로드 관리" /></p>
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === k ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}><T k={l} /></button>
        ))}
      </div>
      {tab === 'packages' && <PackagesTab qc={qc} />}
      {tab === 'repackage' && <RepackageTab qc={qc} />}
      {tab === 'loads' && <LoadsTab qc={qc} />}
      {tab === 'compose' && <ComposeTab qc={qc} />}
      {tab === 'items' && <ItemsTab qc={qc} />}
      {tab === 'po' && <PoTab qc={qc} />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'sets' && <SetsTab qc={qc} />}
      {tab === 'units' && <InstrumentUnitsTab qc={qc} />}
    </div>
  );
}

/* ───── 패키지 ───── */
function PackagesTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const [filter, setFilter] = useState('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: statsD } = useQuery({ queryKey: ['cssd-pkg-stats'], queryFn: () => apiClient.get<{ data: { total: number; byStatus: Record<string, number>; expiringSoon: number; expired: number; pendingLoads: number } }>('/api/v1/cssd/package-stats'), refetchInterval: pollMs('normal') });
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['cssd-pkgs'], queryFn: () => apiClient.get<{ data: Pkg[] }>('/api/v1/cssd/packages'), refetchInterval: pollMs('normal') });
  const { data: detailD } = useQuery({ queryKey: ['cssd-pkg', detailId], queryFn: () => apiClient.get<{ data: Pkg & { events: { id: string; action: string; note?: string; createdAt: string }[] } }>(`/api/v1/cssd/packages/${detailId}`), enabled: !!detailId });
  const act = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: string; note?: string }) => apiClient.post(`/api/v1/cssd/packages/${id}/${action}`, note ? { note } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cssd-pkgs'] }); qc.invalidateQueries({ queryKey: ['cssd-pkg-stats'] }); toast.success(tAttr('처리되었습니다.')); },
    onError: () => toast.error(tAttr('실패했습니다.')),
  });
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  const stats = statsD?.data;
  const pkgs: Pkg[] = Array.isArray(data?.data) ? data!.data : [];
  const filtered = filter === 'ALL' ? pkgs : pkgs.filter(p => p.status === filter);
  const detail = detailD?.data;
  const dleft = (e?: string) => e ? Math.ceil((new Date(e).getTime() - Date.now()) / 86400000) : null;

  return (
    <div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
        <Kpi label="전체" v={stats?.total ?? pkgs.length} active={filter === 'ALL'} onClick={() => setFilter('ALL')} />
        {['PACKAGED', 'IN_LOAD', 'STERILE', 'IN_USE', 'EXPIRED'].map(s => <Kpi key={s} label={tAttr(PKG_LABEL[s])} v={stats?.byStatus?.[s] ?? 0} active={filter === s} onClick={() => setFilter(s)} />)}
      </div>
      {((stats?.expiringSoon ?? 0) + (stats?.expired ?? 0) + (stats?.pendingLoads ?? 0)) > 0 && (
        <div className="flex gap-2 mb-4 text-xs">
          {!!stats?.expiringSoon && <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 font-semibold">⏰ 만료임박 {stats.expiringSoon}</span>}
          {!!stats?.expired && <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-700 font-semibold">⚠ 만료 {stats.expired}</span>}
          {!!stats?.pendingLoads && <span className="px-3 py-1.5 rounded-full bg-orange-100 text-orange-700 font-semibold">🧪 판독대기 로드 {stats.pendingLoads}</span>}
        </div>
      )}
      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2.5">LOT</th><th className="text-left px-4 py-2.5"><T k="세트" /></th><th className="px-4 py-2.5"><T k="포장" /></th><th className="text-left px-4 py-2.5"><T k="위치" /></th><th className="text-left px-4 py-2.5"><T k="유효기한" /></th><th className="px-4 py-2.5"><T k="상태" /></th><th className="px-4 py-2.5"><T k="처리" /></th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? <tr><td colSpan={7} className="px-4 py-6"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
            : !filtered.length ? <tr><td colSpan={7} className="py-12 text-center text-sm text-gray-400"><T k="패키지가 없습니다" /></td></tr>
            : filtered.map(p => {
              const dl = dleft(p.expiresAt);
              return (
                <tr key={p.id} className="hover:bg-blue-50/30">
                  <td className="px-4 py-3"><button onClick={() => setDetailId(p.id)} className="font-mono text-xs text-blue-600 hover:underline">{p.lotNo}</button></td>
                  <td className="px-4 py-3 font-medium text-gray-800">{p.templateName}</td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500"><T k={PACK_LABEL[p.packagingType] ?? p.packagingType} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.location ?? '-'}</td>
                  <td className="px-4 py-3 text-xs">{p.expiresAt ? <span className={dl != null && dl <= 3 ? 'text-red-600 font-semibold' : 'text-gray-500'}>{kdate(new Date(p.expiresAt))}{dl != null && (dl < 0 ? ` (${tAttr('만료')})` : dl <= 3 ? ` (D-${dl})` : '')}</span> : '-'}</td>
                  <td className="px-4 py-3 text-center"><span className={`text-[11px] px-2 py-0.5 rounded-full ${PKG_COLOR[p.status]}`}><T k={PKG_LABEL[p.status] ?? p.status} /></span></td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      {p.status === 'STERILE' && <button onClick={() => act.mutate({ id: p.id, action: 'use' })} className="min-h-[44px] px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded"><T k="출고" /></button>}
                      {p.status === 'IN_USE' && <button onClick={() => act.mutate({ id: p.id, action: 'return' })} className="min-h-[44px] px-3 py-2 text-xs font-medium text-white bg-gray-600 rounded"><T k="반납" /></button>}
                      {['STERILE', 'IN_USE', 'IN_LOAD'].includes(p.status) && <button onClick={() => { if (confirm(tAttr('리콜 처리하시겠습니까?'))) act.mutate({ id: p.id, action: 'recall' }); }} className="min-h-[44px] px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded"><T k="리콜" /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && (
        <Modal onClose={() => setDetailId(null)} title={detail.lotNo} sub={`${detail.templateName} · ${tAttr(PKG_LABEL[detail.status])}`}>
          <h4 className="text-sm font-semibold text-gray-700 mb-2"><T k="추적 이력" /></h4>
          <div className="space-y-2">
            {(detail.events ?? []).map(e => (
              <div key={e.id} className="flex items-center gap-3 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /><span className="font-medium text-gray-800">{e.action}</span>
                {e.note && <span className="text-xs text-gray-400">{e.note}</span>}
                <span className="text-xs text-gray-400 ml-auto">{kdate(e.createdAt, 'datetimeShort')}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ───── 재포장 ───── */
function RepackageTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const { data } = useQuery({ queryKey: ['cssd-templates'], queryFn: () => apiClient.get<{ data: Tmpl[] }>('/api/v1/cssd/templates') });
  const [sel, setSel] = useState<Tmpl | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  // 기구 개체 번호(선택) — 한 줄/쉼표 구분. 수명 한도 도달은 막지 않고 경고로 돌려받는다(서버 판정)
  const [serials, setSerials] = useState('');
  const [unitWarnings, setUnitWarnings] = useState<{ serialNo: string; code: string; sterilizedCycles?: number; limit?: number; otherLots?: string[] }[]>([]);
  const serialList = serials.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const templates: Tmpl[] = Array.isArray(data?.data) ? data!.data : [];
  const allChecked = sel ? (sel.items ?? []).every((_, i) => checked[i]) : false;
  const mut = useMutation({
    mutationFn: () => apiClient.post<{ data: { lotNo: string; unitWarnings?: typeof unitWarnings } }>('/api/v1/cssd/repackage', { templateId: sel!.id, countVerified: true, countNote: note || undefined, ...(serialList.length ? { unitSerials: serialList } : {}) }),
    onSuccess: (r) => { const d = (r as { data: { lotNo: string; unitWarnings?: typeof unitWarnings } }).data; toast.success(`${tAttr('패키지 생성')}: ${d.lotNo}`); setUnitWarnings(d.unitWarnings ?? []); setSel(null); setChecked({}); setNote(''); setSerials(''); qc.invalidateQueries({ queryKey: ['cssd-pkgs'] }); qc.invalidateQueries({ queryKey: ['cssd-pkg-stats'] }); qc.invalidateQueries({ queryKey: ['cssd-units'] }); },
    onError: () => toast.error(tAttr('재포장에 실패했습니다.')),
  });
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {unitWarnings.length > 0 && (
        <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold"><T k="포장은 완료됐지만 확인이 필요한 기구 개체가 있습니다(막지 않았습니다)." /></p>
          {unitWarnings.map((w, i) => (
            <p key={`${w.serialNo}-${i}`} className="font-mono">
              {w.code === 'LIFE_LIMIT_REACHED'
                ? <Tf k="{개체}: 수명 한도 도달(멸균 합격 {합격}/{한도})" params={{ 개체: w.serialNo, 합격: w.sterilizedCycles, 한도: w.limit }} />
                : <Tf k="{개체}: 아직 닫히지 않은 다른 패키지에 들어 있음({LOT})" params={{ 개체: w.serialNo, LOT: (w.otherLots ?? []).join(', ') }} />}
            </p>
          ))}
        </div>
      )}
      <div className="bg-white rounded-2xl border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="트레이 선택" /></h3>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {templates.map(t => (
            <button key={t.id} onClick={() => { setSel(t); setChecked({}); }} className={`w-full text-left px-3 py-2.5 rounded-xl border ${sel?.id === t.id ? 'border-blue-400 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}>
              <div className="flex justify-between"><span className="font-medium text-gray-800 text-sm">{t.name}</span><span className="text-[10px] text-gray-400"><T k={PACK_LABEL[t.packagingType]} /> · {t.shelfLifeDays}<Unit><T k="일" /></Unit></span></div>
              <span className="text-xs text-gray-400">{t.category} · 구성품 {(t.items ?? []).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border p-4">
        {!sel ? <div className="h-full flex items-center justify-center text-sm text-gray-400"><T k="트레이를 선택하세요" /></div> : (
          <>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">{sel.name} — 구성품 카운트</h3>
            <p className="text-xs text-gray-400 mb-3"><T k="모든 구성품을 확인하면 포장(LOT 발행)됩니다." /></p>
            <div className="space-y-1.5 mb-4 max-h-[40vh] overflow-y-auto">
              {(sel.items ?? []).map((it, i) => (
                <label key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${checked[i] ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked(p => ({ ...p, [i]: e.target.checked }))} className="accent-emerald-600" />
                  <span className="text-sm text-gray-700 flex-1">{it.name}</span><span className="text-xs text-gray-400">×{it.qty}</span>
                </label>
              ))}
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={tAttr('누락/대체 메모 (선택)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-3 outline-none focus:ring-2 focus:ring-blue-100" />
            <textarea value={serials} onChange={e => setSerials(e.target.value)} rows={2} placeholder={tAttr('기구 개체 번호 (선택 · 줄바꿈 또는 쉼표로 구분)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-3 font-mono outline-none focus:ring-2 focus:ring-blue-100" />
            <button onClick={() => mut.mutate()} disabled={!allChecked || mut.isPending} className="w-full py-3 rounded-xl text-white font-semibold bg-blue-600 disabled:opacity-40">
              {allChecked ? tAttr('포장 · LOT 발행') : `${(sel.items ?? []).length - Object.values(checked).filter(Boolean).length}${tAttr('개 미확인')}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ───── 멸균 로드 ───── */
function LoadsTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const { data: pkgD } = useQuery({ queryKey: ['cssd-pkgs-packaged'], queryFn: () => apiClient.get<{ data: Pkg[] }>('/api/v1/cssd/packages?status=PACKAGED') });
  const { data: loadD } = useQuery({ queryKey: ['cssd-loads'], queryFn: () => apiClient.get<{ data: Load[] }>('/api/v1/cssd/loads'), refetchInterval: pollMs('normal') });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [sterilizer, setSterilizer] = useState('STERIS V-PRO 1');
  const packaged: Pkg[] = Array.isArray(pkgD?.data) ? pkgD!.data : [];
  const loads: Load[] = Array.isArray(loadD?.data) ? loadD!.data : [];
  const pickedIds = Object.keys(picked).filter(k => picked[k]);
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/cssd/loads', { sterilizer, program: 'STEAM', packageIds: pickedIds }),
    onSuccess: () => { toast.success(tAttr('멸균 로드가 생성되었습니다.')); setPicked({}); qc.invalidateQueries({ queryKey: ['cssd-loads'] }); qc.invalidateQueries({ queryKey: ['cssd-pkgs-packaged'] }); qc.invalidateQueries({ queryKey: ['cssd-pkgs'] }); },
    onError: () => toast.error(tAttr('로드 생성 실패')),
  });
  const release = useMutation({
    mutationFn: ({ id, pass }: { id: string; pass: boolean }) => apiClient.post(`/api/v1/cssd/loads/${id}/release`, { biResult: pass ? 'PASS' : 'FAIL', ciResult: pass ? 'PASS' : 'FAIL' }),
    onSuccess: (_r, v) => { toast.success(v.pass ? tAttr('판독 합격 — 패키지 멸균완료') : tAttr('판독 실패 — 패키지 회수')); qc.invalidateQueries({ queryKey: ['cssd-loads'] }); qc.invalidateQueries({ queryKey: ['cssd-pkgs'] }); qc.invalidateQueries({ queryKey: ['cssd-pkg-stats'] }); },
    onError: () => toast.error(tAttr('판독 처리 실패')),
  });
  const RES: Record<string, string> = { PASS: 'text-emerald-600', FAIL: 'text-red-600', PENDING: 'text-amber-600' };
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="새 멸균 로드 — 포장완료 패키지 투입" /></h3>
        {!packaged.length ? <p className="text-sm text-gray-400"><T k="투입 가능한 포장완료 패키지가 없습니다." /></p> : (
          <>
            <div className="grid sm:grid-cols-2 gap-2 mb-3 max-h-52 overflow-y-auto">
              {packaged.map(p => (
                <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border ${picked[p.id] ? 'border-blue-400 bg-blue-50' : 'border-gray-100'}`}>
                  <input type="checkbox" checked={!!picked[p.id]} onChange={e => setPicked(s => ({ ...s, [p.id]: e.target.checked }))} className="accent-blue-600" />
                  <span className="text-sm text-gray-700 flex-1">{p.templateName}</span><span className="font-mono text-[10px] text-gray-400">{p.lotNo}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <select value={sterilizer} onChange={e => setSterilizer(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2">
                <option>STERIS V-PRO 1</option><option>3M Steam 600</option><option><T k="EO 멸균기 A" /></option>
              </select>
              <button onClick={() => create.mutate()} disabled={!pickedIds.length || create.isPending} className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg disabled:opacity-40">로드 생성 ({pickedIds.length})</button>
            </div>
          </>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="멸균 로드 이력 / BI·CI 판독" /></h3>
        <div className="space-y-3">
          {loads.map(l => {
            const pending = l.biResult === 'PENDING' || l.ciResult === 'PENDING';
            return (
              <div key={l.id} className="bg-white rounded-2xl border p-4">
                <div className="flex items-center justify-between mb-2">
                  <div><span className="font-mono text-sm font-semibold text-gray-800">{l.loadNo}</span> <span className="text-xs text-gray-400">{l.sterilizer} · {l.program}</span></div>
                  <div className="text-xs">BI <span className={RES[l.biResult]}>{l.biResult}</span> · CI <span className={RES[l.ciResult]}>{l.ciResult}</span></div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {l.packages.map(p => <span key={p.id} className={`text-[10px] px-2 py-0.5 rounded-full ${PKG_COLOR[p.status]}`}>{p.templateName}</span>)}
                </div>
                {pending && (
                  <div className="flex gap-2">
                    <button onClick={() => release.mutate({ id: l.id, pass: true })} className="min-h-[48px] px-3 py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg"><T k="판독 합격 → 멸균완료" /></button>
                    <button onClick={() => { if (confirm(tAttr('실패 처리 시 패키지가 회수(재처리)됩니다.'))) release.mutate({ id: l.id, pass: false }); }} className="min-h-[48px] px-3 py-3 text-sm font-semibold bg-red-600 text-white rounded-lg"><T k="판독 실패 → 회수" /></button>
                  </div>
                )}
              </div>
            );
          })}
          {!loads.length && <p className="text-sm text-gray-400"><T k="멸균 로드가 없습니다." /></p>}
        </div>
      </div>
    </div>
  );
}

/* ───── 트레이 마스터 ───── */
function TemplatesTab() {
  const tAttr = useTAttr();
  const { data } = useQuery({ queryKey: ['cssd-templates'], queryFn: () => apiClient.get<{ data: Tmpl[] }>('/api/v1/cssd/templates') });
  const templates: Tmpl[] = Array.isArray(data?.data) ? data!.data : [];
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
      {templates.map(t => (
        <div key={t.id} className="bg-white rounded-2xl border p-4">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-semibold text-gray-900">{t.name}</h4>
            <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"><T k={PACK_LABEL[t.packagingType]} /></span>
          </div>
          <p className="text-xs text-gray-400 mb-2">{t.category} · 유효 {t.shelfLifeDays}<Unit><T k="일" /></Unit> · 구성품 {(t.items ?? []).length}</p>
          <div className="flex flex-wrap gap-1">
            {(t.items ?? []).slice(0, 6).map((it, i) => <span key={i} className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded">{it.name}×{it.qty}</span>)}
          </div>
        </div>
      ))}
      {!templates.length && <p className="text-sm text-gray-400"><T k="트레이 마스터가 없습니다." /></p>}
    </div>
  );
}

/* ───── 세트 현황(기존) ───── */
function SetsTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['cssd-sets'], queryFn: () => apiClient.get<{ data: SetRow[] }>('/api/v1/cssd/sets'), refetchInterval: pollMs('normal') });
  const mut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/cssd/sets/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cssd-sets'] }); toast.success(tAttr('상태 변경')); }, onError: () => toast.error(tAttr('실패')),
  });
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  const sets: SetRow[] = Array.isArray(data?.data) ? data!.data : [];
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2.5"><T k="세트명" /></th><th className="text-left px-4 py-2.5"><T k="위치" /></th><th className="px-4 py-2.5"><T k="구성품" /></th><th className="text-left px-4 py-2.5"><T k="유효기한" /></th><th className="px-4 py-2.5"><T k="상태" /></th><th className="px-4 py-2.5"><T k="처리" /></th></tr></thead>
        <tbody className="divide-y divide-gray-50">
          {isLoading ? <tr><td colSpan={6} className="px-4 py-6"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
          : sets.map(s => { const n = SET_NEXT[s.status]; return (
            <tr key={s.id} className="hover:bg-blue-50/30">
              <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{s.location ?? '-'}</td>
              <td className="px-4 py-3 text-center text-gray-600">{Array.isArray(s.contents) ? s.contents.length : '-'}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{s.expiresAt ? kdate(s.expiresAt) : '-'}</td>
              <td className="px-4 py-3 text-center"><span className={`text-[11px] px-2 py-0.5 rounded-full ${SET_COLOR[s.status]}`}><T k={SET_LABEL[s.status] ?? s.status} /></span></td>
              <td className="px-4 py-3 text-center">{n && <button onClick={() => mut.mutate({ id: s.id, status: n.to })} className={`min-h-[44px] px-3 py-2 text-xs font-medium text-white rounded-lg ${n.cls}`}><T k={n.label} /></button>}</td>
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

/* ───── 품목·재고 ───── */
function ItemsTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [cat, setCat] = useState('ALL');
  const [loc, setLoc] = useState('ALL');
  const [groupByLoc, setGroupByLoc] = useState(false);
  const [supplyFor, setSupplyFor] = useState<ItemRow | null>(null);
  const [labelFor, setLabelFor] = useState<ItemRow | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [scan, setScan] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['cssd-items', lowOnly], queryFn: () => apiClient.get<{ data: ItemRow[] }>(`/api/v1/cssd/items${lowOnly ? '?lowStock=true' : ''}`), refetchInterval: pollMs('normal') });
  const { data: statsD } = useQuery({ queryKey: ['cssd-inv-stats'], queryFn: () => apiClient.get<{ data: { totalItems: number; lowStockCount: number } }>('/api/v1/cssd/inventory/stats'), refetchInterval: pollMs('normal') });
  const all: ItemRow[] = Array.isArray(data?.data) ? data!.data : [];
  const cats = ['ALL', ...Array.from(new Set(all.map(i => i.category).filter(Boolean) as string[]))];
  const locs = ['ALL', ...Array.from(new Set(all.map(i => (i.location ?? '').split(' ')[0]).filter(Boolean)))];
  const items = all.filter(i =>
    (!q || i.name.includes(q) || i.code.includes(q)) &&
    (cat === 'ALL' || i.category === cat) &&
    (loc === 'ALL' || (i.location ?? '').startsWith(loc))
  );
  const stats = statsD?.data;
  const grouped = groupByLoc ? items.reduce((a, it) => { const k = it.location ?? tAttr('미지정'); (a[k] = a[k] || []).push(it); return a; }, {} as Record<string, ItemRow[]>) : null;

  const Row = (it: ItemRow) => {
    const low = it.stock <= it.safetyStock;
    return (
      <tr key={it.id} className="hover:bg-blue-50/30">
        <td className="px-4 py-3 font-mono text-xs text-gray-500">{it.code}</td>
        <td className="px-4 py-3 font-medium text-gray-800">{it.name}<span className="text-xs text-gray-400 ml-1">{it.spec}</span></td>
        <td className="px-4 py-3 text-center text-xs text-gray-500">{it.category ?? '-'}</td>
        <td className="px-4 py-3 text-center"><span className={low ? 'text-red-600 font-bold' : 'text-gray-800 font-medium'}>{it.stock}</span><span className="text-gray-400 text-xs"> / {it.safetyStock}{it.unit}</span>{low && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full"><T k="부족" /></span>}</td>
        <td className="px-4 py-3 text-xs text-gray-500">{it.location ?? '-'}</td>
        <td className="px-4 py-3 text-xs text-gray-500">{it.supplier?.name ?? '-'}</td>
        <td className="px-4 py-3 text-center">
          <div className="flex gap-1 justify-center">
            <button onClick={() => setSupplyFor(it)} className="text-[11px] px-2.5 py-1 bg-emerald-600 text-white rounded-lg"><T k="입고/조정" /></button>
            <button onClick={() => setLabelFor(it)} title={tAttr('QR 라벨')} className="text-[11px] px-2 py-1 border border-gray-200 text-gray-600 rounded-lg">🏷</button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tAttr('품목명·코드 검색')} className="px-3 py-2 text-sm border border-gray-200 rounded-xl w-48 outline-none focus:ring-2 focus:ring-blue-100" />
        <select value={cat} onChange={e => setCat(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2">{cats.map(c => <option key={c} value={c}>{c === 'ALL' ? tAttr('전체 분류') : c}</option>)}</select>
        <select value={loc} onChange={e => setLoc(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2">{locs.map(l => <option key={l} value={l}>{l === 'ALL' ? tAttr('전체 위치') : l}</option>)}</select>
        <button onClick={() => setGroupByLoc(v => !v)} className={`text-xs px-3 py-2 rounded-lg border ${groupByLoc ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white text-gray-500'}`}><T k="위치별 보기" /></button>
        <button onClick={() => setLowOnly(v => !v)} className={`text-xs px-3 py-2 rounded-lg border ${lowOnly ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white text-gray-500'}`}>안전재고 미달{stats?.lowStockCount ? ` (${stats.lowStockCount})` : ''}</button>
        <span className="text-xs text-gray-400 ml-auto">{items.length}/{stats?.totalItems ?? all.length} 품목</span>
        <button onClick={() => setScan(true)} className="text-sm px-3 py-2 bg-gray-800 text-white rounded-lg"><T k="📷 스캔" /></button>
        <button onClick={() => setShowNew(true)} className="text-sm px-3 py-2 bg-blue-600 text-white rounded-lg"><T k="+ 품목" /></button>
      </div>

      {groupByLoc && grouped ? (
        <div className="space-y-4">
          {Object.entries(grouped).sort().map(([location, list]) => (
            <div key={location} className="bg-white rounded-2xl border overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 text-sm font-semibold text-gray-700">📍 {location} <span className="text-xs text-gray-400">({list.length})</span></div>
              <table className="w-full text-sm"><tbody className="divide-y divide-gray-50">{list.map(Row)}</tbody></table>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2.5"><T k="코드" /></th><th className="text-left px-4 py-2.5"><T k="품목" /></th><th className="px-4 py-2.5"><T k="분류" /></th><th className="px-4 py-2.5"><T k="재고/안전" /></th><th className="text-left px-4 py-2.5"><T k="위치" /></th><th className="text-left px-4 py-2.5"><T k="공급사" /></th><th className="px-4 py-2.5"><T k="작업" /></th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <tr><td colSpan={7} className="px-4 py-6"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
              : !items.length ? <tr><td colSpan={7} className="py-12 text-center text-sm text-gray-400"><T k="품목이 없습니다" /></td></tr>
              : items.map(Row)}
            </tbody>
          </table>
        </div>
      )}
      {supplyFor && <SupplyModal item={supplyFor} onClose={() => setSupplyFor(null)} qc={qc} />}
      {labelFor && <LabelModal item={labelFor} onClose={() => setLabelFor(null)} />}
      {showNew && <NewItemModal onClose={() => setShowNew(false)} qc={qc} />}
      {scan && <ScanModal onClose={() => setScan(false)} onFound={(it) => { setScan(false); setSupplyFor(it); }} />}
    </div>
  );
}

/* QR 라벨 출력 */
function LabelModal({ item, onClose }: { item: ItemRow; onClose: () => void }) {
  const tAttr = useTAttr();
  // 🔴 외부 QR API 의존 봉합 — 로컬 생성(폐쇄망에서 라벨 QR 이 빈칸으로 인쇄되던 것도 함께 해소).
  return (
    <Modal title={tAttr('QR 라벨')} sub={item.code} onClose={onClose}>
      <div id="cssd-label" className="border-2 border-dashed border-gray-300 rounded-xl p-5 text-center mx-auto" style={{ width: 260 }}>
        <QrImage value={item.code} size={140} alt="QR" className="mx-auto" />
        <div className="font-mono text-sm font-bold mt-2">{item.code}</div>
        <div className="text-sm text-gray-800">{item.name}</div>
        <div className="text-xs text-gray-500">{item.spec} · {item.location}</div>
      </div>
      <button onClick={() => { void (async () => { const w = window.open('', '', 'width=400,height=400'); const qrUrl = await qrDataUrl(item.code, 200, 1); if (w && qrUrl) { w.document.write(`<div style="text-align:center;font-family:sans-serif;padding:20px"><img src="${escapeHtml(qrUrl)}" width="160"/><div style="font-family:monospace;font-weight:bold;margin-top:8px">${escapeHtml(item.code ?? '')}</div><div>${escapeHtml(item.name ?? '')}</div><div style="font-size:12px;color:#666">${escapeHtml(item.spec ?? '')} · ${escapeHtml(item.location ?? '')}</div></div>`); w.document.close(); w.focus(); w.print(); } else if (w) { w.document.write('<div style="font-family:sans-serif;padding:20px;color:#dc2626"><T k="QR 생성 실패 — 라벨을 인쇄하지 마세요." /></div>'); w.document.close(); } })(); }}
        className="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold"><T k="🖨 라벨 인쇄" /></button>
    </Modal>
  );
}

/* 바코드/QR 스캔 (키보드 웨지 스캐너) */
function ScanModal({ onClose, onFound }: { onClose: () => void; onFound: (it: ItemRow) => void }) {
  const tAttr = useTAttr();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const lookup = async (c: string) => {
    const v = c.trim(); if (!v) return;
    try { const r = await apiClient.get<{ data: ItemRow }>(`/api/v1/cssd/items/by-code/${encodeURIComponent(v)}`); onFound(r.data); }
    catch { setErr(`'${v}' ${tAttr('품목을 찾을 수 없습니다')}`); setCode(''); }
  };
  return (
    <Modal title={tAttr('바코드 / QR 스캔')} sub={tAttr('스캐너로 코드를 읽거나 직접 입력 후 Enter')} onClose={onClose}>
      <div className="text-center py-4">
        <div className="text-5xl mb-3">📷</div>
        <input autoFocus value={code} onChange={e => { setCode(e.target.value); setErr(''); }} onKeyDown={e => e.key === 'Enter' && lookup(code)}
          placeholder="INS-0001" className="w-full px-4 py-3 text-center font-mono text-lg border-2 border-gray-200 rounded-xl outline-none focus:border-blue-400" />
        {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
        <p className="text-xs text-gray-400 mt-3"><T k="USB/블루투스 바코드 스캐너는 키보드처럼 입력됩니다. 스캔 시 자동 조회됩니다." /></p>
        <button onClick={() => lookup(code)} className="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold"><T k="조회" /></button>
      </div>
    </Modal>
  );
}

/* 발주(PO) */
interface PoLine { id: string; itemId: string; itemName: string; qty: number; receivedQty: number; unitPrice?: number }
interface Po { id: string; poNo: string; status: string; note?: string; totalAmount: number; createdAt: string; lines: PoLine[] }
interface Reorder { id: string; code: string; name: string; stock: number; safetyStock: number; unit: string; unitPrice?: number; suggestQty: number; shortage: number }

function PoTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const [statusF, setStatusF] = useState('ALL');
  const [cart, setCart] = useState<Record<string, number>>({});
  const { data: pos } = useQuery({ queryKey: ['cssd-po', statusF], queryFn: () => apiClient.get<Po[]>(`/api/v1/cssd/po?status=${statusF}`) });
  const { data: reorder } = useQuery({ queryKey: ['cssd-reorder'], queryFn: () => apiClient.get<Reorder[]>('/api/v1/cssd/po/reorder-suggestions') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cssd-po'] }); qc.invalidateQueries({ queryKey: ['cssd-reorder'] }); qc.invalidateQueries({ queryKey: ['cssd-items'] }); };

  const createPo = useMutation({
    mutationFn: (lines: { itemId: string; qty: number; unitPrice?: number }[]) => apiClient.post('/api/v1/cssd/po', { lines }),
    onSuccess: () => { toast.success(tAttr('발주가 생성되었습니다.')); setCart({}); refresh(); },
    onError: () => toast.error(tAttr('발주 생성 실패')),
  });
  const approve = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/cssd/po/${id}/approve`, {}), onSuccess: () => { toast.success(tAttr('승인 → ERP 통보')); refresh(); }, onError: () => toast.error(tAttr('승인 실패')) });
  const receive = useMutation({
    mutationFn: (po: Po) => apiClient.post(`/api/v1/cssd/po/${po.id}/receive`, { receipts: po.lines.filter(l => l.receivedQty < l.qty).map(l => ({ lineId: l.id, qty: l.qty - l.receivedQty })) }),
    onSuccess: () => { toast.success(tAttr('전량 입고 처리')); refresh(); }, onError: () => toast.error(tAttr('입고 실패')),
  });
  const cancel = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/cssd/po/${id}/cancel`, {}), onSuccess: () => { toast.success(tAttr('발주 취소')); refresh(); } });

  const cartLines = Object.entries(cart).filter(([, q]) => q > 0);
  const submitCart = () => {
    const sugg = reorder ?? [];
    createPo.mutate(cartLines.map(([itemId, qty]) => ({ itemId, qty, unitPrice: sugg.find(r => r.id === itemId)?.unitPrice })));
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {/* 재주문 제안 → 장바구니 */}
      <div className="lg:col-span-2 bg-white rounded-xl border p-4">
        <h3 className="font-bold text-gray-800 mb-2"><T k="재주문 제안" /> <span className="text-xs font-normal text-gray-400"><T k="(안전재고 이하)" /></span></h3>
        {!reorder?.length && <p className="text-sm text-gray-400 py-6 text-center"><T k="재주문 필요 품목 없음 ✅" /></p>}
        <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
          {(reorder ?? []).map(r => (
            <div key={r.id} className="flex items-center gap-2 text-sm border-b border-gray-50 pb-1.5">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-800 truncate">{r.name}</div>
                <div className="text-[11px] text-red-500">재고 {r.stock}/{r.safetyStock} · 부족 {r.shortage}{r.unit}</div>
              </div>
              <input type="number" min={0} value={cart[r.id] ?? r.suggestQty} onChange={e => setCart(c => ({ ...c, [r.id]: Number(e.target.value) }))} className="w-16 border rounded px-2 py-1 text-right" />
            </div>
          ))}
        </div>
        {cartLines.length > 0 && (
          <button onClick={submitCart} disabled={createPo.isPending} className="mt-3 w-full min-h-[44px] px-3 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{cartLines.length}<Unit><T k="개" /></Unit> <T k="품목 발주 생성" /></button>
        )}
      </div>

      {/* 발주 목록 */}
      <div className="lg:col-span-3 bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-800"><T k="발주 목록" /></h3>
          <select value={statusF} onChange={e => setStatusF(e.target.value)} className="border rounded-lg px-2 py-1 text-sm">
            <option value="ALL"><T k="전체" /></option><option value="REQUESTED"><T k="요청" /></option><option value="APPROVED"><T k="승인" /></option><option value="RECEIVED"><T k="입고완료" /></option><option value="CANCELLED"><T k="취소" /></option>
          </select>
        </div>
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {!pos?.length && <p className="text-sm text-gray-400 py-6 text-center"><T k="발주 없음" /></p>}
          {(pos ?? []).map(po => {
            const st = PO_STATUS[po.status] ?? { l: po.status, c: 'bg-gray-100' };
            return (
              <div key={po.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800 text-sm">{po.poNo} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${st.c}`}><T k={st.l} /></span></span>
                  <span className="text-xs text-gray-500">{po.totalAmount > 0 ? po.totalAmount.toLocaleString() + tAttr('원') : ''}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">{po.lines.map(l => `${l.itemName} ${l.receivedQty}/${l.qty}`).join(' · ')}</div>
                <div className="flex gap-1.5 mt-2">
                  {po.status === 'REQUESTED' && <button onClick={() => approve.mutate(po.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded"><T k="승인" /></button>}
                  {po.status === 'APPROVED' && <button onClick={() => receive.mutate(po)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded"><T k="전량 입고" /></button>}
                  {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && <button onClick={() => cancel.mutate(po.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-gray-100 text-gray-500 rounded"><T k="취소" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* 입출고 내역(원장) */
function LedgerTab() {
  const tAttr = useTAttr();
  const [type, setType] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (type !== 'ALL') params.set('type', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q) params.set('q', q);
  const { data, isLoading } = useQuery({ queryKey: ['cssd-ledger', type, from, to, q], queryFn: () => apiClient.get<{ data: LedgerRow[] }>(`/api/v1/cssd/transactions?${params}`) });
  const rows: LedgerRow[] = Array.isArray(data?.data) ? data!.data : [];
  const TX_UI: Record<string, { l: string; c: string }> = { IN: { l: '입고', c: 'bg-emerald-50 text-emerald-700' }, OUT: { l: '소모', c: 'bg-blue-50 text-blue-700' }, ADJUST: { l: '조정', c: 'bg-amber-50 text-amber-700' }, RETURN: { l: '반품', c: 'bg-violet-50 text-violet-700' } };
  // 날짜별 그룹
  const byDate = rows.reduce((a, r) => { const d = kdate(r.createdAt); (a[d] = a[d] || []).push(r); return a; }, {} as Record<string, LedgerRow[]>);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {[['ALL', '전체'], ['IN', '입고'], ['OUT', '소모'], ['ADJUST', '조정'], ['RETURN', '반품']].map(([v, l]) => (
            <button key={v} onClick={() => setType(v)} className={`text-xs px-3 py-2 rounded-lg ${type === v ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600'}`}><T k={l} /></button>
          ))}
        </div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tAttr('품목 검색')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-40" />
        <span className="text-xs text-gray-400 ml-auto">{rows.length}<Unit><T k="건" /></Unit></span>
      </div>
      {isLoading ? <div className="text-center py-12 text-sm text-gray-400"><T k="불러오는 중…" /></div>
      : !rows.length ? <EmptyState icon="📝" title="내역이 없습니다" />
      : (
        <div className="space-y-4">
          {Object.entries(byDate).map(([date, list]) => (
            <div key={date}>
              <div className="text-xs font-semibold text-gray-500 mb-1.5 sticky top-0">{date}</div>
              <div className="bg-white rounded-2xl border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {list.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 w-20"><span className={`text-[11px] px-2 py-0.5 rounded-full ${TX_UI[r.type]?.c ?? 'bg-gray-100'}`}><T k={TX_UI[r.type]?.l ?? r.type} /></span></td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{r.code}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                        <td className="px-4 py-2.5 text-right font-semibold w-20" style={{ color: r.qty >= 0 ? '#059669' : '#dc2626' }}>{r.qty > 0 ? '+' : ''}{r.qty}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-400 w-24">잔량 {r.balanceAfter}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-400">{r.reason}{r.ref ? ` · ${r.ref}` : ''}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-400 text-right w-16">{kdate(r.createdAt, 'time')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplyModal({ item, onClose, qc }: { item: ItemRow; onClose: () => void; qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const [type, setType] = useState<'IN' | 'ADJUST' | 'RETURN'>('IN');
  const [qty, setQty] = useState(10);
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/cssd/items/${item.id}/supply`, { type, qty, reason: reason || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cssd-items'] }); qc.invalidateQueries({ queryKey: ['cssd-inv-stats'] }); toast.success(tAttr('재고가 반영되었습니다.')); onClose(); },
    onError: () => toast.error(tAttr('실패')),
  });
  return (
    <Modal title={item.name} sub={`${item.code} · 현재고 ${item.stock}${item.unit}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {([['IN', '입고(+)'], ['RETURN', '반품(+)'], ['ADJUST', '재고조정(=)']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setType(v)} className={`py-2 text-xs rounded-lg border-2 ${type === v ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-100 text-gray-500'}`}><T k={l} /></button>
        ))}
      </div>
      <label className="block text-xs font-semibold text-gray-600 mb-1"><T k={type === 'ADJUST' ? '실사 재고(목표값)' : '수량'} /></label>
      <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-3" />
      <ReasonInput domain="cssdAction" value={reason} onChange={setReason} placeholder={tAttr('사유(선택)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-4" />
      <button onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full min-h-[44px] py-2.5 bg-blue-600 text-white rounded-xl font-semibold disabled:opacity-50"><T k="반영" /></button>
    </Modal>
  );
}

function NewItemModal({ onClose, qc }: { onClose: () => void; qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const [f, setF] = useState({ name: '', category: '기타', spec: '', unit: '개', stock: 0, safetyStock: 5, location: '', erpItemCode: '' });
  const mut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/cssd/items', f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cssd-items'] }); toast.success(tAttr('품목이 등록되었습니다.')); onClose(); },
    onError: () => toast.error(tAttr('실패')),
  });
  const set = (k: string, v: string | number) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={tAttr('품목 등록')} onClose={onClose}>
      <div className="space-y-2">
        <input placeholder={tAttr('품목명*')} value={f.name} onChange={e => set('name', e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg" />
        <div className="grid grid-cols-2 gap-2">
          <select value={f.category} onChange={e => set('category', e.target.value)} className="px-3 py-2 text-sm border rounded-lg">{['절단', '지혈', '견인', '봉합', '세척', '기타'].map(c => <option key={c} value={c}>{tAttr(c)}</option>)}</select>
          <input placeholder={tAttr('규격')} value={f.spec} onChange={e => set('spec', e.target.value)} className="px-3 py-2 text-sm border rounded-lg" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder={tAttr('단위')} value={f.unit} onChange={e => set('unit', e.target.value)} className="px-3 py-2 text-sm border rounded-lg" />
          <input type="number" placeholder={tAttr('초기재고')} value={f.stock} onChange={e => set('stock', Number(e.target.value))} className="px-3 py-2 text-sm border rounded-lg" />
          <input type="number" placeholder={tAttr('안전재고')} value={f.safetyStock} onChange={e => set('safetyStock', Number(e.target.value))} className="px-3 py-2 text-sm border rounded-lg" />
        </div>
        <input placeholder={tAttr('보관 위치')} value={f.location} onChange={e => set('location', e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg" />
        <input placeholder={tAttr('ERP 품목코드 (연동, 선택)')} value={f.erpItemCode} onChange={e => set('erpItemCode', e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg" />
      </div>
      <button onClick={() => mut.mutate()} disabled={!f.name || mut.isPending} className="w-full mt-4 min-h-[44px] py-2.5 bg-blue-600 text-white rounded-xl font-semibold disabled:opacity-50"><T k="등록" /></button>
    </Modal>
  );
}

/* ───── 세트 조합(빌더) ───── */
function ComposeTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const { data } = useQuery({ queryKey: ['cssd-items-all'], queryFn: () => apiClient.get<{ data: ItemRow[] }>('/api/v1/cssd/items') });
  const items: ItemRow[] = Array.isArray(data?.data) ? data!.data : [];
  const [q, setQ] = useState('');
  const [basket, setBasket] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('외과');
  const [pack, setPack] = useState('POUCH');
  const [life, setLife] = useState(30);
  const filtered = items.filter(i => !q || i.name.includes(q) || i.code.includes(q));
  const add = (it: ItemRow) => setBasket(b => b.find(x => x.itemId === it.id) ? b : [...b, { itemId: it.id, name: it.name, qty: 1 }]);
  const setQty = (id: string, qty: number) => setBasket(b => b.map(x => x.itemId === id ? { ...x, qty: Math.max(1, qty) } : x));
  const rm = (id: string) => setBasket(b => b.filter(x => x.itemId !== id));
  const save = useMutation({
    mutationFn: () => apiClient.post('/api/v1/cssd/templates', { name, category, packagingType: pack, shelfLifeDays: life, items: basket }),
    onSuccess: () => { toast.success(tAttr('트레이 세트가 저장되었습니다.')); setBasket([]); setName(''); qc.invalidateQueries({ queryKey: ['cssd-templates'] }); },
    onError: () => toast.error(tAttr('저장 실패(중복 이름?)')),
  });
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2"><T k="품목 선택" /></h3>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tAttr('품목 검색')} className="w-full px-3 py-2 text-sm border rounded-lg mb-3" />
        <div className="space-y-1.5 max-h-[55vh] overflow-y-auto">
          {filtered.map(it => (
            <button key={it.id} onClick={() => add(it)} className="w-full flex justify-between items-center px-3 py-2 rounded-lg hover:bg-blue-50 border border-gray-100">
              <span className="text-sm text-gray-700">{it.name} <span className="text-xs text-gray-400">{it.spec}</span></span>
              <span className="text-[10px] text-gray-400">재고 {it.stock}{it.unit} +</span>
            </button>
          ))}
          {!filtered.length && <p className="text-xs text-gray-400 text-center py-6"><T k="품목을 먼저 등록하세요(품목·재고 탭)" /></p>}
        </div>
      </div>
      <div className="bg-white rounded-2xl border p-4 flex flex-col">
        <h3 className="text-sm font-semibold text-gray-700 mb-2"><T k="세트 구성" /></h3>
        <div className="space-y-2 mb-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tAttr('세트명*')} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <div className="grid grid-cols-3 gap-2">
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder={tAttr('진료과')} className="px-3 py-2 text-sm border rounded-lg" />
            <select value={pack} onChange={e => setPack(e.target.value)} className="px-3 py-2 text-sm border rounded-lg">{['POUCH', 'WRAP', 'CONTAINER'].map(p => <option key={p} value={p}>{tAttr(PACK_LABEL[p])}</option>)}</select>
            <input type="number" value={life} onChange={e => setLife(Number(e.target.value))} placeholder={tAttr('유효일수')} className="px-3 py-2 text-sm border rounded-lg" />
          </div>
        </div>
        <div className="flex-1 space-y-1.5 mb-3 min-h-[20vh] max-h-[40vh] overflow-y-auto">
          {basket.length === 0 ? <p className="text-xs text-gray-400 text-center py-8"><T k="왼쪽에서 품목을 추가하세요" /></p> : basket.map(b => (
            <div key={b.itemId} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-sm text-gray-700 flex-1">{b.name}</span>
              <input type="number" value={b.qty} onChange={e => setQty(b.itemId, Number(e.target.value))} className="w-14 px-2 py-1 text-sm border rounded text-center" />
              <button onClick={() => rm(b.itemId)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
            </div>
          ))}
        </div>
        <button onClick={() => save.mutate()} disabled={!name || !basket.length || save.isPending} className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold disabled:opacity-40">
          세트 저장 ({basket.length}품목)
        </button>
      </div>
    </div>
  );
}

/* ───── 공통 UI ───── */
function Kpi({ label, v, active, onClick }: { label: string; v: number; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`bg-white rounded-2xl border p-4 text-center transition ${active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100 hover:border-gray-200'}`}><p className="text-xl font-bold text-gray-900">{v}</p><p className="text-xs font-medium text-gray-500 mt-1"><T k={label} /></p></button>;
}
function Modal({ title, sub, children, onClose }: { title: string; sub?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <div><h3 className="text-lg font-bold text-gray-900 font-mono">{title}</h3>{sub && <p className="text-xs text-gray-500">{sub}</p>}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
