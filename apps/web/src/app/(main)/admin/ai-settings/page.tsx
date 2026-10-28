'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit, Ratio, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { AiSkillQuality } from '@/components/admin/AiSkillQuality';
import { AI_ORIGIN_TEXT, CONFIG_SEEDED_HINT, CONFIG_SEEDED_TEXT, DECIDED_SETTING_ALLOWED, formatNum, QI_FLOW_SETTING_ALLOWED, QI_FLOW_SETTING_KEYS, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { HisModePanel } from '@/components/admin/HisModePanel';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/** seeded — 개발 시드가 넣은 행(원내가 정한 값 아님 · 서버가 시드 행일 때만 싣는다 · 2026-10-27) */
interface ConfigItem { key: string; value: string | number | boolean | Record<string, unknown>; description: string; category: string; seeded?: boolean; }

const CATEGORY_LABEL: Record<string, string> = {
  general: '병원 기본 정보', ai: `${AI_ORIGIN_TEXT} 설정`, clinical: '진료 설정', billing: '수납 설정',
  security: '보안 설정', portal: '환자 포털', pharmacy: '약국 설정',
  blockchain: '전자인증서', cssd: 'CSSD 설정', inventory: '재고 설정',
  ui: '화면 표시(UX)', integration: '외부 연동', mode: '운영 모드',
};
const CATEGORY_ICON: Record<string, string> = {
  general: '🏥', ai: '🤖', clinical: '🩺', billing: '💰',
  security: '🔒', portal: '👤', pharmacy: '💊',
  blockchain: '🔐', cssd: '🔥', inventory: '📦',
  ui: '🎨', integration: '🔗', mode: '🚦',
};

// ── 무수정 승인율(human_edit_ratio · 기획서 §4.6·§5 P2) — 감사 원장 AiDraftApply/AiDraftOutcome 기준 ──
interface DraftMetricsRow { resourceType: string; applied: number; outcomes: number; measured?: number; unchanged: number; medianEditDistance: number | null }
interface DraftMetrics {
  windowDays: number; generatedAt: string; note: string;
  total: { applied: number; outcomes: number; measured?: number; unchanged: number; medianEditDistance: number | null };
  byResourceType: DraftMetricsRow[];
}
const DRAFT_RESOURCE_LABEL: Record<string, string> = {
  ENCOUNTER_SOAP: '진료 SOAP', DISCHARGE_SUMMARY: '퇴원요약', REFERRAL: '의뢰서', CONSENT: '동의서', VOC_REPLY: 'VoC 답변', CHECKUP_OPINION: '검진 소견', OTHER: '기타',
};
function AiDraftMetrics() {
  const tAttr = useTAttr();
  const [m, setM] = useState<DraftMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const load = useCallback(() => {
    setErr(null);
    apiClient.get<{ data: DraftMetrics }>(`/api/v1/ai/draft-metrics?days=${days}`)
      .then((r) => { const d = r?.data as unknown as Record<string, unknown>; setM((d?.total ? d : d?.data) as DraftMetrics); })
      .catch((e: { message?: string }) => setErr(e?.message ?? '조회 실패'));
  }, [days]);
  useEffect(() => { load(); }, [load]);
  const row = (label: string, r: { applied: number; outcomes: number; measured?: number; unchanged: number; medianEditDistance: number | null }, key: string, bold = false) => (
    <tr key={key} className={`border-b border-gray-50 ${bold ? 'font-semibold' : ''}`}>
      <td className="py-1">{label}</td>
      <td className="text-right tabular-nums">{r.applied}</td>
      <td className="text-right tabular-nums">{r.outcomes}{r.measured != null && r.measured !== r.outcomes && <span className="text-gray-400" title={tAttr('초안 본문이 없어 편집거리를 재지 못한 건 제외')}>{` (계측 ${r.measured})`}</span>}</td>
      {/* 🔴 분모는 서명 보고(outcomes) — 적용(applied)으로 나누면 미서명분이 "수정함"으로 둔갑한다 */}
      <td className="text-right tabular-nums"><Ratio numerator={r.unchanged} denominator={r.outcomes} unavailableHint="서명 보고 없음" /></td>
      <td className="text-right tabular-nums">{r.medianEditDistance == null ? <span className="text-gray-400" title={tAttr('서명 보고가 없어 산출 불가')}><T k="산출 불가" /></span> : r.medianEditDistance}</td>
    </tr>
  );
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6" data-panel="ai-draft-metrics">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-900"><T k="AI 초안 무수정 승인율" /> <span className="text-xs font-normal text-gray-400"><T k="적용 → 서명 시 수정량(편집거리) · 과신 모니터" /></span></h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-[11px] border border-gray-200 rounded-lg px-2 py-1">
          <option value={7}>{tAttr('7일')}</option><option value={30}>{tAttr('30일')}</option><option value={90}>{tAttr('90일')}</option>
        </select>
      </div>
      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mb-2">
        🔴 <b>100% 무수정은 도구가 아니라 자동실행이다</b>(§7.7). 적용(applied)과 서명 보고(outcomes)의 차이는 <b>아직 서명하지 않았거나 보고가 실패한 건</b>이다 — 무수정으로 세지 않는다.
      </p>
      {err && <QueryErrorFallback error={new Error(err)} onRetry={load} size="compact" />}
      {m && m.total.applied === 0 && m.total.outcomes === 0 && (
        <p className="text-xs text-gray-400">이 기간 AI 초안 적용 기록 없음 — 비율은 <b>산출 불가</b>(0% 가 아니다).</p>
      )}
      {m && (m.total.applied > 0 || m.total.outcomes > 0) && (
        <table className="w-full text-[11px]">
          <thead className="text-gray-500 border-b border-gray-100"><tr>
            <th className="text-left py-1"><T k="자원" /></th><th className="text-right"><T k="초안 적용" /></th><th className="text-right"><T k="서명 보고(계측)" /></th><th className="text-right"><T k="무수정 n/N" /></th><th className="text-right"><T k="편집거리 중앙값" /></th>
          </tr></thead>
          <tbody>
            {m.byResourceType.map((r) => row(DRAFT_RESOURCE_LABEL[r.resourceType] ?? r.resourceType, r, r.resourceType))}
            {row('전체', m.total, '__total', true)}
          </tbody>
        </table>
      )}
      {m && <p className="text-[11px] text-gray-400 mt-2"><T k="기준" /> <KDate value={m.generatedAt} mode="datetime" /> · {m.note}</p>}
    </div>
  );
}

/* ── 모델 호출 분포 · 모델 정합(기획서 ai-judgment-governance §2.2) ──────────────
 * 🔴 "어느 모델이 언제 무엇을 했는가"를 원장(`AiCallLog`)에서 읽는다. 실측 피해가 이 두 카드의 이유다:
 *    AI 서버 이전 후 `gemma3:12b` 가 상류에 없어 컨시어지가 **상시 FALLBACK** 이었는데, 화면 어디에도
 *    "우리가 부르는 모델이 서버에 없다"는 사실이 없었다.
 * 🔴 세 상태를 뒤바꿔 말하지 않는다 — 아직 안 온 것(로딩) / 못 물어본 것(판정 불가) / 진짜 0(표본 0).
 */
interface AiCallStatsRow {
  skill: string; requestedModel: string | null; modelRef: string | null;
  calls: number; ok: number; failed: number; unknownStatus: number; mismatch: boolean;
}
interface AiCallStats {
  windowDays: number; since: string; generatedAt: string; sample: number;
  rows: AiCallStatsRow[]; byStatusClass: Array<{ label: string; calls: number }>; note: string;
}
function AiCallStatsCard() {
  const tAttr = useTAttr();
  const [stats, setStats] = useState<AiCallStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const load = useCallback(() => {
    setErr(null); setStats(null);
    apiClient.get<{ data: AiCallStats }>(`/api/v1/admin/ai/call-stats?days=${days}`)
      .then((r) => setStats(r.data))
      .catch((e: { message?: string }) => setErr(e?.message ?? '조회 실패'));
  }, [days]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6" data-panel="ai-call-stats">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-900">
          <T k="모델 호출 분포" /> <span className="text-xs font-normal text-gray-400"><T k="AI 호출 원장(AiCallLog) · PHI 없음" /></span>
        </h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-[11px] border border-gray-200 rounded-lg px-2 py-1">
          <option value={7}>{tAttr('7일')}</option><option value={30}>{tAttr('30일')}</option><option value={90}>{tAttr('90일')}</option>
        </select>
      </div>
      <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 mb-2">
        원장은 <b>aiEgressFetch 를 지난 호출</b>만 담는다. <b>상류 보고 태그(modelRef)</b>가 비어 있는 것은 응답이 JSON 이 아니었거나(스트리밍) 상류가 모델을 말하지 않은 것 — <b>모름</b>이지 &quot;다른 모델&quot;이 아니다.
      </p>
      {err && <QueryErrorFallback error={new Error(err)} onRetry={load} size="compact" />}
      {/* 🔴 아직 안 온 것을 "기록 없음"이라 말하지 않는다 */}
      {!err && !stats && <p className="text-xs text-gray-400"><T k="불러오는 중…" /></p>}
      {stats && stats.sample === 0 && (
        <p className="text-xs text-gray-400">
          {/* 🔴 문구는 shared 정본이 만든다 — 화면마다 손으로 적으면 어휘가 갈라진다(가드가 기준선 65 로 동결) */}
          이 기간 원장에 남은 AI 호출이 <b>0건</b> — 비율은 <b>{RATIO_UNAVAILABLE}</b>다(0% 가 아니다).
          계측이 배포된 시점 이후의 호출만 담기므로, 0 은 &quot;호출이 없었다&quot;와 &quot;아직 안 쌓였다&quot;를 구분하지 못한다.
        </p>
      )}
      {stats && stats.sample > 0 && (
        <>
          <table className="w-full text-[11px]">
            <thead className="text-gray-500 border-b border-gray-100"><tr>
              <th className="text-left py-1"><T k="스킬(호출 주체)" /></th>
              <th className="text-left"><T k="요청 태그" /></th>
              <th className="text-left"><T k="상류 보고 태그" /></th>
              <th className="text-right"><T k="호출" /></th>
              <th className="text-right"><T k="성공 n/N" /></th>
            </tr></thead>
            <tbody>
              {stats.rows.slice(0, 20).map((r, i) => (
                <tr key={`${r.skill}|${r.requestedModel ?? ''}|${r.modelRef ?? ''}|${i}`} className="border-b border-gray-50">
                  <td className="py-1">{r.skill}</td>
                  <td className="font-mono">{r.requestedModel ?? <span className="text-gray-400" title={tAttr('요청 본문에서 모델 태그를 읽지 못했다')}>미상</span>}</td>
                  <td className="font-mono">
                    {r.modelRef ?? <span className="text-gray-400" title={tAttr('상류가 모델을 보고하지 않았거나 스트리밍 응답이다')}>미상</span>}
                    {r.mismatch && <span className="ml-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded whitespace-nowrap">요청과 다름</span>}
                  </td>
                  <td className="text-right tabular-nums">{r.calls}</td>
                  {/* 🔴 분모 병기 — 성공률만 적으면 표본 1건짜리 100% 가 지표 행세를 한다 */}
                  <td className="text-right tabular-nums"><Ratio numerator={r.ok} denominator={r.calls} unavailableHint="호출 없음" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.rows.length > 20 && (
            <p className="text-[11px] text-gray-400 mt-1">상위 20행만 표시했다(전체 {stats.rows.length}행) — 잘랐다는 사실을 적는다.</p>
          )}
          <p className="text-[11px] text-gray-500 mt-2">
            <T k="응답 상태" />:{' '}
            {stats.byStatusClass.map((s) => (
              <span key={s.label} className="mr-2">
                {s.label} <b className="tabular-nums">{s.calls}</b>/<span className="tabular-nums">{stats.sample}</span>
              </span>
            ))}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            <T k="표본" /> <b className="tabular-nums">{stats.sample}</b>건 · <T k="기준" /> <KDate value={stats.generatedAt} mode="datetime" />
          </p>
        </>
      )}
    </div>
  );
}

interface AiModelFit {
  required: Array<{ tag: string; sites: string[]; note: string }>;
  available: string[] | null;
  missing: string[] | null;
  reason: string | null;
  checkedAt: string;
  note: string;
}
function AiModelFitCard() {
  const [fit, setFit] = useState<AiModelFit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null); setFit(null);
    apiClient.get<{ data: AiModelFit }>('/api/v1/admin/ai/upstream-models')
      .then((r) => setFit(r.data))
      .catch((e: { message?: string }) => setErr(e?.message ?? '조회 실패'));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6" data-panel="ai-model-fit">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-900">
          <T k="모델 정합" /> <span className="text-xs font-normal text-gray-400"><T k="코드가 요구하는 태그 ↔ AI 서버 보유 태그" /></span>
        </h3>
        <button onClick={load} className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"><T k="다시 확인" /></button>
      </div>
      <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 mb-2">
        요구 목록은 <b>코드 상수 스냅샷</b>이다 — 설정 <code>ai.model</code> 은 번역 1곳만 소비하므로 값을 바꿔도 나머지는 <b>코드 고정</b>으로 나간다.
      </p>
      {err && <QueryErrorFallback error={new Error(err)} onRetry={load} size="compact" />}
      {!err && !fit && <p className="text-xs text-gray-400"><T k="불러오는 중…" /></p>}
      {fit && (
        <>
          {/* 🔴 못 물어봤으면 판정하지 않는다 — 0개·전부 없음 어느 쪽으로도 접지 않는다 */}
          {fit.available === null ? (
            <p className="text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1.5">
              <b>판정 불가</b> — AI 서버 보유 목록을 확인하지 못했다({fit.reason ?? '사유 미상'}).
              요구 태그 {fit.required.length}종이 있는지 <b>모른다</b>(없다는 뜻이 아니다).
            </p>
          ) : fit.missing && fit.missing.length > 0 ? (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
              🔴 <b>코드가 부르는데 서버에 없는 모델 {fit.missing.length}종</b>: <span className="font-mono">{fit.missing.join(', ')}</span>
              {' '}— 해당 기능은 폴백으로 내려가거나 실패한다.
            </p>
          ) : (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
              요구 태그 전부 보유 — <b>보유/요구</b>{' '}
              <Ratio numerator={fit.required.length} denominator={fit.required.length} unavailableHint="요구 목록 없음" />
              {' '}(이 판정은 <b>태그 존재</b>만 본다 — 모델이 잘 답하는지는 다른 사실이다)
            </p>
          )}
          <table className="w-full text-[11px] mt-2">
            <thead className="text-gray-500 border-b border-gray-100"><tr>
              <th className="text-left py-1"><T k="요구 태그" /></th>
              <th className="text-left"><T k="상류 보유" /></th>
              <th className="text-left"><T k="쓰는 곳 · 없으면" /></th>
            </tr></thead>
            <tbody>
              {fit.required.map((r) => {
                const has = fit.available === null ? null : !(fit.missing ?? []).includes(r.tag);
                return (
                  <tr key={r.tag} className="border-b border-gray-50 align-top">
                    <td className="py-1 font-mono">{r.tag}</td>
                    <td>
                      {has === null
                        ? <span className="text-gray-400" title={fit.reason ?? undefined}>확인 불가</span>
                        : has ? <span className="text-emerald-700">보유</span> : <span className="text-red-700 font-bold">없음</span>}
                    </td>
                    <td className="text-gray-500">{r.sites.length}개 파일 · {r.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-2">
            <T k="확인 시각" /> <KDate value={fit.checkedAt} mode="datetime" />
            {fit.available !== null && <> · 상류 보유 {fit.available.length}종</>}
          </p>
        </>
      )}
    </div>
  );
}

// ── 하이브리드 브리핑 운영 스위치(기획서 chart-ai-assistant-agent §4.6-a) — 배치 A(결정론)·배치 B(LLM 사전 스킬) ──
const BRIEF_KEYS: Array<{ key: string; label: string; kind: 'bool' | 'number'; note: string }> = [
  { key: 'ai.brief.batch.enabled', label: '야간 배치 A(결정론 브리핑) ON', kind: 'bool', note: '02:00 · 다음날 예약+재원 환자만 · LLM 없음(PHI 외부 전송 없음) · OFF 여도 진료 진입 시 lazy 계산은 동작' },
  { key: 'ai.brief.llm.enabled', label: '야간 배치 B(LLM 사전 검사해석) ON', kind: 'bool', note: '🔴 PHI 가 AI 서버로 나간다(폐쇄망/위탁 결정 종속) · 검사 결과 있는 환자만 · 검증층 통과분만 저장' },
  { key: 'ai.brief.concurrency', label: '배치 동시성', kind: 'number', note: '예산 — 동시에 계산하는 환자 수' },
  { key: 'ai.brief.patientBudgetSec', label: '환자당 시간 예산(초)', kind: 'number', note: '초과분은 "미계산(예산)"으로 남기고 실시간으로 넘긴다(조용히 건너뛰지 않음)' },
];
function AiBriefSwitches() {
  const tAttr = useTAttr();
  const [vals, setVals] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    Promise.all(BRIEF_KEYS.map((k) => apiClient.get<{ data: unknown }>(`/api/v1/config/${encodeURIComponent(k.key)}`).then((r) => [k.key, (r as { data?: unknown })?.data] as const)))
      .then((pairs) => setVals(Object.fromEntries(pairs)))
      .catch((e: { message?: string }) => setErr(e?.message ?? '설정 조회 실패'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (key: string, value: unknown) => {
    setBusy(key);
    try { await apiClient.put(`/api/v1/config/${encodeURIComponent(key)}`, { value }); toast.success(`${key} → ${String(value)}`); load(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '변경 실패(ADMIN 권한 필요)'); }
    setBusy(null);
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6" data-panel="ai-brief-switches">
      <h3 className="text-sm font-bold text-gray-900 mb-1"><T k="환자 AI 브리핑 — 하이브리드 실행 스위치" /> <span className="text-xs font-normal text-gray-400"><T k="배치 사전계산 + 실시간" /></span></h3>
      <p className="text-[11px] text-gray-500 mb-3">진료 진입 시 브리핑(결정론)은 항상 lazy 계산된다. 아래는 <b>야간 배치</b> 여부·예산이다. 개시 전 확정 항목(go-live H) — 켜고 끈 사실은 config 감사로 남는다.</p>
      {err && <QueryErrorFallback error={new Error(err)} onRetry={load} size="compact" />}
      {!vals && !err && <p className="text-xs text-gray-400"><T k="설정 불러오는 중…" /></p>}
      {vals && (
        <div className="space-y-2">
          {BRIEF_KEYS.map((k) => {
            const v = vals[k.key];
            return (
              <div key={k.key} className="flex flex-wrap items-center gap-3 text-xs border-b border-gray-50 py-2">
                <div className="min-w-[260px]">
                  <div className="font-medium text-gray-800">{k.label} <span className="font-mono text-[10px] text-gray-400">{k.key}</span></div>
                  <div className="text-[11px] text-gray-500">{k.note}</div>
                </div>
                {k.kind === 'bool' ? (
                  <button disabled={busy === k.key} onClick={() => save(k.key, !(v === true || v === 'true'))}
                    className={`min-h-[36px] px-3 rounded-lg font-semibold ${v === true || v === 'true' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                    {v == null ? '미설정(기본 OFF)' : (v === true || v === 'true') ? 'ON' : 'OFF'} · 전환
                  </button>
                ) : (
                  <input type="number" defaultValue={v == null ? '' : Number(v)} placeholder={tAttr('미설정(기본값)')} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0 && n !== Number(v)) void save(k.key, n); }}
                    className="w-24 border border-gray-200 rounded-lg px-2 py-1.5" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 진료 보조 스킬 계측(기획서 chart-ai-assistant-agent §4.6) — 호출 N·source 3상태·지연·검증 폐기 사유 ──
interface SkillMetrics {
  windowDays: number; generatedAt: string; note: string;
  skills: Array<{ skill: string; calls: number; bySource: Record<string, number>; aiOk: number; latencyP50Ms: number | null; latencyP95Ms: number | null; verifyFailed: Record<string, number>; reasons: Record<string, number> }>;
}
const SKILL_LABEL: Record<string, string> = { RealtimeDdx: '감별진단', AutoSoap: 'SOAP 초안', InterpretLab: '검사해석', RecommendDrugs: '약물추천' };
function AiSkillMetrics() {
  const tAttr = useTAttr();
  const [m, setM] = useState<SkillMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const load = useCallback(() => {
    setErr(null);
    apiClient.get<{ data: SkillMetrics }>(`/api/v1/ai/skill-metrics?days=${days}`)
      .then((r) => { const d = r?.data as unknown as Record<string, unknown>; setM((d?.skills ? d : d?.data) as SkillMetrics); })
      .catch((e: { message?: string }) => setErr(e?.message ?? '조회 실패'));
  }, [days]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6" data-panel="ai-skill-metrics">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-900"><T k="진료 보조 스킬 계측" /> <span className="text-xs font-normal text-gray-400"><T k="호출 N · 출처 3상태 · 지연 · 검증 폐기 사유" /></span></h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-[11px] border border-gray-200 rounded-lg px-2 py-1">
          <option value={7}>{tAttr('7일')}</option><option value={30}>{tAttr('30일')}</option><option value={90}>{tAttr('90일')}</option>
        </select>
      </div>
      {err && <QueryErrorFallback error={new Error(err)} onRetry={load} size="compact" />}
      {m && m.skills.length === 0 && <p className="text-xs text-gray-400"><T k="이 기간 스킬 호출 기록 없음(Ai*Outcome 감사행 기준 · 2026-08-19 이후 배선) — 사용 실적 0 은 사실이다." /></p>}
      {m && m.skills.length > 0 && (
        <table className="w-full text-[11px]">
          <thead className="text-gray-500 border-b border-gray-100"><tr>
            <th className="text-left py-1"><T k="스킬" /></th><th className="text-right"><T k="호출@AI" /></th><th className="text-right"><T k="AI 통과 n/N" /></th><th className="text-right">FALLBACK</th><th className="text-right">p50</th><th className="text-right">p95</th><th className="text-left pl-2"><T k="폐기 사유(검증)" /></th><th className="text-left pl-2"><T k="사유(기타)" /></th>
          </tr></thead>
          <tbody>
            {m.skills.map((s) => (
              <tr key={s.skill} className="border-b border-gray-50">
                <td className="py-1">{SKILL_LABEL[s.skill] ?? s.skill}</td>
                <td className="text-right tabular-nums">{s.calls}</td>
                <td className="text-right tabular-nums"><Ratio numerator={s.aiOk} denominator={s.calls} /></td>
                <td className="text-right tabular-nums">{s.bySource.FALLBACK ?? 0}</td>
                <td className="text-right tabular-nums">{s.latencyP50Ms == null ? '—' : formatNum(s.latencyP50Ms / 1000, 'seconds')}</td>
                <td className="text-right tabular-nums">{s.latencyP95Ms == null ? '—' : formatNum(s.latencyP95Ms / 1000, 'seconds')}</td>
                <td className="pl-2 text-amber-700">{Object.entries(s.verifyFailed).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</td>
                <td className="pl-2 text-gray-500">{Object.entries(s.reasons).filter(([k]) => !k.startsWith('VERIFY_REJECTED')).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m && <p className="text-[11px] text-gray-400 mt-2"><T k="기준" /> <KDate value={m.generatedAt} mode="datetime" /> · {m.note}</p>}
    </div>
  );
}

// ── AI 피드백 대시보드(A-9) — 기능별 👍/👎 집계·부정 코멘트(프롬프트 개선 우선순위) ──
interface FeedbackStats {
  days: number; total: number;
  features: { feature: string; good: number; bad: number; neutral: number; total: number; badRate: number | null }[];
  recentBad: { feature: string; comment: string | null; model: string | null; at: string }[];
}

const FEATURE_LABEL: Record<string, string> = {
  ddx: '감별진단', soap: 'SOAP 초안', lab: '검사해석', drug: '약물추천', GENERAL: '일반',
};

function AiFeedbackDashboard() {
  const tAttr = useTAttr();
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiClient.get<{ data: FeedbackStats }>(`/api/v1/ai/feedback/stats?days=${days}`)
      .then((r) => { const d = r?.data as unknown as Record<string, unknown>; setStats((d?.features ? d : d?.data) as FeedbackStats); })
      .catch(() => setStats(null));
  }, [open, days]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <span>📊 {AI_ORIGIN_TEXT} 피드백 대시보드</span>
          <span className="text-xs font-normal text-gray-400">{open ? '접기 ▲' : '탭별 👍/👎 집계 보기 ▼'}</span>
        </button>
        {open && (
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-xs">
            <option value={7}>{tAttr('최근 7일')}</option>
            <option value={30}>{tAttr('최근 30일')}</option>
            <option value={90}>{tAttr('최근 90일')}</option>
          </select>
        )}
      </div>
      {open && (
        stats == null ? <p className="text-xs text-gray-400 mt-3"><T k="불러오는 중…" /></p>
        : stats.total === 0 ? <p className="text-xs text-gray-400 mt-3"><T k="기간 내 피드백이 없습니다 — 환자차트 AI 패널의 탭별 👍/👎로 수집됩니다" /></p>
        : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {stats.features.map(f => (
                <div key={f.feature} className={`rounded-xl border p-3 ${f.badRate != null && f.badRate >= 30 ? 'border-red-200 bg-red-50/50' : 'border-gray-200'}`}>
                  <p className="text-xs font-bold text-gray-700">{FEATURE_LABEL[f.feature] ?? f.feature}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-sm font-bold text-emerald-600">👍 {f.good}</span>
                    <span className="text-sm font-bold text-red-500">👎 {f.bad}</span>
                    <span className="text-[10px] text-gray-400">/{f.total}<Unit><T k="건" /></Unit></span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400" style={{ width: `${f.total ? Math.round(((f.good) / f.total) * 100) : 0}%` }} />
                  </div>
                  {f.badRate != null && f.badRate >= 30 && <p className="text-[10px] text-red-500 mt-1">부정 {f.badRate}<Unit>%</Unit> — 프롬프트/기능 개선 검토</p>}
                </div>
              ))}
            </div>
            {stats.recentBad.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-600 mb-1.5"><T k="최근 부정 피드백 코멘트" /></p>
                <div className="space-y-1">
                  {stats.recentBad.map((b, i) => (
                    <div key={i} className="text-[11px] bg-gray-50 rounded-lg px-2.5 py-1.5 flex items-start gap-2">
                      <span className="shrink-0 font-bold text-gray-500">[{FEATURE_LABEL[b.feature] ?? b.feature}]</span>
                      <span className="text-gray-600">{b.comment}</span>
                      <span className="ml-auto shrink-0 text-gray-300">{kdate(new Date(b.at))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

/**
 * 🔴 W8-R6/F — AI 서버가 죽어도 초록 "정상 연결"이던 화면.
 * 서버는 실패를 HTTP 200 `{connected:false, error}` 로 downgrade 하는데, 이 화면은 **요청이 200 이기만 하면**
 * status='ok'(초록)로 칠했고, 상세 그리드에서 `error` 키를 `.filter` 로 **명시적으로 제거**해 사유까지 지웠다.
 *   → `connected` 를 반드시 읽고, 사유(error)를 지우지 않는다. (P17: 안전·상태 화면의 초록은 근거를 묻는다)
 */
function AiServerStatus() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  /**
   * 🔴 상류 401/403 = **키 인증 실패**. "서버가 죽었다"와 다른 사실이라 조치가 다르다(재시도가 아니라 키 교체).
   *    종전 서버는 401 을 보면 하드코딩 조직정보로 테넌트를 재등록해 새 키를 몰래 받았다(2026-09-09 R6 에서 제거) —
   *    이제 아무도 대신 고쳐주지 않으므로 **화면이 사람에게 말해야** 한다.
   */
  const [authFailed, setAuthFailed] = useState(false);

  const testConnection = async () => {
    setStatus('loading');
    setError('');
    setAuthFailed(false);
    try {
      const res = await apiClient.get<{ data: Record<string, unknown> }>('/api/v1/ai/status');
      const resData = res?.data as Record<string, unknown> | null | undefined;
      const nested = resData?.data;
      const d = (typeof nested === 'object' && nested !== null ? nested : resData) as Record<string, unknown> | null;
      setInfo(d);
      // HTTP 200 ≠ 연결 정상. connected 가 명시적으로 true 일 때만 초록.
      if (d?.connected === true) {
        setStatus('ok');
      } else {
        const reason = typeof d?.error === 'string' && d.error ? d.error : `${AI_ORIGIN_TEXT} 서버가 응답하지 않습니다`;
        setError(d?.connected === false ? reason : `연결 여부를 확인할 수 없습니다(connected 미보고) — ${reason}`);
        setAuthFailed(d?.authFailed === true || d?.reason === 'UPSTREAM_AUTH');
        setStatus('error');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `${AI_ORIGIN_TEXT} 서버에 연결할 수 없습니다`);
      setStatus('error');
    }
  };

  useEffect(() => { testConnection(); }, []);

  return (
    <div className={`rounded-2xl border p-5 mb-6 ${
      status === 'ok' ? 'bg-emerald-50 border-emerald-200' :
      status === 'error' ? 'bg-red-50 border-red-200' :
      'bg-gray-50 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            status === 'ok' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-gray-400'
          }`}>
            <span className="text-white text-lg">{CATEGORY_ICON['ai']}</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{AI_ORIGIN_TEXT} 서버 연결 상태</h3>
            <p className={`text-xs font-medium ${
              status === 'ok' ? 'text-emerald-600' : status === 'error' ? 'text-red-600' : 'text-gray-500'
            }`}>
              {status === 'loading' ? '연결 테스트 중...' :
               status === 'ok' ? '정상 연결' :
               status === 'error' ? (authFailed ? `키 인증 실패 — 키 교체 필요: ${error}` : `연결 실패: ${error}`) :
               '연결 상태를 확인하세요'}
            </p>
          </div>
        </div>
        <button onClick={testConnection} disabled={status === 'loading'}
          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {status === 'loading' ? '테스트 중...' : '연결 테스트'}
        </button>
      </div>
      {/* 🔴 키 인증 실패는 "재시도"로 풀리지 않는다 — 무엇을 해야 하는지 그 자리에서 말한다.
          (자동 재발급은 없다: 하드코딩 조직정보로 몰래 새 키를 받던 경로를 제거했다) */}
      {authFailed && (
        <div data-ai-auth-failed className="rounded-xl border border-red-300 bg-red-100 px-3 py-2 mb-3 text-xs text-red-800">
          <strong className="font-semibold">키 인증 실패(401/403)</strong> — 아래 <code className="font-mono">ai.server.apiKey</code> 를
          유효한 키로 교체하세요. 시스템은 키를 자동으로 재발급하지 않습니다(발급은 사람 승인 경로).
        </div>
      )}
      {/* 🔴 기존: status==='ok' 일 때만·`error` 키를 제거하고 렌더 → 실패 사유가 화면에서 사라졌다.
          이제 실패 시에도 응답 그대로(사유 포함) 보여준다. */}
      {(status === 'ok' || status === 'error') && info && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {Object.entries(info).slice(0, 8).map(([k, v]) => (
            <div key={k} className={`rounded-lg px-3 py-2 ${k === 'error' ? 'bg-red-100' : 'bg-white'}`}>
              <p className="text-[10px] text-gray-400">{k}</p>
              <p className={`text-xs font-medium truncate ${k === 'error' ? 'text-red-700' : 'text-gray-900'}`}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WeRU.B 채팅 테스트 ──
function AiChatTest() {
  const tAttr = useTAttr();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    const now = kdate(new Date(), 'time');
    setMessages(p => [...p, { role: 'user', text: userMsg, time: now }]);
    setLoading(true);
    try {
      // 🔴 종전엔 snake_case(`treatment_plan`·`patient_level`)로 보냈다 — DTO 는 camelCase 라
      //    whitelist 가 지웠고, `treatmentPlan` 이 @IsNotEmpty 필수라 **요청이 항상 400** 이었다.
      //    관리자 테스트 챗이 개통 이래 한 번도 응답을 받은 적이 없다(화면은 "오류:"만 찍었다).
      const res = await apiClient.post<Record<string, unknown>>('/api/v1/ai/explain', {
        diagnosis: userMsg,
        treatmentPlan: `관리자 ${AI_ORIGIN_TEXT} 테스트`,
        patientLevel: 'professional',
      });
      const resData = res?.data as Record<string, unknown> | undefined;
      const innerData = resData?.data as Record<string, unknown> | undefined;
      const explanation = resData?.explanation ?? innerData?.explanation ?? JSON.stringify(resData);
      setMessages(p => [...p, { role: 'ai', text: typeof explanation === 'string' ? explanation : JSON.stringify(explanation, null, 2), time: kdate(new Date(), 'time') }]);
    } catch (e: unknown) {
      setMessages(p => [...p, { role: 'ai', text: `오류: ${e instanceof Error ? e.message : '요청 실패'}`, time: kdate(new Date(), 'time') }]);
    }
    setLoading(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-4 flex items-center gap-3 hover:shadow-md transition-all mb-6">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
          <span className="text-white text-lg">💬</span>
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold text-gray-900">{AI_ORIGIN_TEXT} 채팅 테스트</p>
          <p className="text-xs text-gray-500">{AI_ORIGIN_TEXT} 서버에 직접 질문을 보내 응답을 확인합니다</p>
        </div>
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden mb-6">
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-white text-lg">💬</span>
          <p className="text-white text-sm font-semibold">{AI_ORIGIN_TEXT} 채팅 테스트</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-sm"><T k="닫기" /></button>
      </div>

      {/* 메시지 영역 */}
      <div className="h-64 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400">{AI_ORIGIN_TEXT} 서버에 질문을 입력하세요</p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-3">
              {['고혈압 치료 가이드', '아스피린 약물 정보', '당뇨병 관리 요약'].map(q => (
                <button key={q} onClick={() => { setInput(q); }}
                  className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-full text-indigo-600 hover:bg-indigo-50">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
              m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{m.text}</p>
              <p className={`text-[9px] mt-1 ${m.role === 'user' ? 'text-indigo-200' : 'text-gray-400'}`}>{m.time}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="border-t p-3 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
          placeholder={tAttr('질문을 입력하세요... (예: 고혈압 약물 치료)')}
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
        <button onClick={send} disabled={loading || !input.trim()}
          className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors">
          <T k="전송@버튼" />
        </button>
      </div>
    </div>
  );
}

// ── 선택형 설정 옵션 정의 ──
/**
 * QI 흐름 설정(2026-10-09) — 기능이 알아듣는 값만 고르게 한다(서버도 같은 규칙으로 거른다 · shared `QI_FLOW_SETTING_ALLOWED`).
 * '' = 미설정(저장 시 null 로 보낸다).
 */
const QI_FLOW_SELECT: Record<string, { value: string; label: string }[]> = Object.fromEntries(
  Object.entries(QI_FLOW_SETTING_ALLOWED)
    .filter(([, rule]) => rule !== 'DATE' && !(rule as readonly unknown[]).every((v) => typeof v === 'boolean'))
    .map(([key, rule]) => [key, [{ value: '', label: '(미설정)' }, ...(rule as readonly string[]).map((v) => ({ value: v, label: v }))]]),
);
/**
 * 결정 등록부 배치 10-F 설정(2026-10-10) — 어휘 규칙인 키는 고르게 한다(서버도 같은 규칙 · shared `DECIDED_SETTING_ALLOWED`).
 * 정수 범위 키는 숫자 입력 그대로(서버가 범위 밖을 거른다). '' = 미설정(null).
 */
const DECIDED_SELECT: Record<string, { value: string; label: string }[]> = Object.fromEntries(
  Object.entries(DECIDED_SETTING_ALLOWED)
    .filter(([, rule]) => Array.isArray(rule) && rule.every((v) => typeof v === 'string'))
    .map(([key, rule]) => [key, [{ value: '', label: '(미설정)' }, ...(rule as readonly string[]).map((v) => ({ value: v, label: v }))]]),
);
/** 위원회 결정에 묶인 설정 → 결정 키(여기서 바꾸면 '관리자 직접 변경'으로 남는다) */
const QI_FLOW_DECISION_OF: Record<string, string> = Object.fromEntries(QI_FLOW_SETTING_KEYS.map((k) => [k.key, k.decisionKey]));

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  ...QI_FLOW_SELECT,
  ...DECIDED_SELECT,
  'pharmacy.defaultType': [
    { value: 'INTERNAL', label: '원내 조제' },
    { value: 'EXTERNAL', label: '원외 처방' },
  ],
  'clinical.encounter.defaultType': [
    { value: 'OUTPATIENT', label: '외래' },
    { value: 'INPATIENT', label: '입원' },
    { value: 'EMERGENCY', label: '응급' },
  ],
  'billing.receiptFormat': [
    { value: 'STANDARD', label: '표준 영수증' },
    { value: 'DETAILED', label: '상세 영수증' },
  ],
  'blockchain.patientCertPolicy': [
    { value: 'manual', label: '수동 발급' },
    { value: 'auto-verified', label: '본인인증 후 자동' },
    { value: 'auto-email', label: '이메일 인증 후 자동' },
    { value: 'auto-all', label: '전체 자동 발급' },
  ],
  'ai.model': [
    { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B (경량)' },
    { value: 'qwen2.5:14b', label: 'Qwen 2.5 14B (기본)' },
    { value: 'qwen2.5:32b', label: 'Qwen 2.5 32B (고성능)' },
    { value: 'llama3.1:8b', label: 'Llama 3.1 8B' },
    { value: 'gemma2:9b', label: 'Gemma 2 9B' },
  ],
  // 접근성(§4.6) — 자유 입력으로 두면 범위 밖 값(0.2·5)이 들어와 FE 가 조용히 기본값으로 되돌린다
  // ("저장했는데 안 바뀐다"). 채택 범위만 고르게 한다. 🔴 기본값 1.0 = 현행(변화 없음).
  'ui.a11y.textScale': [
    { value: '0.9', label: '0.9배 (촘촘하게)' },
    { value: '1', label: '1.0배 — 현행(변화 없음)' },
    { value: '1.1', label: '1.1배' },
    { value: '1.25', label: '1.25배' },
    { value: '1.4', label: '1.4배' },
    { value: '1.6', label: '1.6배 (최대)' },
  ],
  'ui.a11y.contrast': [
    { value: 'NORMAL', label: 'NORMAL — 현행(변화 없음)' },
    { value: 'HIGH', label: 'HIGH — 회색 본문 한 단계 어둡게(야간·저시력)' },
  ],
};

// API Key 필드 (마스킹 표시)
const API_KEY_FIELDS = ['ai.server.apiKey', 'ai.server.gpuKey'];

/**
 * 🔴 W8-R6/G — **설정값은 저장되지만 아무도 그 값으로 동작하지 않는 키**.
 * 실측(2026-08-14): 아래 3키는 정의(config-runtime)만 있고 **코드 전역 소비처 0**이다.
 * 화면이 "설정됨"이라 말하면 개인정보 파기·암호화가 되고 있다고 오인된다(P16: 안 하고 했다고 말하지 않기).
 * 자동 파기는 급조하지 않는다 — **데이터 삭제는 되돌릴 수 없다**. 배선 전까지는 화면이 사실을 말한다.
 */
const UNWIRED_CONFIG_NOTE: Record<string, string> = {
  // 🔴 2026-09-23: 두 키는 **배선됐다**(보존 엔진 `SCRIBE_TRANSCRIPT` 핸들러가 읽는다) —
  //    고지를 남겨 두면 화면이 기능을 실제보다 **못하다고** 말한다. 다만 읽힌다고 파기가 도는 것은 아니다:
  //    전역 `retention.purgeEnabled`·정책 `action`·`legalConfirmed`·기간 출처(기본값이면 거부)·4-eyes 를
  //    전부 지나야 나간다. 그 상태는 `/admin/retention` 이 말한다.
  'scribe.audio.encryptAtRest':
    '⚠️ 설정값은 저장되나 저장 시 암호화는 적용되지 않습니다(소비처 0) — 켜도 평문으로 저장됩니다.',
  // 🔴 아래는 2026-08-28 설정 소비처 전수 스캔에서 **손으로 검증한** 것들이다.
  //    각 문구는 "안 먹는다"로 끝내지 않고 **실제로 무엇이 정하는가**를 말한다 —
  //    안 그러면 관리자가 "그럼 지금은 어떻게 되고 있나"를 알 길이 없다.

  // 🔴 2026-08-28 2차 검증분. **청구 금액 다이얼 6개가 죽어 있었다** —
  //    관리자는 살아 있는 키와 죽은 키를 같은 화면에서 구분할 수 없었다.
  'billing.fee.admission.general':
    '⚠️ 설정값은 저장되나 입원료에 쓰이지 않습니다(소비처 0) — 실제 일당은 ①수가코드 단가 ②inpatient.bedRates(병상등급별) ③inpatient.dailyRate ④50,000원 순으로 정해집니다. 바꾸려면 inpatient.* 를 쓰세요.',
  'billing.fee.meal.general':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 환자 식대 청구가 구현되어 있지 않습니다(직원 식대 정산은 급양 모듈의 별도 기능입니다).',
  'billing.fee.dispensing.external':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 원내 조제료(billing.fee.dispensing.internal)만 청구에 반영됩니다. 원외 처방료는 현재 청구되지 않습니다.',
  'billing.discount.senior.age':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 경로우대 감면 기능 자체가 구현되어 있지 않습니다.',
  'billing.defaultCopayRate':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 본인부담률은 자격 정본(EligibilityService)이 정합니다: 비급여 > 감면 자격 > 코드별 특례 > 자격 기본율.',
  'billing.copay.nhi.pharmacy':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 약국 본인부담률이 청구 경로에 반영되지 않습니다.',

  'clinical.consent.requiredForSurgery':
    '⚠️ 이 설정으로 끌 수 없습니다(소비처 0) — 수술 안전 체크리스트(WHO·IPSG.4)의 "동의서 서명"이 Sign-In 필수 항목으로 **항상** 강제됩니다.',
  'terminal.lock.publicSec':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 공용 단말 잠금은 180초 기본값이며, 바꾸려면 단말별 등록 설정(단말 보안 화면)의 잠금 시간을 씁니다.',
  'terminal.lock.privateSec':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 전용 단말 잠금은 600초 기본값이며, 바꾸려면 단말별 등록 설정(단말 보안 화면)의 잠금 시간을 씁니다.',
  'portal.signup.enabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 환자 포털 회원가입은 이 값과 무관하게 항상 허용됩니다. 끄려면 별도 구현이 필요합니다.',

  // 🔴 2026-08-28 3차 검증분. **확인한 것만 적는다** — 실제 정본을 못 찾은 키는
  //    "소비처 0"만 말하고 아는 척하지 않는다.
  'ai.temperature':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 실제 생성 파라미터는 temperature 0.7 고정입니다(medical-ai.service.ts). 모델 선택(ai.model)만 설정이 반영됩니다.',
  'ai.maxTokens':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 실제 응답 길이는 호출부별 상한(기본 num_predict 1024)이 정합니다.',
  'portal.jwt.expiresMinutes':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 포털 세션은 30분 고정입니다(portal.service.ts).',
  'portal.patientApp.jwtExpiresHours':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 환자앱 액세스 토큰은 1시간, 리프레시는 30일 고정입니다(patient-auth.service.ts).',
  'inventory.alertThreshold':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 재고 부족 판정은 **품목별 안전재고(safetyStock)** 로 합니다(등록 시 기본 10). 품목 화면에서 조정하세요.',
  'eligibility.patriotApiUrl':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다 — 보훈 자격조회가 아직 구현되지 않았습니다(호출 코드가 주석 상태).',
  'sign.jwksUrl':
    '⚠️ 이 시스템 코드에는 소비처가 없습니다 — 외부 전자서명(sign) 서비스가 참조하는 값일 수 있으나 이 저장소에서는 확인할 수 없습니다.',

  // 🔴 2026-08-28 4차. 배선한 것(미수납 알림·멸균 유효기간·상담 운영 정책)은 여기서 뺐다.
  'clinical.queue.avgConsultMinutes':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 대기 예측은 **스테이션별 실측 평균**으로 계산하고, 표본이 없으면 값을 내지 않고 비워 둡니다(전역 평균으로 채우지 않습니다).',
  'inpatient.insuranceRate':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 2026-10-22부터 입원 중간정산 본인부담은 퇴원 입원료 청구와 같이 환자 자격별 급여율로 정합니다(80% 고정이 아닙니다).',
  'pharmacy.rxValidDays':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 원외 처방전 유효기간은 3일로 고정돼 있습니다(처방·원격진료 두 곳). 🔴 이 값이 법정 기한인지 원내 정책인지는 확인되지 않았습니다 — 바꾸기 전에 근거를 확인하세요.',
  'pharmacy.defaultType':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 조제 유형을 지정하지 않으면 원내(INTERNAL)로 고정됩니다.',
  'pharmacy.externalEnabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 원외 처방은 이 값과 무관하게 허용됩니다.',
  'portal.telehealth.enabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 원격진료 기능은 이 값과 무관하게 동작합니다.',
  'portal.questionnaire.reminderDays':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 문진표 사전 알림 기능이 구현되어 있지 않습니다.',
  'appointment.defaultDuration':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 예약 슬롯 길이를 이 값으로 정하는 코드가 없습니다.',
  'appointment.workingHours':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 진료 시간은 진료과·의사별 일정이 정합니다.',
  'clinical.encounter.defaultType':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 진료 유형은 접수 경로가 정합니다(외래·입원·응급).',
  'clinical.encounter.followUpDays':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 재진 간격을 이 값으로 제안하는 코드가 없습니다.',
  'billing.receiptFormat':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 영수증 형식을 이 값으로 나누는 코드가 없습니다.',
  'billing.taxDeductionEnabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 연말정산 증빙 기능이 구현되어 있지 않습니다.',
  'billing.onlinePaymentEnabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — PG 연동이 구현되어 있지 않습니다. 🔴 켜도 온라인 결제가 열리지 않습니다.',
  'ai.greeting.enabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 날씨 인사 기능을 이 값으로 끄고 켜는 코드가 없습니다.',
  'voiceEmr.stt.chunkMs':
    '⚠️ 설정값은 저장되나 서버에서 쓰이지 않습니다(소비처 0) — STT 청크 주기는 클라이언트가 정합니다.',
  'voiceEmr.stt.confHold':
    '⚠️ 설정값은 저장되나 서버에서 쓰이지 않습니다(소비처 0) — 신뢰도 보류 판정을 이 값으로 하는 서버 코드가 없습니다.',
  'voiceEmr.speaker.enabled':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 화자 게이트(내 음성만 명령)가 아직 배선되지 않았습니다.',
  'scribe.speaker.enabled':
    '⚠️ 이 설정으로 켜고 끌 수 없습니다(소비처 0) — 화자 귀속은 세그먼트에 화자가 기록돼 있으면 **항상** 적용됩니다(환자 발화는 SOAP 에서 제외).',
  'staffPortal.platform':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 생체인증 포털 플랫폼을 이 값으로 가르는 코드가 없습니다.',
  'voc.consult.autoOnlineOnLogin':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 데스크 로그인 시 상담원 자동 ONLINE 전환이 배선되지 않았습니다.',
  'voc.consult.offlineFallback':
    '⚠️ 설정값은 저장되나 쓰이지 않습니다(소비처 0) — 시간외 비동기 접수 폴백을 이 값으로 켜고 끄는 코드가 없습니다.',
};

// 안전 게이트 3상(OFF/WARN/BLOCK) — 설명에 "OFF|WARN|BLOCK"이 포함된 문자열 설정을 자동 감지해
// 드롭다운으로 렌더(자유 텍스트 오타 → fail-closed BLOCK 오동작 방지). 신규 게이트 키 자동 커버.
const GATE_ENUM_OPTIONS = [
  { value: 'OFF', label: 'OFF — 게이트 끔' },
  { value: 'WARN', label: 'WARN — 경고(허용+로그)' },
  { value: 'BLOCK', label: 'BLOCK — 차단(강제)' },
];

/* ── AI 임상 기능 스위치 ↔ 결정 등록부(R3) ─────────────────────────────────────────
 * 🔴 실측(2026-08-28)에서 아래 6개가 **켜진 채 운영되고 있는데 누가 켰는지도, 근거도 없었다.**
 *    화면은 그것을 "정책"인 것처럼 보여줬다. 그래서 스위치 옆에 **결정 기록 유무**를 붙인다.
 *    ON 인데 기록이 없으면 그 사실을 말한다 — 켜져 있다는 것과 결정됐다는 것은 다른 사실이다.
 * 🔴 조회 실패·항목 부재는 "기록 없음"이 아니라 **확인 불가**다(못 물어본 것을 단정하지 않는다).
 *    단건 조회 EP 가 없어 목록 EP 를 한 번 읽는다(폴링하지 않는다).
 */
const AI_CLINICAL_DECISION_KEY = 'policy.ai.clinicalFeatureScope';
const AI_CLINICAL_FEATURE_KEYS = [
  'ai.server.enabled',
  'scribe.enabled',
  'voiceEmr.enabled',
  'voiceEmr.ambient.enabled',
  'voiceEmr.ambient.aiDraft.enabled',
  'nursing.aiAssist.enabled',
];

interface DecisionListRow { key: string; decided?: boolean; record?: { choice?: string; decidedAt?: string } | null }
type DecisionState =
  | { phase: 'loading' }
  | { phase: 'unavailable'; reason: string }
  | { phase: 'recorded'; choice: string | null }
  | { phase: 'missing' };

function ClinicalDecisionBadge({ state }: { state: DecisionState }) {
  if (state.phase === 'loading') {
    // 🔴 아직 안 온 것을 "기록 없음"이라 말하지 않는다
    return <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded whitespace-nowrap">결정 기록 확인 중…</span>;
  }
  if (state.phase === 'unavailable') {
    return (
      <span className="text-[10px] font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap" title={state.reason}>
        켜져 있음 · 결정 기록 확인 불가
      </span>
    );
  }
  if (state.phase === 'recorded') {
    return (
      <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded whitespace-nowrap">
        결정 {AI_CLINICAL_DECISION_KEY} 기록됨{state.choice ? ` (${state.choice})` : ''}
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded whitespace-nowrap">
      🔴 켜져 있음 · 결정 기록 없음
    </span>
  );
}

export default function AiSettingsPage() {
  const tAttr = useTAttr();
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string | number | boolean | Record<string, unknown>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  // 🔴 종전엔 저장 실패를 `catch {}` 로 삼켰다 — 보호 키(예: ai.server.url)를 저장하면 화면이 아무 말도
  //    하지 않아 "저장된 줄 알고" 떠났다. 서버가 거절한 이유를 그대로 보여준다(FE 에 보호 목록을 복제하지
  //    않는다 — 정본이 둘이면 갈라진다).
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState('general');
  const [decisionState, setDecisionState] = useState<DecisionState>({ phase: 'loading' });

  const loadConfigs = useCallback(async () => {
    const res = await apiClient.get<{ data: ConfigItem[] }>('/api/v1/config');
    setConfigs(res.data);
    const vals: Record<string, string | number | boolean | Record<string, unknown>> = {};
    for (const c of res.data) vals[c.key] = c.value;
    setEditValues(vals);
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  // 결정 등록부 1회 조회 — 실패는 '확인 불가'로 말한다(기본값으로 접지 않는다)
  useEffect(() => {
    let alive = true;
    // 🔴 응답은 `{ data: { items, layers, tracks, summary, ... } }` 다(등록부 컨트롤러 실측).
    //    배열로 가정하면 조회는 성공했는데 화면은 영원히 "확인 불가"가 된다 — 계약은 읽어서 맞춘다.
    apiClient.get<{ data: { items?: DecisionListRow[] } }>('/api/v1/admin/decisions')
      .then((r) => {
        if (!alive) return;
        const rows = Array.isArray(r?.data?.items) ? r.data.items : null;
        if (!rows) { setDecisionState({ phase: 'unavailable', reason: '결정 등록부 응답 형식을 읽지 못했습니다' }); return; }
        const row = rows.find((d) => d.key === AI_CLINICAL_DECISION_KEY);
        // 🔴 등록부에 항목 자체가 없는 것은 "기록 없음"이 아니다 — 물어볼 곳이 없는 것이다
        if (!row) { setDecisionState({ phase: 'unavailable', reason: `등록부에 ${AI_CLINICAL_DECISION_KEY} 항목이 없습니다` }); return; }
        setDecisionState(row.decided ? { phase: 'recorded', choice: row.record?.choice ?? null } : { phase: 'missing' });
      })
      .catch((e: { message?: string }) => {
        if (!alive) return;
        setDecisionState({ phase: 'unavailable', reason: e?.message ?? '결정 등록부 조회 실패' });
      });
    return () => { alive = false; };
  }, []);

  const handleSave = async (key: string) => {
    setSaving(p => ({ ...p, [key]: true }));
    try {
      let val: unknown = editValues[key];
      // QI 흐름 설정 — 빈 선택 = 미설정(null)
      if ((key in QI_FLOW_SETTING_ALLOWED || key in DECIDED_SETTING_ALLOWED) && val === '') val = null;
      // 숫자 변환
      if (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val)) val = Number(val);
      // boolean 변환
      if (val === 'true') val = true;
      if (val === 'false') val = false;
      await apiClient.put(`/api/v1/config/${encodeURIComponent(key)}`, { value: val });
      setErrors(p => { const n = { ...p }; delete n[key]; return n; });
      setSaved(p => ({ ...p, [key]: true }));
      setTimeout(() => setSaved(p => ({ ...p, [key]: false })), 2000);
    } catch (e) {
      setErrors(p => ({ ...p, [key]: (e as Error)?.message || '저장에 실패했습니다(사유 미상)' }));
    }
    setSaving(p => ({ ...p, [key]: false }));
  };

  const categories = [...new Set(configs.map(c => c.category))];
  const filteredConfigs = configs.filter(c => c.category === activeCategory);

  return (
    <div className="max-w-[1000px] mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="시스템 설정" /></h2>
        <p className="text-sm text-gray-500 mt-1">병원 기본 정보, {AI_ORIGIN_TEXT} 설정, 진료/수납 설정을 관리합니다</p>
        {/*
          🔴 「시스템 설정」이라는 이름이 두 화면에 있었다(2026-09-13 외부 실측 S8).
             **값을 바꾸는 화면은 여기 하나**다(`PUT /api/v1/config/:key`) — 그 사실을 화면이 말한다.
             `/admin/config` 는 같은 값을 출처 배지(설정됨/기본값/미등재/환경변수)와 함께 보는 읽기 전용 목록이다.
        */}
        <p className="text-xs text-gray-400 mt-1">
          <Tf
            k="설정값을 바꾸는 화면입니다 — 값의 출처만 보려면 {목록} 을 여세요."
            params={{ 목록: <Link href="/admin/config" className="text-blue-600 underline"><T k="설정값 목록(읽기 전용)" /></Link> }}
          />
        </p>
      </div>

      {/* WeRU.B 서버 상태 */}
      <AiServerStatus />

      {/* WeRU.B 채팅 테스트 */}
      <AiChatTest />

      {/* 하이브리드 브리핑 스위치(chart-ai-assistant-agent §4.6-a) */}
      <AiBriefSwitches />

      {/* 진료 보조 스킬 계측(chart-ai-assistant-agent P0) */}
      <AiSkillMetrics />

      {/* 스킬 품질 임계(chart-ai-assistant-agent §6-1 모델 품질 기준 — 문서 안의 사람 게이트를 화면으로) */}
      <AiSkillQuality />

      {/* AI 초안 무수정 승인율(chart-ai-assistant-agent P2) */}
      <AiDraftMetrics />

      {/* 모델 호출 분포 · 모델 정합(ai-judgment-governance §2.2 — 어느 모델이 언제 무엇을 했는가) */}
      <AiCallStatsCard />
      <AiModelFitCard />

      {/* WeRU.B 피드백 대시보드(A-9) */}
      <AiFeedbackDashboard />

      {/* 운영 모드(개발·리허설·리얼) — 빌드 상한 + 런타임 토글 */}
      <HisModePanel />

      {/* Category Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100/80 p-1 rounded-xl w-fit flex-wrap">
        {categories.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
              activeCategory === cat ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <span>{CATEGORY_ICON[cat] ?? '⚙️'}</span>
            {CATEGORY_LABEL[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Settings Grid */}
      <div className="space-y-3">
        {filteredConfigs.map(config => {
          const val = editValues[config.key];
          const isBoolean = typeof config.value === 'boolean';
          const isNumber = typeof config.value === 'number';
          const isObject = typeof config.value === 'object' && config.value !== null;
          const isGateEnum = !SELECT_OPTIONS[config.key] && typeof config.value === 'string'
            && /OFF\|WARN\|BLOCK/.test(config.description ?? '');
          const gateOpts = isGateEnum
            ? (GATE_ENUM_OPTIONS.some(o => o.value === String(val)) || val == null || val === ''
                ? GATE_ENUM_OPTIONS
                : [{ value: String(val), label: `${String(val)} (현재값 — 비표준)` }, ...GATE_ENUM_OPTIONS])
            : undefined;
          const selectOpts = SELECT_OPTIONS[config.key] ?? gateOpts;
          const isApiKey = API_KEY_FIELDS.includes(config.key);

          return (
            <div key={config.key} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-900">{config.description}</p>
                  <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{config.key}</span>
                  {UNWIRED_CONFIG_NOTE[config.key] && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"><T k="미배선" /></span>
                  )}
                  {/* 🔴 개발 시드 값은 원내가 정한 값이 아니다 — 저장하면(같은 값이라도) 원내 값이 된다 */}
                  {config.seeded && (
                    <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded" title={tAttr(CONFIG_SEEDED_HINT)} data-config-seeded={config.key}><T k={CONFIG_SEEDED_TEXT} /></span>
                  )}
                  {/* 🔴 AI 임상 기능이 ON 이면 그 근거(결정 기록)를 그 자리에서 말한다 — 저장된 값 기준(편집 중 값 아님) */}
                  {AI_CLINICAL_FEATURE_KEYS.includes(config.key) && config.value === true && (
                    <ClinicalDecisionBadge state={decisionState} />
                  )}
                </div>
                {QI_FLOW_DECISION_OF[config.key] && (
                  <p className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 mb-1" data-config-committee-bound={config.key}>
                    <T k="위원회 결정에 묶인 설정입니다 — 여기서 바꾸면 질 지표 화면에 '관리자 직접 변경'으로 표시됩니다. 정식 경로는 결정 화면에서 위원회 상정입니다." />{' '}
                    <Link href={`/admin/decisions/${encodeURIComponent(QI_FLOW_DECISION_OF[config.key])}`} className="underline">{QI_FLOW_DECISION_OF[config.key]}</Link>
                  </p>
                )}
                {UNWIRED_CONFIG_NOTE[config.key] && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-1">
                    {UNWIRED_CONFIG_NOTE[config.key]}
                  </p>
                )}

                {/* 선택형 (콤보박스) */}
                {selectOpts ? (
                  <select
                    value={String(val ?? '')}
                    onChange={e => setEditValues(p => ({ ...p, [config.key]: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {selectOpts.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : isBoolean ? (
                  <button
                    onClick={() => { setEditValues(p => ({ ...p, [config.key]: !val })); }}
                    className={`mt-1 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${val ? 'bg-blue-600' : 'bg-gray-200'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${val ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                ) : isObject ? (
                  <textarea
                    value={JSON.stringify(val, null, 2)}
                    onChange={e => { try { setEditValues(p => ({ ...p, [config.key]: JSON.parse(e.target.value) })); } catch {} }}
                    rows={3}
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ) : isApiKey ? (
                  <div className="mt-1 flex gap-2">
                    <input
                      type="password"
                      value={String(val ?? '')}
                      onChange={e => setEditValues(p => ({ ...p, [config.key]: e.target.value }))}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={() => { navigator.clipboard.writeText(String(val ?? '')); }}
                      className="px-2.5 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 shrink-0" title={tAttr('복사')}>
                      📋
                    </button>
                  </div>
                ) : (
                  <input
                    type={isNumber ? 'number' : 'text'}
                    value={typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}
                    onChange={e => setEditValues(p => ({ ...p, [config.key]: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                )}
                {errors[config.key] && (
                  <p className="mt-1 text-xs text-red-600">⚠️ 저장되지 않았습니다 — {errors[config.key]}</p>
                )}
              </div>

              <button
                onClick={() => handleSave(config.key)}
                disabled={saving[config.key]}
                className={`mt-6 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex-shrink-0 ${
                  saved[config.key] ? 'bg-emerald-50 text-emerald-600' :
                  'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                }`}>
                {saving[config.key] ? '...' : saved[config.key] ? '✓ 저장됨' : '저장'}
              </button>
            </div>
          );
        })}

        {filteredConfigs.length === 0 && (
          <EmptyState icon="📋" title="설정 항목이 없습니다." />
        )}
      </div>
    </div>
  );
}
