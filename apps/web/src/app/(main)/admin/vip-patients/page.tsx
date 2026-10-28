'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { safeFormat as format } from '@/lib/safe-date';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface VipPatient {
  id: string;
  patientId: string;
  reason?: string;
  createdAt: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  designator?: { familyName: string; givenName: string };
}

interface VipDesignatePayload {
  patientId: string;
  reason: string;
}

interface VipListResponse {
  data: VipPatient[];
}

export default function VipPatientsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patientId: '', reason: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vip-patients'],
    queryFn: () => apiClient.get<{ data: VipPatient[] }>('/api/v1/vip-patients'),
  });

  const designateMut = useMutation({
    mutationFn: (d: VipDesignatePayload) => apiClient.post('/api/v1/vip-patients', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vip-patients'] }); setShowForm(false); setForm({ patientId: '', reason: '' }); },
  });

  const removeMut = useMutation({
    mutationFn: (patientId: string) => apiClient.fetch(`/api/v1/vip-patients/${patientId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vip-patients'] }),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _vipsRaw = data?.data;
  const vips = Array.isArray(_vipsRaw) ? _vipsRaw : (_vipsRaw as VipListResponse | undefined)?.data ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="VIP 환자 관리" /></h1>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"><T k={showForm ? '취소' : '+ VIP 지정'} /></button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 ID (UUID)" /></label>
            <input value={form.patientId} onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('환자 UUID')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="지정 사유" /></label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <button onClick={() => designateMut.mutate(form)} disabled={designateMut.isPending || !form.patientId} className="px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-50"><T k="지정" /></button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : vips.length === 0 ? (
        <EmptyState icon="👤" title="지정된 VIP 환자가 없습니다" />
      ) : (
        <div className="space-y-3">
          {vips.map((v: VipPatient) => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{v.patient?.familyName}{v.patient?.givenName} <span className="text-gray-400">({v.patient?.mrn})</span></p>
                <p className="text-xs text-gray-500 mt-0.5">{v.reason || <T k="사유 없음" />} | <T k="지정" />: {v.designator?.familyName}{v.designator?.givenName} | {format(new Date(v.createdAt), 'yyyy-MM-dd')}</p>
              </div>
              <button onClick={() => removeMut.mutate(v.patientId)} className="px-3 py-1.5 bg-red-50 text-red-600 text-xs rounded-lg hover:bg-red-100"><T k="해제@지정" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
