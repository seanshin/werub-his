'use client';

import type { ReactNode } from 'react';
import { AI_CHAT_COMMANDS, AI_CHAT_GROUP_LABEL } from '@hospital-run/shared';
import { T, Tf } from '@/components/ui/i18n-text';
import { RichText } from './RichText';

/**
 * 어시스턴트 응답 유형별 표시(2026-10-02 재구성).
 * 🔴 종전엔 유형마다 마크다운 문자열을 지어 평문으로 그렸고, 모양이 조금만 달라도 `JSON.stringify` 덤프가 나왔다.
 *    이제 유형별 구조로 그리고, 모르는 모양은 **"정리하지 못한 응답"이라고 말한 뒤** 원본을 접어 둔다.
 * 🔴 빈 결과는 빈 결과라고 말한다(실패와 다르다 — 실패는 상위 카드가 출처 `UNAVAILABLE` 로 말한다).
 */

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : typeof x === 'number' ? String(x) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const nameOf = (x: unknown): string | null => (typeof x === 'string' ? x : isObj(x) ? str(x.name) ?? str(x.name_ko) ?? str(x.title) ?? str(x.code) : null);

/** 응답 본문이 비었을 때 — 실패가 아니라 "AI 가 비어 있는 결과를 돌려줬다" */
function EmptyResult() {
  return <p className="text-gray-500" data-ai-empty><T k="AI 가 빈 결과를 돌려줬습니다" /></p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"><T k={title} /></p>
      {children}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((c, i) => <span key={i} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[11px]">{c}</span>)}
    </div>
  );
}

function Soap({ soap }: { soap: unknown }) {
  if (!isObj(soap)) return null;
  const rows = [['S', soap.subjective], ['O', soap.objective], ['A', soap.assessment], ['P', soap.plan]] as const;
  const shown = rows.filter(([, v]) => str(v));
  if (!shown.length) return <EmptyResult />;
  return (
    <dl className="space-y-1.5">
      {shown.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[18px_1fr] gap-1.5">
          <dt className="font-semibold text-indigo-600">{k}</dt>
          <dd><RichText text={str(v)!} /></dd>
        </div>
      ))}
    </dl>
  );
}

function Unshaped({ data }: { data: unknown }) {
  return (
    <div className="space-y-1" data-ai-unshaped>
      <p className="text-gray-500"><T k="화면이 아직 정리하지 못한 응답 형식입니다 — 원본을 펼쳐 확인하세요" /></p>
      <details className="text-[11px]">
        <summary className="cursor-pointer text-gray-500"><T k="원본 응답 보기" /></summary>
        <pre className="mt-1 max-h-60 overflow-auto rounded bg-gray-900 p-2 text-[10px] text-gray-100">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

function TextOrUnshaped({ text, data }: { text: string | null; data: unknown }) {
  if (text) return <RichText text={text} />;
  return isObj(data) && Object.keys(data).length === 0 ? <EmptyResult /> : <Unshaped data={data} />;
}

export function HelpView({ commands, onPick }: { commands: string[]; onPick?: (cmd: string) => void }) {
  const allowed = new Set(commands);
  const groups = (['RECORD', 'CLINICAL', 'REFERENCE'] as const)
    .map((g) => ({ g, items: AI_CHAT_COMMANDS.filter((c) => c.group === g && allowed.has(c.cmd)) }))
    .filter((x) => x.items.length);
  return (
    <div className="space-y-2" data-ai-help>
      {groups.map(({ g, items }) => (
        <Section key={g} title={AI_CHAT_GROUP_LABEL[g]}>
          <ul className="space-y-1">
            {items.map((c) => (
              <li key={c.cmd}>
                <button type="button" onClick={() => onPick?.(c.cmd)} className="text-left hover:text-indigo-700">
                  <code className="rounded bg-gray-100 px-1 font-mono text-[12px]">{c.cmd}{c.argHint ? ` ${c.argHint}` : ''}</code>{' '}
                  <span className="text-gray-600"><T k={c.desc} /></span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

export function AiResultView({ type, data, onPick }: { type: string; data: unknown; onPick?: (cmd: string) => void }) {
  const d: Obj = isObj(data) ? data : {};
  switch (type) {
    case 'help':
      return <HelpView commands={arr(d.commands).filter((c): c is string => typeof c === 'string')} onPick={onPick} />;

    case 'summarize': {
      const icd = arr(d.icd_codes).map(nameOf).filter((x): x is string => !!x);
      if (!isObj(d.summary) && !icd.length) return <TextOrUnshaped text={str(d.summary) ?? str(d.content)} data={data} />;
      return (
        <div className="space-y-2">
          <Soap soap={d.summary} />
          {icd.length > 0 && <Section title="ICD 후보"><Chips items={icd} /></Section>}
        </div>
      );
    }

    case 'auto-record': {
      const icd = arr(d.icd_codes).map(nameOf).filter((x): x is string => !!x);
      const rx = arr(d.prescriptions).map(nameOf).filter((x): x is string => !!x);
      if (!isObj(d.soap) && !icd.length && !rx.length) return <Unshaped data={data} />;
      return (
        <div className="space-y-2">
          <Soap soap={d.soap} />
          {icd.length > 0 && <Section title="ICD 후보"><Chips items={icd} /></Section>}
          {rx.length > 0 && <Section title="처방 후보"><Chips items={rx} /></Section>}
        </div>
      );
    }

    case 'diagnose': {
      const dx = arr(d.differential_diagnosis ?? d.differentials ?? d.diagnoses).filter(isObj);
      if (!dx.length) return Array.isArray(d.differential_diagnosis ?? d.differentials ?? d.diagnoses) ? <EmptyResult /> : <Unshaped data={data} />;
      return (
        <ol className="space-y-1.5" data-ai-ddx>
          {dx.map((x, i) => (
            <li key={i} className="rounded-lg border border-gray-200 bg-white p-2">
              <p className="font-medium">
                {i + 1}. {str(x.diagnosis_ko) ?? str(x.diagnosis) ?? str(x.name) ?? '-'}
                {str(x.icd10) && <span className="ml-1 font-mono text-[11px] text-gray-500">{str(x.icd10)}</span>}
                {str(x.probability) && <span className="ml-1 text-[11px] text-indigo-600">{str(x.probability)}</span>}
              </p>
              {arr(x.supporting).length > 0 && (
                <p className="text-[12px] text-gray-600"><T k="근거" />: {arr(x.supporting).map(nameOf).filter(Boolean).join(', ')}</p>
              )}
            </li>
          ))}
        </ol>
      );
    }

    case 'drug': {
      const a = d.answer;
      const text = str(a) ?? (isObj(a) ? str(a.ko) ?? str(a.en) : null) ?? str(d.info) ?? str(d.content);
      return <TextOrUnshaped text={text} data={data} />;
    }

    case 'explain': {
      const kp = arr(d.key_points).map(nameOf).filter((x): x is string => !!x);
      const text = str(d.explanation);
      if (!text && !kp.length) return <Unshaped data={data} />;
      return (
        <div className="space-y-2">
          {text && <RichText text={text} />}
          {kp.length > 0 && <Section title="핵심"><ul className="ml-5 list-disc">{kp.map((k, i) => <li key={i}>{k}</li>)}</ul></Section>}
        </div>
      );
    }

    case 'reference':
    case 'chat': {
      const text = str(d.answer) ?? str(d.response);
      const sources = arr(d.sources).map(nameOf).filter((x): x is string => !!x);
      return (
        <div className="space-y-2">
          {text ? <RichText text={text} /> : <EmptyResult />}
          {sources.length > 0 && (
            <Section title="참고한 자료">
              <ul className="ml-5 list-disc text-[12px] text-gray-600">
                {sources.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              {sources.length > 5 && <p className="text-[11px] text-gray-400"><Tf k="외 {n}건" params={{ n: sources.length - 5 }} /></p>}
            </Section>
          )}
        </div>
      );
    }

    case 'translate':
      return <TextOrUnshaped text={str(d.translation) ?? str(d.result)} data={data} />;

    case 'draft':
      return <TextOrUnshaped text={str(d.content) ?? str(d.draft) ?? str(d.text)} data={data} />;

    case 'writing':
      return (
        <div className="space-y-1">
          <TextOrUnshaped text={str(d.result) ?? str(d.text) ?? str(d.content)} data={data} />
          {arr(d.models_used).length > 0 && <p className="text-[11px] text-gray-400"><T k="모델" />: {arr(d.models_used).map(String).join(' → ')}</p>}
        </div>
      );

    case 'reasoning': {
      const steps = arr(d.steps).filter(isObj);
      if (!steps.length) return <EmptyResult />;
      return (
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="rounded-lg border border-gray-200 bg-white p-2">
              <p className="text-[12px] font-semibold text-indigo-700">{i + 1}. {str(s.name) ?? str(s.step) ?? ''}</p>
              {str(s.result) ? <RichText text={str(s.result)!} /> : <Unshaped data={s} />}
            </li>
          ))}
        </ol>
      );
    }

    case 'kcd':
    case 'edi': {
      const rows = arr(Array.isArray(data) ? data : d.results).filter(isObj);
      if (!rows.length) return Array.isArray(data) || Array.isArray(d.results) ? <EmptyResult /> : <Unshaped data={data} />;
      const shown = rows.slice(0, 20);
      return (
        <div className="space-y-1">
          <table className="w-full text-[12px]">
            <tbody>
              {shown.map((c, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1 pr-2 font-mono">{str(c.code) ?? '-'}</td>
                  <td>{str(c.name) ?? str(c.name_ko) ?? str(c.description) ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && <p className="text-[11px] text-gray-400"><Tf k="{전체}건 중 {n}건 표시" params={{ 전체: rows.length, n: shown.length }} /></p>}
        </div>
      );
    }

    case 'mapping': {
      const tests = arr(d.tests).map(nameOf).filter((x): x is string => !!x);
      const meds = arr(d.medications).map(nameOf).filter((x): x is string => !!x);
      if (!tests.length && !meds.length) return Array.isArray(d.tests) || Array.isArray(d.medications) ? <EmptyResult /> : <Unshaped data={data} />;
      return (
        <div className="space-y-2">
          {tests.length > 0 && <Section title="검사"><Chips items={tests} /></Section>}
          {meds.length > 0 && <Section title="처방"><Chips items={meds} /></Section>}
        </div>
      );
    }

    case 'predict': {
      const recs = arr(d.recommendations).map(nameOf).filter((x): x is string => !!x);
      if (!str(d.risk_level) && !recs.length) return <Unshaped data={data} />;
      return (
        <div className="space-y-1.5">
          {str(d.risk_level) && (
            <p>
              <T k="위험도" />: <strong>{str(d.risk_level)}</strong>
              {/* 보고값 그대로 — 화면이 반올림하지 않는다 */}
              {str(d.risk_score) && <span className="ml-1 text-gray-500">({str(d.risk_score)})</span>}
            </p>
          )}
          {recs.length > 0 && <Section title="권고"><ul className="ml-5 list-disc">{recs.map((r, i) => <li key={i}>{r}</li>)}</ul></Section>}
        </div>
      );
    }

    case 'predict-adr': {
      const ev = arr(d.adverse_events).filter(isObj);
      if (!ev.length) return Array.isArray(d.adverse_events) ? <EmptyResult /> : <Unshaped data={data} />;
      return (
        <ul className="space-y-1">
          {ev.map((e, i) => (
            <li key={i} className="rounded border border-gray-200 bg-white px-2 py-1">
              <span className="font-medium">{str(e.drug) ?? '-'}</span> — {str(e.event) ?? '-'}
              {str(e.severity) && <span className="ml-1 text-[11px] text-rose-600">{str(e.severity)}</span>}
            </li>
          ))}
        </ul>
      );
    }

    case 'enhanced': {
      const stages = arr(d.stages).filter(isObj);
      return (
        <div className="space-y-1.5">
          {stages.length > 0
            ? stages.map((s, i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-white p-2">
                <p className="text-[12px] font-semibold text-indigo-700">Stage {i + 1}{str(s.model) ? ` · ${str(s.model)}` : ''}</p>
                {str(s.result) ? <RichText text={str(s.result)!} /> : <Unshaped data={s} />}
              </div>
            ))
            : <TextOrUnshaped text={str(d.answer) ?? str(d.result)} data={data} />}
          {arr(d.models_used).length > 0 && <p className="text-[11px] text-gray-400"><T k="모델" />: {arr(d.models_used).map(String).join(' → ')}</p>}
        </div>
      );
    }

    default:
      return <Unshaped data={data} />;
  }
}

/** 복사할 글(초안류) — 차트에 쓰는 경로는 없다. 사람이 기록 화면에 옮긴다 */
export function copyableText(type: string, data: unknown): string | null {
  const d: Obj = isObj(data) ? data : {};
  const soapText = (s: unknown) => (isObj(s)
    ? [['S', s.subjective], ['O', s.objective], ['A', s.assessment], ['P', s.plan]].filter(([, v]) => str(v)).map(([k, v]) => `${k}: ${str(v)}`).join('\n')
    : null);
  switch (type) {
    case 'summarize': return soapText(d.summary) || str(d.summary);
    case 'auto-record': return soapText(d.soap);
    case 'explain': return str(d.explanation);
    case 'draft': return str(d.content) ?? str(d.draft) ?? str(d.text);
    case 'writing': return str(d.result) ?? str(d.text) ?? str(d.content);
    case 'translate': return str(d.translation) ?? str(d.result);
    default: return null;
  }
}
