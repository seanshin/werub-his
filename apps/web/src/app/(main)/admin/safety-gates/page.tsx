'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs } from '@/lib/ui-settings';
import { ProposeAgendaButton } from '@/components/governance/ProposeAgendaModal';
import { AlertRegistryPanel } from './alert-registry-panel';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface GateRecent { at: string; severity: string; message: string; ref?: string }
interface Gate {
  key: string; label: string; domain: string; mode: string; defaultMode: string;
  violations7d: number; violations30d: number; overrides30d?: number;
  /** 🔴 심각도 내역 — 없으면 화면이 나누지 않는다(모르면 말하지 않는다) */
  blocked30d?: number; warned30d?: number;
  /** 30일 내 이 게이트가 **평가된 횟수**(모집단). undefined = 소스가 모집단을 못 냄 */
  evaluated30d?: number;
  /** 집계가 실제로 수행됐는가 — false 면 위반 수는 0 이 아니라 '모름' */
  statsAvailable?: boolean;
  collectError?: string | null;
  /** 모집단이 있고 그 안에서 위반이 0 — 승격 권고의 유일한 근거 */
  promotionEligible?: boolean;
  recent: GateRecent[]; statsSource: string;
  /** 🔴 영역별 맵 게이트 — 스칼라 모드 버튼을 띄우면 맵이 통째로 덮인다 */
  isMap?: boolean;
  mapDetail?: string | null;
  mapActive?: number | null;
  mapTotal?: number | null;
}
interface OtherGate { key: string; label: string; mode: string; type?: string; detail?: string }

const MODES = ['OFF', 'WARN', 'BLOCK'] as const;
const MODE_STYLE: Record<string, string> = {
  OFF: 'bg-gray-100 text-gray-500',
  WARN: 'bg-amber-100 text-amber-700',
  BLOCK: 'bg-red-100 text-red-700',
  ON: 'bg-emerald-100 text-emerald-700',
};
const MODE_ACTIVE: Record<string, string> = {
  OFF: 'bg-gray-600 text-white',
  WARN: 'bg-amber-500 text-white',
  BLOCK: 'bg-red-600 text-white',
};

/**
 * 승격 가이드 — 🔴 2026-08-14(W7) 수리.
 *
 * 종전에는 `violations30d === 0` 이면 무조건 **"30일 위반 0건 — BLOCK 승격 검토"**(초록)를
 * 띄웠다. 그런데 0 에는 세 가지 뜻이 섞여 있었다:
 *   ⓐ 여러 번 평가됐고 위반이 없었다(진짜 준수)
 *   ⓑ **한 번도 평가된 적이 없다**(모집단 0 — 판단 근거 없음)
 *   ⓒ 집계 쿼리가 실패했다
 * 실측 결과 **6종이 개통 이래 한 번도 평가된 적 없는데** 전부 승격 권고 대상으로 떴다
 * (cdss_logs 0행 · equipment_usage_logs 0행 · psych_seclusion_orders 0행 …).
 * BLOCK 승격은 위반 시 업무를 차단하는 결정이다 — **근거가 없으면 없다고 말한다.**
 */
function promotionHint(g: Gate): { text: string; cls: string } | null {
  if (g.statsAvailable === false) {
    return { text: '집계 실패 — 위반 수를 알 수 없음', cls: 'bg-rose-50 text-rose-700' };
  }
  // 🔴 BLOCK 게이트에도 근거를 말한다. 종전에는 WARN/OFF 일 때만 캐비아트를 내고 BLOCK 은 `null` 이라,
  //    **차단으로 켜져 있는데 아무것도 안 잡는 게이트가 화면에서 `0 / 0` 으로만 보였다.**
  //    v4.4.0 에서 DUR 55룰 중 43룰이 개통 이래 매칭 0 이던 것을 놓친 자리가 정확히 여기다
  //    ("위반 0"이 준수가 아니라 탐지기 사망이었다).
  if (g.mode === 'BLOCK') {
    if (g.violations30d > 0) {
      // 🔴 위반 수를 통째로 "차단"이라 부르지 않는다.
      //    이 게이트가 30일 안에 WARN 이던 기간이 있으면 그 기간의 경고가 같은 원장에 섞여 있다.
      if (g.blocked30d != null && g.warned30d != null) {
        const parts = [`차단 ${g.blocked30d}건`, `경고 ${g.warned30d}건`];
        const other = g.violations30d - g.blocked30d - g.warned30d;
        if (other > 0) parts.push(`기타 ${other}건`);
        return g.blocked30d > 0
          ? { text: `30일 ${parts.join(' · ')} — 게이트가 실제로 잡고 있다`, cls: 'bg-emerald-50 text-emerald-700' }
          : { text: `30일 ${parts.join(' · ')} — 차단된 건은 없다(경고 기간의 기록)`, cls: 'bg-amber-50 text-amber-700' };
      }
      return { text: `30일 위반 ${g.violations30d}건(심각도 내역 없음)`, cls: 'bg-gray-100 text-gray-600' };
    }
    if (g.evaluated30d === 0) {
      return { text: '🔴 BLOCK 인데 30일간 평가된 적 없음 — 탐지기가 도는지 확인 필요', cls: 'bg-rose-50 text-rose-700' };
    }
    if (g.evaluated30d == null) {
      return { text: '🔴 BLOCK 인데 평가 모집단 미상 — "위반 0"을 준수로 읽을 수 없다', cls: 'bg-rose-50 text-rose-700' };
    }
    return { text: `30일 ${g.evaluated30d}건 평가·차단 0건`, cls: 'bg-gray-100 text-gray-600' };
  }

  if (g.mode === 'WARN' || g.mode === 'OFF') {
    if (g.violations30d > 0) {
      return g.mode === 'WARN'
        ? { text: `30일 위반 ${g.violations30d}건 — 원인 정리 후 승격`, cls: 'bg-amber-50 text-amber-700' }
        : { text: `OFF인데 위반 감지 ${g.violations30d}건 — WARN 전환 검토`, cls: 'bg-blue-50 text-blue-700' };
    }
    // 위반 0 — 근거가 있는지부터 본다
    if (g.promotionEligible) {
      return { text: `30일 ${g.evaluated30d}건 평가·위반 0건 — BLOCK 승격 검토`, cls: 'bg-emerald-50 text-emerald-700' };
    }
    if (g.evaluated30d === 0) {
      return { text: '30일간 평가된 적 없음 — 승격 판단 근거 없음', cls: 'bg-gray-100 text-gray-600' };
    }
    return { text: '평가 모집단 미상 — 승격 판단 근거 없음', cls: 'bg-gray-100 text-gray-600' };
  }
  return null;
}

/**
 * ⚖ 거버넌스 근거 배지 — **3상태로 말한다** (2026-08-27 · 계획서 §3.3).
 *
 * 🔴 종전에는 배지가 **있을 때만** 보였다. 배지 부재를 "수동 변경 이력만"이라는 신호로
 *    설계해 두긴 했지만(주석까지 있었다), 그 규칙을 **읽는 사람이 미리 알아야** 했다.
 *    아무 표시가 없는 것과 "아무도 정하지 않았다"는 다른 무게다 — 명시한다.
 *
 * 🔴 그리고 **조회 실패를 "근거 없음"으로 말하지 않는다** — 모르는 것과 없는 것은 다르다.
 *    (실패는 화면 상단 QueryErrorFallback 이 이미 말하지만, 배지 자리도 침묵하지 않는다)
 */
function GovBadge({ decisionNo, loading, failed }: { decisionNo?: string; loading?: boolean; failed?: boolean }) {
  const tAttr = useTAttr();
  if (decisionNo) {
    return (
      <a href="/admin/governance" title={tAttr('위원회 의결 근거 — 클릭 시 거버넌스 대장')}
        className="ml-1.5 font-sans font-bold text-indigo-600 hover:text-indigo-800">⚖ {decisionNo}</a>
    );
  }
  if (loading) return <span className="ml-1.5 font-sans text-gray-300"><T k="근거 확인 중…" /></span>;
  if (failed) return <span className="ml-1.5 font-sans text-gray-400" title={tAttr('의결 근거를 조회하지 못했습니다 — 근거가 없다는 뜻이 아닙니다')}><T k="근거 확인 불가" /></span>;
  return (
    <span className="ml-1.5 font-sans text-amber-700" title={tAttr('위원회 의결로 정해진 값이 아닙니다 — 지금 값은 수동 변경이거나 코드 기본값입니다')}>
      <T k="의결 근거 없음" />
    </span>
  );
}

export default function SafetyGatesPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  // ⚖ 거버넌스 근거 배지(P2) — 이 게이트를 바꾼 최신 위원회 의결. 없음=수동 변경 이력만(그 자체가 신호)
  const badgesQ = useQuery({
    queryKey: ['gov-badges'],
    queryFn: () => apiClient.get<{ data: Record<string, { decisionNo: string }> }>('/api/v1/governance/badges'),
    staleTime: 60_000,
  });
  const _badgesRaw = badgesQ.data?.data as Record<string, { decisionNo: string }> | { data?: Record<string, { decisionNo: string }> } | undefined;
  const govBadges: Record<string, { decisionNo: string }> = (_badgesRaw && !('data' in (_badgesRaw as object)) ? _badgesRaw : (_badgesRaw as { data?: Record<string, { decisionNo: string }> })?.data) as Record<string, { decisionNo: string }> ?? {};
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['safety-gates'],
    queryFn: () => apiClient.get<{ data: { generatedAt: string; gates: Gate[]; others: OtherGate[] } }>('/api/v1/admin/safety-gates'),
    refetchInterval: pollMs('slow'),
  });
  const gates = data?.data?.gates ?? [];
  const others = data?.data?.others ?? [];

  const setMode = useMutation({
    mutationFn: ({ key, mode }: { key: string; mode: string }) =>
      apiClient.put(`/api/v1/config/${key}`, { value: mode }),
    onSuccess: (_r, v) => { toast.success(`${v.key} → ${v.mode}`); qc.invalidateQueries({ queryKey: ['safety-gates'] }); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '변경 실패 (ADMIN 권한 필요)'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="안전 게이트 관제" /></h1>
        <p className="text-sm text-gray-500 mt-0.5">
          <T k="게이트별 현재 모드·위반 통계(7/30일)·최근 사례 — WARN 관찰 후 BLOCK 승격 판단을 이 화면에서." />{' '}
          <T k="모드 변경은 즉시 반영됩니다(ADMIN)." />
        </p>
      </div>

      {/* 🔴 의결 배지 조회 실패를 "의결 근거 없음"(배지 부재)으로 읽히게 두지 않는다 —
          이 화면에서 배지 부재는 '수동 변경 이력만'이라는 신호라서, 실패와 구분되어야 한다 */}
      {badgesQ.isError && <QueryErrorFallback error={badgesQ.error} onRetry={badgesQ.refetch} size="compact" />}

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : (
        <div className="grid gap-3">
          {gates.map(g => {
            const hint = promotionHint(g);
            return (
              <div key={g.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">{g.domain}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{g.label}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{g.key} · 집계: {g.statsSource} · 기본 {g.defaultMode}
                      <GovBadge decisionNo={govBadges[g.key]?.decisionNo} loading={badgesQ.isLoading} failed={badgesQ.isError} /></p>
                  </div>
                  {hint && <span className={`px-2 py-1 rounded-lg text-[11px] font-medium ${hint.cls}`}>{hint.text}</span>}
                  <div className="flex items-center gap-3">
                    <button onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                      className="text-center hover:bg-gray-50 rounded-lg px-2 py-1" title={tAttr('최근 사례 보기')}>
                      <p className={`text-lg font-bold ${g.violations7d > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                        {g.statsAvailable === false ? '?' : g.violations7d}
                      </p>
                      <p className="text-[9px] text-gray-400"><T k="7일 위반" /></p>
                    </button>
                    <div className="text-center">
                      <p className={`text-lg font-bold ${g.violations30d > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {g.statsAvailable === false ? '?' : g.violations30d}
                      </p>
                      <p className="text-[9px] text-gray-400">
                        <T k="30일" />{typeof g.evaluated30d === 'number' ? ` / ${g.evaluated30d}건 평가` : ''}
                      </p>
                    </div>
                    {g.overrides30d != null && (
                      <div className="text-center">
                        <p className={`text-lg font-bold ${g.overrides30d > 0 ? 'text-purple-600' : 'text-gray-300'}`}>{g.overrides30d}</p>
                        <p className="text-[9px] text-gray-400">override</p>
                      </div>
                    )}
                  </div>
                  {/* 🔴 영역별 맵 게이트에는 스칼라 모드 버튼을 띄우지 않는다 —
                      문자열로 PUT 하면 맵 전체가 덮여 **영역별 설정이 통째로 사라진다**
                      ("강화 버튼이 통제를 끄는 경로"). 편집은 전용 화면에서 한다. */}
                  {g.isMap ? (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-gray-500 mb-1">
                        <T k="영역별 게이트 · 시행" /> <b>{g.mapActive ?? 0}</b>/{g.mapTotal ?? 0}
                      </p>
                      <p className="text-[10px] text-gray-400 max-w-[220px] truncate" title={g.mapDetail ?? ''}>{g.mapDetail ?? <T k="설정된 영역 없음" />}</p>
                      <a href="/admin/formulary" className="inline-block mt-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-50 text-violet-700 hover:bg-violet-100">
                        <T k="영역별 정책 편집" /> →
                      </a>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      {MODES.map(m => (
                        <button key={m}
                          onClick={() => { if (m !== g.mode && (m !== 'BLOCK' || confirm(`${g.label}\n\n${m} 모드로 전환할까요? BLOCK은 위반 시 업무가 차단됩니다.`))) setMode.mutate({ key: g.key, mode: m }); }}
                          disabled={setMode.isPending}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${g.mode === m ? MODE_ACTIVE[m] : `${MODE_STYLE[m]} hover:opacity-80`}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <ProposeAgendaButton
                    sourceRef={{ type: 'SAFETY_GATE', key: g.key }}
                    surfaceKey={`config:${g.key}`}
                    defaultTitle={hint ? `[안전게이트] ${g.label} — ${hint.text}` : `[안전게이트] ${g.label} 시행 모드 심의`}
                    defaultBody={`게이트: ${g.key}\n현재 모드: ${g.mode} (기본 ${g.defaultMode})\n위반: 7일 ${g.violations7d}건 · 30일 ${g.violations30d}건${g.overrides30d != null ? ` · override ${g.overrides30d}건` : ''}\n집계 소스: ${g.statsSource}`}
                    label="상정" />
                </div>

                {expanded === g.key && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    {g.recent.length === 0 ? (
                      <p className="text-xs text-gray-400"><T k="기록된 위반 사례가 없습니다" /></p>
                    ) : (
                      <div className="space-y-1.5">
                        {g.recent.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-gray-400 shrink-0 font-mono">{r.at.slice(0, 16).replace('T', ' ')}</span>
                            <span className="px-1.5 py-0.5 bg-white rounded text-[10px] font-semibold text-gray-600 shrink-0">{r.severity}</span>
                            <span className="text-gray-700">{r.message}</span>
                            {r.ref && <span className="text-gray-300 font-mono ml-auto shrink-0">{r.ref}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 기타 게이트 — 모드만(통계 소스 미연결). 3상 문자열 + Map형(영역/유형별) + boolean 전부 수집 */}
      {others.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-1"><T k="기타 게이트" /> <span className="text-xs font-normal text-gray-400"><T k="모드만 표시 — 상세 편집은 관리자 > 설정(ai-settings)" /></span></h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-2">
            {others.map(o => (
              <div key={o.key} className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                <span className="text-gray-600 truncate mr-2" title={o.key}>
                  {o.label}
                  {o.type === 'MAP' && <span className="ml-1 text-[10px] text-gray-400"><T k="부분키" /> {o.detail}</span>}
                  {/* 🔴 소비처 확대(2026-08-27) — 종전 배지는 wired 게이트에만 붙었다.
                      기타 게이트는 근거를 말할 자리 자체가 없어, 아무도 정하지 않은 값이
                      정해진 값과 같은 얼굴을 하고 있었다. */}
                  <GovBadge decisionNo={govBadges[o.key]?.decisionNo} loading={badgesQ.isLoading} failed={badgesQ.isError} />
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${MODE_STYLE[o.mode] ?? 'bg-gray-100 text-gray-500'}`}>{o.mode}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 경보 등록부(P0 인구조사·읽기 전용) — 정본 alert-registry.ts · 기획서 alert-registry.plan.md */}
      <AlertRegistryPanel />
    </div>
  );
}
