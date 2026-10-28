'use client';

/**
 * 활력징후 표시 부품 정본(2026-10-07) — 화면은 활력을 직접 그리지 않고 이 부품을 쓴다.
 *
 * 표준(shared `vital-signs.ts`)이 정하는 것을 부품이 지킨다:
 *  · 순서: NEWS2 관찰 차트 순서(RR → SpO₂ → BP → HR → 의식 → BT) 다음 보조·계측
 *  · 단위·자릿수: 정본 표시 단위 + `NUMERIC_POLICIES`(화면이 `toFixed`·단위 문자열을 적지 않는다)
 *  · 혈압은 한 값(`120/80 mmHg`) — 한쪽만 있으면 빈 쪽을 '—'로
 *  · 미측정 '—'(0·빈칸 아님) · 이상 색은 서버 병합 임계(`useVitalsThresholds`)로만 · 측정 시각과 경과
 *  · 표준에 맞지 않는 기록(타당성 범위 밖·이완기≥수축기·미래 시각)은 값을 고치지 않고 "확인 필요"로
 */
import * as React from 'react';
import {
  ACVPU_LABEL, VITAL_SIGN_DEF, VITAL_SETS, VITAL_UNMEASURED_TEXT, VITAL_CONFORMANCE_TEXT,
  formatNum, normalizeAcvpu, vitalConformance,
  type VitalSignKey, type VitalValues, type VitalItemFlag, type VitalConformanceIssue,
} from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { Tf, useTAttr } from '@/components/ui/i18n-text';
import { precisionOverride } from '@/lib/ui-settings';
import { flagsWith, useVitalsThresholds, vitalFlagText, type VitalsRuleState } from '@/lib/vital-flags';
import { vitalsFreshness } from '@/lib/vital-ranges';

type Flag = VitalItemFlag | undefined;

/** 값 → 표시 문자열(단위 제외) — 정본 자릿수. 미측정은 null. */
export function vitalText(key: VitalSignKey, value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (key === 'consciousness') {
    const a = normalizeAcvpu(value);
    return a ? ACVPU_LABEL[a] : String(value);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const d = VITAL_SIGN_DEF[key];
  if (d.numericDomain) return formatNum(n, d.numericDomain, { unit: false, override: precisionOverride(d.numericDomain) });
  return String(n);
}

/** 의식은 A 외를 '주의'(NEWS2 단일 3점 항목) — 임계 정본 밖의 표준 규칙이라 여기 둔다 */
function consciousnessFlag(v: string | undefined): Flag {
  if (!v) return null;
  const a = normalizeAcvpu(v);
  return a == null ? null : a === 'ALERT' ? 'NORMAL' : 'WARNING';
}

const FLAG_WORD: Record<'CRITICAL' | 'WARNING', string> = { CRITICAL: '위급', WARNING: '주의' };

/** 한 항목 값 — 단위는 보조 크기 · 미측정 '—' · 이상 색과 글자(색만으로 말하지 않는다) */
export function VitalValue({ k, value, flag, unit = true, suspect, className = '' }: {
  k: VitalSignKey;
  value: number | string | null | undefined;
  flag?: Flag;
  unit?: boolean;
  /** 표준 확인 필요(타당성 범위 밖 등) — 값은 그대로 보여 준다 */
  suspect?: string | null;
  className?: string;
}) {
  const tAttr = useTAttr();
  const d = VITAL_SIGN_DEF[k];
  const text = vitalText(k, value);
  if (text == null) {
    return <span className={`text-gray-400 ${className}`} title={tAttr('미측정')} data-vital={k} data-vital-state="unmeasured">{VITAL_UNMEASURED_TEXT}</span>;
  }
  const word = flag === 'CRITICAL' || flag === 'WARNING' ? tAttr(FLAG_WORD[flag]) : null;
  return (
    <span className={`${vitalFlagText(flag, 'text-gray-900')} ${className}`} data-vital={k} data-vital-flag={flag ?? undefined}
      title={[tAttr(d.labelKo), word, suspect ? tAttr(suspect) : null].filter(Boolean).join(' · ')}>
      <bdi className={suspect ? 'underline decoration-dotted decoration-rose-500' : undefined}>
        {text}
        {unit && d.displayUnit && <span className="ml-px text-[0.6em] font-normal opacity-70">{d.displayUnit}</span>}
      </bdi>
      {word && <span className="sr-only"> {word}</span>}
      {suspect && <span className="ml-0.5 text-[0.7em] text-rose-600" aria-label={tAttr(suspect)}>?</span>}
    </span>
  );
}

/** 혈압 — 한 값. 한쪽만 있으면 빈 쪽 '—' · 둘 다 없으면 '—' */
export function BloodPressureValue({ systolic, diastolic, systolicFlag, diastolicFlag, unit = true, suspect, className = '' }: {
  systolic: number | null | undefined; diastolic: number | null | undefined;
  systolicFlag?: Flag; diastolicFlag?: Flag; unit?: boolean; suspect?: string | null; className?: string;
}) {
  const tAttr = useTAttr();
  const s = vitalText('systolicBp', systolic);
  const dd = vitalText('diastolicBp', diastolic);
  if (s == null && dd == null) {
    return <span className={`text-gray-400 ${className}`} title={tAttr('미측정')} data-vital="bloodPressure" data-vital-state="unmeasured">{VITAL_UNMEASURED_TEXT}</span>;
  }
  const worst: Flag = systolicFlag === 'CRITICAL' || diastolicFlag === 'CRITICAL' ? 'CRITICAL'
    : systolicFlag === 'WARNING' || diastolicFlag === 'WARNING' ? 'WARNING'
    : systolicFlag ?? diastolicFlag;
  const word = worst === 'CRITICAL' || worst === 'WARNING' ? tAttr(FLAG_WORD[worst]) : null;
  return (
    <span className={`${vitalFlagText(worst, 'text-gray-900')} ${className}`} data-vital="bloodPressure" data-vital-flag={worst ?? undefined}
      title={[tAttr('혈압'), word, suspect ? tAttr(suspect) : null].filter(Boolean).join(' · ')}>
      <bdi className={suspect ? 'underline decoration-dotted decoration-rose-500' : undefined}>
        <span className={vitalFlagText(systolicFlag, '')}>{s ?? VITAL_UNMEASURED_TEXT}</span>/<span className={vitalFlagText(diastolicFlag, '')}>{dd ?? VITAL_UNMEASURED_TEXT}</span>
        {unit && <span className="ml-px text-[0.6em] font-normal opacity-70">mmHg</span>}
      </bdi>
      {word && <span className="sr-only"> {word}</span>}
      {suspect && <span className="ml-0.5 text-[0.7em] text-rose-600" aria-label={tAttr(suspect)}>?</span>}
    </span>
  );
}

/** 측정 시각 + 경과 — 없으면 "측정 시각 없음", 미래면 그렇게 말한다('방금' 아님) */
export function VitalMeasuredAt({ at, now, className = '' }: { at: string | Date | null | undefined; now?: Date; className?: string }) {
  const tAttr = useTAttr();
  if (at == null || at === '') return <span className={`text-[10px] text-gray-400 ${className}`} data-vital-time="none">{tAttr('측정 시각 없음')}</span>;
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return <span className={`text-[10px] text-gray-400 ${className}`} data-vital-time="none">{tAttr('측정 시각 없음')}</span>;
  const ref = now ?? new Date();
  if (t > ref.getTime() + 5 * 60_000) {
    return <span className={`text-[10px] text-rose-600 ${className}`} data-vital-time="future"><KDate value={at} mode="datetime" /> · {tAttr('측정 시각이 미래')}</span>;
  }
  const f = vitalsFreshness(at, ref);
  const tone = f?.tone === 'stale' ? 'text-rose-600' : f?.tone === 'aging' ? 'text-amber-700' : 'text-gray-500';
  return (
    <span className={`text-[10px] ${tone} ${className}`} data-vital-time={f?.tone ?? 'unknown'}>
      <KDate value={at} mode="datetime" />{f ? <> · {f.text}</> : null}
    </span>
  );
}

export interface VitalSignsProps {
  /** 원장·응답 그대로 — 별칭 필드(pulse·temp·o2sat·"120/80")도 정본 키로 읽는다 */
  vitals: object | null | undefined;
  /** 측정 시각 — 넘기지 않으면 시각 줄을 그리지 않는다 · null 이면 "측정 시각 없음" */
  measuredAt?: string | Date | null;
  /** 그릴 항목(표준 순서로 다시 정렬된다) — 기본 병동·외래 줄 */
  keys?: readonly VitalSignKey[];
  /** 적용 임계 — 넘기지 않으면 부품이 서버 병합본을 읽는다 */
  rule?: VitalsRuleState;
  /** 이상 색을 칠하지 않는다(기록 원문 보기 등) */
  noFlags?: boolean;
  className?: string;
}

const ORDER: readonly VitalSignKey[] = ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'consciousness', 'temperature', 'painScore', 'bloodGlucose', 'weight', 'height', 'bmi'];

/** 표준 순서로 정렬(혈압은 수축기 자리 한 칸 · 이완기 단독 키는 수축기로) */
export function orderVitalKeys(keys: readonly VitalSignKey[]): VitalSignKey[] {
  const want = new Set<VitalSignKey>(keys.map((k): VitalSignKey => (k === 'diastolicBp' ? 'systolicBp' : k)));
  return ORDER.filter((k) => want.has(k));
}

function useVitalModel(p: VitalSignsProps) {
  const own = useVitalsThresholds();
  const rule = p.rule ?? own;
  const { values, issues } = React.useMemo(
    () => vitalConformance(p.vitals as Record<string, unknown> | null | undefined, p.measuredAt === undefined ? {} : { measuredAt: p.measuredAt }),
    [p.vitals, p.measuredAt],
  );
  const flags = p.noFlags ? null : flagsWith(rule, values);
  const keys = orderVitalKeys(p.keys ?? VITAL_SETS.standard);
  const suspectOf = (k: VitalSignKey): string | null => {
    const hit = issues.find((i) => i.severity === 'ERROR' && (i.key === k || (k === 'systolicBp' && i.key === 'diastolicBp')));
    return hit ? VITAL_CONFORMANCE_TEXT[hit.code] : null;
  };
  return { values, issues, flags, keys, suspectOf };
}

function cell(k: VitalSignKey, values: VitalValues, flags: ReturnType<typeof flagsWith>, suspect: string | null, noFlags?: boolean) {
  if (k === 'systolicBp') {
    return <BloodPressureValue systolic={values.systolicBp} diastolic={values.diastolicBp} systolicFlag={flags?.systolicBp} diastolicFlag={flags?.diastolicBp} suspect={suspect} />;
  }
  const flag: Flag = noFlags ? undefined
    : k === 'consciousness' ? consciousnessFlag(values.consciousness)
    : (flags as Record<string, Flag> | null)?.[k];
  return <VitalValue k={k} value={(values as Record<string, number | string | undefined>)[k]} flag={flag} suspect={suspect} />;
}

const labelOf = (k: VitalSignKey) => (k === 'systolicBp' ? 'BP' : VITAL_SIGN_DEF[k].abbr);

/** 표준 확인 필요 항목 수(ERROR 만) — 표기·이름 문제(INFO)는 데이터 속성으로만 */
function ConformanceNote({ issues }: { issues: VitalConformanceIssue[] }) {
  const tAttr = useTAttr();
  const errors = issues.filter((i) => i.severity === 'ERROR');
  return (
    <span data-vital-conformance={issues.map((i) => i.code).join(' ') || undefined} hidden={errors.length === 0}
      className="text-[10px] font-semibold text-rose-600" title={errors.map((i) => tAttr(VITAL_CONFORMANCE_TEXT[i.code])).join('\n')}>
      {errors.length > 0 && <Tf k="확인 필요 {n}" params={{ n: errors.length }} />}
    </span>
  );
}

/** 한 줄 — 헤더·카드·보드용. `RR 18 · SpO₂ 97% · BP 120/80 · HR 72 · BT 36.8℃` */
export function VitalSignsStrip(p: VitalSignsProps) {
  const m = useVitalModel(p);
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs tabular-nums ${p.className ?? ''}`} data-vital-strip>
      {m.keys.map((k) => (
        <span key={k} className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <span className="text-[10px] font-medium text-gray-500">{labelOf(k)}</span>
          {cell(k, m.values, m.flags, m.suspectOf(k), p.noFlags)}
        </span>
      ))}
      {p.measuredAt !== undefined && <VitalMeasuredAt at={p.measuredAt} />}
      <ConformanceNote issues={m.issues} />
    </span>
  );
}

/** 타일 — 차트 개요·상세 패널용 */
export function VitalSignsGrid(p: VitalSignsProps & { columns?: 2 | 3 | 4 | 6 }) {
  const tAttr = useTAttr();
  const m = useVitalModel(p);
  const cols = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4', 6: 'grid-cols-3 sm:grid-cols-6' }[p.columns ?? 6];
  return (
    <div className={p.className} data-vital-grid>
      <div className={`grid gap-2 ${cols}`}>
        {m.keys.map((k) => {
          const f: Flag = k === 'systolicBp' ? (m.flags?.systolicBp === 'CRITICAL' || m.flags?.diastolicBp === 'CRITICAL' ? 'CRITICAL' : m.flags?.systolicBp === 'WARNING' || m.flags?.diastolicBp === 'WARNING' ? 'WARNING' : null)
            : k === 'consciousness' ? consciousnessFlag(m.values.consciousness) : (m.flags as Record<string, Flag> | null)?.[k];
          const bg = p.noFlags ? 'bg-gray-50' : f === 'CRITICAL' ? 'bg-red-50 ring-1 ring-red-200' : f === 'WARNING' ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-gray-50';
          return (
            <div key={k} className={`rounded-lg px-2.5 py-2 ${bg}`}>
              <p className="text-[10px] text-gray-500"><span className="font-semibold">{labelOf(k)}</span> {k === 'systolicBp' ? tAttr('혈압') : tAttr(VITAL_SIGN_DEF[k].labelKo)}</p>
              <p className="text-base font-bold tabular-nums">{cell(k, m.values, m.flags, m.suspectOf(k), p.noFlags)}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {p.measuredAt !== undefined && <VitalMeasuredAt at={p.measuredAt} />}
        <ConformanceNote issues={m.issues} />
      </div>
    </div>
  );
}

/** 표준 순서 머리줄 — 표(플로시트·추이) 열 제목 */
export function VitalHeaderCells({ keys, className = 'px-2 py-1.5 text-left text-[10px] font-medium text-gray-500' }: { keys?: readonly VitalSignKey[]; className?: string }) {
  const tAttr = useTAttr();
  return <>{orderVitalKeys(keys ?? VITAL_SETS.standard).map((k) => (
    <th key={k} className={className} title={k === 'systolicBp' ? tAttr('혈압') : tAttr(VITAL_SIGN_DEF[k].labelKo)}>
      {labelOf(k)}{k === 'systolicBp' ? <span className="ml-0.5 font-normal opacity-70">mmHg</span> : VITAL_SIGN_DEF[k].displayUnit ? <span className="ml-0.5 font-normal opacity-70">{VITAL_SIGN_DEF[k].displayUnit}</span> : null}
    </th>
  ))}</>;
}

/** 표 한 행의 값 칸들(머리줄과 같은 순서) — 단위는 머리줄에 있으니 값만 */
export function VitalRowCells({ vitals, keys, rule, className = 'px-2 py-1.5 text-xs tabular-nums' }: { vitals: object | null | undefined; keys?: readonly VitalSignKey[]; rule?: VitalsRuleState; className?: string }) {
  const own = useVitalsThresholds();
  const r = rule ?? own;
  const { values, issues } = vitalConformance(vitals as Record<string, unknown> | null | undefined);
  const flags = flagsWith(r, values);
  return <>{orderVitalKeys(keys ?? VITAL_SETS.standard).map((k) => {
    const hit = issues.find((i) => i.severity === 'ERROR' && (i.key === k || (k === 'systolicBp' && i.key === 'diastolicBp')));
    const suspect = hit ? VITAL_CONFORMANCE_TEXT[hit.code] : null;
    return (
      <td key={k} className={className}>
        {k === 'systolicBp'
          ? <BloodPressureValue systolic={values.systolicBp} diastolic={values.diastolicBp} systolicFlag={flags?.systolicBp} diastolicFlag={flags?.diastolicBp} unit={false} suspect={suspect} />
          : <VitalValue k={k} value={(values as Record<string, number | string | undefined>)[k]} unit={false} suspect={suspect}
              flag={k === 'consciousness' ? consciousnessFlag(values.consciousness) : (flags as Record<string, Flag> | null)?.[k]} />}
      </td>
    );
  })}</>;
}

