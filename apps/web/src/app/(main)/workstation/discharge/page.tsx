'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import React, { useState, useMemo } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import SmartSignButton from '@/components/signature/SmartSignButton';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { PreOrderCreateModal } from '../../patients/[id]/components/PreOrderTab';
import { pollMs, money, kdate } from '@/lib/ui-settings';
import { Money } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { DraftBanner, recordDraftApplied, type DraftProvenance } from '@/components/ai/DraftBanner';
import { markProposalPresented, proposalIdFrom } from '@/lib/ai-proposal';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { asDischargeMedList, dischargeMedLabel, dischargeMedName } from '@/lib/discharge-med';
import { DischargeRxPanel } from '@/components/prescription/DischargeRxPanel';
import { PatientEducationPanel } from '@/components/patient-education/PatientEducationPanel';

/* ── 타입 ── */
interface PatientRef { id?: string; familyName?: string; givenName?: string; mrn?: string }
interface WsOrder {
  orderId: string; status: string; priority?: string;
  procedureName?: string; procedureCode?: string; createdAt?: string;
  patient?: PatientRef;
  admissionId?: string; departmentName?: string; roomName?: string; bedNumber?: string;
  admitDate?: string; attendingDoctor?: string;
}

interface DischargeSummary {
  status: string; admitDate?: string; dischargeDate?: string;
  admitDiagnosis?: string; dischargeDiagnosis?: string; hospitalCourse?: string;
  conditionAtDischarge?: string; followUpPlan?: string;
  dietaryInstructions?: string; activityRestrictions?: string; patientEducation?: string;
  signedAt?: string; doctor?: { familyName?: string; givenName?: string };
}

interface DischargePrefill {
  admitDate?: string; dischargeDate?: string; admitDiagnosis?: string;
  diagnosisCodes?: string[]; procedures?: string; dischargeMedications?: unknown;
  abnormalResults?: string[];
  chronicCourse?: string | null; // P2b — 만성질환 경과(SoT 파생)
  dischargeMedicationsSource?: 'ORDERS' | 'INPATIENT_ACTIVE' | null;
}

/* ── 상수 ── */
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '대기',   cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수',   cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',   cls: 'bg-emerald-100 text-emerald-700' },
};

const SUMMARY_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:   { label: '작성중',   cls: 'bg-amber-100 text-amber-700' },
  SIGNED:  { label: '서명완료', cls: 'bg-emerald-100 text-emerald-700' },
  AMENDED: { label: '수정됨',   cls: 'bg-blue-100 text-blue-700' },
};

type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';

/* ── 체크리스트 항목 ── */
const CHECKLIST_ITEMS = [
  { key: 'summary', label: '퇴원요약 작성' },
  { key: 'medication', label: '퇴원약 확인/교육' },
  { key: 'followup', label: '외래 추적 예약' },
  { key: 'education', label: '환자/보호자 교육' },
  { key: 'billing', label: '수납/정산 완료' },
  { key: 'belongings', label: '소지품 확인' },
];

export default function DischargeWorkstationPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [preOrderPatientId, setPreOrderPatientId] = useState<string | null>(null); // 퇴원 후 재진 사전처방(P3 진입점)

  /* ── 대기열 ── */
  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-discharge-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/discharge/queue'),
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

  /* ── 선택된 환자의 퇴원요약 조회 ── */
  const selectedOrder = allOrders.find(o => o.orderId === selectedId);
  const admissionId = selectedOrder?.admissionId;
  // 퇴원 준비 현황(R3-1) — 서버 정본(요약 서명·정산 잔액·미결 오더 등). 수기 체크는 참고용으로 유지
  const readinessQ = useQuery({
    queryKey: ['discharge-readiness', admissionId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/inpatient/${admissionId}/discharge-readiness`).then(r => {
      const raw = r.data as unknown as { data?: Record<string, unknown> };
      return raw?.data ?? (r.data as unknown as Record<string, unknown>);
    }),
    enabled: !!admissionId,
    refetchInterval: pollMs('fast'),
  });
  const readiness = readinessQ.data as {
    summary?: { exists: boolean; status: string | null };
    // 🔴 서버는 셋을 구분해 준다: settled=null(판정 불가) · unavailable · reason.
    //    FE 타입이 `settled: boolean` 이라 **판정 불가를 미완으로 읽고** 있었다(2026-09-02).
    settlement?: { balanceDue: number | null; settled: boolean | null; unavailable?: boolean; reason?: string | null };
    openOrders?: number; followUpPlanned?: boolean; dischargeMedsPrepared?: boolean; educationDone?: boolean; readyToDischarge?: boolean;
    dischargeMeds?: { source: 'ORDERS' | 'SUMMARY_TEXT' | null; ordered: number; internal: number; dispensed: number; external: number; summaryListed: number };
    education?: { records: number; summaryText: boolean; source: 'RECORDS' | 'SUMMARY_TEXT' | null };
  } | undefined;

  const { data: summaryRes } = useQuery({
    queryKey: ['discharge-summary', admissionId],
    queryFn: () => apiClient.get<{ data: DischargeSummary }>(`/api/v1/admissions/${admissionId}/discharge-summary`),
    enabled: !!admissionId,
    retry: false,
  });
  const summary = summaryRes?.data ? ((summaryRes.data as { data?: DischargeSummary })?.data ?? summaryRes.data as DischargeSummary) : null;

  const { data: prefillRes } = useQuery({
    queryKey: ['discharge-prefill', admissionId],
    queryFn: () => apiClient.get<{ data: DischargePrefill }>(`/api/v1/admissions/${admissionId}/discharge-summary/prefill`),
    enabled: !!admissionId && !summary,
    retry: false,
  });
  const prefill = prefillRes?.data ? ((prefillRes.data as { data?: DischargePrefill })?.data ?? prefillRes.data as DischargePrefill) : null;
  const prefillMeds = asDischargeMedList(prefill?.dischargeMedications);

  /* ── 뮤테이션 ── */
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ws-discharge-queue'] });
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),  onSuccess: () => { invalidate(); toast.success('접수 완료'); } });
  const start    = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/start`),    onSuccess: () => { invalidate(); toast.success('퇴원 처리 시작'); } });
  const completeMut = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`), onSuccess: () => { invalidate(); toast.success('퇴원 처리 완료'); } });

  /* WeRU.B 퇴원요약 생성 */
  const [aiLoading, setAiLoading] = useState(false);
  // 🔴 초안≠확정 — 자동 생성 요약이 퇴원요약(DRAFT)에 저장된 사실. 서명 전 · 감사 원장에 남긴다(§7.6-b)
  const [aiDraftProvenance, setAiDraftProvenance] = useState<DraftProvenance | null>(null);
  const handleAiSummary = async () => {
    if (!admissionId || !prefill) return;
    setAiLoading(true);
    try {
      const text = `환자 입원 경과를 요약하여 퇴원요약을 작성해주세요. 입원일: ${prefill.admitDate ?? ''}, 진단: ${prefill.admitDiagnosis ?? ''}, 시술: ${prefill.procedures ?? ''}, 퇴원약: ${asDischargeMedList(prefill.dischargeMedications).map(dischargeMedName).join(', ')}${prefill.chronicCourse ? `\n${prefill.chronicCourse}` : ''}`;
      /**
       * 🔴 종전엔 `/ai/auto-record` 를 먼저 부르고 실패를 삼킨 뒤 `writing/craft` 로 넘어갔다.
       *    그 첫 호출은 두 겹으로 성공할 수 없었다 — ① 본문이 `{text,type}` 인데 DTO 필수는
       *    `conversation` 이라 whitelist 가 지워 **항상 400**, ② 응답도 `{soap, icd_codes,
       *    prescriptions}` 라 여기서 읽던 `summary`/`result` 가 없다. auto-record 는 "진료 대화→SOAP"
       *    경로이고 퇴원요약의 정본은 `writing/craft`(style=medical_discharge) 다.
       *    → 죽은 경로를 지운다. `discharge-summary` 화면과 같은 결함이었다(같은 EP·같은 오해).
       */
      const res = await apiClient.post<{ data: { result?: string } }>('/api/v1/ai/writing/craft', {
        text,
        style: 'medical_discharge',
        // 제안 원장(DISCHARGE_DRAFT)의 대상·환자 — 없으면 서버가 대상을 지어내지 않고 만들지 않는다
        admissionId,
        ...(selectedOrder?.patient?.id ? { patientId: selectedOrder.patient.id } : {}),
      });
      const result = res?.data?.result ?? '';
      // 🔴 없으면 null 이다(지어내지 않는다) — 제안이 안 만들어졌으면 노출·결정도 보고하지 않는다
      const proposalId = proposalIdFrom(res?.data);
      if (!result) {
        // 🔴 빈 결과를 조용히 넘기지 않는다 — 종전엔 아무 토스트도 없이 버튼이 아무 일도 안 한 것처럼 보였다.
        toast.error(`${AI_ORIGIN_TEXT} 퇴원요약 결과가 비어 있습니다 — 저장하지 않았습니다.`);
      }
      if (result) {
        setAiDraftProvenance({ source: 'GENERATOR', fields: ['입원경과'], appliedAt: new Date().toISOString(), model: null, recorded: null, proposalId });
        /**
         * 🔴 노출(PRESENTED)을 결정보다 **먼저** 보고한다 — 순서가 뒤집히면 원장이 이 건을
         *    "노출 없이 결정됨(NOT_PRESENTED)"으로 남기고 검토시간 지표가 거짓이 된다.
         *    이 화면은 초안을 곧바로 퇴원요약(DRAFT)에 넣으므로 노출과 수락이 같은 클릭 안에서 일어난다.
         */
        if (proposalId) await markProposalPresented(proposalId, 'workstation-discharge');
        void recordDraftApplied({
          resourceType: 'DISCHARGE_SUMMARY', source: 'GENERATOR', patientId: selectedOrder?.patient?.id, resourceId: admissionId,
          field: 'hospitalCourse', textLength: result.length,
          // 초안 그대로 저장한다 → ACCEPTED · finalText 로 서버가 편집거리(=0)를 실제로 잰다
          ...(proposalId ? { proposalId, decision: 'ACCEPTED' as const, finalText: result, clientContext: 'workstation-discharge' } : {}),
        })
          .then((recorded) => setAiDraftProvenance((prev) => (prev ? { ...prev, recorded } : prev)));
        await apiClient.post(`/api/v1/admissions/${admissionId}/discharge-summary`, {
          admitDate: prefill.admitDate?.split('T')[0],
          dischargeDate: (prefill.dischargeDate ?? new Date().toISOString()).split('T')[0],
          admitDiagnosis: prefill.admitDiagnosis ?? '',
          hospitalCourse: result,
          procedures: prefill.procedures ?? '',
        });
        qc.invalidateQueries({ queryKey: ['discharge-summary', admissionId] });
        toast.success(`${AI_ORIGIN_TEXT} 퇴원요약이 생성되었습니다`);
      }
    } catch { toast.error(`${AI_ORIGIN_TEXT} 퇴원요약 생성 실패`); }
    setAiLoading(false);
  };

  /* ── 통계 카드 ── */
  const stats = [
    { label: '대기', count: counts.ORDERED, cls: 'text-gray-600 bg-gray-50' },
    { label: '진행중', count: counts.IN_PROGRESS, cls: 'text-amber-700 bg-amber-50' },
    { label: '완료', count: counts.COMPLETED, cls: 'text-emerald-700 bg-emerald-50' },
  ];

  const checklistDone = CHECKLIST_ITEMS.filter(c => checklist[c.key]).length;
  const checklistTotal = CHECKLIST_ITEMS.length;

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="퇴원 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="퇴원요약 → 체크리스트 → 교육 → 완료" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inpatient" className="px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100"><T k="입원 목록" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
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
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="퇴원요약" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 font-medium"><T k="체크리스트" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="완료" /></span>
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
              filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {f.label}
            {counts[f.key] > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* 대기열 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="병실" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="입원일" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[55px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[130px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7}><QueryErrorFallback error={error} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 퇴원 업무가 없습니다" /></td></tr>
              ) : filtered.map((o) => {
                const isSelected = selectedId === o.orderId;
                return (
                  <tr key={o.orderId} onClick={() => { setSelectedId(o.orderId); setChecklist({}); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50/50'} ${o.priority === 'STAT' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {o.priority === 'STAT' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse whitespace-nowrap">STAT</span>}
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
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {o.roomName ?? '-'}{o.bedNumber ? `-${o.bedNumber}` : ''}
                      {o.departmentName && <p className="text-[10px] text-gray-400">{o.departmentName}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {o.admitDate ?kdate(o.admitDate, 'monthDay') : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED' && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>}
                        {o.status === 'RECEIVED' && <button onClick={() => start.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="시작" /></button>}
                        {o.status === 'IN_PROGRESS' && <button onClick={() => completeMut.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>}
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              <p className="text-sm text-gray-400"><T k="환자를 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="퇴원 상세" /></h3>
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
                  <div><span className="text-gray-400"><T k="병실:" /></span> <span className="font-medium">{selectedOrder.roomName ?? '-'}{selectedOrder.bedNumber ? `-${selectedOrder.bedNumber}` : ''}</span></div>
                  <div><span className="text-gray-400"><T k="과:" /></span> <span className="font-medium">{selectedOrder.departmentName ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="입원일:" /></span> <span className="font-medium">{selectedOrder.admitDate ?kdate(selectedOrder.admitDate, 'date') : '-'}</span></div>
                  <div><span className="text-gray-400"><T k="주치의:" /></span> <span className="font-medium">{selectedOrder.attendingDoctor ?? '-'}</span></div>
                </div>
                {selectedOrder.patient?.id && (
                  <button type="button" onClick={() => setPreOrderPatientId(selectedOrder.patient!.id!)}
                    className="mt-2 w-full py-1.5 text-[11px] font-medium bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100"
                    title={tAttr('퇴원 후 재진 시 시행할 검사·처방 예약 (퇴원약과 별개 — 승인 시 발효)')}>
                    <T k="+ 퇴원 후 재진 사전처방" />
                  </button>
                )}
              </div>

              {/* 퇴원요약 상태 */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-600"><T k="퇴원요약" /></p>
                  {summary && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SUMMARY_STATUS[summary.status]?.cls ?? 'bg-gray-100'}`}>
                      {SUMMARY_STATUS[summary.status]?.label ?? summary.status}
                    </span>
                  )}
                </div>

                {summary ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-400"><T k="입원일:" /></span> <span className="font-medium">{summary.admitDate?.split('T')[0] ?? '-'}</span></div>
                      <div><span className="text-gray-400"><T k="퇴원일:" /></span> <span className="font-medium">{summary.dischargeDate?.split('T')[0] ?? '-'}</span></div>
                    </div>
                    {summary.admitDiagnosis && (
                      <div className="text-xs"><span className="text-gray-400"><T k="진단:" /></span> <span className="font-medium">{summary.admitDiagnosis}</span></div>
                    )}
                    {summary.hospitalCourse && (
                      <div className="bg-white rounded-lg p-2">
                        <p className="text-[10px] text-gray-400 mb-0.5"><T k="입원경과" /></p>
                        <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-4">{summary.hospitalCourse}</p>
                      </div>
                    )}
                    {summary.followUpPlan && (
                      <div className="text-xs"><span className="text-gray-400"><T k="추적:" /></span> <span className="font-medium">{summary.followUpPlan}</span></div>
                    )}
                    {summary.doctor && (
                      <p className="text-[10px] text-gray-400">작성: {summary.doctor.familyName}{summary.doctor.givenName}{summary.signedAt ? ` | 서명: ${summary.signedAt.split('T')[0]}` : ''}</p>
                    )}
                    {summary.status === 'DRAFT' && admissionId && (
                      <SmartSignButton documentType="DISCHARGE_SUMMARY" documentId={admissionId} documentTitle="퇴원요약 서명"
                        onSign={() => apiClient.patch(`/api/v1/admissions/${admissionId}/discharge-summary/sign`, {}).then(() => {
                          qc.invalidateQueries({ queryKey: ['discharge-summary', admissionId] });
                          toast.success('퇴원요약 서명 완료');
                        })} variant="small" label="서명" />
                    )}
                    {admissionId && (
                      <Link href={`/inpatient/${admissionId}/discharge-summary`}
                        className="block text-center px-3 py-1.5 text-[10px] font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100">
                        <T k="전체 퇴원요약 보기/수정" />
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400"><T k="아직 퇴원요약이 작성되지 않았습니다" /></p>
                    <div className="flex gap-2">
                      {admissionId && (
                        <Link href={`/inpatient/${admissionId}/discharge-summary`}
                          className="flex-1 text-center px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                          <T k="퇴원요약 작성" />
                        </Link>
                      )}
                      {prefill && (
                        <button onClick={handleAiSummary} disabled={aiLoading}
                          className="flex-1 px-3 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
                          {aiLoading ? `${AI_ORIGIN_TEXT} 생성중...` : `${AI_ORIGIN_TEXT} 자동 생성`}
                        </button>
                      )}
                    </div>
                    {prefill && (<>
                      <p className="text-[11px] text-gray-500">자동 생성 요약은 {AI_ORIGIN_TEXT}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다.</p>
                      <DraftBanner provenance={aiDraftProvenance} signLabel="서명" className="mt-2" />
                    </>)}
                    {prefill && (
                      <div className="bg-white rounded-lg p-2 text-[10px] text-gray-500 space-y-0.5">
                        <p>진단: {prefill.admitDiagnosis ?? '-'}</p>
                        {prefillMeds.length > 0 && (
                          <p>퇴원약: {prefillMeds.slice(0, 3).map(dischargeMedName).join(', ')}{prefillMeds.length > 3 ? ` 외 ${prefillMeds.length - 3}건` : ''}</p>
                        )}
                        {prefill.abnormalResults && prefill.abnormalResults.length > 0 && (
                          <p className="text-amber-600">이상소견: {prefill.abnormalResults.slice(0, 3).join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 퇴원 준비 현황 — 서버 정본(R3-1). 게이트 ON이면 미충족 시 퇴원이 차단됩니다 */}
              {readiness && (
                <div className={`rounded-xl p-3 space-y-1.5 ${readiness.readyToDischarge ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold ${readiness.readyToDischarge ? 'text-emerald-700' : 'text-amber-700'}`}><T k="퇴원 준비 현황 (서버 검증)" /></p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${readiness.readyToDischarge ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {readiness.readyToDischarge ? '퇴원 가능' : '준비 미완'}
                    </span>
                  </div>
                  {/* 🔴 종전엔 잔액 항목이 템플릿 리터럴 안에 JSX 를 넣어(`` `잔액 $<Money value={…} />` ``)
                      **그 문자열이 그대로 화면에 출력**됐다 — 퇴원 게이트가 미납액을 말한다고 믿었지만
                      개통 이래 한 번도 표시된 적이 없다. 라벨을 ReactNode 로 바꿔 실제 금액을 낸다. */}
                  {([
                    [readiness.summary?.exists && readiness.summary.status !== 'DRAFT',
                      `퇴원요약 ${readiness.summary?.exists ? (readiness.summary.status === 'DRAFT' ? '미서명' : '서명 완료') : '미작성'}`, '퇴원요약'],
                    [readiness.settlement?.settled === true,
                      readiness.settlement?.settled === true
                        ? '정산 완료'
                        // 🔴 **'미완'과 '확인 못 함'은 다른 사실이다.** 조회가 실패했을 때
                        //    "정산 미완"이라 쓰면 환자에 대한 거짓 주장이 된다 — 서버가 이미
                        //    `unavailable`·`reason` 으로 그 사실을 써 놓았는데 화면이 읽지 않았다.
                        : readiness.settlement?.unavailable || readiness.settlement?.settled == null
                          ? <>정산 <b>확인 불가</b>{readiness.settlement?.reason ? ` — ${readiness.settlement.reason}` : ''}</>
                          : <><T k="정산 미완 · 잔액" /> <b><Money value={readiness.settlement.balanceDue ?? 0} /></b></>,
                      '정산'],
                    [(readiness.openOrders ?? 0) === 0, `미결 오더 ${readiness.openOrders ?? 0}건`, '미결 오더'],
                    // 🔴 종전엔 요약 글자 목록이 비어 있지 않으면 "준비"였다 — 처방·조제를 지났는지 출처를 밝힌다
                    [readiness.dischargeMeds ? readiness.dischargeMeds.source === 'ORDERS' && readiness.dischargeMeds.dispensed >= readiness.dischargeMeds.internal : readiness.dischargeMedsPrepared,
                      readiness.dischargeMeds?.source === 'ORDERS'
                        ? tfAttr('퇴원약 처방 {n}건 · 원내 조제 {d}/{i}', { n: readiness.dischargeMeds.ordered, d: readiness.dischargeMeds.dispensed, i: readiness.dischargeMeds.internal })
                        : readiness.dischargeMeds?.source === 'SUMMARY_TEXT'
                          ? tAttr('퇴원약 — 요약에 적힌 글자뿐(처방 없음)')
                          : tAttr('퇴원약 처방 없음'),
                      '퇴원약'],
                    [readiness.followUpPlanned, '외래 추적일 지정', '추적일'],
                    // 교육 기록 원장(누가·무엇을·이해도) 건수 · 요약 글자뿐이면 그렇다고 말한다
                    [readiness.educationDone,
                      readiness.education?.source === 'RECORDS'
                        ? tfAttr('환자 교육 기록 {n}건', { n: readiness.education.records })
                        : readiness.education?.source === 'SUMMARY_TEXT'
                          ? tAttr('환자 교육 — 퇴원요약 글자뿐(교육 기록 없음)')
                          : tAttr('환자 교육 기록 없음'),
                      '교육'],
                  ] as [boolean | undefined, React.ReactNode, string][]).map(([ok, label, key]) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span>{ok ? '✅' : '⬜'}</span>
                      <span className={ok ? 'text-gray-500' : 'text-gray-800 font-medium'}>{label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 퇴원 체크리스트 */}
              <div className="bg-violet-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-violet-700"><T k="퇴원 체크리스트" /></p>
                  <span className="text-[10px] font-medium text-violet-600">{checklistDone}/{checklistTotal}</span>
                </div>
                <div className="w-full bg-violet-200 rounded-full h-1.5">
                  <div className="bg-violet-600 h-1.5 rounded-full transition-all" style={{ width: `${(checklistDone / checklistTotal) * 100}%` }} />
                </div>
                <div className="space-y-1">
                  <LocalChecklistNotice className="mb-1.5" />
                  {CHECKLIST_ITEMS.map(item => (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={!!checklist[item.key]}
                        onChange={e => setChecklist(prev => ({ ...prev, [item.key]: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-violet-300 text-violet-600 focus:ring-violet-500" />
                      <span className={`text-xs transition-colors ${checklist[item.key] ? 'text-violet-400 line-through' : 'text-gray-700 group-hover:text-violet-700'}`}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 퇴원약 정보 (프리필에서) */}
              {/* 퇴원약 오더화(2026-09-30) — 여기서 바로 처방·중단(약국 조제 오더가 따라간다) */}
              {admissionId && <DischargeRxPanel admissionId={admissionId} />}
              {/* 환자 교육(2026-09-30) — 퇴원 전 교육을 여기서 바로 기록(퇴원 준비의 '교육'이 이 기록을 센다) */}
              {selectedOrder.patient?.id && <PatientEducationPanel patientId={selectedOrder.patient.id} compact />}

              {/* 🔴 서버 프리필은 객체(`{name, dosage…}`)를 준다 — `{med}` 로 그려 객체가 오면 화면이 죽었다.
                  출처도 밝힌다: 처방 원장의 퇴원약(ORDERS)인지, 입원 중 약을 참고로 보인 것(INPATIENT_ACTIVE)인지 */}
              {prefillMeds.length > 0 && (
                <div className="bg-teal-50 rounded-xl p-3 space-y-1" data-ws-discharge-meds={prefill?.dischargeMedicationsSource ?? ''}>
                  <p className="text-xs font-medium text-teal-700">
                    <T k="퇴원약" />
                    {prefill?.dischargeMedicationsSource === 'INPATIENT_ACTIVE' && <span className="ml-1 font-normal text-amber-700">· <T k="입원 중 약(퇴원약 처방 아님 — 참고)" /></span>}
                  </p>
                  {prefillMeds.map((med, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-1.5 bg-white rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                      <span className="text-gray-800">{dischargeMedLabel(med, (n) => tfAttr('{n}일', { n }))}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>
                )}
                {selectedOrder.status === 'RECEIVED' && (
                  <button onClick={() => start.mutate(selectedOrder.orderId)} className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="퇴원 처리 시작" /></button>
                )}
                {selectedOrder.status === 'IN_PROGRESS' && (
                  <button onClick={() => completeMut.mutate(selectedOrder.orderId)}
                    disabled={false} /* 🔴 가짜 게이트 제거 — 서버에 남지 않는 체크로 업무를 막지 않는다 */
                    className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {`퇴원 완료`}{checklistDone < checklistTotal ? ` (확인 ${checklistDone}/${checklistTotal})` : ''}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 퇴원 후 재진 사전처방 작성 (P3 진입점 — 차트 탭과 동일 컴포넌트) */}
      {preOrderPatientId && (
        <PreOrderCreateModal patientId={preOrderPatientId} onClose={() => setPreOrderPatientId(null)}
          onCreated={() => setPreOrderPatientId(null)} />
      )}
    </div>
  );
}
