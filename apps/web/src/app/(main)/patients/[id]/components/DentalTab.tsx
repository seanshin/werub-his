'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import DentalChartDiagram from '@/components/specialty/DentalChartDiagram';
import type { ToothStatus } from '@/components/specialty/DentalChartDiagram';
import ToothSurfaceDiagram from '@/components/specialty/ToothSurfaceDiagram';
import PerioChart from '@/components/specialty/PerioChart';
import { derivePerio } from '@/lib/dental-perio';
import { ImagingTab } from './ImagingTab';
import { money, kdate } from '@/lib/ui-settings';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, useTAttr } from '@/components/ui/i18n-text';

const CATEGORY_LABEL: Record<string, string> = { RESTORATION: '수복', RCT: '근관', EXTRACTION: '발치', PROSTHESIS: '보철', IMPLANT: '임플란트', ORTHODONTIC: '교정', PERIO: '치주', SURGERY: '수술', PREVENTIVE: '예방', COSMETIC: '심미' };
const TOOTH_STATUS_LABEL: Record<string, string> = { NORMAL: '정상', CARIES: '우식', MISSING: '결손', CROWN: '크라운', BRIDGE: '브릿지', IMPLANT: '임플란트', RCT: '근관치료', FILLING: '충전', EXTRACTION_NEEDED: '발치필요' };
const TOOTH_STATUS_COLOR: Record<string, string> = { NORMAL: 'bg-emerald-100 text-emerald-700', CARIES: 'bg-red-100 text-red-700', MISSING: 'bg-gray-200 text-gray-600', CROWN: 'bg-amber-100 text-amber-700', BRIDGE: 'bg-violet-100 text-violet-700', IMPLANT: 'bg-blue-100 text-blue-700', RCT: 'bg-orange-100 text-orange-700', FILLING: 'bg-teal-100 text-teal-700', EXTRACTION_NEEDED: 'bg-rose-100 text-rose-700' };

const LAB_STATUS_LABEL: Record<string, string> = {
  ORDERED: '의뢰', IMPRESSION_TAKEN: '인상채득', SENT: '발송', IN_FABRICATION: '제작중',
  RECEIVED: '수령', FITTED: '시적', CEMENTED: '장착완료',
};
const LAB_STATUS_COLOR: Record<string, string> = {
  ORDERED: 'bg-gray-200 text-gray-700', IMPRESSION_TAKEN: 'bg-indigo-100 text-indigo-700',
  SENT: 'bg-amber-100 text-amber-700', IN_FABRICATION: 'bg-orange-100 text-orange-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700', FITTED: 'bg-blue-100 text-blue-700',
  CEMENTED: 'bg-teal-100 text-teal-700',
};
const LAB_STATUS_FLOW = ['ORDERED', 'IMPRESSION_TAKEN', 'SENT', 'IN_FABRICATION', 'RECEIVED', 'FITTED', 'CEMENTED'];

interface LabOrderForm {
  tooth: string; orderType: string; material: string; shade: string;
  labName: string; dueDate: string;
}
const emptyLabForm: LabOrderForm = { tooth: '', orderType: 'CROWN', material: '', shade: '', labName: '', dueDate: '' };

type DentalSubTab = 'chart' | 'plans' | 'records' | 'labOrders' | 'pacs';

interface DentalTabProps {
  patientId: string;
  patientMrn: string;
}

export function DentalTab({ patientId, patientMrn }: DentalTabProps) {
  const tAttr = useTAttr();
  const [tab, setTab] = useState<DentalSubTab>('chart');
  const [labForm, setLabForm] = useState<LabOrderForm>(emptyLabForm);
  const [showLabForm, setShowLabForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: chartData, isLoading: chartLoading, isError, error, refetch } = useQuery({
    queryKey: ['dental-chart', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/chart/${patientId}`),
    enabled: tab === 'chart' && !!patientId,
  });

  const { data: plansData, isLoading: plansLoading, isError: plansIsError, error: plansError, refetch: refetchPlans } = useQuery({
    queryKey: ['dental-plans', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/plans/${patientId}`),
    enabled: tab === 'plans' && !!patientId,
  });

  const { data: recordsData, isLoading: recordsLoading, isError: recordsIsError, error: recordsError, refetch: refetchRecords } = useQuery({
    queryKey: ['dental-records', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/records/${patientId}`),
    enabled: tab === 'records' && !!patientId,
  });

  const { data: labOrdersData, isLoading: labOrdersLoading, isError: labOrdersIsError, error: labOrdersError, refetch: refetchLabOrders } = useQuery({
    queryKey: ['dental-lab-orders', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/lab-orders${patientId ? `?patientId=${patientId}` : ''}`),
    enabled: tab === 'labOrders',
  });

  const labOrderMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/dental/lab-orders', payload),
    onSuccess: () => {
      toast.success('기공의뢰가 생성되었습니다');
      queryClient.invalidateQueries({ queryKey: ['dental-lab-orders'] });
      setShowLabForm(false);
      setLabForm(emptyLabForm);
    },
    onError: () => toast.error('기공의뢰 생성에 실패했습니다'),
  });

  const labStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/dental/lab-orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('상태가 변경되었습니다');
      queryClient.invalidateQueries({ queryKey: ['dental-lab-orders'] });
    },
    onError: () => toast.error('상태 변경에 실패했습니다'),
  });

  const handleLabSubmit = useCallback(() => {
    if (!labForm.tooth || !labForm.material) { toast.error('치아번호와 재료를 입력하세요'); return; }
    labOrderMutation.mutate({
      patientId,
      tooth: labForm.tooth,
      orderType: labForm.orderType,
      material: labForm.material,
      ...(labForm.shade ? { shade: labForm.shade } : {}),
      ...(labForm.labName ? { labName: labForm.labName } : {}),
      ...(labForm.dueDate ? { dueDate: labForm.dueDate } : {}),
    });
  }, [patientId, labForm, labOrderMutation]);

  const getNextStatus = (current: string): string | null => {
    const idx = LAB_STATUS_FLOW.indexOf(current);
    return idx >= 0 && idx < LAB_STATUS_FLOW.length - 1 ? LAB_STATUS_FLOW[idx + 1] : null;
  };

  const charts: Record<string, unknown>[] = (() => { const r = chartData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const plans: Record<string, unknown>[] = (() => { const r = plansData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const records: Record<string, unknown>[] = (() => { const r = recordsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const labOrders: Record<string, unknown>[] = (() => { const r = labOrdersData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);

  const teethStatusForDiagram: ToothStatus[] = useMemo(() => {
    const result: ToothStatus[] = [];
    charts.forEach((c) => {
      const teeth = (c.teethStatus as Array<Record<string, unknown>>) ?? [];
      teeth.forEach((t) => {
        result.push({
          tooth: (t.tooth as string) ?? '',
          status: (t.status as string) ?? 'NORMAL',
          notes: (t.notes as string) ?? undefined,
        });
      });
    });
    return result;
  }, [charts]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'chart' as DentalSubTab, label: '치아차트' },
          { key: 'plans' as DentalSubTab, label: '치료계획' },
          { key: 'records' as DentalSubTab, label: '치료기록' },
          { key: 'labOrders' as DentalSubTab, label: '기공의뢰' },
          { key: 'pacs' as DentalSubTab, label: '영상(PACS)' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 치아차트 */}
      {tab === 'chart' && (
        <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <DentalChartDiagram
            teethStatus={teethStatusForDiagram}
            selectedTooth={selectedTooth}
            onToothClick={setSelectedTooth}
            mode="view"
          />
        </div>

        {selectedTooth && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <ToothSurfaceDiagram
              tooth={selectedTooth}
              surfaces={(() => {
                const ts = teethStatusForDiagram.find((t) => t.tooth === selectedTooth);
                if (!ts) return [];
                return [
                  { surface: 'O', status: ts.status },
                  { surface: 'B', status: 'NORMAL' },
                  { surface: 'L', status: 'NORMAL' },
                  { surface: 'M', status: 'NORMAL' },
                  { surface: 'D', status: 'NORMAL' },
                ];
              })()}
              onSurfaceClick={(surface) => toast.info(`치아 #${selectedTooth} ${surface}면 선택`)}
            />
          </div>
        )}

        {charts.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {(() => {
              // 상수 대신 실측 치주값(정본 derivePerio) — 부서 화면과 같은 파생을 쓴다
              const perio = derivePerio(charts);
              return perio.teeth.length > 0
                ? <PerioChart teeth={perio.teeth} pocketDepths={perio.pocketDepths} bleeding={perio.bleeding} mobility={perio.mobility} />
                : <div className="py-8 text-center text-sm text-gray-400"><T k="치주 측정 기록 없음" /></div>;
            })()}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아번호" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="표면" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기록일" /></th>
            </tr></thead>
            <tbody>
              {chartLoading ? <LoadingRows cols={5} />
              : charts.every((c) => !(((c.teethStatus as unknown[]) ?? []).length)) ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="치아차트 없음" /></td></tr>
              : charts.map((c) => {
                const teeth = (c.teethStatus as Array<Record<string, unknown>>) ?? [];
                return teeth.map((t, i) => (
                  <tr key={`${c.id as string}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(t.tooth as string) ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TOOTH_STATUS_COLOR[t.status as string] ?? 'bg-gray-100'}`}>{TOOTH_STATUS_LABEL[t.status as string] ?? (t.status as string)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{((t.surfaces as string[]) ?? []).join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{(t.notes as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{c.chartedAt ? kdate(c.chartedAt as string) : '-'}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* 치료계획 */}
      {tab === 'plans' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="분류" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="우선" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="비용" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="보험" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
            </tr></thead>
            <tbody>
              {plansIsError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={plansError} onRetry={refetchPlans} size="compact" /></td></tr>
              : plansLoading ? <LoadingRows cols={7} />
              : plans.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="치료계획 없음" /></td></tr>
              : plans.map((p) => (
                <tr key={p.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(p.tooth as string)}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{(p.procedure as string)}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{CATEGORY_LABEL[p.category as string] ?? (p.category as string)}</span></td>
                  <td className="px-4 py-3 text-xs font-bold text-gray-900">{(p.priority as number) ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{p.estimatedCost ? `${money(Number(p.estimatedCost))}` : '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{p.insuranceCovered === true ? 'Y' : p.insuranceCovered === false ? 'N' : '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge domain="plan" status={p.status as string} className="text-[10px] font-bold whitespace-nowrap" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 치료기록 */}
      {tab === 'records' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="재료" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="마취" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">X-ray</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr></thead>
            <tbody>
              {recordsIsError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={recordsError} onRetry={refetchRecords} size="compact" /></td></tr>
              : recordsLoading ? <LoadingRows cols={7} />
              : records.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="치료기록 없음" /></td></tr>
              : records.map((r) => {
                const doctor = r.treatedByUser as Record<string, unknown> | undefined;
                return (
                  <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(r.tooth as string)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(r.procedure as string)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(r.material as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(r.anesthesia as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{r.xrayTaken ? 'O' : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(doctor?.familyName as string) ?? ''}{(doctor?.givenName as string) ?? ''}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{r.treatedAt ? kdate(r.treatedAt as string) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 기공의뢰 */}
      {tab === 'labOrders' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowLabForm(!showLabForm)}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              {showLabForm ? '취소' : '+ 기공의뢰 작성'}
            </button>
          </div>

          {showLabForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500"><T k="치아번호" /></label>
                  <input type="text" value={labForm.tooth} onChange={(e) => setLabForm(prev => ({ ...prev, tooth: e.target.value }))}
                    placeholder={tAttr("예: 16")} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="의뢰유형" /></label>
                  <select value={labForm.orderType} onChange={(e) => setLabForm(prev => ({ ...prev, orderType: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm">
                    {['CROWN', 'BRIDGE', 'INLAY', 'ONLAY', 'DENTURE', 'VENEER', 'IMPLANT_ABUTMENT', 'ORTHODONTIC', 'NIGHT_GUARD', 'RETAINER'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="재료" /></label>
                  <input type="text" value={labForm.material} onChange={(e) => setLabForm(prev => ({ ...prev, material: e.target.value }))}
                    placeholder={tAttr("지르코니아, PFM, 골드")} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500"><T k="쉐이드" /></label>
                  <input type="text" value={labForm.shade} onChange={(e) => setLabForm(prev => ({ ...prev, shade: e.target.value }))}
                    placeholder="A2, B1" className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="기공소" /></label>
                  <input type="text" value={labForm.labName} onChange={(e) => setLabForm(prev => ({ ...prev, labName: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="납기일" /></label>
                  <input type="date" value={labForm.dueDate} onChange={(e) => setLabForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={handleLabSubmit} disabled={labOrderMutation.isPending}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {labOrderMutation.isPending ? '저장 중...' : '기공의뢰 저장'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="재료" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="쉐이드" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기공소" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="납기" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="액션" /></th>
              </tr></thead>
              <tbody>
                {labOrdersIsError ? <tr><td colSpan={8} className="px-4 py-3"><QueryErrorFallback error={labOrdersError} onRetry={refetchLabOrders} size="compact" /></td></tr>
                : labOrdersLoading ? <LoadingRows cols={8} />
                : labOrders.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="기공의뢰 없음" /></td></tr>
                : labOrders.map((lo) => {
                  const next = getNextStatus(lo.status as string);
                  return (
                    <tr key={lo.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(lo.tooth as string)}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{(lo.orderType as string)}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{(lo.material as string)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{(lo.shade as string) ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{(lo.labName as string) ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{lo.dueDate ? kdate(lo.dueDate as string) : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${LAB_STATUS_COLOR[lo.status as string] ?? 'bg-gray-100'}`}>
                          {LAB_STATUS_LABEL[lo.status as string] ?? (lo.status as string)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {next && (
                          <button
                            onClick={() => labStatusMutation.mutate({ id: lo.id as string, status: next })}
                            disabled={labStatusMutation.isPending}
                            className="text-[10px] font-medium px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap disabled:opacity-50">
                            {LAB_STATUS_LABEL[next]}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 영상(PACS) — 치과 파노라마·치근단·CBCT 등. 영상탭과 동일 풀연동(스터디 목록·OHIF 뷰어·판독) */}
      {tab === 'pacs' && <ImagingTab patientMrn={patientMrn} />}
    </div>
  );
}
