'use client';

import { useVitalsThresholds, flagsWith } from '@/lib/vital-flags';
import { VitalSignsGrid, VitalSignsStrip } from '@/components/vitals/VitalSigns';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { kdate } from '@/lib/ui-settings';
import { useState, useMemo } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

/* ── 타입 ── */
interface PatientRef { familyName?: string; givenName?: string; mrn?: string; birthDate?: string; gender?: string }
interface Vitals {
  hr?: number;
  sbp?: number;
  dbp?: number;
  spo2?: number;
  temp?: number;
}
interface WsOrder {
  orderId: string;
  status: string;
  priority?: string;
  procedureName?: string;
  procedureCode?: string;
  createdAt?: string;
  patient?: PatientRef;
  ward?: string;
  bed?: string;
  vitals?: Vitals;
  ventilator?: string;
  ventilatorSettings?: string;
  apacheScore?: number;
  consciousnessLevel?: string;
  diagnosis?: string;
  attendingDoctor?: string;
}

/* ── 상수 ── */
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '접수대기',   cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수',       cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '모니터링',   cls: 'bg-rose-100 text-rose-700' },
  TREATING:    { label: '처치중',     cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',       cls: 'bg-emerald-100 text-emerald-700' },
  TRANSFERRED: { label: '전동',       cls: 'bg-purple-100 text-purple-700' },
  CANCELLED:   { label: '취소',       cls: 'bg-gray-200 text-gray-500' },
};

const PRIORITY_CLS: Record<string, string> = {
  STAT:   'bg-red-600 text-white',
  URGENT: 'bg-orange-500 text-white',
  PRN:    'bg-violet-500 text-white',
};

const APACHE_CLS = (score?: number): string => {
  if (!score) return 'text-gray-400';
  if (score >= 25) return 'text-red-700 font-bold';
  if (score >= 15) return 'text-orange-600 font-semibold';
  if (score >= 8)  return 'text-amber-600';
  return 'text-emerald-600';
};

const CONSCIOUSNESS_CLS: Record<string, string> = {
  ALERT:     'bg-emerald-50 text-emerald-700',
  VERBAL:    'bg-amber-50 text-amber-700',
  PAIN:      'bg-orange-50 text-orange-700',
  UNRESPONSIVE: 'bg-red-50 text-red-700',
};

type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'TREATING' | 'COMPLETED';

const CHECKLIST_ITEMS = [
  '환자 확인 (이름/등록번호)',
  '모니터링 접속 확인 (심전도/SpO2/NIBP)',
  '바이탈사인 기록',
  '투약 및 주입 속도 확인',
  '인공호흡기 설정 점검',
  '의식수준 평가 (AVPU/GCS)',
];

export default function IcuWorkstationPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});
  const vitalsRule = useVitalsThresholds();

  /* ── 대기열 ── */
  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-icu-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/icu/queue'),
    refetchInterval: 8000,
  });
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const allOrders: WsOrder[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw : [];
  }, [queueRes]);

  const counts = useMemo(() => ({
    ALL:         allOrders.length,
    ORDERED:     allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED').length,
    TREATING:    allOrders.filter(o => o.status === 'TREATING').length,
    COMPLETED:   allOrders.filter(o => o.status === 'COMPLETED' || o.status === 'TRANSFERRED').length,
  }), [allOrders]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allOrders;
    if (filter === 'IN_PROGRESS') return allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED');
    if (filter === 'COMPLETED') return allOrders.filter(o => o.status === 'COMPLETED' || o.status === 'TRANSFERRED');
    return allOrders.filter(o => o.status === filter);
  }, [allOrders, filter]);

  /* ── 상세 ── */
  const selectedOrder = allOrders.find(o => o.orderId === selectedId);

  /* ── 뮤테이션 ── */
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ws-icu-queue'] });
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),  onSuccess: () => { invalidate(); toast.success('접수 완료'); } });
  const start    = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/start`),    onSuccess: () => { invalidate(); toast.success('모니터링 시작'); } });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`), onSuccess: () => { invalidate(); toast.success('처치 완료'); } });

  /* ── 체크리스트 ── */
  const toggleCheck = (i: number) => setChecklist(prev => ({ ...prev, [i]: !prev[i] }));
  const allChecked = CHECKLIST_ITEMS.every((_, i) => checklist[i]);

  /* ── 바이탈 위험도 ── */
  // 🔴 (2026-10-01) 임계를 화면에 적지 않는다 — HR>130·SBP>180 등 이 화면만의 숫자였고, `hr && …` 이라 **HR 0 은 경보가 없었다**.
  //    판정은 임계 정본(shared + 환자안전위 개정). 이상수치 배지는 위급(CRITICAL)일 때만.
  const icuFlags = (v?: Vitals) => (v ? flagsWith(vitalsRule, { heartRate: v.hr ?? null, systolicBp: v.sbp ?? null, diastolicBp: v.dbp ?? null, spo2: v.spo2 ?? null, temperature: v.temp ?? null }) : null);
  const vitalAlert = (v?: Vitals): boolean => {
    const f = icuFlags(v);
    return !!f && Object.values(f).some((x) => x === 'CRITICAL');
  };

  const priority = (o: WsOrder) => o.priority ?? 'ROUTINE';

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="중환자실(ICU) 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="접수 → 모니터링 → 처치 → 완료" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/icu" className="px-3 py-1.5 text-xs font-medium bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100"><T k="ICU 메인" /></Link>
          <Link href="/inpatient" className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="입원관리" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '접수대기',   count: counts.ORDERED,     cls: 'text-gray-600 bg-gray-50' },
          { label: '모니터링',   count: counts.IN_PROGRESS, cls: 'text-rose-700 bg-rose-50' },
          { label: '처치중',     count: counts.TREATING,    cls: 'text-amber-700 bg-amber-50' },
          { label: '완료/전동',  count: counts.COMPLETED,   cls: 'text-emerald-700 bg-emerald-50' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70">{s.label}</p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 워크플로우 단계 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@상태" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-medium"><T k="모니터링" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="처치" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="완료" /></span>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey,         label: '전체' },
          { key: 'ORDERED' as FilterKey,     label: '접수대기' },
          { key: 'IN_PROGRESS' as FilterKey, label: '모니터링' },
          { key: 'TREATING' as FilterKey,    label: '처치중' },
          { key: 'COMPLETED' as FilterKey,   label: '완료' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {f.label}
            {counts[f.key] > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* 대기열 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="업무/병실" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="바이탈" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[55px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[130px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7} className="py-8"><QueryErrorFallback error={error} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 ICU 업무가 없습니다" /></td></tr>
              ) : filtered.map(o => {
                const pri = priority(o);
                const isSelected = selectedId === o.orderId;
                const alert = vitalAlert(o.vitals);
                return (
                  <tr key={o.orderId} onClick={() => { setSelectedId(o.orderId); setChecklist({}); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-rose-50' : 'hover:bg-gray-50/50'} ${pri === 'STAT' || alert ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {pri !== 'ROUTINE' && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_CLS[pri] ?? ''}`}>{pri}</span>
                      )}
                      {alert && pri === 'ROUTINE' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500 text-white whitespace-nowrap"><T k="위험" /></span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_MAP[o.status]?.cls ?? 'bg-gray-100'}`}>
                        {STATUS_MAP[o.status]?.label ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{o.patient?.familyName}{o.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{o.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-800 truncate max-w-[160px]">{o.procedureName ?? o.procedureCode ?? '-'}</p>
                      {(o.ward || o.bed) && <p className="text-[10px] text-gray-400">{o.ward} {o.bed}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {o.vitals ? (
                        // 표시 부품 정본 — 미측정 '—'("- bpm"·"-%" 아님) · 임계 정본 색
                        <VitalSignsStrip vitals={o.vitals as Record<string, unknown>} keys={['spo2', 'heartRate']} rule={vitalsRule} className="text-[10px]" />
                      ) : (
                        <span className="text-[10px] text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED'     && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>}
                        {o.status === 'RECEIVED'    && <button onClick={() => start.mutate(o.orderId)}   className="min-h-[44px] px-3 py-2 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"><T k="모니터링" /></button>}
                        {o.status === 'IN_PROGRESS' && <button onClick={() => complete.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="처치" /></button>}
                        {o.status === 'TREATING'    && <button onClick={() => complete.mutate(o.orderId)} className="min-h-[48px] px-3 py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 상세 패널 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedId ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-400"><T k="환자를 선택하세요" /></p>
            </div>
          ) : !selectedOrder ? (
            <div className="text-center py-6"><p className="text-xs text-gray-400"><T k="데이터를 찾을 수 없습니다" /></p></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="ICU 환자 상세" /></h3>
                <button onClick={() => { setSelectedId(null); setChecklist({}); }} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3 space-y-0.5">
                <p className="text-xs text-blue-600 font-medium"><T k="환자 정보" /></p>
                <p className="text-sm font-bold text-gray-900">{selectedOrder.patient?.familyName}{selectedOrder.patient?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {selectedOrder.patient?.mrn}</p>
                {selectedOrder.diagnosis && <p className="text-[10px] text-gray-500 mt-0.5">진단: {selectedOrder.diagnosis}</p>}
              </div>

              {/* 병실/침대 */}
              <div className="bg-rose-50 rounded-xl p-3">
                <p className="text-xs text-rose-600 font-medium mb-1"><T k="병실 / 침대" /></p>
                <div className="flex gap-3 text-sm">
                  <div><span className="text-gray-400 text-xs"><T k="병동:" /></span> <span className="font-semibold">{selectedOrder.ward ?? '-'}</span></div>
                  <div><span className="text-gray-400 text-xs"><T k="침대:" /></span> <span className="font-semibold">{selectedOrder.bed ?? '-'}</span></div>
                </div>
                {selectedOrder.attendingDoctor && (
                  <p className="text-[10px] text-gray-500 mt-1">주치의: {selectedOrder.attendingDoctor}</p>
                )}
              </div>

              {/* 바이탈사인 */}
              {selectedOrder.vitals && (
                <div className={`rounded-xl p-3 ${vitalAlert(selectedOrder.vitals) ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-600"><T k="바이탈사인" /></p>
                    {vitalAlert(selectedOrder.vitals) && (
                      <span className="text-[9px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded whitespace-nowrap"><T k="이상수치" /></span>
                    )}
                  </div>
                  {/* 표시 부품 정본 — sbp/dbp/temp 별칭을 읽고 미측정은 '—'(종전 "- bpm"·"-/- mmHg") */}
                  <VitalSignsGrid vitals={selectedOrder.vitals as Record<string, unknown>} keys={['spo2', 'systolicBp', 'heartRate', 'temperature']} rule={vitalsRule} columns={2} />
                  <VitalsRuleNote rule={vitalsRule} className="mt-2" />
                </div>
              )}

              {/* 인공호흡기 상태 */}
              {(selectedOrder.ventilator || selectedOrder.ventilatorSettings) && (
                <div className="bg-purple-50 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-purple-700 font-medium"><T k="인공호흡기" /></p>
                  <p className="text-sm font-semibold text-gray-800">{selectedOrder.ventilator ?? '-'}</p>
                  {selectedOrder.ventilatorSettings && (
                    <p className="text-[10px] text-gray-500 font-mono">{selectedOrder.ventilatorSettings}</p>
                  )}
                </div>
              )}

              {/* 중증도 (APACHE) */}
              {selectedOrder.apacheScore !== undefined && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-gray-500 font-medium"><T k="중증도 (APACHE II)" /></p>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${APACHE_CLS(selectedOrder.apacheScore)}`}>
                      {selectedOrder.apacheScore}
                    </span>
                    <span className="text-xs text-gray-400">점</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      selectedOrder.apacheScore >= 25 ? 'bg-red-100 text-red-700' :
                      selectedOrder.apacheScore >= 15 ? 'bg-orange-100 text-orange-700' :
                      selectedOrder.apacheScore >= 8  ? 'bg-amber-100 text-amber-700' :
                      'bg-emerald-100 text-emerald-700'}`}>
                      {selectedOrder.apacheScore >= 25 ? '고위험' :
                       selectedOrder.apacheScore >= 15 ? '중위험' :
                       selectedOrder.apacheScore >= 8  ? '경등도' : '저위험'}
                    </span>
                  </div>
                </div>
              )}

              {/* 의식수준 */}
              {selectedOrder.consciousnessLevel && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-gray-500 font-medium"><T k="의식수준" /></p>
                  <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full ${CONSCIOUSNESS_CLS[selectedOrder.consciousnessLevel] ?? 'bg-gray-100 text-gray-600'}`}>
                    {selectedOrder.consciousnessLevel}
                  </span>
                </div>
              )}

              {/* 체크리스트 */}
              <div className="bg-amber-50 rounded-xl p-3 space-y-2">
                <p className="text-xs text-amber-700 font-semibold"><T k="ICU 확인 체크리스트" /></p>
                <div className="space-y-1.5">
                  <LocalChecklistNotice className="mb-1.5" />
                  {CHECKLIST_ITEMS.map((item, i) => (
                    <label key={i} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!checklist[i]} onChange={() => toggleCheck(i)}
                        className="w-3.5 h-3.5 accent-rose-600" />
                      <span className={`text-xs ${checklist[i] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item}</span>
                    </label>
                  ))}
                </div>
                {allChecked && (
                  <p className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                    <T k="모든 항목 확인 완료" />
                  </p>
                )}
              </div>

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>
                )}
                {selectedOrder.status === 'RECEIVED' && (
                  <button onClick={() => start.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"><T k="모니터링 시작" /></button>
                )}
                {selectedOrder.status === 'IN_PROGRESS' && (
                  <button onClick={() => complete.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="처치 시작" /></button>
                )}
                {selectedOrder.status === 'TREATING' && (
                  <button onClick={() => complete.mutate(selectedOrder.orderId)} disabled={false} /* 🔴 가짜 게이트 제거 — 서버에 남지 않는 체크로 업무를 막지 않는다 */
                    className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    {allChecked ? '완료' : `체크리스트 ${Object.keys(checklist).filter(k => checklist[Number(k)]).length}/${CHECKLIST_ITEMS.length}`}
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
