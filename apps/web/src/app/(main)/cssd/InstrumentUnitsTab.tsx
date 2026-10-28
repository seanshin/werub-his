'use client';

/**
 * CSSD 기구 개체(개별 기구) — 멸균 합격 사이클·최초 사용일(서버 파생)·수명 한도 대비.
 * 🔴 한도는 입력값이다. 미설정이면 "한도 미설정"이라 말하고 경보를 그리지 않는다(값을 지어내지 않는다).
 * 🔴 한도 도달은 막지 않는다 — 표시와 재포장 경고로만(서버 `CssdUnitService.resolveForPackage`).
 * 🔴 횟수는 "멸균 **합격** 사이클"이다 — 실패 로드는 개체 기록에 남지 않아 세지 않는다(서버 `instrument-unit-life.ts`).
 */
import { useState } from 'react';
import { useQuery, useMutation, type useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { EmptyState } from '@/components/ui/display';
import { ReasonInput } from '@/components/ui/ReasonInput';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

type LifeState = 'NO_LIMIT' | 'WITHIN' | 'LIMIT_REACHED';
interface UnitLife {
  sterilizedCycles: number; linkedPackages: number; firstUsedAt: string | null; firstSterilizedAt: string | null;
  limit: number | null; limitSource: 'UNIT' | 'ITEM' | null; remaining: number | null; state: LifeState;
}
interface UnitRow {
  id: string; serialNo: string; status: string; maxCycles: number | null; note?: string | null;
  item: { id: string; code: string; name: string; maxCycles: number | null };
  life: UnitLife;
}
interface UnitDetail extends UnitRow {
  packages: { addedAt: string; package: { id: string; lotNo: string; templateName: string; status: string; sterilizedAt: string | null; usedAt: string | null } }[];
}
interface ItemOpt { id: string; code: string; name: string }

function LifeBadge({ life }: { life: UnitLife }) {
  if (life.state === 'NO_LIMIT') return <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500"><T k="한도 미설정" /></span>;
  if (life.state === 'LIMIT_REACHED') return <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-100 text-red-700 font-semibold"><T k="수명 한도 도달" /></span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700"><Tf k="남은 합격 사이클 {남은}" params={{ 남은: life.remaining }} /></span>;
}

export function InstrumentUnitsTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState({ itemId: '', serialNo: '', maxCycles: '' });
  const [retireNote, setRetireNote] = useState('');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cssd-units', q],
    queryFn: () => apiClient.get<{ data: UnitRow[] }>(`/api/v1/cssd/units${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  });
  const itemsQ = useQuery({ queryKey: ['cssd-items-for-units'], queryFn: () => apiClient.get<{ data: ItemOpt[] }>('/api/v1/cssd/items') });
  const detailQ = useQuery({
    queryKey: ['cssd-unit', detailId],
    queryFn: () => apiClient.get<{ data: UnitDetail }>(`/api/v1/cssd/units/${detailId}`),
    enabled: !!detailId,
  });
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/cssd/units', {
      itemId: form.itemId, serialNo: form.serialNo.trim(),
      ...(form.maxCycles.trim() ? { maxCycles: Number(form.maxCycles) } : {}),
    }),
    onSuccess: () => { toast.success(tAttr('기구 개체를 등록했습니다.')); setForm({ itemId: '', serialNo: '', maxCycles: '' }); qc.invalidateQueries({ queryKey: ['cssd-units'] }); },
    onError: () => toast.error(tAttr('기구 개체를 등록하지 못했습니다.')),
  });
  const retire = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/cssd/units/${id}/retire`, { confirm: true, note: retireNote.trim() }),
    onSuccess: () => { toast.success(tAttr('기구 개체를 폐기 처리했습니다.')); setRetireNote(''); qc.invalidateQueries({ queryKey: ['cssd-units'] }); qc.invalidateQueries({ queryKey: ['cssd-unit', detailId] }); },
    onError: () => toast.error(tAttr('폐기 처리에 실패했습니다.')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  const units: UnitRow[] = Array.isArray(data?.data) ? data!.data : [];
  const items: ItemOpt[] = Array.isArray(itemsQ.data?.data) ? itemsQ.data!.data : [];
  const detail = detailQ.data?.data;
  const maxOk = !form.maxCycles.trim() || (Number.isInteger(Number(form.maxCycles)) && Number(form.maxCycles) >= 1);

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2 bg-white rounded-2xl border overflow-hidden">
        <div className="p-3 border-b flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('개체 번호 검색')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100" />
          <span className="text-[11px] text-gray-400"><T k="횟수는 멸균 합격 사이클만 셉니다(실패 로드는 개체 기록에 남지 않습니다)." /></span>
        </div>
        {isLoading ? <div className="p-6 text-sm text-gray-400"><T k="불러오는 중…" /></div> : units.length === 0 ? (
          <EmptyState title="등록된 기구 개체가 없습니다" hint="오른쪽에서 개체 번호를 등록하면 재포장 때 LOT 에 연결할 수 있습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left"><T k="개체 번호" /></th>
                  <th className="px-3 py-2 text-left"><T k="품목" /></th>
                  <th className="px-3 py-2 text-right"><T k="멸균 합격" /></th>
                  <th className="px-3 py-2 text-right"><T k="한도" /></th>
                  <th className="px-3 py-2 text-left"><T k="최초 사용일" /></th>
                  <th className="px-3 py-2 text-left"><T k="수명" /></th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id} onClick={() => setDetailId(u.id)} className={`border-t cursor-pointer hover:bg-gray-50 ${detailId === u.id ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs">{u.serialNo}{u.status === 'RETIRED' && <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px]"><T k="폐기" /></span>}</td>
                    <td className="px-3 py-2">{u.item.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.life.sterilizedCycles}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {u.life.limit == null ? '-' : u.life.limit}
                      {u.life.limitSource === 'ITEM' && <span className="ml-1 text-[10px] text-gray-400"><T k="(품목)" /></span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{u.life.firstUsedAt ? kdate(u.life.firstUsedAt) : <span className="text-gray-400"><T k="사용 기록 없음" /></span>}</td>
                    <td className="px-3 py-2"><LifeBadge life={u.life} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-2xl border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="기구 개체 등록" /></h3>
          <select value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2">
            <option value="">{tAttr('품목 선택')}</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
          <input value={form.serialNo} onChange={(e) => setForm((f) => ({ ...f, serialNo: e.target.value }))} placeholder={tAttr('개체 번호(각인·UDI·라벨)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2" />
          <input value={form.maxCycles} onChange={(e) => setForm((f) => ({ ...f, maxCycles: e.target.value }))} inputMode="numeric" placeholder={tAttr('수명 한도(선택 · 비우면 품목 한도)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-1" />
          {!maxOk && <p className="text-[11px] text-red-600 mb-1"><T k="한도는 1 이상의 정수여야 합니다." /></p>}
          <p className="text-[11px] text-gray-400 mb-3"><T k="한도는 제조사·원내 기준으로 입력합니다. 비워 두면 품목 한도를 따르고, 둘 다 없으면 한도 미설정입니다." /></p>
          <button onClick={() => create.mutate()} disabled={!form.itemId || !form.serialNo.trim() || !maxOk || create.isPending} className="w-full min-h-[44px] py-2.5 rounded-xl text-white font-semibold bg-blue-600 disabled:opacity-40">
            <T k="등록" />
          </button>
        </div>

        {detail && (
          <div className="bg-white rounded-2xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700 font-mono">{detail.serialNo}</h3>
              <LifeBadge life={detail.life} />
            </div>
            <p className="text-xs text-gray-500 mb-2">
              <Tf k="멸균 합격 {합격}회 · 연결 패키지 {연결}건" params={{ 합격: detail.life.sterilizedCycles, 연결: detail.life.linkedPackages }} />
            </p>
            {detail.packages.length === 0 ? (
              <p className="text-xs text-gray-400"><T k="아직 어떤 LOT 에도 연결되지 않았습니다." /></p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto text-xs">
                {detail.packages.map((p) => (
                  <li key={p.package.id} className="flex justify-between gap-2 border-b border-gray-50 py-1">
                    <span className="font-mono">{p.package.lotNo}</span>
                    <span className="text-gray-500">{p.package.sterilizedAt ? kdate(p.package.sterilizedAt) : <T k="미합격·진행 중" />}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail.status !== 'RETIRED' && (
              <div className="mt-3">
                <ReasonInput domain="cssdAction" value={retireNote} onChange={setRetireNote} required placeholder={tAttr('폐기 사유(필수)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2" />
                <button onClick={() => retire.mutate(detail.id)} disabled={retire.isPending || !retireNote.trim()} className="w-full min-h-[44px] py-2 rounded-xl border border-red-200 text-red-700 text-sm disabled:opacity-40">
                  <T k="폐기 처리" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
