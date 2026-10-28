'use client';

/**
 * 활력 표시 표준(3415 · 2026-10-07) — 의료진이 보는 활력 표기가 무엇을 따르는지와, 원장 기록이 그 표준에 맞는지.
 *  ① 표준표: 순서(NEWS2 차트)·약어·LOINC·UCUM·표시 단위·자릿수(수치 정책)·입력 타당성 범위 — shared `vital-signs.ts` 그대로
 *  ② 이상 표시 기준: 서버 병합 임계(환자안전위 개정 반영 여부) — 숫자는 여기서 바꾸지 않는다(정본은 설정 `clinical.vitals.thresholds`)
 *  ③ 표시 예시: 화면 공용 부품이 그리는 모양(가상 값)
 *  ④ 원장 적합성: 4개 원장의 기록이 표준에 맞는지 — 수와 표본 id(고치지 않는다 · 잘랐으면 잘랐다고)
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BLOOD_PRESSURE_PANEL_LOINC, NUMERIC_POLICIES, VITAL_CONFORMANCE_TEXT, VITAL_SIGN_DEFS, vitalNormalRangeText, type VitalConformanceCode } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { useVitalsThresholds } from '@/lib/vital-flags';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { VitalSignsGrid, VitalSignsStrip } from '@/components/vitals/VitalSigns';

type Ledger = {
  source: 'PRE_VISIT' | 'FLOWSHEET' | 'ICU' | 'EWS'; total: number; scanned: number; truncated: boolean; recordsWithErrors: number;
  byCode: Partial<Record<VitalConformanceCode, number>>;
  samples: Array<{ id: string; at: string | null; code: VitalConformanceCode; key?: string; value?: unknown }>;
};
type Report = { days: number; since: string; ledgers: Ledger[]; schemaAliases: Array<{ model: string; field: string; canonical: string }> };

const SOURCE_LABEL: Record<Ledger['source'], string> = { PRE_VISIT: '외래 측정', FLOWSHEET: '병동 플로시트', ICU: '중환자실 기록', EWS: '조기경보(NEWS2)' };
const SAMPLE_VITALS = { respiratoryRate: 22, spo2: 93, systolicBp: 88, diastolicBp: 54, heartRate: 112, consciousness: 'ALERT', temperature: 38.24, painScore: 6 };

export default function VitalsStandardPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const rule = useVitalsThresholds();
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['vitals-standard-conformance', days],
    queryFn: () => apiClient.get<{ data: Report }>(`/api/v1/vitals-standard/conformance?days=${days}`),
  });
  const report = q.data?.data;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900"><T k="활력 표시 표준" /></h1>
        <p className="mt-1 text-sm text-gray-500"><T k="모든 화면이 같은 순서·단위·자릿수로 활력을 그리고, 미측정은 '—', 이상 색은 원내 기준으로만 칠합니다." /></p>
      </header>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900"><T k="표준표" /></h2>
        <p className="mb-3 text-[11px] text-gray-500">
          <T k="순서: NEWS2 관찰 차트(RCP 2017) · 코드·단위: FHIR Vital Signs(LOINC·UCUM)" /> · <Tf k="혈압은 한 값(수축기/이완기 · LOINC {코드})" params={{ 코드: BLOOD_PRESSURE_PANEL_LOINC }} /> ·{' '}
          <Link href="/admin/numeric-policy" className="text-blue-600 underline"><T k="자릿수는 수치 정책에서" /></Link>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-vitals-standard-table>
            <thead><tr className="border-b border-gray-100 text-left text-[10px] text-gray-500">
              <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5"><T k="약어" /></th><th className="px-2 py-1.5"><T k="항목" /></th>
              <th className="px-2 py-1.5">LOINC</th><th className="px-2 py-1.5">UCUM</th><th className="px-2 py-1.5"><T k="표시 단위" /></th>
              <th className="px-2 py-1.5"><T k="자릿수" /></th><th className="px-2 py-1.5"><T k="입력 타당성 범위" /></th><th className="px-2 py-1.5"><T k="이상 표시 기준(정상)" /></th>
            </tr></thead>
            <tbody>
              {VITAL_SIGN_DEFS.map((d, i) => {
                const p = d.numericDomain ? NUMERIC_POLICIES[d.numericDomain] : null;
                const t = (rule.thresholds as Record<string, Parameters<typeof vitalNormalRangeText>[0] | undefined>)[d.key];
                return (
                  <tr key={d.key} className="border-b border-gray-50" data-vital-def={d.key}>
                    <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5 font-semibold">{d.abbr}</td>
                    <td className="px-2 py-1.5">{tAttr(d.labelKo)}</td>
                    <td className="px-2 py-1.5 font-mono">{d.loinc}</td>
                    <td className="px-2 py-1.5 font-mono">{d.ucum ?? '—'}</td>
                    <td className="px-2 py-1.5">{d.displayUnit || '—'}</td>
                    <td className="px-2 py-1.5">{p ? (p.decimals ?? 0) : '—'}</td>
                    <td className="px-2 py-1.5">{d.plausible ? `${d.plausible[0]}–${d.plausible[1]}` : '—'}</td>
                    <td className="px-2 py-1.5">{t ? (vitalNormalRangeText(t) ?? '—') : d.key === 'consciousness' ? tAttr('A 외 주의(NEWS2)') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-gray-500"><T k="입력 타당성 범위는 기기·전사 오류를 찾는 범위입니다 — 임상 판정이 아니며 값을 고치거나 숨기지 않습니다." /></p>
        <VitalsRuleNote rule={rule} className="mt-1" />
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900"><T k="표시 예시(가상 값)" /></h2>
        <div className="space-y-3">
          <VitalSignsStrip vitals={SAMPLE_VITALS} measuredAt={new Date(Date.now() - 40 * 60_000).toISOString()} rule={rule} keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'consciousness', 'temperature', 'painScore']} />
          <VitalSignsGrid vitals={{ ...SAMPLE_VITALS, painScore: undefined }} measuredAt={null} rule={rule} />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900"><T k="원장 기록 적합성" /></h2>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={tAttr('기간')} className="rounded-lg border border-gray-200 px-2 py-1 text-xs">
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{tfAttr('최근 {n}일', { n: d })}</option>)}
          </select>
          <span className="text-[10px] text-gray-500"><T k="원장마다 기간 안 최근 5,000건 · 수와 기록 id 만(고치지 않음)" /></span>
        </div>
        {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
          : !report ? <p className="py-6 text-center text-xs text-gray-400"><T k="불러오는 중..." /></p>
          : (
            <div className="grid gap-3 md:grid-cols-2" data-vitals-conformance-report>
              {report.ledgers.map((l) => {
                const codes = Object.entries(l.byCode) as Array<[VitalConformanceCode, number]>;
                return (
                  <div key={l.source} className="rounded-xl border border-gray-100 p-3" data-ledger={l.source}>
                    <p className="text-xs font-bold text-gray-900">{tAttr(SOURCE_LABEL[l.source])}</p>
                    <p className="text-[11px] text-gray-500">
                      <Tf k="본 기록 {n}건 / 기간 안 {total}건" params={{ n: l.scanned, total: l.total }} />
                      {l.truncated && <span className="ml-1 text-amber-700"><T k="· 잘림(최근 것만 봄)" /></span>}
                    </p>
                    {l.scanned === 0 ? <p className="mt-2 text-[11px] text-gray-400"><T k="기간 안 기록 없음 — 셀 표본이 없습니다" /></p> : (
                      <>
                        <p className={`mt-1 text-sm font-bold ${l.recordsWithErrors > 0 ? 'text-rose-600' : 'text-gray-900'}`} data-records-with-errors={l.recordsWithErrors}>
                          <Tf k="확인 필요 기록 {n}건" params={{ n: l.recordsWithErrors }} />
                        </p>
                        {codes.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-[11px]">
                            {codes.map(([c, n]) => <li key={c} data-code={c}><span className="font-mono text-gray-400">{c}</span> {tAttr(VITAL_CONFORMANCE_TEXT[c])} · {n}</li>)}
                          </ul>
                        )}
                        {l.samples.length > 0 && (
                          <details className="mt-2 text-[10px] text-gray-600">
                            <summary className="cursor-pointer"><Tf k="표본 {n}건(기록 id)" params={{ n: l.samples.length }} /></summary>
                            <ul className="mt-1 space-y-0.5 font-mono">
                              {l.samples.map((s, i) => <li key={`${s.id}-${s.code}-${i}`}>{s.id.slice(0, 8)} · <KDate value={s.at} mode="datetime" unknown="UNRECORDED" /> · {s.code}{s.key ? ` · ${s.key}=${String(s.value)}` : ''}</li>)}
                            </ul>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {report.schemaAliases.length > 0 && (
                <p className="text-[10px] text-gray-500 md:col-span-2">
                  <T k="스키마 필드 이름이 표준과 다른 원장(기록 결함이 아님 · 화면은 표준 이름으로 읽음):" />{' '}
                  {report.schemaAliases.map((a) => `${a.model}.${a.field} → ${a.canonical}`).join(', ')}
                </p>
              )}
            </div>
          )}
      </section>
    </div>
  );
}
