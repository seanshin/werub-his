'use client';

/**
 * 수술 흐름 띠(10단계) · 수술 경과 요약(셈) · AI 초안(요청 시만).
 *
 * 🔴 흐름은 실시간 모니터와 같은 정본(shared `surgeryFlowOf`) — 마지막 기록 단계 앞의 빈 단계는 "기록 없음"이지 "지났다"가 아니다.
 * 🔴 요약은 원장에서 센 값만(AI 아님) — 기록 없는 종류는 '기록 없음'(0 과 다르다).
 * 🔴 AI 초안은 누를 때만 부른다 · 저장하지 않는다 · 사실 목록에 없는 숫자를 표시한다 · 실패는 실패로 말한다(대신 문장을 만들지 않는다).
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AI_ORIGIN_TEXT, SURGERY_PHASE_LABEL, formatDateTimeLocale, type SurgeryPhase } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { useHasRole } from '@/hooks/use-admin-write';
import { Duration, KDate } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import type { AiNarrative, OrChart } from './chart-types';

/** 흐름 띠 — 머리 안(모든 화면) */
export function FlowStrip({ c }: { c: OrChart }) {
  const f = c.flow;
  const gaps = new Set<SurgeryPhase>(f.unrecordedBefore);
  const cancelled = c.surgery.status === 'CANCELLED';
  // 첫 기록 단계와 다른 날이면 날짜도 — 시각만 보이면 다른 날의 단계가 같은 흐름으로 읽힌다
  const kstDay = (iso: string) => formatDateTimeLocale(new Date(iso), 'en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const firstAt = f.phases.find((p) => p.at)?.at ?? null;
  const firstDay = firstAt ? kstDay(firstAt) : null;
  return (
    <div className="mt-2" data-or-flow>
      <ol className="flex flex-wrap gap-1">
        {f.phases.map((p) => {
          const isLast = p.key === f.lastPhase;
          const isNext = !cancelled && p.key === f.nextPhase;
          const tone = p.at
            ? isLast ? 'bg-emerald-400 text-gray-900 ring-2 ring-white' : 'bg-emerald-700/70 text-white'
            : gaps.has(p.key) ? 'border border-dashed border-amber-300 text-amber-200'
              : isNext ? 'border border-sky-300 text-sky-100' : 'border border-white/15 text-gray-400';
          return (
            <li key={p.key} className={`min-w-[78px] flex-1 rounded-lg px-2 py-1 text-center ${tone}`} data-flow-step={p.key} data-flow-otherday={p.at && firstDay && kstDay(p.at) !== firstDay ? 'true' : undefined} data-flow-state={p.at ? (isLast ? 'last' : 'done') : gaps.has(p.key) ? 'gap' : isNext ? 'next' : 'todo'}>
              <p className="text-[10px] font-semibold leading-tight"><T k={SURGERY_PHASE_LABEL[p.key]} /></p>
              <p className="text-xs tabular-nums">
                {p.at ? <KDate value={p.at} mode={firstDay && kstDay(p.at) !== firstDay ? 'datetimeShort' : 'time'} /> : gaps.has(p.key) ? <T k="기록 없음" /> : isNext ? <T k="다음" /> : '—'}
              </p>
            </li>
          );
        })}
      </ol>
      {f.timeConflicts.length > 0 && (
        <p className="mt-1 text-[11px] text-rose-300" role="alert">
          <T k="시각이 뒤집힌 단계" />: {f.timeConflicts.map(([a, b], i) => <span key={`${a}${b}`}>{i > 0 && ' · '}<T k={SURGERY_PHASE_LABEL[a]} /> &gt; <T k={SURGERY_PHASE_LABEL[b]} /></span>)}
        </p>
      )}
      {f.unrecordedBefore.length > 0 && (
        <p className="mt-0.5 text-[10px] text-amber-200"><T k="점선 단계는 시각 기록이 없습니다 — 건너뛴 것인지 늦게 적을 것인지 시스템은 모릅니다." /></p>
      )}
    </div>
  );
}

const ml = (v: number | null) => (v == null ? null : `${v} mL`);

/** 수술 경과 요약 패널 — 셈 + AI 초안 */
export function SummaryPanel({ c, Panel }: { c: OrChart; Panel: (p: { title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) => React.ReactElement }) {
  const tAttr = useTAttr();
  const s = c.summary;
  // 서버 @Roles(DOCTOR·NURSE) 와 같은 판정 — 권한 밖이면 버튼을 그리지 않는다(누르면 403)
  const canAi = useHasRole('DOCTOR', 'NURSE');
  const [draft, setDraft] = useState<AiNarrative | null>(null);
  const ai = useMutation({
    mutationFn: () => apiClient.post<{ data: AiNarrative }>(`/api/v1/surgery/${c.surgery.id}/intraop/ai-narrative`, {}).then((r) => r.data),
    onSuccess: (d) => setDraft(d),
  });
  const row = (label: React.ReactNode, v: React.ReactNode) => (
    <div className="flex justify-between gap-2 border-b border-gray-50 py-1"><span className="text-gray-500">{label}</span><span className="font-semibold tabular-nums">{v ?? <span className="font-normal text-gray-400"><T k="기록 없음" /></span>}</span></div>
  );
  const dur = (m: number | null) => (m == null ? null : <Duration minutes={m} />);
  const vit = (k: keyof typeof s.vitals, label: string) => {
    const v = s.vitals[k];
    return row(label, v ? `${v.min}–${v.max} (n=${v.n})` : null);
  };
  return (
    <Panel title={<T k="수술 경과 요약" />} right={<span className="text-[10px] text-gray-400"><T k="원장에서 센 값 · AI 아님" /></span>}>
      <div className="grid gap-4 text-xs md:grid-cols-2" data-or-summary>
        <div>
          <p className="mb-1 font-bold text-gray-700"><T k="시간" /></p>
          {row(<T k="마취(유도→발관)" />, dur(s.durations.anesthesiaMin))}
          {row(<T k="절개→봉합" />, dur(s.durations.incisionToClosureMin))}
          {row(<T k="수술 시작→종료" />, dur(s.durations.startToEndMin))}
          <p className="mb-1 mt-3 font-bold text-gray-700"><T k="들어간 것·나온 것" /></p>
          {row(<T k="수액" />, ml(s.io.fluidMl))}
          {row(<T k="혈액" />, ml(s.io.bloodMl))}
          {row(<T k="소변" />, ml(s.io.urineMl))}
          {row(<T k="실혈" />, ml(s.io.bloodLossMl))}
          {row(<T k="배액" />, ml(s.io.drainMl))}
          {row(<T k="수지(들어간 것 − 나온 것)" />, ml(s.io.balanceMl))}
          {s.io.bloodUnitsOnly > 0 && <p className="mt-1 text-[10px] text-amber-700"><Tf k="mL 없이 단위 수만 적은 혈액 {수}건은 합에 없습니다." params={{ 수: s.io.bloodUnitsOnly }} /></p>}
        </div>
        <div>
          <p className="mb-1 font-bold text-gray-700"><T k="활력 범위(최저–최고)" /></p>
          {vit('heartRate', 'HR')}{vit('systolicBp', 'SBP')}{vit('diastolicBp', 'DBP')}{vit('spo2', 'SpO₂')}{vit('etco2', 'EtCO₂')}{vit('temperature', 'Temp')}
          <p className="mb-1 mt-3 font-bold text-gray-700"><T k="약물(같은 약·같은 단위 합)" /></p>
          {s.drugs.length === 0 ? <p className="text-gray-400"><T k="기록 없음" /></p> : (
            <ul className="space-y-0.5">{s.drugs.map((d) => <li key={`${d.name}|${d.unit}`} className="flex justify-between"><span>{d.name}</span><span className="tabular-nums">{d.total} {d.unit} ×{d.count}</span></li>)}</ul>
          )}
          {s.counts.voided > 0 && <p className="mt-2 text-[10px] text-gray-400"><Tf k="무효 처리된 기록 {수}건은 빼고 셌습니다." params={{ 수: s.counts.voided }} /></p>}
        </div>
      </div>

      {canAi && (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-xs" data-or-ai={draft?.source ?? (ai.isError ? 'error' : 'idle')}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => ai.mutate()} disabled={ai.isPending}
              className="min-h-[44px] rounded-xl bg-violet-600 px-4 font-semibold text-white disabled:opacity-50">
              {ai.isPending ? tAttr('작성 중…') : draft ? tAttr('AI 초안 다시 받기') : tAttr('AI 경과 요약 초안')}
            </button>
            <span className="text-[10px] text-violet-700">{AI_ORIGIN_TEXT} · <T k="누를 때만 부릅니다 · 저장되지 않습니다 · 이름·등록번호·메모 본문은 보내지 않습니다." /></span>
          </div>
          {ai.isError && <p className="mt-2 text-rose-700" role="alert">{extractErrorMessage(ai.error) || tAttr('AI 초안을 받지 못했습니다.')}</p>}
          {draft?.source === 'UNAVAILABLE' && (
            <p className="mt-2 text-amber-800" role="status">
              {draft.reason === 'NO_RECORDS' ? <T k="요약할 기록이 아직 없습니다 — AI 를 부르지 않았습니다." />
                : draft.reason === 'AI_MODULE_MISSING' ? <T k="AI 모듈이 연결되어 있지 않습니다." />
                  : <T k="AI 가 답하지 못했습니다 — 초안이 없습니다(대신 문장을 만들지 않습니다)." />}
            </p>
          )}
          {draft?.source === 'AI' && draft.text && (
            <div className="mt-2 space-y-1.5">
              <p className="rounded-lg bg-white p-2.5 text-sm leading-relaxed text-gray-800" data-or-ai-text>{draft.text}</p>
              {draft.unverifiedNumbers.length > 0 && (
                <p className="text-rose-700" role="alert"><T k="기록에 없는 수치" />: <b>{draft.unverifiedNumbers.join(', ')}</b> — <T k="옮기기 전에 확인하세요." /></p>
              )}
              {draft.languageMixed && <p className="text-amber-800"><T k="다른 언어 문자가 섞여 있습니다 — 확인하세요." /></p>}
              <div className="flex items-center gap-2">
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700"><T k="초안 — 확인 전" /></span>
                <button type="button" className="text-[11px] text-violet-700 underline" onClick={() => { void navigator.clipboard?.writeText(draft.text ?? ''); }}><T k="복사" /></button>
                {draft.generatedAt && <span className="text-[10px] text-gray-400"><KDate value={draft.generatedAt} mode="time" /></span>}
              </div>
              <details className="text-[10px] text-gray-500"><summary><Tf k="AI 에 보낸 사실 {수}줄" params={{ 수: draft.facts.length }} /></summary><pre className="mt-1 whitespace-pre-wrap">{draft.facts.join('\n')}</pre></details>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
