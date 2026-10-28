'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface InterfaceResult {
  id: string;
  status: string;
  instrument?: { name: string };
  fileName?: string;
  sampleBarcode?: string;
  matchedOrderId?: string;
  receivedAt: string;
  parsedItems?: ParsedItem[];
}

interface ParsedItem {
  testName?: string;
  testCode?: string;
  value: string;
  unit?: string;
  normalMin?: string | null;
  normalMax?: string | null;
}

interface LabInstrument {
  id: string;
  name: string;
}

const STATUS_COLOR: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700', MATCHED: 'bg-indigo-100 text-indigo-700',
  APPLIED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-red-100 text-red-700', ERROR: 'bg-red-100 text-red-700',
};

export default function InterfaceTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matchOrderId, setMatchOrderId] = useState('');

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ['lab-interface-pending'],
    queryFn: () => apiClient.get<{ data: InterfaceResult[] }>('/api/v1/lab/interface/pending'),
    refetchInterval: pollMs('fast'),
  });

  const { data: instrumentsData } = useQuery({
    queryKey: ['lab-instruments'],
    queryFn: () => apiClient.get<{ data: LabInstrument[] }>('/api/v1/lab/instruments'),
  });

  const matchMut = useMutation({
    mutationFn: ({ id, orderId }: { id: string; orderId: string }) =>
      apiClient.patch(`/api/v1/lab/interface/${id}/match`, { orderId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-interface-pending'] }); toast.success('매칭 완료'); setMatchOrderId(''); },
    onError: () => toast.error('매칭 실패'),
  });

  const applyMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/lab/interface/${id}/apply`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-interface-pending'] }); qc.invalidateQueries({ queryKey: ['lab-queue'] }); toast.success('결과 적용 완료'); },
    onError: () => toast.error('적용 실패'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/lab/interface/${id}/reject`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-interface-pending'] }); toast.success('거부 완료'); },
  });

  // CSV/TXT 파일 파싱 시뮬레이션 (실제로는 백엔드에서 파싱)
  const handleFileUpload = async (file: File, instrumentId: string) => {
    const text = await file.text();
    const lines = text.trim().split('\n');
    const parsedItems: ParsedItem[] = [];

    // 간단한 CSV 파싱 (헤더: testName,value,unit,normalMin,normalMax)
    const headers = lines[0]?.split(',').map(h => h.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length >= 2) {
        parsedItems.push({
          testName: cols[0],
          value: cols[1],
          unit: cols[2] || '',
          normalMin: cols[3] || null,
          normalMax: cols[4] || null,
        });
      }
    }

    try {
      await apiClient.post('/api/v1/lab/interface/receive', {
        instrumentId,
        rawData: { fileName: file.name, content: text.slice(0, 5000) },
        parsedItems,
        fileName: file.name,
        sampleBarcode: lines[1]?.split(',')[0] || undefined,
      });
      qc.invalidateQueries({ queryKey: ['lab-interface-pending'] });
      toast.success(`${file.name} 업로드 완료 — ${parsedItems.length}건 파싱됨`);
    } catch {
      toast.error('파일 업로드 실패');
    }
  };

  const pending: InterfaceResult[] = (() => { const r = pendingData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as InterfaceResult[] ?? []; })();
  const instruments: LabInstrument[] = (() => { const r = instrumentsData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as LabInstrument[] ?? []; })();
  const selected = pending.find(p => p.id === selectedId);

  const [uploadInstrumentId, setUploadInstrumentId] = useState('');

  return (
    <div className="space-y-4">
      {/* 파일 업로드 */}
      <div className="bg-white rounded-2xl border border-dashed border-indigo-200 p-5">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900 mb-1"><T k="장비 결과 파일 업로드" /></p>
            <p className="text-[10px] text-gray-500"><T k="CSV, TXT 파일을 업로드하면 자동으로 파싱하여 오더와 매칭합니다" /></p>
          </div>
          <select value={uploadInstrumentId} onChange={e => setUploadInstrumentId(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white w-[180px]">
            <option value=""><T k="장비 선택" /></option>
            {instruments.map((inst: LabInstrument) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
          </select>
          <label className={`px-4 py-2 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
            uploadInstrumentId ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}>
            <T k="파일 선택" />
            <input type="file" accept=".csv,.txt,.tsv" className="hidden" disabled={!uploadInstrumentId}
              onChange={e => { const f = e.target.files?.[0]; if (f && uploadInstrumentId) handleFileUpload(f, uploadInstrumentId); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* 수신 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="파일명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="항목수" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="수신시간" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : pending.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="수신 대기 결과가 없습니다" /></td></tr>
              ) : pending.map((r: InterfaceResult) => (
                <tr key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`border-b border-gray-50 cursor-pointer ${selectedId === r.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{r.instrument?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-mono truncate max-w-[200px]">{r.fileName ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{Array.isArray(r.parsedItems) ? r.parsedItems.length : '-'}</td>
                  <td className="px-4 py-3 text-[10px] text-gray-400">{kdate(r.receivedAt, 'time')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 + 매칭 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selected ? (
            <p className="text-sm text-gray-400 text-center py-8"><T k="수신 결과를 선택하세요" /></p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900"><T k="수신 상세" /></h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[selected.status]}`}>{selected.status}</span>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                <div><span className="text-gray-400"><T k="장비:" /></span> <span className="text-gray-700">{selected.instrument?.name}</span></div>
                <div><span className="text-gray-400"><T k="파일:" /></span> <span className="text-gray-700 font-mono">{selected.fileName}</span></div>
                {selected.sampleBarcode && <div><span className="text-gray-400"><T k="바코드:" /></span> <span className="text-gray-700 font-mono">{selected.sampleBarcode}</span></div>}
                {selected.matchedOrderId && <div><span className="text-gray-400"><T k="매칭 오더:" /></span> <span className="text-indigo-600 font-mono">{selected.matchedOrderId.slice(0, 8)}...</span></div>}
              </div>

              {/* 파싱된 항목 */}
              {Array.isArray(selected.parsedItems) && selected.parsedItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-1"><Tf k="파싱된 결과 ({건수}건)" params={{ 건수: selected.parsedItems.length }} /></p>
                  <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                    {selected.parsedItems.map((item: ParsedItem, i: number) => (
                      <div key={i} className="flex justify-between text-[10px] p-1.5 bg-gray-50 rounded">
                        <span className="text-gray-800">{item.testName ?? item.testCode}</span>
                        <span className="font-mono text-gray-600">{item.value} {item.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 수동 매칭 */}
              {(selected.status === 'RECEIVED') && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-[10px] font-bold text-gray-500"><T k="수동 매칭" /></p>
                  <input value={matchOrderId} onChange={e => setMatchOrderId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('오더 ID 입력')} />
                  <button onClick={() => { if (matchOrderId) matchMut.mutate({ id: selected.id, orderId: matchOrderId }); }}
                    disabled={!matchOrderId}
                    className="w-full py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"><T k="매칭" /></button>
                </div>
              )}

              {/* 액션 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selected.status === 'MATCHED' && (
                  <button onClick={() => applyMut.mutate(selected.id)}
                    className="flex-1 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                    <T k="결과 적용" />
                  </button>
                )}
                {(selected.status === 'RECEIVED' || selected.status === 'MATCHED') && (
                  <button onClick={() => rejectMut.mutate({ id: selected.id, reason: '수동 거부' })}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600">
                    <T k="거부" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
