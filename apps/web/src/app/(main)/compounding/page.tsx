'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { printRaw } from '@/lib/print';
import { kdate } from '@/lib/ui-settings';

interface Component { id: string; role: string; name: string; orderedAmount: string | null; amountUnit: string | null; computedVolumeMl: string | null; lotNumber: string | null }
interface Order {
  id: string; sourceType: string; status: string; priority: string; isHazardous: boolean;
  budAt: string | null; labelBarcode: string | null; hoodType: string | null;
  components: Component[]; patient?: { familyName: string | null; givenName: string | null; mrn: string | null };
}

const SRC_LABEL: Record<string, string> = { IV_RX: '주사', TPN: 'TPN', CHEMO: '항암' };
const ST_LABEL: Record<string, string> = { ORDERED: '지시', CALCULATED: '계산완료', IN_PREP: '조제중', COMPOUNDED: '조제완료', VERIFIED: '검증완료', RELEASED: '불출', CANCELLED: '취소' };
const ST_TONE: Record<string, string> = { ORDERED: 'bg-gray-100 text-gray-600', CALCULATED: 'bg-blue-100 text-blue-700', COMPOUNDED: 'bg-amber-100 text-amber-700', VERIFIED: 'bg-indigo-100 text-indigo-700', RELEASED: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-red-50 text-red-500' };

function unwrap<T>(d: unknown): T { const o = d as { data?: unknown }; return (o && typeof o === 'object' && 'data' in o ? o.data : d) as T; }

// 라벨(HTML) — 인증 fetch→blob→새 창(내장 print 스크립트 실행)
async function openLabel(id: string) {
  const token = apiClient.getToken();
  const res = await fetch(`/api/v1/compounding/orders/${id}/label`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { toast.error('라벨 생성 실패'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'width=420,height=320');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// 라벨 직인쇄 — 기생성 ZPL을 워크스테이션 기본 라벨프린터로 라우팅(미설정 시 다운로드 폴백)
async function printCompoundingLabel(id: string) {
  const token = apiClient.getToken();
  const res = await fetch(`/api/v1/compounding/orders/${id}/label.zpl`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { toast.error('ZPL 생성 실패'); return; }
  await printRaw('LABEL', await res.text(), `label-${id.slice(0, 8)}.zpl`);
}

// 라벨(ZPL) — 라벨프린터 직인쇄용 파일 다운로드 (프린터 한글 폰트 탑재 전제)
async function downloadZpl(id: string) {
  const token = apiClient.getToken();
  const res = await fetch(`/api/v1/compounding/orders/${id}/label.zpl`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { toast.error('ZPL 생성 실패'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `label-${id.slice(0, 8)}.zpl`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function CompoundingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sourceType: 'TPN', patientId: '', comp: '', prescriptionId: '' });
  const patientIdValid = /^[0-9a-f-]{36}$/i.test(form.patientId.trim());
  // 처방 연결(선택) — 활성 약처방만. 연결 시 불출에서 MAR·청구 자동 연동
  const { data: rxData, isError: rxIsError, error: rxError, refetch: refetchRx } = useQuery({
    queryKey: ['compounding-active-rx', form.patientId.trim()],
    queryFn: () => apiClient.get<{ data: { id: string; medicationCode?: { nameKo?: string } | null; dosage?: string | null }[] }>(`/api/v1/prescriptions/patient/${form.patientId.trim()}/active`),
    enabled: showForm && patientIdValid,
    staleTime: 30_000,
  });
  const activeRx = ((rxData?.data as unknown as { data?: { id: string; medicationCode?: { nameKo?: string } | null; dosage?: string | null }[] })?.data ?? (rxData?.data as unknown as { id: string; medicationCode?: { nameKo?: string } | null; dosage?: string | null }[]) ?? []).filter(r => r.medicationCode);
  const [calc, setCalc] = useState({ heightCm: '', weightKg: '', dosePerM2: '', bandMg: '', capMg: '' });
  const [calcResult, setCalcResult] = useState<{ bsa: number; rawDose: number; finalDose: number; banded: boolean; capped: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['compounding-worklist'],
    queryFn: () => apiClient.get<{ data: Order[] }>('/api/v1/compounding/worklist'),
    refetchInterval: 20000,
  });
  const rows = (unwrap<Order[]>(data?.data) ?? []) as Order[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['compounding-worklist'] });

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/compounding/orders', payload),
    onSuccess: () => { invalidate(); toast.success('조제지시 생성'); setShowForm(false); setForm({ sourceType: 'TPN', patientId: '', comp: '', prescriptionId: '' }); },
    onError: () => toast.error('생성 실패'),
  });
  const calcMut = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/compounding/orders/${id}/calculate`, {}), onSuccess: () => { invalidate(); toast.success('계산 완료'); }, onError: () => toast.error('실패') });
  const prepMut = useMutation({
    mutationFn: ({ id, hoodType }: { id: string; hoodType: string }) => apiClient.patch(`/api/v1/compounding/orders/${id}/prep`, { hoodType }),
    onSuccess: () => { invalidate(); toast.success('조제 기록'); }, onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '조제 실패'),
  });
  const verifyMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/compounding/orders/${id}/verify`, { budHours: 24 }),
    onSuccess: () => { invalidate(); toast.success('검증 완료'); }, onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '검증 실패(조제자≠검증자)'),
  });
  const releaseMut = useMutation({ mutationFn: (id: string) => apiClient.patch<{ data: { id: string } }>(`/api/v1/compounding/orders/${id}/release`, {}), onSuccess: (_r, id) => { invalidate(); toast.success('불출·라벨 발행'); openLabel(id); }, onError: () => toast.error('실패') });
  /**
   * 🔴 취소 사유를 화면이 지어내지 않는다(2026-09-02).
   *    종전엔 묻지도 않고 `reason: '취소'` 를 원장에 썼다 — 나중에 "왜 취소했는지"를 아무도 답할 수 없다.
   *    (이 저장소엔 `ReasonInput` 정본이 있고 pharmacy·cssd 는 이미 쓴다.)
   */
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/compounding/orders/${id}/cancel`, { reason }),
    onSuccess: () => { invalidate(); toast.success('취소'); }, onError: () => toast.error('실패'),
  });
  const cancelWithReason = (id: string) => {
    const reason = window.prompt('취소 사유를 입력하세요(원장에 남습니다)')?.trim();
    if (!reason) return; // 사유 없이는 취소하지 않는다
    cancelMut.mutate({ id, reason });
  };

  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const runCalc = async () => {
    const r = await apiClient.post<{ data: typeof calcResult }>('/api/v1/compounding/chemo-dose', { heightCm: num(calc.heightCm), weightKg: num(calc.weightKg), dosePerM2: num(calc.dosePerM2), bandMg: num(calc.bandMg), capMg: num(calc.capMg) });
    setCalcResult(unwrap(r.data));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">무균조제실</h2>
          <p className="text-sm text-gray-500 mt-1">주사·TPN·항암 무균조제 — 조제지시→계산→조제→독립 2차 검증→불출</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700">+ 조제지시</button>
      </div>

      {/* 항암 용량 계산기 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <p className="text-sm font-bold text-gray-800 mb-2">항암 용량 계산 <span className="text-xs font-normal text-gray-400">BSA(Mosteller)·용량밴딩·상한</span></p>
        <div className="flex flex-wrap items-end gap-2">
          <input value={calc.heightCm} onChange={e => setCalc({ ...calc, heightCm: e.target.value })} placeholder="키(cm)" type="number" className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={calc.weightKg} onChange={e => setCalc({ ...calc, weightKg: e.target.value })} placeholder="체중(kg)" type="number" className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={calc.dosePerM2} onChange={e => setCalc({ ...calc, dosePerM2: e.target.value })} placeholder="mg/m²" type="number" className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={calc.bandMg} onChange={e => setCalc({ ...calc, bandMg: e.target.value })} placeholder="밴딩(mg)" type="number" className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={calc.capMg} onChange={e => setCalc({ ...calc, capMg: e.target.value })} placeholder="상한(mg)" type="number" className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <button onClick={runCalc} className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded-lg hover:bg-gray-900">계산</button>
          {calcResult && (
            <span className="text-xs text-gray-700 ml-1">BSA <b>{calcResult.bsa}</b>m² · 원용량 {calcResult.rawDose}mg · <b className="text-indigo-700">최종 {calcResult.finalDose}mg</b>{calcResult.banded ? ' (밴딩)' : ''}{calcResult.capped ? ' ⚠상한적용' : ''}</span>
          )}
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-wrap items-center gap-2">
          <select value={form.sourceType} onChange={e => setForm({ ...form, sourceType: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs">
            <option value="TPN">TPN</option><option value="IV_RX">주사</option><option value="CHEMO">항암</option>
          </select>
          <input value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value, prescriptionId: '' })} placeholder="환자 ID(UUID)" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs w-72" />
          <select value={form.prescriptionId} onChange={e => setForm({ ...form, prescriptionId: e.target.value })} disabled={!patientIdValid}
            title={patientIdValid ? '처방 연결 시 불출에서 MAR·청구 자동 연동' : '환자 UUID 입력 후 선택 가능'}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs max-w-[240px] disabled:opacity-50">
            <option value="">처방 연결 안 함</option>
            {activeRx.map(r => <option key={r.id} value={r.id}>{r.medicationCode?.nameKo ?? r.id.slice(0, 8)}{r.dosage ? ` · ${r.dosage}` : ''}</option>)}
          </select>
          {/* 🔴 활성 처방 조회 실패를 "연결할 처방 없음"으로 말하지 않는다 */}
          {rxIsError && <QueryErrorFallback error={rxError} onRetry={refetchRx} size="compact" />}
          <input value={form.comp} onChange={e => setForm({ ...form, comp: e.target.value })} placeholder="성분(쉼표구분: 5%DW 1000mL, KCl 20mEq)" className="flex-1 min-w-[240px] px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <button
            onClick={() => { if (!form.patientId.trim()) { toast.warning('환자 ID 필요'); return; } createMut.mutate({ sourceType: form.sourceType, patientId: form.patientId.trim(), ...(form.prescriptionId ? { prescriptionId: form.prescriptionId } : {}), components: form.comp.split(',').map(s => s.trim()).filter(Boolean).map((name, i) => ({ role: i === 0 ? 'BASE_FLUID' : 'ADDITIVE', name })) }); }}
            disabled={createMut.isPending} className="min-h-[44px] px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">생성</button>
          <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500 text-left">
            <th className="px-3 py-3">환자</th><th className="px-3 py-3">유형</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">성분</th><th className="px-3 py-3">BUD</th><th className="px-3 py-3">조치</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6} className="py-12 text-center text-gray-400">불러오는 중…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400">조제 대기 없음</td></tr>
            : rows.map(r => (
              <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${r.isHazardous ? 'bg-orange-50/40' : ''}`}>
                <td className="px-3 py-2.5 text-xs text-gray-800">{r.patient?.familyName}{r.patient?.givenName}<span className="text-gray-400 ml-1">{r.patient?.mrn}</span></td>
                <td className="px-3 py-2.5 text-xs">{SRC_LABEL[r.sourceType] ?? r.sourceType}{r.isHazardous && <span className="ml-1 text-[10px] font-bold text-orange-700">☣항암</span>}</td>
                <td className="px-3 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ST_TONE[r.status] ?? 'bg-gray-100'}`}>{ST_LABEL[r.status] ?? r.status}</span></td>
                <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[220px] truncate">{r.components.map(c => c.name).join(' + ')}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{r.budAt ? kdate(r.budAt, 'datetimeShort') : '-'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {r.status === 'ORDERED' && <button onClick={() => calcMut.mutate(r.id)} className="min-h-[44px] px-3 py-2 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium">계산</button>}
                    {r.status === 'CALCULATED' && <button onClick={() => { const h = window.prompt(`후드 유형 입력${r.isHazardous ? ' (항암=BSC_II/ISOLATOR 필수)' : ' (LAFW/BSC_II/ISOLATOR)'}`, r.isHazardous ? 'BSC_II' : 'LAFW'); if (h) prepMut.mutate({ id: r.id, hoodType: h.trim() }); }} className="min-h-[44px] px-3 py-2 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-medium">조제</button>}
                    {r.status === 'COMPOUNDED' && <button onClick={() => verifyMut.mutate(r.id)} className="min-h-[44px] px-3 py-2 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium">검증</button>}
                    {r.status === 'VERIFIED' && <button onClick={() => releaseMut.mutate(r.id)} className="min-h-[44px] px-3 py-2 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium">불출</button>}
                    {['VERIFIED', 'COMPOUNDED'].includes(r.status) && <button onClick={() => openLabel(r.id)} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs">라벨</button>}
                    {['VERIFIED', 'RELEASED'].includes(r.status) && (<>
                      <button onClick={() => printCompoundingLabel(r.id)} title="워크스테이션 기본 라벨프린터로 직인쇄" className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs">🖨</button>
                      <button onClick={() => downloadZpl(r.id)} title="라벨프린터 직인쇄용 ZPL 파일" className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs">ZPL</button>
                    </>)}
                    {!['RELEASED', 'CANCELLED'].includes(r.status) && <button onClick={() => { if (window.confirm('취소할까요?')) cancelWithReason(r.id); }} className="min-h-[44px] px-3 py-2 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 text-xs font-medium">취소</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
