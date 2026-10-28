'use client';

/**
 * 요양기관 종별 계산기(2026-10-20) — 같은 진료를 의원·병원·종합병원·상급종합으로 나란히 센다.
 * 서버 `POST billing/grade-calculator`(고시 종별 단가 · 실청구와 같은 본인부담 규칙 · 저장 없음).
 *  · 🔴 고시 0 = 그 종별 미산정 · 없으면 미등재 — 0원으로 그리지 않는다(합계에서 빼고 몇 줄 뺐는지 말한다)
 *  · 🔴 실청구 단가(수가 마스터)가 고시 종별 단가와 다르면 줄마다 보인다
 *  · 지금 설정된 종별을 표시한다 — 미설정이면 "미설정(실청구는 의원)"
 */
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Money } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { Term } from '@/components/ui/term';

type Grade = 'CLINIC' | 'HOSPITAL' | 'GENERAL' | 'TERTIARY';
const GRADES: Grade[] = ['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'];
const GRADE_LABEL: Record<Grade, string> = { CLINIC: '의원', HOSPITAL: '병원', GENERAL: '종합병원', TERTIARY: '상급종합병원' };
const COPAY_LABEL: Record<string, string> = {
  NHI: '건강보험', MA_TYPE1: '의료급여 1종', MA_TYPE2: '의료급여 2종', NEAR_POOR: '차상위', SPECIAL_EXEMPTION: '산정특례',
  PATRIOT: '보훈', INDUSTRIAL: '산재', AUTO: '자동차보험', SELF_PAY: '일반(자비)',
};
const BASIS_LABEL: Record<string, string> = {
  NOT_BILLABLE_AT_TIER: '이 종별 미산정', NOT_LISTED: '고시 미등재', NO_GAZETTE_LOADED: '고시 없음',
};

interface Line { code: string; name: string | null; role: 'CONSULTATION' | 'ITEM'; quantity: number; unitPrice: number | null; amount: number | null; basis: string; covered: boolean | null; copayRate: number | null; billedUnitPrice: number | null }
interface GradeResult { grade: Grade; isConfigured: boolean; baseCopayRate: number; lines: Line[]; totalAmount: number | null; patientCopay: number | null; insurerAmount: number | null; excludedLines: number; billedMismatchLines: number }
interface Caveat { code: 'NO_GAZETTE' | 'GRADE_UNSET' | 'GRADE_UNKNOWN' | 'NHI_SINGLE_RATE' | 'NHI_GRADE_RATES' | 'BILLED_PRICE' | 'NOT_INCLUDED'; value?: string }
interface CalcResponse { onDate: string; gazetteEffectiveDate: string | null; configuredGrade: Grade | null; copayCategory: string; results: GradeResult[]; caveats: Caveat[] }

/** 서버 단서 코드 → 문장(화면이 조립 · 값은 끼워 넣기만) */
function CaveatText({ c }: { c: Caveat }) {
  switch (c.code) {
    case 'NO_GAZETTE': return <T k="기준일을 덮는 수가 고시가 등재되지 않아 단가를 말할 수 없습니다(코드 마스터 → 수가 고시 반영)." />;
    case 'GRADE_UNSET': return <T k="요양기관 종별이 설정되지 않았습니다 — 실청구는 의원 코드·의원 단가로 나갑니다(결정 billing.institutionType)." />;
    case 'GRADE_UNKNOWN': return <><T k="요양기관 종별 설정값을 알 수 없습니다 — 실청구 진찰료 코드를 고르지 못합니다" />: {c.value}</>;
    case 'NHI_SINGLE_RATE': return <><T k="건강보험 외래 본인부담률은 종별 구분 없이 단일 율을 씁니다(실청구와 같음) — 종별 차등은 위 「건강보험 외래 본인부담률」에서 정합니다" />: {c.value}%</>;
    case 'NHI_GRADE_RATES': return <T k="건강보험 외래 본인부담률은 종별 차등 설정을 씁니다 — 열마다 그 종별의 율입니다." />;
    case 'BILLED_PRICE': return <T k="「청구 단가」는 지금 설정에서 실청구가 쓰는 단가입니다(종별을 정했으면 그 종별의 고시 단가, 미설정이면 수가 마스터) — 이 열의 고시 단가와 다를 때만 보입니다." />;
    case 'NOT_INCLUDED': return <T k="본인부담상한·감면·가산(야간·공휴·소아 등)·상급종합 진찰료 전액 본인부담 같은 세부 규칙은 넣지 않았습니다." />;
    default: return <>{(c as Caveat).code}</>;
  }
}
interface CodeHit { code: string; nameKo: string; nameEn?: string | null }

export function GradeCalculatorPanel() {
  const tAttr = useTAttr();
  const [visitKind, setVisitKind] = useState<'INITIAL' | 'FOLLOW_UP' | 'NONE'>('INITIAL');
  const [copayCategory, setCopayCategory] = useState('NHI');
  const [items, setItems] = useState<{ code: string; name: string; quantity: number }[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CodeHit[]>([]);
  const [searchError, setSearchError] = useState(false);
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (q.trim().length < 2) return;
    setSearchError(false);
    try {
      const res = await apiClient.get<{ data: CodeHit[] }>('/api/v1/codes/procedure', { q: q.trim() });
      const raw = res.data as unknown;
      setHits((Array.isArray(raw) ? raw : (raw as { data?: CodeHit[] })?.data ?? []).slice(0, 10));
    } catch { setHits([]); setSearchError(true); }
  };
  const add = (h: CodeHit) => {
    setItems((list) => (list.some((i) => i.code === h.code) ? list : [...list, { code: h.code, name: h.nameKo, quantity: 1 }]));
    setHits([]); setQ('');
  };
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiClient.post<{ data: CalcResponse }>('/api/v1/billing/grade-calculator', {
        visitKind, copayCategory, items: items.map(({ code, quantity }) => ({ code, quantity })),
      });
      setResult(res.data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const rows = result ? result.results[0]?.lines.map((_, idx) => idx) ?? [] : [];

  return (
    <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-5 mb-6" data-grade-calculator>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="요양기관 종별 계산기" /></h3>
          <p className="text-xs text-gray-500 mt-0.5"><T k="같은 진료를 의원·병원·종합병원·상급종합병원으로 나란히 셉니다 — 수가 고시 종별 단가 · 실청구와 같은 본인부담 규칙 · 저장하지 않습니다" /></p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <label className="text-xs text-gray-600 flex flex-col gap-1">
          <T k="진찰료" />
          <select value={visitKind} onChange={(e) => setVisitKind(e.target.value as typeof visitKind)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" data-grade-calc-visit>
            <option value="INITIAL">{tAttr('초진')}</option>
            <option value="FOLLOW_UP">{tAttr('재진')}</option>
            <option value="NONE">{tAttr('진찰료 없음')}</option>
          </select>
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">
          <T k="본인부담 구분" />
          <select value={copayCategory} onChange={(e) => setCopayCategory(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
            {Object.entries(COPAY_LABEL).map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
          </select>
        </label>
        <div className="text-xs text-gray-600 flex flex-col gap-1">
          <T k="수가 코드 추가" />
          <div className="flex gap-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
              placeholder={tAttr('코드 또는 행위명')} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" data-grade-calc-search />
            <button type="button" onClick={() => void search()} className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50"><T k="찾기" /></button>
          </div>
        </div>
      </div>

      {searchError && <p className="text-xs text-rose-600 mb-2"><T k="수가 코드 검색에 실패했습니다." /></p>}
      {hits.length > 0 && (
        <ul className="mb-3 border border-gray-100 rounded-lg divide-y max-h-48 overflow-auto">
          {hits.map((h) => (
            <li key={h.code}>
              <button type="button" onClick={() => add(h)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50">
                <span className="font-mono text-gray-500 mr-2">{h.code}</span><Term nameKo={h.nameKo} nameEn={h.nameEn ?? null} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="mb-3 space-y-1" data-grade-calc-items>
          {items.map((it) => (
            <li key={it.code} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-gray-500 w-20 shrink-0">{it.code}</span>
              <span className="flex-1 truncate">{it.name}</span>
              <input type="number" min={1} max={999} value={it.quantity}
                onChange={(e) => setItems((l) => l.map((x) => (x.code === it.code ? { ...x, quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) } : x)))}
                className="w-16 border border-gray-200 rounded px-1 py-0.5 text-right" aria-label={tAttr('수량')} />
              <button type="button" onClick={() => setItems((l) => l.filter((x) => x.code !== it.code))} className="text-rose-500 px-1" aria-label={tAttr('빼기')}>×</button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => void run()} disabled={busy || (visitKind === 'NONE' && items.length === 0)}
        className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40" data-grade-calc-run>
        {busy ? <T k="계산 중…" /> : <T k="종별로 계산" />}
      </button>
      {error && <p className="text-xs text-rose-600 mt-2" data-grade-calc-error><T k="계산하지 못했습니다" />: {error}</p>}

      {result && (
        <div className="mt-4" data-grade-calc-result>
          <p className="text-xs text-gray-600 mb-2">
            <T k="기준일" /> {result.onDate} · <T k="수가 고시" /> {result.gazetteEffectiveDate ?? <T k="없음" />} · <T k="지금 설정된 종별" />:{' '}
            <b data-grade-calc-configured>{result.configuredGrade ? <T k={GRADE_LABEL[result.configuredGrade]} /> : <T k="미설정(실청구는 의원 코드·의원 단가)" />}</b>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="text-left py-1 pr-2"><T k="항목" /></th>
                  {result.results.map((r) => (
                    <th key={r.grade} className={`text-right py-1 px-2 ${r.isConfigured ? 'bg-indigo-50 text-indigo-800' : ''}`} data-grade-col={r.grade}>
                      <T k={GRADE_LABEL[r.grade]} />{r.isConfigured && <span className="ml-1 text-[10px]">(<T k="설정" />)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((idx) => {
                  const first = result.results[0].lines[idx];
                  return (
                    <tr key={idx} className="border-b border-gray-50 align-top">
                      <td className="py-1 pr-2">
                        {first.role === 'CONSULTATION' ? <T k={visitKind === 'INITIAL' ? '초진 진찰료' : '재진 진찰료'} /> : <>{first.name ?? first.code}</>}
                        {first.role === 'ITEM' && <span className="text-gray-400"> ×{first.quantity}</span>}
                      </td>
                      {result.results.map((r) => {
                        const l = r.lines[idx];
                        return (
                          <td key={r.grade} className={`py-1 px-2 text-right ${r.isConfigured ? 'bg-indigo-50/40' : ''}`}>
                            {l.role === 'CONSULTATION' && <div className="font-mono text-[10px] text-gray-400">{l.code}</div>}
                            {l.amount != null ? <Money value={l.amount} /> : <span className="text-gray-400" data-grade-calc-unpriced><T k={BASIS_LABEL[l.basis] ?? '모름'} /></span>}
                            {l.covered === false && <div className="text-[10px] text-amber-700"><T k="비급여" /></div>}
                            {l.unitPrice != null && l.billedUnitPrice != null && l.unitPrice !== l.billedUnitPrice && (
                              <div className="text-[10px] text-rose-600" data-grade-calc-master-diff><T k="청구 단가" /> <Money value={l.billedUnitPrice} /></div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="font-semibold">
                <tr className="border-t">
                  <td className="py-1 pr-2"><T k="요양급여 총액" /></td>
                  {result.results.map((r) => <td key={r.grade} className="py-1 px-2 text-right" data-grade-total={r.grade}>{r.totalAmount != null ? <Money value={r.totalAmount} /> : '-'}</td>)}
                </tr>
                <tr>
                  <td className="py-1 pr-2 font-normal text-gray-500"><T k="기본 본인부담률" /></td>
                  {result.results.map((r) => <td key={r.grade} className="py-1 px-2 text-right font-normal text-gray-600" data-grade-rate={r.grade}>{Math.round(r.baseCopayRate * 100)}%</td>)}
                </tr>
                <tr>
                  <td className="py-1 pr-2"><T k="본인부담" /></td>
                  {result.results.map((r) => <td key={r.grade} className="py-1 px-2 text-right text-indigo-700" data-grade-copay={r.grade}>{r.patientCopay != null ? <Money value={r.patientCopay} /> : '-'}</td>)}
                </tr>
                <tr>
                  <td className="py-1 pr-2 font-normal text-gray-500"><T k="공단 부담" /></td>
                  {result.results.map((r) => <td key={r.grade} className="py-1 px-2 text-right font-normal text-gray-600">{r.insurerAmount != null ? <Money value={r.insurerAmount} /> : '-'}</td>)}
                </tr>
                <tr>
                  <td className="py-1 pr-2 font-normal text-gray-500"><T k="합계에서 뺀 줄" /></td>
                  {result.results.map((r) => <td key={r.grade} className={`py-1 px-2 text-right font-normal ${r.excludedLines ? 'text-amber-700' : 'text-gray-400'}`} data-grade-excluded={r.grade}>{r.excludedLines}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="mt-3 space-y-0.5 text-[11px] text-gray-600 list-disc pl-4" data-grade-calc-caveats>
            {result.caveats.map((c, i) => <li key={i}><CaveatText c={c} /></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
