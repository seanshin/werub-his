'use client';

/**
 * 화면 3418 「간호 원내 규정」(2026-10-26) — 원내가 정할 간호 규정을 화면에서 고른다.
 *  · 신체보호대 점검 간격 · 통증 재평가 규정(기준 점수·기한·진통제 투여 뒤 기한) · 인계 "인수 확인 ↔ 담당 인수" 방식.
 *  · 🔴 기준을 화면이 정하지 않는다 — 쓰기 폼은 미선택으로 시작(이미 원내 설정이 있으면 그 값) · 코드 기본값은 "원내 규정 미설정"이라고 말한다.
 *  · 저장 = `PUT /config/:key`(관리자 · 서버가 shared 값 검사로 거른다 — 범용 설정 화면과 같은 길) · 변경은 감사 원장에 남는다.
 *  · 정의·라벨 정본 = shared `nursing-rules`.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  HANDOFF_ACK_MODES, HANDOFF_ACK_MODE_DESC, HANDOFF_ACK_MODE_KEY, HANDOFF_ACK_MODE_LABEL, NURSING_RULE_SOURCE_LABEL,
  PAIN_REASSESS_MINUTES_RANGE, PAIN_REASSESS_RULE_KEY, RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN, RESTRAINT_CHECK_INTERVAL_KEY,
  normalizePainReassessRule, normalizeRestraintCheckInterval, type HandoffAckMode, type NursingRuleSource,
  RISK_ASSESSMENT_TYPES, RISK_ASSESSMENT_TYPE_LABEL, RISK_LEVELS, RISK_LEVEL_LABEL, RISK_REASSESS_HOURS_RANGE, RISK_REASSESS_INTERVAL_KEY,
  normalizeRiskReassessIntervals, type RiskAssessmentType, type RiskLevelKey,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useNursingRules, type NursingRulesOverview } from '@/lib/nursing-rules';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

const SOURCE_CLS: Record<NursingRuleSource, string> = {
  CONFIGURED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SEED: 'bg-violet-50 text-violet-700 border-violet-200',
  CODE_DEFAULT: 'bg-amber-50 text-amber-800 border-amber-200',
  UNSET: 'bg-rose-50 text-rose-700 border-rose-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-300',
};
function SourceBadge({ source }: { source: NursingRuleSource }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SOURCE_CLS[source]}`} data-rule-source={source}><T k={NURSING_RULE_SOURCE_LABEL[source]} /></span>;
}

const toInt = (v: string): number | null => (v.trim() === '' ? null : Number(v));
/** 개발 시드 값으로 동작 중인 규정 수 */
const seededCount = (d: NursingRulesOverview) => [d.painReassess.source, d.handoffAckMode.source, d.restraint.source, d.riskReassessIntervals?.source].filter((s) => s === 'SEED').length;
type IntervalForm = Record<RiskAssessmentType, Record<RiskLevelKey, string>>;
const EMPTY_INTERVALS: IntervalForm = { FALL_RISK: { HIGH: '', MODERATE: '', LOW: '' }, PRESSURE_ULCER: { HIGH: '', MODERATE: '', LOW: '' } };

export default function NursingRulesPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const q = useNursingRules();
  const d = q.data;
  const [saving, setSaving] = useState<string | null>(null);

  // 보호대 — 원내 설정이 있으면 그 값 · 아니면 빈 칸(코드 기본값을 미리 채우지 않는다)
  const [restraint, setRestraint] = useState('');
  // 통증 재평가 — 미설정이면 빈 칸·미선택
  const [threshold, setThreshold] = useState('');
  const [within, setWithin] = useState('');
  const [analgesicOn, setAnalgesicOn] = useState<'' | 'YES' | 'NO'>('');
  const [analgesicMin, setAnalgesicMin] = useState('');
  // 인수 방식 — 원내 설정이 있으면 그 값 · 아니면 미선택
  const [mode, setMode] = useState<HandoffAckMode | ''>('');
  // 재평가 주기 — 원내 설정·시드는 채우고 코드 기본값은 비운다(지금 동작은 표로 보여 준다)
  const [intervals, setIntervals] = useState<IntervalForm>(EMPTY_INTERVALS);

  useEffect(() => {
    if (!d) return;
    // 원내 설정·개발 시드 값은 채운다(시드는 "원내 규정 아님" 배지와 함께) · 코드 기본값은 채우지 않는다
    setRestraint(d.restraint.source === 'CONFIGURED' || d.restraint.source === 'SEED' ? String(d.restraint.minutes) : '');
    const r = d.painReassess.rule;
    setThreshold(r ? String(r.thresholdScore) : '');
    setWithin(r ? String(r.withinMinutes) : '');
    setAnalgesicOn(r ? (r.afterAnalgesicMinutes != null ? 'YES' : 'NO') : '');
    setAnalgesicMin(r?.afterAnalgesicMinutes != null ? String(r.afterAnalgesicMinutes) : '');
    setMode((d.handoffAckMode.source === 'CONFIGURED' || d.handoffAckMode.source === 'SEED') && d.handoffAckMode.mode ? d.handoffAckMode.mode : '');
    const ri = d.riskReassessIntervals;
    setIntervals(ri && (ri.source === 'CONFIGURED' || ri.source === 'SEED')
      ? { FALL_RISK: { HIGH: String(ri.table.FALL_RISK.HIGH), MODERATE: String(ri.table.FALL_RISK.MODERATE), LOW: String(ri.table.FALL_RISK.LOW) }, PRESSURE_ULCER: { HIGH: String(ri.table.PRESSURE_ULCER.HIGH), MODERATE: String(ri.table.PRESSURE_ULCER.MODERATE), LOW: String(ri.table.PRESSURE_ULCER.LOW) } }
      : EMPTY_INTERVALS);
  }, [d]);

  const save = async (key: string, value: unknown) => {
    setSaving(key);
    try {
      await apiClient.put(`/api/v1/config/${encodeURIComponent(key)}`, { value });
      toast.success(tAttr('저장했습니다.'));
      await qc.invalidateQueries({ queryKey: ['nursing-rules'] });
      qc.invalidateQueries({ queryKey: ['pain-reassessment'] });
    } catch (e) {
      // 서버 사유를 그대로 — 값 검사 거부(CONFIG_VALUE_INVALID)를 일반 실패로 접지 않는다
      toast.error((e as { message?: string })?.message || tAttr('저장하지 못했습니다.'));
    } finally {
      setSaving(null);
    }
  };

  const restraintValue = normalizeRestraintCheckInterval(toInt(restraint));
  const painValue = analgesicOn === ''
    ? null
    : normalizePainReassessRule({ thresholdScore: toInt(threshold), withinMinutes: toInt(within), afterAnalgesicMinutes: analgesicOn === 'YES' ? toInt(analgesicMin) : null });
  const range = `${PAIN_REASSESS_MINUTES_RANGE.min}~${PAIN_REASSESS_MINUTES_RANGE.max}`;
  const intervalValue = normalizeRiskReassessIntervals(Object.fromEntries(RISK_ASSESSMENT_TYPES.map((t) => [t, Object.fromEntries(RISK_LEVELS.map((l) => [l, toInt(intervals[t][l])]))])));

  return (
    <div className="space-y-4 p-4" data-nursing-rules>
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="간호 원내 규정" /></h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          <T k="간호부 규정으로 정할 기준을 여기서 고릅니다. 저장한 값을 서버와 간호 스테이션이 그대로 씁니다 — 비어 있으면 화면이 그렇다고 말하고, 코드 기본값을 원내 규정이라고 하지 않습니다." />
        </p>
        <p className="mt-1 text-xs text-gray-500"><T k="저장은 관리자만 할 수 있고 변경은 감사 기록에 남습니다." /> <Link href="/admin/human-actions" className="text-blue-700 underline"><T k="사람 몫 할 일" /></Link></p>
      </div>

      {q.isError && <QueryErrorFallback error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading && <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>}

      {d && seededCount(d) > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900" data-rules-seeded={seededCount(d)}>
          <p className="font-semibold"><Tf k="개발 시드 값으로 동작 중인 규정 {수}개 — 원내 규정이 아닙니다." params={{ 수: seededCount(d) }} /></p>
          <p className="mt-0.5 text-xs"><T k="데모가 규정이 있는 모양으로 돌도록 개발 시드가 넣은 값입니다. 간호부 규정을 확인해 값을 고치거나 그대로 저장하면 원내 설정이 됩니다(사람 몫 할 일은 그때 끝남으로 바뀝니다)." /></p>
        </div>
      )}

      {d && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* 통증 재평가 */}
          <section className="rounded-xl border bg-white p-4" data-rule-section="pain">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900"><T k="통증 재평가" /></h2>
                <code className="text-[11px] text-gray-500">{PAIN_REASSESS_RULE_KEY}</code>
              </div>
              <SourceBadge source={d.painReassess.source} />
            </div>
            <p className="mt-2 text-xs text-gray-600"><T k="기준 이상 통증이 기록되거나 진통제를 투여하면 기한 안에 통증을 다시 기록해야 합니다. 간호 스테이션 '통증 재평가' 탭이 이 규정으로 대기·지연을 보여 줍니다. 규정이 없으면 목록을 만들지 않습니다." /></p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-gray-700">
                <T k="재평가 기준(NRS 이상)" />
                <select value={threshold} onChange={(e) => setThreshold(e.target.value)} className="mt-1 block min-h-[40px] w-full rounded-lg border px-2 text-sm" data-field="threshold">
                  <option value="">{tAttr('고르세요')}</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-700">
                <Tf k="재평가 기한(분 · {범위})" params={{ 범위: range }} />
                <input type="number" inputMode="numeric" value={within} onChange={(e) => setWithin(e.target.value)} className="mt-1 block min-h-[40px] w-full rounded-lg border px-2 text-sm" data-field="within" />
              </label>
            </div>
            <fieldset className="mt-3 text-xs text-gray-700">
              <legend><T k="진통제 투여도 재평가 사건으로 보는가" /></legend>
              <div className="mt-1 flex flex-wrap gap-3">
                <label className="flex min-h-[40px] items-center gap-1.5"><input type="radio" name="analgesic" checked={analgesicOn === 'YES'} onChange={() => setAnalgesicOn('YES')} /> <T k="예 — 투여 뒤 기한 안에 재평가" /></label>
                <label className="flex min-h-[40px] items-center gap-1.5"><input type="radio" name="analgesic" checked={analgesicOn === 'NO'} onChange={() => setAnalgesicOn('NO')} /> <T k="아니오" /></label>
              </div>
              {analgesicOn === 'YES' && (
                <label className="mt-2 block">
                  <Tf k="진통제 투여 뒤 기한(분 · {범위})" params={{ 범위: range }} />
                  <input type="number" inputMode="numeric" value={analgesicMin} onChange={(e) => setAnalgesicMin(e.target.value)} className="mt-1 block min-h-[40px] w-40 rounded-lg border px-2 text-sm" data-field="analgesic-min" />
                </label>
              )}
              <p className="mt-1 text-[11px] text-gray-500"><T k="진통제 판정은 약품 효능 분류(해열·진통·소염제 등)와 마약성 진통제 분류로 합니다. 약품 분류를 모르는 투약은 재평가 목록이 따로 셉니다." /></p>
            </fieldset>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={!painValue || saving != null} onClick={() => void save(PAIN_REASSESS_RULE_KEY, painValue)}
                className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40" data-save="pain">
                {d.painReassess.source === 'SEED' ? <T k="이 값으로 원내 확정" /> : <T k="규정 저장" />}
              </button>
              {(d.painReassess.source === 'CONFIGURED' || d.painReassess.source === 'SEED') && (
                <button type="button" disabled={saving != null} onClick={() => void save(PAIN_REASSESS_RULE_KEY, null)} className="min-h-[44px] rounded-lg border px-3 text-sm text-gray-700">
                  <T k="규정 비우기(목록 중단)" />
                </button>
              )}
            </div>
          </section>

          {/* 인계 인수 방식 */}
          <section className="rounded-xl border bg-white p-4" data-rule-section="handoff">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900"><T k="인계 — 인수 확인과 담당 인수" /></h2>
                <code className="text-[11px] text-gray-500">{HANDOFF_ACK_MODE_KEY}</code>
              </div>
              <SourceBadge source={d.handoffAckMode.source} />
            </div>
            {d.handoffAckMode.source === 'CODE_DEFAULT' && d.handoffAckMode.mode && (
              <p className="mt-2 text-xs text-amber-800"><T k="지금 동작" />: <T k={HANDOFF_ACK_MODE_LABEL[d.handoffAckMode.mode]} /></p>
            )}
            <div className="mt-3 space-y-2">
              {HANDOFF_ACK_MODES.map((m) => (
                <label key={m} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${mode === m ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`} data-mode-option={m}>
                  <input type="radio" name="ack-mode" className="mt-1" checked={mode === m} onChange={() => setMode(m)} />
                  <span>
                    <span className="block text-sm font-medium text-gray-900"><T k={HANDOFF_ACK_MODE_LABEL[m]} /></span>
                    <span className="block text-xs text-gray-600"><T k={HANDOFF_ACK_MODE_DESC[m]} /></span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-500"><T k="간호 교대 인계에만 적용합니다(의사 인계는 인수 확인만). 지난 인계는 바꾸지 않습니다." /></p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={!mode || saving != null} onClick={() => void save(HANDOFF_ACK_MODE_KEY, mode)}
                className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40" data-save="handoff">
                {d.handoffAckMode.source === 'SEED' ? <T k="이 값으로 원내 확정" /> : <T k="방식 저장" />}
              </button>
              {d.handoffAckMode.source === 'CONFIGURED' && (
                <button type="button" disabled={saving != null} onClick={() => void save(HANDOFF_ACK_MODE_KEY, null)} className="min-h-[44px] rounded-lg border px-3 text-sm text-gray-700">
                  <T k="코드 기본값으로 되돌리기" />
                </button>
              )}
            </div>
          </section>

          {/* 낙상·욕창 위험 재평가 주기 */}
          {d.riskReassessIntervals && (
            <section className="rounded-xl border bg-white p-4" data-rule-section="risk">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900"><T k="낙상·욕창 위험 재평가 주기(시간)" /></h2>
                  <code className="text-[11px] text-gray-500">{RISK_REASSESS_INTERVAL_KEY}</code>
                </div>
                <SourceBadge source={d.riskReassessIntervals.source} />
              </div>
              <p className="mt-2 text-xs text-gray-600"><T k="평가 등급마다 다음 재평가까지의 시간입니다. 위험이 높을수록 같거나 짧아야 합니다. 비어 있어도 코드 기본값으로 일정은 계속 만들어집니다." /></p>
              <table className="mt-3 w-full text-xs">
                <thead><tr className="text-gray-500"><th className="text-left font-normal" />{RISK_LEVELS.map((l) => <th key={l} className="font-normal"><T k={RISK_LEVEL_LABEL[l]} /></th>)}</tr></thead>
                <tbody>
                  {RISK_ASSESSMENT_TYPES.map((t) => (
                    <tr key={t}>
                      <td className="py-1 pr-2 text-gray-700"><T k={RISK_ASSESSMENT_TYPE_LABEL[t]} /></td>
                      {RISK_LEVELS.map((l) => (
                        <td key={l} className="px-1 py-1">
                          <input type="number" inputMode="numeric" value={intervals[t][l]} aria-label={`${t} ${l}`}
                            placeholder={d.riskReassessIntervals!.source === 'CONFIGURED' || d.riskReassessIntervals!.source === 'SEED' ? '' : String(d.riskReassessIntervals!.table[t][l])}
                            onChange={(e) => setIntervals((p) => ({ ...p, [t]: { ...p[t], [l]: e.target.value } }))}
                            className="block min-h-[40px] w-full rounded-lg border px-2 text-sm" data-field={`risk-${t}-${l}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-gray-500"><Tf k="각 칸 {최소}~{최대} 정수 · 회색 숫자는 지금 쓰는 코드 기본값입니다." params={{ 최소: RISK_REASSESS_HOURS_RANGE.min, 최대: RISK_REASSESS_HOURS_RANGE.max }} /></p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={!intervalValue || saving != null} onClick={() => void save(RISK_REASSESS_INTERVAL_KEY, intervalValue)}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40" data-save="risk">
                  {d.riskReassessIntervals.source === 'SEED' ? <T k="이 값으로 원내 확정" /> : <T k="주기 저장" />}
                </button>
              </div>
            </section>
          )}

          {/* 신체보호대 점검 간격 */}
          <section className="rounded-xl border bg-white p-4" data-rule-section="restraint">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900"><T k="신체보호대 점검 간격" /></h2>
                <code className="text-[11px] text-gray-500">{RESTRAINT_CHECK_INTERVAL_KEY}</code>
              </div>
              <SourceBadge source={d.restraint.source} />
            </div>
            <p className="mt-2 text-xs text-gray-600">
              <Tf k="지금 {분}분마다 점검을 요구합니다." params={{ 분: d.restraint.minutes }} />
              {d.restraint.source !== 'CONFIGURED' && <> <Tf k="(코드 기본값 {분}분 — 비어 있어도 감시는 멈추지 않습니다)" params={{ 분: RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN }} /></>}
            </p>
            <label className="mt-3 block text-xs text-gray-700">
              <T k="점검 간격(분 · 15~480)" />
              <input type="number" inputMode="numeric" value={restraint} onChange={(e) => setRestraint(e.target.value)} className="mt-1 block min-h-[40px] w-40 rounded-lg border px-2 text-sm" data-field="restraint" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={restraintValue == null || saving != null} onClick={() => void save(RESTRAINT_CHECK_INTERVAL_KEY, restraintValue)}
                className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40" data-save="restraint">
                {d.restraint.source === 'SEED' ? <T k="이 값으로 원내 확정" /> : <T k="간격 저장" />}
              </button>
              <Link href="/safety" className="inline-flex min-h-[44px] items-center rounded-lg border border-blue-200 px-3 text-sm text-blue-700"><T k="환자안전(신체보호대)" /> →</Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
