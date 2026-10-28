'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface LabInstrument {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  category: string;
  interfaceType: string;
  location?: string;
  lastSyncAt?: string;
}

interface InstrumentInterfaceResult {
  id: string;
  fileName?: string;
  status: string;
}

interface LabInstrumentDetail extends LabInstrument {
  interfaceResults?: InstrumentInterfaceResult[];
}

const CATEGORY_LABEL: Record<string, string> = {
  HEMATOLOGY: '혈액', CHEMISTRY: '생화학', IMMUNOLOGY: '면역', URINALYSIS: '요검사',
  COAGULATION: '응고', BLOOD_GAS: '혈액가스', SPECIAL: '특수',
};
const INTERFACE_LABEL: Record<string, string> = {
  HL7: 'HL7', FILE_WATCH: '파일 감시', PDF_UPLOAD: 'PDF 업로드', API: 'API', MANUAL: '수동',
};

export default function InstrumentsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', manufacturer: '', model: '', serialNumber: '',
    category: 'CHEMISTRY', interfaceType: 'MANUAL', location: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['lab-instruments'],
    queryFn: () => apiClient.get<{ data: LabInstrument[] | { data: LabInstrument[] } }>('/api/v1/lab/instruments'),
  });

  const { data: detailData } = useQuery({
    queryKey: ['lab-instrument-detail', selectedId],
    queryFn: () => apiClient.get<{ data: LabInstrumentDetail | { data: LabInstrumentDetail } }>(`/api/v1/lab/instruments/${selectedId}`),
    enabled: !!selectedId,
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/lab/instruments', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-instruments'] });
      setShowForm(false);
      setForm({ name: '', manufacturer: '', model: '', serialNumber: '', category: 'CHEMISTRY', interfaceType: 'MANUAL', location: '' });
      toast.success('장비가 등록되었습니다');
    },
    onError: () => toast.error('장비 등록 실패'),
  });

  const instruments: LabInstrument[] = (() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as { data: LabInstrument[] })?.data ?? [];
  })();
  const detail: LabInstrumentDetail | null = detailData?.data
    ? ((detailData.data as { data: LabInstrumentDetail })?.data ?? detailData.data) as LabInstrumentDetail
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="검사 장비 관리" /></h3>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          <T k="+ 장비 등록" />
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-bold text-gray-700"><T k="새 장비 등록" /></p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="장비명 *" /></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="Sysmex XN-1000" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="제조사" /></label>
              <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="Sysmex" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="모델" /></label>
              <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="XN-1000" /></div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="카테고리" /></label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="연동 방식" /></label>
              <select value={form.interfaceType} onChange={e => setForm({ ...form, interfaceType: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                {Object.entries(INTERFACE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="시리얼번호" /></label>
              <input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="위치" /></label>
              <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('검사실 1')} /></div>
          </div>
          <button onClick={() => createMut.mutate()} disabled={!form.name || createMut.isPending}
            className="px-4 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            <T k={createMut.isPending ? '등록 중...' : '등록'} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4">
        {/* 장비 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="카테고리" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="연동" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="위치" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="최근 동기화" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i} className="border-b border-gray-50"><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : instruments.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="등록된 장비가 없습니다" /></td></tr>
              ) : instruments.map((inst: LabInstrument) => (
                <tr key={inst.id} onClick={() => setSelectedId(inst.id)}
                  className={`border-b border-gray-50 cursor-pointer transition-colors ${selectedId === inst.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{inst.name}</p>
                    <p className="text-[10px] text-gray-400">{inst.manufacturer} {inst.model}</p>
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 whitespace-nowrap"><T k={CATEGORY_LABEL[inst.category] ?? inst.category} /></span></td>
                  <td className="px-4 py-3 text-xs text-gray-500"><T k={INTERFACE_LABEL[inst.interfaceType] ?? inst.interfaceType} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inst.location ?? '-'}</td>
                  <td className="px-4 py-3 text-[10px] text-gray-400">{inst.lastSyncAt ?kdate(inst.lastSyncAt, 'datetimeShort') : <T k="없음" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 장비 상세 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedId ? (
            <p className="text-sm text-gray-400 text-center py-8"><T k="장비를 선택하세요" /></p>
          ) : detail ? (
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-gray-900">{detail.name}</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400"><T k="제조사:" /></span> <span className="text-gray-700">{detail.manufacturer ?? '-'}</span></div>
                <div><span className="text-gray-400"><T k="모델:" /></span> <span className="text-gray-700">{detail.model ?? '-'}</span></div>
                <div><span className="text-gray-400">S/N:</span> <span className="text-gray-700 font-mono">{detail.serialNumber ?? '-'}</span></div>
                <div><span className="text-gray-400"><T k="위치:" /></span> <span className="text-gray-700">{detail.location ?? '-'}</span></div>
              </div>
              {detail.interfaceResults && detail.interfaceResults.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-1.5"><T k="최근 수신 이력" /></p>
                  <div className="space-y-1">
                    {detail.interfaceResults.slice(0, 5).map((r: InstrumentInterfaceResult) => (
                      <div key={r.id} className="flex items-center justify-between text-[10px] p-1.5 rounded bg-gray-50">
                        <span className="text-gray-600">{r.fileName ?? <T k="수신" />}</span>
                        <span className={`font-medium ${r.status === 'APPLIED' ? 'text-emerald-600' : r.status === 'REJECTED' ? 'text-red-600' : 'text-amber-600'}`}>{r.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4"><T k="로딩 중..." /></p>
          )}
        </div>
      </div>
    </div>
  );
}
