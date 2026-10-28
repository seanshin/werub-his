'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Segment {
  id: string; name: string; description: string | null; type: string;
  rules: Record<string, unknown>; patientCount: number; isActive: boolean;
  lastRefreshedAt: string | null;
}

const TYPE_LABEL: Record<string, string> = { MANUAL: '수동', AUTO: '자동', RFM: 'RFM' };

export default function SegmentsPage() {
  const tAttr = useTAttr();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.fetch<{ data: Segment[] }>('/api/v1/crm/segments');
      setSegments(res.data);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (form: { name: string; type: string; rules: string }) => {
    try {
      await apiClient.fetch('/api/v1/crm/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, rules: JSON.parse(form.rules || '{}') }),
      });
      setShowCreate(false);
      load();
    } catch { /* */ }
  };

  const handleRefresh = async (id: string) => {
    try {
      await apiClient.fetch(`/api/v1/crm/segments/${id}/refresh`, { method: 'POST' });
      load();
    } catch { /* */ }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="세그먼트 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="RFM 분석 + 조건 기반 환자 분류" /></p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
          <T k="+ 새 세그먼트" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {segments.map(seg => (
            <div key={seg.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-900">{seg.name}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700"><T k={TYPE_LABEL[seg.type] ?? seg.type} /></span>
              </div>
              {seg.description && <p className="text-xs text-gray-500 mb-3">{seg.description}</p>}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500"><T k="환자 수" />: <span className="font-bold text-gray-900">{seg.patientCount.toLocaleString()}</span></span>
                <div className="flex gap-2">
                  <button onClick={() => handleRefresh(seg.id)} className="text-xs text-blue-600 hover:underline"><T k="갱신" /></button>
                </div>
              </div>
              {seg.lastRefreshedAt && (
                <p className="text-[10px] text-gray-400 mt-2"><T k="마지막 갱신" />: {seg.lastRefreshedAt.slice(0, 16).replace('T', ' ')}</p>
              )}
            </div>
          ))}
          {segments.length === 0 && (
            <EmptyState icon="📋" title="세그먼트가 없습니다" className="col-span-2" />
          )}
        </div>
      )}

      {showCreate && (
        <CreateSegmentModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

function CreateSegmentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (f: { name: string; type: string; rules: string }) => void }) {
  const tAttr = useTAttr();
  const [form, setForm] = useState({ name: '', type: 'AUTO', rules: '{"churnRisk":"HIGH"}' });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-bold"><T k="새 세그먼트" /></h2>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder={tAttr('세그먼트 이름')} className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="AUTO">{tAttr('자동')}</option><option value="MANUAL">{tAttr('수동')}</option><option value="RFM">RFM</option>
        </select>
        <textarea value={form.rules} onChange={e => setForm(f => ({ ...f, rules: e.target.value }))}
          rows={3} placeholder='조건 JSON (예: {"churnRisk":"HIGH"})' className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm font-mono" />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl"><T k="취소" /></button>
          <button onClick={() => form.name && onCreate(form)} disabled={!form.name}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl disabled:opacity-30"><T k="생성" /></button>
        </div>
      </div>
    </div>
  );
}
