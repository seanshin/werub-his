'use client';

import { useQuery } from '@tanstack/react-query';
import { NEWS2_RISK_LABEL, BRADEN_ITEMS, BRADEN_RISK_LABEL, type News2RiskLevel, type BradenCheck, type BradenItemKey, type BradenRiskLevel } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 이 재원의 위험 평가 추이(2026-10-10) — NEWS2·낙상·Braden 이력(하위 6항목·평가자·확인 필요) + 재측정 참고 + 재평가 예정.
 *  · 🔴 재측정 빈도는 원내 규정이 아니라 RCP 권고(참고)라고 그 자리에서 말한다
 *  · NEWS2 는 7요소가 다 관측된 측정만 점수가 있다 — 점수가 없으면 없다고(0점으로 그리지 않는다)
 *  · 재평가 일정이 없으면 없다고(자동 생성은 위원회 설정)
 */
interface RiskHistory {
  patientId: string;
  news2: {
    items: Array<{ id: string; recordedAt: string; totalScore: number; riskLevel: News2RiskLevel; escalationRequired: boolean; supplementalO2: boolean; consciousness: string }>;
    total: number; truncated: boolean;
    monitoringReference: { band: string; minIntervalHours: number | null; label: string } | null;
    monitoringSource: string;
  };
  fall: { items: Array<{ id: string; assessedAt: string; score: number; riskLevel: string }>; total: number; truncated: boolean };
  braden: {
    items: Array<{
      id: string; source: 'NURSING_ASSESSMENT' | 'CHART_TOOL' | 'REASSESSMENT'; assessedAt: string;
      total: number | null; subscores: Partial<Record<BradenItemKey, number>> | null; riskLevel: BradenRiskLevel | null; checks: BradenCheck[];
      assessor: { id: string; name: string | null };
    }>;
    total: number; truncated: boolean; needsReview: number;
  };
  schedules: Array<{ assessmentType: string; toolName: string; intervalHours: number; nextDueAt: string; lastScore: number | null; lastRiskLevel: string | null; lastAssessedAt: string | null }>;
}
const RISK_TONE: Record<string, string> = { LOW: 'bg-emerald-50 text-emerald-800', LOW_MEDIUM: 'bg-amber-50 text-amber-800', MEDIUM: 'bg-orange-50 text-orange-800', HIGH: 'bg-red-50 text-red-800' };
const FALL_LABEL: Record<string, string> = { LOW: '저위험', MODERATE: '중위험', HIGH: '고위험' };
const TYPE_LABEL: Record<string, string> = { FALL_RISK: '낙상 위험', PRESSURE_ULCER: '욕창 위험' };
const BRADEN_SOURCE_LABEL: Record<string, string> = { NURSING_ASSESSMENT: '초기평가', CHART_TOOL: '임상 도구', REASSESSMENT: '재평가' };
const BRADEN_CHECK_LABEL: Record<BradenCheck, string> = {
  OUT_OF_RANGE: '총점이 6~23 밖', INCOMPLETE: '하위 항목 누락', INVALID_ITEM: '항목 점수 범위 밖', SUM_MISMATCH: '항목 합과 총점이 다름',
};
const BRADEN_TONE: Record<BradenRiskLevel, string> = { HIGH: 'bg-red-50 text-red-800', MODERATE: 'bg-orange-50 text-orange-800', LOW: 'bg-emerald-50 text-emerald-800' };

export function RiskHistoryPanel({ admissionId, now = Date.now() }: { admissionId: string; now?: number }) {
  const q = useQuery({
    queryKey: ['risk-history', admissionId],
    queryFn: async () => {
      const r = await apiClient.get<{ data: RiskHistory }>(`/api/v1/admissions/${admissionId}/risk-history`);
      const d = (r as { data?: unknown })?.data as RiskHistory | { data: RiskHistory };
      return ('news2' in (d as object) ? d : (d as { data: RiskHistory }).data) as RiskHistory;
    },
  });
  if (q.isLoading) return <div className="h-32 animate-pulse rounded-2xl bg-gray-50" aria-busy="true" />;
  if (q.isError || !q.data) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />;
  const h = q.data;
  const latest = h.news2.items[0] ?? null;
  const ref = h.news2.monitoringReference;
  const sinceLatestH = latest ? (now - Date.parse(latest.recordedAt)) / 3_600_000 : null;
  const pastRef = ref?.minIntervalHours != null && sinceLatestH != null && sinceLatestH > ref.minIntervalHours;
  return (
    <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4" data-risk-history>
      <h2 className="text-sm font-bold text-gray-800"><T k="위험 평가 추이" /> <span className="text-[11px] font-normal text-gray-500"><T k="이번 재원" /></span></h2>

      <div data-news2-trend>
        <p className="mb-1 text-xs font-semibold text-gray-600">NEWS2</p>
        {h.news2.items.length === 0
          ? <EmptyState icon="📈" title="이번 재원에 NEWS2 점수가 없습니다(7요소를 다 잰 측정만 점수가 납니다)" compact />
          : (
            <>
              <div className="flex flex-wrap items-end gap-1" aria-label="NEWS2">
                {[...h.news2.items].slice(0, 24).reverse().map((e) => (
                  <span key={e.id} title={`${new Date(e.recordedAt).toLocaleString()} · ${e.totalScore}`}
                    className={`inline-flex min-w-[28px] flex-col items-center rounded px-1 py-0.5 text-[11px] font-bold ${RISK_TONE[e.riskLevel] ?? 'bg-gray-50'}`} data-news2-point={e.totalScore}>
                    {e.totalScore}
                  </span>
                ))}
              </div>
              {latest && (
                <p className="mt-1 text-xs text-gray-700" data-news2-latest={latest.riskLevel}>
                  <T k="최근" /> <KDate value={latest.recordedAt} mode="datetime" /> · <b>{latest.totalScore}</b> · <T k={NEWS2_RISK_LABEL[latest.riskLevel] ?? latest.riskLevel} />
                </p>
              )}
              {ref && (
                <p className={`mt-1 rounded-lg px-2 py-1 text-[11px] ${pastRef ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600'}`} data-news2-monitoring={ref.band} data-news2-past={pastRef ? 'yes' : 'no'}>
                  <T k="원내 재측정 주기 미설정 — 참고" />: <T k={ref.label} /> <span className="text-gray-400">({h.news2.monitoringSource})</span>
                  {pastRef && <> · <T k="참고 간격을 지났습니다" /></>}
                </p>
              )}
              {h.news2.truncated && <p className="text-[11px] text-amber-700"><Tf k="최근 {shown}건만 받았습니다(전체 {total}건)" params={{ shown: h.news2.items.length, total: h.news2.total }} /></p>}
            </>
          )}
      </div>

      <div>
        <div data-fall-history>
          <p className="mb-1 text-xs font-semibold text-gray-600"><T k="낙상 위험 평가" /> <span className="text-gray-400">{h.fall.total}</span></p>
          {h.fall.items.length === 0 ? <p className="text-[11px] text-gray-500"><T k="이번 재원에 낙상 평가 기록이 없습니다" /></p> : (
            <ul className="space-y-0.5 text-xs">
              {h.fall.items.slice(0, 8).map((f) => (
                <li key={f.id} className="flex justify-between gap-2"><KDate value={f.assessedAt} mode="datetime" /><span><b>{f.score}</b> · <T k={FALL_LABEL[f.riskLevel] ?? f.riskLevel} /></span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <BradenHistory braden={h.braden} />

      <div data-reassess-schedules>
        <p className="mb-1 text-xs font-semibold text-gray-600"><T k="재평가 예정" /></p>
        {h.schedules.length === 0
          ? <p className="text-[11px] text-gray-500" data-reassess-none><T k="재평가 일정이 없습니다 — 입원 시 자동 생성은 원내 설정(위원회)입니다" /></p>
          : (
            <ul className="space-y-0.5 text-xs">
              {h.schedules.map((s) => {
                const overdue = Date.parse(s.nextDueAt) < now;
                return (
                  <li key={`${s.assessmentType}-${s.toolName}`} className="flex flex-wrap justify-between gap-2" data-reassess={s.assessmentType} data-overdue={overdue ? 'yes' : 'no'}>
                    <span><T k={TYPE_LABEL[s.assessmentType] ?? s.assessmentType} /> ({s.toolName}) · <Tf k="{h}시간마다" params={{ h: s.intervalHours }} /></span>
                    <span className={overdue ? 'font-semibold text-red-700' : ''}><KDate value={s.nextDueAt} mode="datetime" />{overdue && <> · <T k="지남" /></>}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </section>
  );
}

/**
 * Braden 이력(2026-10-10) — 시각·총점·하위 6항목·등급·평가자·출처.
 *  · 등급은 서버가 범위 안 총점에만 붙인다(shared 정본) — 화면이 경계를 따로 두지 않는다
 *  · 🔴 범위 밖·하위 항목 누락·합 불일치는 "확인 필요"(기록을 고치지 않는다) · 초기평가는 총점만 받는 경로라 하위 칸이 '—'
 */
function BradenHistory({ braden }: { braden: RiskHistory['braden'] }) {
  const points = braden.items.filter((b) => b.total != null).slice(0, 24).reverse();
  return (
    <div data-braden-history>
      <p className="mb-1 text-xs font-semibold text-gray-600">
        Braden <span className="text-gray-400">{braden.total}</span>
        {braden.needsReview > 0 && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" data-braden-needs-review={braden.needsReview}><Tf k="확인 필요 {n}건" params={{ n: braden.needsReview }} /></span>}
      </p>
      {braden.items.length === 0 ? <p className="text-[11px] text-gray-500" data-braden-empty><T k="이번 재원에 Braden 기록이 없습니다" /></p> : (
        <>
          {points.length > 1 && (
            <div className="mb-2 flex flex-wrap items-end gap-1" aria-label="Braden" data-braden-trend>
              {points.map((b) => (
                <span key={b.id} title={`${new Date(b.assessedAt).toLocaleString()} · ${b.total}`}
                  className={`inline-flex min-w-[28px] justify-center rounded px-1 py-0.5 text-[11px] font-bold ${b.riskLevel ? BRADEN_TONE[b.riskLevel] : 'bg-gray-100 text-gray-500'}`} data-braden-point={b.total ?? ''}>
                  {b.total}
                </span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[11px]">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2 font-medium"><T k="시각" /></th>
                  <th className="py-1 pr-2 font-medium"><T k="총점" /></th>
                  {BRADEN_ITEMS.map((it) => <th key={it.key} className="py-1 pr-1 text-center font-medium"><T k={it.label} /></th>)}
                  <th className="py-1 pr-2 font-medium"><T k="등급" /></th>
                  <th className="py-1 pr-2 font-medium"><T k="평가자" /></th>
                  <th className="py-1 font-medium"><T k="출처" /></th>
                </tr>
              </thead>
              <tbody>
                {braden.items.slice(0, 20).map((b) => (
                  <tr key={b.id} className={`border-t border-gray-50 ${b.checks.length ? 'bg-amber-50/60' : ''}`} data-braden-row={b.source} data-braden-checks={b.checks.join(',')}>
                    <td className="py-1 pr-2 whitespace-nowrap"><KDate value={b.assessedAt} mode="datetime" /></td>
                    <td className="py-1 pr-2 font-bold">{b.total ?? '—'}</td>
                    {BRADEN_ITEMS.map((it) => <td key={it.key} className="py-1 pr-1 text-center text-gray-700">{b.subscores?.[it.key] ?? '—'}</td>)}
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {b.riskLevel ? <span className={`rounded px-1 ${BRADEN_TONE[b.riskLevel]}`}><T k={BRADEN_RISK_LABEL[b.riskLevel]} /></span> : '—'}
                      {b.checks.length > 0 && (
                        <span className="ml-1 font-semibold text-amber-800">
                          <T k="확인 필요" />: {b.checks.map((c, i) => <span key={c}>{i > 0 && ' · '}<T k={BRADEN_CHECK_LABEL[c]} /></span>)}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">{b.assessor.name ?? <T k="미상" />}</td>
                    <td className="py-1 text-gray-500"><T k={BRADEN_SOURCE_LABEL[b.source] ?? b.source} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(braden.truncated || braden.items.length > 20) && <p className="text-[11px] text-amber-700"><Tf k="최근 {shown}건만 보입니다(전체 {total}건)" params={{ shown: Math.min(20, braden.items.length), total: braden.total }} /></p>}
        </>
      )}
      <p className="mt-1 text-[10px] text-gray-400"><T k="초기평가는 총점만 받아 하위 항목이 없습니다 · 2026-10-10 이전 재평가는 마지막 점수만 남아 이력에 없습니다" /></p>
    </div>
  );
}
