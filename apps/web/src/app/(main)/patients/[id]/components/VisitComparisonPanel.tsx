'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DrugName, EmptyState, Num } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';
import { useKdate } from '@/lib/ui-settings';
import { Term } from '@/components/ui/term';
import { LabTerm } from '@/components/ui/lab-term';

/**
 * 이번 방문 ↔ 직전(서명) 방문 대비(patient-chart-refinement C7 · G2).
 *
 * 🔴 **값만 나란히.** "악화·호전·증량" 같은 판정 문구·화살표를 그리지 않는다 — 판정 기준이 정본에 없다.
 *    검사 flag(H/L 등)는 보고 시점에 기록된 값이라 그대로 보인다. 검사 값은 보고 문자열 그대로(재반올림 금지).
 * 🔴 **모르는 것은 `-`.** 재지 않은 활력·하지 않은 검사는 0 이 아니다.
 * 🔴 직전 방문이 없으면 비교표를 그리지 않고 **비교할 이전 방문이 없다**고 말한다.
 */

interface VisitRef { id: string; createdAt: string; status: string; visitType: string | null; doctorName: string | null }
interface Vitals {
  measuredAt: string;
  systolicBp: number | null; diastolicBp: number | null; heartRate: number | null; temperature: number | null;
  spo2: number | null; respiratoryRate: number | null; painScore: number | null; weight: number | null; bmi: number | null;
}
interface DxSide { type: string; certainty: string | null }
interface MedSide { dosage: string | null; frequency: string | null; duration: number | null; route: string | null; count: number }
interface LabSide { value: string; unit: string; flag: string | null; status: string; resultAt: string; count: number }
export interface VisitComparisonData {
  reason: 'NO_ENCOUNTER' | 'NO_PREVIOUS_VISIT' | null;
  current: VisitRef | null;
  previous: VisitRef | null;
  vitals: { current: Vitals | null; previous: Vitals | null };
  diagnoses: Array<{ code: string; nameKo: string; nameEn: string | null; current: DxSide | null; previous: DxSide | null }>;
  medications: Array<{ key: string; nameKo: string | null; nameEn: string | null; ingredient: string | null; current: MedSide | null; previous: MedSide | null }>;
  labs: Array<{ key: string; testName: string; current: LabSide | null; previous: LabSide | null }>;
  truncated: boolean;
}

/** 활력 행 — domain 이 있으면 수치 정본(`<Num>`)으로, 없으면(통증 점수) 정수 그대로 */
export const VITAL_ROWS: Array<{ key: keyof Omit<Vitals, 'measuredAt'>; label: string; domain?: string }> = [
  { key: 'systolicBp', label: '수축기혈압', domain: 'systolicBp' },
  { key: 'diastolicBp', label: '이완기혈압', domain: 'diastolicBp' },
  { key: 'heartRate', label: '심박수', domain: 'heartRate' },
  { key: 'temperature', label: '체온', domain: 'temperature' },
  { key: 'spo2', label: 'SpO₂', domain: 'spo2' },
  { key: 'respiratoryRate', label: '호흡수', domain: 'respiratoryRate' },
  { key: 'painScore', label: '통증 점수' },
  { key: 'weight', label: '체중', domain: 'weight' },
  { key: 'bmi', label: 'BMI', domain: 'bmi' },
];

const Dash = () => <span className="text-gray-300">-</span>;

function VitalValue({ v, domain }: { v: number | null | undefined; domain?: string }) {
  if (v == null) return <Dash />;
  return domain ? <Num value={v} domain={domain} /> : <>{v}</>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-gray-500 mb-1"><T k={title} /></p>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Head({ prev, cur }: { prev: React.ReactNode; cur: React.ReactNode }) {
  return (
    <thead>
      <tr className="text-[11px] text-gray-400">
        <th className="text-left font-normal py-1 pr-2"><T k="항목" /></th>
        <th className="text-left font-normal py-1 pr-2">{prev}</th>
        <th className="text-left font-normal py-1">{cur}</th>
      </tr>
    </thead>
  );
}

export function VisitComparisonPanel({ patientId, encounterId }: { patientId: string; encounterId: string }) {
  const kdate = useKdate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['visit-comparison', patientId, encounterId],
    queryFn: () => apiClient.get<{ data: VisitComparisonData }>(
      `/api/v1/patients/${patientId}/visit-comparison?encounterId=${encodeURIComponent(encounterId)}`,
    ),
    enabled: !!patientId && !!encounterId,
  });
  const c = data?.data;

  if (isLoading) return <p className="text-xs text-gray-400 py-2"><T k="비교 자료를 불러오는 중…" /></p>;
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;
  if (!c) return null;

  if (!c.previous) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3" data-testid="visit-comparison-panel">
        <EmptyState compact icon="↔" title="비교할 이전 방문 없음" hint="이 방문보다 먼저 서명된 방문 기록이 없습니다" />
      </div>
    );
  }

  const prevHead = <Tf k="직전 {일자}" params={{ 일자: kdate(c.previous.createdAt, 'date') }} />;
  const curHead = c.current ? <Tf k="이번 {일자}" params={{ 일자: kdate(c.current.createdAt, 'date') }} /> : <T k="이번" />;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-sm" data-testid="visit-comparison-panel">
      <p className="text-[11px] text-gray-400">
        <T k="직전 서명 방문과 값만 나란히 보여줍니다 — 판정은 하지 않습니다" />
      </p>
      {c.truncated && (
        <p className="text-[11px] text-amber-700 mt-1"><T k="처방 또는 검사 항목이 많아 일부만 비교했습니다" /></p>
      )}

      <Section title="활력">
        {!c.vitals.current && !c.vitals.previous ? (
          <p className="text-xs text-gray-400"><T k="두 방문 모두 이 방문에 연결된 활력 측정이 없습니다" /></p>
        ) : (
          <table className="w-full text-xs">
            <Head prev={prevHead} cur={curHead} />
            <tbody>
              {VITAL_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-gray-100">
                  <td className="py-1 pr-2 text-gray-500"><T k={row.label} /></td>
                  <td className="py-1 pr-2"><VitalValue v={c.vitals.previous?.[row.key]} domain={row.domain} /></td>
                  <td className="py-1"><VitalValue v={c.vitals.current?.[row.key]} domain={row.domain} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="진단">
        {c.diagnoses.length === 0 ? (
          <p className="text-xs text-gray-400"><T k="두 방문 모두 등록된 진단이 없습니다" /></p>
        ) : (
          <table className="w-full text-xs">
            <Head prev={prevHead} cur={curHead} />
            <tbody>
              {c.diagnoses.map((d) => (
                <tr key={d.code} className="border-t border-gray-100">
                  <td className="py-1 pr-2 text-gray-700">{d.code} <Term nameKo={d.nameKo} nameEn={d.nameEn} /></td>
                  <td className="py-1 pr-2">{d.previous ? <span>{d.previous.type}{d.previous.certainty ? ` · ${d.previous.certainty}` : ''}</span> : <Dash />}</td>
                  <td className="py-1">{d.current ? <span>{d.current.type}{d.current.certainty ? ` · ${d.current.certainty}` : ''}</span> : <Dash />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="약물 처방(활성)">
        {c.medications.length === 0 ? (
          <p className="text-xs text-gray-400"><T k="두 방문 모두 활성 약물 처방이 없습니다" /></p>
        ) : (
          <table className="w-full text-xs">
            <Head prev={prevHead} cur={curHead} />
            <tbody>
              {c.medications.map((m) => {
                const side = (s: MedSide | null) => s
                  ? <span>{[s.dosage, s.frequency, s.duration != null ? `${s.duration}d` : null, s.route].filter(Boolean).join(' · ') || <Dash />}{s.count > 1 ? ` ×${s.count}` : ''}</span>
                  : <Dash />;
                return (
                  <tr key={m.key} className="border-t border-gray-100">
                    <td className="py-1 pr-2 text-gray-700"><DrugName nameKo={m.nameKo} nameEn={m.nameEn} ingredient={m.ingredient} /></td>
                    <td className="py-1 pr-2">{side(m.previous)}</td>
                    <td className="py-1">{side(m.current)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="검사 결과">
        {c.labs.length === 0 ? (
          <p className="text-xs text-gray-400"><T k="두 방문 모두 이 방문 처방에서 나온 검사 결과가 없습니다" /></p>
        ) : (
          <table className="w-full text-xs">
            <Head prev={prevHead} cur={curHead} />
            <tbody>
              {c.labs.map((l) => {
                const side = (s: LabSide | null) => s ? (
                  <span>
                    {s.value} {s.unit}
                    {s.flag && <span className="ml-1 text-[10px] font-semibold text-gray-600">{s.flag}</span>}
                    {s.status !== 'VERIFIED' && <span className="ml-1 text-[10px] text-amber-700"><T k="예비" /></span>}
                  </span>
                ) : <Dash />;
                return (
                  <tr key={l.key} className="border-t border-gray-100">
                    <td className="py-1 pr-2 text-gray-700"><LabTerm name={l.testName} /></td>
                    <td className="py-1 pr-2">{side(l.previous)}</td>
                    <td className="py-1">{side(l.current)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
