'use client';

import { useState, useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { localInputToIso } from '@/lib/flowsheet-form';
import { scoreNews2, normalizeAcvpu, NEWS2_RISK_LABEL, AI_ORIGIN_TEXT, bradenRiskLevel, BRADEN_RISK_LABEL, morseRiskLevel, MORSE_RISK_LABEL } from '@hospital-run/shared';
import { toast } from '@/stores/toast-store';
import {
  MedDoubleCheckPanel, DoubleCheckBypassBadge, doubleCheckScopeOf, doubleCheckReady,
  doubleCheckPayload, EMPTY_DOUBLE_CHECK, type DoubleCheckValue,
} from '@/components/nursing/MedDoubleCheck';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import { WardSpecimenPendingPanel } from '@/components/workstation/WardSpecimenPendingPanel';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';

/* ── 타입 ── */
interface PatientRef { familyName?: string; givenName?: string; mrn?: string }
interface WsOrder {
  orderId: string; status: string; priority?: string;
  procedureName?: string; procedureCode?: string; createdAt?: string;
  patient?: PatientRef;
  admissionId?: string; roomName?: string; bedNumber?: string; departmentName?: string;
  orderType?: string; notes?: string; patientId?: string; encounterId?: string;
}

interface VitalForm {
  systolicBp: string; diastolicBp: string; heartRate: string;
  temperature: string; respiratoryRate: string; spo2: string;
  painScale: string; consciousness: string;
  /** 보충산소 — '' = 미관측(0점으로 접지 않는다) · 'Y' | 'N' */
  supplementalO2: string;
  /** 측정 시각(datetime-local) — '' = 비움(서버가 "측정 시각 미상"으로 기록 · 지금으로 지어내지 않는다) */
  measuredAtLocal?: string;
}

/**
 * 🔴 P11 — `/api/v1/admissions/:id/medication-schedule` 은 Prisma 원형을 그대로 준다.
 *    종전 타입의 `medicationName`·`scheduledTime` 은 응답에 없어 **항상 undefined** 였고,
 *    화면은 모든 투약을 '약물'·시간 공란으로 표시했다.
 */
interface MarItem {
  id: string; prescriptionId?: string;
  scheduledAt?: string; status: string; dose?: string; route?: string; notes?: string | null;
  prescription?: {
    route?: string | null;
    medicationCode?: { nameKo?: string; highAlertFlag?: boolean; highAlertCategory?: string | null };
  };
}

/** 약품명 — 없으면 null(모르는 것을 '약물'로 말하지 않는다) */
const marMedName = (m: MarItem): string | null => m.prescription?.medicationCode?.nameKo ?? null;

/**
 * 🔴 label 은 **표시 문자열이 아니라 t() 키**다(유일 소비처가 `<T k=…>` — ko 렌더는 `@문맥` 이 잘려 동일).
 *    '접수'를 그대로 두면 nav 의 Reception(접수 창구)이 선점해 **오더 상태 Received 가 'Reception'** 으로
 *    번역된다 — 동음이의는 문맥 키로 가른다.
 */
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '대기',   cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수@상태', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',   cls: 'bg-emerald-100 text-emerald-700' },
};

type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';

/* ── 간호 업무 카테고리 ── (label = t() 키 · 위 STATUS_MAP 주석 참조) */
const ORDER_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  VITAL_SIGNS:    { label: '활력징후', cls: 'bg-rose-50 text-rose-700' },
  // '투약' 은 status 정본이 Administered(투약 완료)로 선점 — 여기는 **업무 분류**다
  MEDICATION:     { label: '투약@업무', cls: 'bg-violet-50 text-violet-700' },
  IV_FLUID:       { label: '수액',     cls: 'bg-sky-50 text-sky-700' },
  WOUND_CARE:     { label: '상처관리', cls: 'bg-amber-50 text-amber-700' },
  ASSESSMENT:     { label: '사정',     cls: 'bg-indigo-50 text-indigo-700' },
  PATIENT_EDUCATION: { label: '교육',  cls: 'bg-teal-50 text-teal-700' },
  IO_MONITORING:  { label: 'I/O',     cls: 'bg-cyan-50 text-cyan-700' },
  BLOOD_SUGAR:    { label: '혈당',     cls: 'bg-orange-50 text-orange-700' },
};

/* ── NEWS2 계산 ── */
/**
 * 🔴 2026-08-19 수렴 전 이 화면에는 자기 채점판이 있었고 **보충산소 2점 항목이 통째로 없었다.**
 *    산소를 투여 중인 환자를 서버보다 2점 낮게 표시했고, 위험등급 밴드도 정본과 달랐다
 *    (총점 1~4 를 '저위험' amber 로, 단일 3점 규칙은 아예 없었다).
 *    채점은 shared `scoreNews2`(RCP 2017) 하나로 위임한다 — 여기에 점수표를 적지 않는다.
 * 🔴 7요소가 다 관측되지 않으면 **산출하지 않는다**(점수 대신 무엇이 없는지 말한다).
 */
function calcNEWS2(v: VitalForm): { score: number | null; risk: string; cls: string; missing: string[] } {
  const num = (x: string) => (x.trim() === '' || !Number.isFinite(Number(x)) ? undefined : Number(x));
  const input = {
    respiratoryRate: num(v.respiratoryRate),
    spO2: num(v.spo2),
    supplementalO2: v.supplementalO2 === 'Y' ? true : v.supplementalO2 === 'N' ? false : undefined,
    systolicBp: num(v.systolicBp),
    heartRate: num(v.heartRate),
    temperature: num(v.temperature),
    consciousness: normalizeAcvpu(v.consciousness) ?? undefined,
  };
  const r = scoreNews2(input);
  if (!r) {
    const missing: string[] = [];
    if (input.respiratoryRate === undefined) missing.push('호흡수');
    if (input.spO2 === undefined) missing.push('SpO2');
    if (input.supplementalO2 === undefined) missing.push('보충산소');
    if (input.systolicBp === undefined) missing.push('수축기혈압');
    if (input.heartRate === undefined) missing.push('맥박');
    if (input.temperature === undefined) missing.push('체온');
    if (input.consciousness === undefined) missing.push('의식');
    return { score: null, risk: '산출 불가', cls: 'bg-gray-100 text-gray-600', missing };
  }
  const cls =
    r.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700'
    : r.riskLevel === 'MEDIUM' ? 'bg-orange-100 text-orange-700'
    : r.riskLevel === 'LOW_MEDIUM' ? 'bg-amber-100 text-amber-700'
    : 'bg-emerald-100 text-emerald-700';
  return { score: r.totalScore, risk: NEWS2_RISK_LABEL[r.riskLevel], cls, missing: [] };
}

/* ── Morse Fall Scale ── */
const MORSE_ITEMS = [
  { key: 'fallHistory', label: '최근 3개월 낙상 이력', options: [{ v: 0, l: '없음' }, { v: 25, l: '있음' }] },
  { key: 'secondaryDx', label: '이차 진단', options: [{ v: 0, l: '없음' }, { v: 15, l: '있음' }] },
  { key: 'ambulatoryAid', label: '보행 보조 기구', options: [{ v: 0, l: '없음' }, { v: 15, l: '가구/지팡이' }, { v: 30, l: '기타' }] },
  { key: 'ivTherapy', label: 'IV/Heparin Lock', options: [{ v: 0, l: '없음' }, { v: 20, l: '있음' }] },
  { key: 'gait', label: '보행 상태', options: [{ v: 0, l: '정상/침상안정' }, { v: 10, l: '허약' }, { v: 20, l: '장애' }] },
  { key: 'mentalStatus', label: '인지 상태', options: [{ v: 0, l: '자신의 능력 인지' }, { v: 15, l: '과대평가/망각' }] },
];

/* ── Braden Scale ── */
const BRADEN_ITEMS = [
  { key: 'sensory', label: '감각 인지', options: [{ v: 1, l: '완전제한' }, { v: 2, l: '매우제한' }, { v: 3, l: '약간제한' }, { v: 4, l: '장애없음' }] },
  { key: 'moisture', label: '습기', options: [{ v: 1, l: '지속적' }, { v: 2, l: '자주' }, { v: 3, l: '간헐적' }, { v: 4, l: '드묾' }] },
  { key: 'activity', label: '활동', options: [{ v: 1, l: '침상' }, { v: 2, l: '의자' }, { v: 3, l: '가끔보행' }, { v: 4, l: '자유보행' }] },
  { key: 'mobility', label: '이동', options: [{ v: 1, l: '완전부동' }, { v: 2, l: '매우제한' }, { v: 3, l: '약간제한' }, { v: 4, l: '제한없음' }] },
  { key: 'nutrition', label: '영양', options: [{ v: 1, l: '매우불량' }, { v: 2, l: '부적절' }, { v: 3, l: '적절' }, { v: 4, l: '우수' }] },
  { key: 'friction', label: '마찰/전단', options: [{ v: 1, l: '문제있음' }, { v: 2, l: '잠재적' }, { v: 3, l: '문제없음' }] },
];

type DetailTab = 'vital' | 'mar' | 'assessment' | 'handoff';

export default function NursingWorkstationPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('vital');

  /* ── 대기열 ── */
  const { data: queueRes, isLoading, isError, error, refetch: refetchQueue } = useQuery({
    queryKey: ['ws-nursing-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/nursing/queue'),
    refetchInterval: 8000,
  });
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const allOrders: WsOrder[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw : [];
  }, [queueRes]);

  const counts = useMemo(() => ({
    ALL: allOrders.length,
    ORDERED: allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED').length,
    COMPLETED: allOrders.filter(o => o.status === 'COMPLETED').length,
  }), [allOrders]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allOrders;
    if (filter === 'IN_PROGRESS') return allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED');
    return allOrders.filter(o => o.status === filter);
  }, [allOrders, filter]);

  const selectedOrder = allOrders.find(o => o.orderId === selectedId);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ws-nursing-queue'] });
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),  onSuccess: () => { invalidate(); toast.success('접수 완료'); } });
  const start    = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/start`),    onSuccess: () => { invalidate(); toast.success('간호 시작'); } });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`), onSuccess: () => { invalidate(); toast.success('간호 완료'); } });

  const stats = [
    { label: '대기', count: counts.ORDERED, cls: 'text-gray-600 bg-gray-50', icon: '⏳' },
    { label: '진행중', count: counts.IN_PROGRESS, cls: 'text-amber-700 bg-amber-50', icon: '🔄' },
    { label: '완료', count: counts.COMPLETED, cls: 'text-emerald-700 bg-emerald-50', icon: '✓' },
  ];

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="간호 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="바이탈 → 투약(MAR) → 사정 → 인수인계" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inpatient" className="px-3 py-1.5 text-xs font-medium bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100"><T k="입원 목록" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70"><T k={s.label} /></p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 병동 채혈 대기(2026-10-01) — 채취한 순간을 병동에서 남긴다(검사실 접수와 다른 시각) */}
      <WardSpecimenPendingPanel />

      {/* 워크플로우 단계 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-medium"><T k="바이탈" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 font-medium"><T k="투약(MAR)" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-medium"><T k="사정" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 font-medium"><T k="인수인계" /></span>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey, label: '전체' },
          { key: 'ORDERED' as FilterKey, label: '대기' },
          { key: 'IN_PROGRESS' as FilterKey, label: '진행중' },
          { key: 'COMPLETED' as FilterKey, label: '완료' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <T k={f.label} />
            {counts[f.key] > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="병실" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="업무" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[55px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[120px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7}><QueryErrorFallback error={error} onRetry={refetchQueue} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 업무가 없습니다" /></td></tr>
              ) : filtered.map(o => {
                const isSelected = selectedId === o.orderId;
                const typeInfo = o.orderType ? ORDER_TYPE_LABEL[o.orderType] : null;
                return (
                  <tr key={o.orderId} onClick={() => { setSelectedId(o.orderId); setDetailTab('vital'); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-rose-50' : 'hover:bg-gray-50/50'} ${o.priority === 'STAT' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {o.priority === 'STAT' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse whitespace-nowrap">STAT</span>}
                      {o.priority === 'URGENT' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500 text-white whitespace-nowrap"><T k="긴급" /></span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_MAP[o.status]?.cls ?? 'bg-gray-100'}`}>
                        <T k={STATUS_MAP[o.status]?.label ?? o.status} />
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{o.patient?.familyName}{o.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{o.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {o.roomName ?? '-'}{o.bedNumber ? `-${o.bedNumber}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      {typeInfo ? (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-lg whitespace-nowrap ${typeInfo.cls}`}><T k={typeInfo.label} /></span>
                      ) : (
                        <span className="text-xs text-gray-600 truncate max-w-[150px] block">{o.procedureName || o.procedureCode || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED' && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@오더" /></button>}
                        {o.status === 'RECEIVED' && <button onClick={() => start.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="시작" /></button>}
                        {o.status === 'IN_PROGRESS' && <button onClick={() => complete.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>}
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
          {!selectedOrder ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
              </svg>
              <p className="text-sm text-gray-400"><T k="업무를 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-260px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="간호 상세" /></h3>
                <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-600 font-medium"><T k="환자" /></p>
                <p className="text-sm font-bold text-gray-900">{selectedOrder.patient?.familyName}{selectedOrder.patient?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {selectedOrder.patient?.mrn}</p>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-gray-400"><T k="병실" />:</span> <span className="font-medium">{selectedOrder.roomName ?? '-'}{selectedOrder.bedNumber ? `-${selectedOrder.bedNumber}` : ''}</span></div>
                  <div><span className="text-gray-400"><T k="과" />:</span> <span className="font-medium">{selectedOrder.departmentName ?? '-'}</span></div>
                </div>
              </div>

              {/* 상세 탭 */}
              <div className="flex gap-1 border-b border-gray-100 pb-1">
                {([
                  { key: 'vital' as DetailTab, label: '바이탈/NEWS2' },
                  { key: 'mar' as DetailTab, label: 'MAR' },
                  { key: 'assessment' as DetailTab, label: '사정도구' },
                  { key: 'handoff' as DetailTab, label: 'I-PASS' },
                ]).map(t => (
                  <button key={t.key} onClick={() => setDetailTab(t.key)}
                    className={`px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${
                      detailTab === t.key ? 'bg-rose-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                    }`}>
                    <T k={t.label} />
                  </button>
                ))}
              </div>

              {/* 탭 내용 */}
              {detailTab === 'vital' && <VitalPanel admissionId={selectedOrder.admissionId} orderId={selectedOrder.orderId} />}
              {detailTab === 'mar' && <MarPanel admissionId={selectedOrder.admissionId} />}
              {detailTab === 'assessment' && <AssessmentPanel admissionId={selectedOrder.admissionId} patientId={selectedOrder.patientId} />}
              {detailTab === 'handoff' && <HandoffPanel admissionId={selectedOrder.admissionId} />}

              {/* 바로가기 */}
              {selectedOrder.admissionId && (
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500 font-medium"><T k="상세 기록" /></p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { href: `/inpatient/${selectedOrder.admissionId}/nursing/flowsheet`, label: 'Flowsheet' },
                      { href: `/inpatient/${selectedOrder.admissionId}/nursing/mar`, label: 'MAR 전체' },
                      { href: `/inpatient/${selectedOrder.admissionId}/nursing/io`, label: 'I/O' },
                      { href: `/inpatient/${selectedOrder.admissionId}/nursing/notes`, label: '간호기록' },
                      { href: `/inpatient/${selectedOrder.admissionId}/nursing/assessment`, label: '사정' },
                      { href: `/inpatient/${selectedOrder.admissionId}/nursing/timeline`, label: '타임라인' },
                    ].map(link => (
                      <Link key={link.href} href={link.href}
                        className="px-3 py-2 text-[10px] font-medium text-center bg-gray-50 text-gray-700 rounded-lg hover:bg-rose-50 hover:text-rose-700 transition-colors">
                        <T k={link.label} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@오더" /></button>
                )}
                {selectedOrder.status === 'RECEIVED' && (
                  <button onClick={() => start.mutate(selectedOrder.orderId)} className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="간호 시작" /></button>
                )}
                {selectedOrder.status === 'IN_PROGRESS' && (
                  <button onClick={() => complete.mutate(selectedOrder.orderId)} className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   바이탈 입력 + NEWS2 자동 계산 패널
   ══════════════════════════════════════════════════════════ */
function VitalPanel({ admissionId, orderId }: { admissionId?: string; orderId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<VitalForm>({
    systolicBp: '', diastolicBp: '', heartRate: '',
    temperature: '', respiratoryRate: '', spo2: '',
    // 🔴 (2026-10-07) 의식 수준이 '명료'로 시작해 평가하지 않은 의식이 NEWS2 에 들어갔다 — 미선택으로 시작(QuickVitals 와 같은 규약)
    painScale: '', consciousness: '', supplementalO2: '',
  });
  const [saving, setSaving] = useState(false);
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

  const news2 = useMemo(() => calcNEWS2(form), [form]);
  const hasValues = form.systolicBp || form.heartRate || form.temperature;

  /* 최근 바이탈 조회 */
  const { data: historyRes, isError: historyIsError, error: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['vital-history', admissionId],
    queryFn: () => apiClient.get(`/api/v1/admissions/${admissionId}/flowsheet`),
    enabled: !!admissionId,
  });
  // flowsheet 응답은 { entries[], grid, totals } — 당일 마지막 기록을 '최근 바이탈'로 표시
  const lastVitals = (() => {
    const entries = (historyRes as any)?.data?.entries;
    return Array.isArray(entries) && entries.length ? entries[entries.length - 1] : null;
  })();

  const handleSave = async () => {
    if (!admissionId) return;
    setSaving(true);
    try {
      // 입원 활력 정본 = FlowSheetEntry(admissionId 결속). 종전엔 외래 대기열 EP 에 orderId 를 보내
      // queueId 로 해석되게 해 항상 404 였고 patientId 도 누락돼 400 이었음(입력이 통째로 유실).
      // NEWS2 는 서버가 6요소로 재산출하므로 클라 점수는 전송하지 않는다.
      await apiClient.post(`/api/v1/admissions/${admissionId}/flowsheet`, {
        // 🔴 `Number(x) || undefined` 는 측정한 0(통증 0점)을 버렸다 — 빈 칸만 미측정
        systolicBp: num(form.systolicBp),
        diastolicBp: num(form.diastolicBp),
        heartRate: num(form.heartRate),
        temperature: num(form.temperature),
        respiratoryRate: num(form.respiratoryRate),
        spo2: num(form.spo2),
        painScore: num(form.painScale),
        consciousness: form.consciousness || undefined,
        // 🔴 미관측이면 보내지 않는다 — 서버가 false 로 접으면 NEWS2 가 2점 낮게 법정기록에 박힌다
        supplementalO2: form.supplementalO2 === 'Y' ? true : form.supplementalO2 === 'N' ? false : undefined,
        // 🔴 (2026-10-26) 측정 시각 — 종전엔 보내지 않아 이 화면 기록은 전부 '측정 시각 미상(수신 시각)'이었다(플로시트와 같은 변환)
        recordedAt: localInputToIso(form.measuredAtLocal),
      });
      toast.success('바이탈 기록 완료');
      qc.invalidateQueries({ queryKey: ['vital-history'] });
      setForm({ systolicBp: '', diastolicBp: '', heartRate: '', temperature: '', respiratoryRate: '', spo2: '', painScale: '', consciousness: '', supplementalO2: '', measuredAtLocal: '' });
    } catch { toast.error('바이탈 기록 실패'); }
    setSaving(false);
  };

  const set = (k: keyof VitalForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-3">
      {/* NEWS2 점수 */}
      {hasValues && (
        <div className={`rounded-xl p-3 ${news2.cls}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold"><T k="NEWS2 점수" /></span>
            {/* 🔴 산출 불가를 '0점'으로 표시하지 않는다 — 다른 사실이다 */}
            <span className="text-lg font-black">{news2.score ?? '—'}</span>
          </div>
          <p className="text-[10px] font-medium mt-0.5">
            {news2.score == null
              ? `산출 불가 — ${news2.missing.join('·')} 미관측`
              : `${news2.risk} — ${news2.score >= 7 ? '즉시 의사 호출' : news2.score >= 5 ? '담당 의사 보고' : news2.score >= 1 ? '모니터링 지속' : '정상 범위'}`}
          </p>
        </div>
      )}

      {/* 바이탈 입력 */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { k: 'systolicBp' as const, label: '수축기 BP', unit: 'mmHg', placeholder: '120' },
          { k: 'diastolicBp' as const, label: '이완기 BP', unit: 'mmHg', placeholder: '80' },
          { k: 'heartRate' as const, label: '심박수', unit: 'bpm', placeholder: '72' },
          { k: 'temperature' as const, label: '체온', unit: '°C', placeholder: '36.5' },
          { k: 'respiratoryRate' as const, label: '호흡수', unit: '/min', placeholder: '16' },
          { k: 'spo2' as const, label: 'SpO2', unit: '%', placeholder: '98' },
        ].map(f => (
          <div key={f.k}>
            <label className="text-[10px] text-gray-500 font-medium"><T k={f.label} /></label>
            <div className="flex items-center gap-1 mt-0.5">
              <input type="number" step="0.1" value={form[f.k]} onChange={e => set(f.k, e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 focus:outline-none" />
              <span className="text-[9px] text-gray-400 whitespace-nowrap">{f.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 통증 + 의식 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 font-medium"><T k="통증 (NRS 0-10)" /></label>
          <input type="number" min="0" max="10" value={form.painScale} onChange={e => set('painScale', e.target.value)}
            placeholder="0~10" className="w-full mt-0.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 focus:outline-none" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 font-medium"><T k="의식 수준 (ACVPU)" /></label>
          <select value={form.consciousness} onChange={e => set('consciousness', e.target.value)}
            className="w-full mt-0.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 focus:outline-none">
            <option value="">{'— 미평가 —'}</option>
            <option value="ALERT">Alert (명료)</option>
            <option value="CONFUSION">Confusion (새 혼돈)</option>
            <option value="VOICE">Voice (음성반응)</option>
            <option value="PAIN">Pain (통증반응)</option>
            <option value="UNRESPONSIVE">Unresponsive (무반응)</option>
          </select>
        </div>
      </div>

      {/* 보충산소 — 🔴 NEWS2 7요소 중 하나. 종전엔 이 입력이 없어 화면 점수가 서버보다 2점 낮았고,
          서버는 관측이 없어 EWS 를 아예 산출하지 않았다. 미선택은 '아니오'가 아니라 미관측이다. */}
      <div>
        <label className="text-[10px] text-gray-500 font-medium">보충산소 투여 (NEWS2 필수)</label>
        <select value={form.supplementalO2} onChange={e => set('supplementalO2', e.target.value)}
          className="w-full mt-0.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 focus:outline-none">
          <option value="">미관측 (NEWS2 산출 안 됨)</option>
          <option value="N">아니오 (실내공기)</option>
          <option value="Y">예 (산소 투여 중)</option>
        </select>
      </div>

      {/* 측정 시각 — 비우면 서버가 '측정 시각 미상(수신 시각)'으로 남긴다(지금으로 채우지 않는다 · 늦게 입력한 기록이 지금 측정한 것처럼 보이지 않게) */}
      <div>
        <label className="text-[10px] text-gray-500 font-medium"><T k="측정 시각" /></label>
        <input type="datetime-local" value={form.measuredAtLocal ?? ''} onChange={e => set('measuredAtLocal', e.target.value)} data-ws-measured-at
          className="w-full mt-0.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 focus:outline-none" />
        {!form.measuredAtLocal && <p className="mt-0.5 text-[10px] text-amber-700" data-ws-measured-at-empty><T k="비우면 측정 시각 미상으로 기록됩니다(받은 시각이 함께 남습니다)" /></p>}
      </div>

      {/* 이전 바이탈 — 🔴 조회 실패를 "이전 측정 없음"으로 접지 않는다(추이 판단이 사라진다) */}
      {historyIsError && <QueryErrorFallback error={historyError} onRetry={() => refetchHistory()} size="compact" />}
      {!historyIsError && lastVitals && (
        <div className="bg-gray-50 rounded-lg p-2 text-[10px] text-gray-500">
          <p className="font-medium mb-1"><T k="이전 측정" /></p>
          {/* 활력 표시 정본(2026-10-07) — 종전 truthy 검사가 측정된 0 을 숨겼다 */}
          <VitalSignsStrip vitals={lastVitals} keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature']} />
        </div>
      )}

      <button onClick={handleSave} disabled={saving || !hasValues}
        className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50">
        <T k={saving ? '저장 중...' : '바이탈 기록'} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAR (Medication Administration Record) 패널
   ══════════════════════════════════════════════════════════ */
function MarPanel({ admissionId }: { admissionId?: string }) {
  const qc = useQueryClient();
  // MAR 스케줄 = MedicationAdministration(정본). id는 MedicationAdministration.id → BCMA 게이트 엔드포인트로 투약.
  const { data: marRes, isLoading } = useQuery({
    queryKey: ['mar-schedule', admissionId],
    queryFn: () => apiClient.get(`/api/v1/admissions/${admissionId}/medication-schedule`),
    enabled: !!admissionId,
  });
  const schedule: MarItem[] = (marRes as any)?.data ?? [];

  // BCMA bedside 스캔 모달 — 5-Rights 기계 대조(환자 손목밴드·약품 바코드). 게이트는 백엔드(nursing.bcma.enforce)가 강제.
  const [scanFor, setScanFor] = useState<MarItem | null>(null);
  const [scan, setScan] = useState({ band: '', med: '' });
  // 실제 투여량·경로는 간호사가 확인한다 — 종전에는 '처방 용량'·'PO' 를 날조해 보냈다(P15)
  const [give, setGive] = useState({ dose: '', route: '' });
  const [dc, setDc] = useState<DoubleCheckValue>(EMPTY_DOUBLE_CHECK);

  const openScan = (m: MarItem) => {
    setScanFor(m);
    setScan({ band: '', med: '' });
    setGive({ dose: m.dose ?? '', route: m.route ?? m.prescription?.route ?? '' });
    setDc(EMPTY_DOUBLE_CHECK);
  };

  const adminMut = useMutation({
    mutationFn: ({ item, band, med }: { item: MarItem; band: string; med: string }) =>
      apiClient.patch<{ data: { warnings?: string[] } }>(`/api/v1/medication-administrations/${item.id}/administer`, {
        dose: give.dose.trim(), route: give.route.trim(),
        ...(band.trim() ? { patientBandScan: band.trim() } : {}),
        ...(med.trim() ? { medScan: med.trim() } : {}),
        ...doubleCheckPayload(doubleCheckScopeOf(item, give.route), dc),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['mar-schedule'] });
      const raw = res?.data as unknown as { data?: { warnings?: string[] }; warnings?: string[] };
      const warns = raw?.data?.warnings ?? raw?.warnings;
      if (warns?.length) warns.forEach((w) => toast.warning(w)); else toast.success('스캔 대조 일치 — 투약 확인 완료');
      setScanFor(null); setScan({ band: '', med: '' }); setDc(EMPTY_DOUBLE_CHECK);
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '대조 실패 — 투약 중단'),
  });

  const holdMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.patch(`/api/v1/medication-administrations/${id}/hold`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mar-schedule'] }); toast.success('투약 보류'); },
    onError: () => toast.error('보류 실패'),
  });

  if (!admissionId) return <p className="text-xs text-gray-400 text-center py-4"><T k="입원 정보가 필요합니다" /></p>;
  if (isLoading) return <div className="text-center py-4"><div className="w-5 h-5 border-2 border-rose-300 border-t-transparent rounded-full animate-spin mx-auto" /></div>;

  const pending = schedule.filter(s => s.status === 'SCHEDULED' || s.status === 'PENDING');
  const done = schedule.filter(s => s.status === 'ADMINISTERED');
  const held = schedule.filter(s => s.status === 'HELD' || s.status === 'SKIPPED');

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-[10px]">
        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">대기 {pending.length}</span>
        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">완료 {done.length}</span>
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">보류 {held.length}</span>
      </div>

      {pending.length === 0 && done.length === 0 && held.length === 0 ? (
        <EmptyState icon="💊" title="투약 스케줄이 없습니다" />
      ) : (
        <div className="space-y-1.5">
          {pending.map(m => (
            <div key={m.id} className="bg-amber-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-900">
                    {marMedName(m) ?? '약품명 미상'}
                    {m.prescription?.medicationCode?.highAlertFlag && (
                      <span className="ml-1 text-[8px] bg-red-600 text-white px-1 py-0.5 rounded font-bold align-middle whitespace-nowrap">⛔고위험</span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-500">{m.dose || '용량 미기재'} · {m.route || '경로 미기재'} · {m.scheduledAt ?kdate(m.scheduledAt, 'time') : ''}</p>
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 whitespace-nowrap">대기</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => openScan(m)}
                  className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">투여 (BCMA 스캔)</button>
                <button onClick={() => holdMut.mutate({ id: m.id, reason: '간호사 판단' })}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">보류</button>
              </div>
            </div>
          ))}
          {done.slice(0, 3).map(m => (
            <div key={m.id} className="bg-emerald-50 rounded-xl p-2.5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-700">{marMedName(m) ?? '약품명 미상'}</p>
                <p className="text-[10px] text-gray-400">{m.dose || '용량 미기재'} · {m.scheduledAt ?kdate(m.scheduledAt, 'time') : ''}</p>
                <DoubleCheckBypassBadge notes={m.notes} className="mt-0.5" />
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 whitespace-nowrap">완료</span>
            </div>
          ))}
        </div>
      )}

      {/* BCMA bedside 스캔 모달 — 5-Rights 기계 대조(환자·약품). 게이트=nursing.bcma.enforce(백엔드 강제) */}
      {scanFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setScanFor(null)}>
          <div className="bg-white rounded-2xl p-4 w-full max-w-xs space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-sm font-bold text-gray-900">{marMedName(scanFor) ?? '약품명 미상'} 투약</p>
              <p className="text-[11px] text-gray-500">처방 {scanFor.dose || '용량 미기재'} · {scanFor.route || scanFor.prescription?.route || '경로 미기재'}</p>
            </div>
            {/* 5-Rights ③ — 실제 투여량·경로를 간호사가 확인한다(자리표시 문자열 전송 금지) */}
            <div className="grid grid-cols-2 gap-2">
              <input value={give.dose} onChange={e => setGive(g => ({ ...g, dose: e.target.value }))}
                placeholder="실제 투여량" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
              <input value={give.route} onChange={e => setGive(g => ({ ...g, route: e.target.value }))}
                placeholder="투여 경로" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            </div>
            <MedDoubleCheckPanel scope={doubleCheckScopeOf(scanFor, give.route)} value={dc} onChange={setDc} compact />
            <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-rose-700">BCMA 바코드 대조 (환자·약품)</p>
              <input value={scan.band} onChange={e => setScan(s => ({ ...s, band: e.target.value }))} autoFocus
                placeholder="① 손목밴드 스캔(MRN)" className="w-full px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs" />
              <input value={scan.med} onChange={e => setScan(s => ({ ...s, med: e.target.value }))}
                placeholder="② 약품 바코드 스캔" className="w-full px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs" />
              {(!scan.band || !scan.med) && (
                <p className="text-[10px] text-rose-500">※ 손목밴드·약품 바코드 미스캔 시 게이트 설정에 따라 경고/차단될 수 있습니다.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setScanFor(null)} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700">취소</button>
              <button onClick={() => adminMut.mutate({ item: scanFor, band: scan.band, med: scan.med })}
                disabled={adminMut.isPending || !give.dose.trim() || !give.route.trim() || !doubleCheckReady(doubleCheckScopeOf(scanFor, give.route), dc)}
                title={!give.dose.trim() || !give.route.trim() ? '실제 투여량·경로를 입력하세요' : undefined}
                className="flex-1 min-h-[48px] py-3 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {adminMut.isPending ? '대조 중…' : '투약 확인'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   간호 사정 도구 (Morse Fall + Braden)
   ══════════════════════════════════════════════════════════ */
/**
 * 🔴 시드 흐름 검토 9단계(2026-08-24) — **이 패널의 저장은 개통 이래 100% 실패했다.**
 *
 *  · 보내던 곳: `POST /api/v1/admissions/:id/nursing-assessment`
 *    받는 DTO(`CreateNursingAssessmentDto`)는 `consciousness·mobility·painScore·nutritionStatus·
 *    skinIntegrity` 를 **필수**로 요구한다. 이 패널은 그중 하나도 보내지 않았다 → 전건 400.
 *    (`{assessmentType, score, details, riskLevel}` 네 필드는 DTO 에 없어 whitelist 가 지운다.)
 *    운영 실측: `fall_risk_assessments` 51행 **전건 시드** · `nursing_assessments` 41행 전건 시드.
 *  · 낙상 정본은 `POST /api/v1/safety/fall-risk` 다(서버가 Morse 점수로 등급을 **재산정**한다 —
 *    화면 라벨을 등급으로 보내지 않는다).
 *  · 욕창(Braden)은 (2026-10-10) 임상 도구 결과 원장(chartId BRADEN — 하위 항목·평가자·시각)에 남긴다.
 *    서버가 6항목을 다 요구하고 총점을 항목 합으로 정한다 · 재원 위험 추이(Braden 이력)가 이 행을 읽는다.
 *  · 🔴 미선택 합계 0 을 "저위험"이라 말하지 않는다 — 아무것도 고르지 않은 Morse 는 0점이 아니라
 *    **미평가**다(Braden 은 반대로 0 이 '고위험'으로 보였다).
 */
function AssessmentPanel({ patientId }: { admissionId?: string; patientId?: string }) {
  const qc = useQueryClient();
  const [tool, setTool] = useState<'morse' | 'braden'>('morse');
  const [morseValues, setMorseValues] = useState<Record<string, number>>({});
  const [bradenValues, setBradenValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const morseTotal = Object.values(morseValues).reduce((a, b) => a + b, 0);
  const bradenTotal = Object.values(bradenValues).reduce((a, b) => a + b, 0);
  const morseComplete = MORSE_ITEMS.every(i => morseValues[i.key] !== undefined);
  const bradenComplete = BRADEN_ITEMS.every(i => bradenValues[i.key] !== undefined);
  // 🔴 문구에 '산출 불가'를 손으로 적지 않는다 — 그 어휘의 정본은 shared 비율 표기이고,
  //    이것은 비율이 아니라 **아직 평가되지 않은 척도**다. 무엇이 없어 등급이 없는지 그대로 적는다.
  const UNSCORED = { label: '미평가(전 항목 선택 전)', cls: 'bg-gray-100 text-gray-600' };
  // 등급 경계는 shared `morseRiskLevel` 하나(서버 재평가 정책과 같은 상수 — 2026-10-26 화면 사본 회수)
  const morseLevel = morseComplete ? morseRiskLevel(morseTotal) : null;
  const MORSE_CLS = { HIGH: 'bg-red-100 text-red-700', MODERATE: 'bg-amber-100 text-amber-700', LOW: 'bg-emerald-100 text-emerald-700' } as const;
  const morseRisk = !morseLevel ? UNSCORED : { label: MORSE_RISK_LABEL[morseLevel], cls: MORSE_CLS[morseLevel] };
  // 등급 경계는 shared `bradenRiskLevel` 하나(서버 재평가·Braden 이력과 같은 표) — 종전 화면만 19점 이상 단계를 따로 두었다
  const bradenLevel = bradenComplete ? bradenRiskLevel(bradenTotal) : null;
  const BRADEN_CLS = { HIGH: 'bg-red-100 text-red-700', MODERATE: 'bg-amber-100 text-amber-700', LOW: 'bg-emerald-100 text-emerald-700' } as const;
  const bradenRisk = !bradenLevel ? UNSCORED : { label: BRADEN_RISK_LABEL[bradenLevel], cls: BRADEN_CLS[bradenLevel] };
  const complete = tool === 'morse' ? morseComplete : bradenComplete;
  const answered = Object.keys(tool === 'morse' ? morseValues : bradenValues).length;
  const itemCount = (tool === 'morse' ? MORSE_ITEMS : BRADEN_ITEMS).length;
  const canSave = !!patientId && complete && !saving;

  const handleSave = async () => {
    if (!patientId || !complete) return;
    setSaving(true);
    if (tool === 'braden') {
      try {
        await apiClient.post('/api/v1/clinical-chart-results', {
          patientId, chartId: 'BRADEN', chartName: 'Braden Scale', archetype: 'scoring',
          inputs: { scores: bradenValues }, // 항목별 점수가 근거 — 총점·등급은 서버가 항목 합으로
          resultValue: bradenTotal,
        });
        toast.success('Braden 평가를 저장했습니다(위험 추이의 Braden 이력에 남습니다).');
        setBradenValues({});
        qc.invalidateQueries({ queryKey: ['risk-history'] });
      } catch (e) { toast.error(e instanceof Error ? e.message : '평가 저장 실패'); }
      setSaving(false);
      return;
    }
    try {
      await apiClient.post('/api/v1/safety/fall-risk', {
        patientId,
        score: morseTotal,
        factors: morseValues, // 항목별 점수는 근거다 — 합계만 남기지 않는다
      });
      toast.success('낙상 위험 평가를 저장했습니다(등급은 서버가 점수로 산정).');
      qc.invalidateQueries({ queryKey: ['nursing-assessments'] });
      qc.invalidateQueries({ queryKey: ['fall-risk'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : '평가 저장 실패'); }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button onClick={() => setTool('morse')}
          className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg ${tool === 'morse' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Morse (낙상)
        </button>
        <button onClick={() => setTool('braden')}
          className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg ${tool === 'braden' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Braden (욕창)
        </button>
      </div>

      {/* 점수 표시 */}
      <div className={`rounded-xl p-3 ${tool === 'morse' ? morseRisk.cls : bradenRisk.cls}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold">{tool === 'morse' ? 'Morse Fall Scale' : 'Braden Scale'}</span>
          <span className="text-lg font-black">{tool === 'morse' ? morseTotal : bradenTotal}</span>
        </div>
        <p className="text-[10px] font-medium">{tool === 'morse' ? morseRisk.label : bradenRisk.label}
          {tool === 'morse' ? ` (0-24 저, 25-44 중, 45+ 고)` : ` (≤12 고, 13-14 중, ≥15 저)`}
        </p>
        {!complete && <p className="text-[10px] mt-0.5">{answered}/{itemCount} 항목 선택 — 전 항목을 골라야 총점이 나옵니다.</p>}
      </div>

      {/* 항목 */}
      <div className="space-y-2">
        {(tool === 'morse' ? MORSE_ITEMS : BRADEN_ITEMS).map(item => (
          <div key={item.key}>
            <p className="text-[10px] font-medium text-gray-600 mb-1">{item.label}</p>
            <div className="flex gap-1 flex-wrap">
              {item.options.map(opt => {
                const vals = tool === 'morse' ? morseValues : bradenValues;
                const setVals = tool === 'morse' ? setMorseValues : setBradenValues;
                const selected = vals[item.key] === opt.v;
                return (
                  <button key={opt.v} onClick={() => setVals(p => ({ ...p, [item.key]: opt.v }))}
                    className={`px-2 py-1 text-[9px] rounded-lg border transition-colors ${
                      selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                    }`}>
                    {opt.l} ({opt.v})
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!patientId ? (
        <p className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
          이 오더에 환자 식별자가 없어 저장할 수 없습니다(오더 목록에서 환자를 다시 선택하세요).
        </p>
      ) : null}
      <button onClick={handleSave} disabled={!canSave}
        className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
        {saving ? '저장 중...' : !complete ? `전 항목 선택 필요 (${answered}/${itemCount})` : tool === 'braden' ? 'Braden 평가 저장' : '낙상 평가 저장'}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   I-PASS 인수인계 패널 (AI 요약)
   ══════════════════════════════════════════════════════════ */
function HandoffPanel({ admissionId }: { admissionId?: string }) {
  const [generating, setGenerating] = useState(false);
  const [handoff, setHandoff] = useState<{
    illness: string; patientSummary: string; actionList: string;
    situationAwareness: string; synthesis: string;
  } | null>(null);

  /* WeRU.B 인수인계 조회 */
  const { data: aiRes, isLoading, isError: aiIsError, error: aiError, refetch: refetchAi } = useQuery({
    queryKey: ['ai-handoff', admissionId],
    queryFn: () => apiClient.get(`/api/v1/nursing/${admissionId}/ai-handoff`),
    enabled: !!admissionId,
  });

  const existingHandoff = (aiRes as any)?.data;

  const generate = async () => {
    if (!admissionId) return;
    setGenerating(true);
    try {
      const res = await apiClient.get(`/api/v1/nursing/${admissionId}/ai-handoff`);
      const data = (res as any)?.data;
      if (data) {
        setHandoff({
          illness: data.illness ?? data.I ?? '',
          patientSummary: data.patientSummary ?? data.P ?? '',
          actionList: data.actionList ?? data.A ?? '',
          situationAwareness: data.situationAwareness ?? data.S ?? '',
          synthesis: data.synthesis ?? data.S2 ?? data.readBack ?? '',
        });
      }
      toast.success(`${AI_ORIGIN_TEXT} I-PASS 생성 완료`);
    } catch { toast.error(`${AI_ORIGIN_TEXT} 인수인계 생성 실패`); }
    setGenerating(false);
  };

  if (!admissionId) return <p className="text-xs text-gray-400 text-center py-4"><T k="입원 정보가 필요합니다" /></p>;

  const display = handoff ?? (existingHandoff ? {
    illness: existingHandoff.illness ?? existingHandoff.I ?? '',
    patientSummary: existingHandoff.patientSummary ?? existingHandoff.P ?? '',
    actionList: existingHandoff.actionList ?? existingHandoff.A ?? '',
    situationAwareness: existingHandoff.situationAwareness ?? existingHandoff.S ?? '',
    synthesis: existingHandoff.synthesis ?? existingHandoff.S2 ?? existingHandoff.readBack ?? '',
  } : null);

  return (
    <div className="space-y-3">
      <div className="bg-teal-50 rounded-xl p-3">
        <p className="text-xs font-bold text-teal-800"><T k="I-PASS 인수인계" /></p>
        <p className="text-[10px] text-teal-600 mt-0.5">Illness severity → Patient summary → Action list → Situation awareness → Synthesis</p>
      </div>

      {aiIsError && !handoff && <QueryErrorFallback error={aiError} onRetry={() => refetchAi()} size="compact" />}
      {display ? (
        <div className="space-y-2">
          {[
            { key: 'I', label: 'Illness Severity (중증도)', value: display.illness, cls: 'bg-red-50 text-red-700' },
            { key: 'P', label: 'Patient Summary (환자 요약)', value: display.patientSummary, cls: 'bg-blue-50 text-blue-700' },
            { key: 'A', label: 'Action List (필요 조치)', value: display.actionList, cls: 'bg-amber-50 text-amber-700' },
            { key: 'S', label: 'Situation Awareness (상황 인식)', value: display.situationAwareness, cls: 'bg-violet-50 text-violet-700' },
            { key: 'S2', label: 'Synthesis (종합)', value: display.synthesis, cls: 'bg-teal-50 text-teal-700' },
          ].map(s => (
            <div key={s.key} className={`rounded-xl p-2.5 ${s.cls}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-black">{s.key}</span>
                <span className="text-[10px] font-medium"><T k={s.label} /></span>
              </div>
              <p className="text-xs text-gray-800 whitespace-pre-wrap">{s.value || '-'}</p>
            </div>
          ))}
        </div>
      ) : aiIsError ? null : (
        <p className="text-xs text-gray-400 text-center py-4">{AI_ORIGIN_TEXT}로 인수인계 요약을 생성하세요</p>
      )}

      <button onClick={generate} disabled={generating || isLoading}
        className="w-full py-2 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
        {generating ? `${AI_ORIGIN_TEXT} 생성 중...` : display ? `${AI_ORIGIN_TEXT} 재생성` : `${AI_ORIGIN_TEXT} I-PASS 생성`}
      </button>
    </div>
  );
}
