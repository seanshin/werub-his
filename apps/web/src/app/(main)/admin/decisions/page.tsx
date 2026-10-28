'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { kdate } from '@/lib/ui-settings';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { ProposeAgendaButton } from '@/components/governance/ProposeAgendaModal';
import { BulkDecisionPanel } from './bulk-decision';
import { BulkSubmitPanel, OpenAgendaNote, isOpen as isOpenAgenda } from './bulk-submit';
import { CommitteeAuthorityAdopt } from './committee-authority-adopt';
import { DecideHeader, DecideOptions, DecideProcess, DecideSummary } from './decide-workbench';
import { Rich } from './rich';
import { DecisionImpactPreview, DecisionLogView, DevApplyChip, MECHANISM_STYLE, MechanismBadge, MechanismExplain, SettingDetailTable } from './engine-parts';
import {
  LAYER_ORDER, PATH_LABEL, GO_LIVE_LABEL, LAYER_TITLE_SHORT, STATUS_FILTER_LABEL, matchesDecisionFilter,
  type DecisionItem, type DecisionsPayload, type DecisionRecord, type Layer, type DecisionStatusFilter,
  ENACT_STYLE, matchesDecisionQuery, decisionRowState, sortDecisionRows, ROW_STATE_LABEL, ROW_STATE_STYLE,
  STAGE_NO, DIRECT_STAGE_LABEL, matchesStageFilter, type StageFilter,
} from './types';
import {
  AI_ORIGIN_TEXT, EVIDENCE_EGRESS_NOTICE, EVIDENCE_FIELD_LABEL, extractedCount,
  type EvidenceExtractResult,
  COMMITTEE_DECISION_STAGES, DECISION_DOMAINS, DECISION_STAGE_FLAG_LABEL, AGENDA_STATUS_LABEL,
  COMMITTEE_CODES, COMMITTEE_AUTHORITIES, COMMITTEE_SYSTEM_CHECKS, COMMITTEE_NOT_CHECKED, NON_COMMITTEE_AUTHORITIES,
  DECISION_MECHANISM_META,
  type CommitteeCode,
  DECISION_SUBDOMAINS, decisionSubdomainOf, decisionSubdomainMeta,
} from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 중요 사람 결정 등록부 — **결정을 화면에서 기록하되, 권한 없는 적용은 하지 않는다.**
 *
 * 사람 지시(2026-08-20): "중요 사람 결정사항은 모두 다이얼로그로 설정하는 기능으로 표현해야 하고,
 * 허가권을 가진 사람이 **법적 검토 후에** 진행되어야 한다."
 *
 * 이 화면이 지키는 것:
 *  · **근거 없이 기록되지 않는다** — 법적 검토 근거를 넣지 않으면 서버가 거부한다(fail-closed)
 *  · **선택의 결과를 고르기 전에 보여준다** — 고르고 나서 알면 늦다
 *  · 🔴 **화면이 갖지 않은 권한을 가진 척하지 않는다** — 위원회 의결 사항은 적용하지 않고 안건으로 넘긴다
 *  · 🔴 **시스템은 결정자의 직책을 검증하지 못한다** — 그 사실을 화면이 말한다
 */
/**
 * 화면 선호(보기 방식·섹션 펼침) — 🔴 사람이 남긴 결정이 아니라 **이 브라우저의 보기 습관**이다.
 *    저장소를 못 쓰면(사생활 보호 창·차단) 기본 보기로 돈다 — 실패해도 화면은 그대로 동작한다.
 */
const PREF_VIEW = 'admin.decisions.view';
const PREF_SECTIONS = 'admin.decisions.sections';
const PREF_TABS = 'admin.decisions.tabs';


/**
 * 탭 막대 — 보기(카테고리별·위원회별·층별)와 그 안의 하위 탭(영역·위원회·층)이 같은 모양을 쓴다.
 * 🔴 탭 수는 **전체 분모**(거른 뒤 수는 "표시 n/전체"로 따로) — 거른 수만 내면 남은 일이 줄어 보인다.
 */
function TabBar({ tabs, value, onChange, attr, primary = false, label }: {
  tabs: Array<{ key: string; label: ReactNode; count?: ReactNode; tone?: 'muted' }>;
  value: string; onChange: (k: string) => void; attr: string; primary?: boolean; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 overflow-x-auto border-b ${primary ? 'border-gray-300' : 'border-gray-200'}`} data-tabbar={attr}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            {...{ [`data-${attr}`]: t.key }}
            className={`min-h-[44px] shrink-0 px-3 -mb-px border-b-2 whitespace-nowrap text-left ${primary ? 'text-sm' : 'text-[12px]'} ${on
              ? `border-gray-900 font-bold text-gray-900`
              : `border-transparent ${t.tone === 'muted' ? 'text-gray-400' : 'text-gray-600'} hover:text-gray-900 hover:border-gray-300`}`}>
            {t.label}
            {t.count != null && <span className={`ml-1.5 text-[11px] tabular-nums ${on ? 'text-gray-600' : 'text-gray-400'}`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
type DecisionView = 'CATEGORY' | 'COMMITTEE' | 'LAYER' | 'LOG';
function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export default function DecisionsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [open, setOpen] = useState<DecisionItem | null>(null);
  /** 🔴 필터는 **거르기만** 한다 — 분모(전체 건수)는 항상 함께 낸다(거른 뒤 수만 보면 남은 일이 줄어 보인다) */
  const [track, setTrack] = useState<string>('ALL');
  const [status, setStatus] = useState<DecisionStatusFilter>('ALL');
  const [choice, setChoice] = useState('');
  const [legalRef, setLegalRef] = useState('');
  const [authority, setAuthority] = useState('');
  const [note, setNote] = useState('');
  /** 🔴 보기·검색·펼침은 거르기·보기만 바꾼다 — 서버 집계(분모)는 그대로 낸다 */
  const [view, setView] = useState<DecisionView>('CATEGORY');
  const [query, setQuery] = useState('');
  /** 위원회 결정 과정 단계 거르기 — 단계 띠에서 고른다(위원회 층만) */
  const [stageFilter, setStageFilter] = useState<StageFilter>('ALL');
  /** 결정 방식 거르기 — 기록하면 자동 반영·의결하면 자동 반영·위원회 의결 기록·확인 기록·개발 반영… */
  const [mech, setMech] = useState<string>('ALL');
  /** 일괄 의사결정 패널을 연 위원회 */
  const [bulkFor, setBulkFor] = useState<string | null>(null);
  /** 일괄 상정 패널을 연 위원회(일괄 의사결정과 따로 연다) */
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  /** 섹션 펼침을 사람이 바꾼 것만 담는다 — 없으면 기본(미결이 있으면 펼침) */
  const [sectionPref, setSectionPref] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** 하위 탭 — 보기마다 따로 기억한다(빈 값 = 첫 탭) */
  const [tabs, setTabs] = useState<{ CATEGORY?: string; COMMITTEE?: string; LAYER?: string }>({});
  const chooseTab = (v: DecisionView, k: string) => {
    const next = { ...tabs, [v]: k };
    setTabs(next); writePref(PREF_TABS, next);
  };
  useEffect(() => {
    const tp = readPref<Record<string, string>>(PREF_TABS, {});
    setTabs(tp && typeof tp === 'object' ? tp : {});
    const v = readPref<string>(PREF_VIEW, 'CATEGORY');
    setView(v === 'LAYER' || v === 'COMMITTEE' || v === 'LOG' ? v : 'CATEGORY');
    const sp = readPref<Record<string, boolean>>(PREF_SECTIONS, {});
    setSectionPref(sp && typeof sp === 'object' ? sp : {});
  }, []);
  const chooseView = (v: DecisionView) => {
    setView(v); writePref(PREF_VIEW, v);
    // 단계 거르기는 위원회 탭의 도구다 — 다른 보기로 가면 풀어 둔다(보이지 않는 거르기가 남으면 목록이 이유 없이 빈다)
    if (v !== 'COMMITTEE') setStageFilter('ALL');
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['human-decisions'],
    queryFn: () => apiClient.get<{ data: DecisionsPayload }>('/api/v1/admin/decisions'),
  });

  /**
   * 🔴 허가 근거 문서 업로드 — **기록 전에** 올린다(기록 시 함께 봉인된다).
   * 서버가 `pdf/jpeg/png/webp` 만 받고, 저장 경로는 서명 없이는 401 이다.
   */
  const upload = useMutation({
    mutationFn: async (p: { key: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', p.file);
      // 🔴 raw fetch 는 토큰 갱신·세션 만료 처리를 못 탄다 — 정본 클라이언트를 통과시킨다
      return apiClient.postForm(`/api/v1/admin/decisions/${p.key}/attachments`, fd);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['human-decisions'] }); toast.success('근거 문서를 첨부했습니다.'); },
    onError: (e) => toast.error((e as { message?: string })?.message ?? '첨부에 실패했습니다.'),
  });

  /**
   * 🔴 근거 문서 **판독 초안** — 개원 축과 같은 서버 정본을 부른다.
   *    저장하지 않는다. 사람이 보고 `authorityClaim`·메모에 옮겨 적는다.
   */
  const [draft, setDraft] = useState<EvidenceExtractResult | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const runExtract = async (key: string, id: string) => {
    setExtracting(id); setDraft(null);
    try {
      const r = await apiClient.post<{ data: EvidenceExtractResult }>(
        `/api/v1/admin/decisions/${key}/attachments/${id}/extract`, {},
      );
      setDraft((r as { data?: EvidenceExtractResult })?.data ?? null);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? '판독하지 못했습니다.');
    } finally { setExtracting(null); }
  };

  const save = useMutation({
    mutationFn: (p: { key: string; body: Record<string, unknown> }) =>
      apiClient.post<{ data: { record: DecisionRecord; engine?: { logged: boolean; propagatedTo: string[] } } }>(`/api/v1/admin/decisions/${p.key}/record`, p.body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['human-decisions'] });
      qc.invalidateQueries({ queryKey: ['decision-log'] });
      qc.invalidateQueries({ queryKey: ['decision-log-all'] });
      const r = res?.data?.record;
      const eng = res?.data?.engine;
      // 🔴 엔진 결과도 그대로 말한다 — 이력이 안 남았으면 그 사실을, 후행 결정이 흔들렸으면 몇 건인지
      if (eng && !eng.logged) toast.error('의사결정은 확정됐지만 결정 이력에 남기지 못했습니다 — 관리자에게 알리세요.');
      if (eng?.propagatedTo?.length) toast.warning(`이 결정에 기대는 기록된 결정 ${eng.propagatedTo.length}건이 재검토 대상이 됐습니다.`);
      // 🔴 적용됐는지를 그대로 말한다 — "저장했습니다"만 띄우면 바뀐 줄 안다
      if (r?.applied) toast.success(`의사결정을 확정하고 적용했습니다 — ${r.appliedDetail ?? ''}`);
      else toast.warning(`의사결정을 확정했습니다(적용되지 않음) — ${r?.appliedDetail ?? ''}`);
      setOpen(null);
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? '의사결정을 저장하지 못했습니다.'),
  });

  /** 재검토 확인 — 선행 결정이 바뀐 뒤 "그대로 둔다"는 근거(선택은 바꾸지 않는다) */
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const reviewConfirm = useMutation({
    mutationFn: (p: { key: string; note: string }) => apiClient.post(`/api/v1/admin/decisions/${encodeURIComponent(p.key)}/review-confirm`, { note: p.note }),
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ['human-decisions'] });
      qc.invalidateQueries({ queryKey: ['decision-log', p.key] });
      setReviewNote((m) => ({ ...m, [p.key]: '' }));
      toast.success('재검토 확인을 이력에 남겼습니다(선택은 그대로).');
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? '재검토 확인을 남기지 못했습니다.'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const payload = data?.data;
  const items = payload?.items ?? [];
  const decided = items.filter((i) => i.decided).length;
  /** 🔴 선행 조건이 모두 풀린 미결 항목 — "지금 무엇부터"의 정본 */
  const readyNow = items.filter((i) => i.readyToDecide);

  /**
   * 🔴 필터는 화면에서만 거른다 — 서버 집계(층별·개시 전 필수)는 **전체 분모**를 유지한다.
   *    거른 결과에 맞춰 요약까지 줄이면 "남은 일이 줄었다"는 거짓 안심이 생긴다.
   */
  const trackLabel = (t: string) => payload?.tracks?.[t] ?? t;
  const visible = items.filter((i) => matchesDecisionFilter(i, track, status) && matchesDecisionQuery(i, query, trackLabel(i.track)) && matchesStageFilter(i, stageFilter) && (mech === 'ALL' || i.mechanism === mech));
  /** 🔴 "지금 무엇부터"도 고른 축을 따른다 — 축을 골랐는데 목록만 전체면 두 곳이 다른 말을 한다 */
  const readyHere = track === 'ALL' ? readyNow : readyNow.filter((i) => i.track === track);
  const READY_SHOWN = 8;
  const readyShown = readyHere.slice(0, READY_SHOWN);

  const openDialog = (d: DecisionItem) => {
    setOpen(d);
    setChoice(d.record?.choice ?? '');
    setLegalRef(''); setAuthority(''); setNote('');
  };

  /**
   * 카테고리(축) 섹션 — 순서는 서버 집계(byTrack) 순. 🔴 섹션 머리 수는 **전체 항목**(items)에서 센다 —
   *    검색·상태로 거른 수로 세면 "남은 일이 줄었다"로 읽힌다. 거른 결과는 "표시 n" 으로 따로 말한다.
   */
  const trackOrder = (payload?.summary?.byTrack ?? []).map((t) => t.track);
  for (const i of items) if (!trackOrder.includes(i.track)) trackOrder.push(i.track);
  /** 영역 순서 = 결정 순서 안내(기본 설정부터) · 영역이 없는 옛 응답은 '기타'로 한 묶음 */
  const domainRolls = payload?.summary?.byDomain ?? [];
  const domainOf = (i: DecisionItem) => i.domain ?? 'OTHER';
  const domainOrder: string[] = domainRolls.length ? domainRolls.map((d) => d.domain) : DECISION_DOMAINS.map((d) => d.key);
  for (const i of items) if (!domainOrder.includes(domainOf(i))) domainOrder.push(domainOf(i));
  const domainLabel = (k: string) => domainRolls.find((d) => d.domain === k)?.label ?? DECISION_DOMAINS.find((d) => d.key === k)?.label ?? k;
  const domainDesc = (k: string) => domainRolls.find((d) => d.domain === k)?.description ?? DECISION_DOMAINS.find((d) => d.key === k)?.description ?? '';
  const domainStats = (k: string) => {
    const all = items.filter((i) => domainOf(i) === k);
    return {
      total: all.length,
      decided: all.filter((i) => i.decided).length,
      seeded: all.filter((i) => decisionRowState(i) === 'SEEDED').length,
      ready: all.filter((i) => decisionRowState(i) === 'READY').length,
      blocked: all.filter((i) => decisionRowState(i) === 'BLOCKED').length,
    };
  };
  /**
   * 영역 안 묶음 — 세부 분류(2026-10-12 사용자 "의료법인 기본설정·시스템 설정·행정 설정 …")
   * 🔴 영역을 모르는 옛 응답은 지어내지 않고 축으로 묶는다
   */
  const sectionOf = (i: DecisionItem) => (i.domain ? decisionSubdomainOf(i.key, i.track, i.layer, i.domain) : null) ?? i.track;
  const sectionOrder = [...DECISION_SUBDOMAINS.map((s) => s.key), ...trackOrder];
  const sectionLabel = (k: string) => decisionSubdomainMeta(k)?.label ?? trackLabel(k);
  const sectionDesc = (k: string) => decisionSubdomainMeta(k)?.description ?? '';
  const sectionStats = (t: string, dom?: string) => {
    const all = items.filter((i) => sectionOf(i) === t && (dom == null || domainOf(i) === dom));
    return {
      total: all.length,
      decided: all.filter((i) => i.decided).length,
      seeded: all.filter((i) => decisionRowState(i) === 'SEEDED').length,
      ready: all.filter((i) => decisionRowState(i) === 'READY').length,
      blocked: all.filter((i) => decisionRowState(i) === 'BLOCKED').length,
      goLive: all.filter((i) => i.goLive === 'REQUIRED_BEFORE' && !i.decided).length,
      undecided: all.filter((i) => !i.decided).length,
    };
  };
  /** 기본: 미결(시드 포함 — 시드는 실결정이 아니다)이 있으면 펼침 · 검색 중에는 맞는 섹션을 모두 펼침 */
  const isSectionOpen = (t: string, undecided: number) =>
    query.trim() ? true : (sectionPref[t] ?? undecided > 0);
  const toggleSection = (t: string, now: boolean) => {
    const next = { ...sectionPref, [t]: !now };
    setSectionPref(next);
    writePref(PREF_SECTIONS, next);
  };

  /** 하위 탭 — 기억한 탭이 지금 없으면(영역이 비었거나 옛 값) 첫 탭으로 */
  const domTabs = domainOrder.filter((d) => domainStats(d).total > 0);
  const catTab = tabs.CATEGORY === 'ALL' || (tabs.CATEGORY && domTabs.includes(tabs.CATEGORY)) ? tabs.CATEGORY! : (domTabs[0] ?? 'ALL');
  const domShown = catTab === 'ALL' ? domTabs : [catTab];
  const COM_TAB_KEYS: string[] = ['ALL', ...COMMITTEE_CODES, 'LICENSE_HOLDER', 'STAFF'];
  const comTab = tabs.COMMITTEE && COM_TAB_KEYS.includes(tabs.COMMITTEE) ? tabs.COMMITTEE : 'ALL';
  const layerTabs = LAYER_ORDER.filter((l) => items.some((i) => i.layer === l));
  const layerTab = tabs.LAYER === 'ALL' || (tabs.LAYER && (layerTabs as string[]).includes(tabs.LAYER)) ? tabs.LAYER! : (layerTabs[0] ?? 'ALL');
  const layerShown = layerTab === 'ALL' ? LAYER_ORDER : LAYER_ORDER.filter((l) => l === layerTab);

  /** 펼친 상세의 과정 진행 — 지난 단계 ✓ · 지금 단계 ● · 남은 단계 ○ · 다음 할 일 한 줄 · ⑦ 은 판정하지 않는다 */
  const processBlock = (d: DecisionItem) => {
    if (!d.stage || d.layer !== 'INTERNAL_COMMITTEE') return null;
    const cur = COMMITTEE_DECISION_STAGES.findIndex((x) => x.key === d.stage!.stage);
    const next = COMMITTEE_DECISION_STAGES[cur]?.nextAction;
    return (
      <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/40 px-3 py-2" data-process-block={d.key}>
        <p className="text-[11px] font-bold text-indigo-950"><T k="결정 과정" /></p>
        <ol className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
          {COMMITTEE_DECISION_STAGES.map((st, idx) => {
            const mark = st.key === 'VERIFIED' ? '·' : idx < cur ? '✓' : idx === cur ? '●' : '○';
            return (
              <li key={st.key} data-process-step={st.key} data-process-mark={mark}
                className={idx === cur ? 'font-bold text-indigo-950' : idx < cur ? 'text-emerald-800' : 'text-gray-500'}>
                {mark} {STAGE_NO[idx]} <T k={st.label} />
              </li>
            );
          })}
        </ol>
        {next && <p className="mt-1 text-[11px] text-indigo-900" data-process-next><T k="다음 할 일" />: <T k={next} /></p>}
        {d.seeded && <p className="mt-0.5 text-[11px] text-violet-800"><T k="개발 시드 기록은 의결이 아니라 단계를 앞당기지 않습니다." /></p>}
      </div>
    );
  };

  /**
   * 🔴 결정권한자 — 위원회 층은 주관·합동 위원회와 그 위원회의 의결 주체를, 다른 층은 위원회를 거치지 않는다는 사실을 말한다.
   *    정본은 shared `decision-committees`(화면이 사본을 두지 않는다).
   */
  /**
   * 🔴 결정 엔진 — 재검토 필요(선행이 바뀜)·결정이 정한 설정과 실제 값·이력 수.
   *    재검토는 **자동으로 되돌리지 않는다** — 다시 기록하거나 "그대로 둔다"를 근거와 함께 남긴다.
   */
  const engineBlock = (d: DecisionItem) => {
    const review = d.needsReview;
    const titleOf = (k: string) => items.find((x) => x.key === k)?.title ?? k;
    // 결정 방식·설정 상세는 언제나 그린다(바꾸는 설정이 없으면 없다고 말한다)
    return (
      <div className="mt-2 space-y-1.5 text-[11px]" data-engine-block={d.key}>
        {d.decided && review === null && (
          <p className="text-amber-900" data-review-unknown><T k="재검토 필요 여부를 확인하지 못했습니다(이력 조회 실패) — 필요 없다는 뜻이 아닙니다." /></p>
        )}
        {!!review?.length && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1" data-review-panel={d.key}>
            <p className="font-semibold text-amber-950"><T k="재검토 필요 — 이 결정 뒤에 선행 결정이 바뀌었습니다" /></p>
            <ul className="text-amber-900">{review.map((k) => <li key={k}>· {titleOf(k)} → {(() => { const u = items.find((x) => x.key === k); return u?.record ? (u.options.find((o) => o.value === u.record!.choice)?.label ?? u.record.choice) : '—'; })()}</li>)}</ul>
            <p className="text-amber-900"><T k="바꿔야 하면 다시 의사결정하세요. 그대로 두려면 근거를 남기세요(선택은 바뀌지 않습니다)." /></p>
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={reviewNote[d.key] ?? ''} onChange={(e) => setReviewNote((m) => ({ ...m, [d.key]: e.target.value }))}
                placeholder={tAttr('재검토 근거')} aria-label={tAttr('재검토 근거')} data-review-note={d.key}
                className="min-h-[44px] flex-1 min-w-[12rem] rounded-lg border border-amber-300 px-2.5 text-[12px] bg-white" />
              <button type="button" disabled={(reviewNote[d.key] ?? '').trim().length < 2 || reviewConfirm.isPending}
                onClick={() => reviewConfirm.mutate({ key: d.key, note: (reviewNote[d.key] ?? '').trim() })} data-review-confirm={d.key}
                className="min-h-[44px] px-3 rounded-lg bg-amber-700 text-white text-[12px] font-semibold disabled:opacity-40">
                <T k="그대로 둔다(재검토 확인)" />
              </button>
            </div>
          </div>
        )}
        <MechanismExplain mechanism={d.mechanism} />
        <div data-governed-config={d.key}>
          <p className="font-semibold text-gray-800 mb-1"><T k="설정 상세" /></p>
          <SettingDetailTable settings={d.settings} recordChoice={d.record?.choice ?? null} />
        </div>
        {d.logCount != null && d.logCount > 0 && (
          <Link href={`/admin/decisions/${encodeURIComponent(d.key)}#decision-log`} className="inline-block text-blue-700 underline underline-offset-2" data-log-link={d.key}>
            <T k="결정 경과(이력)" /> {d.logCount}<T k="건" /> →
          </Link>
        )}
      </div>
    );
  };

  const authorityBlock = (d: DecisionItem) => {
    if (d.committee) {
      // 기록(원내 채택·개발 시드)이 있으면 그 값 — 위원회별 보기와 같은 값을 그린다
      const leadRec = committeeRolls.find((r) => r.code === d.committee!.lead)?.authority?.record ?? null;
      const lead = leadRec ? { ...COMMITTEE_AUTHORITIES[d.committee.lead], ...leadRec } : COMMITTEE_AUTHORITIES[d.committee.lead];
      return (
        <div className="mt-2 text-[11px] bg-teal-50/60 border border-teal-200 rounded-lg px-3 py-2" data-authority-block={d.key}>
          <p className="font-semibold text-teal-950"><T k="결정권한자" /></p>
          <p className="text-teal-900 mt-0.5">
            <T k="주관" /> <b>{lead.name}({lead.code})</b> · <T k="위원장" /> {lead.chair} · <T k="의결" /> {lead.votingRule}
          </p>
          {d.committee.joint.length > 0 && (
            <p className="text-teal-900" data-authority-joint>
              <T k="합동(의견)" /> {d.committee.joint.map((c) => `${COMMITTEE_AUTHORITIES[c].name}(${c})`).join(' · ')}
            </p>
          )}
          {d.record?.committeeDecision && (
            <p className="text-teal-900" data-authority-resolved>
              <T k="의결" /> {d.record.committeeDecision.decisionNo} · {d.record.committeeDecision.committeeName}
            </p>
          )}
          {d.approvalPath === 'AUTHORIZED_ROLE' && (
            <p className="text-amber-900 mt-0.5"><T k="이 항목은 위원회 관할이지만 등록부가 정한 직책이 직접 의사결정한다(허가권 문장 참고)." /></p>
          )}
        </div>
      );
    }
    const nc = d.layer === 'LICENSE_HOLDER' ? NON_COMMITTEE_AUTHORITIES.LICENSE_HOLDER : d.layer === 'STAFF' ? NON_COMMITTEE_AUTHORITIES.STAFF : null;
    if (!nc) return null;
    return (
      <div className="mt-2 text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2" data-authority-block={d.key}>
        <p className="font-semibold text-gray-800"><T k="결정권한자" /> — <T k={nc.label} /></p>
        <p className="text-gray-700 mt-0.5"><T k={nc.rule} /></p>
      </div>
    );
  };

  const AUTH_SRC_LABEL: Record<string, string> = {
    RECORDED: '원내 채택 기록', DEV_SEED: '개발 시드로 확정(원내 채택 아님)', NONE: '기록 없음 — 정의만', INVALID: '기록 모양이 다름 — 정의만', UNKNOWN: '기록 확인 불가 — 정의만',
  };
  /** 위원회별 — 결정권한자 표(위원장·간사·당연직·의결 요건·확인) + 주관 결정 목록 */
  const committeeRolls = payload?.summary?.byCommittee ?? [];
  /** 위원회 한 곳의 결정권한자 — 기록(원내 채택·개발 시드)이 있으면 기록 값 · 없으면 정의 + "정의만" */
  const authorityOf = (code: CommitteeCode) => {
    const roll = committeeRolls.find((r) => r.code === code);
    const rec = roll?.authority?.record ?? null;
    const a = rec ? { ...COMMITTEE_AUTHORITIES[code], ...rec } : COMMITTEE_AUTHORITIES[code];
    const authSrc = roll?.authority === null ? 'UNKNOWN' : (roll?.authority?.source ?? 'NONE');
    return { roll, rec, a, authSrc };
  };
  /** 🔴 거르기(검색·축·상태·단계)를 하나라도 쓰고 있는가 — 전체 탭은 그때만 행을 펼쳐 보인다 */
  const filtering = !!query.trim() || track !== 'ALL' || status !== 'ALL' || stageFilter !== 'ALL' || mech !== 'ALL';

  /** 진행 막대(결정됨/전체) — 분모 0 이면 빈 막대(100% 로 그리지 않는다) */
  const progressBar = (done: number, total: number, w = 'w-20') => (
    <span className={`relative inline-block h-1.5 ${w} overflow-hidden rounded-full bg-gray-200 align-middle`} aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-full bg-sky-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </span>
  );
  const dot = (cls: string) => <span className={`h-1.5 w-1.5 rounded-full ${cls}`} aria-hidden />;
  /** 결정권한자 출처 — 점 + 글자(칩 대신) */
  const AUTH_SRC_DOT: Record<string, string> = { RECORDED: 'bg-emerald-500', DEV_SEED: 'bg-violet-500', NONE: 'bg-gray-400', INVALID: 'bg-amber-500', UNKNOWN: 'bg-amber-500' };

  /** 목록 머리(주관 결정·합동 결정) — 결정 목록 카테고리 머리와 같은 모양 */
  const listHead = (title: string, shown: number, total: number, decided: number, extra?: ReactNode) => (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-[15px] font-bold tracking-tight text-gray-900"><T k={title} /></span>
      <span className="inline-flex items-center gap-2 text-[11px] text-gray-500 tabular-nums">
        {progressBar(decided, total, 'w-16')}<T k="결정됨" /> {decided}/{total}
      </span>
      {shown < total && <span className="text-[11px] text-gray-400"><T k="표시" /> {shown}/{total}</span>}
      {extra}
    </span>
  );

  const renderCommitteeCard = (code: CommitteeCode) => {
    const { roll, rec, a, authSrc } = authorityOf(code);
    const all = items.filter((i) => i.committee?.lead === code);
    const group = sortDecisionRows(visible.filter((i) => i.committee?.lead === code));
    const jointRows = sortDecisionRows(visible.filter((i) => i.committee?.joint.includes(code)));
    const jointAllRows = items.filter((i) => i.committee?.joint.includes(code));
    const jointAll = jointAllRows.length;
    const jKey = `committee-joint:${code}`;
    const jOpen = sectionPref[jKey] ?? false;
    const decidedN = all.filter((i) => i.decided).length;
    const readyN = all.filter((i) => decisionRowState(i) === 'READY').length;
    const seededN = all.filter((i) => decisionRowState(i) === 'SEEDED').length;
    const field = (label: string, value: ReactNode, attr?: Record<string, string>, wide = false) => (
      <div className={wide ? 'sm:col-span-2 xl:col-span-3' : ''} {...attr}>
        <dt className="text-[11px] font-medium text-gray-400"><T k={label} /></dt>
        <dd className="mt-0.5 text-[13px] text-gray-900">{value}</dd>
      </div>
    );
    return (
      <section key={code} className="space-y-4" data-committee-section={code}>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xl font-extrabold tracking-tight text-slate-900">{a.name}</span>
                <span className="font-mono text-[12px] text-slate-400">{code}</span>
              </p>
              <p className="mt-0.5 text-[12px] text-slate-600"><T k={a.scope} /></p>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600 tabular-nums">
                <span className="inline-flex items-center gap-2">{progressBar(decidedN, all.length)}<T k="결정됨" /> {decidedN}/{all.length}</span>
                <span data-committee-lead-count><T k="주관" /> {all.length}</span>
                <span><T k="합동" /> {jointAll}</span>
                {readyN > 0 && <span className="inline-flex items-center gap-1">{dot('bg-emerald-500')}<T k="지금 가능" /> {readyN}</span>}
                {seededN > 0 && <span className="inline-flex items-center gap-1">{dot('bg-violet-500')}<T k="개발 시드" /> {seededN}</span>}
                {roll && roll.inProcess > 0 && <span className="inline-flex items-center gap-1 font-semibold text-indigo-800">{dot('bg-indigo-500')}<T k="심의 중" /> {roll.inProcess}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setSubmitFor(submitFor === code ? null : code); setBulkFor(null); }} aria-expanded={submitFor === code} data-bulk-submit-open={code}
                className="min-h-[44px] rounded-lg border border-sky-300 bg-white px-4 text-[12px] font-semibold text-sky-800 shadow-sm hover:bg-sky-50">
                <T k="일괄 상정" />
              </button>
              <button type="button" onClick={() => { setBulkFor(bulkFor === code ? null : code); setSubmitFor(null); }} aria-expanded={bulkFor === code} data-bulk-open={code}
                className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-[12px] font-semibold text-white shadow-sm hover:bg-indigo-700">
                <T k="일괄 의사결정" />
              </button>
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:grid-cols-2 xl:grid-cols-3" data-committee-authority={code}>
            {field('위원장', a.chair)}
            {field('간사(안건 접수·회의 배정)', a.secretary)}
            {field('확인 담당(⑦)', a.verifier)}
            {field('당연직 위원', a.exOfficio.join(' · '), undefined, true)}
            {field('의결 요건', a.votingRule, undefined, true)}
            {field('명부', roll?.roster == null
              ? <span className="text-amber-900"><T k="확인 불가" /></span>
              : <>
                  <T k="임명" /> {roll.roster.manual} · <T k="시드" /> {roll.roster.seed}
                  {!roll.roster.chairAppointed && <span className="text-amber-900"> · <T k="위원장 임명 기록 없음" /></span>}
                </>, { 'data-committee-roster': code }, true)}
          </dl>
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600" data-committee-authority-source={authSrc}>
            {dot(AUTH_SRC_DOT[authSrc] ?? 'bg-gray-400')}<T k={AUTH_SRC_LABEL[authSrc]} />
            {rec && <span className="text-gray-400">· {rec.basisRef}</span>}
          </p>
          {authSrc !== 'UNKNOWN' && <CommitteeAuthorityAdopt code={code} a={a} />}
        </div>
        {submitFor === code && <BulkSubmitPanel code={code} items={items} onClose={() => setSubmitFor(null)} />}
        {bulkFor === code && <BulkDecisionPanel code={code} items={items} onClose={() => setBulkFor(null)} />}
        <div className="space-y-2">
          <div className="px-2 py-1">{listHead('주관 결정', group.length, all.length, decidedN)}</div>
          {group.length ? <ul className="space-y-2">{group.map(renderRow)}</ul>
            : <p className="text-[11px] text-gray-500 px-2"><T k="고른 조건에 맞는 항목이 없습니다" /></p>}
        </div>
        {jointAll > 0 && (
          <div className="space-y-2" data-committee-joint-list={code}>
            <button type="button" onClick={() => toggleSection(jKey, jOpen)} aria-expanded={jOpen}
              className="w-full min-h-[44px] flex items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-gray-100/70">
              <span className={`text-[9px] text-gray-400 transition-transform ${jOpen ? 'rotate-90' : ''}`} aria-hidden>▶</span>
              {listHead('합동으로 의견을 내는 결정', jointRows.length, jointAll, jointAllRows.filter((i) => i.decided).length)}
            </button>
            {jOpen && (jointRows.length ? <ul className="space-y-2">{jointRows.map(renderRow)}</ul>
              : <p className="text-[11px] text-gray-500 px-2"><T k="고른 조건에 맞는 항목이 없습니다" /></p>)}
          </div>
        )}
      </section>
    );
  };

  const renderNonCommittee = (layer: 'LICENSE_HOLDER' | 'STAFF') => {
    const nc = NON_COMMITTEE_AUTHORITIES[layer];
    const all = items.filter((i) => i.layer === layer);
    const group = sortDecisionRows(visible.filter((i) => i.layer === layer));
    const decidedN = all.filter((i) => i.decided).length;
    return (
      <section key={layer} className="space-y-4" data-committee-non={layer}>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
          <p className="text-xl font-extrabold tracking-tight text-slate-900"><T k={nc.label} /></p>
          <p className="mt-0.5 text-[12px] text-slate-600">{nc.holders.map((h) => tAttr(h)).join(' · ')}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600 tabular-nums">
            <span className="inline-flex items-center gap-2">{progressBar(decidedN, all.length)}<T k="결정됨" /> {decidedN}/{all.length}</span>
            <span className="inline-flex items-center gap-1 text-amber-900">{dot('bg-amber-500')}<T k={nc.rule} /></span>
          </p>
          <p className="mt-1 text-[11px] text-gray-500"><T k="위원회를 거치지 않습니다 — 해당 권한자가 이 화면에서 의사결정합니다." /></p>
        </div>
        {group.length ? <ul className="space-y-2">{group.map(renderRow)}</ul>
          : <p className="text-[11px] text-gray-500 px-2"><T k="고른 조건에 맞는 항목이 없습니다" /></p>}
      </section>
    );
  };

  /**
   * 위원회별 — 전체 탭은 위원회 한 줄 요약(누르면 그 위원회 탭) · 거르는 중이면 맞는 행을 그 아래에.
   * 위원회 탭은 결정권한자 카드 + 주관 결정 + 합동 결정(접힘). 허가권자·직원은 위원회를 거치지 않는다고 말한다.
   * 2026-10-11 결정 목록과 같은 모양으로 정돈(사용자 "위원회별 탭 화면도 같은 스타일로").
   */
  const renderCommitteeView = (tab: string) => (
    <div className="space-y-4" data-committee-view>
      <details className="rounded-xl border border-teal-100 bg-teal-50/40 px-4 py-2 text-[11px] text-teal-950" data-committee-caveat>
        <summary className="cursor-pointer min-h-[32px] flex items-center gap-2 font-medium">
          {dot('bg-teal-500')}<T k="위원회 결정권한자 — 개발 시드로 확정해 두었습니다(실채택 아님). 원내 위원회 규정(헌장) 번호로 다시 기록해야 채택입니다." />
        </summary>
        <div className="mt-1 space-y-0.5 pb-1">
          <p><T k="시스템이 검사하는 것" />: {COMMITTEE_SYSTEM_CHECKS.map((x) => tAttr(x)).join(' · ')}</p>
          <p className="text-amber-900"><T k="시스템이 검사하지 않는 것" />: {COMMITTEE_NOT_CHECKED.map((x) => tAttr(x)).join(' · ')}</p>
        </div>
      </details>
      {tab === 'LICENSE_HOLDER' || tab === 'STAFF' ? renderNonCommittee(tab)
        : tab !== 'ALL' ? renderCommitteeCard(tab as CommitteeCode)
        : (
          <ul className="space-y-2" data-committee-overview>
            {COMMITTEE_CODES.map((code: CommitteeCode) => {
              const { roll, a, authSrc } = authorityOf(code);
              const all = items.filter((i) => i.committee?.lead === code);
              const group = sortDecisionRows(visible.filter((i) => i.committee?.lead === code));
              const decidedN = all.filter((i) => i.decided).length;
              return (
                <li key={code} className="space-y-2" data-committee-overview-row={code}>
                  <button type="button" onClick={() => chooseTab('COMMITTEE', code)}
                    className="group w-full min-h-[44px] flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200/80 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:shadow-sm">
                    <span className="min-w-[14rem] flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[15px] font-bold text-gray-900">{a.name}</span>
                        <span className="font-mono text-[11px] text-gray-400">{code}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
                        <span><T k="위원장" /> {a.chair}</span><span className="text-gray-300">·</span>
                        <span><T k="간사(안건 접수·회의 배정)" /> {a.secretary}</span><span className="text-gray-300">·</span>
                        <span className="inline-flex items-center gap-1">{dot(AUTH_SRC_DOT[authSrc] ?? 'bg-gray-400')}<T k={AUTH_SRC_LABEL[authSrc]} /></span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-3 text-[11px] text-gray-600 tabular-nums">
                      {roll && roll.inProcess > 0 && <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-900"><T k="심의 중" /> {roll.inProcess}</span>}
                      <span className="inline-flex items-center gap-2">{progressBar(decidedN, all.length)}<T k="결정됨" /> {decidedN}/{all.length}</span>
                      {filtering && <span className="text-gray-500"><T k="표시" /> {group.length}</span>}
                      <span className="text-lg leading-none text-gray-300 group-hover:text-gray-500" aria-hidden>›</span>
                    </span>
                  </button>
                  {filtering && group.length > 0 && <ul className="space-y-2 pl-2 sm:pl-4">{group.map(renderRow)}</ul>}
                </li>
              );
            })}
            {(['LICENSE_HOLDER', 'STAFF'] as const).map((layer) => {
              const lr = items.filter((i) => i.layer === layer);
              const dn = lr.filter((i) => i.decided).length;
              return (
                <li key={layer}>
                  <button type="button" onClick={() => chooseTab('COMMITTEE', layer)} data-committee-non={layer}
                    className="group w-full min-h-[44px] flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-4 py-3 text-left transition hover:border-gray-400">
                    <span className="min-w-[14rem] flex-1">
                      <span className="block text-[15px] font-bold text-gray-800"><T k={NON_COMMITTEE_AUTHORITIES[layer].label} /></span>
                      <span className="mt-1 block text-[11px] text-amber-900"><T k={NON_COMMITTEE_AUTHORITIES[layer].rule} /></span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[11px] text-gray-600 tabular-nums">
                      <span className="inline-flex items-center gap-2">{progressBar(dn, lr.length)}<T k="결정됨" /> {dn}/{lr.length}</span>
                      <span className="text-lg leading-none text-gray-300 group-hover:text-gray-500" aria-hidden>›</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );

  /** 행 메타 줄의 단계 글자 — 위원회 층은 ①~⑦ · 다른 층은 짧은 경로 · 연결 안건·조회 실패·표식을 함께 */
  const stageText = (d: DecisionItem) => {
    if (!d.stage) return null;
    const idx = COMMITTEE_DECISION_STAGES.findIndex((x) => x.key === d.stage!.stage);
    const committee = d.layer === 'INTERNAL_COMMITTEE';
    const label = committee ? COMMITTEE_DECISION_STAGES[idx]?.label : (DIRECT_STAGE_LABEL[d.stage.stage] ?? COMMITTEE_DECISION_STAGES[idx]?.label);
    const flags = d.stage.flags.filter((f) => f !== 'SEEDED' && f !== 'BLOCKED');
    const ag = d.agenda;
    return (
      <span className="text-indigo-700" data-row-stage={d.stage.stage}>
        {committee ? `${STAGE_NO[idx] ?? ''} ` : ''}<T k={label ?? d.stage.stage} />
        {committee && ag && ag !== 'UNKNOWN' && <span data-row-agenda={ag.status}> · {ag.committee?.name ?? ''} <T k={AGENDA_STATUS_LABEL[ag.status] ?? ag.status} /></span>}
        {committee && ag === 'UNKNOWN' && <span className="text-amber-700" data-row-agenda-unknown> · <T k="안건 확인 불가" /></span>}
        {flags.map((f) => <span key={f} className="text-amber-700"> · <T k={DECISION_STAGE_FLAG_LABEL[f]} /></span>)}
      </span>
    );
  };

  /**
   * 한 줄 요약 행(2026-10-11 정돈 — 사용자 "표현이 좀 더 세련되고 깔끔하게") — 펼치면 종전 카드 내용 그대로(renderDetail).
   *   왼쪽: 제목(등록부 **강조** 그대로 굵게) + 흐린 메타 한 줄(층 · 결정 방식 · 주관 위원회 · 과정 단계)
   *   오른쪽: 주의 표시(재검토·설정 다름·개시 전 필수) · 상태 하나 · 의사결정 · 설명자료
   *   🔴 정보는 줄이지 않는다 — 칩 8개를 메타 줄 글자로 옮겼을 뿐이다.
   */
  const renderRow = (d: DecisionItem) => {
    const st = decisionRowState(d);
    const isOpen = !!expanded[d.key];
    const seededLabel = st === 'SEEDED' && d.record
      ? (d.options.find((o) => o.value === d.record!.choice)?.label ?? d.record.choice)
      : null;
    const sep = <span className="text-gray-300" aria-hidden>·</span>;
    return (
      <li key={d.key} data-decision-row={d.key} data-decision-state={st}
        className={`group rounded-xl border bg-white transition hover:border-gray-300 hover:shadow-sm ${isOpen ? 'border-gray-300 shadow-sm' : 'border-gray-200/80'}`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <button type="button" onClick={() => setExpanded((e) => ({ ...e, [d.key]: !isOpen }))} aria-expanded={isOpen}
            className="min-h-[44px] flex-1 min-w-[16rem] text-left flex items-start gap-3">
            <span className={`mt-[5px] text-[9px] text-gray-300 transition-transform group-hover:text-gray-500 ${isOpen ? 'rotate-90' : ''}`} aria-hidden>▶</span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-snug text-gray-900"><Rich text={d.title} /></span>
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500" data-row-meta>
                <span data-decision-layer={d.layer}><T k={LAYER_TITLE_SHORT[d.layer]} /></span>
                {d.mechanism && <>{sep}<MechanismBadge mechanism={d.mechanism} variant="text" /></>}
                {d.committee && <>{sep}<span className="text-teal-700" data-row-committee={d.committee.lead} title={tAttr('주관 위원회')}>
                  {COMMITTEE_AUTHORITIES[d.committee.lead].name}{d.committee.joint.length ? ` +${d.committee.joint.length}` : ''}</span></>}
                {d.stage && <>{sep}{stageText(d)}</>}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!!d.needsReview?.length && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900" data-row-review><T k="재검토 필요" /></span>
            )}
            <DevApplyChip dev={d.devApply} />
            {d.governedConfig?.some((g) => !g.matches) && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-900" data-row-drift><T k="설정이 결정과 다름" /></span>
            )}
            {d.goLive === 'REQUIRED_BEFORE' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700" data-decision-golive>
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden /><T k={GO_LIVE_LABEL.REQUIRED_BEFORE} />
              </span>
            )}
            <span className={`max-w-[15rem] truncate rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ROW_STATE_STYLE[st]}`} data-decision-badge={st}
              title={seededLabel ? tAttr('개발 시드 — 실결정 아님') + ': ' + seededLabel : undefined}>
              {st === 'SEEDED'
                ? <Tf k="개발 시드: {선택}" params={{ 선택: seededLabel ?? '' }} />
                : <T k={ROW_STATE_LABEL[st]} />}
            </span>
            <button type="button" onClick={() => openDialog(d)} disabled={d.approvalPath === 'PER_EVENT_DIALOG'}
              title={d.approvalPath === 'PER_EVENT_DIALOG' ? tAttr('업무 화면의 승인 다이얼로그에서 건별로 이뤄집니다') : undefined}
              data-decision-record-btn={d.key}
              className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-[12px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300">
              <T k="의사결정" />
            </button>
            <Link href={`/admin/decisions/${encodeURIComponent(d.key)}`} className="min-h-[44px] inline-flex items-center rounded-lg px-2 text-[12px] text-gray-500 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap">
              <T k="설명자료" />
            </Link>
          </div>
        </div>
        {isOpen && <div className="border-t border-gray-100 px-4 pb-4" data-decision-detail={d.key}>{renderDetail(d)}</div>}
      </li>
    );
  };

  /** 종전 카드 본문 — 🔴 기능을 줄이지 않는다(위원회 상정·이행 상태·기록·선행 조건·근거 화면) */
  const renderDetail = (d: DecisionItem) => {
    const p = PATH_LABEL[d.approvalPath];
    return (
      <div className="pt-3">
        {processBlock(d)}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-gray-400 mt-0.5">
              {payload?.tracks?.[d.track] && (
                <span className="mr-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">{payload.tracks[d.track]}</span>
              )}
              <code>{d.key}</code> · <T k="허가권" /> <b>{d.authority}</b>
              {d.blocks && <> · <T k="막고 있는 것:" /> {d.blocks}</>}
            </p>
          </div>
          <span title={tAttr(p.note)} aria-label={`${d.title} ${p.label}`}
            className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border bg-gray-50 text-gray-700 border-gray-200 whitespace-nowrap">
            <T k={p.label} />
          </span>
        </div>

        <p className="text-xs text-gray-700 mt-2">{d.why}</p>

        {d.legalReview.length > 0 && (
          <div className="mt-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <p className="font-medium text-gray-700 mb-1"><T k="결정 전 검토할 것" /></p>
            <ul className="list-disc pl-4 space-y-0.5">
              {d.legalReview.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}

        {/*
          🔴 위원회 결정은 **이 화면이 집행하지 않는다** — 안건으로 올려야 한다.
             그 사실을 문구로만 적어두면 다음 단계가 사람 기억에 남는다(그래서 버튼을 여기 둔다).
             서버·모달·타입은 이미 `DECISION` 출처를 지원하는데 버튼만 렌더되지 않고 있었다
             (import 는 있고 사용처는 0 — 2026-08-27 실측).
        */}
        {authorityBlock(d)}
        {d.committee && (d.approvalPath === 'COMMITTEE' || d.approvalPath === 'CODE_CHANGE') && (
          <div className="mt-2 flex items-center gap-2">
            {/* 같은 결정의 안건은 하나 — 열려 있으면 단추 대신 진행 상태(서버도 409) */}
            {isOpenAgenda(d)
              ? <OpenAgendaNote d={d} />
              : (
                <ProposeAgendaButton
                  sourceRef={{ type: 'DECISION', key: d.key }}
                  committeeCodes={[d.committee.lead, ...d.committee.joint]}
                  defaultTitle={d.title}
                  defaultBody={d.why}
                  label={d.decided ? tAttr('위원회 재상정') : tAttr('위원회 상정')}
                />
              )}
            <span className="text-[11px] text-gray-500">
              {d.decided
                ? <T k="의사결정은 있으나 의결이 있어야 반영된다" />
                : <T k="이 화면의 의사결정은 의결이 아니다 — 안건으로 올려야 한다" />}
            </span>
          </div>
        )}

        {/* 🔴 이행 상태 — 기록됨과 반영됨을 가른다(같은 색으로 접지 않는다) */}
        {d.enactment && d.enactment.state !== 'UNDECIDED' && (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] ${ENACT_STYLE[d.enactment.state]}`}>
            <b>{d.enactment.label}</b>
            {d.enactment.detail && <span className="ml-1">— {d.enactment.detail}</span>}
            {d.enactment.actions.length > 0 && (
              <ul className="mt-1 space-y-0.5 font-mono text-[10px] opacity-80">
                {d.enactment.actions.map((a, i) => (
                  <li key={i}>
                    {a.kind} · {a.status}
                    {a.enactedAt && ` · ${kdate(a.enactedAt, 'datetimeSec')}`}
                    {a.error && ` · ${a.error}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {engineBlock(d)}

        {/* 현재 기록 — 🔴 없으면 "미결"이라 말한다 */}
        <div className="mt-2 text-[11px]">
          {d.record ? (
            <div className="text-gray-700">
              {d.seeded && (
                <span className="mr-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800" data-decision-seeded={d.key}>
                  <T k="개발 시드 — 실결정 아님" />
                </span>
              )}
              <T k="의사결정:" /> <b>{d.options.find((o) => o.value === d.record!.choice)?.label ?? d.record.choice}</b>
              {' · '}{kdate(d.record.decidedAt, 'datetimeSec')}
              {' · '}<T k="권한 근거" /> {d.record.authorityClaim}
              {' · '}<T k="법적 근거" /> {d.record.legalReviewRef}
              {/*
                🔴 `record.applied` **불리언으로 말하지 않는다**(2026-08-27).
                   그 두 갈래에서는 **집행 실패도 "기록만"(주황)** 으로 보였다 —
                   실패가 양성으로 읽힌다. 이행 상태(5종)에서 파생시킨다.
              */}
              <span className={
                d.enactment?.state === 'FAILED' ? 'font-bold text-red-700'
                : d.enactment?.state === 'ENACTED' ? 'text-emerald-700'
                : d.enactment?.state === 'MANUAL_CONFIRMED' ? 'text-sky-700'
                : 'text-amber-800'
              }>
                {' · '}<T k={d.enactment?.label ?? (d.record.applied ? '적용됨' : '기록만')} />
              </span>
              {d.record.appliedDetail && <span className="text-gray-500"> ({d.record.appliedDetail})</span>}
              {d.record.attachments?.length ? (
                <span className="block mt-0.5">
                  <T k="근거 문서:" /> {d.record.attachments.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline mr-2">📎 {a.fileName}</a>
                  ))}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-amber-800"><T k="아직 결정되지 않았습니다 — 현재 동작은 기본값이며" /> <b><T k="결정이 아닙니다" /></b>.</span>
          )}
        </div>

        {/* 🔴 상위 층이 막고 있으면 그 사실을 그 자리에서 말한다 — 기록해도 적용되지 않는다 */}
        {d.blockedBy?.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <T k="상위 층 선행 조건이 충족되지 않아" /> <b><T k="의사결정해도 적용되지 않습니다" /></b>:{' '}
            {d.blockedBy.map((b) => `${b.title}(${b.reason})`).join(' · ')}
          </p>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => openDialog(d)} disabled={d.approvalPath === 'PER_EVENT_DIALOG'}
            title={d.approvalPath === 'PER_EVENT_DIALOG' ? tAttr('업무 화면의 승인 다이얼로그에서 건별로 이뤄집니다') : undefined}
            className="min-h-[44px] px-3 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {d.approvalPath === 'PER_EVENT_DIALOG' ? <T k="업무 화면에서 결정" /> : d.record ? <T k="다시 의사결정" /> : <T k="의사결정" />}
          </button>
          {d.drillDown && (
            <Link href={d.drillDown} className="text-xs text-blue-600 hover:underline"><T k="근거 화면 보기" /></Link>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="중요 결정" /></h1>
        <p className="text-xs text-gray-500 mt-1">
          시스템이 사람의 결정을 기다리는 항목입니다. 각 항목은 <b>법적 검토 근거</b>와 <b>허가권 근거</b>를
          함께 기록해야 저장됩니다. 항목을 열면 <b>설명자료</b>(검토 요청서·안건 자료)를 인쇄할 수 있습니다.
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse"><T k="불러오는 중…" /></div>
      ) : (
        <>
          {/* 🔴 층별로 따로 낸다 — 합쳐 하나의 퍼센트로 내면 "위원회가 다 의결했으니 90%" 같은 거짓 안심이 생긴다 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(payload?.summary?.byLayer ?? []).map((r) => (
              <div key={r.layer} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-[11px] font-bold text-gray-500"><T k={LAYER_TITLE_SHORT[r.layer]} /></p>
                <p className="text-lg font-extrabold text-gray-900 mt-0.5 tabular-nums">
                  {r.decided}<span className="text-sm font-bold text-gray-400">/{r.total}</span>
                  <span className="ml-1.5 text-[11px] font-medium text-gray-500"><T k="결정됨" /></span>
                </p>
                <p className="text-[11px] mt-0.5">
                  {r.readyToDecide > 0 && <span className="text-emerald-700 font-semibold"><T k="지금 가능" /> {r.readyToDecide}</span>}
                  {r.readyToDecide > 0 && r.blocked > 0 && <span className="text-gray-300"> · </span>}
                  {r.blocked > 0 && <span className="text-amber-800 font-semibold"><T k="선행 대기" /> {r.blocked}</span>}
                  {r.readyToDecide === 0 && r.blocked === 0 && <span className="text-gray-400"><T k="대기 항목 없음" /></span>}
                </p>
              </div>
            ))}
          </div>

          {/* 🔴 실서비스 개시 전 반드시 필요한 것 — go-live 관제와 같은 축 */}
          {payload?.summary?.goLiveRequired && payload.summary.goLiveRequired.total > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5">
              <span className="text-[12px] font-bold text-rose-900">
                <T k="실서비스 개시 전 반드시 필요한 결정" />{' '}
                {payload.summary.goLiveRequired.decided}/{payload.summary.goLiveRequired.total}건 <T k="완료" />
              </span>
              <Link href="/admin/go-live" className="text-[11px] text-rose-700 underline underline-offset-2"><T k="개시 관제(3140)에서 전체 보기 →" /></Link>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">
              결정 대상 <b>{items.length}</b>건 중 기록됨 <b>{decided}</b>건
            </span>
            {(payload?.summary.seeded ?? 0) > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-800" data-decisions-seeded>
                <Tf k="개발 시드 {수}건 — 결정 수에 넣지 않음(실제 의사결정이 필요함)" params={{ 수: payload!.summary.seeded! }} />
              </span>
            )}
            {payload?.summary?.engine && (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700" data-engine-summary
                title={tAttr('결정에 묶인 설정을 설정 화면에서 바꿀 때 — OFF 기록 안 함 · WARN 허용하고 기록 · BLOCK 실결정이 정한 값과 다르면 막음')}>
                <T k="설정 보호" /> <b>{payload.summary.engine.protectionMode ?? tAttr('확인 불가')}</b>
                {' · '}<T k="재검토 필요" /> <b data-engine-review>{payload.summary.engine.reviewNeeded ?? tAttr('확인 불가')}</b>
                {' · '}<T k="설정이 결정과 다름" /> <b data-engine-drift>{payload.summary.engine.configDrift}</b>
              </span>
            )}
            {payload?.measuredAt && <span className="text-gray-400"><T k="기준" /> {kdate(payload.measuredAt, 'datetimeSec')}</span>}
          </div>
          {payload?.caveat && (
            <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">※ {payload.caveat}</p>
          )}
          {/* 결정 방식 — 누르면 그 방식만(전체 분모 · 기록 수/전체) */}
          {!!payload?.summary?.byMechanism?.length && (
            <div className="flex flex-wrap items-center gap-1.5" data-mechanism-summary>
              <span className="text-[11px] font-semibold text-gray-500"><T k="결정 방식" /></span>
              {payload.summary.byMechanism.map((m) => (
                <button key={m.mechanism} type="button" onClick={() => setMech(mech === m.mechanism ? 'ALL' : m.mechanism)} aria-pressed={mech === m.mechanism}
                  data-mechanism-chip={m.mechanism} title={tAttr(DECISION_MECHANISM_META[m.mechanism].effect)}
                  className={`min-h-[32px] px-2 py-1 rounded-lg border text-[11px] ${mech === m.mechanism ? 'ring-2 ring-gray-900 ' : ''}${MECHANISM_STYLE[m.mechanism] ?? ''}`}>
                  {DECISION_MECHANISM_META[m.mechanism].auto ? '⚙ ' : ''}<T k={DECISION_MECHANISM_META[m.mechanism].label} />{' '}
                  <span className="tabular-nums opacity-80">{m.decided}/{m.total}</span>
                </button>
              ))}
            </div>
          )}

          {/* 🔴 지금 결정할 수 있는 것을 맨 위에 — 사람은 "무엇부터"를 알아야 움직인다 */}
          {readyHere.length > 0 && (
            <details className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5" data-ready-panel>
              <summary className="min-h-[32px] cursor-pointer text-sm font-bold text-emerald-900">
                <T k="지금 의사결정할 수 있는 항목" /> {readyHere.length}건
                {track !== 'ALL' && <span className="ml-1 text-[11px] font-medium text-emerald-800">({payload?.tracks?.[track] ?? track} <T k="축" /> · <T k="전체" /> {readyNow.length}건)</span>}
              </summary>
              <p className="text-[11px] text-emerald-800 mt-0.5"><T k="선행 조건이 모두 풀려 있어 오늘 의사결정할 수 있습니다." /></p>
              <ul className="mt-2 space-y-1.5">
                {readyShown.map((d) => (
                  <li key={d.key} className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] text-gray-900"><Rich text={d.title} /></span>
                    <span className="text-[10px] text-gray-500">{d.authority}</span>
                    <Link href={`/admin/decisions/${encodeURIComponent(d.key)}`}
                      className="text-[11px] font-semibold text-emerald-800 underline underline-offset-2"><T k="설명자료" /></Link>
                  </li>
                ))}
              </ul>
              {/* 🔴 자르면 잘랐다고 말한다 — 나머지가 어디에 있는지까지 */}
              {readyHere.length > readyShown.length && (
                <p className="mt-1.5 text-[11px] text-emerald-900">
                  <T k="외" /> {readyHere.length - readyShown.length}건 — {view === 'LAYER'
                    ? <T k="아래 층별 목록에 전부 있습니다(축·상태로 좁혀 보세요)." />
                    : <T k="아래 카테고리별 목록에 전부 있습니다(검색·상태로 좁혀 보세요)." />}
                </p>
              )}
            </details>
          )}

          {/*
            🔴 보기 탭 → 하위 탭(영역·위원회·층) → 거르기(검색·축·상태). 축 라벨은 **서버(등록부)가 준다**.
               🔴 거른 뒤에도 전체 분모를 함께 낸다 — 탭 수도 전체 분모다.
          */}
          <TabBar primary attr="decision-view" label={tAttr('보기')} value={view} onChange={(k) => chooseView(k as DecisionView)}
            tabs={(['CATEGORY', 'COMMITTEE', 'LAYER', 'LOG'] as const).map((v) => ({
              key: v,
              label: <T k={v === 'CATEGORY' ? '카테고리별' : v === 'COMMITTEE' ? '위원회별' : v === 'LAYER' ? '층별' : '결정 이력'} />,
              ...(v === 'LOG' && payload?.summary?.engine?.logTotal != null ? { count: payload.summary.engine.logTotal } : {}),
            }))} />

          {view === 'LOG' && <DecisionLogView items={items} />}

          {view !== 'LOG' && <div className="flex flex-wrap items-center gap-1.5">
            <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" data-decision-search
              placeholder={tAttr('제목·키·허가권 검색')} aria-label={tAttr('제목·키·허가권 검색')}
              className="min-h-[36px] w-56 max-w-full px-2.5 py-1 rounded-lg border border-gray-200 text-[12px]" />
            <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label={tAttr('축')} data-decision-track
              className="min-h-[36px] max-w-full px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white">
              <option value="ALL">{tAttr('축 전체')} ({items.length})</option>
              {(payload?.summary?.byTrack ?? []).map((t) => (
                <option key={t.track} value={t.track}>{t.label} — {t.decided}/{t.total}{t.readyToDecide > 0 ? ` · ${tAttr('지금 가능')} ${t.readyToDecide}` : ''}</option>
              ))}
            </select>
            <select value={mech} onChange={(e) => setMech(e.target.value)} aria-label={tAttr('결정 방식')} data-decision-mechanism
              className="min-h-[36px] max-w-full px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white">
              <option value="ALL">{tAttr('결정 방식 전체')}</option>
              {(payload?.summary?.byMechanism ?? []).map((m) => (
                <option key={m.mechanism} value={m.mechanism}>{DECISION_MECHANISM_META[m.mechanism].auto ? '⚙ ' : ''}{tAttr(DECISION_MECHANISM_META[m.mechanism].label)} — {m.decided}/{m.total}</option>
              ))}
            </select>
            {(['ALL', 'READY', 'BLOCKED', 'DECIDED'] as const).map((v) => (
              <button key={v} onClick={() => setStatus(v)} aria-pressed={status === v}
                className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-medium border ${status === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                <T k={STATUS_FILTER_LABEL[v]} />
              </button>
            ))}
            <span className="text-[11px] text-gray-500 ml-1" data-decision-shown>
              <T k="표시" /> <b className="tabular-nums">{visible.length}</b>
              <span className="text-gray-400"> / {items.length}</span>
            </span>
          </div>}

          {view !== 'LOG' && visible.length === 0 && (
            <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2" data-decision-none>
              <T k="고른 조건에 맞는 항목이 없습니다" /> — <T k="전체" /> {items.length}건.
            </p>
          )}

          {view === 'CATEGORY' && (
            <TabBar attr="domain-tab" label={tAttr('영역')} value={catTab} onChange={(k) => chooseTab('CATEGORY', k)}
              tabs={[
                ...domTabs.map((d, i) => {
                  const ds = domainStats(d);
                  const shown = visible.filter((x) => domainOf(x) === d).length;
                  return { key: d, label: <>{i + 1}. <T k={domainLabel(d)} /></>, count: shown < ds.total ? `${shown}/${ds.total}` : ds.total, tone: shown === 0 ? 'muted' as const : undefined };
                }),
                { key: 'ALL', label: <T k="전체" />, count: items.length },
              ]} />
          )}
          {view === 'CATEGORY' && domShown.map((dom) => {
            const di = domTabs.indexOf(dom);
            const domVisible = visible.filter((i) => domainOf(i) === dom);
            const ds = domainStats(dom);
            if (!ds.total) return null;
            const tracksHere = sectionOrder.filter((t) => domVisible.some((i) => sectionOf(i) === t));
            return (
              <section key={dom} className="space-y-2" data-decision-domain={dom}>
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-3.5">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white tabular-nums">{di + 1}</span>
                    <span className="text-lg font-extrabold tracking-tight text-slate-900">{domainLabel(dom)}</span>
                    <span className="text-[11px] text-slate-600 tabular-nums" data-domain-decided><T k="결정됨" /> {ds.decided}/{ds.total}</span>
                    {ds.ready > 0 && <span className="text-[11px] font-semibold text-emerald-700"><T k="지금 가능" /> {ds.ready}</span>}
                    {ds.blocked > 0 && <span className="text-[11px] font-semibold text-amber-800"><T k="선행 대기" /> {ds.blocked}</span>}
                    {ds.seeded > 0 && <span className="text-[11px] font-semibold text-violet-800"><T k="개발 시드" /> {ds.seeded}</span>}
                    {domVisible.length < ds.total && <span className="text-[11px] text-slate-500"><T k="표시" /> {domVisible.length}/{ds.total}</span>}
                  </p>
                  {domainDesc(dom) && <p className="text-[11px] text-slate-600 mt-0.5"><T k={domainDesc(dom)} /></p>}
                  {di === 0 && dom === 'FOUNDATION' && (
                    <p className="text-[11px] text-slate-700 mt-1" data-domain-order-guide><T k="결정 순서 — 기본 설정부터 정하면 그 위의 의료·운영·행정 결정이 풀립니다." /></p>
                  )}
                </div>
                {domVisible.length === 0 && (
                  <p className="text-[11px] text-gray-500 px-1"><T k="이 영역에는 고른 조건에 맞는 항목이 없습니다" /></p>
                )}
                {tracksHere.map((t) => {
                  const group = sortDecisionRows(domVisible.filter((i) => sectionOf(i) === t));
                  if (!group.length) return null;
                  const st = sectionStats(t, dom);
                  const secKey = `${dom}:${t}`;
                  const isOpen = isSectionOpen(secKey, st.undecided);
                  return (
                    <div key={secKey} className="space-y-2 pl-1 sm:pl-3" data-decision-section={t} data-decision-section-domain={dom}>
                      <button type="button" onClick={() => toggleSection(secKey, isOpen)} aria-expanded={isOpen}
                        className="group w-full min-h-[44px] flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 text-left hover:bg-gray-100/70">
                        <span className={`text-[9px] text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden>▶</span>
                        <span className="text-[15px] font-bold tracking-tight text-gray-900" data-section-label>{decisionSubdomainMeta(t) ? <T k={sectionLabel(t)} /> : trackLabel(t)}</span>
                        {sectionDesc(t) && <span className="hidden text-[11px] text-gray-400 lg:inline"><T k={sectionDesc(t)} /></span>}
                        <span className="inline-flex items-center gap-2 text-[11px] text-gray-500 tabular-nums" data-section-decided>
                          <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                            <span className="absolute inset-y-0 left-0 rounded-full bg-sky-500" style={{ width: `${st.total ? (st.decided / st.total) * 100 : 0}%` }} />
                          </span>
                          <T k="결정됨" /> {st.decided}/{st.total}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
                          {st.ready > 0 && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /><T k="지금 가능" /> {st.ready}</span>}
                          {st.blocked > 0 && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /><T k="선행 대기" /> {st.blocked}</span>}
                          {st.seeded > 0 && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden /><T k="개발 시드" /> {st.seeded}</span>}
                          {st.goLive > 0 && <span className="inline-flex items-center gap-1 text-rose-700"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden /><T k="개시 전 필수 미결" /> {st.goLive}</span>}
                          {group.length < st.total && <span className="text-gray-400"><T k="표시" /> {group.length}/{st.total}</span>}
                        </span>
                      </button>
                      {isOpen && <ul className="space-y-2">{group.map(renderRow)}</ul>}
                    </div>
                  );
                })}
              </section>
            );
          })}

          {view === 'COMMITTEE' && (
            <>
              <TabBar attr="committee-tab" label={tAttr('위원회')} value={comTab} onChange={(k) => chooseTab('COMMITTEE', k)}
                tabs={[
                  { key: 'ALL', label: <T k="전체" />, count: items.filter((i) => i.committee).length },
                  ...COMMITTEE_CODES.map((c) => ({ key: c, label: COMMITTEE_AUTHORITIES[c].name, count: items.filter((i) => i.committee?.lead === c).length, tone: items.some((i) => i.committee?.lead === c) ? undefined : 'muted' as const })),
                  { key: 'LICENSE_HOLDER', label: <T k="허가권자" />, count: items.filter((i) => i.layer === 'LICENSE_HOLDER').length },
                  { key: 'STAFF', label: <T k="직원" />, count: items.filter((i) => i.layer === 'STAFF').length },
                ]} />
              {/*
                    🔴 위원회 결정 과정 — 순서와 단계별 수(위원회 층만 · 서버가 원장에서 판정).
                       개발 시드는 실결정이 아니라 단계를 앞당기지 않는다 · ⑦ 확인은 사람 확인 기록이 없어 세지 않는다.
                  */}
                  <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-white px-5 py-3.5" data-stage-strip>
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-[15px] font-bold tracking-tight text-indigo-950"><T k="위원회 결정 과정" /></span>
                      <span className="text-[11px] text-indigo-800/80"><T k="원내 위원회 결정은 이 순서로 진행됩니다 — 단계를 누르면 그 단계의 결정만 봅니다." /></span>
                    </p>
                    <ol className="mt-2.5 flex flex-wrap items-stretch gap-1.5">
                      {COMMITTEE_DECISION_STAGES.map((st, idx) => {
                        const roll = (payload?.summary?.byStage ?? []).find((r) => r.stage === st.key);
                        const countable = st.key !== 'VERIFIED';
                        const active = stageFilter === st.key;
                        return (
                          <li key={st.key} className="flex items-center gap-1.5">
                                <button type="button" disabled={!countable} data-stage-chip={st.key} aria-pressed={active}
                                  onClick={() => { setStageFilter(active ? 'ALL' : st.key); if (!active) chooseTab('COMMITTEE', 'ALL'); }}
                                  title={tAttr(st.description)}
                                  className={`min-h-[44px] rounded-xl border px-3 py-1.5 text-left shadow-sm transition ${active ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-indigo-950 border-indigo-100 hover:border-indigo-300'} disabled:cursor-default disabled:shadow-none disabled:bg-white/60`}>
                                  <span className="block text-[11px] font-semibold opacity-80">{STAGE_NO[idx]} <T k={st.label} /></span>
                                  <span className="block text-[15px] font-bold leading-tight tabular-nums" data-stage-count={st.key}>
                                    {countable
                                      ? (roll?.count == null ? '—' : <><b>{roll.count}</b>건</>)
                                      : <span className="text-[11px] font-normal"><T k="사람 확인 — 시스템이 세지 않음" /></span>}
                                  </span>
                                </button>
                                {idx < COMMITTEE_DECISION_STAGES.length - 1 && <span className="text-indigo-200" aria-hidden>›</span>}
                          </li>
                        );
                      })}
                    </ol>
                    {payload?.summary?.agendaUnknown && (
                      <p className="mt-1.5 text-[11px] text-amber-900" data-stage-agenda-unknown>
                        <T k="위원회 안건을 조회하지 못했습니다 — ②~④ 단계 수는 확인할 수 없습니다(안건이 없다는 뜻이 아닙니다)." />
                      </p>
                    )}
                    {stageFilter !== 'ALL' && (
                      <button type="button" onClick={() => setStageFilter('ALL')} className="mt-1.5 min-h-[32px] text-[11px] text-indigo-800 underline underline-offset-2" data-stage-clear>
                        <T k="단계 거르기 해제" />
                      </button>
                    )}
                  </section>

              {renderCommitteeView(comTab)}
            </>
          )}

          {view === 'LAYER' && (
            <TabBar attr="layer-tab" label={tAttr('층')} value={layerTab} onChange={(k) => chooseTab('LAYER', k)}
              tabs={[
                ...LAYER_ORDER.filter((l) => items.some((i) => i.layer === l)).map((l) => ({ key: l, label: <T k={LAYER_TITLE_SHORT[l]} />, count: items.filter((i) => i.layer === l).length })),
                { key: 'ALL', label: <T k="전체" />, count: items.length },
              ]} />
          )}
          {/* 층별 — 🔴 층마다 "할 수 없는 것"을 함께 낸다(분리의 핵심) */}
          {view === 'LAYER' && layerShown.map((layer) => {
            const meta = payload?.layers?.[layer];
            const group = sortDecisionRows(visible.filter((i) => i.layer === layer));
            /** 🔴 필터로 비었을 때와 원래 없을 때를 구분해 말한다(빈 화면은 "없다"로 읽힌다) */
            const layerTotal = items.filter((i) => i.layer === layer).length;
            if (!group.length && !layerTotal) return null;
            return (
              <section key={layer} className="space-y-3" data-decision-layer-section={layer}>
                {(() => {
                  // 층 머리 — 결정 목록·위원회 탭과 같은 모양(2026-10-11) · 수는 전체 분모
                  const lr = items.filter((i) => i.layer === layer);
                  const dn = lr.filter((i) => i.decided).length;
                  const rd = lr.filter((i) => decisionRowState(i) === 'READY').length;
                  const bl = lr.filter((i) => decisionRowState(i) === 'BLOCKED').length;
                  const sd = lr.filter((i) => decisionRowState(i) === 'SEEDED').length;
                  const gl = lr.filter((i) => i.goLive === 'REQUIRED_BEFORE' && !i.decided).length;
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                      <p className="text-xl font-extrabold tracking-tight text-slate-900">{meta?.label ?? layer}</p>
                      {meta?.scope && <p className="mt-0.5 text-[12px] text-slate-600">{meta.scope}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600 tabular-nums" data-layer-stats={layer}>
                        <span className="inline-flex items-center gap-2">{progressBar(dn, lr.length)}<T k="결정됨" /> {dn}/{lr.length}</span>
                        {rd > 0 && <span className="inline-flex items-center gap-1">{dot('bg-emerald-500')}<T k="지금 가능" /> {rd}</span>}
                        {bl > 0 && <span className="inline-flex items-center gap-1">{dot('bg-amber-500')}<T k="선행 대기" /> {bl}</span>}
                        {sd > 0 && <span className="inline-flex items-center gap-1">{dot('bg-violet-500')}<T k="개발 시드" /> {sd}</span>}
                        {gl > 0 && <span className="inline-flex items-center gap-1 text-rose-700">{dot('bg-rose-500')}<T k="개시 전 필수 미결" /> {gl}</span>}
                        {group.length < lr.length && <span className="text-gray-400"><T k="표시" /> {group.length}/{lr.length}</span>}
                      </p>
                      {/* 🔴 각 층이 **할 수 없는 것**을 함께 낸다 — 이것이 분리의 핵심이다 */}
                      {meta?.cannot && <p className="mt-2 rounded-lg bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-900">{meta.cannot}</p>}
                    </div>
                  );
                })()}
                {group.length === 0 ? (
                  <p className="text-[11px] text-gray-500 px-2">
                    <T k="이 층에는 고른 조건에 맞는 항목이 없습니다" /> — <T k="이 층 전체" /> {layerTotal}건.
                  </p>
                ) : (
                  <ul className="space-y-2">{group.map(renderRow)}</ul>
                )}
              </section>
            );
          })}
        </>
      )}

      {open && (() => {
        const missing = !choice ? tAttr('선택지를 고르세요')
          : open.layer === 'LICENSE_HOLDER' && !open.pendingAttachments?.length ? tAttr('근거 문서를 첨부하세요')
          : legalRef.trim().length < 4 ? tAttr('법적 검토 근거를 입력하세요')
          : authority.trim().length < 2 ? tAttr('허가권 근거를 입력하세요') : null;
        return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`${open.title} 의사결정`}>
          {/*
            🔴 의사결정 작업대(2026-10-11 사용자 "세련되게 · 좌우 공간 충분히 · 주요 설명자료와 의사결정 과정이 한눈에") —
               머리(무엇·결정 상태) → 과정 띠(단계·선행·후속) → 3열(핵심 설명 · 선택지 비교 · 의사결정 입력) → 늘 보이는 의사결정 단추.
               넓은 화면은 열마다 따로 스크롤 · 좁은 화면은 한 줄로 쌓는다.
          */}
          <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl" data-decide-dialog>
            <DecideHeader item={open} onClose={() => setOpen(null)} />
            <DecideProcess item={open} items={items} />
            <div className="min-h-0 flex-1 overflow-y-auto xl:overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(360px,0.85fr)]" data-decide-body>
              <div className="xl:min-h-0 xl:overflow-y-auto px-5 py-4 xl:border-r border-gray-200" data-decide-briefing aria-label={tAttr('설명자료')}>
                <p className="mb-2 text-[11px] font-bold tracking-wide text-gray-500"><T k="핵심 설명" /></p>
                <DecideSummary item={open} />
              </div>
              <div className="xl:min-h-0 xl:overflow-y-auto px-5 py-4 xl:border-r border-gray-200 bg-white/60" aria-label={tAttr('선택지 비교')}>
                <p className="mb-2 text-[11px] font-bold tracking-wide text-gray-500"><T k="선택지 비교" /></p>
                <DecideOptions item={open} items={items} choice={choice} onChoose={setChoice} />
              </div>
              <div className="xl:min-h-0 xl:overflow-y-auto px-5 py-4 bg-white space-y-3" data-decide-form>
                <p className="text-[11px] font-bold tracking-wide text-gray-500"><T k="의사결정" /></p>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px]" data-decide-chosen>
                  <T k="고른 선택지" />: {choice ? <b className="text-gray-900">{open.options.find((o) => o.value === choice)?.label ?? choice}</b> : <span className="text-amber-900"><T k="아직 고르지 않음 — 가운데에서 고르세요" /></span>}
                </div>
                {/* 🔴 허가권자 층 — 근거 문서 없이는 서버가 기록을 거부한다(fail-closed) */}
                {open.layer === 'LICENSE_HOLDER' && (
                  <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-medium text-amber-900">
                      <T k="근거 문서" /> <span className="text-red-600">*</span> <T k="— 검토 회신·계약서·의견서 등" />
                    </p>
                    {open.pendingAttachments?.length > 0 ? (
                      <ul className="text-[11px] text-gray-700 space-y-0.5">
                        {open.pendingAttachments.map((a) => (
                          <li key={a.id} className="flex items-center gap-1.5">
                            <span className="flex-1">📎 {a.fileName} <span className="text-gray-400">({Math.round(a.sizeBytes / 1024)}KB · {kdate(a.uploadedAt, 'datetimeSec')})</span></span>
                            {/* 🔴 개원 축과 **같은 정본**을 부른다 — 판독은 초안이고 저장하지 않는다 */}
                            <button type="button" onClick={() => void runExtract(open.key, a.id)} disabled={extracting === a.id}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 text-amber-800 bg-amber-50 disabled:opacity-50">
                              {extracting === a.id ? <T k="판독 중…" /> : `${AI_ORIGIN_TEXT} 판독`}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-amber-900"><T k="아직 첨부된 문서가 없습니다 — 첨부해야 의사결정할 수 있습니다." /></p>
                    )}
                    {/* 🔴 판독 3상태 — 못 읽음과 "읽었는데 없음"을 뭉개지 않는다 */}
                    {draft && (
                      <div className="rounded-lg border border-amber-300 bg-white/70 p-2">
                        <p className="text-[11px] font-bold text-amber-900">
                          {AI_ORIGIN_TEXT} 판독 초안{draft.fileName ? ` · ${draft.fileName}` : ''}
                        </p>
                        {draft.source === 'UNAVAILABLE' ? (
                          <p className="text-[11px] text-amber-800 mt-0.5">{draft.reason}</p>
                        ) : extractedCount(draft.fields) === 0 ? (
                          <p className="text-[11px] text-amber-800 mt-0.5"><T k="문서에서 채울 수 있는 칸을 찾지 못했습니다 — 직접 입력하세요." /></p>
                        ) : (
                          <ul className="mt-0.5 space-y-0.5">
                            {(Object.keys(draft.fields) as (keyof typeof draft.fields)[]).map((k) => (
                              <li key={k} className="text-[11px] text-amber-900">
                                <span className="text-amber-700">{EVIDENCE_FIELD_LABEL[k]}</span> {draft.fields[k]}
                              </li>
                            ))}
                          </ul>
                        )}
                        {/* 🔴 여기서는 **담기 버튼을 두지 않는다** — 이 화면의 칸(권한 근거·검토 참조)은
                            문서에서 뽑은 값과 뜻이 다르다. 사람이 읽고 판단해 적는다. */}
                        <p className="text-[10px] text-amber-700/80 mt-1">{EVIDENCE_EGRESS_NOTICE}</p>
                      </div>
                    )}
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                      disabled={upload.isPending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload.mutate({ key: open.key, file: f });
                        e.target.value = '';
                      }}
                      className="block w-full text-[11px]" />
                    {/* 🔴 시스템이 할 수 없는 것을 그 자리에서 말한다 */}
                    <p className="text-[11px] text-gray-600">
                      pdf·jpeg·png·webp · 10MB. 🔴 <T k="시스템은" /> <b><T k="문서의 진위·유효성을 확인하지 못합니다" /></b> —
                      <T k="무엇이 언제 누구에 의해 올라왔는지만 기록됩니다." />
                    </p>
                  </div>
                )}

                <label className="block">
                  <span className="text-xs font-medium text-gray-700"><T k="법적 검토 근거" /> <span className="text-red-600">*</span></span>
                  <input value={legalRef} onChange={(e) => setLegalRef(e.target.value)}
                    placeholder={tAttr('문서번호·회신·위원회 의결번호 (예: CPO-2026-014)')}
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-700"><T k="허가권 근거" /> <span className="text-red-600">*</span></span>
                  <input value={authority} onChange={(e) => setAuthority(e.target.value)}
                    placeholder={open.authority}
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  {/* 🔴 검증하지 못한다는 사실을 그 자리에서 말한다 */}
                  <span className="block text-[11px] text-amber-800 mt-1">
                    <T k="시스템은 직책·허가권을 확인하지 못합니다. 입력한 내용이 그대로 기록됩니다." />
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-700"><T k="메모" /></span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </label>

              </div>
            </div>
            <footer className="shrink-0 border-t border-gray-200 bg-white px-6 py-3 flex flex-wrap items-center gap-3" data-decide-footer>
              <p className="flex-1 min-w-[12rem] text-[12px]">
                {missing ? <span className="text-amber-900" data-decide-missing>{missing}</span>
                  : <span className="text-gray-600"><T k={PATH_LABEL[open.approvalPath].note} /></span>}
              </p>
              <button onClick={() => setOpen(null)} className="min-h-[44px] px-5 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50"><T k="취소" /></button>
              <button
                disabled={!!missing || save.isPending}
                onClick={() => save.mutate({ key: open.key, body: { choice, legalReviewRef: legalRef.trim(), authorityClaim: authority.trim(), note: note.trim() || undefined } })}
                data-decide-submit
                className="min-h-[44px] px-8 rounded-lg text-sm font-bold bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-40">
                {save.isPending ? <T k="저장 중…" /> : <T k="의사결정" />}
              </button>
            </footer>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
