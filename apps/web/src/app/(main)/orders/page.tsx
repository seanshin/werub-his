'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useMyOrders, useOrderQueue, useChangeOrderStatus } from '@/hooks/useOrders';
import type { OrderItem } from '@/hooks/useOrders';
import { apiClient, ApiError } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { extractErrorMessage } from '@/lib/error-utils';
import PatientSelector from '@/components/ui/PatientSelector';
import StatusBadge from '@/components/ui/StatusBadge';
import { MutationError, ORDER_STATUS_LABEL, type OrderDept } from '@hospital-run/shared';
import Link from 'next/link';
import { useHotkeys, comboLabel, ariaKeyshortcuts } from '@/components/hotkeys/HotkeyProvider';
import { EmptyState, Unit, DrugName } from '@/components/ui/display';
import { OrderSignLogPanel } from './OrderSignLogPanel';
import { OrderResultPanel } from './OrderResultPanel';
import { ImagingSafetyPrecheck } from '@/components/imaging/ImagingSafetyPrecheck';
import { DiagnosisInput, type DiagnosisItem } from '../patients/[id]/encounter/new/components/DiagnosisInput';
import { usePrescriberDelegate, PrescriberPicker, type DelegateBody, type EntryMode } from '@/components/prescription/PrescriberDelegate';
import { useEntryScope } from '@/components/prescription/useEntryScope';
import { CLINICAL_PROFESSION_LABEL, type ClinicalProfession } from '@hospital-run/shared';
import {
  ORDER_TABS, type OrderTab, type CodeItem as SearchCodeItem, type PresetItem,
  isCodeBased, isPresetBased, useCodeSearch, CodeSearchDropdown,
  useNicCodes, presetsFor, PresetPicker, CODE_SEARCH_LABEL, CODE_SEARCH_PLACEHOLDER,
} from '@/components/prescription/order-entry';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { CARE_UI, CARE_ORDER } from './care-ui';
import { OrderTrackingBoard, TrackFilters } from './OrderTrackingBoard';
import { OrderPatientMatrix } from './OrderPatientMatrix';
import { OrderGovernancePanel } from './OrderGovernancePanel';
import { OrderQualityPanel } from './OrderQualityPanel';
import { OrderAssistBar } from './OrderAssistBar';

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface PatientSearchItem {
  id: string;
  familyName: string;
  givenName: string;
  mrn: string;
  dateOfBirth?: string;
}

interface CodeItem {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string;
}

interface CdssCheck {
  level: string;
  title: string;
  message: string;
  recommendation?: string;
  suggestedOrderSet?: string;
}

interface CdssCheckResult {
  level: string;
  totalChecks: number;
  passedChecks: number;
  checks?: CdssCheck[];
}

interface OrderSetItem {
  id: string;
  name: string;
  code?: string;
  department?: string;
  category?: string;
  diagnosisCode?: string;
  items?: unknown[];
  useCount?: number;
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const DEPT_TABS = [
  { id: 'PHARMACY', label: '약국', icon: '💊' },
  { id: 'LAB', label: '검사실', icon: '🧪' },
  { id: 'IMAGING', label: '영상실', icon: '📷' },
];

// 🔴 종전 3종만 있어 치료·간호·식이·활동 오더(실측 17건)는 어느 탭으로도 좁힐 수 없었다


const DATE_TABS = [
  { id: 'today', label: '오늘' },
  { id: 'week', label: '이번주' },
  { id: 'month', label: '이번달' },
  { id: '', label: '전체' },
];

// 상태 라벨/색 — shared 정본 + StatusBadge(domain='order')로 일원화(UX 일관성 검토 2026-07 파일럿)

// 🔴 종전엔 4종만 있어 간호·식이·활동 오더가 **목록 행에서도 라벨 없이** 나왔고,
//    유형 탭 합계가 '전체'와 어긋났다(실측: 전체 18 vs 탭 합 14 — 활동 4건 누락).
//    PrescriptionType enum 전량(7종)으로 맞춘다.
const TYPE_ICON: Record<string, string> = { MEDICATION: '💊', LAB: '🧪', IMAGING: '📷', THERAPY: '🏋️', NURSING: '🩺', DIET: '🍚', ACTIVITY: '🚶' };
const TYPE_LABEL: Record<string, string> = { MEDICATION: '약물', LAB: '검사', IMAGING: '영상', THERAPY: '치료', NURSING: '간호', DIET: '식이', ACTIVITY: '활동' };
// 사전승인 유형 라벨 — 서버 pre-auth 어휘(NARCOTIC_RX 등)와 같은 축(R3)
const PRE_AUTH_TYPE_LABEL: Record<string, string> = { NARCOTIC_RX: '마약류 처방', HIGH_COST_IMAGING: '고가·특수 검사', TRANSFUSION: '수혈', CHEMO_REGIMEN: '항암 레지멘' };
const TYPE_ORDER = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'NURSING', 'DIET', 'ACTIVITY'];

/**
 * 진료 맥락 — 처리 우선순위와 처리 시간대가 여기서 갈린다.
 * 외래는 진료시간 내, 입원은 병동 라운드, 응급·중환자는 즉시. 당직은 '야간'으로 자기 몫만 본다.
 */
const DEPT_LABEL: Record<string, string> = { PHARMACY: '약국', LAB: '검사실', IMAGING: '영상실' };

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function dateRange(mode: string): { from?: string; to?: string } {
  if (!mode) return {};
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;
  if (mode === 'today') return { from: today, to: today };
  if (mode === 'week') {
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    return { from: mon.toISOString().slice(0, 10), to: today };
  }
  if (mode === 'month') return { from: `${yyyy}-${mm}-01`, to: today };
  return {};
}

function elapsed(d?: string) {
  if (!d) return '-';
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

const RX_TYPE_FALLBACK: Record<string, string> = {
  MEDICATION: '약물 처방', LAB: '검사 처방', IMAGING: '영상 처방', THERAPY: '치료 처방',
  DIET: '식이 지시', ACTIVITY: '활동 지시', NURSING: '간호 지시',
};

/**
 * 🔴 **`instructions` 를 보지 않아 지시 내용이 통째로 `처방` 으로 보였다.**
 *    간호·활동 지시는 코드가 없고 지시문에 내용이 있다 —
 *    `병실 내 보행`·`침상머리 30° 거상` 이 전부 "처방" 한 단어로 뭉개졌다(2026-08-13 실측).
 *    무엇을 하라는 지시인지 모르면 대기열이 쓸모없다.
 */
function rxName(order: OrderItem): string {
  const rx = order.prescription;
  return (
    rx?.medicationCode?.nameKo ||
    rx?.procedureCode?.nameKo ||
    rx?.instructions?.trim() ||
    (rx?.type ? RX_TYPE_FALLBACK[rx.type] : undefined) ||
    '처방'
  );
}

function patientLabel(order: OrderItem): string {
  const p = order.prescription?.encounter?.patient;
  if (!p) return '-';
  return `${p.familyName}${p.givenName}`;
}

function mrnLabel(order: OrderItem): string {
  return order.prescription?.encounter?.patient?.mrn ?? '-';
}

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function OrdersPage() {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const isDoctor = user?.role === 'DOCTOR';
  // 처방 입력 가능 역할 — 의사 외에도 간호사(구두처방 대리입력)·임상병리사(워크인 검사)가
  // **입력**은 할 수 있다. 책임 처방의 지정+승인은 모달 안에서 강제된다(서버도 fail-closed).
  const canEnterOrder = ['DOCTOR', 'ADMIN', 'NURSE', 'LAB_TECH'].includes(user?.role ?? '');
  const isAdmin = user?.role === 'ADMIN';

  const [mode, setMode] = useState<'my-orders' | 'queue' | 'tracking' | 'matrix' | 'governance' | 'quality'>(isDoctor ? 'my-orders' : 'queue');
  // 실시간 추적·환자별 매트릭스 — 같은 조회·같은 필터(보드 ↔ 매트릭스를 오가도 유지)
  const [trackDate, setTrackDate] = useState<string>(() => kstToday());
  const [trackDept, setTrackDept] = useState<OrderDept | ''>('');
  const [trackCare, setTrackCare] = useState('');
  const [trackStat, setTrackStat] = useState(false);
  const [trackSearch, setTrackSearch] = useState('');
  const [dept, setDept] = useState('PHARMACY');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateMode, setDateMode] = useState('today');
  const [durFilter, setDurFilter] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [careFilter, setCareFilter] = useState<string>('');
  const [nightOnly, setNightOnly] = useState(false);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { from, to } = dateRange(dateMode);

  const changeStatus = useChangeOrderStatus();

  // My orders
  const { data: myData, isLoading: myLoading, isError: myError, error: myErr, refetch: myRefetch } = useMyOrders(
    mode === 'my-orders' ? user?.id : undefined,
    statusFilter || undefined,
    typeFilter || undefined,
    from, to,
    careFilter || undefined,
    nightOnly,
  );
  const rawMy = myData?.data;
  const myOrders: OrderItem[] = Array.isArray(rawMy) ? rawMy : (rawMy as Record<string, unknown> | undefined)?.data as OrderItem[] ?? [];

  // All orders for stats (no status filter)
  const { data: allData } = useMyOrders(
    (isDoctor || isAdmin) ? user?.id : undefined,
    undefined, undefined, from, to,
  );
  const rawAll = allData?.data;
  const allOrders: OrderItem[] = Array.isArray(rawAll) ? rawAll : (rawAll as Record<string, unknown> | undefined)?.data as OrderItem[] ?? [];

  const counts = useMemo(() => ({
    total: allOrders.length,
    ordered: allOrders.filter(o => o.status === 'ORDERED').length,
    received: allOrders.filter(o => o.status === 'RECEIVED').length,
    inProgress: allOrders.filter(o => o.status === 'IN_PROGRESS').length,
    completed: allOrders.filter(o => o.status === 'COMPLETED').length,
    cancelled: allOrders.filter(o => o.status === 'CANCELLED').length,
    stat: allOrders.filter(o => o.priority === 'STAT' || o.prescription?.priority === 'STAT').length,
    urgent: allOrders.filter(o => o.priority === 'URGENT' || o.prescription?.priority === 'URGENT').length,
    byType: allOrders.reduce<Record<string, number>>((acc, o) => {
      const t = o.prescription?.type ?? 'UNKNOWN';
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {}),
    dur: allOrders.filter(o => o.prescription?.durChecked && Array.isArray(o.prescription.durWarnings) && o.prescription.durWarnings.length > 0).length,
    byCare: allOrders.reduce<Record<string, number>>((acc, o) => {
      const c = o.careContext ?? 'OUTPATIENT';
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {}),
    night: allOrders.filter(o => o.nightHandled).length,
  }), [allOrders]);

  /** 유형 탭 — 정의된 7종 + 데이터에만 있는 유형(뒤에 붙임). 합계가 '전체'와 어긋나지 않는다 */
  const typeTabs = useMemo(() => {
    const known = TYPE_ORDER.map((id) => ({ id, icon: TYPE_ICON[id] ?? '', label: TYPE_LABEL[id] ?? id, count: counts.byType[id] ?? 0 }));
    const extra = Object.keys(counts.byType)
      .filter((t) => !TYPE_ORDER.includes(t))
      .map((id) => ({ id, icon: '', label: id, count: counts.byType[id] }));
    return [{ id: '', icon: '', label: '전체', count: counts.total }, ...known, ...extra];
  }, [counts]);

  // Queue
  const { data: queueData, isLoading: queueLoading } = useOrderQueue(dept);
  const rawQueue = queueData?.data;
  const queueOrders: OrderItem[] = Array.isArray(rawQueue) ? rawQueue : (rawQueue as Record<string, unknown> | undefined)?.data as OrderItem[] ?? [];

  // Sort + DUR filter
  const sortedOrders = useMemo(() => {
    let list = mode === 'my-orders' ? [...myOrders] : [...queueOrders];
    if (durFilter) {
      list = list.filter(o => o.prescription?.durChecked && Array.isArray(o.prescription.durWarnings) && o.prescription.durWarnings.length > 0);
    }
    if (urgentOnly) {
      list = list.filter(o => ['STAT', 'URGENT'].includes(o.priority ?? '') || ['STAT', 'URGENT'].includes(o.prescription?.priority ?? ''));
    }
    if (search.trim()) {
      // 환자명·MRN·처방명 — 목록이 길 때 상태·유형만으로는 못 찾는다
      const q = search.trim().toLowerCase();
      list = list.filter((o) => `${patientLabel(o)} ${mrnLabel(o)} ${rxName(o)}`.toLowerCase().includes(q));
    }
    if (!sortKey) return list;
    list.sort((a, b) => {
      let va = '', vb = '';
      if (sortKey === 'patient') { va = patientLabel(a); vb = patientLabel(b); }
      else if (sortKey === 'name') { va = rxName(a); vb = rxName(b); }
      else if (sortKey === 'time') { va = a.createdAt ?? ''; vb = b.createdAt ?? ''; }
      else if (sortKey === 'priority') { va = a.priority ?? 'ROUTINE'; vb = b.priority ?? 'ROUTINE'; }
      else if (sortKey === 'status') { va = a.status; vb = b.status; }
      else if (sortKey === 'type') {
        // 라벨 가나다가 아니라 **탭과 같은 업무 순서**로 — 화면 두 곳의 순서가 어긋나면 혼란스럽다
        const rank = (o: OrderItem) => {
          const i = TYPE_ORDER.indexOf(o.prescription?.type ?? '');
          return String(i < 0 ? TYPE_ORDER.length : i).padStart(2, '0');
        };
        va = rank(a); vb = rank(b);
      }
      const cmp = va.localeCompare(vb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [mode, myOrders, queueOrders, sortKey, sortDir, durFilter, urgentOnly, search]);

  const toggleSort = (key: string) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleStatus = (id: string, status: string) => changeStatus.mutate({ id, status });

  // 화면 내 핫키 (Mac 친화)
  useHotkeys([
    { combo: 'alt+o', label: tAttr('새 처방 입력'), group: tAttr('처방(CPOE)'), when: () => canEnterOrder && !showNewOrder, onTrigger: () => setShowNewOrder(true) },
  ]);

  const isLoading = mode === 'my-orders' ? myLoading : queueLoading;

  if (myError) return <QueryErrorFallback error={myErr} onRetry={myRefetch} />;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="처방 관리 (CPOE)" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="Computerized Physician Order Entry · 오더 추적 · 부서별 대기열" /></p>
        </div>
        {canEnterOrder && (
          <button onClick={() => setShowNewOrder(true)} aria-keyshortcuts={ariaKeyshortcuts('alt+o')} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
            <T k="새 처방 입력" /> <kbd className="text-[10px] font-semibold bg-white/20 rounded px-1.5 py-0.5">{comboLabel('alt+o')}</kbd>
          </button>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {canEnterOrder && (
          <button onClick={() => setMode('my-orders')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'my-orders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            내 처방
            {counts.ordered + counts.received + counts.inProgress > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{counts.ordered + counts.received + counts.inProgress}</span>
            )}
          </button>
        )}
        <button onClick={() => setMode('queue')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'queue' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="부서별 대기열" />
        </button>
        <button onClick={() => setMode('tracking')} data-orders-mode="tracking"
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'tracking' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="실시간 추적" />
        </button>
        <button onClick={() => setMode('matrix')} data-orders-mode="matrix"
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'matrix' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="환자별 매트릭스" />
        </button>
        <button onClick={() => setMode('governance')} data-orders-mode="governance"
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'governance' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="위원회 기준" />
        </button>
        {/* CPOE 질 지표 — 서버 @Roles(ADMIN·DOCTOR) · 의사는 본인 처방만 */}
        {(isDoctor || isAdmin) && (
          <button onClick={() => setMode('quality')} data-orders-mode="quality"
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'quality' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k="CPOE 질 지표" />
          </button>
        )}
      </div>

      {mode === 'quality' && <OrderQualityPanel />}

      {mode === 'governance' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input type="date" value={trackDate} onChange={(e) => e.target.value && setTrackDate(e.target.value)} aria-label={tAttr('발행일')}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </div>
          <OrderGovernancePanel date={trackDate} />
        </div>
      )}

      {(mode === 'tracking' || mode === 'matrix') && (
        <div className="space-y-4">
          <TrackFilters date={trackDate} setDate={setTrackDate} dept={trackDept} setDept={setTrackDept} care={trackCare} setCare={setTrackCare}
            statOnly={trackStat} setStatOnly={setTrackStat} search={trackSearch} setSearch={setTrackSearch} />
          {mode === 'tracking'
            ? <OrderTrackingBoard date={trackDate} filters={{ dept: trackDept, care: trackCare, statOnly: trackStat, search: trackSearch }} />
            : <OrderPatientMatrix date={trackDate} filters={{ dept: trackDept, care: trackCare, statOnly: trackStat, search: trackSearch }} />}
        </div>
      )}

      {/* ── 내 처방 모드 ── */}
      {mode === 'my-orders' && (
        <>
          {/* Status + Type Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Status cards */}
            <div className="flex gap-2">
              {[
                { f: '', label: '전체', val: counts.total, cls: 'border-gray-200 text-gray-700' },
                { f: 'ORDERED', label: ORDER_STATUS_LABEL.ORDERED, val: counts.ordered, cls: 'border-amber-200 text-amber-700' },
                { f: 'RECEIVED', label: ORDER_STATUS_LABEL.RECEIVED, val: counts.received, cls: 'border-blue-200 text-blue-700' },
                { f: 'IN_PROGRESS', label: ORDER_STATUS_LABEL.IN_PROGRESS, val: counts.inProgress, cls: 'border-violet-200 text-violet-700' },
                { f: 'COMPLETED', label: ORDER_STATUS_LABEL.COMPLETED, val: counts.completed, cls: 'border-emerald-200 text-emerald-700' },
                // 🔴 취소는 카드가 없어 골라 볼 수 없었다 — 취소 사유 확인이 필요한 업무다
                { f: 'CANCELLED', label: ORDER_STATUS_LABEL.CANCELLED ?? '취소', val: counts.cancelled, cls: 'border-gray-300 text-gray-600' },
              ].map(s => (
                <button key={s.f} onClick={() => setStatusFilter(s.f)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${statusFilter === s.f ? s.cls + ' bg-white ring-2 ring-blue-300 ring-offset-1' : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200'}`}>
                  <T k={s.label} /> <span className="font-bold ml-0.5">{s.val}</span>
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* 진료 맥락 — 환자가 어디에 있는가로 처리 우선순위·시간대가 갈린다 */}
            <div className="flex flex-wrap items-center gap-1">
              <button onClick={() => setCareFilter('')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${careFilter === '' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                <T k="전 구역" />
              </button>
              {CARE_ORDER.map(id => {
                const ui = CARE_UI[id];
                const n = counts.byCare?.[id] ?? 0;
                return (
                  <button key={id} onClick={() => setCareFilter(careFilter === id ? '' : id)} title={tAttr(ui.hint)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${careFilter === id ? 'bg-gray-800 text-white' : n === 0 ? 'bg-gray-50 text-gray-300' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {ui.icon} <T k={ui.label} /><span className="ml-0.5">({n})</span>
                  </button>
                );
              })}
              <button onClick={() => setNightOnly(v => !v)}
                title={tAttr('야간 당직이 지금 처리해야 할 오더 — 입원·응급·중환자 + 긴급도(외래 루틴 제외)')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${nightOnly ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 ring-offset-1' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                <T k="🌙 야간 처리" /><span className="ml-0.5">({counts.night ?? 0})</span>
              </button>
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* Type filter */}
            <div className="flex flex-wrap gap-1">
              {typeTabs.map(t => (
                <button key={t.id} onClick={() => setTypeFilter(t.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${typeFilter === t.id ? 'bg-blue-600 text-white' : t.count === 0 && t.id ? 'bg-gray-50 text-gray-300' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {t.icon && `${t.icon} `}<T k={t.label} />{t.id && <span className="ml-0.5">({t.count})</span>}
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* Date filter */}
            <div className="flex gap-1">
              {DATE_TABS.map(d => (
                <button key={d.id} onClick={() => setDateMode(d.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${dateMode === d.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <T k={d.label} />
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* 긴급도 — 🔴 종전엔 정렬만 되고 필터가 없어 STAT 를 골라 볼 수 없었다 */}
            <button onClick={() => setUrgentOnly(v => !v)}
              title={tAttr('STAT·응급 오더만 보기')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${urgentOnly ? 'bg-rose-600 text-white ring-2 ring-rose-300 ring-offset-1' : 'border border-gray-200 bg-white text-gray-600 hover:border-rose-300 hover:text-rose-600'}`}>
              🚨 긴급 {(counts.stat + counts.urgent) > 0 && <span className="font-bold">({counts.stat + counts.urgent})</span>}
            </button>

            {/* 환자·처방 검색 — 목록이 길면 상태·유형만으로는 못 찾는다 */}
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tAttr('환자·MRN·처방명 검색')}
                className="w-52 rounded-lg border border-gray-200 py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">🔍</span>
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* DUR/CDSS filter */}
            <button onClick={() => setDurFilter(f => !f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${durFilter ? 'bg-red-600 text-white ring-2 ring-red-300 ring-offset-1' : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600'}`}>
              <span>⚠️</span> DUR/CDSS {counts.dur > 0 && <span className="font-bold">({counts.dur})</span>}
            </button>
          </div>

          {/* 필터로 좁혀진 상태를 명시 — 상단 건수(전체 18)와 표 줄 수가 달라 보이면 데이터가 틀린 줄 안다 */}
          {sortedOrders.length !== counts.total && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50/70 px-3 py-1.5 text-[11px] text-blue-800">
              <span>
                <T k="필터 적용 중 — 전체" /> {counts.total}<Unit><T k="건" /></Unit> <T k="중@분모" /> <b>{sortedOrders.length}</b><Unit><T k="건" /></Unit> <T k="표시" />
              </span>
              <span className="text-blue-500">
                {[
                  statusFilter && `${tAttr('상태')} ${tAttr(ORDER_STATUS_LABEL[statusFilter] ?? statusFilter)}`,
                  typeFilter && `${tAttr('유형')} ${tAttr(TYPE_LABEL[typeFilter] ?? typeFilter)}`,
                  careFilter && `${tAttr('맥락')} ${tAttr(CARE_UI[careFilter]?.label ?? careFilter)}`,
                  nightOnly && tAttr('야간 처리 대상'),
                  durFilter && 'DUR/CDSS',
                  urgentOnly && tAttr('긴급'),
                  search.trim() && `${tAttr('검색')} "${search.trim()}"`,
                ].filter(Boolean).join(' · ')}
              </span>
              <button
                onClick={() => { setStatusFilter(''); setTypeFilter(''); setDurFilter(false); setUrgentOnly(false); setSearch(''); setCareFilter(''); setNightOnly(false); }}
                className="ml-auto rounded border border-blue-200 bg-white px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100"
              >
                <T k="필터 해제" />
              </button>
            </div>
          )}

          {/* Orders Table */}
          <OrderTable
            orders={sortedOrders}
            isLoading={isLoading}
            expandedId={expandedId}
            onExpand={id => setExpandedId(expandedId === id ? null : id)}
            onStatus={handleStatus}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            showDept
          />
        </>
      )}

      {/* ── 부서별 대기열 모드 ── */}
      {mode === 'queue' && (
        <>
          <div className="flex items-center gap-2 mb-5">
            {DEPT_TABS.map(d => (
              <button key={d.id} onClick={() => setDept(d.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${dept === d.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
                <span>{d.icon}</span> <T k={d.label} />
              </button>
            ))}
            <div className="w-px h-8 bg-gray-200" />
            <button onClick={() => setDurFilter(f => !f)}
              className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${durFilter ? 'bg-red-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300 hover:text-red-600'}`}>
              <span>⚠️</span> <T k="DUR/CDSS만" />
            </button>
          </div>

          <OrderTable
            orders={sortedOrders}
            isLoading={isLoading}
            expandedId={expandedId}
            onExpand={id => setExpandedId(expandedId === id ? null : id)}
            onStatus={handleStatus}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        </>
      )}

      {showNewOrder && <QuickOrderModal onClose={() => setShowNewOrder(false)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Order Table
   ═══════════════════════════════════════════════════════════════ */

function SortHeader({ label, sortKey: sk, currentKey, dir, onSort }: { label: string; sortKey: string; currentKey: string; dir: string; onSort: (k: string) => void }) {
  const active = currentKey === sk;
  return (
    <th onClick={() => onSort(sk)} className="px-3 py-2.5 text-left font-medium cursor-pointer hover:text-blue-600 select-none">
      <T k={label} /> {active && <span className="text-blue-500">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function OrderTable({
  orders, isLoading, expandedId, onExpand, onStatus, sortKey, sortDir, onSort, showDept,
}: {
  orders: OrderItem[];
  isLoading: boolean;
  expandedId: string | null;
  onExpand: (id: string) => void;
  onStatus: (id: string, status: string) => void;
  sortKey: string;
  sortDir: string;
  onSort: (k: string) => void;
  showDept?: boolean;
}) {
  // 완료는 시행 범위 안에서만(서버도 거부) — 표가 오기 전·실패 시엔 종전처럼 보인다(서버가 판정)
  const execScope = useEntryScope();
  const canComplete = (type?: string) => !type || execScope.data?.executes?.[type] !== false;
  const tAttr = useTAttr();
  if (isLoading) return <LoadingSkeleton />;
  if (orders.length === 0) return <EmptyState icon="💊" title="처방 내역이 없습니다." className="bg-white rounded-2xl border border-gray-100 shadow-sm" />;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-100">
              <SortHeader label="상태" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="유형" sortKey="type" currentKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="환자" sortKey="patient" currentKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="처방 내용" sortKey="name" currentKey={sortKey} dir={sortDir} onSort={onSort} />
              <th className="px-3 py-2.5 text-left font-medium"><T k="용량·빈도" /></th>
              <SortHeader label="긴급도" sortKey="priority" currentKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="시간" sortKey="time" currentKey={sortKey} dir={sortDir} onSort={onSort} />
              <th className="px-3 py-2.5 text-right font-medium"><T k="액션" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {orders.map(order => {
              const rx = order.prescription;
              const isStat = order.priority === 'STAT' || rx?.priority === 'STAT';
              const durWarns = Array.isArray(rx?.durWarnings) ? rx!.durWarnings as { type?: string }[] : [];
              const hasDurWarn = rx?.durChecked && durWarns.length > 0;
              const hasHighAlert = durWarns.some(w => w.type === 'HIGH_ALERT');
              const isExpanded = expandedId === order.id;

              return (
                <tr key={order.id} className="contents">
                  {/* Main Row */}
                  <tr
                    onClick={() => onExpand(order.id)}
                    className={`cursor-pointer transition-colors group ${isStat ? 'bg-red-50/40 border-l-3 border-l-red-500' : 'hover:bg-blue-50/30'} ${isExpanded ? 'bg-blue-50/50' : ''}`}
                  >
                    <td className="px-3 py-3">
                      <StatusBadge domain="order" status={order.status} className="text-[10px] font-bold whitespace-nowrap" />
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs">{TYPE_ICON[rx?.type ?? ''] ?? '📋'} <T k={TYPE_LABEL[rx?.type ?? ''] ?? rx?.type ?? ''} /></span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900">{patientLabel(order)}</span>
                        {/* 어느 구역 환자인가 — 처리 방식이 여기서 갈린다(외래는 배지 없음: 기본값에 잉크를 쓰지 않는다) */}
                        {order.careContext && order.careContext !== 'OUTPATIENT' && CARE_UI[order.careContext] && (
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${CARE_UI[order.careContext].cls}`}
                            title={tAttr(CARE_UI[order.careContext].hint)}>
                            {CARE_UI[order.careContext].icon} <T k={CARE_UI[order.careContext].label} />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        {mrnLabel(order)}
                        {order.issuedAtNight && <span className="text-indigo-400" title={tAttr('야간 시간대(22~06시)에 발행된 오더')}>🌙</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm font-medium text-gray-900">
                        {/* 표시만 용어 모드를 따른다 — 검색(:279)·정렬(:285)은 rxName 문자열 그대로(불변) */}
                        {order.prescription?.medicationCode
                          ? <DrugName nameKo={order.prescription.medicationCode.nameKo} nameEn={order.prescription.medicationCode.nameEn} ingredient={order.prescription.medicationCode.ingredient} />
                          : rxName(order)}
                      </span>
                      {hasHighAlert && (
                        <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-red-100 text-red-700">🔴HAM</span>
                      )}
                      {hasDurWarn && (
                        <span className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${rx?.durOverridden ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {rx?.durOverridden ? <T k="🚫DUR무시" /> : '⚠️DUR'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">
                      {rx?.type === 'MEDICATION' ? (
                        <span>{rx?.dosage ?? '-'} {rx?.frequency ?? ''}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {isStat ? (
                        <span className="text-[10px] font-bold bg-red-600 text-white px-2 py-0.5 rounded whitespace-nowrap">STAT</span>
                      ) : order.priority === 'PRN' ? (
                        <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded whitespace-nowrap">PRN</span>
                      ) : (
                        <span className="text-xs text-gray-400"><T k="일반" /></span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400 tabular-nums">{elapsed(order.createdAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex gap-1.5 justify-end">
                        {order.status === 'ORDERED' && (
                          <button onClick={e => { e.stopPropagation(); onStatus(order.id, 'RECEIVED'); }} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"><T k="접수" /></button>
                        )}
                        {order.status === 'RECEIVED' && (
                          <button onClick={e => { e.stopPropagation(); onStatus(order.id, 'IN_PROGRESS'); }} className="px-3 py-1 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 transition-colors"><T k="시작" /></button>
                        )}
                        {order.status === 'IN_PROGRESS' && canComplete(rx?.type) && (
                          <button onClick={e => { e.stopPropagation(); onStatus(order.id, 'COMPLETED'); }} data-row-complete className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"><T k="완료" /></button>
                        )}
                        {order.status === 'COMPLETED' && (
                          <span className="text-[10px] text-emerald-500 font-medium"><T k="✓ 완료" /></span>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Detail Row (Accordion) */}
                  {isExpanded && (
                    <tr className="bg-gray-50/80">
                      <td colSpan={8} className="px-5 py-4">
                        <OrderDetail order={order} onStatus={onStatus} />
                      </td>
                    </tr>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Order Detail (Accordion)
   ═══════════════════════════════════════════════════════════════ */

const PERFORMER_ROLE_LABEL: Record<string, string> = {
  NURSE: '간호사', LAB_TECH: '검사자', PHARMACIST: '약사', DOCTOR: '의사', ADMIN: '관리자',
};

function performerName(u?: { familyName?: string; givenName?: string; role?: string } | null): string {
  if (!u) return '';
  const name = `${u.familyName ?? ''}${u.givenName ?? ''}`.trim();
  if (!name) return '';
  const role = u.role ? PERFORMER_ROLE_LABEL[u.role] ?? '' : '';
  return ` · ${name}${role ? ` (${role})` : ''}`;
}

function OrderDetail({ order, onStatus }: { order: OrderItem; onStatus: (id: string, status: string) => void }) {
  const tAttr = useTAttr();
  const rx = order.prescription;
  const doctor = rx?.encounter?.doctor;
  const durWarnings = Array.isArray(rx?.durWarnings) ? rx!.durWarnings as { type?: string; message?: string; severity?: string }[] : [];

  return (
    <div className="space-y-3">
      {/* Info grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-gray-400"><T k="약품/검사" /></span>
          <p className="font-medium text-gray-900 mt-0.5">
            {rx?.medicationCode
              ? <DrugName nameKo={rx.medicationCode.nameKo} nameEn={rx.medicationCode.nameEn} ingredient={rx.medicationCode.ingredient} />
              : rxName(order)}
            {' '}{rx?.medicationCode?.code ? `(${rx.medicationCode.code})` : rx?.procedureCode?.code ? `(${rx.procedureCode.code})` : ''}
          </p>
          {rx?.medicationCode?.dosageForm && <p className="text-gray-400">{rx.medicationCode.dosageForm}</p>}
        </div>
        {rx?.type === 'MEDICATION' && (
          <div>
            <span className="text-gray-400"><T k="용량·투여" /></span>
            <p className="font-medium text-gray-900 mt-0.5">{rx.dosage ?? '-'} | {rx.route ?? '-'} | {rx.frequency ?? '-'}</p>
            <p className="text-gray-400">{rx.duration ?? '-'}<Unit><T k="일" /></Unit> | 총 {rx.quantity ?? '-'}정</p>
          </div>
        )}
        <div>
          <span className="text-gray-400"><T k="처방의" /></span>
          <p className="font-medium text-gray-900 mt-0.5">{doctor ? `${doctor.familyName}${doctor.givenName}` : '-'} {doctor?.department ? `(${doctor.department})` : ''}</p>
        </div>
        <div>
          <span className="text-gray-400"><T k="오더 타임라인" /></span>
          <div className="mt-0.5 space-y-0.5">
            <p className="text-gray-700">처방: {order.createdAt ? kdate(order.createdAt, 'datetimeSec') : '-'}</p>
            {order.receivedAt && <p className="text-blue-600">접수: {kdate(order.receivedAt, 'datetimeSec')}{performerName(order.receiver)}</p>}
            {order.acknowledgedAt && <p className="text-amber-600">확인: {kdate(order.acknowledgedAt, 'datetimeSec')}{performerName(order.acknowledger)}</p>}
            {order.startedAt && <p className="text-violet-600">시작: {kdate(order.startedAt, 'datetimeSec')}{performerName(order.starter)}</p>}
            {order.completedAt && <p className="text-emerald-600">완료: {kdate(order.completedAt, 'datetimeSec')}{performerName(order.completer)}</p>}
          </div>
        </div>
      </div>

      {/* 결과·결과지·행위 종료 기록(2026-09-29) — 종전 JSON 그대로 찍던 자리. 시행 직종이 자기 범위 안에서 남긴다 */}
      <OrderResultPanel orderId={order.id} type={rx?.type} status={order.status} result={order.result} />
      {order.notes && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 text-xs">
          <span className="font-semibold text-gray-500"><T k="메모" /></span>
          <p className="mt-0.5 whitespace-pre-wrap text-gray-700">{order.notes}</p>
        </div>
      )}

      {/* DUR Warnings */}
      {durWarnings.length > 0 && (
        <DurWarningPanel durWarnings={durWarnings} order={order} rx={rx} />
      )}

      {/* 이송 전 안전 확인 — 영상 오더에서 **시행 전** 상태일 때. 조영제·신기능·임신·누적선량.
          환자를 준비·이송하는 간호사가 보는 값이라 시행 시점 게이트와 별개로 여기서 읽는다. */}
      {rx?.type === 'IMAGING' && order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <span aria-hidden>🩺</span> <T k="이송 전 안전 확인" />
          </p>
          <ImagingSafetyPrecheck orderId={order.id} />
        </div>
      )}

      {/* 서명 로그 — 이 오더에 누가 언제 무엇을 했는지(봉인본). 기본 접힘: 평소엔 진료 정보를 가린다 */}
      <details open className="rounded-xl border border-gray-100 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <span aria-hidden>🔏</span>
          <T k="서명 로그" />
          <span className="text-[10px] font-normal text-gray-400"><T k="발행·접수·시행·완료·취소가 sign 원장에 봉인됩니다" /></span>
          <span className="ml-auto text-gray-400">▾</span>
        </summary>
        <div className="border-t border-gray-100 px-3 py-2.5">
          <OrderSignLogPanel orderId={order.id} />
        </div>
      </details>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Link href={`/patients/${rx?.encounter?.patientId ?? '#'}`} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"><T k="환자 차트" /></Link>
        {(order.status === 'ORDERED' || order.status === 'RECEIVED') && (
          <button onClick={() => onStatus(order.id, 'CANCELLED')} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"><T k="오더 취소" /></button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Quick Order Modal (with Order Set tab)
   ═══════════════════════════════════════════════════════════════ */

function QuickOrderModal({ onClose }: { onClose: () => void }) {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const [step, setStep] = useState<'patient' | 'prescribe'>('patient');
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchItem | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OrderTab | 'ORDERSET'>('MEDICATION');
  /** 처방 도우미에서 고른 세트 — 약속처방 탭에서 바로 미리보기로 연다 */
  const [orderSetPreviewId, setOrderSetPreviewId] = useState<string | undefined>(undefined);
  const [selectedCode, setSelectedCode] = useState<CodeItem | null>(null);
  const [medForm, setMedForm] = useState({ dosage: '', frequency: '1일 3회', duration: 5, quantity: 15, route: '경구', priority: 'ROUTINE' });
  const [dispensingType, setDispensingType] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  const [prescriptions, setPrescriptions] = useState<Array<{ type: string; name: string; code: string; dosage?: string; frequency?: string; priority?: string; dispensingType?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [cdssResult, setCdssResult] = useState<CdssCheckResult | null>(null);
  const [cdssLoading, setCdssLoading] = useState(false);
  /** 점검 실패 — 결과 없음(점검 안 함)과 다른 사실이다(실패를 "경고 없음"으로 접지 않는다 · 2026-10-21) */
  const [cdssFailed, setCdssFailed] = useState(false);
  // 차트(진료화면)와 같은 동작 — 상병 연결·DUR 경고·강제 처방 사유.
  // 종전엔 이 셋이 없어 같은 EP 를 쓰면서도 DUR 차단 시 "처방 추가 실패" 토스트만 뜨고 진행할 방법이 없었고,
  // 상병이 안 붙어 처방 근거(A↔P)·청구 연계가 비어 있었다.
  const [diagnoses, setDiagnoses] = useState<DiagnosisItem[]>([]);
  const [durWarnings, setDurWarnings] = useState<{ type?: string; message?: string; severity?: string }[]>([]);
  // delegateBody 를 함께 들고 있는다 — 승인 토큰은 1회 소비라 강제처방 재전송 때 **새로 받아야** 한다
  const [durBlock, setDurBlock] = useState<{ payload: Record<string, unknown>; delegateBody: DelegateBody; warnings: { type?: string; message?: string; severity?: string }[]; codeName: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // 사전승인 게이트(PREAUTH_REQUIRED) 차단 → 상신 동선 (gap-remediation R3).
  // 🔴 상신 성공 ≠ 처방 발행 — 승인권자(과장) 결재가 승인되어야 서버가 발행한다.
  const [preAuthBlock, setPreAuthBlock] = useState<{ payload: Record<string, unknown>; codeName: string; message: string } | null>(null);
  const [preAuthApproverId, setPreAuthApproverId] = useState('');
  const [preAuthSubmitting, setPreAuthSubmitting] = useState(false);
  // 상신·조회 EP 는 DOCTOR/ADMIN 전용(RolesGuard) — 다른 역할에 상시 403 배너를 만들지 않는다
  const canPreAuth = user?.role === 'DOCTOR' || user?.role === 'ADMIN';
  const { data: preAuthMineData, refetch: refetchPreAuthMine } = useQuery({
    queryKey: ['pre-auth-mine'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; type: string; status: string; encounterId?: string | null; createdAt: string }> }>('/api/v1/pre-auth/mine'),
    enabled: canPreAuth && step === 'prescribe',
  });
  const myPendingPreAuths = (preAuthMineData?.data ?? []).filter(p => p.status === 'PENDING');
  const { data: preAuthDoctorsData } = useQuery({
    queryKey: ['pre-auth-doctors'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; familyName?: string; givenName?: string }> }>('/api/v1/users?role=DOCTOR&limit=100'),
    enabled: !!preAuthBlock,
  });
  // 비처방 역할(간호사·임상병리사)의 대리입력 — 책임 처방의 지정 + 그 의사의 승인
  const delegate = usePrescriberDelegate(encounterId);
  // 직종별 입력 범위 — 탭마다 '본인 권한 / 의사 승인 / 불가'(환자를 고르기 전에도 보여 준다 · 정본 shared order-entry-scope)
  const entryScopeQ = useEntryScope();
  const entryModes = entryScopeQ.data?.modes;
  const isPrescriberRole = user?.role === 'DOCTOR' || user?.role === 'ADMIN';
  const modeOf = (k: string): EntryMode | null => (entryModes?.[k] as EntryMode | undefined) ?? null;
  // 지금 탭이 입력 불가면 첫 입력 가능 탭으로 옮긴다(불가 탭에 머물러 헛입력하지 않게)
  useEffect(() => {
    if (!entryModes || activeTab === 'ORDERSET') return;
    if (entryModes[activeTab] === 'NONE') {
      const first = ORDER_TABS.find((t) => entryModes[t.key] && entryModes[t.key] !== 'NONE');
      if (first) setActiveTab(first.key);
    }
  }, [entryModes, activeTab]);
  const professionLabel = entryScopeQ.data?.profession ? CLINICAL_PROFESSION_LABEL[entryScopeQ.data.profession as ClinicalProfession] ?? entryScopeQ.data.profession : null;
  const noEntryAtAll = !!entryModes && ORDER_TABS.every((t) => entryModes[t.key] === 'NONE');
  // 검색·프리셋은 차트와 **같은 부품**을 쓴다(따로 구현하면 또 어긋난다)
  const codeSearch = useCodeSearch(activeTab);
  const { list: nicList, isError: nicIsError, error: nicError, isLoading: nicIsLoading, refetch: refetchNic, usingFallback: nicUsingFallback } = useNicCodes();
  const [presetSelection, setPresetSelection] = useState<PresetItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const queryClient = useQueryClient();

  // CDSS check
  const runCdssCheck = async (medCodeId: string) => {
    if (!selectedPatient || !encounterId) return;
    // 사전 점검 EP 는 의사·관리자·간호사(구두처방 입력) — 그 밖 역할에 매번 403 을 조용히 삼키지 않는다
    if (!['DOCTOR', 'ADMIN', 'NURSE'].includes(user?.role ?? '')) return;
    setCdssLoading(true);
    setCdssFailed(false);
    try {
      const res = await apiClient.post<{ data: CdssCheckResult }>('/api/v1/cdss/check', {
        patientId: selectedPatient.id,
        medicationCodeId: activeTab === 'MEDICATION' ? medCodeId : undefined,
        procedureCodeId: activeTab !== 'MEDICATION' ? medCodeId : undefined,
        encounterId,
      });
      setCdssResult(res.data);
      setCdssFailed(false);
    } catch { setCdssResult(null); setCdssFailed(true); }
    setCdssLoading(false);
  };

  // 비의사가 붙은 진행 중 진료(재원 입원/오늘 진료) — 안내용
  const [attachedContext, setAttachedContext] = useState<{ context: 'ADMISSION' | 'TODAY'; doctorName: string | null } | null>(null);
  // Select patient → (의사) 진료 개시 / (비의사) 진행 중 진료에 붙기
  const selectPatient = async (p: PatientSearchItem) => {
    setSelectedPatient(p);
    setLoading(true);
    try {
      if (isPrescriberRole) {
        const res = await apiClient.post<{ data: { id: string } }>('/api/v1/encounters', { patientId: p.id });
        setEncounterId(res.data.id);
        setStep('prescribe');
      } else {
        /**
         * 🔴 (2026-09-29) 종전엔 역할과 무관하게 `POST /encounters`(의사·관리자 전용)를 불러 간호사·의료기사는
         *    환자 선택 단계에서 403 '진료 생성 실패'로 멈췄다 — 이 창의 비의사 입력은 개통 이래 동작한 적이 없다.
         *    진료 개시는 의사 몫이다. 비의사는 **이미 진행 중인 진료**(재원 입원 → 오늘 진료)에 오더를 붙인다.
         */
        const r = await apiClient.get<{ data: { encounterId: string | null; context: 'ADMISSION' | 'TODAY' | null; doctorName: string | null } }>(`/api/v1/patients/${p.id}/order-encounter`);
        const d = ((r?.data as unknown as { data?: unknown })?.data ?? r?.data) as { encounterId: string | null; context: 'ADMISSION' | 'TODAY' | null; doctorName: string | null };
        if (!d?.encounterId || !d.context) {
          toast.error(tAttr('진행 중인 진료가 없습니다 — 입원 중이 아니고 오늘 진료도 없습니다. 의사가 진료를 연 뒤 입력하세요.'));
          setSelectedPatient(null);
        } else {
          setEncounterId(d.encounterId);
          setAttachedContext({ context: d.context, doctorName: d.doctorName });
          setStep('prescribe');
        }
      }
    } catch (err: unknown) {
      toast.error((err as MutationError)?.message || tAttr(isPrescriberRole ? '진료 생성 실패' : '진행 중 진료를 확인하지 못했습니다'));
      if (!isPrescriberRole) setSelectedPatient(null);
    }
    setLoading(false);
  };

  // Code search

  // Add prescription
  const addPrescription = async () => {
    if (!encounterId || !selectedCode) return;
    setLoading(true);
    // payload 는 try 밖에서 만든다 — DUR 차단(catch)에서 **같은 본문 그대로** 강제 처방 재전송에 쓴다
    const primaryDx = diagnoses.find(d => d.type === 'PRIMARY')?.diagnosisCodeId;
    const payload: Record<string, unknown> = {
      type: activeTab,
      priority: medForm.priority,
      dispensingType: activeTab === 'MEDICATION' ? dispensingType : 'INTERNAL',
      // 처방의 근거 상병(SOAP A↔P·청구 연계) — 차트와 동일하게 주상병이 있을 때 동봉
      ...(primaryDx ? { diagnosisCodeId: primaryDx } : {}),
      ...(activeTab === 'MEDICATION'
        ? { medicationCodeId: selectedCode.id, dosage: medForm.dosage, frequency: medForm.frequency, duration: medForm.duration, quantity: medForm.quantity, route: medForm.route }
        : { procedureCodeId: selectedCode.id }),
    };
    // 승인 요청에 넘기는 본문 — 서버 bodyHash 와 필드·값이 같아야 한다(DUR 강제처방 재요청에도 재사용)
    const delegateBody: DelegateBody = {
      type: activeTab,
      ...(activeTab === 'MEDICATION'
        ? { medicationCodeId: selectedCode.id, dosage: medForm.dosage, frequency: medForm.frequency, duration: medForm.duration, quantity: medForm.quantity, route: medForm.route }
        : { procedureCodeId: selectedCode.id }),
    };
    // 비처방 역할이면 저장 전에 지정 처방의 승인을 받는다(서버도 없으면 거부한다)
    const auth = await delegate.authorize(delegateBody);
    if (!auth) { toast.error(delegate.error || tAttr('지정 처방의 승인을 받지 못했습니다.')); setLoading(false); return; }
    Object.assign(payload, auth.fields);

    try {
      const res = await apiClient.post<{ data?: { id?: string }; durWarnings?: { type?: string; message?: string; severity?: string }[] }>(
        `/api/v1/encounters/${encounterId}/prescriptions`, payload, auth.headers,
      );
      setPrescriptions(prev => [...prev, { type: activeTab, name: selectedCode.nameKo, code: selectedCode.code, ...medForm, dispensingType }]);
      setSelectedCode(null); codeSearch.reset(); setCdssResult(null);
      // 차트와 동일 — 통과했더라도 경고가 있으면 띄운다(통과 ≠ 안전)
      if (res.durWarnings?.length) {
        setDurWarnings(res.durWarnings);
        toast.warning(tAttr('DUR 경고가 있습니다. 확인해주세요.'));
      } else {
        toast.success(`${selectedCode.nameKo} ${tAttr('처방 추가')}`);
      }
    } catch (err: unknown) {
      const typed = err as MutationError;
      const details = typed.details as Record<string, unknown> | undefined;
      if (details?.durWarnings) {
        // DUR BLOCK — 차트와 동일하게 **사유를 받아 강제 처방**으로 유도한다.
        // 토스트만 띄우면 의사는 왜 막혔는지도, 어떻게 진행할지도 알 수 없다.
        const warnings = details.durWarnings as { type?: string; message?: string; severity?: string }[];
        setDurWarnings(warnings);
        setDurBlock({ payload, delegateBody, warnings, codeName: selectedCode.nameKo });
        setOverrideReason('');
      } else if ((typed as { code?: string }).code === 'PREAUTH_REQUIRED') {
        // 사전승인 게이트(BLOCK) — 토스트만 띄우면 의사는 갈 곳이 없다(R3). 상신 동선을 그 자리에서 연다.
        setPreAuthBlock({ payload, codeName: selectedCode.nameKo, message: typed?.message || tAttr('사전승인이 필요한 처방입니다.') });
        setPreAuthApproverId('');
      } else {
        toast.error(typed?.message || tAttr('처방 추가 실패'));
      }
    }
    setLoading(false);
  };

  /**
   * 프리셋 유형(치료·활동·간호지시) 일괄 처방 — 선택한 항목을 **각각 개별 처방 행**으로 만든다.
   * 한 행에 묶으면 나중에 하나만 중단할 수 없다.
   */
  const addPresetPrescriptions = async () => {
    if (!encounterId || presetSelection.length === 0) return;
    setLoading(true);
    const created: typeof prescriptions = [];
    const failed: string[] = [];
    for (const item of presetSelection) {
      const payload: Record<string, unknown> = { type: activeTab, priority: medForm.priority, instructions: item.name };
      try {
        // 항목마다 개별 승인 — 토큰은 1회 소비이고 본문에 바인딩된다
        const auth = await delegate.authorize({ type: activeTab });
        if (!auth) throw new Error(delegate.error || tAttr('지정 처방의 승인을 받지 못했습니다.'));
        Object.assign(payload, auth.fields);
        await apiClient.post(`/api/v1/encounters/${encounterId}/prescriptions`, payload, auth.headers);
        created.push({ type: activeTab, name: item.name, code: item.code, priority: medForm.priority });
      } catch { failed.push(item.name); }
    }
    if (created.length) setPrescriptions(prev => [...prev, ...created]);
    if (failed.length) toast.error(`${tAttr('실패')}: ${failed.join(', ')}`);
    else toast.success(`${tAttr(activeTab === 'NURSING' ? '간호 지시' : activeTab === 'THERAPY' ? '치료 처방' : '활동 제한')} ${created.length}${tAttr('건이 추가되었습니다.')}`);
    setPresetSelection([]);
    setLoading(false);
  };

  /** DUR 경고 무시 강제처방 — 사유와 함께 재전송(약국·심사 추적) */
  const forcePrescribe = async () => {
    if (!durBlock || !encounterId || !overrideReason.trim()) return;
    setLoading(true);
    // 재전송도 처방 생성이다 — 앞선 승인 토큰은 이미 소비됐으므로 승인을 다시 받는다.
    // (overrideDur/사유는 bodyHash 대상이 아니라 같은 본문으로 승인받으면 된다)
    const auth = await delegate.authorize(durBlock.delegateBody);
    if (!auth) { toast.error(delegate.error || tAttr('지정 처방의 승인을 받지 못했습니다.')); setLoading(false); return; }
    try {
      await apiClient.post(`/api/v1/encounters/${encounterId}/prescriptions`, {
        ...durBlock.payload, ...auth.fields,
        overrideDur: true, overrideReason: overrideReason.trim(),
      }, auth.headers);
      setPrescriptions(prev => [...prev, { type: String(durBlock.payload.type), name: durBlock.codeName, code: '', ...medForm, dispensingType }]);
      toast.success(`${durBlock.codeName} ${tAttr('강제 처방되었습니다(사유 기록).')}`);
      setDurBlock(null); setOverrideReason('');
      setSelectedCode(null); codeSearch.reset(); setCdssResult(null);
    } catch (err: unknown) {
      const typed = err as MutationError & { code?: string };
      if (typed.code === 'PREAUTH_REQUIRED') {
        // DUR 강제 이후에도 사전승인 게이트가 남는다 — 강제 사유(overrideDur)를 초안에 담아 상신으로 잇는다
        setPreAuthBlock({
          payload: { ...durBlock.payload, overrideDur: true, overrideReason: overrideReason.trim() },
          codeName: durBlock.codeName,
          message: typed.message || tAttr('사전승인이 필요한 처방입니다.'),
        });
        setPreAuthApproverId('');
        setDurBlock(null); setOverrideReason('');
      } else {
        toast.error(typed?.message || tAttr('강제 처방 실패'));
      }
    }
    setLoading(false);
  };

  /**
   * 사전승인 상신(R3) — 차단된 처방 본문을 초안(draft) 스냅샷으로 상신한다.
   * 🔴 상신 성공은 발행이 아니다 — 승인권자 결재 승인 시 서버가 preAuthRef 를 동반해 발행한다.
   * 승인권자 미지정이면 서버가 처방의의 관리자(과장)로 해소한다(미등록이면 400 으로 알려준다).
   */
  const submitPreAuth = async () => {
    if (!preAuthBlock || !encounterId) return;
    setPreAuthSubmitting(true);
    try {
      await apiClient.post('/api/v1/pre-auth/orders', {
        // 유형은 게이트 판별과 같은 축 — 약이면 마약류, 영상이면 고가·특수 검사
        type: preAuthBlock.payload.type === 'MEDICATION' ? 'NARCOTIC_RX' : 'HIGH_COST_IMAGING',
        encounterId,
        draft: preAuthBlock.payload,
        ...(preAuthApproverId ? { approverUserId: preAuthApproverId } : {}),
      });
      toast.success(tAttr('사전승인을 상신했습니다 — 승인되면 처방이 발행됩니다(아직 발행 전).'));
      setPreAuthBlock(null);
      setSelectedCode(null); codeSearch.reset(); setCdssResult(null);
      void refetchPreAuthMine();
    } catch (err: unknown) {
      toast.error((err as MutationError)?.message || tAttr('사전승인 상신 실패'));
    }
    setPreAuthSubmitting(false);
  };

  /** 상신 취소 — PENDING 만 서버가 허용한다 */
  const cancelPreAuth = async (id: string) => {
    try {
      await apiClient.post(`/api/v1/pre-auth/${id}/cancel`, {});
      toast.success(tAttr('상신을 취소했습니다.'));
      void refetchPreAuthMine();
    } catch (err: unknown) {
      toast.error((err as MutationError)?.message || tAttr('취소 실패'));
    }
  };

  // Finish (sign)
  const [finished, setFinished] = useState(false);
  const finish = async () => {
    if (!encounterId || finished || loading) return;
    setLoading(true);
    try {
      // 진단을 진료에 먼저 반영 — 서명 후에는 붙일 수 없다(차트와 동일 순서)
      if (diagnoses.length) {
        try {
          await apiClient.put(`/api/v1/encounters/${encounterId}`, {
            diagnoses: diagnoses.map(d => ({ diagnosisCodeId: d.diagnosisCodeId, type: d.type, certainty: d.certainty })),
          });
        } catch { /* 진단 저장 실패가 서명을 막지는 않는다(처방엔 이미 상병이 붙어 있다) */ }
      }
      await apiClient.patch(`/api/v1/encounters/${encounterId}/sign`);
      /**
       * 🔴 종전: `catch {}` 가 수납 생성 실패를 삼키고 "서명+수납" 성공을 알렸다(P16).
       *    실제로는 이 EP 에 DOCTOR 가 없어 의사에게 **언제나 403** — 이 버튼에서 수납이
       *    만들어진 적이 없었다(운영 실측: 최근 3달 의사 서명 178건 중 무청구 8건).
       *    서명과 수납은 다른 사실이다 — 갈라서 말한다.
       */
      let billingMsg = tAttr('수납 대기 생성');
      try {
        await apiClient.post(`/api/v1/encounters/${encounterId}/billing`, {});
      } catch (be: unknown) {
        const bm = (be as MutationError)?.message || '';
        billingMsg = bm.includes('already exists')
          ? tAttr('수납 이미 존재')
          : tAttr('⚠ 수납 생성 실패 — 원무에서 수동 생성 필요');
      }
      setFinished(true);
      toast.success(`${tAttr('처방 서명 완료')} · ${billingMsg}`);
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      onClose();
    } catch (err: unknown) {
      const msg = (err as MutationError)?.message || '';
      toast.error(msg.includes('DRAFT') ? tAttr('이미 서명 완료된 진료입니다.') : msg || tAttr('서명 실패'));
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl min-h-[70vh] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-bold text-lg"><T k="새 처방 입력" /></h3>
            {selectedPatient && (
              <p className="text-sm text-blue-100 mt-0.5">{selectedPatient.familyName}{selectedPatient.givenName} <span className="text-blue-300 text-xs">({selectedPatient.mrn})</span></p>
            )}
            {/* 비의사: 어떤 직종으로 판정됐는지 밝힌다(역할 기본으로 떨어졌으면 그 사실도) */}
            {!isPrescriberRole && professionLabel && (
              <p className="mt-1 text-[11px] text-blue-100" data-entry-profession>
                <T k="입력 직종" />: <b className="text-white">{professionLabel}</b>
                {entryScopeQ.data?.professionSource === 'ROLE_DEFAULT' && <span className="ml-1 text-blue-200">(<T k="역할 기본 — 관리자가 직종을 지정하지 않음" />)</span>}
                {entryScopeQ.data?.professionSource === 'MISMATCH_IGNORED' && <span className="ml-1 text-amber-200">(<T k="지정 직종이 역할과 맞지 않아 역할 기본으로 판정" />)</span>}
              </p>
            )}
            {!isPrescriberRole && attachedContext && (
              <p className="mt-0.5 text-[11px] text-blue-100" data-attached-encounter={attachedContext.context}>
                <T k={attachedContext.context === 'ADMISSION' ? '재원 중 입원 진료에 붙임' : '오늘 진료에 붙임'} />{attachedContext.doctorName ? ` · ${attachedContext.doctorName}` : ''}
              </p>
            )}
            {!isPrescriberRole && entryScopeQ.isError && <p className="mt-1 text-[11px] text-amber-200"><T k="입력 범위를 확인하지 못했습니다 — 저장 시 서버가 판정합니다." /></p>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b bg-gray-50 flex items-center gap-4 flex-shrink-0">
          <StepBadge num={1} label="환자 선택" active={step === 'patient'} done={step === 'prescribe'} />
          <div className={`w-8 h-0.5 ${step === 'prescribe' ? 'bg-emerald-400' : 'bg-gray-200'}`} />
          <StepBadge num={2} label="처방 입력" active={step === 'prescribe'} done={false} />
          <div className="w-8 h-0.5 bg-gray-200" />
          <StepBadge num={3} label="완료" active={false} done={false} />
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Step 1: Patient Selection */}
          {step === 'patient' && (
            <div className="max-w-md mx-auto py-4">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
                </div>
                <h4 className="text-base font-semibold text-gray-900"><T k="처방할 환자를 선택하세요" /></h4>
                <p className="text-xs text-gray-500 mt-1"><T k="오늘 예약 환자와 최근 진료 환자가 먼저 표시됩니다" /></p>
              </div>
              <PatientSelector
                onChange={(id, p) => { if (id) selectPatient({ id, mrn: p.mrn, familyName: p.familyName, givenName: p.givenName } as PatientSearchItem); }}
                context="order"
                autoFocus
              />
              {loading && <div className="text-center py-6"><p className="text-sm text-gray-400"><T k="진료 생성 중..." /></p></div>}
            </div>
          )}

          {/* Step 2: Prescribe */}
          {step === 'prescribe' && (
            <>
              <PrescriberPicker
                info={delegate.info}
                infoState={delegate.infoState}
                prescriberId={delegate.prescriberId}
                onSelect={(id) => { delegate.setPrescriberId(id); delegate.reset(); }}
                status={delegate.status}
                error={delegate.error}
              orderSource={delegate.orderSource}
              onOrderSource={delegate.setOrderSource}
              readBackConfirmed={delegate.readBackConfirmed}
              onReadBack={delegate.setReadBackConfirmed}
              orderType={activeTab === 'ORDERSET' ? undefined : activeTab}
              />

              {/* 상병(진단) — 차트와 동일. 처방의 근거이자 청구 연계라 처방 입력 화면이면 어디서든 필요하다 */}
              <details className="rounded-xl border border-gray-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  <span aria-hidden>🩺</span>
                  상병(진단)
                  {diagnoses.length > 0 ? (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                      {diagnoses.find(d => d.type === 'PRIMARY')?.code ?? diagnoses[0].code} 외 {Math.max(0, diagnoses.length - 1)}
                    </span>
                  ) : (
                    <span className="text-[10px] font-normal text-amber-600"><T k="미입력 — 처방에 근거 상병이 붙지 않습니다" /></span>
                  )}
                  <span className="ml-auto text-gray-400">▾</span>
                </summary>
                <div className="border-t border-gray-100 px-3 py-2.5">
                  <DiagnosisInput value={diagnoses} onChange={setDiagnoses} />
                </div>
              </details>

              {/* 처방 도우미 — 진단 기반 표준처방(CP)·진행 중 임상경로·사전처방 대기·약속처방(종전엔 약속처방이 유형 탭 맨 끝에만 있었고 나머지는 이 창에 없었다) */}
              {encounterId && selectedPatient && (
                <OrderAssistBar
                  patientId={selectedPatient.id}
                  encounterId={encounterId}
                  diagnosisCodes={diagnoses.map((d) => d.code)}
                  primaryCode={diagnoses.find((d) => d.type === 'PRIMARY')?.code ?? null}
                  today={kstToday()}
                  onOpenOrderSet={(id) => { setOrderSetPreviewId(id); setActiveTab('ORDERSET'); setSelectedCode(null); setCdssResult(null); setPresetSelection([]); codeSearch.reset(); }}
                  onPrescriptionsAdded={(items) => setPrescriptions((prev) => [...prev, ...items])}
                />
              )}

              {/* DUR 경고 — 통과했더라도 경고가 있으면 보여준다(통과 ≠ 안전) */}
              {durWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="mb-1 text-xs font-semibold text-amber-800">⚠️ DUR 안전 점검 ({durWarnings.length})</p>
                  <ul className="space-y-0.5">
                    {durWarnings.map((w, i) => (
                      <li key={i} className="text-[11px] text-amber-900">
                        {w.severity === 'ERROR' && <span className="mr-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white"><T k="차단" /></span>}
                        <span className="mr-1 font-medium">{w.type}</span>{w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tabs: Medication / Lab / Imaging / Therapy / OrderSet */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                {([
                  ...ORDER_TABS.map(t => ({ k: t.key as typeof activeTab, icon: t.icon, l: t.label })),
                  // 약속처방 적용(order-sets/:id/use)은 의사 전용 — 비의사는 항목마다 승인이 필요해 묶음 적용이 성립하지 않는다
                  ...(isPrescriberRole ? [{ k: 'ORDERSET' as const, icon: '📋', l: '약속처방' }] : []),
                ]).map(t => {
                  const mode = t.k === 'ORDERSET' ? null : modeOf(t.k);
                  const disabled = mode === 'NONE';
                  return (
                    <button key={t.k} data-order-tab={t.k} data-entry-mode={mode ?? undefined} disabled={disabled}
                      onClick={() => { setActiveTab(t.k); setSelectedCode(null); setCdssResult(null); setPresetSelection([]); codeSearch.reset(); }}
                      title={disabled ? tAttr('이 직종의 입력 범위에 없는 오더 유형입니다') : mode === 'DELEGATE' && !isPrescriberRole ? tAttr('의사 승인 필요') : mode === 'SELF' && !isPrescriberRole ? tAttr('본인 권한') : undefined}
                      className={`relative flex-1 whitespace-nowrap py-2 text-xs rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${activeTab === t.k ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}>
                      {t.icon} <T k={t.l} />
                      {/* 비의사에게만 — 의사는 전 유형 본인 권한이라 표식이 잡음이다 */}
                      {!isPrescriberRole && mode === 'SELF' && <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] font-bold text-emerald-700" aria-hidden>●</span>}
                      {!isPrescriberRole && mode === 'DELEGATE' && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700" aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>

              {!isPrescriberRole && entryModes && (
                <p className="-mt-1 flex flex-wrap gap-x-3 text-[10px] text-gray-500" data-entry-legend>
                  <span><span className="rounded bg-emerald-100 px-1 font-bold text-emerald-700">●</span> <T k="본인 권한 — 책임자 본인" /></span>
                  <span><span className="rounded bg-amber-100 px-1 font-bold text-amber-700">✓</span> <T k="의사 승인 필요 — 책임자 지정 의사" /></span>
                  <span className="text-gray-400"><T k="흐린 탭 = 입력 범위 밖" /></span>
                </p>
              )}
              {noEntryAtAll && (
                <div role="alert" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"><T k="이 직종은 오더를 입력하지 않습니다(입력 범위 없음)." /></div>
              )}

              {/* 코드 기반 유형(약·검사·영상·식이) — 차트와 같은 검색 부품 */}
              {isCodeBased(activeTab) && (
                <>
                  <div className="relative">
                    <p className="mb-1 text-xs font-medium text-gray-500"><T k={CODE_SEARCH_LABEL[activeTab] ?? '코드 검색'} /></p>
                    <input
                      value={codeSearch.query}
                      onFocus={() => { if (codeSearch.results.length === 0) void codeSearch.search(''); else codeSearch.setOpen(true); }}
                      onChange={e => {
                        codeSearch.setQuery(e.target.value);
                        setSelectedCode(null);
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        debounceRef.current = setTimeout(() => void codeSearch.search(e.target.value), 300);
                      }}
                      placeholder={tAttr(CODE_SEARCH_PLACEHOLDER[activeTab] ?? '코드 검색...')}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-200"
                    />
                    {codeSearch.open && (
                      <CodeSearchDropdown
                        activeTab={activeTab}
                        results={codeSearch.results}
                        query={codeSearch.query}
                        searching={codeSearch.searching}
                        failed={codeSearch.failed}
                        onSelect={(c) => {
                          const picked = c as unknown as CodeItem;
                          setSelectedCode(picked);
                          codeSearch.setQuery(`${c.code} - ${c.nameKo}`);
                          codeSearch.setOpen(false);
                          if (activeTab === 'MEDICATION') {
                            if (c.myDefaults?.dosage) {
                              setMedForm(f => ({ ...f, dosage: c.myDefaults!.dosage ?? f.dosage, frequency: c.myDefaults!.frequency ?? f.frequency, route: c.myDefaults!.route ?? f.route }));
                            }
                            void runCdssCheck(c.id);
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* 선택한 코드 + 투약 상세 */}
                  {selectedCode && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{selectedCode.nameKo} <span className="text-xs text-gray-400">{selectedCode.code}</span></span>
                        <button onClick={() => { setSelectedCode(null); codeSearch.reset(); setCdssResult(null); }} className="text-xs text-gray-400 hover:text-gray-600"><T k="변경" /></button>
                      </div>
                      {activeTab === 'MEDICATION' && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="용량" /></label>
                            <input value={medForm.dosage} onChange={e => setMedForm({ ...medForm, dosage: e.target.value })} placeholder="500mg" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="투여 경로" /></label>
                            <select value={medForm.route} onChange={e => setMedForm({ ...medForm, route: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                              {['경구', '정맥', '근육', '피하', '외용', '흡입'].map(r => <option key={r} value={r}>{tAttr(r)}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="빈도" /></label>
                            <select value={medForm.frequency} onChange={e => setMedForm({ ...medForm, frequency: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                              {['1일 1회', '1일 2회', '1일 3회', '1일 4회', '필요시'].map(f => <option key={f} value={f}>{tAttr(f)}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="총 수량" /></label>
                            <input type="number" value={medForm.quantity} onChange={e => setMedForm({ ...medForm, quantity: Number(e.target.value) })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                          </div>
                          <div className="col-span-2">
                            <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="일수" /></label>
                            <div className="flex gap-1">
                              {[3, 5, 7, 14, 30, 90].map(d => (
                                <button key={d} type="button" onClick={() => setMedForm({ ...medForm, duration: d, quantity: d * 3 })}
                                  className={`flex-1 rounded-lg border py-1.5 text-xs ${medForm.duration === d ? 'border-blue-400 bg-blue-50 font-semibold text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{d}<Unit><T k="일" /></Unit></button>
                              ))}
                            </div>
                          </div>
                          <div className="col-span-2">
                            <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="조제 유형" /></label>
                            <div className="flex gap-1">
                              {([{ v: 'INTERNAL' as const, l: '원내' }, { v: 'EXTERNAL' as const, l: '원외' }]).map(o => (
                                <button key={o.v} type="button" onClick={() => setDispensingType(o.v)}
                                  className={`flex-1 rounded-lg border py-1.5 text-xs ${dispensingType === o.v ? 'border-blue-400 bg-blue-50 font-semibold text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}><T k={o.l} /></button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="mt-2">
                        <label className="mb-1 block text-[10px] font-medium text-gray-600"><T k="긴급도" /></label>
                        <div className="flex gap-1">
                          {([{ v: 'ROUTINE', l: '일반' }, { v: 'URGENT', l: '긴급' }, { v: 'STAT', l: 'STAT' }]).map(p => (
                            <button key={p.v} type="button" onClick={() => setMedForm({ ...medForm, priority: p.v })}
                              className={`flex-1 rounded-lg border py-1.5 text-xs ${medForm.priority === p.v ? p.v === 'STAT' ? 'border-red-400 bg-red-50 font-semibold text-red-700' : 'border-blue-400 bg-blue-50 font-semibold text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}><T k={p.l} /></button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CDSS 검증 */}
                  {cdssFailed && !cdssLoading && !cdssResult && selectedCode && (
                    <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700" data-cdss-failed>
                      <T k="CDSS 점검을 하지 못했습니다 — 경고가 없다는 뜻이 아닙니다." />
                    </div>
                  )}
                  {(cdssResult || cdssLoading) && (
                    <div className={`rounded-xl px-3 py-2 text-xs ${
                      cdssLoading ? 'bg-gray-50 text-gray-500' :
                      cdssResult?.level === 'ERROR' ? 'bg-red-50 text-red-700' :
                      cdssResult?.level === 'WARNING' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      <div className="flex items-center gap-2 font-medium">
                        <span>CDSS <T k="검증" /> {cdssLoading ? tAttr('중...') : `(${cdssResult?.passedChecks}/${cdssResult?.totalChecks} ${tAttr('통과')})`}</span>
                        {!cdssLoading && cdssResult?.level === 'PASS' && <span><T k="✅ 안전" /></span>}
                        {!cdssLoading && cdssResult?.level === 'WARNING' && <span><T k="⚠️ 주의" /></span>}
                        {!cdssLoading && cdssResult?.level === 'ERROR' && <span><T k="🚫 위험" /></span>}
                      </div>
                    </div>
                  )}

                  <button onClick={addPrescription} disabled={!selectedCode || loading}
                    className={`w-full rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-colors ${
                      cdssResult?.level === 'ERROR' ? 'bg-red-600 hover:bg-red-700' :
                      cdssResult?.level === 'WARNING' ? 'bg-amber-600 hover:bg-amber-700' :
                      'bg-blue-600 hover:bg-blue-700'
                    } disabled:opacity-40`}>
                    <T k={cdssResult?.level === 'ERROR' ? '⚠ 경고 확인 후 처방 추가' : cdssResult?.level === 'WARNING' ? '⚠ 주의하여 처방 추가' : '+ 처방 추가'} />
                  </button>
                </>
              )}

              {/* 치료 — 반복 스케줄·스테이션 배정이 있는 전용 패널(차트 프리셋보다 상세하므로 유지) */}
              {activeTab === 'THERAPY' && encounterId && selectedPatient && (
                <TherapyOrderPanel
                  encounterId={encounterId}
                  patientId={selectedPatient.id}
                  onAdd={(item) => { setPrescriptions(prev => [...prev, item]); }}
                  authorize={delegate.authorize}
                  authError={() => delegate.error}
                />
              )}

              {/* 프리셋 기반 유형(활동·간호지시) — 다중 선택 후 각각 개별 처방으로 등록 */}
              {isPresetBased(activeTab) && activeTab !== 'THERAPY' && (
                <>
                  <p className="text-xs font-medium text-gray-500">
                    <T k={activeTab === 'ACTIVITY' ? '활동 제한 선택' : '간호 지시 선택'} />
                    <span className="ml-1.5 font-normal text-gray-400"><T k="여러 개 선택 가능 · 각각 개별 처방으로 등록" /></span>
                  </p>
                  {/* 🔴 NIC 정본 조회 상태를 화면이 밝힌다 — 폴백을 정본인 척 보여주지 않는다 */}
                  {activeTab === 'NURSING' && nicIsLoading && (
                    <p className="py-3 text-center text-xs text-gray-400"><T k="NIC 표준 코드 불러오는 중…" /></p>
                  )}
                  {activeTab === 'NURSING' && nicUsingFallback && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-amber-800">
                        <T k={nicIsError ? 'NIC 표준 코드를 불러오지 못했습니다' : 'NIC 표준 코드가 등재되어 있지 않습니다'} />
                      </p>
                      <p className="mt-0.5 text-[11px] text-amber-700">
                        <T k="아래 간호 지시 목록은" /> <strong><T k="표준 정본(NIC)이 아니라 내장 폴백" /></strong><T k="입니다 — 코드는" /> <code>NRS_*</code> <T k="로 기록됩니다." />
                      </p>
                      {nicIsError && (
                        <QueryErrorFallback error={nicError} onRetry={() => refetchNic()} size="compact" className="mt-2" />
                      )}
                    </div>
                  )}
                  <div className="max-h-[300px] overflow-y-auto pr-1">
                    <PresetPicker
                      items={presetsFor(activeTab, nicList)}
                      selected={presetSelection}
                      onToggle={(t) => setPresetSelection(prev => prev.some(p => p.code === t.code) ? prev.filter(p => p.code !== t.code) : [...prev, t])}
                    />
                  </div>
                  {presetSelection.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2">
                      <span className="shrink-0 text-xs font-semibold text-blue-700">{presetSelection.length}<Unit><T k="건" /></Unit> <T k="선택" /></span>
                      {presetSelection.map(p => (
                        <span key={p.code} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-blue-700">{p.name}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={addPresetPrescriptions} disabled={presetSelection.length === 0 || loading}
                    className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40">
                    {loading ? tAttr('처리 중…') : `+ ${presetSelection.length || ''}${tAttr('건 처방 추가')}`}
                  </button>
                </>
              )}

              {/* OrderSet Tab */}
              {activeTab === 'ORDERSET' && encounterId && selectedPatient && (
                <OrderSetPanel
                  key={orderSetPreviewId ?? 'none'}
                  encounterId={encounterId}
                  patientId={selectedPatient.id}
                  userDepartment={user?.department}
                  initialPreviewId={orderSetPreviewId}
                  diagnosisCodeId={diagnoses.find(d => d.type === 'PRIMARY')?.diagnosisCodeId}
                  onApply={(items) => {
                    setPrescriptions(prev => [...prev, ...items]);
                  }}
                />
              )}

              {/* Added prescriptions */}
              {prescriptions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2"><T k="추가된 처방" /> ({prescriptions.length}<Unit><T k="건" /></Unit>)</p>
                  <div className="space-y-1">
                    {prescriptions.map((rx, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${rx.type === 'MEDICATION' ? 'bg-blue-100 text-blue-700' : rx.type === 'LAB' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
                          <T k={TYPE_LABEL[rx.type] ?? rx.type} />
                        </span>
                        {rx.priority === 'STAT' && <span className="text-[9px] bg-red-600 text-white px-1 rounded">STAT</span>}
                        {rx.dispensingType === 'EXTERNAL' && <span className="text-[9px] bg-violet-100 text-violet-700 px-1 rounded whitespace-nowrap"><T k="원외" /></span>}
                        <span className="font-medium text-gray-900">{rx.name}</span>
                        {rx.dosage && <span className="text-xs text-gray-400">{rx.dosage} {rx.frequency}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 사전승인 상신 중(R3) — 승인 전이므로 처방 목록과 분리해 그린다(상신≠발행) */}
              {canPreAuth && myPendingPreAuths.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-600 mb-2"><T k="사전승인 상신 중" /> ({myPendingPreAuths.length}<Unit><T k="건" /></Unit><T k=") — 승인되면 발행됩니다" /></p>
                  <div className="space-y-1">
                    {myPendingPreAuths.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm">
                        <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          <T k={PRE_AUTH_TYPE_LABEL[p.type] ?? p.type} />
                        </span>
                        <span className="text-xs text-gray-600">{kdate(p.createdAt, 'datetimeSec')}</span>
                        {p.encounterId === encounterId && <span className="text-[10px] text-amber-700"><T k="이 진료" /></span>}
                        <button
                          type="button"
                          onClick={() => cancelPreAuth(p.id)}
                          className="ml-auto min-h-[44px] px-2 text-xs text-gray-500 hover:text-red-600"
                        >
                          <T k="상신 취소" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {step === 'prescribe' && (
          <div className="border-t border-gray-200 px-6 py-4 flex justify-between items-center flex-shrink-0">
            <p className="text-xs text-gray-400">처방 {prescriptions.length}<Unit><T k="건" /></Unit></p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="닫기" /></button>
              {/* 서명·수납은 진료를 연 의사의 일 — 비의사는 붙인 진료를 서명하지 않는다(오더는 저장될 때마다 이미 등록됨) */}
              {isPrescriberRole ? (
                <button onClick={finish} disabled={prescriptions.length === 0 || loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
                  <T k="서명 완료 + 수납" />
                </button>
              ) : (
                <button onClick={() => { queryClient.invalidateQueries({ queryKey: ['my-orders'] }); onClose(); }} disabled={prescriptions.length === 0}
                  data-finish-nonprescriber
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
                  <T k="입력 완료" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* DUR 차단 — 사유를 받아 강제 처방(차트와 동일 흐름). 사유는 약국·심사가 추적한다 */}
      {durBlock && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={e => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h4 className="text-base font-bold text-gray-900"><T k="DUR 경고로 차단됨" /></h4>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">
              {durBlock.codeName} · 아래 경고에도 처방하려면 사유를 입력하세요(약국·심사 추적).
            </p>
            <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-red-50 p-2.5">
              {durBlock.warnings.map((w, i) => (
                <li key={i} className="text-[11px] text-red-800">
                  <span className="mr-1 font-semibold">{w.type}</span>{w.message}
                </li>
              ))}
            </ul>
            <input
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder={tAttr('예: 임상적 필요·기존 병용 유지·대체 불가')}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => { setDurBlock(null); setOverrideReason(''); }}
                className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200"><T k="취소" /></button>
              <button onClick={forcePrescribe} disabled={loading || !overrideReason.trim()}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                <T k={loading ? '처리 중…' : '경고 무시하고 강제 처방'} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사전승인 게이트 차단(R3) — 상신 동선. 🔴 상신 성공 ≠ 발행(승인 시 서버가 발행) */}
      {preAuthBlock && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={e => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h4 className="text-base font-bold text-gray-900"><T k="사전승인이 필요한 처방입니다" /></h4>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">{preAuthBlock.codeName} · {preAuthBlock.message}</p>
            {!canPreAuth && (
              <p className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                <T k="상신은 의사 권한에서만 가능합니다 — 책임 처방의에게 상신을 요청하세요." />
              </p>
            )}
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="승인 책임의" /></label>
            <select
              value={preAuthApproverId}
              onChange={e => setPreAuthApproverId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
            >
              <option value=""><T k="미지정 — 처방의의 관리자(과장)로 자동 지정" /></option>
              {(preAuthDoctorsData?.data ?? []).map(d => (
                <option key={d.id} value={d.id}>{d.familyName}{d.givenName}</option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-gray-400">
              <T k="상신이 승인되면 이 처방 내용 그대로 발행됩니다." /> <b><T k="상신 즉시 발행되는 것이 아닙니다." /></b>
              <T k="본인·처방의 본인은 승인할 수 없습니다(직무분리)." />
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setPreAuthBlock(null)}
                className="min-h-[44px] flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200"><T k="닫기" /></button>
              <button onClick={submitPreAuth} disabled={preAuthSubmitting || !canPreAuth}
                className="min-h-[44px] flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                <T k={preAuthSubmitting ? '상신 중…' : '사전승인 상신'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OrderSet Panel (inside modal)
   ═══════════════════════════════════════════════════════════════ */

function OrderSetPanel({
  encounterId, patientId, userDepartment, onApply, initialPreviewId, diagnosisCodeId,
}: {
  encounterId: string;
  patientId: string;
  userDepartment?: string;
  onApply: (items: Array<{ type: string; name: string; code: string }>) => void;
  /** 처방 도우미(진단 기반 추천)에서 고른 세트 — 열자마자 미리보기 */
  initialPreviewId?: string;
  /** 주상병 — 단건 처방과 같게 세트 항목에도 근거 상병을 붙인다(종전엔 세트 적용분만 상병이 비었다) */
  diagnosisCodeId?: string;
}) {
  const tAttr = useTAttr();
  const [search, setSearch] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(initialPreviewId ?? null);
  const [applying, setApplying] = useState(false);

  // Favorites
  const { data: favData, isError: favIsError, error: favError, refetch: refetchFav } = useQuery({
    queryKey: ['favorite-orders'],
    queryFn: () => apiClient.get<{ data: OrderSetItem[] }>('/api/v1/favorite-orders'),
  });
  const favorites = (favData?.data ?? []) as OrderSetItem[];
  /**
   * 🔴 2026-09-16 J2(실로그인 프로브): `GET /api/v1/favorite-orders` 는 `@Roles(DOCTOR)` 인데
   *    nav 는 처방(CPOE) 화면을 임상 역할 전체에 연다 — 간호사는 **자기가 가질 수 없는 기능**에
   *    상시 실패 배너를 봤다. 권한 없음은 조용히 숨기고(식대 정산 선례), 그 외 실패는 실패라고 말한다.
   */
  const favDenied = favError instanceof ApiError && (favError.code === 'FORBIDDEN' || favError.code === 'UNAUTHORIZED');

  // Department sets
  const { data: deptData, isError: deptIsError, error: deptError, refetch: refetchDept } = useQuery({
    queryKey: ['order-sets-dept', userDepartment],
    queryFn: () => apiClient.get<{ data: OrderSetItem[] }>('/api/v1/order-sets', { department: userDepartment, status: 'ACTIVE' }),
    enabled: !!userDepartment,
  });
  const deptSets = (deptData?.data ?? []) as OrderSetItem[];

  // Search
  const { data: searchData, isError: searchIsError, error: searchError, refetch: refetchSearch } = useQuery({
    queryKey: ['order-sets-search', search],
    queryFn: () => apiClient.get<{ data: OrderSetItem[] }>('/api/v1/order-sets/search', { q: search }),
    enabled: search.length >= 2,
  });
  const searchResults = search.length >= 2 ? (searchData?.data ?? []) as OrderSetItem[] : [];

  // Preview
  const { data: previewData, isError: previewIsError, error: previewError, refetch: refetchPreview } = useQuery({
    queryKey: ['order-set-detail', previewId],
    queryFn: () => apiClient.get<{ data: OrderSetItem }>(`/api/v1/order-sets/${previewId}`),
    enabled: !!previewId,
  });
  const previewSet = previewData?.data as OrderSetItem | null;

  // Apply set
  const applySet = async (os: OrderSetItem) => {
    const items = Array.isArray(os.items) ? os.items as Array<{ type?: string; name?: string; code?: string; medicationCodeId?: string; procedureCodeId?: string; dosage?: string; frequency?: string; duration?: number; quantity?: number; route?: string }> : [];
    if (items.length === 0) { toast.error(tAttr('세트에 항목이 없습니다.')); return; }

    setApplying(true);
    const added: Array<{ type: string; name: string; code: string }> = [];
    const failed: Array<{ name: string; why: string }> = [];

    for (const item of items) {
      try {
        const payload: Record<string, unknown> = {
          type: item.type ?? 'MEDICATION',
          priority: 'ROUTINE',
          ...(diagnosisCodeId ? { diagnosisCodeId } : {}),
          ...(item.medicationCodeId ? { medicationCodeId: item.medicationCodeId, dosage: item.dosage, frequency: item.frequency, duration: item.duration, quantity: item.quantity, route: item.route } : {}),
          ...(item.procedureCodeId ? { procedureCodeId: item.procedureCodeId } : {}),
        };
        await apiClient.post(`/api/v1/encounters/${encounterId}/prescriptions`, payload);
        added.push({ type: item.type ?? 'MEDICATION', name: item.name ?? '처방', code: item.code ?? '' });
      } catch (e) {
        /**
         * 🔴 종전엔 실패를 건너뛰기만 했다 — DUR 차단·사전승인·입력 범위로 막힌 항목이 **말없이 빠졌고**
         *    토스트는 "적용 (n건)"만 말했다. 의사는 세트 전체가 들어간 줄 안다. 빠진 항목과 이유를 말한다
         *    (막힌 항목은 단건 입력으로 사유·상신 동선을 탄다).
         */
        failed.push({ name: item.name ?? tAttr('처방'), why: extractErrorMessage(e) || tAttr('저장 실패') });
      }
    }
    if (failed.length) {
      toast.error(`${tAttr('세트 중 들어가지 않은 항목')} ${failed.length}${tAttr('건')}: ${failed.map((f) => `${f.name}(${f.why})`).join(', ')} — ${tAttr('단건으로 다시 입력하세요')}`);
    }

    if (added.length > 0) {
      onApply(added);
      toast.success(`${tAttr('약속처방')} ${os.name} ${tAttr('적용')} (${added.length}${tAttr('건')})`);
      // Record usage
      try {
        await apiClient.post(`/api/v1/order-sets/${os.id}/use`, { encounterId, patientId, itemsApplied: added.length, itemsModified: 0 });
      } catch {}
    }
    setApplying(false);
    setPreviewId(null);
  };

  const renderSetRow = (os: OrderSetItem) => {
    const itemCount = Array.isArray(os.items) ? os.items.length : 0;
    return (
      <div key={os.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-blue-50/50 rounded-lg transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{os.name}</p>
          <p className="text-[10px] text-gray-400">{os.code ?? ''} · {itemCount}<Unit><T k="건" /></Unit> {os.department ? `· ${os.department}` : ''}</p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0 ml-2">
          <button onClick={() => setPreviewId(os.id)} className="px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-[10px] font-medium hover:bg-gray-100"><T k="미리보기" /></button>
          <button onClick={() => applySet(os)} disabled={applying} className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-medium hover:bg-blue-700 disabled:opacity-40"><T k="적용" /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder={tAttr('약속처방 세트 검색...')} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm" />

      {/* Search results */}
      {search.length >= 2 && searchIsError && (
        <QueryErrorFallback error={searchError} onRetry={() => refetchSearch()} size="compact" />
      )}
      {searchResults.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1 px-1">검색 결과 ({searchResults.length})</p>
          <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">{searchResults.map(renderSetRow)}</div>
        </div>
      )}

      {/* Favorites */}
      {favIsError && !favDenied && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1 px-1"><T k="⭐ 내 즐겨찾기" /></p>
          <QueryErrorFallback error={favError} onRetry={() => refetchFav()} size="compact" />
        </div>
      )}
      {favorites.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1 px-1"><T k="⭐ 내 즐겨찾기" /></p>
          <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">{favorites.map(renderSetRow)}</div>
        </div>
      )}

      {/* Department sets */}
      {deptIsError && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1 px-1">🏥 과 공통 세트{userDepartment ? ` (${userDepartment})` : ''}</p>
          <QueryErrorFallback error={deptError} onRetry={() => refetchDept()} size="compact" />
        </div>
      )}
      {deptSets.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1 px-1">🏥 과 공통 세트{userDepartment ? ` (${userDepartment})` : ''}</p>
          <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">{deptSets.map(renderSetRow)}</div>
        </div>
      )}

      {/* 🔴 조회 실패는 위에서 이미 밝혔다 — "등록된 약속처방이 없습니다"로 덮지 않는다 */}
      {/* 즐겨찾기 권한이 없는 역할(favDenied)은 그 섹션이 없는 것이지 조회가 실패한 것이 아니다 — 빈 상태를 막지 않는다 */}
      {(!favIsError || favDenied) && !deptIsError && !searchIsError && favorites.length === 0 && deptSets.length === 0 && searchResults.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-400"><T k="등록된 약속처방이 없습니다." /></p>
          <p className="text-xs text-gray-300 mt-1"><T k="나의 약속처방 페이지에서 세트를 만들어보세요." /></p>
        </div>
      )}

      {/* Preview modal */}
      {previewId && previewIsError && (
        <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-4">
          <QueryErrorFallback error={previewError} onRetry={() => refetchPreview()} size="compact" />
        </div>
      )}
      {previewId && previewSet && (
        <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-gray-900">{previewSet.name}</p>
            <button onClick={() => setPreviewId(null)} className="text-xs text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
          </div>
          <div className="space-y-1.5">
            {Array.isArray(previewSet.items) && (previewSet.items as Array<{ type?: string; name?: string; dosage?: string; frequency?: string }>).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span>{TYPE_ICON[item.type ?? 'MEDICATION'] ?? '📋'}</span>
                <span className="text-gray-900">{item.name ?? tAttr('항목')}</span>
                {item.dosage && <span className="text-gray-400">{item.dosage} {item.frequency ?? ''}</span>}
              </div>
            ))}
          </div>
          <button onClick={() => applySet(previewSet)} disabled={applying} className="mt-3 w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
            {applying ? tAttr('적용 중...') : `${tAttr('전체 적용')} (${Array.isArray(previewSet.items) ? previewSet.items.length : 0}${tAttr('건')})`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Shared UI
   ═══════════════════════════════════════════════════════════════ */

function StepBadge({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'text-blue-700' : done ? 'text-emerald-600' : 'text-gray-400'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
        active ? 'border-blue-500 bg-blue-500 text-white' : done ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-400'
      }`}>{done ? '✓' : num}</div>
      <span className="text-xs font-medium"><T k={label} /></span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-6 w-14 bg-gray-100 rounded-full animate-pulse" />
          <div className="h-4 w-12 bg-gray-50 rounded animate-pulse" />
          <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-50 rounded animate-pulse flex-1" />
          <div className="h-4 w-16 bg-gray-50 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Therapy Order Panel (inside QuickOrderModal)
   ═══════════════════════════════════════════════════════════════ */

const THERAPY_TYPES = [
  { id: '운동치료', label: '운동치료', icon: '🏋️' },
  { id: '도수치료', label: '도수치료', icon: '🤲' },
  { id: '열전기치료', label: '열전기치료', icon: '⚡' },
  { id: '작업치료', label: '작업치료', icon: '🖐️' },
  { id: '언어치료', label: '언어치료', icon: '🗣️' },
  { id: '호흡재활', label: '호흡재활', icon: '🫁' },
  { id: '수치료', label: '수치료', icon: '💧' },
  { id: '투석', label: '투석', icon: '🩸' },
  { id: '항암치료', label: '항암치료', icon: '💉' },
  { id: '방사선치료', label: '방사선치료', icon: '☢️' },
];

const RECUR_PATTERNS = [
  { id: '', label: '단일 (반복 없음)' },
  { id: 'DAILY', label: '매일' },
  { id: 'MWF', label: '월·수·금' },
  { id: 'TTS', label: '화·목·토' },
  { id: 'WEEKLY', label: '매주 1회' },
];

function TherapyOrderPanel({
  encounterId, patientId, onAdd, authorize, authError,
}: {
  encounterId: string;
  patientId: string;
  onAdd: (item: { type: string; name: string; code: string }) => void;
  /**
   * 🔴 (2026-09-29) 종전 치료 패널은 **승인 흐름 없이** 저장했다 — 비의사는 서버가 책임 처방의를 요구해 항상 실패했고
   *    2단계(치료 일정)도 의사 전용이라, 의사 말고는 치료 오더를 만들 길이 없었다. 다른 탭과 같은 authorize 를 지난다.
   */
  authorize: ReturnType<typeof usePrescriberDelegate>['authorize'];
  authError: () => string | null;
}) {
  const tAttr = useTAttr();
  const [therapyType, setTherapyType] = useState('');
  const [scheduledDate, setScheduledDate] = useState(() => kstToday());
  const [scheduledTime, setScheduledTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [recurPattern, setRecurPattern] = useState('');
  const [recurEndDate, setRecurEndDate] = useState('');
  const [totalSessions, setTotalSessions] = useState(10);
  const [stationId, setStationId] = useState('');
  const [loading, setLoading] = useState(false);

  const queryClient = useQueryClient();

  const submit = async () => {
    if (!therapyType || !scheduledDate) { toast.error(tAttr('치료 유형과 시작일을 선택하세요.')); return; }
    setLoading(true);
    try {
      // 1. 치료 처방 생성
      // 🔴 두 가지가 함께 틀려 있었다.
      //    ① `type: 'PROCEDURE'` — `PrescriptionType` 에 **없는 값**이다(MEDICATION·LAB·IMAGING·
      //       THERAPY·DIET·ACTIVITY·NURSING). @IsEnum 이 거부해 요청이 400 이었다.
      //       치료의 정본 값은 `THERAPY` 다 — 그래야 오더가 THERAPY 부서로 라우팅된다
      //       (`TYPE_TO_DEPARTMENT`). PROCEDURE 였다면 부서 매핑도 PHARMACY 로 떨어졌을 것이다.
      //    ② `notes` 는 DTO 에 없는 키라 whitelist 가 지우고 서비스도 읽지 않는다 —
      //       치료 유형·반복·횟수가 원장에 한 줄도 남지 않는다. 지시문 정본은 `instructions`.
      // 직종별 입력 범위 — 의사는 그대로, 간호사·치료사는 지정 의사 승인(서버도 없으면 거부)
      const auth = await authorize({ type: 'THERAPY' });
      if (!auth) { toast.error(authError() || tAttr('지정 처방의 승인을 받지 못했습니다.')); setLoading(false); return; }
      const rxRes = await apiClient.post<{ data: { id: string; orderId?: string } }>(`/api/v1/encounters/${encounterId}/prescriptions`, {
        type: 'THERAPY',
        priority: 'ROUTINE',
        instructions: `${therapyType} ${recurPattern ? `(${recurPattern}, ${totalSessions}회)` : '(단일)'}`,
        ...auth.fields,
      }, auth.headers);
      const orderId = rxRes.data?.orderId || (rxRes.data as Record<string, unknown>)?.data && ((rxRes.data as Record<string, unknown>).data as Record<string, unknown>)?.orderId;

      if (!orderId) {
        toast.error(tAttr('오더 생성 실패 — 처방에 오더 ID가 없습니다.'));
        setLoading(false);
        return;
      }

      // 2. Create therapy order
      await apiClient.post('/api/v1/therapy-orders', {
        orderId,
        therapyType,
        scheduledDate,
        scheduledTime: scheduledTime || undefined,
        duration,
        stationId: stationId || undefined,
        isRecurring: !!recurPattern,
        recurPattern: recurPattern || undefined,
        recurEndDate: recurEndDate || undefined,
        totalSessions: recurPattern ? totalSessions : undefined,
      });

      onAdd({ type: 'THERAPY', name: therapyType, code: recurPattern ? `${recurPattern}×${totalSessions}` : '단일' });
      toast.success(`${tAttr(therapyType)} ${tAttr('치료 오더 생성 완료')}`);
      queryClient.invalidateQueries({ queryKey: ['therapy-orders'] });

      // Reset
      setTherapyType('');
      setRecurPattern('');
    } catch (err: unknown) {
      toast.error((err as MutationError)?.message || tAttr('치료 오더 생성 실패'));
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* Therapy Type Selection */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2"><T k="치료 유형" /></label>
        <div className="grid grid-cols-5 gap-1.5">
          {THERAPY_TYPES.map(t => (
            <button key={t.id} type="button" onClick={() => setTherapyType(t.id)}
              className={`flex flex-col items-center py-2 px-1 rounded-lg border text-xs transition-colors ${
                therapyType === t.id ? 'border-blue-400 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <span className="text-base mb-0.5">{t.icon}</span>
              <span className="text-[10px] leading-tight text-center"><T k={t.label} /></span>
            </button>
          ))}
        </div>
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-medium text-gray-600 mb-1"><T k="시작일" /></label>
          <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-600 mb-1"><T k="시작 시간" /></label>
          <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-600 mb-1"><T k="소요 시간 (분)" /></label>
          <div className="flex gap-1">
            {[15, 30, 45, 60].map(d => (
              <button key={d} type="button" onClick={() => setDuration(d)}
                className={`flex-1 py-2 text-xs rounded-lg border ${duration === d ? 'border-blue-400 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{d}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Recurrence */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2"><T k="반복 패턴" /></label>
        <div className="flex gap-1.5">
          {RECUR_PATTERNS.map(p => (
            <button key={p.id} type="button" onClick={() => setRecurPattern(p.id)}
              className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                recurPattern === p.id ? 'border-violet-400 bg-violet-50 text-violet-700 font-semibold' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}><T k={p.label} /></button>
          ))}
        </div>
      </div>

      {/* Recurrence details */}
      {recurPattern && (
        <div className="grid grid-cols-2 gap-3 bg-violet-50/50 border border-violet-100 rounded-xl p-3">
          <div>
            <label className="block text-[10px] font-medium text-violet-600 mb-1"><T k="총 회차" /></label>
            <div className="flex gap-1">
              {[5, 10, 15, 20, 30].map(n => (
                <button key={n} type="button" onClick={() => setTotalSessions(n)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border ${totalSessions === n ? 'border-violet-400 bg-violet-100 text-violet-700 font-semibold' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{n}<Unit><T k="회" /></Unit></button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-violet-600 mb-1"><T k="종료일 (선택)" /></label>
            <input type="date" value={recurEndDate} onChange={e => setRecurEndDate(e.target.value)}
              min={scheduledDate}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
      )}

      {/* Station */}
      <div>
        <label className="block text-[10px] font-medium text-gray-600 mb-1"><T k="치료실 (선택)" /></label>
        <select value={stationId} onChange={e => setStationId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value=""><T k="자동 배정" /></option>
          <option value="rehab"><T k="물리치료실" /></option>
          <option value="ot"><T k="작업치료실" /></option>
          <option value="st"><T k="언어치료실" /></option>
          <option value="dialysis"><T k="투석실" /></option>
          <option value="chemo"><T k="항암치료실" /></option>
          <option value="radiation"><T k="방사선치료실" /></option>
        </select>
      </div>

      {/* Summary & Submit */}
      {therapyType && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <p className="text-xs text-emerald-700">
            <span className="font-semibold">{therapyType}</span>
            {' · '}{duration}분
            {recurPattern ? <> · <T k={RECUR_PATTERNS.find(p => p.id === recurPattern)?.label ?? ''} /> × {totalSessions}<T k="회" /></> : <> · <T k="단일 시행" /></>}
            {' · '}{scheduledDate}
          </p>
        </div>
      )}

      <button onClick={submit} disabled={!therapyType || loading}
        className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-40 transition-colors">
        <T k={loading ? '생성 중...' : '+ 치료 오더 추가'} />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DUR Warning Panel with Override
   ═══════════════════════════════════════════════════════════════ */

const DUR_OVERRIDE_REASONS = [
  '임상적으로 불가피',
  '이미 모니터링 중',
  '단기간 사용 예정',
  '환자 동의 하에 투약',
  '대체 약물 없음',
  '기타',
];

function DurWarningPanel({ durWarnings, rx }: {
  durWarnings: Array<{ type?: string; message?: string; severity?: string }>;
  order?: OrderItem;
  rx: OrderItem['prescription'];
}) {
  const tAttr = useTAttr();
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [overriding, setOverriding] = useState(false);
  const queryClient = useQueryClient();

  const handleOverride = async () => {
    if (!overrideReason) { toast.error(tAttr('무시 사유를 선택하세요.')); return; }
    setOverriding(true);
    try {
      await apiClient.patch(`/api/v1/prescriptions/${rx?.id}/dur-override`, {
        reason: overrideReason,
        note: overrideNote,
      });
      toast.success(tAttr('DUR 경고 무시 처리 완료'));
      setShowOverride(false);
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-queue'] });
    } catch {
      toast.error(tAttr('DUR 무시 처리 실패'));
    }
    setOverriding(false);
  };

  return (
    <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-3">
      <p className="text-xs font-semibold text-amber-700 mb-1.5">
        ⚠️ DUR/CDSS 경고 ({durWarnings.length}건)
        {rx?.durOverridden && <span className="text-red-600 ml-1">— 무시됨 ({(rx as Record<string, unknown>).durOverrideReason as string ?? ''})</span>}
      </p>
      <div className="space-y-1">
        {durWarnings.map((w, i) => (
          <p key={i} className="text-xs text-amber-800">{w.severity === 'ERROR' ? '🚫' : '⚠️'} {w.message ?? w.type}</p>
        ))}
      </div>

      {!rx?.durOverridden && (
        <>
          {!showOverride ? (
            <button onClick={() => setShowOverride(true)}
              className="mt-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-[10px] font-semibold hover:bg-red-200">
              <T k="경고 무시하고 진행" />
            </button>
          ) : (
            <div className="mt-2 bg-white border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-[10px] font-bold text-red-700"><T k="DUR 경고 무시 사유" /></p>
              <div className="flex flex-wrap gap-1">
                {DUR_OVERRIDE_REASONS.map(r => (
                  <button key={r} onClick={() => setOverrideReason(r)}
                    className={`px-2 py-1 rounded-lg text-[10px] border ${overrideReason === r ? 'border-red-400 bg-red-50 text-red-700 font-bold' : 'border-gray-200 text-gray-500'}`}><T k={r} /></button>
                ))}
              </div>
              {overrideReason === '기타' && (
                <input value={overrideNote} onChange={e => setOverrideNote(e.target.value)}
                  placeholder={tAttr('구체적 사유 입력...')}
                  className="w-full px-3 py-1.5 border rounded-lg text-xs" />
              )}
              <div className="flex gap-1.5">
                <button onClick={() => setShowOverride(false)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-[10px] text-gray-600"><T k="취소" /></button>
                <button onClick={handleOverride} disabled={overriding || !overrideReason}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold disabled:opacity-40">
                  <T k={overriding ? '처리 중...' : '무시 확인'} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
