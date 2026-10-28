'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LAYER_TITLE_SHORT } from '../decisions/types';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import {
  CHOSEN_MODIFIED, CHOSEN_NONE_OF_ABOVE, CHOSEN_SPECIAL_LABEL, isSpecialChoice,
  BASIS_KINDS, BASIS_KIND_LABEL, BASIS_KIND_HINT,
  type DecisionOptionShape, type BasisKind, type DecisionBasis,
  RATIO_UNAVAILABLE, AGENDA_STATUS_LABEL,
} from '@hospital-run/shared';
import { KDate, EmptyState, Unit } from '@/components/ui/display';
import { ProposeAgendaModal } from '@/components/governance/ProposeAgendaModal';
import { sanitizeHtml } from '@/lib/sanitize';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 위원회 거버넌스 관제(P0-b FE) — 기획: committee-governance-engine.plan.md
 * 이 단계는 **기록 대장**: 안건 접수→회의 배정→의결(GOV-번호)→MANUAL 이행 추적.
 * 자동 집행(config/게이트)은 P1 엔진에서 — 여기 버튼은 시스템 값을 바꾸지 않는다.
 */

interface CommitteeCard {
  id: string; code: string; name: string; quorum: number; meetingCycle?: string | null;
  _count: { agendas: number; govDecisions: number };
}
interface AgendaAssessment {
  scope?: string; currentState?: string | null; risks?: string[]; checklist?: string[];
  bindingSuggestion?: unknown; disclaimer?: string; model?: string; assessedAt?: string; parseFallback?: boolean;
}
interface AgendaRow {
  id: string; committeeId?: string; title: string; status: string; createdAt: string; meetingId?: string | null;
  body?: string | null; proposerName?: string | null;
  committee?: { code?: string; name?: string };
  decision?: { decisionNo: string; status: string } | null;
  sourceRef?: { type?: string; key?: string } | null;
  aiAssessment?: AgendaAssessment | null; aiAssessedAt?: string | null;
  /** 의결 선택지 — 있으면 산문만으로 의결할 수 없다(서버가 거부한다) */
  options?: DecisionOptionShape[] | null;
}

/** 결정 경로 인스턴스(P2) — 서버 `InstanceView` 와 같은 모양 */
interface LayerSummary {
  layers: { layer: string; total: number; active: number; blocked: number; done: number;
            stayDaysMax: number | null; stayDaysMedian: number | null }[];
  slaNote: string;
  truncated: boolean;
  limit: number;
}

interface PathwayInstance {
  id: string;
  pathway: { code: string; name: string; version: number; layer: string };
  source: { kind: 'AGENDA'; agendaId: string } | { kind: 'REGISTRY'; registryKey: string };
  status: 'ACTIVE' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  currentStepKey: string | null;
  /** null = 담당을 모른다(빈 배열로 "아무도 아니다"라 말하지 않는다) */
  currentOwnerRoles: string[] | null;
  blockedReason: string | null;
  /** 🔴 현재 단계 **체류일** — 사실이다. "지연"이라 부르지 않는다(기준이 없다) */
  currentStepDays: number | null;
  steps: { key: string; title: string; ownerRoles: string[]; gate: boolean; gateRule: string | null; slaDays: number | null; status: string; blockedReason: string | null }[];
  progress: { done: number; total: number };
}

/** sourceRef 역딥링크(워크벤치 D8) — type 별 고정 매핑 */
const SOURCE_LINKS: Record<string, { href: string; label: string }> = {
  SAFETY_GATE: { href: '/admin/safety-gates', label: '안전 게이트 관제' },
  GO_LIVE: { href: '/admin/go-live', label: 'Go-Live 관제' },
  DATA_QUALITY: { href: '/admin/data-quality', label: '데이터 품질 관제' },
  FORMULARY_REQUEST: { href: '/admin/formulary', label: '포뮬러리 요청 심의' },
};
interface DecisionRow {
  id: string; decisionNo: string; resolution: string; status: string; resolvedAt: string;
  voteFor?: number | null; voteAgainst?: number | null; voteAbstain?: number | null;
  reviewDue?: string | null; signRef?: string | null;
  committee?: { code?: string; name?: string };
  agenda?: { title?: string };
  actions: { id: string; kind: string; status: string; manualNote?: string | null; target?: { description?: string } }[];
}

// 라벨은 shared 정본(AGENDA_STATUS_LABEL) — 기능 화면에서 올린 안건 표시와 같은 말 · 색만 여기
const AGENDA_STATUS: Record<string, { label: string; tone: string }> = {
  SUBMITTED: { label: AGENDA_STATUS_LABEL.SUBMITTED, tone: 'bg-amber-50 text-amber-700' },
  SCHEDULED: { label: AGENDA_STATUS_LABEL.SCHEDULED, tone: 'bg-blue-50 text-blue-700' },
  RESOLVED: { label: AGENDA_STATUS_LABEL.RESOLVED, tone: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { label: AGENDA_STATUS_LABEL.REJECTED, tone: 'bg-rose-50 text-rose-600' },
  DEFERRED: { label: AGENDA_STATUS_LABEL.DEFERRED, tone: 'bg-gray-100 text-gray-600' },
  WITHDRAWN: { label: AGENDA_STATUS_LABEL.WITHDRAWN, tone: 'bg-gray-100 text-gray-500' },
};
const DECISION_STATUS: Record<string, { label: string; tone: string }> = {
  RESOLVED: { label: '의결됨', tone: 'bg-blue-50 text-blue-700' },
  ENACTED: { label: '이행 완료', tone: 'bg-emerald-50 text-emerald-700' },
  PARTIALLY_ENACTED: { label: '부분 이행', tone: 'bg-amber-50 text-amber-700' },
  SUPERSEDED: { label: '대체됨', tone: 'bg-gray-100 text-gray-500' },
  REVOKED: { label: '폐기', tone: 'bg-rose-50 text-rose-600' },
  EXPIRED: { label: '만료', tone: 'bg-gray-100 text-gray-500' },
};

function unwrap<T>(res: unknown): T | undefined {
  const inner = (res as { data?: unknown })?.data;
  return ((inner as { data?: unknown })?.data ?? inner) as T | undefined;
}

export default function GovernancePage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'agendas' | 'decisions'>('overview');
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [showSubmit, setShowSubmit] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<AgendaRow | null>(null);
  const [detailAgenda, setDetailAgenda] = useState<AgendaRow | null>(null);
  const [manageCommittee, setManageCommittee] = useState<CommitteeCard | null | 'NEW'>(null);

  const summaryQ = useQuery({
    queryKey: ['gov-summary'],
    queryFn: () => apiClient.get('/api/v1/governance/summary'),
    refetchInterval: 60_000,
  });
  const summary = unwrap<{
    committees: CommitteeCard[]; pendingAgendas: number; pendingActions: number;
    recentDecisions: { id: string; decisionNo: string; resolution: string; status: string; committee?: { code?: string } }[];
    reviewSoon: { id: string; decisionNo: string; reviewDue: string; committee?: { code?: string } }[];
  }>(summaryQ.data) ?? { committees: [], pendingAgendas: 0, pendingActions: 0, recentDecisions: [], reviewSoon: [] };

  const agendasQ = useQuery({
    queryKey: ['gov-agendas'],
    queryFn: () => apiClient.get('/api/v1/governance/agendas'),
    enabled: tab === 'agendas',
  });
  const agendas = unwrap<AgendaRow[]>(agendasQ.data) ?? [];

  const decisionsQ = useQuery({
    queryKey: ['gov-decisions'],
    queryFn: () => apiClient.get('/api/v1/governance/decisions'),
    enabled: tab === 'decisions',
  });
  const decisions = unwrap<DecisionRow[]>(decisionsQ.data) ?? [];

  const healthQ = useQuery({
    queryKey: ['gov-health'],
    queryFn: () => apiClient.get('/api/v1/governance/health'),
    enabled: tab === 'overview',
    staleTime: 300_000,
  });
  const health = unwrap<{ configDrift: { count: number; keys: string[] }; gateCollectionGaps: string[] }>(healthQ.data);

  /**
   * 🔴 **막혀 있는 결정** — 결정 경로 엔진(P2)의 존재 이유다.
   *    종전 결정 축에는 "막힘"이라는 상태 자체가 없었고, 있었더라도 이유가 없었다.
   *    "N건 진행 중"이 아니라 **무엇이 어디서 왜 멈췄는지**를 보여준다.
   */
  const layerQ = useQuery({
    queryKey: ['gov', 'pathway-summary'],
    queryFn: () => apiClient.get<{ data: LayerSummary }>('/api/v1/governance/pathways/summary'),
    staleTime: 60_000,
  });
  const layerSummary = unwrap<LayerSummary>(layerQ.data);

  const blockedQ = useQuery({
    queryKey: ['gov-pathways-blocked'],
    queryFn: () => apiClient.get<{ data: PathwayInstance[] }>('/api/v1/governance/pathways/blocked'),
    enabled: tab === 'overview',
    staleTime: 60_000,
  });
  const blocked = unwrap<PathwayInstance[]>(blockedQ.data) ?? [];

  /**
   * 안건별 결정 경로 — 안건 목록에 **지금 어느 단계에 누구 손에** 있는지 붙인다.
   * 🔴 경로가 없는 안건은 `null` 이다 — "시작 안 함"과 "조회 실패"를 구분해야 하므로
   *    실패는 아래에서 따로 말한다(없음으로 뭉개지 않는다).
   */
  const pathQ = useQuery({
    queryKey: ['gov-pathways-by-agenda', agendas.map((a) => a.id).join(',')],
    queryFn: async () => {
      const rows = await Promise.all(agendas.slice(0, 50).map(async (a) => {
        const r = await apiClient.get<{ data: PathwayInstance | null }>('/api/v1/governance/pathways/instance', { agendaId: a.id });
        return [a.id, unwrap<PathwayInstance | null>(r) ?? null] as const;
      }));
      return Object.fromEntries(rows) as Record<string, PathwayInstance | null>;
    },
    enabled: tab === 'agendas' && agendas.length > 0,
    staleTime: 60_000,
  });
  const pathByAgenda = pathQ.data ?? {};

  const confirmAction = useMutation({
    mutationFn: (actionId: string) => apiClient.patch(`/api/v1/governance/actions/${actionId}/confirm`, {}),
    onSuccess: () => { toast.success('이행 확인했습니다.'); qc.invalidateQueries({ queryKey: ['gov-decisions'] }); qc.invalidateQueries({ queryKey: ['gov-summary'] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || '이행 확인에 실패했습니다.'),
  });

  const enactNow = useMutation({
    mutationFn: (decisionId: string) => apiClient.post(`/api/v1/governance/decisions/${decisionId}/enact`, {}),
    onSuccess: (res) => {
      const r = unwrap<{ enacted: number; failed: number; remaining: number }>(res);
      toast.success(`집행 완료 — 성공 ${r?.enacted ?? 0}·실패 ${r?.failed ?? 0}·잔여 ${r?.remaining ?? 0}`);
      qc.invalidateQueries({ queryKey: ['gov-decisions'] }); qc.invalidateQueries({ queryKey: ['gov-summary'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '집행 실패 — 게이트(governance.enactment.enabled)·시행일을 확인하세요.'),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="위원회 거버넌스" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="의사결정 대장 — 안건 접수 → 회의 상정 → 의결(GOV-번호) → 이행 추적" /></p>
          {/* 🔴 표준(CP·프로토콜)이 무엇이 있어야 발효되는가 — 진입점 */}
          <Link href="/admin/governance/standards" className="text-xs text-indigo-600 hover:text-indigo-800 mt-1 inline-block">
            <T k="표준 발효 거버넌스 →" />
          </Link>
        </div>
        <button onClick={() => setShowSubmit(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700"><T k="+ 안건 제안" /></button>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['overview', '관제'], ['agendas', '안건'], ['decisions', '의결']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${tab === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '미결 안건', value: summary.pendingAgendas, tone: 'bg-amber-50 text-amber-700' },
              { label: '이행 대기(MANUAL)', value: summary.pendingActions, tone: 'bg-blue-50 text-blue-700' },
              { label: '재검토 임박(30일)', value: summary.reviewSoon.length, tone: 'bg-rose-50 text-rose-700' },
            ].map((s) => (
              <div key={s.label} className={`rounded-2xl border border-gray-100 p-5 text-center ${s.tone.split(' ')[0]}`}>
                <p className={`text-3xl font-bold ${s.tone.split(' ')[1]}`}>{s.value}<Unit><T k="건" /></Unit></p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {isAdmin && (
            <div className="flex justify-end">
              <button onClick={() => setManageCommittee('NEW')}
                className="px-3 py-1.5 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700"><T k="+ 위원회 추가" /></button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {summary.committees.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-gray-900">{c.name}</span>
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{c.code}</span>
                    {isAdmin && (
                      <button onClick={() => setManageCommittee(c)} title={tAttr('위원회 관리(기본정보·위원)')}
                        className="text-gray-300 hover:text-gray-600 text-xs">⚙</button>
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400">정족수 {c.quorum || '과반'} · {c.meetingCycle === 'MONTHLY' ? '월간' : c.meetingCycle === 'QUARTERLY' ? '분기' : c.meetingCycle === 'AD_HOC' ? '수시' : c.meetingCycle ?? '-'}</p>
                <div className="flex gap-3 mt-2 text-xs">
                  <span className={c._count.agendas > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>미결 {c._count.agendas}</span>
                  <span className="text-gray-500">의결 누적 {c._count.govDecisions}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 🔴 층별 진행 — **합치지 않는다**. 세 층은 별개이고, 합친 퍼센트는 거짓 안심을 만든다 */}
          {layerQ.isError ? (
            <QueryErrorFallback error={layerQ.error} onRetry={() => layerQ.refetch()} size="compact" />
          ) : layerQ.isLoading ? (
            <p className="text-xs text-gray-400"><T k="층별 진행 확인 중…" /></p>
          ) : layerSummary && layerSummary.layers.length > 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <p className="text-xs font-bold text-gray-700 mb-2"><T k="결정 경로 — 층별 진행" /></p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {layerSummary.layers.map((l) => (
                  <div key={l.layer} className="rounded-xl border border-gray-100 px-3 py-2">
                    <p className="text-[11px] font-semibold text-gray-600">
                      {LAYER_TITLE_SHORT[l.layer as keyof typeof LAYER_TITLE_SHORT] ?? l.layer}
                    </p>
                    <p className="text-xs text-gray-700 mt-1 tabular-nums">
                      진행 {l.active} · <span className={l.blocked > 0 ? 'text-amber-700 font-semibold' : ''}>막힘 {l.blocked}</span> · 완료 {l.done}
                      <span className="text-gray-400"> / {l.total}</span>
                    </p>
                    {/* 🔴 표본이 없으면 0 이 아니라 "산출 불가" */}
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {l.stayDaysMedian == null
                        ? `체류일 ${RATIO_UNAVAILABLE}(진행 중 없음)`
                        : `현재 단계 체류일 중앙값 ${l.stayDaysMedian}일 · 최대 ${l.stayDaysMax}일`}
                    </p>
                  </div>
                ))}
              </div>
              {/* 🔴 기준이 없다는 사실을 화면이 말한다 — 안 말하면 "정상"으로 읽힌다 */}
              <p className="text-[10px] text-gray-400 mt-2">{layerSummary.slaNote}</p>
              {layerSummary.truncated && (
                <p className="text-[10px] text-amber-600 mt-1">상위 {layerSummary.limit}건만 집계했다(전수 아님).</p>
              )}
            </div>
          ) : null}

          {/* 🔴 막혀 있는 결정 — 사라지는 알림이 아니라 **줄어드는 목록**이다 */}
          {blockedQ.isError ? (
            <QueryErrorFallback error={blockedQ.error} onRetry={() => blockedQ.refetch()} size="compact" />
          ) : blocked.length > 0 ? (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <p className="text-xs font-bold text-amber-800 mb-2">
                막혀 있는 결정 {blocked.length}건 — 무엇이·어디서·왜
              </p>
              <div className="space-y-1.5">
                {blocked.map((b) => {
                  const cur = b.steps.find((s) => s.key === b.currentStepKey);
                  return (
                    <div key={b.id} className="text-xs text-amber-900 bg-white/70 rounded-lg px-2.5 py-1.5">
                      <span className="font-mono text-[10px] text-amber-600 mr-1.5">{b.pathway.code}</span>
                      <b>{b.source.kind === 'AGENDA' ? '안건' : b.source.registryKey}</b>
                      <span className="mx-1.5 text-amber-400">›</span>
                      <span>{cur?.title ?? b.currentStepKey ?? '단계 미상'}</span>
                      {/* 🔴 지금 누구 손에 있는가 — 모르면 모른다고 말한다 */}
                      <span className="ml-1.5 text-[10px] text-amber-700">
                        {b.currentOwnerRoles?.length ? `담당 ${b.currentOwnerRoles.join('·')}` : '담당 미지정'}
                      </span>
                      {/* 🔴 체류일은 **사실**이다 — 기준(SLA)이 없으므로 "지연"이라 말하지 않는다 */}
                      {b.currentStepDays != null && (
                        <span className="ml-1.5 text-[10px] text-amber-600">이 단계에서 {b.currentStepDays}일</span>
                      )}
                      {/* 🔴 왜 멈췄는가 — 이유가 없으면 아무도 다시 밀 수 없다 */}
                      {b.blockedReason && <div className="text-[11px] text-amber-700 mt-0.5">{b.blockedReason}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {summary.reviewSoon.length > 0 && (
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
              <p className="text-xs font-bold text-rose-700 mb-2"><T k="재검토 기한 임박" /></p>
              {summary.reviewSoon.map((r) => (
                <p key={r.id} className="text-xs text-rose-600">⚖ {r.decisionNo} ({r.committee?.code}) — 기한 <KDate value={r.reviewDue} mode="date" /></p>
              ))}
            </div>
          )}

          {health && (health.configDrift.count > 0 || health.gateCollectionGaps.length > 0) && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <p className="text-xs font-bold text-amber-700 mb-1.5"><T k="헬스체크 — 드리프트 감시(D13)" /></p>
              {health.configDrift.count > 0 && (
                <p className="text-xs text-amber-700">· DEFAULTS 미등재 config 키 <b>{health.configDrift.count}</b>건: <span className="font-mono text-[10px]">{health.configDrift.keys.slice(0, 5).join(', ')}{health.configDrift.count > 5 ? ' …' : ''}</span></p>
              )}
              {health.gateCollectionGaps.length > 0 && (
                <p className="text-xs text-amber-600">· 게이트 관제 수집 누락: <span className="font-mono text-[10px]">{health.gateCollectionGaps.join(', ')}</span> — 분류기 판정 불가(값 형식 확인)</p>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-bold text-gray-500 mb-2"><T k="최근 의결" /></p>
            {summary.recentDecisions.length === 0 ? (
              <EmptyState compact icon="⚖" title="의결 기록이 없습니다" />
            ) : summary.recentDecisions.map((d) => (
              <div key={d.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0 text-sm">
                <span className="font-mono font-bold text-indigo-600 text-xs whitespace-nowrap">⚖ {d.decisionNo}</span>
                <span className="text-[10px] text-gray-400">{d.committee?.code}</span>
                <span className="text-gray-700 truncate flex-1">{d.resolution}</span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${DECISION_STATUS[d.status]?.tone ?? 'bg-gray-100 text-gray-500'}`}>
                  {DECISION_STATUS[d.status]?.label ?? d.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'agendas' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs text-gray-500">
                <th className="text-left py-3 px-4 font-medium"><T k="위원회" /></th>
                <th className="text-left py-3 px-4 font-medium"><T k="안건" /></th>
                <th className="text-left py-3 px-4 font-medium"><T k="출처" /></th>
                <th className="text-left py-3 px-4 font-medium"><T k="접수일" /></th>
                <th className="text-left py-3 px-4 font-medium"><T k="상태" /></th>
                <th className="text-left py-3 px-4 font-medium"><T k="경로@결정" /></th>
                <th className="text-right py-3 px-4 font-medium"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {agendas.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon="📋" title="안건이 없습니다" hint="[+ 안건 제안]으로 접수하세요" /></td></tr>
              ) : agendas.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setDetailAgenda(a)}>
                  <td className="py-3 px-4 whitespace-nowrap"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{a.committee?.code}</span></td>
                  <td className="py-3 px-4 text-gray-800 max-w-md truncate" title={a.title}>{a.title}
                    {a.decision && <span className="ml-2 font-mono text-[10px] text-indigo-500">⚖ {a.decision.decisionNo}</span>}
                    {a.aiAssessedAt && <span className="ml-1 text-[10px]" title={tAttr('AI 영향 평가 있음')}>🤖</span>}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-gray-400 whitespace-nowrap">{a.sourceRef?.type ?? '직접 제안'}</td>
                  <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap"><KDate value={a.createdAt} mode="date" /></td>
                  <td className="py-3 px-4"><span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${AGENDA_STATUS[a.status]?.tone ?? 'bg-gray-100'}`}>{AGENDA_STATUS[a.status]?.label ?? a.status}</span></td>
                  {/* 🔴 결정 경로 — 지금 어느 단계에 누구 손에 있는가 */}
                  <td className="py-3 px-4 whitespace-nowrap text-[11px]">
                    {pathQ.isError ? (
                      // 🔴 조회 실패를 "경로 없음"으로 말하지 않는다
                      <span className="text-gray-400" title={tAttr('경로를 조회하지 못했습니다 — 없다는 뜻이 아닙니다')}><T k="확인 불가" /></span>
                    ) : pathQ.isLoading ? (
                      <span className="text-gray-300"><T k="확인 중…" /></span>
                    ) : !pathByAgenda[a.id] ? (
                      <span className="text-gray-400"><T k="경로 미시작" /></span>
                    ) : (() => {
                      const p = pathByAgenda[a.id]!;
                      const cur = p.steps.find((st) => st.key === p.currentStepKey);
                      return (
                        <span className={p.status === 'BLOCKED' ? 'text-amber-700' : 'text-gray-600'}>
                          {p.status === 'BLOCKED' && <span className="mr-1"><T k="막힘" /></span>}
                          <span className="font-medium">{cur?.title ?? '완료'}</span>
                          <span className="text-gray-400 ml-1">{p.progress.done}/{p.progress.total}</span>
                          {/* 담당을 모르면 모른다고 말한다 */}
                          <span className="block text-[10px] text-gray-400">
                            {p.currentOwnerRoles?.length ? p.currentOwnerRoles.join('·') : (p.status === 'DONE' ? '' : '담당 미지정')}
                            {p.currentStepDays != null && <span className="ml-1">· {p.currentStepDays}일 경과</span>}
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {['SUBMITTED', 'SCHEDULED'].includes(a.status) && (
                      <button onClick={(e) => { e.stopPropagation(); setResolveTarget(a); }}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                        <T k="회의·의결" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'decisions' && (
        <div className="space-y-3">
          {decisions.length === 0 ? (
            <EmptyState icon="⚖" title="의결 기록이 없습니다" className="bg-white rounded-2xl border" />
          ) : decisions.map((d) => (
            <div key={d.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-indigo-600">⚖ {d.decisionNo}</span>
                {d.signRef && <span className="text-[10px]" title={`sign 체인 봉인 — entryHash: ${d.signRef}`}>🔏</span>}
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{d.committee?.code}</span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${DECISION_STATUS[d.status]?.tone ?? 'bg-gray-100'}`}>{DECISION_STATUS[d.status]?.label ?? d.status}</span>
                <span className="text-xs text-gray-400 ml-auto whitespace-nowrap"><KDate value={d.resolvedAt} mode="date" />
                  {d.voteFor != null && ` · 찬 ${d.voteFor}·반 ${d.voteAgainst ?? 0}·기권 ${d.voteAbstain ?? 0}`}</span>
              </div>
              <p className="text-sm text-gray-800 mt-2">{d.resolution}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{d.agenda?.title}{d.reviewDue && <> <T k="· 재검토" /> <KDate value={d.reviewDue} mode="date" /></>}</p>
              {d.actions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {d.actions.map((ac) => (
                    <div key={ac.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{ac.kind}</span>
                      <span className="text-gray-600 flex-1 truncate" title={ac.kind !== 'MANUAL' ? JSON.stringify(ac.target) : undefined}>
                        {ac.target?.description ?? ac.manualNote ?? (ac.kind !== 'MANUAL' ? JSON.stringify(ac.target) : '-')}
                      </span>
                      {ac.status === 'PENDING' ? (
                        ac.kind === 'MANUAL' ? (
                          <button onClick={() => confirmAction.mutate(ac.id)} disabled={confirmAction.isPending}
                            className="min-h-[44px] px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40">
                            <T k="이행 확인" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-amber-600 font-medium"><T k="집행 대기" /></span>
                        )
                      ) : (
                        <span className={`text-[10px] font-medium ${ac.status === 'ENACTED' ? 'text-emerald-600' : ac.status === 'FAILED' ? 'text-rose-600' : 'text-gray-400'}`}>{ac.status === 'ENACTED' ? '이행 완료' : ac.status}</span>
                      )}
                    </div>
                  ))}
                  {d.actions.some((ac) => ac.status === 'PENDING' && ac.kind !== 'MANUAL') && ['RESOLVED', 'PARTIALLY_ENACTED'].includes(d.status) && (
                    <div className="flex justify-end pt-1">
                      <button onClick={() => enactNow.mutate(d.id)} disabled={enactNow.isPending}
                        className="min-h-[44px] px-3 py-1.5 text-[11px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
                        {enactNow.isPending ? '집행 중…' : '지금 집행'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showSubmit && <ProposeAgendaModal onClose={() => setShowSubmit(false)}
        onDone={() => { setShowSubmit(false); setTab('agendas'); }} />}
      {resolveTarget && <ResolveModal agenda={resolveTarget} onClose={() => setResolveTarget(null)}
        onDone={() => { setResolveTarget(null); qc.invalidateQueries(); setTab('decisions'); }} />}
      {detailAgenda && <AgendaDrawer agenda={detailAgenda} onClose={() => setDetailAgenda(null)}
        onResolve={() => { setResolveTarget(detailAgenda); setDetailAgenda(null); }} />}
      {manageCommittee !== null && <CommitteeManageModal committee={manageCommittee === 'NEW' ? null : manageCommittee}
        onClose={() => setManageCommittee(null)}
        onDone={() => { setManageCommittee(null); qc.invalidateQueries({ queryKey: ['gov-summary'] }); }} />}
    </div>
  );
}

/**
 * 위원회 관리(ADMIN) — 생성/기본정보(코드·정족수·주기·유형)·위원장·위원 추가/제거·비활성.
 * 코드(code)는 거버넌스 관제 노출 키(unique) — 없으면 관제 카드에 뜨지 않으므로 이 모달에서는 필수.
 */
function CommitteeManageModal({ committee, onClose, onDone }: { committee: CommitteeCard | null; onClose: () => void; onDone: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isNew = !committee;
  const [name, setName] = useState(committee?.name ?? '');
  const [code, setCode] = useState(committee?.code ?? '');
  const [type, setType] = useState('QUALITY');
  const [quorum, setQuorum] = useState(String(committee?.quorum ?? 0));
  const [meetingCycle, setMeetingCycle] = useState(committee?.meetingCycle ?? 'MONTHLY');
  const [memberSearch, setMemberSearch] = useState('');

  const detailQ = useQuery({
    queryKey: ['gld-committee', committee?.id],
    queryFn: () => apiClient.get(`/api/v1/gld/committees/${committee!.id}`),
    enabled: !isNew,
  });
  const detail = unwrap<{ type?: string; chairId?: string | null; isActive?: boolean;
    members?: { id: string; userId: string; role: string; user?: { familyName?: string; givenName?: string } | null }[] }>(detailQ.data);

  const usersQ = useQuery({
    queryKey: ['staff-users-all'],
    queryFn: () => apiClient.get('/api/v1/users'),
    staleTime: 300_000,
  });
  const users = unwrap<{ id: string; familyName?: string; givenName?: string; role?: string; department?: string }[]>(usersQ.data) ?? [];
  const nameOf = (id?: string | null) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.familyName ?? ''}${u.givenName ?? ''}` : '';
  };
  const memberIds = new Set((detail?.members ?? []).map((m) => m.userId));
  const candidates = users.filter((u) =>
    !memberIds.has(u.id) &&
    (!memberSearch.trim() || `${u.familyName ?? ''}${u.givenName ?? ''}${u.department ?? ''}`.includes(memberSearch.trim())),
  ).slice(0, 8);

  const save = useMutation({
    mutationFn: () => isNew
      ? apiClient.post('/api/v1/gld/committees', { name: name.trim(), code: code.trim(), type, quorum: Number(quorum) || 0, meetingCycle })
      : apiClient.patch(`/api/v1/gld/committees/${committee!.id}`, { name: name.trim(), code: code.trim(), type, quorum: Number(quorum) || 0, meetingCycle }),
    onSuccess: () => { toast.success(isNew ? '위원회가 생성되었습니다.' : '저장되었습니다.'); qc.invalidateQueries({ queryKey: ['gld-committee'] }); onDone(); },
    onError: (e) => toast.error((e as { message?: string })?.message || '저장 실패'),
  });
  const addMember = useMutation({
    mutationFn: (userId: string) => apiClient.post(`/api/v1/gld/committees/${committee!.id}/members`, { userId, role: 'MEMBER' }),
    onSuccess: () => { setMemberSearch(''); qc.invalidateQueries({ queryKey: ['gld-committee', committee?.id] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || '위원 추가 실패'),
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) => apiClient.del(`/api/v1/gld/members/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gld-committee', committee?.id] }),
    onError: (e) => toast.error((e as { message?: string })?.message || '위원 제거 실패'),
  });
  const setChair = useMutation({
    mutationFn: (chairId: string | null) => apiClient.patch(`/api/v1/gld/committees/${committee!.id}`, { chairId }),
    onSuccess: () => { toast.success('위원장이 변경되었습니다.'); qc.invalidateQueries({ queryKey: ['gld-committee', committee?.id] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || '위원장 변경 실패'),
  });
  const deactivate = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/gld/committees/${committee!.id}`, { isActive: false }),
    onSuccess: () => { toast.success('위원회를 비활성화했습니다(대장 이력은 보존).'); onDone(); },
    onError: (e) => toast.error((e as { message?: string })?.message || '비활성화 실패'),
  });

  // 수정 모드 진입 시 상세 반영(1회)
  const [hydrated, setHydrated] = useState(false);
  if (!isNew && detail && !hydrated) {
    setType(detail.type ?? 'QUALITY');
    setHydrated(true);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900">{isNew ? '위원회 추가' : `위원회 관리 — ${committee!.name}`}</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="위원회명 *" /></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tAttr('예: 항생제관리위원회')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="코드 *" /> <span className="font-normal text-gray-400"><T k="(관제 노출 키·대문자)" /></span></label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={tAttr('예: ASP')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="유형" /></label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              {['QUALITY', 'SAFETY', 'INFECTION', 'PHARMACY', 'MEDICAL', 'ETHICS', 'ADMIN'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="정족수" /> <span className="font-normal text-gray-400"><T k="(0=과반)" /></span></label>
            <input inputMode="numeric" value={quorum} onChange={(e) => setQuorum(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="회의 주기" /></label>
            <select value={meetingCycle} onChange={(e) => setMeetingCycle(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="MONTHLY">{tAttr('월간@주기')}</option><option value="QUARTERLY">{tAttr('분기')}</option><option value="AD_HOC">{tAttr('수시')}</option>
            </select>
          </div>
        </div>

        {!isNew && (
          <div className="border border-gray-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500">위원 {(detail?.members ?? []).length}명</p>
              <label className="text-[11px] text-gray-500 flex items-center gap-1">
                <T k="위원장:" />
                <select value={detail?.chairId ?? ''} onChange={(e) => setChair.mutate(e.target.value || null)}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-[11px] bg-white max-w-[140px]">
                  <option value="">{tAttr('— 미지정 —')}</option>
                  {(detail?.members ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>{nameOf(m.userId) || m.userId.slice(0, 8)}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {(detail?.members ?? []).map((m) => (
                <span key={m.id} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${m.userId === detail?.chairId ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  {m.userId === detail?.chairId && '👑 '}{nameOf(m.userId) || m.userId.slice(0, 8)}
                  <button onClick={() => removeMember.mutate(m.id)} className="text-gray-400 hover:text-rose-500">×</button>
                </span>
              ))}
              {(detail?.members ?? []).length === 0 && <span className="text-[11px] text-gray-400"><T k="등록된 위원이 없습니다 — 아래에서 추가하세요." /></span>}
            </div>
            <div>
              <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder={tAttr('위원 추가 — 이름·부서 검색')}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" />
              {memberSearch.trim() && (
                <div className="mt-1 border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-36 overflow-y-auto">
                  {candidates.map((u) => (
                    <button key={u.id} onClick={() => addMember.mutate(u.id)}
                      className="min-h-[44px] w-full text-left px-2.5 py-1.5 text-xs hover:bg-indigo-50 flex justify-between">
                      <span>{u.familyName}{u.givenName} <span className="text-gray-400">{u.department ?? ''}</span></span>
                      <span className="text-[10px] text-gray-400">{u.role}</span>
                    </button>
                  ))}
                  {candidates.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-gray-400"><T k="일치하는 직원이 없습니다" /></p>}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={() => save.mutate()} disabled={!name.trim() || !code.trim() || save.isPending}
            className="min-h-[44px] flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-blue-700">
            {save.isPending ? '저장 중…' : isNew ? '생성' : '기본정보 저장'}
          </button>
          {!isNew && (
            <button onClick={() => { if (confirm(`'${committee!.name}' 를 비활성화할까요?\n\n관제·목록에서 숨겨지고 대장 이력(안건·의결)은 보존됩니다.`)) deactivate.mutate(); }}
              className="min-h-[44px] px-3 py-2.5 bg-rose-50 text-rose-600 text-sm rounded-xl hover:bg-rose-100"><T k="비활성화" /></button>
          )}
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}

/**
 * 안건 상세 드로어(워크벤치 P1·P2) — 근거 전문·출처 딥링크·배정 회의·의결 결과·
 * 담당 위원회 표면 현재값·AI 영향 평가. 목록 맥락 유지(D4 — 별도 페이지 아님).
 */
function AgendaDrawer({ agenda, onClose, onResolve }: { agenda: AgendaRow; onClose: () => void; onResolve: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const src = agenda.sourceRef?.type ? SOURCE_LINKS[agenda.sourceRef.type] : null;

  const meetingsQ = useQuery({
    queryKey: ['gld-meetings'],
    queryFn: () => apiClient.get('/api/v1/gld/meetings'),
    enabled: !!agenda.meetingId, staleTime: 60_000,
  });
  const meeting = (unwrap<{ id: string; title: string; scheduledAt: string; attendees?: unknown[]; minutesSignedAt?: string | null }[]>(meetingsQ.data) ?? [])
    .find((m) => m.id === agenda.meetingId);

  const decisionsQ = useQuery({
    queryKey: ['gov-decisions'],
    queryFn: () => apiClient.get('/api/v1/governance/decisions'),
    enabled: !!agenda.decision, staleTime: 60_000,
  });
  const decision = (unwrap<(DecisionRow & { agendaId?: string })[]>(decisionsQ.data) ?? []).find((d) => d.agendaId === agenda.id || d.decisionNo === agenda.decision?.decisionNo);

  const surfaceQ = useQuery({
    queryKey: ['gov-surface-map'],
    queryFn: () => apiClient.get('/api/v1/governance/surface-map'),
    staleTime: 300_000,
  });
  const surfaces = (unwrap<{ surfaceKey: string; committeeId: string; note?: string | null }[]>(surfaceQ.data) ?? [])
    .filter((s) => s.committeeId === agenda.committeeId);

  const configQ = useQuery({
    queryKey: ['gov-config-values'],
    queryFn: () => apiClient.get('/api/v1/config'),
    staleTime: 300_000, enabled: surfaces.some((s) => s.surfaceKey.startsWith('config:')),
  });
  const configRows = unwrap<{ key: string; value: unknown }[]>(configQ.data) ?? [];
  const valueOf = (surfaceKey: string) => {
    if (!surfaceKey.startsWith('config:')) return null;
    const row = configRows.find((c) => c.key === surfaceKey.slice(7));
    return row ? JSON.stringify(row.value) : null;
  };

  const assess = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/governance/agendas/${agenda.id}/assess`, {}),
    onSuccess: () => { toast.success('AI 영향 평가가 생성되었습니다.'); qc.invalidateQueries({ queryKey: ['gov-agendas'] }); onClose(); },
    onError: (e) => toast.error((e as { message?: string })?.message || 'AI 평가 실패 — governance.ai.enabled 게이트·AI 서버 상태를 확인하세요.'),
  });

  const ai = agenda.aiAssessment;
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 mt-1">{agenda.committee?.code}</span>
          <h3 className="text-base font-bold text-gray-900 flex-1">{agenda.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm"><T k="닫기" /></button>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
          <span className={`font-medium px-2 py-0.5 rounded-full ${AGENDA_STATUS[agenda.status]?.tone ?? 'bg-gray-100'}`}>{AGENDA_STATUS[agenda.status]?.label ?? agenda.status}</span>
          <span><T k="접수@상태" /> <KDate value={agenda.createdAt} mode="date" /></span>
          {agenda.proposerName && <span>· 제안 {agenda.proposerName}</span>}
          {src && (
            <a href={src.href} className="text-indigo-600 hover:underline font-medium">
              출처: {src.label}{agenda.sourceRef?.key ? ` (${agenda.sourceRef.key})` : ''} →
            </a>
          )}
        </div>

        {agenda.body && (/^\s*</.test(agenda.body)
          ? <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(agenda.body) }} />
          : <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{agenda.body}</div>
        )}

        {meeting && (
          <div className="border border-gray-100 rounded-xl p-3 text-xs text-gray-600">
            <p className="font-bold text-gray-500 mb-1"><T k="배정 회의" /></p>
            <p>{meeting.title} · <KDate value={meeting.scheduledAt} /> · 참석 {Array.isArray(meeting.attendees) ? meeting.attendees.length : 0}명
              {meeting.minutesSignedAt && <span className="ml-1" title={tAttr('의사록 봉인됨')}>🔏</span>}</p>
          </div>
        )}

        {decision && (
          <div className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-3 text-xs">
            <p className="font-bold text-indigo-600 mb-1">⚖ {decision.decisionNo}
              {decision.signRef && <span className="ml-1" title={`봉인 entryHash: ${decision.signRef}`}>🔏</span>}
              <span className={`ml-2 font-medium px-2 py-0.5 rounded-full ${DECISION_STATUS[decision.status]?.tone ?? 'bg-gray-100'}`}>{DECISION_STATUS[decision.status]?.label ?? decision.status}</span>
            </p>
            <p className="text-gray-700">{decision.resolution}</p>
            {decision.voteFor != null && <p className="text-gray-400 mt-0.5">찬 {decision.voteFor}·반 {decision.voteAgainst ?? 0}·기권 {decision.voteAbstain ?? 0}{decision.reviewDue && <> · 재검토 <KDate value={decision.reviewDue} mode="date" /></>}</p>}
            {decision.actions?.map((ac) => (
              <p key={ac.id} className="mt-1 text-gray-600"><span className="text-[10px] font-bold px-1 rounded bg-gray-200 text-gray-600 mr-1">{ac.kind}</span>{ac.target?.description ?? JSON.stringify(ac.target)} — {ac.status}</p>
            ))}
          </div>
        )}

        {surfaces.length > 0 && (
          <div className="border border-gray-100 rounded-xl p-3">
            <p className="text-xs font-bold text-gray-500 mb-1.5">담당 위원회 표면({agenda.committee?.code}) — 현재값</p>
            <div className="space-y-1">
              {surfaces.map((s) => (
                <div key={s.surfaceKey} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-gray-600 truncate" title={s.note ?? ''}>{s.surfaceKey}</span>
                  <span className="font-mono text-indigo-600 truncate ml-auto max-w-[45%]" title={valueOf(s.surfaceKey) ?? ''}>{valueOf(s.surfaceKey) ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border border-violet-100 bg-violet-50/40 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-bold text-violet-700">🤖 AI 영향 평가{ai?.assessedAt && <span className="font-normal text-violet-400 ml-1"><KDate value={ai.assessedAt} /></span>}</p>
            {agenda.status !== 'RESOLVED' ? (
              <button onClick={() => assess.mutate()} disabled={assess.isPending}
                className="min-h-[44px] px-2.5 py-1 text-[11px] font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40">
                {assess.isPending ? '평가 중…(수십 초)' : ai ? '재생성' : '평가 실행'}
              </button>
            ) : <span className="text-[10px] text-violet-400"><T k="의결 후 동결" /></span>}
          </div>
          {ai ? (
            <div className="space-y-1.5 text-xs text-gray-700">
              {ai.scope && <p><b className="text-violet-700"><T k="영향 범위" /></b> — {ai.scope}</p>}
              {ai.currentState && <p><b className="text-violet-700"><T k="현재 상태" /></b> — {ai.currentState}</p>}
              {(ai.risks?.length ?? 0) > 0 && <div><b className="text-violet-700"><T k="유의점" /></b><ul className="list-disc ml-4">{ai.risks!.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              {(ai.checklist?.length ?? 0) > 0 && <div><b className="text-violet-700"><T k="의결 전 확인" /></b><ul className="list-disc ml-4">{ai.checklist!.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              {ai.bindingSuggestion != null && ai.bindingSuggestion !== 'null' && (
                <div><b className="text-violet-700"><T k="가결 시 바인딩 예" /></b>
                  <pre className="mt-0.5 bg-white border border-violet-100 rounded-lg p-2 text-[10px] overflow-x-auto">{typeof ai.bindingSuggestion === 'string' ? ai.bindingSuggestion : JSON.stringify(ai.bindingSuggestion, null, 1)}</pre>
                </div>
              )}
              <p className="text-[11px] text-violet-500">{ai.disclaimer ?? 'AI 브리핑입니다 — 판단·의결은 위원회 몫입니다.'}</p>
            </div>
          ) : (
            <p className="text-[11px] text-violet-400"><T k="아직 평가가 없습니다. 게이트(governance.ai.enabled) ON 상태에서 실행하세요 — 브리핑이며 판단을 대체하지 않습니다." /></p>
          )}
        </div>

        {['SUBMITTED', 'SCHEDULED'].includes(agenda.status) && (
          <button onClick={onResolve}
            className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"><T k="회의·의결 진행" /></button>
        )}
      </div>
    </div>
  );
}

/** 회의 생성(참석 체크)+배정+의결을 한 흐름으로 — 대장 최소 동선(상세 회의 운영은 후속) */
function ResolveModal({ agenda, onClose, onDone }: { agenda: AgendaRow; onClose: () => void; onDone: () => void }) {
  const tAttr = useTAttr();
  /**
   * 🔴 참석자는 **계정으로 고른다.** 종전에는 이름을 콤마로 타이핑받아 문자열로 저장했고,
   *    정족수는 그 배열 길이만 셌다 — 운영에 `["a","b","c","d","e"]` 가 남아 있었고
   *    아무 문자 다섯 개로 정족수 5가 충족됐다.
   */
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const committeeId = (agenda as unknown as { committeeId?: string }).committeeId;
  const rosterQ = useQuery({
    queryKey: ['gld-committee', committeeId],
    queryFn: () => apiClient.get<{ data: { members?: { userId: string; role: string; user?: { familyName?: string; givenName?: string; department?: string } | null }[] } }>(`/api/v1/gld/committees/${committeeId}`),
    enabled: !!committeeId,
    staleTime: 60_000,
  });
  const roster = unwrap<{ members?: { userId: string; role: string; user?: { familyName?: string; givenName?: string; department?: string } | null }[] }>(rosterQ.data)?.members ?? [];

  const toggleAttendee = (uid: string) =>
    setAttendeeIds((prev) => (prev.includes(uid) ? prev.filter((v) => v !== uid) : [...prev, uid]));

  const [resolution, setResolution] = useState('');
  const [voteFor, setVoteFor] = useState(''); const [voteAgainst, setVoteAgainst] = useState(''); const [voteAbstain, setVoteAbstain] = useState('');
  const [reviewDue, setReviewDue] = useState('');
  const [manualAction, setManualAction] = useState('');
  const [bindingsJson, setBindingsJson] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * 🔴 안건에 선택지가 있으면 **고르는 것이 의결이다.**
   *    종전에는 위원이 집행 대상을 JSON 으로 손수 적어야 했고, 그 순간 정본이 둘이 됐다
   *    (등록부/안건의 선택지 ↔ 위원이 적은 값). 이제 고른 선택지가 그대로 집행된다.
   */
  const options: DecisionOptionShape[] = Array.isArray(agenda.options) ? agenda.options : [];
  const hasOptions = options.length > 0;
  const [choice, setChoice] = useState('');
  const [choiceNote, setChoiceNote] = useState('');
  const special = isSpecialChoice(choice);
  const chosenDef = options.find((o) => o.value === choice) ?? null;
  const choiceReady = !hasOptions || (!!choice && (!special || !!choiceNote.trim()));

  /**
   * 🔴 **근거** — "이 의결이 무슨 근거로 섰는가". 세 갈래를 섞지 않는다.
   *    비워두는 것이 정상이다(강제하면 아무 문장이나 채워진다) — 다만 비었으면 비었다고 남는다.
   */
  const [basis, setBasis] = useState<Record<BasisKind, string[]>>({ legal: [], accreditation: [], evidence: [] });
  const [basisDraft, setBasisDraft] = useState<Record<string, string>>({});
  const addBasis = (k: BasisKind, text: string) => {
    const v = text.trim();
    if (!v || basis[k].includes(v)) return;
    setBasis((b) => ({ ...b, [k]: [...b[k], v] }));
    setBasisDraft((d) => ({ ...d, [k]: '' }));
  };
  const dropBasis = (k: BasisKind, i: number) =>
    setBasis((b) => ({ ...b, [k]: b[k].filter((_, idx) => idx !== i) }));
  /** 🔴 손대지 않은 갈래는 **보내지 않는다** — 미기재(키 없음)와 해당 없음(빈 배열)은 다른 사실이다 */
  const basisPayload = (): DecisionBasis | undefined => {
    const out: DecisionBasis = {};
    let any = false;
    for (const k of BASIS_KINDS) if (basis[k].length) { out[k] = basis[k]; any = true; }
    return any ? out : undefined;
  };

  /**
   * 🔴 등록부 출처 안건이면 그 결정의 **법적 검토 항목**을 보여준다.
   *    자동으로 근거에 넣지 않는다 — `legalReview` 는 "검토해야 할 항목"이지
   *    "검토했다는 사실"이 아니다. 자동 유입하면 **확인하지 않은 것을 확인한 것처럼** 기록된다.
   */
  const regKey = agenda.sourceRef?.type === 'DECISION' ? agenda.sourceRef.key : undefined;
  const regQ = useQuery({
    queryKey: ['decision-registry-item', regKey],
    // 🔴 `/api/v1/decisions` 는 서버에 없다(운영 404) — 결정 등록부 정본은 `/admin/decisions`
    queryFn: () => apiClient.get<{ data: { key: string; legalReview?: string[] }[] }>('/api/v1/admin/decisions'),
    enabled: !!regKey,
    staleTime: 300_000,
  });
  const legalReview: string[] =
    (unwrap<{ key: string; legalReview?: string[] }[]>(regQ.data) ?? []).find((d) => d.key === regKey)?.legalReview ?? [];

  /** 자동 집행 바인딩(P3) — [{kind, target}] JSON. 서버가 의결 시점에 구조·배선·카탈로그를 재검증한다 */
  const parseBindings = (): { kind: string; target: Record<string, unknown> }[] | null => {
    if (!bindingsJson.trim()) return [];
    try {
      const arr = JSON.parse(bindingsJson);
      if (!Array.isArray(arr) || arr.some((a) => !a?.kind || typeof a.target !== 'object')) return null;
      return arr;
    } catch { return null; }
  };
  const bindingsValid = parseBindings() !== null;

  const run = async () => {
    const bindings = parseBindings();
    if (bindings === null) { toast.error('바인딩 JSON 형식이 잘못됐습니다 — [{"kind":"…","target":{…}}] 배열이어야 합니다.'); return; }
    setBusy(true);
    try {
      const names = attendeeIds;
      let meetingId = agenda.meetingId;
      if (!meetingId) {
        const mt = await apiClient.post<{ data: { id: string } }>('/api/v1/gld/meetings', {
          committeeId: (agenda as unknown as { committeeId?: string }).committeeId ?? undefined,
          title: `${agenda.committee?.name ?? ''} 의결 회의`,
          scheduledAt: new Date().toISOString(),
          attendees: names,
        });
        meetingId = (unwrap<{ id: string }>(mt) as { id: string }).id;
        await apiClient.patch(`/api/v1/governance/agendas/${agenda.id}`, { meetingId });
      } else if (names.length) {
        await apiClient.patch(`/api/v1/gld/meetings/${meetingId}`, { attendees: names });
      }
      const actions = [
        ...(manualAction.trim() ? [{ kind: 'MANUAL', target: { description: manualAction.trim() } }] : []),
        ...(bindings ?? []),
      ];
      // 🔴 선택지가 있으면 집행 대상은 고른 선택지가 정한다 — 손으로 적은 액션을 함께 보내면
      //    서버가 거부한다(정본이 둘이 되는 것을 막는 자리). 수정 의결은 예외로 허용된다.
      const sendActions = hasOptions && !special ? [] : actions;
      await apiClient.post(`/api/v1/governance/agendas/${agenda.id}/resolve`, {
        resolution: resolution.trim(),
        ...(hasOptions ? { chosenOption: { value: choice, snapshot: options, ...(choiceNote.trim() ? { note: choiceNote.trim() } : {}) } } : {}),
        ...(basisPayload() ? { basis: basisPayload() } : {}),
        ...(voteFor ? { voteFor: Number(voteFor) } : {}), ...(voteAgainst ? { voteAgainst: Number(voteAgainst) } : {}), ...(voteAbstain ? { voteAbstain: Number(voteAbstain) } : {}),
        ...(reviewDue ? { reviewDue } : {}),
        ...(sendActions.length ? { actions: sendActions } : {}),
      });
      toast.success('의결이 기록되었습니다 (GOV 번호 발번).');
      onDone();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '의결에 실패했습니다 (정족수·참석 기록을 확인하세요).');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900">회의·의결 — {agenda.title}</h3>
        <p className="text-[11px] text-gray-400"><T k="참석자 기록 없이 의결할 수 없고, 정족수 미달이면 서버가 거부합니다. 의결 기록 자체는 값을 바꾸지 않습니다 — 바인딩 집행은 게이트 ON 후 [지금 집행]/크론이 수행합니다." /></p>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            <T k="참석 위원" /> <span className="text-gray-400"><T k="— 명부에서 고릅니다(계정에 연결됩니다)" /></span>
          </label>
          {rosterQ.isError ? (
            <QueryErrorFallback error={rosterQ.error} onRetry={() => rosterQ.refetch()} size="compact" />
          ) : rosterQ.isLoading ? (
            <p className="text-xs text-gray-400"><T k="위원 명부 확인 중…" /></p>
          ) : roster.length === 0 ? (
            /* 🔴 명부가 비어 있다는 사실을 그 자리에서 말한다 — 조용하면 "고를 사람이 없네"로 끝난다 */
            <div className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
              <p className="text-[11px] text-amber-900">
                이 위원회는 <b>위원 명부가 비어 있습니다.</b> 위원 임명이 의결보다 먼저입니다 —
                위원회 관리(⚙)에서 위원을 계정에 연결하세요. 명부 없이 의결하면 기록에 남습니다.
              </p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-50">
              {roster.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={attendeeIds.includes(m.userId)} onChange={() => toggleAttendee(m.userId)} />
                  <span className="text-gray-800">{m.user ? `${m.user.familyName ?? ''}${m.user.givenName ?? ''}` : '이름 확인 불가'}</span>
                  <span className="text-[10px] text-gray-400">{m.user?.department ?? ''} · {m.role}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-1 tabular-nums">참석 {attendeeIds.length}명 / 명부 {roster.length}명</p>
        </div>
        {hasOptions && (
          <div className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-3">
            <label className="block text-[11px] font-bold text-indigo-900 mb-1"><T k="어느 안으로 의결합니까? *" /></label>
            {/* 🔴 고르기 전에 결과를 알아야 한다 — 각 안이 무엇을 뜻하는지 그대로 보여준다 */}
            <div className="space-y-1.5 mt-2">
              {options.map((o) => (
                <label key={o.value} className={`flex gap-2 items-start p-2 rounded-lg cursor-pointer border ${choice === o.value ? 'border-indigo-400 bg-white' : 'border-transparent hover:bg-white/60'}`}>
                  <input type="radio" name="agenda-choice" className="mt-1" checked={choice === o.value} onChange={() => { setChoice(o.value); setChoiceNote(''); }} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{o.label}</span>
                    <span className="block text-[11px] text-gray-600 mt-0.5">{o.effect}</span>
                    {/* 🔴 이 안이 시스템에서 무엇을 바꾸는지 — 없으면 없다고 말한다 */}
                    <span className="block text-[10px] mt-1 font-mono text-gray-400">
                      {o.enact
                        ? `자동 반영: ${String((o.enact as { kind?: unknown }).kind ?? '?')}`
                        : 'enact' in o ? '자동 반영 없음(이 선택은 값을 바꾸지 않습니다)' : '자동 반영 대상 아님'}
                    </span>
                  </span>
                </label>
              ))}
              {/* 🔴 "A안을 일부 수정하여 의결" — 실제 위원회에서 가장 흔하다.
                  이 자리가 없으면 위원은 맞지 않는 안을 고르게 된다. */}
              {[CHOSEN_MODIFIED, CHOSEN_NONE_OF_ABOVE].map((v) => (
                <label key={v} className={`flex gap-2 items-center p-2 rounded-lg cursor-pointer border ${choice === v ? 'border-amber-400 bg-white' : 'border-transparent hover:bg-white/60'}`}>
                  <input type="radio" name="agenda-choice" checked={choice === v} onChange={() => setChoice(v)} />
                  <span className="text-sm text-amber-800">{CHOSEN_SPECIAL_LABEL[v]}</span>
                </label>
              ))}
            </div>
            {special && (
              <div className="mt-2">
                <label className="block text-[11px] font-medium text-amber-800 mb-1"><T k="무엇을 어떻게 정했습니까? *" /></label>
                <textarea value={choiceNote} onChange={(e) => setChoiceNote(e.target.value)} rows={2}
                  placeholder={tAttr('예: B안을 채택하되 시행 시점을 3개월 유예한다')}
                  className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm resize-y" />
                <p className="text-[10px] text-amber-700 mt-0.5">
                  🔴 원안의 자동 반영은 <b>실행되지 않습니다</b> — 의결하지 않은 것을 집행하지 않기 위함입니다.
                  필요한 반영은 아래 이행 항목·바인딩으로 따로 적으세요.
                </p>
              </div>
            )}
            {chosenDef && !special && (
              <p className="text-[10px] text-indigo-700 mt-2">
                이 안을 고르면 <b>{chosenDef.enact ? '고른 안의 반영 대상이 그대로 집행 대기로 들어갑니다' : '값을 바꾸지 않습니다(집행 항목 없음)'}</b> —
                위원이 대상을 다시 적지 않습니다.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="의결 주문 *" /></label>
          <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} placeholder={tAttr('○○를 …로 한다')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div><label className="block text-[11px] text-gray-500 mb-1"><T k="찬성" /></label><input inputMode="numeric" value={voteFor} onChange={(e) => setVoteFor(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
          <div><label className="block text-[11px] text-gray-500 mb-1"><T k="반대" /></label><input inputMode="numeric" value={voteAgainst} onChange={(e) => setVoteAgainst(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
          <div><label className="block text-[11px] text-gray-500 mb-1"><T k="기권" /></label><input inputMode="numeric" value={voteAbstain} onChange={(e) => setVoteAbstain(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
          <div><label className="block text-[11px] text-gray-500 mb-1"><T k="재검토 기한" /></label><input type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
        </div>
        {/* ── 근거 — "이 의결이 무슨 근거로 섰는가" ── */}
        <div className="border border-gray-200 rounded-xl p-3">
          <div className="flex items-baseline justify-between mb-1">
            <label className="text-[11px] font-bold text-gray-700"><T k="근거 (선택)" /></label>
            <span className="text-[10px] text-gray-400"><T k="세 갈래를 섞지 않습니다" /></span>
          </div>
          {/* 🔴 비워두는 것이 정상이다 — 강제하면 아무 문장이나 채워진다 */}
          <p className="text-[10px] text-gray-400 mb-2">
            적지 않아도 의결됩니다. 다만 <b>적지 않았다는 사실이 그대로 남습니다</b> — 나중에
            “이 값이 왜 이 값인가”를 되짚을 때 <b>근거 없음</b>으로 보입니다.
          </p>

          {regKey && legalReview.length > 0 && (
            <div className="mb-3 bg-amber-50 border border-amber-100 rounded-lg p-2">
              <p className="text-[11px] font-medium text-amber-900"><T k="이 결정의 법적 검토 항목" /></p>
              {/* 🔴 이 구분이 이 화면의 핵심이다 */}
              <p className="text-[10px] text-amber-700 mt-0.5 mb-1.5">
                이것은 <b>검토해야 할 항목</b>이지 <b>검토했다는 사실이 아닙니다.</b>
                확인한 것만 눌러서 근거로 담으세요 — 자동으로 담기지 않습니다.
              </p>
              <div className="flex flex-wrap gap-1">
                {legalReview.map((t) => {
                  const on = basis.legal.includes(t);
                  return (
                    <button key={t} type="button" onClick={() => (on ? dropBasis('legal', basis.legal.indexOf(t)) : addBasis('legal', t))}
                      className={`text-[11px] px-2 py-1 rounded-lg border text-left ${on ? 'bg-white border-emerald-300 text-emerald-800' : 'bg-white/60 border-amber-200 text-amber-900 hover:border-amber-300'}`}>
                      {on ? '✓ ' : '＋ '}{t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {BASIS_KINDS.map((k) => (
              <div key={k}>
                <label className="block text-[11px] text-gray-500">{BASIS_KIND_LABEL[k]}
                  <span className="text-[10px] text-gray-300 ml-1">{BASIS_KIND_HINT[k]}</span>
                </label>
                {basis[k].length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {basis[k].map((t, i) => (
                      <span key={`${t}-${i}`} className="text-[11px] bg-gray-100 rounded px-2 py-0.5 flex items-center gap-1">
                        {t}
                        <button type="button" onClick={() => dropBasis(k, i)} className="text-gray-400 hover:text-rose-500">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={basisDraft[k] ?? ''}
                  onChange={(e) => setBasisDraft((d) => ({ ...d, [k]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBasis(k, basisDraft[k] ?? ''); } }}
                  onBlur={() => addBasis(k, basisDraft[k] ?? '')}
                  placeholder={tAttr('입력 후 Enter')}
                  className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="이행 항목(MANUAL·선택) — 교육 시행·문구 개정 등" /></label>
          <input value={manualAction} onChange={(e) => setManualAction(e.target.value)} placeholder={tAttr('예: 전 병동 손위생 교육 시행')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        {/* 🔴 선택지가 있는 안건에서는 이 칸을 숨긴다 — 고른 선택지가 집행 대상의 정본이고,
            둘 다 보내면 서버가 거부한다. 수정 의결일 때만 다시 연다. */}
        {(!hasOptions || special) && (
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            <T k="자동 집행 바인딩(선택·JSON) — kind: CONFIG_CHANGE·GATE_MODE·FORMULARY·MASTER_DATA·TEMPLATE·ACCESS·PUBLISH·RETENTION" />
          </label>
          <textarea value={bindingsJson} onChange={(e) => setBindingsJson(e.target.value)} rows={3}
            placeholder={'예: [{"kind":"GATE_MODE","target":{"gateKey":"formulary.enforce","mapKey":"MEDICATION","mode":"WARN"}}]'}
            className={`w-full px-3 py-2 border rounded-lg text-xs font-mono resize-y ${bindingsValid ? 'border-gray-200' : 'border-rose-300 bg-rose-50'}`} />
          <p className="text-[10px] text-gray-400 mt-0.5"><T k="잘못된 바인딩(미등재 키·비멱등 op·미배선 서비스)은 서버가 의결 시점에 거부합니다. 집행은 게이트 ON+[지금 집행]/크론." /></p>
        </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={run} disabled={!resolution.trim() || !choiceReady || busy}
            className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-indigo-700">
            {busy ? '기록 중…' : '의결 기록'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
        </div>
      </div>
    </div>
  );
}
