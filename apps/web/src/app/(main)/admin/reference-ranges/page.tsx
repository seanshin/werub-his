'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface RefRange {
  id: string;
  testCode: string | null;
  loincCode: string | null;
  testName: string | null;
  sex: 'ANY' | 'MALE' | 'FEMALE';
  ageMinYears: number | null;
  ageMaxYears: number | null;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  low: string | null;
  high: string | null;
  criticalLow: string | null;
  criticalHigh: string | null;
  unit: string | null;
  textNormal: string | null;
  source: string | null;
}

// 🔴 값 문자열이 카탈로그 키다 — Record 를 재정의하지 않고 `<T k={값}>` 으로 넘긴다
const SEX_LABEL: Record<string, string> = { ANY: '공통', MALE: '남', FEMALE: '여' };

function unwrap<TData>(d: unknown): TData { const o = d as { data?: unknown }; return (o && typeof o === 'object' && 'data' in o ? o.data : d) as TData; }

export default function ReferenceRangesPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ testCode: '', loincCode: '', testName: '', sex: 'ANY', ageMinYears: '', ageMaxYears: '', ageMinMonths: '', ageMaxMonths: '', low: '', high: '', criticalLow: '', criticalHigh: '', unit: '', textNormal: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['reference-ranges', q],
    queryFn: () => apiClient.get<{ data: RefRange[] }>(`/api/v1/reference-ranges${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  });
  const rows = (unwrap<RefRange[]>(data?.data) ?? []) as RefRange[];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reference-ranges'] });
  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/reference-ranges', payload),
    onSuccess: () => { invalidate(); toast.success(tAttr('기준치를 등록했습니다')); setShowForm(false); },
    onError: () => toast.error(tAttr('등록 실패')),
  });
  const deactivateMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/reference-ranges/${id}`),
    onSuccess: () => { invalidate(); toast.success(tAttr('비활성화했습니다')); },
    onError: () => toast.error(tAttr('실패')),
  });

  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="검사 기준치 마스터" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="성별·연령대·검체별 정상범위 + 위급역치 — 결과 자동 판정(H/L·LL/HH)에 사용" /></p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700"><T k="+ 기준치 등록" /></button>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder={tAttr('검사코드/명 검색')} className="w-64 px-3 py-2 border border-gray-200 rounded-lg text-sm mb-4" />

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 grid grid-cols-4 gap-2">
          <input value={form.testCode} onChange={e => setForm({ ...form, testCode: e.target.value })} placeholder={tAttr('검사코드')} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.loincCode} onChange={e => setForm({ ...form, loincCode: e.target.value })} placeholder="LOINC" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.testName} onChange={e => setForm({ ...form, testName: e.target.value })} placeholder={tAttr('검사명')} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs col-span-2" />
          <select value={form.sex} onChange={e => setForm({ ...form, sex: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs">
            <option value="ANY">{tAttr('공통')}</option><option value="MALE">{tAttr('남')}</option><option value="FEMALE">{tAttr('여')}</option>
          </select>
          <input value={form.ageMinYears} onChange={e => setForm({ ...form, ageMinYears: e.target.value })} placeholder={tAttr('연령下(세)')} type="number" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.ageMaxYears} onChange={e => setForm({ ...form, ageMaxYears: e.target.value })} placeholder={tAttr('연령上(세·미포함)')} type="number" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.ageMinMonths} onChange={e => setForm({ ...form, ageMinMonths: e.target.value })} placeholder={tAttr('영아 하한(개월)')} type="number" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.ageMaxMonths} onChange={e => setForm({ ...form, ageMaxMonths: e.target.value })} placeholder={tAttr('영아 상한(개월·미포함)')} type="number" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={tAttr('단위')} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.low} onChange={e => setForm({ ...form, low: e.target.value })} placeholder={tAttr('정상下')} type="number" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.high} onChange={e => setForm({ ...form, high: e.target.value })} placeholder={tAttr('정상上')} type="number" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input value={form.criticalLow} onChange={e => setForm({ ...form, criticalLow: e.target.value })} placeholder={tAttr('위급下')} type="number" className="px-2.5 py-1.5 border border-red-200 rounded-lg text-xs" />
          <input value={form.criticalHigh} onChange={e => setForm({ ...form, criticalHigh: e.target.value })} placeholder={tAttr('위급上')} type="number" className="px-2.5 py-1.5 border border-red-200 rounded-lg text-xs" />
          <input value={form.textNormal} onChange={e => setForm({ ...form, textNormal: e.target.value })} placeholder={tAttr('정성 정상값(예:Negative)')} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs col-span-2" />
          <div className="col-span-2 flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg"><T k="취소" /></button>
            <button
              onClick={() => { if (!form.testCode && !form.loincCode) { toast.warning(tAttr('검사코드 또는 LOINC 필요')); return; } createMut.mutate({ testCode: form.testCode || undefined, loincCode: form.loincCode || undefined, testName: form.testName || undefined, sex: form.sex, ageMinYears: num(form.ageMinYears), ageMaxYears: num(form.ageMaxYears), ageMinMonths: num(form.ageMinMonths), ageMaxMonths: num(form.ageMaxMonths), unit: form.unit || undefined, low: num(form.low), high: num(form.high), criticalLow: num(form.criticalLow), criticalHigh: num(form.criticalHigh), textNormal: form.textNormal || undefined }); }}
              disabled={createMut.isPending}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50"><T k="등록" /></button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500">
            <th className="px-3 py-3 text-left"><T k="코드" /></th><th className="px-3 py-3 text-left"><T k="검사명" /></th><th className="px-3 py-3 text-left"><T k="성별" /></th>
            <th className="px-3 py-3 text-left"><T k="연령대" /></th><th className="px-3 py-3 text-left"><T k="정상범위" /></th><th className="px-3 py-3 text-left"><T k="위급(LL/HH)" /></th>
            <th className="px-3 py-3 text-left"><T k="단위" /></th><th className="px-3 py-3 text-left"><T k="출처" /></th><th className="px-3 py-3"></th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="불러오는 중..." /></td></tr>
            : rows.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="기준치 없음" /></td></tr>
            : rows.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-3 py-2.5 text-xs font-medium text-gray-800">{r.testCode ?? '-'}{r.loincCode ? <span className="text-emerald-600 ml-1">L:{r.loincCode}</span> : ''}</td>
                <td className="px-3 py-2.5 text-xs text-gray-700">{r.testName ?? '-'}</td>
                <td className="px-3 py-2.5 text-xs"><T k={SEX_LABEL[r.sex]} /></td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{r.ageMinMonths != null || r.ageMaxMonths != null ? `${r.ageMinMonths ?? 0}~${r.ageMaxMonths ?? '∞'}개월` : (r.ageMinYears != null || r.ageMaxYears != null ? `${r.ageMinYears ?? 0}~${r.ageMaxYears ?? '∞'}세` : '전연령')}</td>
                <td className="px-3 py-2.5 text-xs text-gray-700">{r.textNormal ? r.textNormal : `${r.low ?? ''}~${r.high ?? ''}`}</td>
                <td className="px-3 py-2.5 text-xs text-red-600">{r.criticalLow != null || r.criticalHigh != null ? `${r.criticalLow ?? ''}/${r.criticalHigh ?? ''}` : '-'}</td>
                <td className="px-3 py-2.5 text-xs text-gray-400">{r.unit ?? '-'}</td>
                <td className="px-3 py-2.5 text-xs text-gray-400">{r.source ?? '-'}</td>
                <td className="px-3 py-2.5 text-xs"><button onClick={() => { if (window.confirm(tAttr('비활성화할까요?'))) deactivateMut.mutate(r.id); }} className="text-red-500 hover:text-red-700"><T k="비활성" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
