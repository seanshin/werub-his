'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { Term } from '@/components/ui/term';
import InstrumentsTab from './components/InstrumentsTab';
import InterfaceTab from './components/InterfaceTab';
import WorksheetTab from './components/WorksheetTab';
import SendOutTab from './components/SendOutTab';
import CellTherapyTab from './components/CellTherapyTab';
import GenomicsTab from './components/GenomicsTab';
import QcTab from './components/QcTab';
import VerifyTab from './components/VerifyTab';
import StatusBadge from '@/components/ui/StatusBadge';

// 상태 라벨/색 — shared ORDER_DEPT_STATUS_LABEL + StatusBadge(domain='orderDept')로 일원화(UX P1 마이그레이션)

type FilterStatus = 'ALL' | 'ORDERED' | 'IN_PROGRESS';
// '접수 대기' 버킷 = ORDERED+RECEIVED — 서버 큐·collect() 가 둘 다 다루는데 화면이 ORDERED 만 보면
// RECEIVED 건은 어느 탭에도 안 잡히고 검체접수 버튼도 사라진다(P3·P8 잠복·2026-08-13 W3)
const isPendingCollect = (status: string) => status === 'ORDERED' || status === 'RECEIVED';
type LabTab = 'queue' | 'verify' | 'worksheet' | 'sendout' | 'celltherapy' | 'genomics' | 'qc' | 'instruments' | 'interface';

interface LabPatient {
  familyName?: string;
  givenName?: string;
  mrn?: string;
}

interface LabProcedureCode {
  code?: string;
  nameKo?: string;
}

interface LabPrescription {
  procedureCode?: LabProcedureCode;
  instructions?: string;
  encounter?: { patient?: LabPatient };
}

interface LabOrder {
  id: string;
  status: string;
  createdAt?: string;
  prescription?: LabPrescription;
}

interface ResultItem {
  testName: string;
  value: string;
  unit: string;
  normalMin: string;
  normalMax: string;
  testCode?: string;   // 코드마스터 검사코드 — 지정 시 BE가 LOINC 자동 해소
  loincCode?: string;  // 표준 LOINC(피커 자동 채움)
}

interface LabTestCodeOption {
  code: string;
  loincCode?: string;
  nameKo?: string;
  nameEn?: string;
  unit?: string;
  specimen?: string;
  category?: string;
  refRangeMale?: string;
  refRangeFemale?: string;
}

// "13.0-17.5" / "0.8~1.2" 형태만 수치 범위로 파싱(그 외 <200·Negative·빈값은 무시)
function parseRange(s?: string): [string, string] | null {
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
  return m ? [m[1], m[2]] : null;
}

// 검사코드 마스터(GET /api/v1/codes/lab-tests) 검색 피커 — 선택 시 상위로 콜백
function TestCodePicker({ onSelect }: { onSelect: (opt: LabTestCodeOption) => void }) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['lab-test-codes', q],
    queryFn: () => apiClient.get<{ data: LabTestCodeOption[] }>(`/api/v1/codes/lab-tests?q=${encodeURIComponent(q.trim())}`),
    enabled: open && q.trim().length >= 1,
  });
  const opts = data?.data ?? [];
  return (
    <div className="relative">
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/40 rounded-lg text-xs"
        placeholder={tAttr('🔍 검사코드 마스터 검색 (예: HbA1c, CRP) — 선택 시 LOINC 자동')} />
      {open && q.trim().length >= 1 && opts.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {opts.map(o => (
            <button key={o.code} type="button"
              onMouseDown={e => { e.preventDefault(); onSelect(o); setQ(''); setOpen(false); }}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-indigo-50 border-b border-gray-50 last:border-0">
              {/* 표시만 용어 모드를 따른다 — 선택 시 저장되는 testName(:218)은 불변(표기 선호≠저장 값) */}
              <span className="font-medium text-gray-800"><Term nameKo={o.nameKo} nameEn={o.nameEn} /></span>
              <span className="ml-1.5 text-[10px] text-gray-400">{o.code}{o.loincCode ? ` · LOINC ${o.loincCode}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<LabTab>('queue');

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="검사실" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="검체 접수 / 장비 관리 / 결과 수신" /></p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'queue' as LabTab, label: '검사 대기열' },
          { key: 'verify' as LabTab, label: '검증 대기' },
          { key: 'worksheet' as LabTab, label: '검사기록지' },
          { key: 'sendout' as LabTab, label: '위탁검사' },
          { key: 'celltherapy' as LabTab, label: '세포치료' },
          { key: 'genomics' as LabTab, label: '유전체' },
          { key: 'qc' as LabTab, label: '정도관리' },
          { key: 'instruments' as LabTab, label: '장비 관리' },
          { key: 'interface' as LabTab, label: '파일 수신' },
        ]).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}><T k={t.label} /></button>
        ))}
      </div>

      {activeTab === 'verify' && <VerifyTab />}
      {activeTab === 'worksheet' && <WorksheetTab />}
      {activeTab === 'sendout' && <SendOutTab />}
      {activeTab === 'celltherapy' && <CellTherapyTab />}
      {activeTab === 'genomics' && <GenomicsTab />}
      {activeTab === 'qc' && <QcTab />}
      {activeTab === 'instruments' && <InstrumentsTab />}
      {activeTab === 'interface' && <InterfaceTab />}
      {activeTab === 'queue' && <QueueTab />}
    </div>
  );
}

function QueueTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showResultForm, setShowResultForm] = useState(false);
  const [resultItems, setResultItems] = useState<ResultItem[]>([{ testName: '', value: '', unit: '', normalMin: '', normalMax: '' }]);
  const [resultNotes, setResultNotes] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lab-queue'],
    queryFn: () => apiClient.get<{ data: LabOrder[] }>('/api/v1/lab/queue'),
    refetchInterval: 8000,
  });

  const collectMut = useMutation({
    mutationFn: (orderId: string) => apiClient.post(`/api/v1/lab/collect/${orderId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-queue'] }); toast.success('검체 접수 완료'); },
    onError: () => toast.error('검체 접수 실패'),
  });

  const submitResultMut = useMutation({
    mutationFn: ({ orderId, items, notes }: { orderId: string; items: { testName: string; value: string; unit?: string; normalMin?: number; normalMax?: number; testCode?: string; loincCode?: string }[]; notes?: string }) =>
      apiClient.post(`/api/v1/lab/result/${orderId}`, { items, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-queue'] });
      toast.success('검사 결과 입력 완료');
      setShowResultForm(false);
      setResultItems([{ testName: '', value: '', unit: '', normalMin: '', normalMax: '' }]);
      setResultNotes('');
    },
    onError: () => toast.error('결과 입력 실패'),
  });

  const _raw = data?.data;
  const allOrders: LabOrder[] = Array.isArray(_raw) ? _raw : (_raw as unknown as Record<string, unknown>)?.data as LabOrder[] ?? [];
  const filtered = filter === 'ALL' ? allOrders
    : filter === 'ORDERED' ? allOrders.filter(o => isPendingCollect(o.status))
    : allOrders.filter(o => o.status === filter);

  const counts = {
    ALL: allOrders.length,
    ORDERED: allOrders.filter(o => isPendingCollect(o.status)).length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS').length,
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const selectedOrder = allOrders.find(o => o.id === selectedId);

  const addResultItem = () => setResultItems([...resultItems, { testName: '', value: '', unit: '', normalMin: '', normalMax: '' }]);
  const removeResultItem = (idx: number) => setResultItems(resultItems.filter((_, i) => i !== idx));
  const updateResultItem = (idx: number, field: keyof ResultItem, val: string) => {
    const updated = [...resultItems];
    updated[idx] = { ...updated[idx], [field]: val };
    setResultItems(updated);
  };
  // 코드마스터 선택 → 검사명·단위·코드·LOINC·정상범위 자동 채움(사용자 수정 가능)
  const selectTestCode = (idx: number, o: LabTestCodeOption) => {
    const range = parseRange(o.refRangeMale) ?? parseRange(o.refRangeFemale);
    const updated = [...resultItems];
    updated[idx] = {
      ...updated[idx],
      testName: o.nameKo || o.nameEn || updated[idx].testName,
      unit: o.unit || updated[idx].unit,
      testCode: o.code,
      loincCode: o.loincCode,
      normalMin: range ? range[0] : updated[idx].normalMin,
      normalMax: range ? range[1] : updated[idx].normalMax,
    };
    setResultItems(updated);
  };
  const clearTestCode = (idx: number) => {
    const updated = [...resultItems];
    updated[idx] = { ...updated[idx], testCode: undefined, loincCode: undefined };
    setResultItems(updated);
  };

  const handleSubmitResult = () => {
    if (!selectedId) return;
    const validItems = resultItems.filter(i => i.testName && i.value);
    if (validItems.length === 0) return toast.warning('검사 항목을 입력하세요');
    submitResultMut.mutate({
      orderId: selectedId,
      items: validItems.map(i => ({
        testName: i.testName,
        value: i.value,
        unit: i.unit || undefined,
        normalMin: i.normalMin ? parseFloat(i.normalMin) : undefined,
        normalMax: i.normalMax ? parseFloat(i.normalMax) : undefined,
        testCode: i.testCode || undefined,
        loincCode: i.loincCode || undefined,
      })),
      notes: resultNotes || undefined,
    });
  };

  return (
    <div>
      {/* 워크플로우 */}
      <div className="flex items-center gap-1 mb-4 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@상태" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="검사@단계" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="결과입력" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium"><T k="보고" /></span>
        <span className="ml-auto flex items-center gap-1"><span className="text-gray-400"><T k="자동" /></span><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /></span>
      </div>

      {/* 필터 */}
      <div className="flex gap-1.5 mb-4">
        {([
          { key: 'ALL' as FilterStatus, label: '전체', count: counts.ALL },
          { key: 'ORDERED' as FilterStatus, label: '접수 대기', count: counts.ORDERED },
          { key: 'IN_PROGRESS' as FilterStatus, label: '검사 진행', count: counts.IN_PROGRESS },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={f.label} />
            {f.count > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{f.count}</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* 대기열 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="의뢰시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[130px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="대기 중인 검사가 없습니다" /></td></tr>
              ) : filtered.map((order: LabOrder) => {
                const patient = order.prescription?.encounter?.patient;
                // 코드 미연결 오더는 지시 내용으로 — '검사' 한 단어 폴백은 무엇을 채취할지 말하지 못한다(P4)
                const testName = order.prescription?.procedureCode?.nameKo ?? order.prescription?.instructions ?? '검사(코드 미지정)';
                const isSelected = selectedId === order.id;
                return (
                  <tr key={order.id} onClick={() => { setSelectedId(order.id); setShowResultForm(false); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-4 py-3">
                      <StatusBadge domain="orderDept" status={order.status} className="text-[10px] font-bold whitespace-nowrap" />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{patient?.familyName}{patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{testName}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {order.createdAt ?kdate(order.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isPendingCollect(order.status) && (
                        <button onClick={(e) => { e.stopPropagation(); collectMut.mutate(order.id); }}
                          className="px-2.5 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="검체접수" /></button>
                      )}
                      {order.status === 'IN_PROGRESS' && (
                        <button onClick={(e) => { e.stopPropagation(); setSelectedId(order.id); setShowResultForm(true); }}
                          className="px-2.5 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="결과입력" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 상세 + 결과 입력 패널 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedId ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
              <p className="text-sm text-gray-400"><T k="검사를 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="검사 상세" /></h3>
                <button onClick={() => { setSelectedId(null); setShowResultForm(false); }} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {selectedOrder && (
                <>
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <p className="text-xs text-indigo-600 font-medium"><T k="환자" /></p>
                    <p className="text-sm font-bold text-gray-900">
                      {selectedOrder.prescription?.encounter?.patient?.familyName}{selectedOrder.prescription?.encounter?.patient?.givenName}
                    </p>
                    <p className="text-[10px] text-gray-500">MRN: {selectedOrder.prescription?.encounter?.patient?.mrn}</p>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 font-medium"><T k="검사 정보" /></p>
                    <p className="text-sm font-bold text-gray-900">{selectedOrder.prescription?.procedureCode?.nameKo}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{selectedOrder.prescription?.procedureCode?.code}</p>
                    <StatusBadge domain="orderDept" status={selectedOrder.status} className="mt-1 inline-block text-[10px] font-bold" />
                  </div>

                  {/* 액션 */}
                  {selectedOrder.status === 'ORDERED' && (
                    <button onClick={() => collectMut.mutate(selectedOrder.id)}
                      className="w-full py-2.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      <T k="검체 접수" />
                    </button>
                  )}

                  {selectedOrder.status === 'IN_PROGRESS' && !showResultForm && (
                    <button onClick={() => setShowResultForm(true)}
                      className="w-full py-2.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                      <T k="결과 입력" />
                    </button>
                  )}

                  {/* 결과 입력 폼 */}
                  {showResultForm && selectedOrder.status === 'IN_PROGRESS' && (
                    <div className="space-y-3 border-t border-gray-100 pt-3">
                      <p className="text-xs font-bold text-emerald-700"><T k="검사 결과 입력" /></p>

                      {resultItems.map((item, idx) => (
                        <div key={idx} className="bg-emerald-50/50 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-gray-500"><T k="항목" /> {idx + 1}</span>
                            {resultItems.length > 1 && (
                              <button onClick={() => removeResultItem(idx)} className="text-[10px] text-red-500 hover:text-red-700"><T k="삭제" /></button>
                            )}
                          </div>
                          <TestCodePicker onSelect={o => selectTestCode(idx, o)} />
                          {item.testCode && (
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded"><T k="코드" /> {item.testCode}</span>
                              {item.loincCode && <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded">LOINC {item.loincCode}</span>}
                              <button type="button" onClick={() => clearTestCode(idx)} className="text-gray-400 hover:text-red-500"><T k="해제" /></button>
                            </div>
                          )}
                          <input value={item.testName} onChange={e => updateResultItem(idx, 'testName', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('검사명 (예: Hemoglobin)')} />
                          <div className="grid grid-cols-2 gap-2">
                            <input value={item.value} onChange={e => updateResultItem(idx, 'value', e.target.value)}
                              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('결과값')} />
                            <input value={item.unit} onChange={e => updateResultItem(idx, 'unit', e.target.value)}
                              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('단위 (g/dL)')} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input value={item.normalMin} onChange={e => updateResultItem(idx, 'normalMin', e.target.value)}
                              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('정상 하한')} type="number" step="0.1" />
                            <input value={item.normalMax} onChange={e => updateResultItem(idx, 'normalMax', e.target.value)}
                              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('정상 상한')} type="number" step="0.1" />
                          </div>
                        </div>
                      ))}

                      <button onClick={addResultItem} className="w-full py-1.5 text-xs text-indigo-600 border border-dashed border-indigo-200 rounded-lg hover:bg-indigo-50">
                        + <T k="항목 추가" />
                      </button>

                      <textarea value={resultNotes} onChange={e => setResultNotes(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs resize-none" rows={2} placeholder={tAttr('비고 (선택)')} />

                      <div className="flex gap-2">
                        <button onClick={handleSubmitResult} disabled={submitResultMut.isPending}
                          className="flex-1 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                          {submitResultMut.isPending ? <T k="전송 중..." /> : <T k="결과 제출" />}
                        </button>
                        <button onClick={() => setShowResultForm(false)}
                          className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
