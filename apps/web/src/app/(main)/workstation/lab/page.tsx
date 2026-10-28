'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { SpecimenCollectionControl } from '@/components/workstation/SpecimenCollectionControl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { PatientAddModal } from '@/components/workstation/PatientAddModal';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { printOrderLabel } from '@/lib/print';
import { Duration, EmptyState, Unit, genderText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

// label 은 표시 문자열이 아니라 **t() 키**다(소비처가 `<T k=…>`)
const LAB_STATIONS = [
  { id: 'lab-phlebotomy', label: '채혈실', icon: '🩸' },
  { id: 'lab-hematology', label: '혈액검사@검사실', icon: '🔬' },
  { id: 'lab-chemistry', label: '생화학', icon: '⚗️' },
  { id: 'lab-urinalysis', label: '소변검사', icon: '🧪' },
  { id: 'lab-microbiology', label: '미생물', icon: '🦠' },
];

// label = t() 키 · '접수'는 nav Reception(창구)이 선점하므로 상태 문맥 키로 가른다
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ORDERED: { label: '대기', cls: 'bg-gray-100 text-gray-600' },
  RECEIVED: { label: '접수@상태', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
};

interface ResultItem {
  name: string; value: string; unit: string; refRange: string; finding: string;
}

/** 참고범위를 숫자 구간으로 읽을 수 있는가 — 읽지 못하면 자동 제안을 하지 않는다(모르면 미판정) */
const canJudgeRange = (refRange?: string): boolean =>
  !!refRange && /(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/.test(refRange);

function isOutOfRange(value: string, refRange: string): boolean {
  if (!value || !refRange) return false;
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  const match = refRange.match(/(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/);
  if (!match) return false;
  return num < parseFloat(match[1]) || num > parseFloat(match[2]);
}

export default function LabWorkstationPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [station, setStation] = useState('lab-hematology');
  const [tab, setTab] = useState<'queue' | 'completed'>('queue');
  const [resultTarget, setResultTarget] = useState<any>(null);
  const [resultItems, setResultItems] = useState<ResultItem[]>([]);
  const [showWarning, setShowWarning] = useState(false);
  const [deltaData, setDeltaData] = useState<any>(null);
  /** 🔴 조회 실패를 "없음"으로 말하지 않기 위한 실패 플래그(서식·이전결과·서식목록). */
  const [loadFailed, setLoadFailed] = useState<{ template: boolean; delta: boolean; templateList: boolean }>({ template: false, delta: false, templateList: false });
  const [calledId, setCalledId] = useState<string | null>(null);
  const [allTemplates, setAllTemplates] = useState<any[]>([]);
  // 🔴 오더의 처방코드로 입력 양식이 자동으로 붙었는지 — 안 붙었으면 그 사실을 밝힌다
  const [templateAutoMatched, setTemplateAutoMatched] = useState(true);
  const [showAddPatient, setShowAddPatient] = useState(false);

  const stationInfo = LAB_STATIONS.find((s) => s.id === station)!;

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-lab-queue', station],
    queryFn: () => apiClient.get<any>(`/api/v1/workstation/station/${station}/queue`),
    refetchInterval: 8000,
  });
  const allOrders = queueRes?.data ?? [];
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const activeOrders = allOrders.filter((o: any) => o.status !== 'COMPLETED');
  const completedOrders = allOrders.filter((o: any) => o.status === 'COMPLETED');

  const receive = useMutation({
    mutationFn: (orderId: string) => apiClient.patch(`/api/v1/workstation/order/${orderId}/receive`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-lab-queue'] }); toast.success('검체 접수 완료'); },
  });
  const start = useMutation({
    mutationFn: (orderId: string) => apiClient.patch(`/api/v1/workstation/order/${orderId}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-lab-queue'] }); toast.success('검사 시작'); },
  });
  const completeResult = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: any }) =>
      apiClient.post<{ data: { outOfRangeButNormal?: { name: string; value: string; refRange: string; direction: string }[]; itemsEntered?: number } }>(
        `/api/v1/workstation/lab/${orderId}/results`, body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['ws-lab-queue'] });
      setResultTarget(null); setShowWarning(false);
      /**
       * 🔴 참고범위를 벗어났는데 '정상'으로 기록된 항목을 **되묻는다**(2026-08-21 검사 흐름 검토).
       *    자동으로 이상 처리하지 않는다 — 임상 판단은 사람의 것이다. 다만 조용히 넘기지도 않는다.
       */
      const gaps = res?.data?.outOfRangeButNormal ?? [];
      if (gaps.length > 0) {
        toast.warning(
          `결과는 저장했습니다 — 다만 참고범위를 벗어났는데 '정상'으로 기록된 항목이 ${gaps.length}/${res?.data?.itemsEntered ?? gaps.length}건 있습니다: ` +
          gaps.slice(0, 3).map((g) => `${g.name} ${g.value}(참고 ${g.refRange})`).join(' · ') +
          (gaps.length > 3 ? ` 외 ${gaps.length - 3}건` : ''),
        );
      } else {
        toast.success('결과 저장 완료');
      }
    },
    onError: () => toast.error('결과 입력 실패'),
  });

  const openResultModal = async (item: any) => {
    setResultTarget(item);
    setDeltaData(null);
    try {
      // 🔴 세 조회를 전부 `.catch(() => null)` 로 접으면 **실패가 "없음"으로 읽힌다** —
      //    특히 델타 체크가 실패하면 이전 결과 패널이 그냥 안 그려져 검사자는 **비교 대상이 있었다는 사실조차
      //    모른 채** 결과를 입력한다. 조각별로 실패를 붙잡아 화면이 말하게 한다.
      const settled = await Promise.allSettled([
        apiClient.get<any>(`/api/v1/workstation/lab/${item.orderId}/template`),
        apiClient.get<any>(`/api/v1/workstation/lab/${item.orderId}/delta-check`),
        apiClient.get<any>('/api/v1/workstation/templates'),
      ]);
      const val = (i: number) => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<any>).value : null);
      const [tmplRes, deltaRes, allTmplRes] = [val(0), val(1), val(2)];
      setLoadFailed({
        template: settled[0].status === 'rejected',
        delta: settled[1].status === 'rejected',
        templateList: settled[2].status === 'rejected',
      });
      setAllTemplates(allTmplRes?.data ?? []);
      const tmpl = tmplRes?.data;
      setTemplateAutoMatched(!!(tmpl?.items && Array.isArray(tmpl.items) && tmpl.items.length > 0));
      if (tmpl?.items && Array.isArray(tmpl.items) && tmpl.items.length > 0) {
        setResultItems(tmpl.items.map((t: any) => ({
          name: t.name, value: '', unit: t.unit ?? '', refRange: t.refRange ?? '', finding: '',
        })));
      } else {
        setResultItems([{ name: '', value: '', unit: '', refRange: '', finding: '' }]);
      }
      if (deltaRes?.data) setDeltaData(deltaRes.data);
    } catch {
      setLoadFailed({ template: true, delta: true, templateList: true });
      setTemplateAutoMatched(false);
      setResultItems([{ name: '', value: '', unit: '', refRange: '', finding: '' }]);
    }
  };

  const applyTemplate = (code: string) => {
    const tmpl = allTemplates.find((t: any) => t.procedureCode === code);
    if (tmpl?.items) {
      setResultItems(tmpl.items.map((t: any) => ({
        name: t.name, value: '', unit: t.unit ?? '', refRange: t.refRange ?? '', finding: '',
      })));
    }
  };

  const markAllNormal = () => {
    // 🔴 '전부 정상'은 검사자의 **명시적 선언**이라 남긴다 — 초기값이 정상인 것과는 다르다
    setResultItems(resultItems.map((i) => ({ ...i, finding: 'NORMAL' })));
  };

  const addItem = () => setResultItems([...resultItems, { name: '', value: '', unit: '', refRange: '', finding: '' }]);
  const updateItem = (idx: number, field: string, value: string) => {
    const copy = [...resultItems];
    (copy[idx] as any)[field] = value;
    /**
     * 자동 **제안**(판정이 아니다). 🔴 `isOutOfRange` 는 참고범위가 없거나 `<5`·`≤200` 처럼
     *    `10-20` 꼴이 아니면 무조건 `false` 를 준다 — 종전엔 그것을 그대로 `NORMAL` 로 적어
     *    **모르는 값을 '정상'이라고 원장에 남겼다**(2026-09-02). 읽을 수 있는 범위일 때만 제안하고,
     *    검사자가 이미 고른 판정(특히 CRITICAL)은 덮지 않는다.
     */
    if (field === 'value' && canJudgeRange(copy[idx].refRange) && copy[idx].finding !== 'CRITICAL') {
      copy[idx].finding = isOutOfRange(value, copy[idx].refRange) ? 'ABNORMAL' : 'NORMAL';
    }
    setResultItems(copy);
  };
  const removeItem = (idx: number) => setResultItems(resultItems.filter((_, i) => i !== idx));

  const handleSubmit = () => {
    const validItems = resultItems.filter((i) => i.name && i.value);
    const outOfRange = validItems.filter((i) => isOutOfRange(i.value, i.refRange));
    if (outOfRange.length > 0 && !showWarning) {
      setShowWarning(true);
      return;
    }
    completeResult.mutate({ orderId: resultTarget.orderId, body: { items: validItems } });
  };

  const waitMinutes = (t: string) => t ? Math.round((Date.now() - new Date(t).getTime()) / 60000) : 0;

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{stationInfo.icon} <T k={stationInfo.label} /> <T k="워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">대기 {activeOrders.length}<Unit>건</Unit> · 완료 {completedOrders.length}<Unit>건</Unit></p>
        </div>
        <button onClick={() => setShowAddPatient(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm">
          + <T k="환자 추가" />
        </button>
      </div>

      {/* 스테이션 탭 */}
      <div className="flex gap-1.5">
        {LAB_STATIONS.map((s) => (
          <button key={s.id} onClick={() => setStation(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              station === s.id ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}>{s.icon} <T k={s.label} /></button>
        ))}
      </div>

      {/* 예정(사전처방) — 오늘~+2일 시행 예정 미결 사전처방 (시약·검체 용기 사전 준비용, read-only) */}
      <UpcomingPreOrders />

      {/* 대기/완료 탭 */}
      <div className="flex gap-1 border-b border-gray-100 pb-1">
        <button onClick={() => setTab('queue')}
          className={`px-3 py-1.5 text-xs font-medium rounded-t ${tab === 'queue' ? 'bg-gray-100 text-gray-800 border-b-2 border-gray-800' : 'text-gray-400'}`}>
          <T k="대기열" /> ({activeOrders.length})
        </button>
        <button onClick={() => setTab('completed')}
          className={`px-3 py-1.5 text-xs font-medium rounded-t ${tab === 'completed' ? 'bg-gray-100 text-gray-800 border-b-2 border-gray-800' : 'text-gray-400'}`}>
          <T k="완료" /> ({completedOrders.length})
        </button>
      </div>

      {/* Worklist */}
      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><div className="animate-pulse text-3xl mb-2">🔬</div><T k="로딩 중..." /></div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : (tab === 'queue' ? activeOrders : completedOrders).length === 0 ? (
        <EmptyState icon="🔬" title={tab === 'queue' ? '대기 중인 검사가 없습니다' : '완료된 검사가 없습니다'} />
      ) : (
        <div className="space-y-2">
          {(tab === 'queue' ? activeOrders : completedOrders).map((item: any, idx: number) => (
            <div key={item.orderId}
              className={`bg-white border rounded-xl p-4 ${item.priority === 'STAT' ? 'border-red-300 bg-red-50/30 ring-1 ring-red-200' : ''} ${calledId === item.orderId ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* 대기 번호 */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                    calledId === item.orderId ? 'bg-blue-600 text-white animate-pulse' : 'bg-gray-100 text-gray-500'
                  }`}>{idx + 1}</div>
                  {item.priority === 'STAT' && <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded animate-pulse">STAT</span>}
                  <div>
                    <span className="font-semibold text-gray-900">{item.patient?.familyName}{item.patient?.givenName}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {genderText(item.patient?.gender)}/{item.patient?.age}세 · {item.patient?.mrn}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 font-medium">{item.procedureName || item.procedureCode}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_BADGE[item.status]?.cls ?? 'bg-gray-100'}`}>
                    <T k={STATUS_BADGE[item.status]?.label ?? item.status} />
                  </span>
                  {item.receivedAt && (
                    <span className="text-[10px] text-gray-400"><Duration minutes={waitMinutes(item.receivedAt)} /> <T k="경과" /></span>
                  )}
                </div>
              </div>

              {/* 검체 채취(2026-10-01) — 접수와 다른 사건. 채혈실은 채혈하며 누르고, 병동 채취분은 기록이 따라온다 */}
              <div className="mt-2">
                <SpecimenCollectionControl orderId={item.orderId} collectedAt={item.specimenCollectedAt} collectorName={item.specimenCollectorName}
                  source={item.specimenCollectionSource} invalidateKeys={[['ws-lab-queue']]} compact={item.status === 'ORDERED' && station !== 'lab-phlebotomy'} />
              </div>

              {/* 상태별 프로그레스 */}
              <div className="flex items-center gap-1 mt-2.5">
                {['ORDERED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED'].map((s, idx) => {
                  const steps = ['ORDERED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED'];
                  const currentIdx = steps.indexOf(item.status);
                  const done = idx <= currentIdx;
                  return (
                    <div key={s} className="flex items-center gap-1 flex-1">
                      <div className={`h-1 flex-1 rounded-full ${done ? 'bg-blue-500' : 'bg-gray-100'}`} />
                    </div>
                  );
                })}
              </div>

              {/* 액션 */}
              {tab === 'queue' && (
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    {item.status === 'ORDERED' && (
                      <>
                        <button onClick={() => { setCalledId(item.orderId); toast.success(`${item.patient?.familyName}${item.patient?.givenName}님 호출`); }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium shadow-sm ${
                            calledId === item.orderId ? 'bg-blue-700 text-white animate-pulse' : 'bg-white border border-blue-300 text-blue-600 hover:bg-blue-50'
                          }`}>
                          <T k={calledId === item.orderId ? '호출 중...' : '환자 호출'} />
                        </button>
                        <button onClick={() => receive.mutate(item.orderId)}
                          className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 shadow-sm"><T k="검체 접수" /></button>
                      </>
                    )}
                    {item.status === 'RECEIVED' && (
                      <button onClick={() => start.mutate(item.orderId)}
                        className="min-h-[44px] px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-medium hover:bg-amber-600"><T k="검사 시작" /></button>
                    )}
                    <button onClick={() => printOrderLabel(item.orderId)} title="검체 라벨 인쇄(워크스테이션 기본 라벨프린터)"
                      className="px-2.5 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-50">🖨 <T k="라벨" /></button>
                    {(item.status === 'RECEIVED' || item.status === 'IN_PROGRESS') && (
                      <button onClick={() => openResultModal(item)}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-medium hover:bg-emerald-700 shadow-sm"><T k="결과 입력" /></button>
                    )}
                  </div>
                  {item.createdAt && (
                    <span className="text-[10px] text-gray-400"><T k="오더" /> <Duration minutes={waitMinutes(item.createdAt)} /> 전</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 결과 입력 모달 */}
      {resultTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setResultTarget(null); setShowWarning(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-bold text-gray-900"><T k="검사 결과 입력" /></h3>
                <p className="text-sm text-gray-500">{resultTarget.patient?.familyName}{resultTarget.patient?.givenName} — {resultTarget.procedureName || resultTarget.procedureCode}</p>
              </div>
              <button onClick={() => { setResultTarget(null); setShowWarning(false); }} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {/* 🔴 입력 양식이 자동으로 붙지 않았음을 밝힌다.
                   검사 코드 체계가 둘인데(템플릿 `HbA1c` / 처방 `E6591`) 잇는 다리가 없어
                   **자동 연결이 한 번도 성공하지 않는다**(교집합 0·2026-08-12 실측).
                   종전엔 조용히 빈 행 하나로 떨어져, 참고범위 없이 자유 입력하게 됐다. */}
              {(loadFailed.template || loadFailed.templateList) && (
                <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
                  {loadFailed.template && <p>검사 서식을 불러오지 못했습니다 — <b>서식이 없는 것이 아닙니다.</b> 항목을 직접 입력하게 됩니다.</p>}
                  {loadFailed.templateList && <p>서식 목록을 불러오지 못했습니다 — 아래 선택 목록이 비어 있는 것은 <b>등록된 서식이 없다는 뜻이 아닙니다.</b></p>}
                </div>
              )}
              {!templateAutoMatched && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-semibold">이 검사의 입력 양식이 자동으로 연결되지 않았습니다</span>
                  {' '}— 아래에서 직접 고르면 항목·단위·참고범위가 채워집니다.
                </div>
              )}

              {/* 템플릿 선택 + 빠른 액션 */}
              <div className="flex items-center gap-2 mb-4">
                <select className="border rounded-xl px-3 py-2 text-sm flex-1"
                  onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); }}
                  defaultValue="">
                  <option value="">{tAttr('템플릿 선택 (항목 자동채움)...')}</option>
                  {allTemplates.map((t: any) => (
                    <option key={t.procedureCode} value={t.procedureCode}>
                      <LabTerm name={t.testName} /> ({t.procedureCode}) — {t.items?.length}항목
                    </option>
                  ))}
                </select>
                <button onClick={markAllNormal}
                  className="px-3 py-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-xs font-medium hover:bg-emerald-100 whitespace-nowrap">
                  <T k="전체 정상" />
                </button>
                <button onClick={async () => {
                  const code = prompt('템플릿 코드 (영문, 예: CBC_CUSTOM):');
                  if (!code) return;
                  const name = prompt('템플릿 이름:', resultTarget?.procedureName ?? '');
                  if (!name) return;
                  try {
                    await apiClient.post('/api/v1/workstation/templates', {
                      procedureCode: code.toUpperCase(),
                      testName: name,
                      stationId: station,
                      items: resultItems.filter((i) => i.name).map((i) => ({ name: i.name, unit: i.unit, refRange: i.refRange })),
                    });
                    toast.success(`템플릿 "${name}" 저장 완료`);
                  } catch { toast.error('템플릿 저장 실패 (코드 중복?)'); }
                }}
                  className="px-3 py-2 bg-gray-50 text-gray-500 border border-gray-200 rounded-xl text-xs hover:bg-gray-100 whitespace-nowrap">
                  <T k="템플릿으로 저장" />
                </button>
              </div>

              {/* 참고범위 경고 */}
              {showWarning && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm font-medium text-red-700">참고범위를 벗어난 항목이 있습니다</p>
                  <ul className="mt-1 text-xs text-red-600 list-disc list-inside">
                    {resultItems.filter((i) => isOutOfRange(i.value, i.refRange)).map((i, idx) => (
                      <li key={idx}>{i.name}: {i.value} {i.unit} (참고: {i.refRange})</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-red-500">그래도 저장하시겠습니까?</p>
                </div>
              )}

              {/* 델타 체크 — 🔴 실패는 "이전 결과 없음"이 아니다 */}
              {loadFailed.delta && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs font-medium text-amber-800">이전 결과를 불러오지 못했습니다 — <b>이전 결과가 없다는 뜻이 아닙니다.</b></p>
                  <p className="text-[11px] text-amber-700 mt-0.5">비교가 필요한 검사라면 조회 후 입력하십시오. 입력은 막지 않습니다.</p>
                </div>
              )}
              {!loadFailed.delta && deltaData && !(deltaData.items?.length > 0) && (
                <p className="mb-4 text-[11px] text-gray-400"><T k="비교할 이전 결과가 없습니다." /></p>
              )}
              {deltaData?.items && deltaData.items.length > 0 && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-xs font-medium text-blue-700 mb-1">이전 결과 ({deltaData.completedAt ?kdate(deltaData.completedAt, 'date') : ''})</p>
                  <div className="flex flex-wrap gap-2">
                    {deltaData.items.slice(0, 8).map((prev: any, idx: number) => (
                      <span key={idx} className="text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                        <LabTerm name={prev.testName} />: {prev.value}{prev.unit}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 결과 테이블 */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left py-1.5 w-36"><T k="항목" /></th>
                    <th className="text-left py-1.5 w-24"><T k="결과값" /></th>
                    <th className="text-left py-1.5 w-16"><T k="단위" /></th>
                    <th className="text-left py-1.5 w-24"><T k="참고범위" /></th>
                    <th className="text-center py-1.5 w-14"><T k="판정" /></th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {resultItems.map((item, idx) => {
                    const oor = isOutOfRange(item.value, item.refRange);
                    return (
                      <tr key={idx} className={`border-b border-gray-50 ${oor ? 'bg-red-50' : ''}`}>
                        <td className="py-1.5">
                          <input className={`w-full border rounded-lg px-2 py-1.5 text-xs ${item.name ? 'bg-gray-50 text-gray-700' : ''}`} placeholder={tAttr('검사항목명')}
                            value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)} readOnly={!!item.refRange} tabIndex={-1} />
                        </td>
                        <td className="py-1.5">
                          <input className={`w-full border rounded-lg px-2 py-1.5 text-xs font-mono ${oor ? 'border-red-400 text-red-700 font-bold' : ''}`}
                            placeholder={tAttr('결과@입력')} value={item.value} onChange={(e) => updateItem(idx, 'value', e.target.value)}
                            autoFocus={idx === 0} tabIndex={idx + 1} />
                        </td>
                        <td className="py-1.5">
                          <input className="w-full border rounded-lg px-2 py-1.5 text-xs text-gray-500" placeholder={tAttr('단위')}
                            value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} readOnly={!!item.unit} />
                        </td>
                        <td className="py-1.5">
                          <span className="text-xs text-gray-400 font-mono">{item.refRange || '-'}</span>
                        </td>
                        <td className="py-1.5 text-center">
                          {/* 🔴 **검사자가 '위급'을 고를 화면이 없었다**(2026-09-02). 서버는 `finding === 'CRITICAL'`
                              인 항목만 모아 위급값 통보(IPSG.2)를 발행하는데 이 칸이 읽기 전용이라
                              **그 경로로는 위급값 통보가 발동할 수 없었다.** */}
                          <select
                            value={item.finding}
                            onChange={(e) => updateItem(idx, 'finding', e.target.value)}
                            aria-label={`${item.name || '항목'} 판정`}
                            className={`min-h-[32px] w-full border rounded-lg px-1 py-1 text-[10px] font-bold bg-white ${
                              item.finding === 'CRITICAL' ? 'text-red-600 border-red-300' : item.finding === 'ABNORMAL' ? 'text-amber-600 border-amber-300' : item.finding === 'NORMAL' ? 'text-emerald-600' : 'text-gray-400'
                            }`}
                          >
                            <option value="">미판정</option>
                            <option value="NORMAL">정상</option>
                            <option value="ABNORMAL">이상</option>
                            <option value="CRITICAL">위급</option>
                          </select>
                        </td>
                        <td className="py-1.5 text-center">
                          <button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500 text-xs">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button onClick={addItem} className="mt-2 text-xs text-blue-600 hover:underline">+ <T k="항목 추가" /></button>
            </div>
            <div className="px-5 py-4 border-t flex justify-between items-center flex-shrink-0">
              <div className="text-xs text-gray-400">
                {resultItems.filter((i) => i.name && i.value).length}개 항목
                {resultItems.filter((i) => isOutOfRange(i.value, i.refRange)).length > 0 && (
                  <span className="text-red-500 ml-2">
                    ({resultItems.filter((i) => isOutOfRange(i.value, i.refRange)).length}개 범위 초과)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setResultTarget(null); setShowWarning(false); }}
                  className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
                <button onClick={handleSubmit}
                  disabled={resultItems.filter((i) => i.name && i.value).length === 0}
                  className={`min-h-[48px] px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-50 shadow-sm ${
                    showWarning ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}>
                  <T k={showWarning ? '경고 확인 후 저장' : '결과 저장 + 완료'} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 환자 추가 모달 */}
      {showAddPatient && (
        <PatientAddModal
          stationType="lab"
          stationId={station}
          onClose={() => setShowAddPatient(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ['ws-lab-queue'] })}
        />
      )}
    </div>
  );
}

/* ── 예정 사전처방 (P2) — 오늘~+2일 시행 예정 미결 검사/영상 사전처방. read-only 사전 준비용 ── */
interface UpcomingPreOrder {
  id: string; type: string; status: string; scheduledDate?: string;
  activationMode?: string;
  patient?: { mrn?: string; familyName?: string; givenName?: string };
  doctor?: { familyName?: string; givenName?: string };
  procedureCode?: { code?: string; nameKo?: string };
  appointment?: { scheduledAt?: string; status?: string } | null;
}

function UpcomingPreOrders() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['preorder-upcoming-lab'],
    queryFn: () => apiClient.get<{ data: { data?: UpcomingPreOrder[] } | UpcomingPreOrder[] }>('/api/v1/pre-orders/upcoming-lab', { days: 2 }),
    refetchInterval: pollMs('slow'),
  });
  const raw = data?.data as unknown;
  const items: UpcomingPreOrder[] = Array.isArray(raw) ? raw as UpcomingPreOrder[] : ((raw as { data?: UpcomingPreOrder[] })?.data ?? []);

  if (!items.length) return null;

  return (
    <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-xs font-semibold text-violet-800">📝 <T k="예정 사전처방" /> {items.length}<Unit>건</Unit> <T k="(오늘~+2일 — 사전 준비용)" /></span>
        <span className="text-violet-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {items.map(it => (
            <div key={it.id} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-1.5">
              <span className="font-mono text-gray-400">{(it.appointment?.scheduledAt ?? it.scheduledDate ?? '').slice(0, 10)}</span>
              <span className="font-medium text-gray-900">{it.patient?.familyName}{it.patient?.givenName}</span>
              <span className="text-gray-400">{it.patient?.mrn}</span>
              <span className="flex-1 text-gray-700 truncate">{it.procedureCode?.nameKo ?? it.type}</span>
              {it.activationMode === 'ON_CHECKIN' && (
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded whitespace-nowrap" title="접수 시 자동으로 검사 오더로 전환됨"><T k="접수 시 자동" /></span>
              )}
              <span className="text-gray-400 whitespace-nowrap">{it.doctor ? `${it.doctor.familyName}${it.doctor.givenName}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
