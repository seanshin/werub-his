'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import SmartSignButton from '@/components/signature/SmartSignButton';
import { pollMs, kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface WorksheetSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  date: string;
  technician?: { familyName: string; givenName: string };
  instrument?: { name: string };
  items?: unknown[];
}

interface WorksheetItem {
  id: string;
  sequence: number;
  orderId: string;
  sampleBarcode?: string;
  sampleStatus?: string;
  order?: {
    prescription?: {
      procedureCode?: { nameKo?: string };
      encounter?: { patient?: { familyName: string; givenName: string } };
    };
    labResult?: { status?: string };
  };
}

interface WorksheetDetail {
  id: string;
  name: string;
  status: string;
  date: string;
  technician?: { familyName: string; givenName: string };
  instrument?: { name: string };
  items?: WorksheetItem[];
}

interface LabInstrument {
  id: string;
  name: string;
}

interface LabQueueItem {
  id: string;
  status: string;
  prescription?: {
    procedureCode?: { nameKo?: string };
    encounter?: { patient?: { familyName: string; givenName: string } };
  };
}

const STATUS_LABEL: Record<string, string> = { OPEN: '열림', IN_PROGRESS: '진행중', COMPLETED: '완료', SIGNED: '서명완료' };
const STATUS_COLOR: Record<string, string> = { OPEN: 'bg-blue-100 text-blue-700', IN_PROGRESS: 'bg-amber-100 text-amber-700', COMPLETED: 'bg-emerald-100 text-emerald-700', SIGNED: 'bg-gray-200 text-gray-600' };
const SAMPLE_STATUS: Record<string, string> = { NORMAL: '정상', HEMOLYSIS: '용혈', LIPEMIA: '지질혈', INSUFFICIENT: '양 부족', CLOTTED: '응고' };
const SAMPLE_COLOR: Record<string, string> = { NORMAL: 'text-emerald-600', HEMOLYSIS: 'text-red-600', LIPEMIA: 'text-amber-600', INSUFFICIENT: 'text-orange-600', CLOTTED: 'text-red-600' };
const CATEGORY_LABEL: Record<string, string> = { HEMATOLOGY: '혈액', CHEMISTRY: '생화학', IMMUNOLOGY: '면역', URINALYSIS: '요검사', COAGULATION: '응고', BLOOD_GAS: '혈액가스', SPECIAL: '특수' };

export default function WorksheetTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'HEMATOLOGY', instrumentId: '', date: kstToday(), notes: '' });
  const [barcodeInput, setBarcodeInput] = useState('');

  const { data: worksheetsData, isLoading } = useQuery({
    queryKey: ['lab-worksheets'],
    queryFn: () => apiClient.get<{ data: WorksheetSummary[] }>('/api/v1/lab/worksheets'),
    refetchInterval: pollMs('fast'),
  });

  const { data: detailData } = useQuery({
    queryKey: ['lab-worksheet-detail', selectedId],
    queryFn: () => apiClient.get<{ data: WorksheetDetail }>(`/api/v1/lab/worksheets/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: instrumentsData } = useQuery({
    queryKey: ['lab-instruments'],
    queryFn: () => apiClient.get<{ data: LabInstrument[] }>('/api/v1/lab/instruments'),
  });

  const { data: queueData } = useQuery({
    queryKey: ['lab-queue'],
    queryFn: () => apiClient.get<{ data: LabQueueItem[] }>('/api/v1/lab/queue'),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/lab/worksheets', {
      name: form.name || `${form.date} ${CATEGORY_LABEL[form.category] ?? form.category}`,
      category: form.category,
      instrumentId: form.instrumentId || undefined,
      date: form.date,
      notes: form.notes || undefined,
    }),
    onSuccess: (res: unknown) => {
      qc.invalidateQueries({ queryKey: ['lab-worksheets'] });
      setShowCreate(false);
      const resObj = res as Record<string, unknown> | undefined;
      const resData = resObj?.data as Record<string, unknown> | undefined;
      const id = ((resData?.data as unknown as Record<string, unknown>)?.id ?? resData?.id) as string | undefined;
      if (id) setSelectedId(id);
      toast.success('기록지가 생성되었습니다');
    },
    onError: () => toast.error('생성 실패'),
  });

  const addItemMut = useMutation({
    mutationFn: ({ wsId, orderId, barcode }: { wsId: string; orderId: string; barcode?: string }) =>
      apiClient.post(`/api/v1/lab/worksheets/${wsId}/items`, { orderId, sampleBarcode: barcode }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-worksheet-detail', selectedId] }); toast.success('검체 추가됨'); },
    onError: () => toast.error('추가 실패'),
  });

  const signMut = useMutation({
    mutationFn: (wsId: string) => apiClient.patch(`/api/v1/lab/worksheets/${wsId}/sign`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-worksheets'] }); qc.invalidateQueries({ queryKey: ['lab-worksheet-detail', selectedId] }); toast.success('서명 완료'); },
    onError: () => toast.error('서명 실패'),
  });

  const worksheets: WorksheetSummary[] = (() => { const r = worksheetsData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as WorksheetSummary[] ?? []; })();
  const detail: WorksheetDetail | null = detailData?.data ? ((detailData.data as unknown as Record<string, unknown>)?.data as WorksheetDetail ?? detailData.data) : null;
  const instruments: LabInstrument[] = (() => { const r = instrumentsData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as LabInstrument[] ?? []; })();
  const labQueue: LabQueueItem[] = (() => { const r = queueData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as LabQueueItem[] ?? []; })();
  const pendingOrders = labQueue.filter(o => o.status === 'ORDERED' || o.status === 'IN_PROGRESS');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="검사기록지" /></h3>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          <T k="+ 새 기록지" />
        </button>
      </div>

      {/* 생성 폼 */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-bold text-gray-700"><T k="새 검사기록지" /></p>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="날짜" /></label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="카테고리" /></label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="장비 (선택)" /></label>
              <select value={form.instrumentId} onChange={e => setForm({ ...form, instrumentId: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                <option value=""><T k="선택 안함" /></option>
                {instruments.map((inst: LabInstrument) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="기록지명 (자동)" /></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('자동 생성됨')} /></div>
          </div>
          <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
            className="px-4 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            <T k={createMut.isPending ? '생성 중...' : '기록지 생성'} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        {/* 기록지 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기록지명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="카테고리" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="장비" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="항목" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : worksheets.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="기록지가 없습니다. 새로 생성하세요." /></td></tr>
              ) : worksheets.map((ws: WorksheetSummary) => (
                <tr key={ws.id} onClick={() => setSelectedId(ws.id)}
                  className={`border-b border-gray-50 cursor-pointer ${selectedId === ws.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{ws.name}</p>
                    <p className="text-[10px] text-gray-400">{ws.technician?.familyName}{ws.technician?.givenName} · {kdate(new Date(ws.date))}</p>
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 whitespace-nowrap"><T k={CATEGORY_LABEL[ws.category] ?? ws.category} /></span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{ws.instrument?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-700 font-medium">{ws.items?.length ?? 0}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[ws.status]}`}><T k={STATUS_LABEL[ws.status]} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 기록지 상세 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedId ? (
            <p className="text-sm text-gray-400 text-center py-8"><T k="기록지를 선택하세요" /></p>
          ) : !detail ? (
            <p className="text-xs text-gray-400 text-center py-4"><T k="로딩 중..." /></p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900">{detail.name}</h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[detail.status]}`}><T k={STATUS_LABEL[detail.status]} /></span>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                <div><span className="text-gray-400"><T k="담당:" /></span> <span className="text-gray-700">{detail.technician?.familyName}{detail.technician?.givenName}</span></div>
                <div><span className="text-gray-400"><T k="장비:" /></span> <span className="text-gray-700">{detail.instrument?.name ?? <T k="미지정" />}</span></div>
                <div><span className="text-gray-400"><T k="날짜:" /></span> <span className="text-gray-700">{kdate(new Date(detail.date))}</span></div>
              </div>

              {/* 검체 목록 */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 mb-1.5"><Tf k="검체 목록 ({건수}건)" params={{ 건수: detail.items?.length ?? 0 }} /></p>
                <div className="space-y-1 max-h-[250px] overflow-y-auto">
                  {detail.items?.map((item: WorksheetItem) => {
                    const patient = item.order?.prescription?.encounter?.patient;
                    const testName = item.order?.prescription?.procedureCode?.nameKo ?? '';
                    return (
                      <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 font-mono w-5">#{item.sequence}</span>
                          {item.sampleBarcode && <span className="font-mono text-indigo-600 text-[10px]">{item.sampleBarcode}</span>}
                          <span className="font-medium text-gray-900">{patient?.familyName}{patient?.givenName}</span>
                          <span className="text-gray-500">{testName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {item.sampleStatus && item.sampleStatus !== 'NORMAL' && (
                            <span className={`text-[9px] font-bold ${SAMPLE_COLOR[item.sampleStatus] ?? 'text-gray-500'}`}>{SAMPLE_STATUS[item.sampleStatus]}</span>
                          )}
                          {item.order?.labResult?.status === 'COMPLETED' && <span className="text-[9px] text-emerald-600"><T k="완료" /></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 검체 추가 (대기 오더에서) */}
              {detail.status !== 'SIGNED' && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-[10px] font-bold text-gray-500"><T k="검체 추가" /></p>

                  {/* 바코드 입력 */}
                  <div className="flex gap-2">
                    <input value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && barcodeInput && pendingOrders[0]) {
                          addItemMut.mutate({ wsId: detail.id, orderId: pendingOrders[0].id, barcode: barcodeInput });
                          setBarcodeInput('');
                        }
                      }}
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-mono" placeholder={tAttr('바코드 스캔 또는 입력')} />
                  </div>

                  {/* 대기 오더에서 선택 */}
                  {pendingOrders.length > 0 && (
                    <div className="space-y-1 max-h-[120px] overflow-y-auto">
                      {pendingOrders.slice(0, 5).map((o: LabQueueItem) => {
                        const patient = o.prescription?.encounter?.patient;
                        const already = detail.items?.some((it: WorksheetItem) => it.orderId === o.id);
                        return (
                          <button key={o.id} disabled={already}
                            onClick={() => addItemMut.mutate({ wsId: detail.id, orderId: o.id })}
                            className={`w-full flex items-center justify-between p-2 rounded-lg text-xs text-left transition-colors ${
                              already ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-50 hover:bg-blue-100 text-gray-700'
                            }`}>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-900 font-medium">{patient?.familyName}{patient?.givenName}</span>
                              <span className="text-gray-500">{o.prescription?.procedureCode?.nameKo}</span>
                            </div>
                            <span className="text-[10px]"><T k={already ? '추가됨' : '+ 추가'} /></span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 액션 */}
              {detail.status !== 'SIGNED' && (
                <div className="pt-2 border-t border-gray-100">
                  <SmartSignButton
                    documentType="LAB_WORKSHEET"
                    documentId={detail.id}
                    documentTitle="검사기록지 서명"
                    onSign={() => signMut.mutate(detail.id)}
                    variant="small"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
