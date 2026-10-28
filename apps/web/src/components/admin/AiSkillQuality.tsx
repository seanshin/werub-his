'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { KDate, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { formatNum } from '@hospital-run/shared';

/**
 * 진료 보조 스킬 **품질 임계** 관제 (기획서 `chart-ai-assistant-agent.plan.md` §4.6 계측 · §6-1 모델 품질 기준).
 *
 * 배경 — 지금까지 "검증 폐기율이 X% 넘는 스킬은 탭에서 내린다"는 **문서 안의 사람 게이트**였다(AI팀·진료부 회신 대기).
 * 이 카드는 그 임계를 운영이 화면에서 정하게 한다. 다만 **감으로 정하지 않도록**, 임계를 넣는 다이얼로그는
 * 그 스킬의 **최근 실측(AI 통과 n/N)** 을 먼저 보여준다(§7 "실측 없이 개선됐다고 적지 않는다").
 *
 * 🔴 규약(이 파일이 지키는 것)
 *  - 통과율은 **분모와 함께**(`<Ratio>`) — 표본 0 은 `0%` 가 아니라 **산출 불가**다.
 *  - 상태는 색만으로 말하지 않는다(색 + 텍스트 배지).
 *  - 기본값은 **미설정(적용 안 함)** — 값을 넣기 전까지 화면은 아무것도 내리지 않는다.
 *  - BLOCK 을 골라도 **숨기지 않는다** — 탭은 남고 사유를 화면이 밝힌다("막으면 방치된다").
 *  - 🔴 세 설정은 **스킬별 맵**이다. 스칼라를 PUT 하면 다른 스킬 설정이 통째로 사라진다(이 저장소의 실사고).
 *    그래서 저장은 **읽고 → 해당 스킬 키만 바꾼 전체 맵을 보낸다**(`putMergedConfigMap`).
 */

export type QualityAction = 'OFF' | 'WARN' | 'BLOCK';

export interface SkillQualityRow {
  skill: string;
  label?: string;
  calls?: number;
  aiOk?: number;
  aiRate?: number | null;
  threshold?: { minAiRate?: number | null; minCalls?: number; action?: string } | null;
  status?: string;
  effect?: string;
  basis?: string;
}

export interface SkillQuality {
  windowDays?: number;
  generatedAt?: string;
  note?: string;
  skills?: SkillQualityRow[];
}

/** 서버 스킬 enum → config 맵의 스킬 키(BE 정본과 같은 어휘) */
export const SKILL_CONFIG_KEY: Record<string, string> = {
  RealtimeDdx: 'realtimeDdx',
  AutoSoap: 'autoSoap',
  InterpretLab: 'interpretLab',
  RecommendDrugs: 'recommendDrugs',
};

const CONFIG_MIN_RATE = 'ai.skill.quality.minAiRate';
const CONFIG_MIN_CALLS = 'ai.skill.quality.minCalls';
const CONFIG_ACTION = 'ai.skill.quality.action';

/** 기본 최소 표본 수(BE 정본과 같은 값) — 표본이 이보다 적으면 임계를 적용하지 않는다 */
const DEFAULT_MIN_CALLS = 20;

const SKILL_FALLBACK_LABEL: Record<string, string> = {
  RealtimeDdx: '감별진단', AutoSoap: 'SOAP 초안', InterpretLab: '검사해석', RecommendDrugs: '약물추천',
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OK: { label: '기준 충족', cls: 'bg-emerald-100 text-emerald-700' },
  DEGRADED: { label: '임계 미달', cls: 'bg-rose-100 text-rose-700' },
  INSUFFICIENT_SAMPLE: { label: '표본 부족', cls: 'bg-amber-100 text-amber-800' },
  UNCONFIGURED: { label: '임계 미설정', cls: 'bg-gray-100 text-gray-600' },
  UNMEASURED: { label: '미측정', cls: 'bg-gray-100 text-gray-600' },
};
const EFFECT_LABEL: Record<string, string> = { NONE: '없음', WARN: '화면에 경고', HIDE: '탭 내림' };

const ACTION_OPTIONS: Array<{ value: QualityAction; label: string; note: string }> = [
  { value: 'OFF', label: 'OFF — 적용 안 함', note: '임계를 재기만 하고 화면은 바뀌지 않습니다' },
  { value: 'WARN', label: 'WARN — 화면에 경고', note: '해당 탭 위에 "통과율이 임계 미만" 경고를 띄웁니다' },
  { value: 'BLOCK', label: 'BLOCK — 탭을 내린다', note: '탭은 남고, 내린 사유를 화면이 밝힙니다' },
];

/**
 * 🔴 맵을 읽는다 — 스칼라가 들어 있으면 **덮어쓰지 않고 멈춘다**.
 *    (스칼라를 맵으로 갈아끼우면 그 값이 무엇을 뜻했는지 화면이 모르는 채 사라진다.)
 */
async function readConfigMap(key: string): Promise<Record<string, unknown>> {
  const res = await apiClient.get<{ data: unknown }>(`/api/v1/config/${encodeURIComponent(key)}`);
  const v = (res as { data?: unknown })?.data;
  if (v == null) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return { ...(v as Record<string, unknown>) };
  throw new Error(`${key} 의 현재 값이 스킬 맵이 아니라 단일 값(${String(v)})입니다 — 덮어쓰면 다른 스킬 설정이 사라질 수 있어 저장을 중단했습니다`);
}

/**
 * 🔴 저장 정본 — **기존 맵을 읽어 병합**한 뒤 전체 맵을 PUT 한다.
 *    `{ value: 0.6 }` 처럼 스칼라를 보내면 다른 세 스킬의 임계가 통째로 사라진다.
 */
export async function putMergedConfigMap(key: string, skillKey: string, value: unknown): Promise<void> {
  const map = await readConfigMap(key);            // ① 기존 맵을 읽고
  if (value === undefined) delete map[skillKey];   // ② 이 스킬 키만 바꾼
  else map[skillKey] = value;
  await apiClient.put(`/api/v1/config/${encodeURIComponent(key)}`, { value: map }); // ③ 전체 맵을 보낸다
}

const labelOf = (row: SkillQualityRow) => row.label || SKILL_FALLBACK_LABEL[row.skill] || row.skill;

/** 임계 설정 다이얼로그 — 실측을 먼저 보여주고, 그 아래에서 값을 정한다 */
function ThresholdDialog({ row, windowDays, onClose, onSaved }: {
  row: SkillQualityRow;
  windowDays?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const th = row.threshold ?? {};
  const [pct, setPct] = useState<string>(th.minAiRate == null ? '' : formatNum(th.minAiRate * 100, 'percent', { unit: false }));
  const [minCalls, setMinCalls] = useState<string>(String(th.minCalls ?? DEFAULT_MIN_CALLS));
  const [action, setAction] = useState<QualityAction>(
    th.action === 'WARN' || th.action === 'BLOCK' ? th.action : 'OFF',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열릴 때 첫 입력에 포커스
  useEffect(() => { firstRef.current?.focus(); }, []);
  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const calls = typeof row.calls === 'number' ? row.calls : 0;
  const aiOk = typeof row.aiOk === 'number' ? row.aiOk : null;
  const label = labelOf(row);
  const skillKey = SKILL_CONFIG_KEY[row.skill] ?? row.skill;

  const save = async () => {
    setError(null);
    const raw = pct.trim();
    let rate: number | undefined;
    if (raw === '') {
      rate = undefined; // 빈칸 = 미설정(맵에서 이 스킬 키를 지운다)
    } else {
      const n = Number(raw);
      // 🔴 서버 정본(`resolveMinAiRate`)이 0 초과 1 이하만 채택한다 — 0 을 보내면 "저장했는데 무시되는" 값이 된다
      if (!Number.isFinite(n) || n <= 0 || n > 100) { setError('최소 AI 통과율은 0 초과 100 이하의 %로 넣습니다(빈칸 = 미설정).'); return; }
      rate = n / 100;
    }
    const callsRaw = minCalls.trim();
    const c = callsRaw === '' ? DEFAULT_MIN_CALLS : Number(callsRaw);
    // 서버 정본(`resolveMinCalls`)은 유한 **양수**만 채택한다 — 0 은 저장돼도 무시된다
    if (!Number.isInteger(c) || c < 1) { setError('최소 표본 수는 1 이상의 정수로 넣습니다.'); return; }

    setSaving(true);
    const done: string[] = [];
    try {
      await putMergedConfigMap(CONFIG_MIN_RATE, skillKey, rate); done.push('통과율');
      await putMergedConfigMap(CONFIG_MIN_CALLS, skillKey, c); done.push('표본 수');
      await putMergedConfigMap(CONFIG_ACTION, skillKey, action); done.push('조치');
      toast.success(`${label} 품질 임계를 저장했습니다`);
      onSaved();
    } catch (e) {
      // 🔴 저장 실패를 성공처럼 닫지 않는다. 앞 단계가 이미 저장됐으면 그 사실까지 말한다(부분 저장).
      const msg = (e as { message?: string })?.message || '저장 실패(사유 미상)';
      const partial = done.length > 0 ? ` (이미 저장된 항목: ${done.join('·')} — 부분 저장 상태입니다)` : '';
      setError(`${msg}${partial}`);
      toast.error(`임계를 저장하지 못했습니다 — ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose} data-threshold-backdrop>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h4 id={titleId} className="text-sm font-bold text-gray-900">{label} — 품질 임계 설정</h4>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="min-h-[44px] px-2 text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {/* 🔴 근거 먼저 — 위원회가 감으로 넣지 않게 그 스킬의 실측을 위에 둔다 */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 mb-3 text-[11px] text-indigo-900" data-threshold-basis>
          <p className="font-semibold mb-0.5">임계를 정하는 근거(실측)</p>
          {calls > 0 ? (
            <p>
              최근 {windowDays == null ? '집계' : `${windowDays}일`} 실측 AI 통과{' '}
              <Ratio numerator={aiOk} denominator={calls} className="font-semibold" /> · 표본 {calls}건
            </p>
          ) : (
            <p data-threshold-no-sample>표본 없음 — 임계를 정할 근거가 아직 없습니다.</p>
          )}
          {row.basis && <p className="mt-0.5 text-indigo-700/80">{row.basis}</p>}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium text-gray-700">최소 AI 통과율(%)</span>
            <input ref={firstRef} type="number" min={0.1} max={100} step="0.1" value={pct}
              onChange={(e) => setPct(e.target.value)} placeholder="빈칸 = 미설정(적용 안 함)"
              className="mt-1 w-full min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            <span className="text-[11px] text-gray-500">비워 두면 이 스킬에는 임계가 없습니다 — 아무것도 내리지 않습니다.</span>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-gray-700">최소 표본 수</span>
            <input type="number" min={1} step="1" value={minCalls}
              onChange={(e) => setMinCalls(e.target.value)} placeholder={String(DEFAULT_MIN_CALLS)}
              className="mt-1 w-full min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            <span className="text-[11px] text-gray-500">표본이 이보다 적으면 <b>표본 부족</b>으로 두고 판정하지 않습니다(기본 {DEFAULT_MIN_CALLS}).</span>
          </label>

          <fieldset>
            <legend className="text-[11px] font-medium text-gray-700 mb-1">임계 미달일 때의 조치</legend>
            <div className="space-y-1">
              {ACTION_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 min-h-[44px] px-2 py-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="quality-action" value={opt.value} checked={action === opt.value}
                    onChange={() => setAction(opt.value)} className="mt-1" />
                  <span>
                    <span className="block text-xs font-medium text-gray-800">{opt.label}</span>
                    <span className="block text-[11px] text-gray-500">{opt.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {action === 'BLOCK' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800" data-block-warning>
              탭을 내려도 <b>왜 내렸는지 화면이 밝힙니다</b> — 숨기면 방치됩니다.
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700" role="alert">
              ⚠️ 저장되지 않았습니다 — {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={saving}
            className="min-h-[44px] px-3 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="min-h-[44px] px-4 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? '저장 중…' : '임계 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiSkillQuality() {
  const [m, setM] = useState<SkillQuality | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [dialogSkill, setDialogSkill] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    apiClient.get<{ data: SkillQuality }>(`/api/v1/ai/skill-quality?days=${days}`)
      .then((r) => { const d = r?.data as unknown as Record<string, unknown>; setM((d?.skills ? d : d?.data) as SkillQuality); })
      .catch((e: { message?: string }) => setErr(e?.message ?? '조회 실패'));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const skills = m?.skills ?? [];
  const openRow = skills.find((s) => s.skill === dialogSkill) ?? null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6" data-panel="ai-skill-quality">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-900">진료 보조 스킬 품질 임계 <span className="text-xs font-normal text-gray-400">검증 통과율 · 미달 시 조치(경고/탭 내림)</span></h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-[11px] border border-gray-200 rounded-lg px-2 py-1">
          <option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option>
        </select>
      </div>

      <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 mb-2">
        임계는 <b>위원회가 과거 실측에서</b> 정한다 — 기본값은 미설정(적용 안 함)이며, 값을 넣기 전까지 화면은 아무것도 내리지 않습니다.
      </p>

      {err && <QueryErrorFallback error={new Error(err)} onRetry={load} size="compact" />}
      {m && skills.length === 0 && (
        <p className="text-xs text-gray-400">스킬 목록이 비어 있습니다 — 계측 원장(Ai*Outcome)이 아직 이 기간에 없거나 서버가 스킬을 보고하지 않았습니다.</p>
      )}

      {skills.length > 0 && (
        <table className="w-full text-[11px]">
          <thead className="text-gray-500 border-b border-gray-100"><tr>
            <th className="text-left py-1">스킬</th>
            <th className="text-right">AI 통과 n/N</th>
            <th className="text-left pl-2">상태</th>
            <th className="text-left pl-2">현재 임계</th>
            <th className="text-left pl-2">적용 효과</th>
            <th className="text-right">&nbsp;</th>
          </tr></thead>
          <tbody>
            {skills.map((s) => {
              const badge = STATUS_BADGE[String(s.status)] ?? { label: String(s.status ?? '미보고'), cls: 'bg-gray-100 text-gray-600' };
              const th = s.threshold ?? {};
              const effect = String(s.effect ?? 'NONE');
              return (
                <tr key={s.skill} className="border-b border-gray-50" data-skill-row={s.skill}>
                  <td className="py-1.5">{labelOf(s)}</td>
                  {/* 🔴 통과율은 분모와 함께 — 호출 0 이면 0% 가 아니라 산출 불가 */}
                  <td className="text-right tabular-nums">
                    <Ratio numerator={typeof s.aiOk === 'number' ? s.aiOk : null} denominator={typeof s.calls === 'number' ? s.calls : null} unavailableHint="이 기간 호출 없음" />
                  </td>
                  {/* 색만으로 말하지 않는다 — 색 + 텍스트 */}
                  <td className="pl-2">
                    <span className={`px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${badge.cls}`} data-skill-status={s.status ?? ''} title={s.basis ?? undefined}>{badge.label}</span>
                  </td>
                  <td className="pl-2 text-gray-600 whitespace-nowrap">
                    {th.minAiRate == null
                      ? <span className="text-gray-400">미설정</span>
                      : <>{formatNum(th.minAiRate * 100, 'percent')} · 표본 {th.minCalls ?? DEFAULT_MIN_CALLS} · {String(th.action ?? 'OFF')}</>}
                  </td>
                  <td className="pl-2 text-gray-600 whitespace-nowrap" data-skill-effect={effect}>{EFFECT_LABEL[effect] ?? effect}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => setDialogSkill(s.skill)}
                      className="min-h-[44px] px-3 text-[11px] font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">임계 설정</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {m && (
        <p className="text-[11px] text-gray-400 mt-2">
          {m.generatedAt && <>기준 <KDate value={m.generatedAt} mode="datetime" /> · </>}
          {m.note}
        </p>
      )}

      {openRow && (
        <ThresholdDialog row={openRow} windowDays={m?.windowDays} onClose={() => setDialogSkill(null)}
          onSaved={() => { setDialogSkill(null); load(); }} />
      )}
    </div>
  );
}
