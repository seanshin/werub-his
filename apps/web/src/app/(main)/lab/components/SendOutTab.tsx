'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface SendOutEntry {
  id: string;
  status: string;
  testName: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  referenceLab?: { name: string; code: string };
  requester?: { familyName: string; givenName: string };
  expectedDate?: string;
  sampleType?: string;
  sampleBarcode?: string;
  trackingNumber?: string;
  clinicalInfo?: string;
  resultFileUrl?: string;
  resultSummary?: string;
}

interface ReferenceLab {
  id: string;
  name: string;
  code: string;
}

const STATUS_LABEL: Record<string, string> = { ORDERED: '의뢰', SENT: '발송', IN_TRANSIT: '운송중', TESTING: '검사중', RESULT_RECEIVED: '결과도착', REPORTED: '보고완료', CANCELLED: '취소' };
const STATUS_COLOR: Record<string, string> = { ORDERED: 'bg-blue-100 text-blue-700', SENT: 'bg-indigo-100 text-indigo-700', IN_TRANSIT: 'bg-violet-100 text-violet-700', TESTING: 'bg-amber-100 text-amber-700', RESULT_RECEIVED: 'bg-emerald-100 text-emerald-700', REPORTED: 'bg-gray-200 text-gray-600', CANCELLED: 'bg-red-100 text-red-700' };

export default function SendOutTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ patientId: '', referenceLabId: '', testName: '', catalogItemId: '', sampleType: '', clinicalInfo: '' });

  const { data: sendOutsData, isLoading } = useQuery({
    queryKey: ['lab-send-outs', filter],
    queryFn: () => apiClient.get<{ data: SendOutEntry[] }>(`/api/v1/lab/send-outs${filter ? `?status=${filter}` : ''}`),
    refetchInterval: pollMs('fast'),
  });

  const { data: detailData } = useQuery({
    queryKey: ['lab-send-out-detail', selectedId],
    queryFn: () => apiClient.get<{ data: SendOutEntry }>(`/api/v1/lab/send-outs/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: refLabsData } = useQuery({
    queryKey: ['reference-labs'],
    queryFn: () => apiClient.get<{ data: ReferenceLab[] }>('/api/v1/lab/reference-labs'),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/lab/send-outs', {
      patientId: form.patientId, referenceLabId: form.referenceLabId,
      testName: form.testName, catalogItemId: form.catalogItemId || undefined,
      sampleType: form.sampleType || undefined, clinicalInfo: form.clinicalInfo || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-send-outs'] }); setShowCreate(false); toast.success('위탁검사 의뢰 완료'); },
    onError: () => toast.error('의뢰 실패'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status, extra }: { id: string; status: string; extra?: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/lab/send-outs/${id}/status`, { status, ...extra }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-send-outs'] }); qc.invalidateQueries({ queryKey: ['lab-send-out-detail', selectedId] }); toast.success('상태 변경 완료'); },
  });

  const sendOuts: SendOutEntry[] = (() => { const r = sendOutsData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as SendOutEntry[] ?? []; })();
  const refLabs: ReferenceLab[] = (() => { const r = refLabsData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as ReferenceLab[] ?? []; })();
  const detail: SendOutEntry | null = detailData?.data ? ((detailData.data as unknown as Record<string, unknown>)?.data as SendOutEntry ?? detailData.data) : null;

  const counts: Record<string, number> = {};
  sendOuts.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="위탁검사" /></h3>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          <T k="+ 위탁 의뢰" />
        </button>
      </div>

      {/* 현황 카드 */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {['ORDERED', 'SENT', 'IN_TRANSIT', 'TESTING', 'RESULT_RECEIVED', 'REPORTED'].map(s => (
          <button key={s} onClick={() => setFilter(filter === s ? '' : s)}
            className={`rounded-xl p-2.5 text-center transition-colors ${filter === s ? 'ring-2 ring-indigo-400' : ''} ${STATUS_COLOR[s]?.replace('text-', 'bg-').split(' ')[0] || 'bg-gray-50'}`}>
            <p className="text-lg font-bold">{counts[s] ?? 0}</p>
            <p className="text-[9px] font-medium whitespace-nowrap"><T k={STATUS_LABEL[s]} /></p>
          </button>
        ))}
      </div>

      {/* 의뢰 폼 */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-bold text-gray-700"><T k="위탁검사 의뢰" /></p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="환자 ID *" /></label>
              <input value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('환자 UUID')} /></div>
            <div><label className="text-[10px] text-gray-500"><T k="수탁기관 *" /></label>
              <select value={form.referenceLabId} onChange={e => setForm({ ...form, referenceLabId: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                <option value=""><T k="선택" /></option>
                {refLabs.map((lab: ReferenceLab) => <option key={lab.id} value={lab.id}>{lab.name} ({lab.code})</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="검사명 *" /></label>
              <input value={form.testName} onChange={e => setForm({ ...form, testName: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="BRCA 1/2" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="검체 유형" /></label>
              <select value={form.sampleType} onChange={e => setForm({ ...form, sampleType: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                <option value=""><T k="선택" /></option>
                <option value="BLOOD"><T k="혈액 (Blood)" /></option><option value="EDTA">EDTA Blood</option>
                <option value="SERUM"><T k="혈청 (Serum)" /></option><option value="URINE"><T k="소변 (Urine)" /></option>
                <option value="TISSUE"><T k="조직 (Tissue)" /></option><option value="FFPE">FFPE</option>
                <option value="SALIVA"><T k="타액 (Saliva)" /></option>
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="임상 정보" /></label>
              <input value={form.clinicalInfo} onChange={e => setForm({ ...form, clinicalInfo: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('유방암 가족력')} /></div>
          </div>
          <button onClick={() => createMut.mutate()} disabled={!form.patientId || !form.referenceLabId || !form.testName || createMut.isPending}
            className="min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            <T k={createMut.isPending ? '의뢰 중...' : '의뢰 등록'} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="수탁기관" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="예정일" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : sendOuts.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="위탁검사가 없습니다" /></td></tr>
              ) : sendOuts.map((s: SendOutEntry) => (
                <tr key={s.id} onClick={() => setSelectedId(s.id)}
                  className={`border-b border-gray-50 cursor-pointer ${selectedId === s.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[s.status]}`}><T k={STATUS_LABEL[s.status]} /></span></td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{s.patient?.familyName}{s.patient?.givenName}</p>
                    <p className="text-[10px] text-gray-400">{s.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700"><LabTerm name={s.testName} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.referenceLab?.name}</td>
                  <td className="px-4 py-3 text-[10px] text-gray-400">{s.expectedDate ? kdate(s.expectedDate, 'monthDay') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedId ? (
            <p className="text-sm text-gray-400 text-center py-8"><T k="위탁검사를 선택하세요" /></p>
          ) : !detail ? (
            <p className="text-xs text-gray-400 text-center py-4"><T k="로딩 중..." /></p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900"><LabTerm name={detail.testName} /></h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[detail.status]}`}><T k={STATUS_LABEL[detail.status]} /></span>
              </div>

              <div className="bg-blue-50 rounded-xl p-3 text-xs space-y-1">
                <div><span className="text-blue-500"><T k="환자:" /></span> <span className="text-gray-900 font-medium">{detail.patient?.familyName}{detail.patient?.givenName}</span> ({detail.patient?.mrn})</div>
                <div><span className="text-blue-500"><T k="수탁:" /></span> <span className="text-gray-700">{detail.referenceLab?.name} ({detail.referenceLab?.code})</span></div>
                <div><span className="text-blue-500"><T k="의뢰자:" /></span> <span className="text-gray-700">{detail.requester?.familyName}{detail.requester?.givenName}</span></div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                {detail.sampleType && <div><span className="text-gray-400"><T k="검체:" /></span> <span className="text-gray-700">{detail.sampleType}</span></div>}
                {detail.sampleBarcode && <div><span className="text-gray-400"><T k="바코드:" /></span> <span className="font-mono text-indigo-600">{detail.sampleBarcode}</span></div>}
                {detail.trackingNumber && <div><span className="text-gray-400"><T k="운송번호:" /></span> <span className="font-mono text-gray-700">{detail.trackingNumber}</span></div>}
                {detail.expectedDate && <div><span className="text-gray-400"><T k="예정일:" /></span> <span className="text-gray-700">{kdate(new Date(detail.expectedDate))}</span></div>}
                {detail.clinicalInfo && <div><span className="text-gray-400"><T k="임상정보:" /></span> <span className="text-gray-700">{detail.clinicalInfo}</span></div>}
              </div>

              {detail.resultFileUrl && (
                <div className="bg-emerald-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-emerald-700 mb-1"><T k="결과 파일" /></p>
                  <a href={detail.resultFileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline"><T k="결과 보기 / 다운로드" /></a>
                </div>
              )}
              {detail.resultSummary && (
                <div className="bg-emerald-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-emerald-700 mb-1"><T k="결과 요약" /></p>
                  <p className="text-xs text-gray-700">{detail.resultSummary}</p>
                </div>
              )}

              {/* 상태 변경 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {detail.status === 'ORDERED' && (
                  <button onClick={() => statusMut.mutate({ id: detail.id, status: 'SENT' })}
                    className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><T k="발송" /></button>
                )}
                {detail.status === 'SENT' && (
                  <button onClick={() => statusMut.mutate({ id: detail.id, status: 'TESTING' })}
                    className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"><T k="검사중" /></button>
                )}
                {detail.status === 'TESTING' && (
                  <button onClick={() => statusMut.mutate({ id: detail.id, status: 'RESULT_RECEIVED' })}
                    className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="결과도착" /></button>
                )}
                {detail.status === 'RESULT_RECEIVED' && (
                  <button onClick={() => statusMut.mutate({ id: detail.id, status: 'REPORTED' })}
                    className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-gray-600 text-white rounded-lg hover:bg-gray-700"><T k="보고완료" /></button>
                )}
                {detail.status !== 'REPORTED' && detail.status !== 'CANCELLED' && (
                  <button onClick={() => statusMut.mutate({ id: detail.id, status: 'CANCELLED' })}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600"><T k="취소" /></button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
