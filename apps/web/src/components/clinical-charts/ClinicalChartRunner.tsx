'use client';

/**
 * 임상차트 실행기 (공유) — /clinical-tools 와 차트 템플릿(ChartRenderer) 양쪽에서 사용.
 * controlled 모드: value 로 초기 입력 복원, onChange 로 입력+판정 결과 emit(차트 저장용).
 */
import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import {
  computeScoring, evaluateLookup, computeFormula, evaluateCriteria, computeRegimenDoses,
  type ClinicalChartDef, type Risk, RISK_META,
} from '@/lib/clinical-charts';
import { useChartVerifications, verificationState, VERIFY_STATE_META } from './useChartVerifications';
import { useEncounterRef } from './capture-context';
import { RegimenOrderModal } from './RegimenOrderModal';
import { T, useTAttr } from '@/components/ui/i18n-text';

export interface ClinicalChartValue {
  chartId: string;
  inputs: Record<string, unknown>;
  result: {
    label?: string;
    level?: Risk;
    total?: number;
    value?: number;
    code?: string;
    recommendation?: string;
    flags?: string[];
    /** 점수표를 다 고르지 않았다 — 부분 합은 그 점수가 아니다(저장하지 않는다 · 2026-10-10) */
    incomplete?: { answered: number; required: number };
  };
}

const RISK_CLASS: Record<Risk, string> = {
  normal: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  low: 'bg-lime-100 text-lime-700 border-lime-200',
  moderate: 'bg-amber-100 text-amber-700 border-amber-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
};

function RiskBadge({ level, label }: { level: Risk; label: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap ${RISK_CLASS[level]}`}>
      {label} · {RISK_META[level].label}
    </span>
  );
}

function ChartMetaHeader({ def }: { def: ClinicalChartDef }) {
  // 검수 요약(DB)과 병합 — 검증됨/2차 승인 대기/재검수 필요(정의 변경)/반려/미검증
  const tAttr = useTAttr();
  const { map, fourEyes } = useChartVerifications();
  const ver = map[def.chartId];
  const state = verificationState(def, ver, fourEyes);
  const meta = VERIFY_STATE_META[state];
  const title = ver
    ? `${tAttr('검수')}: ${(ver.approverNames?.length ? ver.approverNames.join('·') : ver.verifiedByName)} · ${kdate(new Date(ver.createdAt), 'date')}${ver.sourceVersion ? ` · ${ver.sourceVersion}` : ''}${ver.note ? ` · ${ver.note}` : ''}`
    : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-1">
      <h2 className="text-base font-bold text-gray-900">{def.name}</h2>
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${meta.cls}`} title={title}>
        {tAttr(meta.label)}{state === 'verified' && ver?.sourceVersion ? ` · ${ver.sourceVersion}` : ''}
      </span>
      {def.existingModel && (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-600 border border-blue-100 whitespace-nowrap"><T k="정식기록은 차트 모듈 사용" /></span>
      )}
    </div>
  );
}

function ChartFooter({ def }: { def: ClinicalChartDef }) {
  return (
    <div className="mt-4 pt-3 border-t border-gray-100 space-y-1">
      {def.note && <p className="text-[11px] text-gray-500">ℹ️ {def.note}</p>}
      <p className="text-[11px] text-gray-400">
        <T k="출처" />: {def.sourceGuideline} ({def.sourceVersion}) · <T k="본 산출은" /> <b><T k="보조도구" /></b><T k="이며 최종 임상판단은 의사에게 귀속합니다." />
      </p>
    </div>
  );
}

/* ── Scoring ── */
function ScoringRunner({ def, value, onChange, disabled }: {
  def: Extract<ClinicalChartDef, { archetype: 'scoring' }>;
  value?: ClinicalChartValue; onChange?: (v: ClinicalChartValue) => void; disabled?: boolean;
}) {
  const initIdx = (value?.inputs?.idx as Record<string, number>) ?? {};
  const [idx, setIdx] = useState<Record<string, number>>(initIdx);

  const selections: Record<string, number> = {};
  for (const c of def.categories) { const i = idx[c.key]; if (typeof i === 'number') selections[c.key] = c.options[i].score; }
  const result = computeScoring(def, selections);
  const allAnswered = def.categories.every((c) => typeof idx[c.key] === 'number');

  const pick = (key: string, i: number) => {
    if (disabled) return;
    const next = { ...idx, [key]: i };
    setIdx(next);
    const sel: Record<string, number> = {};
    for (const c of def.categories) { const j = next[c.key]; if (typeof j === 'number') sel[c.key] = c.options[j].score; }
    const r = computeScoring(def, sel);
    // 🔴 (2026-10-10) 일부만 고른 합계를 총점으로 내보내 환자 차트에 그 점수로 저장됐다(Braden 3항목 합 = "Braden 9점 고위험") —
    //    다 고르기 전에는 총점·판정을 내보내지 않는다(입력은 남겨 복원한다)
    const required = def.categories.length;
    const answered = def.categories.filter((c) => typeof next[c.key] === 'number').length;
    onChange?.(answered < required
      ? { chartId: def.chartId, inputs: { idx: next }, result: { incomplete: { answered, required } } }
      : { chartId: def.chartId, inputs: { idx: next }, result: { total: r.total, label: r.band?.label, level: r.band?.level, recommendation: r.band?.recommendation, flags: r.flags } });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {def.categories.map((c) => (
          <div key={c.key}>
            <p className="text-sm font-medium text-gray-700 mb-1.5">{c.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {c.options.map((o, i) => (
                <button key={i} type="button" disabled={disabled} onClick={() => pick(c.key, i)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${idx[c.key] === i ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                  {o.label} <span className="opacity-70">({o.score >= 0 ? '+' : ''}{o.score})</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-gray-500"><T k="총점" /></span>
            <span className="text-2xl font-extrabold text-gray-900">{result.total}</span>
            <span className="text-xs text-gray-400">/ {def.range}</span>
          </div>
          {allAnswered && result.band && <RiskBadge level={result.band.level} label={result.band.label} />}
        </div>
        {!allAnswered && <p className="text-[11px] text-gray-400 mt-1"><T k="모든 항목을 선택하면 판정됩니다." /></p>}
        {allAnswered && result.band?.recommendation && <p className="text-sm text-gray-700 mt-2">→ {result.band.recommendation}</p>}
        {result.flags.length > 0 && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
            ⚠️ 양성 플래그({result.flags.join(', ')}) — 추가 안전 평가/임상가 연계 필요.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Lookup ── */
function LookupRunner({ def, value, onChange, disabled }: {
  def: Extract<ClinicalChartDef, { archetype: 'lookup' }>;
  value?: ClinicalChartValue; onChange?: (v: ClinicalChartValue) => void; disabled?: boolean;
}) {
  const [code, setCode] = useState<string>((value?.inputs?.code as string) ?? '');
  const result = code ? evaluateLookup(def, code) : { option: undefined };

  const pick = (c: string) => {
    if (disabled) return;
    setCode(c);
    const opt = evaluateLookup(def, c).option;
    onChange?.({ chartId: def.chartId, inputs: { code: c }, result: { code: c, label: opt?.label, level: opt?.level, recommendation: opt?.recommendation } });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1.5"><T k={def.inputLabel ?? '소견'} /> <T k="선택@행위" /></p>
        <div className="flex flex-col gap-1.5">
          {def.options.map((o) => (
            <button key={o.code} type="button" disabled={disabled} onClick={() => pick(o.code)}
              className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${code === o.code ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
              <span className="font-medium text-gray-800">{o.label}</span>
              {o.attribute && <span className="ml-2 text-[11px] text-gray-400">{o.attribute}</span>}
            </button>
          ))}
        </div>
      </div>
      {result.option && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
          <RiskBadge level={result.option.level} label={result.option.label.split('—')[0].trim()} />
          {result.option.recommendation && <p className="text-sm text-gray-700">→ {result.option.recommendation}</p>}
        </div>
      )}
    </div>
  );
}

/* ── Formula ── */
function FormulaRunner({ def, value, onChange, disabled }: {
  def: Extract<ClinicalChartDef, { archetype: 'formula' }>;
  value?: ClinicalChartValue; onChange?: (v: ClinicalChartValue) => void; disabled?: boolean;
}) {
  const tAttr = useTAttr();
  const [vars, setVars] = useState<Record<string, string>>((value?.inputs?.vars as Record<string, string>) ?? {});
  const saved = value?.result;
  const [computed, setComputed] = useState<{ value: number; bandLabel?: string; bandLevel?: Risk } | null>(
    typeof saved?.value === 'number' ? { value: saved.value, bandLabel: saved.label, bandLevel: saved.level } : null,
  );
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    if (disabled) return;
    setErr(null);
    const nums: Record<string, number> = {};
    for (const v of def.variables) {
      const n = Number(vars[v.key]);
      if (vars[v.key] === undefined || vars[v.key] === '' || Number.isNaN(n)) { setErr(`'${v.label}' ${tAttr('입력 필요')}`); setComputed(null); return; }
      nums[v.key] = n;
    }
    try {
      const r = computeFormula(def, nums);
      setComputed({ value: r.value, bandLabel: r.band?.label, bandLevel: r.band?.level });
      onChange?.({ chartId: def.chartId, inputs: { vars }, result: { value: r.value, label: r.band?.label, level: r.band?.level } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : tAttr('계산 오류')); setComputed(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {def.variables.map((v) => (
          <div key={v.key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{v.label}{v.unit ? ` (${v.unit})` : ''}</label>
            <input type="number" inputMode="decimal" value={vars[v.key] ?? ''} min={v.min} max={v.max} disabled={disabled}
              onChange={(e) => setVars((p) => ({ ...p, [v.key]: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
          </div>
        ))}
      </div>
      <button type="button" onClick={run} disabled={disabled} className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"><T k="계산" /></button>
      {err && <p className="text-xs text-red-600">⚠️ {err}</p>}
      {computed && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-gray-500">{def.resultLabel ?? <T k="결과@산출" />}</span>
            <span className="text-2xl font-extrabold text-gray-900">{Number.isInteger(computed.value) ? computed.value : computed.value.toFixed(2)}</span>
            {def.resultUnit && <span className="text-xs text-gray-400">{def.resultUnit}</span>}
          </div>
          {computed.bandLabel && computed.bandLevel && <RiskBadge level={computed.bandLevel} label={computed.bandLabel} />}
        </div>
      )}
      {def.constraints && def.constraints.length > 0 && (
        <ul className="text-[11px] text-gray-500 list-disc pl-4">{def.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
      )}
    </div>
  );
}

/* ── Criteria (기준판정) ── */
function CriteriaRunner({ def, value, onChange, disabled }: {
  def: Extract<ClinicalChartDef, { archetype: 'criteria' }>;
  value?: ClinicalChartValue; onChange?: (v: ClinicalChartValue) => void; disabled?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, boolean>>((value?.inputs?.answers as Record<string, boolean>) ?? {});
  const allAnswered = def.items.every((it) => typeof answers[it.key] === 'boolean');
  const result = evaluateCriteria(def, answers);

  const pick = (key: string, v: boolean) => {
    if (disabled) return;
    const next = { ...answers, [key]: v };
    setAnswers(next);
    const r = evaluateCriteria(def, next);
    const complete = def.items.every((it) => typeof next[it.key] === 'boolean');
    if (complete) {
      onChange?.({ chartId: def.chartId, inputs: { answers: next }, result: { label: r.verdict.label, level: r.verdict.level, recommendation: r.verdict.recommendation } });
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {def.items.map((it) => (
          <div key={it.key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-gray-200">
            <div className="min-w-0">
              <p className="text-sm text-gray-800">{it.label}</p>
              {it.hint && <p className="text-[11px] text-gray-400">{it.hint}</p>}
            </div>
            <div className="flex gap-1.5 shrink-0">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" disabled={disabled} onClick={() => pick(it.key, v)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${answers[it.key] === v ? (v ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-700 text-white border-gray-700') : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                  {v ? <T k="예" /> : <T k="아니오" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
        <p className="text-[11px] text-gray-400 font-mono"><T k="판정식" />: {def.expr}</p>
        {allAnswered ? (
          <>
            <RiskBadge level={result.verdict.level} label={result.verdict.label} />
            {result.verdict.recommendation && <p className="text-sm text-gray-700">→ {result.verdict.recommendation}</p>}
          </>
        ) : (
          <p className="text-[11px] text-gray-400"><T k="모든 항목에 예/아니오를 선택하면 판정됩니다." /></p>
        )}
      </div>
    </div>
  );
}

/* ── Tree (항암 레지멘 — 정의·용량 산출 보조. 처방 결선은 후속) ── */
function TreeRunner({ def, value, onChange, disabled }: {
  def: Extract<ClinicalChartDef, { archetype: 'tree' }>;
  value?: ClinicalChartValue; onChange?: (v: ClinicalChartValue) => void; disabled?: boolean;
}) {
  const init = (value?.inputs ?? {}) as { height?: string; weight?: string; gfr?: string };
  const [height, setHeight] = useState<string>(init.height ?? '');
  const [weight, setWeight] = useState<string>(init.weight ?? '');
  const [gfr, setGfr] = useState<string>(init.gfr ?? '');

  const h = Number(height), w = Number(weight), g = Number(gfr);
  const bsa = h > 0 && w > 0 ? Math.sqrt((h * w) / 3600) : undefined; // Mosteller
  const needsGfr = def.regimen.drugs.some((d) => d.doseBasis === 'AUC');
  const lines = computeRegimenDoses(def, { bsa, gfr: g > 0 ? g : undefined, weight: w > 0 ? w : undefined });
  const computedAll = lines.every((l) => l.dose != null);

  const emit = (nh: string, nw: string, ng: string) => {
    if (disabled) return;
    const hh = Number(nh), ww = Number(nw), gg = Number(ng);
    const b = hh > 0 && ww > 0 ? Math.sqrt((hh * ww) / 3600) : undefined;
    const ls = computeRegimenDoses(def, { bsa: b, gfr: gg > 0 ? gg : undefined, weight: ww > 0 ? ww : undefined });
    if (!ls.every((l) => l.dose != null)) return;
    onChange?.({
      chartId: def.chartId,
      inputs: { height: nh, weight: nw, gfr: ng, bsa: b != null ? Math.round(b * 100) / 100 : undefined },
      result: {
        label: `용량 산출 (BSA ${b != null ? b.toFixed(2) : '-'}㎡)`,
        recommendation: ls.map((l) => `${l.drug.name} ${l.dose}mg${l.capped ? '(cap)' : ''}`).join(' · '),
      },
    });
  };

  // CPOE 결선 P0 — 인카운터 컨텍스트에서만 '처방 초안 생성' 노출, 레지멘 검수(검증됨) 전 비활성
  const encRef = useEncounterRef();
  const { map: verMapT, fourEyes: fourEyesT } = useChartVerifications();
  const regimenVerified = verificationState(def, verMapT[def.chartId], fourEyesT) === 'verified';
  const [orderOpen, setOrderOpen] = useState(false);

  const R = def.regimen;
  return (
    <div className="space-y-4">
      {/* 레지멘 식별 */}
      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
        <span><b className="text-gray-800">{R.cancer}</b>{R.indication ? ` · ${R.indication}` : ''}</span>
        {R.intent && <span><T k="목적" />: {R.intent}</span>}
        {R.line && <span><T k="차수" />: {R.line}</span>}
        <span><T k="주기" />: {R.cycleLengthDays}<T k="일@기간" />{R.totalCycles ? ` × ${R.totalCycles}` : ''}</span>
      </div>

      {/* 환자 변수 입력 */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="신장 (cm)" /></label>
          <input type="number" inputMode="decimal" value={height} disabled={disabled}
            onChange={(e) => { setHeight(e.target.value); emit(e.target.value, weight, gfr); }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="체중 (kg)" /></label>
          <input type="number" inputMode="decimal" value={weight} disabled={disabled}
            onChange={(e) => { setWeight(e.target.value); emit(height, e.target.value, gfr); }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
        </div>
        {needsGfr && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">GFR (mL/min)</label>
            <input type="number" inputMode="decimal" value={gfr} disabled={disabled}
              onChange={(e) => { setGfr(e.target.value); emit(height, weight, e.target.value); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        BSA(Mosteller): <b className="text-gray-600">{bsa != null ? `${bsa.toFixed(2)} m²` : <T k="신장·체중 입력" />}</b>
        {needsGfr && <> · <T k="Carboplatin=Calvert(AUC×(GFR+25)) — 기관 GFR 캡 정책 확인" /></>}
      </p>

      {/* 약물 라인 */}
      <div className="rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50/70 text-left text-[11px] text-gray-500">
            <th className="px-3 py-2"><T k="순서" /></th><th className="px-3 py-2"><T k="약물" /></th><th className="px-3 py-2"><T k="기준용량" /></th>
            <th className="px-3 py-2"><T k="투여일" /></th><th className="px-3 py-2"><T k="주입" /></th><th className="px-3 py-2 text-right"><T k="계산 용량" /></th>
          </tr></thead>
          <tbody>
            {lines.sort((a, b) => a.drug.sequence - b.drug.sequence).map((l) => (
              <tr key={l.drug.sequence} className="border-t border-gray-100">
                <td className="px-3 py-2 text-xs text-gray-400">{l.drug.sequence}</td>
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{l.drug.name}</span>
                  {l.drug.cumulativeLimit && <span className="block text-[10px] text-orange-600"><T k="누적한계" /> {l.drug.cumulativeLimit}</span>}
                  {l.drug.note && <span className="block text-[10px] text-gray-400">{l.drug.note}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{l.drug.doseValue} {l.drug.doseUnit} · {l.drug.route}</td>
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{l.drug.days.join(', ')}</td>
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{l.drug.infusion ?? '-'}</td>
                <td className="px-3 py-2 text-right font-bold text-gray-900 whitespace-nowrap">
                  {l.dose != null ? `${l.dose} mg` : <span className="text-gray-300 font-normal"><T k="입력 대기" /></span>}
                  {l.capped && <span className="ml-1 text-[10px] text-red-500">cap</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 전처치·지지요법 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
          <p className="font-semibold text-gray-500 mb-1"><T k="전처치 (Premedication)" /></p>
          <ul className="list-disc pl-4 text-gray-600 space-y-0.5">{R.premedication.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
          <p className="font-semibold text-gray-500 mb-1"><T k="지지요법 (Supportive)" /></p>
          <ul className="list-disc pl-4 text-gray-600 space-y-0.5">{R.supportive.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </div>

      <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-[11px] text-red-700">
        ⚠️ 본 화면은 <b>용량 산출 보조</b>입니다 — 자동 처방을 생성하지 않습니다. 처방 전 기관 프로토콜·허가사항 원문 대조,
        골수억제/장기기능에 따른 감량·연기 규칙(레지멘별)을 적용하세요.
      </div>
      {!computedAll && <p className="text-[11px] text-gray-400"><T k="모든 약물 용량이 계산되면 저장할 수 있습니다." /></p>}

      {/* CPOE 결선 P0 — DRAFT 초안 생성(자동 확정 없음) */}
      {encRef && (
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={() => setOrderOpen(true)} disabled={disabled || !computedAll || !regimenVerified}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
            <T k="처방 초안 생성…" />
          </button>
          {!regimenVerified && <span className="text-[11px] text-yellow-700"><T k="레지멘이 검수(「검증됨」) 승인된 후 활성화됩니다." /></span>}
          {regimenVerified && !computedAll && <span className="text-[11px] text-gray-400"><T k="용량 산출 완료 후 생성할 수 있습니다." /></span>}
        </div>
      )}
      {orderOpen && encRef && (
        <RegimenOrderModal def={def} lines={lines} bsa={bsa} encounterId={encRef.encounterId} patientId={encRef.patientId} onClose={() => setOrderOpen(false)} />
      )}
    </div>
  );
}

export function ClinicalChartRunner({ def, value, onChange, disabled }: {
  def: ClinicalChartDef;
  value?: ClinicalChartValue;
  onChange?: (v: ClinicalChartValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <ChartMetaHeader def={def} />
      <div className="mt-3">
        {def.archetype === 'scoring' && <ScoringRunner def={def} value={value} onChange={onChange} disabled={disabled} />}
        {def.archetype === 'lookup' && <LookupRunner def={def} value={value} onChange={onChange} disabled={disabled} />}
        {def.archetype === 'formula' && <FormulaRunner def={def} value={value} onChange={onChange} disabled={disabled} />}
        {def.archetype === 'criteria' && <CriteriaRunner def={def} value={value} onChange={onChange} disabled={disabled} />}
        {def.archetype === 'tree' && <TreeRunner def={def} value={value} onChange={onChange} disabled={disabled} />}
      </div>
      <ChartFooter def={def} />
    </div>
  );
}
