'use client';

import { PortalLabTerm } from '@/components/ui/lab-term';
import { portalDateText } from '../_shared/portal-date';
import { useState, useEffect } from 'react';
import { formatNum, isAbnormalFlag, AI_ORIGIN_TEXT, CHRONIC_OBSERVATION_LABEL, diagnosticTestLabel } from '@hospital-run/shared';
import { kstDateOf } from '@/lib/kst-today';
import { JUDGMENT_LABEL, JudgmentText, conclusionJudgment, findingJudgment, labFlagJudgment } from '../_shared/judgment';
import { VACCINATION_RECORDING_SUPPORTED, VACCINATION_UNSUPPORTED_NOTE } from '@hospital-run/shared';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PatientInfo, PortalData, HealthSegment, PortalItem, LabItem, LabResult, DiagnosticTest, Medication } from '../_types';
import { fmt, currency } from '../_helpers';
import { Icon, EmptyState, SkeletonCard, SegmentControl } from '../_shared';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DrugExplainSheet } from '../_shared/DrugExplainSheet';
import { ICONS } from '../_icons';
import { PT, usePortalTAttr } from '../_shared/PT';

/* ═══════════════════════════════════════════════════════════════
   HealthTab — 건강 허브
   건강 서머리 + 5개 세그먼트 (검사결과, 영상검사, 투약/알레르기, 건강검진, 추이)
   ═══════════════════════════════════════════════════════════════ */

interface HealthTabProps {
  patient: PatientInfo;
  data: PortalData;
  initialSegment?: HealthSegment;
}

const HEALTH_SEGMENTS: { key: HealthSegment; label: string }[] = [
  { key: 'labs', label: '검사결과' },
  { key: 'imaging', label: '영상검사' },
  { key: 'medications', label: '투약/알레르기' },
  { key: 'checkup', label: '건강검진' },
  { key: 'trends', label: '추이' },
];

export default function HealthTab({ patient, data, initialSegment }: HealthTabProps) {
  const [segment, setSegment] = useState<HealthSegment>(initialSegment ?? 'labs');
  useEffect(() => { if (initialSegment) setSegment(initialSegment); }, [initialSegment]);
  const { labResults, diagnosticTests, allergies, medications } = data;
  const allergyStatus = data.allergyStatus ?? (allergies.length > 0 ? 'HAS_ALLERGIES' : 'NOT_ASSESSED');

  return (
    <div className="space-y-4">
      {/* ── 상단: 내 기록 요약 (Glass) — 지어낸 '건강 점수' 게이지 폐지 ── */}
      <MyRecordSummaryCard />

      {/* ── 바이탈 서머리 가로 스크롤 ── */}
      <HealthDashboardSection />

      {/* ── 내 건강검진권 ── */}
      <MyVoucherSection />

      {/* ── 세그먼트 선택 ── */}
      <SegmentControl segments={HEALTH_SEGMENTS} active={segment} onChange={setSegment} />

      {/* ── 세그먼트 1: 검사결과 ── */}
      {/* 🔴 (2026-10-19 포털 세련화 A3) 종전엔 패널 7개 + 이름 없는 카드 10장을 세로로 늘어놓았다(데스크톱 4,000px).
          최근 검사의 기준 밖 항목 요약 → 날짜별 접힘(최신 하나만 펼침) · 판정 단어는 `_shared/judgment` 정본 하나. */}
      {segment === 'labs' && (
        <div className="space-y-3">
          <LabTrendsCard />
          <LatestAbnormalSummary labResults={labResults} />
          <h3 className="text-sm font-semibold text-gray-900 mb-1"><PT k="검사 결과" /></h3>
          {labResults.length === 0 && diagnosticTests.length === 0 && (
            <EmptyState icon="🔬" title="검사 결과가 없습니다." description="검사 결과가 등록되면 이곳에서 확인하실 수 있습니다." />
          )}
          {resultsByDate(labResults, diagnosticTests).map((g, gi) => (
            <details key={g.date} open={gi === 0} className="bg-white rounded-xl border" data-portal-result-day={g.date}>
              <summary className="cursor-pointer px-4 py-3 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-900">{g.date === '' ? <PT k="날짜 미상" /> : fmt(g.date)}</span>
                <span className="text-xs text-gray-500">
                  <PT k="검사" /> {g.labs.length + g.diags.length}
                  {g.abnormal > 0 && <> · <span className="text-red-600 font-semibold"><PT k="기준 밖" /> {g.abnormal}</span></>}
                </span>
              </summary>
              <div className="px-4 pb-4 space-y-4">
                {g.labs.map(lr => (
                  <div key={lr.id} data-portal-lab-release={lr.release ?? 'UNKNOWN'}>
                    <p className="text-sm font-medium text-gray-900 mb-1">{lr.orderName}</p>
                    {/* 🔴 (2026-10-20 B8 · 결정 portal.labResultRelease) 수치는 바로, 판정은 의료진 확인 뒤 */}
                    {lr.release === 'AWAITING_REVIEW' && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1 mb-1" data-portal-lab-awaiting>
                        <PT k="의료진 확인 전입니다 — 수치만 먼저 보여 드리고, 판정(높음·낮음)은 의료진이 확인한 뒤에 보입니다." />
                      </p>
                    )}
                    {lr.release === 'REVIEWED' && lr.reviewedAt && (
                      <p className="text-[11px] text-gray-500 mb-1"><PT k="의료진 확인" /> {fmt(lr.reviewedAt)}</p>
                    )}
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-500 border-b"><th className="text-left pb-1"><PT k="항목" /></th><th className="text-right pb-1"><PT k="결과" /></th><th className="text-right pb-1 pl-2"><PT k="단위" /></th><th className="text-right pb-1 pl-2"><PT k="판정" /></th></tr></thead>
                      <tbody>
                        {lr.items?.map((item, i) => {
                          const j = labFlagJudgment(item.flag);
                          return (
                            <tr key={i} className="border-b border-gray-50 last:border-0">
                              <td className="py-1 text-gray-700">{item.name}</td>
                              <td className="py-1 text-right text-gray-900">{item.value}</td>
                              <td className="py-1 text-right text-gray-500 pl-2">{item.unit}</td>
                              <td className="py-1 text-right pl-2">
                                {item.judgmentPending
                                  ? <span className="text-[11px] text-gray-400" data-portal-judgment-pending><PT k="확인 전" /></span>
                                  : j && j !== 'NORMAL' && <JudgmentText j={j} />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {/* AI 해석도 판정이다 — 의료진 확인 전에는 부르지 않는다 */}
                    {lr.release !== 'AWAITING_REVIEW' && <PortalAiLabExplain items={lr.items} />}
                  </div>
                ))}
                {g.diags.map(dt => (
                  <div key={dt.id} className="rounded-lg bg-gray-50 px-3 py-2" data-portal-diagnostic>
                    <div className="flex justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {dt.name ?? (dt.type ? diagnosticTestLabel(dt.type) : null) ?? <PT k="검사명 미기록" />}
                      </p>
                      {dt.release === 'AWAITING_REVIEW'
                        ? <span className="text-[11px] text-gray-400" data-portal-judgment-pending><PT k="확인 전" /></span>
                        : <JudgmentText j={conclusionJudgment(dt.conclusion)} />}
                    </div>
                    {dt.release === 'AWAITING_REVIEW'
                      ? <p className="text-[11px] text-amber-700 mt-1" data-portal-diag-awaiting><PT k="판독 검토 전입니다 — 결론과 소견은 의료진이 확인한 뒤에 보입니다." /></p>
                      : dt.findings && <p className="text-xs text-gray-600 mt-1">{dt.findings}</p>}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* ── 세그먼트 2: 영상검사 ── */}
      {segment === 'imaging' && <ImagingSection patientId={patient.id} />}

      {/* ── 세그먼트 3: 투약/알레르기 ── */}
      {segment === 'medications' && (
        <div className="space-y-3">
          <MedicationScheduleSection />

          {/* 알레르기 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1">&#9888; 알레르기</h3>
            {allergies.length === 0 ? (
              allergyStatus === 'NO_KNOWN_ALLERGIES' ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">
                  무알레르기 확인됨{data.allergyAssessedAt ? ` (${data.allergyAssessedAt.slice(0, 10)})` : ''}
                </div>
              ) : allergyStatus === 'UNABLE_TO_ASSESS' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700"><PT k="알레르기 문진 불가로 기록됨" /></div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
                  <PT k="알레르기 문진 정보가 없습니다. 다음 진료 시 확인이 필요합니다." />
                </div>
              )
            ) : (
              <div className="space-y-1.5">
                {allergies.map(a => (
                  <div key={a.id} className="bg-white rounded-xl border p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{a.allergen}</p>
                      {a.reaction && <p className="text-xs text-gray-500">{a.reaction}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.severity === 'SEVERE' ? 'bg-red-100 text-red-700' : a.severity === 'MODERATE' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {a.severity === 'SEVERE' ? '중증' : a.severity === 'MODERATE' ? '중등도' : '경미'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <PortalAiDrugInteractions medications={medications} />
          <MedicationsCard />
          <VaccinationSection />
        </div>
      )}

      {/* ── 세그먼트 4: 건강검진 ── */}
      {segment === 'checkup' && <CheckupPortalTab patientId={patient.id} />}

      {/* ── 세그먼트 5: 추이 ── */}
      {segment === 'trends' && (
        <div className="space-y-3">
          <ChronicTrendsCard />
          <LabTrendsCard expanded />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   건강 대시보드 서머리 (가로 스크롤 카드)
   ═══════════════════════════════════════════════════════════════ */

function HealthDashboardSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-health-dashboard'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/portal/health-dashboard'),
  });
  const outerRaw = data?.data as PortalItem | null;
  const raw = (outerRaw?.data as PortalItem | undefined) ?? outerRaw;
  // 🔴 조회 실패를 "기록 없음"(null 반환)으로 접지 않는다 — 카드가 통째로 사라진다
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;
  if (isLoading) return <SkeletonCard lines={2} />;
  if (!raw) return null;

  const vitals = raw.vitals as PortalItem | undefined;
  const activeRx = (raw.activeRx ?? []) as PortalItem[];
  const allergyList = (raw.allergies ?? []) as PortalItem[];

  const cards: { label: string; value: string; sub?: string; color: string }[] = [];

  // 🔴 W9(2026-08-14): 서버(/portal/health-dashboard)의 vitals 는 PreVisitVitals 원본 그대로라
  //    필드명이 `systolicBp`·`diastolicBp`·`heartRate` 인데 화면은 `bp`·`hr` 을 찾고 있었다 →
  //    **혈압·맥박 카드가 한 번도 뜬 적이 없다**(운영 실측 P2026-0006: 126/88·91bpm 이 응답에 실려 있었음).
  //    조용히 사라지는 값은 0 을 보여주는 것만큼 위험하다 — 환자는 "측정한 적 없다"고 읽는다. (P11)
  if (vitals?.systolicBp != null && vitals?.diastolicBp != null) {
    cards.push({ label: 'BP', value: `${vitals.systolicBp}/${vitals.diastolicBp}`, sub: 'mmHg', color: 'from-rose-50 to-pink-50 border-rose-200' });
  }
  if (vitals?.heartRate != null) cards.push({ label: 'HR', value: `${vitals.heartRate}`, sub: 'bpm', color: 'from-red-50 to-orange-50 border-red-200' });
  if (vitals?.weight && vitals?.height) {
    const h = Number(vitals.height) / 100;
    // 자릿수·반올림은 수치 정본(bmi) — 직접 toFixed 하지 않는다
    const bmi = h > 0 ? formatNum(Number(vitals.weight) / (h * h), 'bmi', { unit: false }) : '-';
    cards.push({ label: 'BMI', value: bmi, sub: 'kg/m²', color: 'from-blue-50 to-cyan-50 border-blue-200' });
  } else if (vitals?.weight) {
    cards.push({ label: '체중', value: `${vitals.weight}`, sub: 'kg', color: 'from-blue-50 to-cyan-50 border-blue-200' });
  }
  cards.push({ label: '활성 처방', value: `${activeRx.length}`, sub: '건', color: 'from-emerald-50 to-teal-50 border-emerald-200' });
  cards.push({ label: '알레르기', value: `${allergyList.length}`, sub: '건', color: allergyList.length > 0 ? 'from-amber-50 to-yellow-50 border-amber-200' : 'from-green-50 to-emerald-50 border-green-200' });

  // 🔴 (2026-10-19 포털 세련화 R5) 활력 숫자에 측정 시각·출처가 없었다 — 몇 달 전 외래 접수 때 잰 190/115 가 "지금 내 혈압"처럼 보였다.
  //    출처 = 외래 진료 전 측정(PreVisitVitals 최신 1건). 판정 색은 칠하지 않는다(환자 화면은 진단하지 않는다).
  const measuredAt = typeof vitals?.measuredAt === 'string' ? vitals.measuredAt : null;
  const hasVitals = vitals != null && (vitals.systolicBp != null || vitals.heartRate != null || vitals.weight != null);
  return (
    <div>
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
        {cards.map(c => (
          <div key={c.label} className={`bg-gradient-to-br ${c.color} border rounded-xl px-4 py-3 min-w-[100px]`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.label}</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">
              {c.value}
              {c.sub && <span className="text-[10px] font-normal text-gray-500 ml-0.5">{c.sub}</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
    {hasVitals && (
      <p className="text-[11px] text-gray-500 mt-1.5" data-portal-vitals-source>
        <PT k="혈압·맥박·체중: 외래 진료 전 측정" /> · {measuredAt ? fmt(measuredAt) : <PT k="측정 날짜 미상" />}
      </p>
    )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   만성질환 추이 + 자가측정(SMBG) — 차트와 동일 SoT(ChronicObservation)
   ═══════════════════════════════════════════════════════════════ */

const SMBG_FIELDS: { code: string; label: string; unit: string; ph: string; step?: string }[] = [
  { code: 'SBP', label: '수축기', unit: 'mmHg', ph: '120' },
  { code: 'DBP', label: '이완기', unit: 'mmHg', ph: '80' },
  { code: 'FBS', label: '공복혈당', unit: 'mg/dL', ph: '95' },
  { code: 'WEIGHT', label: '체중', unit: 'kg', ph: '65', step: '0.1' },
];
// 만성질환 측정 라벨 정본은 shared(사본 양식과 같이 쓴다 — B5)
const CHRONIC_LABEL = CHRONIC_OBSERVATION_LABEL;

function ChronicTrendsCard() {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const { data, isError: trendIsError, error: trendError, refetch: refetchTrend } = useQuery({
    queryKey: ['portal-chronic-trend'],
    queryFn: () => apiClient.get<{ data: { series: Record<string, { value: number; measuredAt: string }[]>; summary: Record<string, { latest: number | null; unit: string; delta: number | null; count: number }> } }>('/api/v1/portal/chronic-trend'),
  });
  const summary = data?.data?.summary ?? {};
  const codes = Object.keys(summary).filter((c) => (summary[c]?.count ?? 0) > 0);
  const mut = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(vals).filter(([, v]) => v.trim() !== '' && !isNaN(Number(v)));
      for (const [code, v] of entries) await apiClient.post('/api/v1/portal/chronic-observations', { code, value: Number(v) });
    },
    onSuccess: () => { setVals({}); qc.invalidateQueries({ queryKey: ['portal-chronic-trend'] }); },
  });
  const filled = Object.values(vals).filter((v) => v.trim() !== '' && !isNaN(Number(v))).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="text-sm font-bold text-gray-800"><PT k="만성질환 추이" /></div>
      {codes.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {codes.map((c) => {
            const s = summary[c]; const down = (s.delta ?? 0) < 0, up = (s.delta ?? 0) > 0;
            return (
              <div key={c} className="border border-gray-100 rounded-xl px-3 py-2">
                <div className="text-[11px] text-gray-500">{CHRONIC_LABEL[c] ?? c}</div>
                <div className="text-base font-bold text-gray-900">{s.latest ?? '-'}<span className="text-[10px] text-gray-400 ml-0.5">{s.unit}</span>
                  {s.delta != null && s.delta !== 0 && <span className={`text-[10px] ml-1 ${down ? 'text-emerald-600' : up ? 'text-rose-500' : 'text-gray-400'}`}>{up ? '▲' : '▼'}{Math.abs(s.delta)}</span>}
                </div>
                <div className="text-[10px] text-gray-300">{s.count}<Unit>회</Unit></div>
              </div>
            );
          })}
        </div>
      ) : trendIsError
        // 🔴 (포털 A6) 조회 실패를 "측정 기록이 쌓이면…"(기록 없음)으로 말하지 않는다
        ? <QueryErrorFallback error={trendError} onRetry={() => refetchTrend()} size="compact" />
        : <p className="text-xs text-gray-400">측정 기록이 쌓이면 추이가 표시됩니다.</p>}

      {/* 자가측정(SMBG) 입력 */}
      <div className="border-t border-gray-50 pt-3">
        <div className="text-xs font-medium text-gray-600 mb-1"><PT k="자가측정 입력" /></div>
        {/* 🔴 (2026-10-20 B4 · 결정 portal.patientReportedVitals = REFERENCE_ONLY) 입력값이 어디에 쓰이는지 미리 말한다 */}
        <p className="text-[11px] text-gray-500 mb-2" data-portal-smbg-reference>
          <PT k="집에서 잰 값은 참고용으로 의료진 화면에 함께 보입니다. 이 값으로 경고가 가거나 진단이 바뀌지는 않으니, 증상이 있으면 병원에 문의하세요." />
        </p>
        <div className="grid grid-cols-4 gap-2">
          {SMBG_FIELDS.map((f) => (
            <label key={f.code} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">{f.label}</span>
              <input type="number" step={f.step ?? '1'} placeholder={f.ph} value={vals[f.code] ?? ''}
                onChange={(e) => setVals((s) => ({ ...s, [f.code]: e.target.value }))}
                className="border border-gray-200 rounded-lg px-1.5 py-1 text-sm w-full" />
            </label>
          ))}
        </div>
        <button disabled={!filled || mut.isPending} onClick={() => mut.mutate()}
          className="mt-2 w-full py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white disabled:opacity-40">
          {mut.isPending ? '저장 중…' : `기록${filled ? ` (${filled})` : ''}`}
        </button>
        {mut.isError && <p className="text-[11px] text-rose-500 mt-1">저장 실패 — 값을 확인해주세요.</p>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   검사 추이 카드
   ═══════════════════════════════════════════════════════════════ */

function LabTrendsCard({ expanded }: { expanded?: boolean }) {
  const { data, isError, error, refetch } = useQuery({ queryKey: ['portal-lab-trends'], queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/lab-trends') });
  const raw = data?.data;
  const trends = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  // 🔴 (포털 A6) 조회 실패를 "추이 데이터가 없습니다"로 말하지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;
  if (!trends.length) {
    if (expanded) return <EmptyState icon="📊" title="추이 데이터가 없습니다." description="검사 결과가 누적되면 추이를 확인할 수 있습니다." />;
    return null;
  }
  const displayCount = expanded ? trends.length : 6;
  return (
    <div className="bg-white rounded-xl border p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3"><PT k="검사 추이" /></h3>
      <div className="space-y-2">
        {trends.slice(0, displayCount).map((t: PortalItem) => {
          // 🔴 W9(2026-08-14): 이 카드는 배열의 마지막 원소를 '최근값'으로 삼아 ↑/↓ 를 그리는데,
          //    서버 쿼리에 orderBy 가 없어 그 순서가 시간순이라는 보장이 없었다(추세가 거꾸로 보일 수 있다).
          //    서버를 완료시각 오름차순으로 고정하고 `measuredAt` 을 함께 받아, 화면에도 시간을 적는다 —
          //    시간축 없는 '추이'는 환자가 좋아지는지 나빠지는지를 반대로 읽게 만든다.
          const tData = (t.data as PortalItem[] | undefined) ?? [];
          const latestAt = tData.length ? tData[tData.length - 1]?.measuredAt : null;
          // 🔴 (2026-10-20 B8) 마지막 값이 담당의 확인 중인 위급값이면(서버가 수치를 가림) 그 앞 값을 '최근'이라 말하지 않는다
          const latestMasked = tData.length > 0 && tData[tData.length - 1]?.pendingReview === true;
          const values = tData.map((d: PortalItem) => parseFloat(String(d.value ?? ''))).filter((v: number) => !isNaN(v));
          const latest = latestMasked ? undefined : values[values.length - 1];
          const prev = !latestMasked && values.length > 1 ? values[values.length - 2] : null;
          const trend = prev !== null && latest !== undefined ? (latest > prev ? '↑' : latest < prev ? '↓' : '→') : '';
          const trendColor = trend === '↑' ? 'text-red-500' : trend === '↓' ? 'text-blue-500' : 'text-gray-400';
          const unit = String(tData[0]?.unit ?? '');
          return (
            <div key={String(t.testName)} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">
                {/* 일반인 대상 — 한글 우선 병기(사전 미등재는 원문 그대로 · 지어내지 않음) */}
                <PortalLabTerm name={String(t.testName ?? '')} />
                {latestAt != null && <span className="text-[10px] text-gray-400 ml-1">{fmt(String(latestAt))} 기준</span>}
              </span>
              <div className="flex items-center gap-2">
                {/* 미니 바 차트 */}
                <div className="flex items-end gap-px h-4">
                  {values.slice(-5).map((v: number, i: number) => {
                    const max = Math.max(...values.slice(-5));
                    const h = max > 0 ? Math.max(2, (v / max) * 16) : 4;
                    return <div key={i} className="w-1.5 bg-blue-300 rounded-sm" style={{ height: `${h}px` }} />;
                  })}
                </div>
                {latestMasked
                  ? <span className="text-xs text-amber-700 text-right" data-portal-trend-masked><PT k="담당의 확인 중" /></span>
                  : <span className="font-medium text-gray-900 w-16 text-right">{latest ?? '-'} {unit}</span>}
                <span className={`text-xs font-bold ${trendColor}`}>{trend}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   영상검사 세그먼트
   ═══════════════════════════════════════════════════════════════ */

/**
 * PACS 썸네일 — HIS 프록시 경유(2026-08-18 이관).
 *
 * 🔴 종전엔 `<img src="/pacs-api/...">` 로 PACS 를 **브라우저가 직접** 불렀다.
 *    ① HIS 의 JWT·RBAC·감사를 통째로 우회하고(요청에 자격증명이 아예 없었다),
 *    ② 401·타임아웃을 onError 로 삼켜 회색 아이콘으로 바꿔 놓아 **"영상이 없다"처럼 보였다**.
 *    프록시는 Authorization 헤더가 필요해 `<img src>` 로는 못 부른다 → fetch + blob URL.
 *    실패는 "없음"이 아니라 "불러오지 못함"으로 말한다(404=진짜 썸네일 없음과 구분).
 */
function StudyThumbnail({ studyUid }: { studyUid: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading');

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = apiClient.getToken() ?? localStorage.getItem('accessToken');
        const res = await fetch(`/api/v1/portal/imaging/study/${encodeURIComponent(studyUid)}/thumbnail`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (cancelled) return;
        if (res.status === 404) { setState('none'); return; }   // 썸네일이 없다 = 사실
        if (!res.ok) { setState('error'); return; }              // 불러오지 못했다 = 다른 사실
        objectUrl = URL.createObjectURL(await res.blob());
        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
        setSrc(objectUrl); setState('ok');
      } catch { if (!cancelled) setState('error'); }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [studyUid]);

  if (state === 'ok' && src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="w-full h-full object-cover" />;
  }
  if (state === 'error') {
    return <span className="text-[9px] leading-tight text-amber-600 text-center px-1" title="썸네일을 불러오지 못했습니다. 영상이 없는 것이 아닙니다.">⚠️<br />불러오지<br />못함</span>;
  }
  return (
    <svg className={`w-6 h-6 text-gray-300 ${state === 'loading' ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
    </svg>
  );
}

function ImagingSection({ patientId }: { patientId: string }) {
  const { data: studiesData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-imaging-studies', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/portal/imaging/studies?limit=50'),
  });
  const { data: reportsData, isError: reportsIsError, error: reportsError, refetch: refetchReports } = useQuery({
    queryKey: ['portal-imaging-reports', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/portal/imaging/reports'),
  });

  const outerStudies = studiesData?.data as PortalItem | null;
  const raw = (outerStudies?.data as PortalItem | undefined) ?? outerStudies;
  const studies = ((raw?.studies ?? []) as PortalItem[]);
  const outerReports = reportsData?.data as PortalItem | null;
  const rawReports = (outerReports?.data as PortalItem | undefined) ?? outerReports;
  const reports = ((rawReports?.reports ?? []) as PortalItem[]);
  const reportMap = new Map(reports.map((r: PortalItem) => [r.study_instance_uid, r]));

  const modalityColors: Record<string, string> = {
    CT: 'bg-blue-100 text-blue-700', MR: 'bg-purple-100 text-purple-700', CR: 'bg-gray-100 text-gray-700',
    DX: 'bg-gray-100 text-gray-700', US: 'bg-teal-100 text-teal-700', MG: 'bg-pink-100 text-pink-700',
    NM: 'bg-amber-100 text-amber-700', PT: 'bg-orange-100 text-orange-700', XA: 'bg-indigo-100 text-indigo-700',
  };
  const readStatusLabel = (s: string) => {
    if (s === 'completed' || s === 'final') return { label: '판독완료', cls: 'bg-emerald-100 text-emerald-700' };
    if (s === 'draft') return { label: '작성중', cls: 'bg-amber-100 text-amber-700' };
    return { label: '미판독', cls: 'bg-red-100 text-red-700' };
  };
  const fmtDate = (d: string) => {
    if (!d) return '-';
    // 🔴 `YYYYMMDD` 를 손으로 `2026. 9. 12.` 로 조립하던 분기도 같은 결함(어떤 언어에서도 한국식)이라 정본으로 —
    //    로컬 자정으로 만들어 날짜가 밀리지 않게 한다(종전 문자열 조립과 같은 날)
    if (d.length === 8) return portalDateText(new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))), 'date');
    return portalDateText(d, 'date');
  };

  if (isLoading) return <SkeletonCard lines={4} />;

  // 🔴 조회 실패를 빈 목록으로 삼키면 "영상검사 내역이 없습니다"가 된다 — 서버(W9)는 이미
  //    503 PACS_UNAVAILABLE 로 정직하게 말하는데 화면이 그 말을 지우고 있었다(P17 · 2026-08-18).
  if (isError) {
    return (
      <div className="bg-white rounded-2xl border border-amber-200 p-5 text-center">
        <p className="text-2xl mb-1">⚠️</p>
        <p className="text-sm text-amber-700">{(error as { message?: string })?.message ?? '영상검사를 불러오지 못했습니다.'}</p>
        <p className="text-xs text-gray-400 mt-1">영상이 없는 것이 아니라 불러오지 못했습니다.</p>
        <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 text-xs rounded-lg"><PT k="다시 시도" /></button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-900">영상검사 ({studies.length}<Unit>건</Unit>)</h3>
        <Link href="/portal/imaging" className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <PT k="외부 영상 업로드" />
        </Link>
      </div>
      {/* 🔴 (포털 A6) 판독 소견만 따로 실패하면 소견이 조용히 사라져 "소견 없음"처럼 보인다 — 실패했다고 말한다 */}
      {reportsIsError && studies.length > 0 && (
        <div data-portal-imaging-reports-error>
          <p className="text-[10px] font-bold text-gray-400 mb-1"><PT k="판독 소견" /></p>
          <QueryErrorFallback error={reportsError} onRetry={() => refetchReports()} size="compact" />
        </div>
      )}

      {studies.length === 0 ? (
        <div className="space-y-3">
          <EmptyState icon="🩻" title="영상검사 내역이 없습니다." description="영상검사 결과가 등록되면 이곳에서 확인하실 수 있습니다." />
          <div className="text-center">
            <Link href="/portal/imaging" className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
              <PT k="외부 영상 업로드" />
            </Link>
          </div>
        </div>
      ) : studies.map((s: PortalItem) => {
        const sUid = String(s.study_instance_uid ?? '');
        const report = reportMap.get(s.study_instance_uid);
        const rs = readStatusLabel(String(s.read_status ?? 'unread'));
        const mc = modalityColors[String(s.modality ?? '')] ?? 'bg-gray-100 text-gray-600';
        const reportItem = report as PortalItem | undefined;
        return (
          <div key={sUid} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${mc}`}>{String(s.modality ?? '')}</span>
                <p className="text-xs text-gray-500">{fmtDate(String(s.study_date ?? ''))}</p>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${rs.cls}`}>{rs.label}</span>
            </div>
            <div className="p-4">
              <div className="flex gap-3">
                {/* 썸네일 */}
                <div className="w-16 h-16 shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                  <StudyThumbnail studyUid={sUid} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{String(s.description ?? s.study_description ?? '검사')}</p>
                  {s.instances != null && <p className="text-[10px] text-gray-400 mt-0.5">{String(s.instances)}장</p>}
                </div>
              </div>

              {/* 판독 소견 */}
              {(reportItem?.impression != null || s.report_summary != null) && (
                <div className="mt-2 bg-blue-50 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-blue-500 font-medium mb-0.5"><PT k="판독 소견" /></p>
                  <p className="text-xs text-gray-700">{String(reportItem?.impression ?? s.report_summary ?? '')}</p>
                </div>
              )}

              {/* 버튼 */}
              <div className="flex gap-2 mt-3">
                {s.viewer_url != null && (
                  <a href={String(s.viewer_url)} target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-center text-xs font-medium py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <PT k="영상 보기" />
                  </a>
                )}
                {(s.read_status === 'completed' || s.read_status === 'final') && (
                  <button onClick={async () => {
                    try {
                      const res = await apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/portal/imaging/report/${sUid}/pdf`);
                      const resOuter = res as unknown as PortalItem;
                      const resData = resOuter.data as PortalItem | undefined;
                      const html = (resData?.data as PortalItem | undefined)?.html ?? resData?.html;
                      if (html) { const w = window.open('', '_blank'); if (w) { w.document.write(String(html)); w.document.close(); } }
                      else alert('리포트를 찾을 수 없습니다.');
                      // 🔴 서버가 갈라 말하는 이유(본인 것이 아님 403 / 불러오지 못함 503)를 그대로 전한다 —
                      //    전부 "찾을 수 없습니다"로 뭉개면 환자는 판독지가 없다고 읽는다.
                    } catch (e) { alert((e as { message?: string })?.message ?? '리포트를 불러오지 못했습니다.'); }
                  }}
                    className="flex-1 text-center text-xs font-medium py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    <PT k="리포트 보기" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   복용 일정 섹션
   ═══════════════════════════════════════════════════════════════ */

function MedicationScheduleSection() {
  // F-2: BE flat 형태(처방 배열 + slots + checks) 소비 — 종전 구현은 {slots:[...]} 형태를 기대해 렌더되지 않던 데드 UI.
  //      체크는 medication-check POST로 서버 저장(MedicationCheckLog), 초기값은 checks에서 복원.
  const qc = useQueryClient();
  // 위임(보호자) 세션은 읽기 전용 — 대리 복약 체크는 기록 무결성 훼손(설계 §6.6, BE 가드와 이중 방어)
  const [isGuardian, setIsGuardian] = useState(false);
  useEffect(() => { setIsGuardian(!!localStorage.getItem('guardian-mode')); }, []);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-medication-schedule'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/portal/medication-schedule'),
  });
  interface RxSchedule {
    id: string;
    name: string;
    dosage?: string | null;
    slots?: string[];
    checks?: Record<string, boolean | null>;
  }
  const rxList = (Array.isArray(data?.data) ? data.data : []) as RxSchedule[];

  const check = useMutation({
    mutationFn: (p: { prescriptionId: string; slot: string; taken: boolean }) =>
      apiClient.post('/api/v1/portal/medication-check', p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-medication-schedule'] }),
  });

  const SLOT_ORDER = ['아침 식후', '점심 식후', '저녁 식후', '취침 전'];
  const slotIcons: Record<string, string> = { '아침 식후': '☀️', '점심 식후': '🌞', '저녁 식후': '🌙', '취침 전': '💤' };
  const groups = SLOT_ORDER
    .map(slot => ({ slot, meds: rxList.filter(rx => rx.slots?.includes(slot)) }))
    .filter(g => g.meds.length > 0);

  // 🔴 복약 일정 조회 실패를 "오늘 복용할 약 없음"으로 접지 않는다(카드가 사라진다)
  if (isError) return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5">
        <p className="text-white text-sm font-semibold"><PT k="오늘 복용 일정" /></p>
      </div>
      <div className="p-4"><QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /></div>
    </div>
  );
  if (isLoading) return <SkeletonCard lines={3} />;
  if (!groups.length) return null;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5">
        <p className="text-white text-sm font-semibold"><PT k="오늘 복용 일정" /></p>
      </div>
      <div className="p-4 space-y-3">
        {groups.map(({ slot, meds }) => (
          <div key={slot}>
            <p className="text-xs font-semibold text-gray-700 mb-1.5">
              {slotIcons[slot] ?? ''} {slot}
            </p>
            <div className="space-y-1 ml-1">
              {meds.map(rx => {
                const isChecked = rx.checks?.[slot] === true;
                return (
                  <label key={rx.id} className={`flex items-center gap-2 group ${isGuardian ? 'cursor-default' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={check.isPending || isGuardian}
                      onChange={() => check.mutate({ prescriptionId: rx.id, slot, taken: !isChecked })}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                    />
                    <span className={`text-sm ${isChecked ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {rx.name} {rx.dosage ?? ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[10px] text-gray-400 text-center pt-1">
          {isGuardian ? '* 보호자 열람 중에는 복약 체크를 할 수 없습니다 (본인 확인용 기록)' : '* 체크한 기록은 저장되어 언제든 다시 확인하실 수 있습니다'}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   현재 복용약 카드
   ═══════════════════════════════════════════════════════════════ */

function MedicationsCard() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['portal-medications'], queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/medications') });
  const raw = data?.data;
  const meds = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  // F-7: 약 단위 쉬운 설명 시트(위임 세션도 열람 허용 — 보호자가 복약 도우미, 설계 §6.6)
  const [explainTarget, setExplainTarget] = useState<{ id: string; name: string } | null>(null);
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1"><PT k="현재 복용약" /></h3>
      {isLoading ? <SkeletonCard lines={2} /> :
       // 🔴 (포털 A6) 조회 실패를 "최근 30일 내 처방된 약이 없습니다"로 말하지 않는다 — 복용약이 없다고 믿게 된다
       isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /> :
       !meds.length ? <div className="bg-gray-50 rounded-xl border p-3 text-xs text-gray-500">최근 30일 내 처방된 약이 없습니다.</div> :
       <div className="space-y-1.5">
         {meds.map((m, i) => (
           <div key={i} className="bg-white rounded-xl border p-3">
             <p className="text-sm font-medium text-gray-900">{String(m.name ?? m.code ?? '')}</p>
             <p className="text-xs text-gray-500">{[m.dosage, m.frequency, m.duration ? `${String(m.duration)}일` : '', m.route].filter(Boolean).map(String).join(' · ')}</p>
             {m.doctor != null && <p className="text-[10px] text-gray-400 mt-0.5">{String(m.doctor)} ({String(m.department ?? '')})</p>}
             {/* 쉽게 보기 — 진입 버튼은 브랜드 없는 라벨(§6.5-①), OFF/미해석은 시트 안 조용한 폴백 */}
             {m.id != null && m.medicationCodeId != null && (
               <button
                 onClick={() => setExplainTarget({ id: String(m.id), name: String(m.name ?? m.code ?? '약') })}
                 className="mt-2 w-full py-2 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors">
                 <PT k="쉽게 보기" />
               </button>
             )}
           </div>
         ))}
       </div>
      }
      {explainTarget && (
        <DrugExplainSheet
          open
          onClose={() => setExplainTarget(null)}
          prescriptionId={explainTarget.id}
          drugName={explainTarget.name}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   예방접종 이력
   ═══════════════════════════════════════════════════════════════ */

function VaccinationSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-vaccinations'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/vaccinations'),
  });
  const raw = data?.data;
  const vaccinations = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  const now = new Date();
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1">
        <Icon d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M14.25 3.104v5.714c0 .597.237 1.17.659 1.591L19 14.5" cls="w-4 h-4 text-emerald-600" />
        <PT k="예방접종 이력" />
      </h3>
      {isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /> :
       isLoading ? <SkeletonCard lines={2} /> :
       !vaccinations.length ? (
         /* 🔴 원내에 접종을 **쓰는 경로가 없다**(2026-09-02 실측 — 읽는 곳 3, 쓰는 곳 0).
            그런 빈 목록을 "기록이 없습니다"라고 말하면 환자는 "내 접종 이력이 없다"로 읽는다.
            자료 부재와 진짜 0 은 다른 사실이다. */
         <div className="bg-amber-50 rounded-xl border border-amber-200 p-3 text-xs text-amber-800">
           {VACCINATION_RECORDING_SUPPORTED ? '예방접종 기록이 없습니다.' : VACCINATION_UNSUPPORTED_NOTE}
         </div>
       ) :
       <div className="space-y-1.5">
         {vaccinations.map((v: PortalItem) => {
           const isUpcoming = v.nextDueAt != null && new Date(v.nextDueAt as string) > now;
           const isOverdue = v.nextDueAt != null && new Date(v.nextDueAt as string) <= now;
           return (
             <div key={String(v.id)} className={`bg-white rounded-xl border p-3 ${isOverdue ? 'border-amber-300 bg-amber-50' : ''}`}>
               <div className="flex items-center justify-between mb-0.5">
                 <p className="text-sm font-medium text-gray-900">{String(v.vaccineName ?? '')}</p>
                 <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{String(v.doseNumber ?? '')}차</span>
               </div>
               <p className="text-xs text-gray-500">접종일: {fmt(v.administeredAt as string)}</p>
               {v.nextDueAt != null && (
                 <p className={`text-xs font-medium mt-0.5 ${isOverdue ? 'text-amber-700' : isUpcoming ? 'text-blue-600' : 'text-gray-500'}`}>
                   {isOverdue ? '(지남) ' : ''}다음 접종: {fmt(v.nextDueAt as string)}
                 </p>
               )}
               {v.administeredBy != null && <p className="text-[10px] text-gray-500 mt-0.5">{String(v.administeredBy)}{v.location ? ` - ${String(v.location)}` : ''}</p>}
             </div>
           );
         })}
       </div>
      }
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AI 검사결과 해석
   ═══════════════════════════════════════════════════════════════ */

function PortalAiLabExplain({ items }: { items: LabItem[] }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!items?.length) return null;

  const explain = async () => {
    setLoading(true);
    try {
      // 🔴 W9(2026-08-14): 종전 `it.flag === 'H' ? '높음' : '낮음'` — 이진 삼항 단정(P10).
      //    HIS flag 집합은 N/H/L/**HH/LL**/A/AA 인데, 'H' 가 아닌 것을 전부 '낮음'으로 몰아
      //    **위급 고값(HH)을 AI 에게 "낮음"이라고 설명시켰다**. 정본 술어로 수렴 + 위급은 위급으로 전달.
      const text = items.map(it => `${it.name}: ${it.value} ${it.unit} ${isAbnormalFlag(it.flag) ? `(${JUDGMENT_LABEL[labFlagJudgment(it.flag) ?? 'ABNORMAL']})` : ''}`).join(', ');
      const question = `다음은 제 검사 결과입니다. 각 항목이 무엇을 의미하는지, 정상/비정상 여부를 쉬운 한국어로 설명해주세요.\n\n${text}`;
      const res = await apiClient.post<{ data: { answer?: string } }>('/api/v1/portal/ai/ask', { question });
      let expText = res?.data?.answer ?? '';
      if (expText.includes('Error:') || expText.includes('BadStatusLine') || expText.includes('Connection aborted')) expText = '';
      setExplanation(expText || '해석을 생성하지 못했습니다.');
    } catch { setExplanation(`${AI_ORIGIN_TEXT} 해석에 실패했습니다.`); }
    setLoading(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button onClick={explain} disabled={loading}
        className="w-full py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 disabled:opacity-50">
        {loading ? '해석 중...' : '이 검사 결과를 쉽게 설명해주세요'}
      </button>
      {explanation && (
        <div className="mt-2 bg-blue-50 rounded-lg p-3 text-xs text-blue-900 whitespace-pre-wrap">
          {explanation}
          <p className="text-[11px] text-blue-700 mt-2">AI(WeRU.B) 생성 참고 설명 — 정확한 해석은 담당 의사에게 문의하세요</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AI 약물 상호작용 경고
   ═══════════════════════════════════════════════════════════════ */

function PortalAiDrugInteractions({ medications }: { medications: Medication[] }) {
  const [result, setResult] = useState<{ interactions?: Array<{ drug_a: string; drug_b: string; description?: string; severity?: string }>; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const check = async () => {
    if (medications.length < 2) return;
    setLoading(true);
    try {
      const drugs = medications.map(m => m.name).filter(Boolean);
      // P2 배선 교정: 직원 전용 /api/v1/ai/drug-interactions는 포털 토큰으로 항상 401 → 포털 프록시 EP 사용
      const res = await apiClient.post<{ data: { interactions?: Array<{ drug_a: string; drug_b: string; description?: string; severity?: string }>; error?: boolean } }>('/api/v1/portal/ai/drug-interactions', { drugs });
      setResult(res?.data);
    } catch { setResult({ error: true }); }
    setLoading(false);
    setChecked(true);
  };

  if (medications.length < 2) return null;

  return (
    <div>
      {!checked ? (
        <button onClick={check} disabled={loading}
          className="w-full py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-xs font-medium hover:bg-amber-100 disabled:opacity-50">
          {loading ? '확인 중...' : `복용 중인 ${medications.length}종 약물 상호작용 확인`}
        </button>
      ) : !result || result.error || !Array.isArray(result.interactions) ? (
        /* 🔴 W9(2026-08-14): 종전엔 실패(`{error:true}`)면 **아무것도 렌더하지 않아** 버튼만 사라졌고,
           AI 서버(WeRU.B) 응답에 interactions 배열이 없어도 `?? 0` 으로 0건이 되어
           초록 배경의 **"특별한 상호작용이 발견되지 않았습니다"** 를 띄웠다 —
           확인에 실패한 것을 "안전하다"로 바꿔 말한 것(P17: 근거 없이 안심시킴).
           거짓 안심은 진짜 경보를 죽인다. 확인 못 했으면 확인 못 했다고 말하고 재시도를 준다. */
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-700">약물 상호작용을 <span className="font-semibold">확인하지 못했습니다</span>. 상호작용이 없다는 뜻이 아닙니다 — 약사·담당의에게 문의하세요.</p>
          <button onClick={() => { setChecked(false); setResult(null); }} className="mt-2 text-xs text-blue-600 font-medium underline"><PT k="다시 확인" /></button>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1"><PT k="약물 상호작용 검사 결과" /></p>
          {(result.interactions?.length ?? 0) > 0 ? (
            <div className="space-y-1">
              {(result.interactions ?? []).slice(0, 5).map((inter, i: number) => (
                <div key={i} className="text-xs text-amber-900 bg-white rounded-lg p-2">
                  <span className="font-medium">{inter.drug_a} + {inter.drug_b}</span>: {inter.description ?? inter.severity ?? '주의'}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-green-700 bg-green-50 rounded-lg p-2">특별한 상호작용이 발견되지 않았습니다.</p>
          )}
          <p className="text-[11px] text-amber-700 mt-2">AI(WeRU.B) 생성 참고 — 약물 변경은 반드시 의사와 상의하세요</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   건강검진 포털 탭
   ═══════════════════════════════════════════════════════════════ */

const GRADE_COLORS_PORTAL: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-yellow-100 text-yellow-700',
  C1: 'bg-orange-100 text-orange-700',
  C2: 'bg-red-100 text-red-700',
  D1: 'bg-red-200 text-red-800',
  D2: 'bg-blue-100 text-blue-700',
};
const GRADE_LABELS_PORTAL: Record<string, string> = {
  A: '정상', B: '경미한 이상', C1: '요관찰', C2: '요치료', D1: '정밀검사 필요', D2: '치료 중',
};

interface CheckupSection { area: string; grade: string; findings?: string }
interface CheckupItem { id: string; testName: string; value: string; unit?: string; referenceRange?: string; finding: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' }
interface CheckupFollowUp { description: string; dueDate?: string }
interface CheckupSummary { overallGrade?: string; sections?: CheckupSection[]; doctorOpinion?: string; doctor?: { familyName: string; givenName: string }; signedAt?: string; recommendations?: string[] }
interface CheckupVisit { id: string; scheduledDate?: string; program?: { name: string; code: string }; summary?: CheckupSummary }
interface CheckupVisitDetail { id: string; summary?: CheckupSummary; items?: CheckupItem[]; followUps?: CheckupFollowUp[] }

function CheckupPortalTab({ patientId }: { patientId: string }) {
  const tAttr = usePortalTAttr();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkupSeg, setCheckupSeg] = useState<'reserve' | 'results' | 'compare'>('results');

  const { data: visitsRes, isLoading, isError: visitsIsError, error: visitsError, refetch: refetchVisits } = useQuery({
    queryKey: ['portal-checkup', patientId],
    queryFn: () => apiClient.get<{ data: CheckupVisit[] }>('/api/v1/portal/checkup-visits'),
  });
  const visits = visitsRes?.data ?? [];

  const { data: detailRes, isError: detailIsError, error: detailError, refetch: refetchDetail } = useQuery({
    queryKey: ['portal-checkup-detail', selectedId],
    queryFn: () => apiClient.get<{ data: CheckupVisitDetail }>(`/api/v1/portal/checkup-visits/${selectedId}`),
    enabled: !!selectedId,
  });
  const detail = detailRes?.data;

  const { data: compRes, isError: compIsError, error: compError, refetch: refetchComp } = useQuery({
    queryKey: ['portal-checkup-comparison'],
    queryFn: () => apiClient.get<{ data: { trends: any[]; gradeTimeline: any[] } }>('/api/v1/portal/checkup-comparison'),
    enabled: checkupSeg === 'compare',
  });

  if (isLoading) return <SkeletonCard lines={4} />;

  const SEGS = [
    { key: 'reserve' as const, label: '예약' },
    { key: 'results' as const, label: '검진 결과' },
    { key: 'compare' as const, label: '결과 비교' },
  ];

  return (
    <div className="space-y-4">
      {/* 세그먼트 선택 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {SEGS.map((s) => (
          <button key={s.key} onClick={() => setCheckupSeg(s.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
              checkupSeg === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}>{s.label}</button>
        ))}
      </div>

      {/* 세그먼트 1: 예약 + 문진 */}
      {checkupSeg === 'reserve' && (
        <CheckupReserveSegment patientId={patientId} />
      )}

      {/* 세그먼트 2: 검진 결과 */}
      {/* 🔴 (포털 A6) 조회 실패를 "건강검진 이력이 없습니다"로 말하지 않는다 */}
      {checkupSeg === 'results' && visitsIsError && <QueryErrorFallback error={visitsError} onRetry={() => refetchVisits()} size="compact" />}
      {checkupSeg === 'results' && !visitsIsError && visits.length === 0 && (
        <EmptyState icon="🏥" title="건강검진 이력이 없습니다" description="검진을 예약하시면 결과를 이곳에서 확인하실 수 있습니다." />
      )}
      {checkupSeg === 'results' && visits.map((v: CheckupVisit) => {
        const isExpanded = selectedId === v.id;
        return (
          <div key={v.id} className="bg-white rounded-xl border overflow-hidden">
            <button
              onClick={() => setSelectedId(isExpanded ? null : v.id)}
              className="w-full p-4 text-left hover:bg-gray-50 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{v.program?.name}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {v.scheduledDate?.slice(0, 10)} | {v.program?.code}
                  </div>
                </div>
                {v.summary?.overallGrade && (
                  <div className="text-center">
                    <span className={`inline-block px-3 py-1 rounded-lg text-sm font-bold ${
                      GRADE_COLORS_PORTAL[v.summary.overallGrade] ?? 'bg-gray-100'
                    }`}>
                      {v.summary.overallGrade}
                    </span>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {GRADE_LABELS_PORTAL[v.summary.overallGrade]}
                    </div>
                  </div>
                )}
              </div>

              {/* 영역별 미니 판정 */}
              {v.summary?.sections && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {v.summary.sections.map((sec: CheckupSection, idx: number) => (
                    <span
                      key={idx}
                      className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                        GRADE_COLORS_PORTAL[sec.grade] ?? 'bg-gray-50'
                      }`}
                    >
                      {sec.area} {sec.grade}
                    </span>
                  ))}
                </div>
              )}
            </button>

            {/* 확장 상세 */}
            {isExpanded && !detail && detailIsError && (
              <div className="border-t p-3"><QueryErrorFallback error={detailError} onRetry={() => refetchDetail()} size="compact" /></div>
            )}
            {isExpanded && detail && (
              <div className="border-t p-4 bg-gray-50 space-y-4">
                {/* 영역별 상세 */}
                {detail.summary?.sections && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm"><PT k="영역별 판정" /></h4>
                    {detail.summary.sections.map((sec: CheckupSection, idx: number) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg ${GRADE_COLORS_PORTAL[sec.grade] ?? 'bg-gray-50'}`}
                      >
                        <div className="flex justify-between">
                          <span className="font-medium">{sec.area}</span>
                          <span className="font-bold">{sec.grade}</span>
                        </div>
                        <div className="text-sm mt-1 opacity-80">{sec.findings}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 검사 결과 */}
                {(detail.items?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-2"><PT k="검사 결과" /></h4>
                    <table className="w-full text-xs">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-2 py-1 text-left"><PT k="검사명" /></th>
                          <th className="px-2 py-1 text-right"><PT k="결과" /></th>
                          <th className="px-2 py-1 text-right"><PT k="참고치" /></th>
                          <th className="px-2 py-1 text-center"><PT k="판정" /></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(detail.items ?? []).map((item: CheckupItem) => (
                          <tr key={item.id} className={
                            item.finding === 'CRITICAL' ? 'bg-red-50' :
                            item.finding === 'ABNORMAL' ? 'bg-yellow-50' : ''
                          }>
                            <td className="px-2 py-1.5"><PortalLabTerm name={item.testName} /></td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {item.value}{item.unit && <span className="text-gray-400 ml-0.5">{item.unit}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right text-gray-400">{item.referenceRange ?? '-'}</td>
                            <td className="px-2 py-1.5 text-center">
                              <JudgmentText j={findingJudgment(item.finding)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 의사 소견 */}
                {detail.summary?.doctorOpinion && (
                  <div className="bg-white rounded-lg p-3">
                    <h4 className="font-medium text-sm mb-1"><PT k="의사 종합소견" /></h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{detail.summary.doctorOpinion}</p>
                    {detail.summary.doctor && (
                      <div className="text-xs text-gray-400 mt-2 text-right">
                        담당의: {detail.summary.doctor.familyName}{detail.summary.doctor.givenName}
                        {detail.summary.signedAt && ` | ${portalDateText(detail.summary.signedAt, 'date')}`}
                      </div>
                    )}
                  </div>
                )}

                {/* 추천사항 */}
                {detail.summary?.recommendations && (detail.summary.recommendations as string[]).length > 0 && (
                  <div className="bg-blue-50 rounded-lg p-3">
                    <h4 className="font-medium text-sm text-blue-700 mb-1"><PT k="추천사항" /></h4>
                    <ul className="list-disc list-inside text-sm text-blue-800 space-y-0.5">
                      {(detail.summary.recommendations as string[]).map((r: string, i: number) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 추적검사 */}
                {(detail.followUps?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-1"><PT k="추적 검사 일정" /></h4>
                    {(detail.followUps ?? []).map((fu: CheckupFollowUp, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 bg-white rounded">
                        <span>{fu.description}</span>
                        <span className="text-gray-400">{fu.dueDate?.slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 세그먼트 3: 결과 비교 */}
      {checkupSeg === 'compare' && compIsError && <QueryErrorFallback error={compError} onRetry={() => refetchComp()} size="compact" />}
      {checkupSeg === 'compare' && !compIsError && (
        <div className="space-y-4">
          {/* 등급 변화 타임라인 */}
          {compRes?.data?.gradeTimeline && compRes.data.gradeTimeline.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <h4 className="font-medium text-sm mb-3"><PT k="종합등급 변화" /></h4>
              <div className="flex items-end gap-3">
                {compRes.data.gradeTimeline.map((g: any, i: number) => (
                  <div key={i} className="text-center flex-1">
                    <span className={`inline-block px-3 py-1.5 rounded-lg text-sm font-bold ${GRADE_COLORS_PORTAL[g.overallGrade] ?? 'bg-gray-100'}`}>
                      {g.overallGrade ?? '-'}
                    </span>
                    <div className="text-[10px] text-gray-400 mt-1">{g.date}</div>
                    <div className="text-[10px] text-gray-500">{g.program}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 수치 추이 */}
          {(compRes?.data?.trends ?? []).length === 0 ? (
            <EmptyState icon="📊" title="비교 데이터가 부족합니다" description="2회 이상 검진 결과가 있어야 비교가 가능합니다." />
          ) : (
            <div className="space-y-2">
              <h4 className="font-medium text-sm"><PT k="수치 변화 추이" /></h4>
              {(compRes?.data?.trends ?? []).map((t: any, i: number) => {
                const points = t.dataPoints as { date: string; value: string; finding: string }[];
                const latest = points[points.length - 1];
                const prev = points.length > 1 ? points[points.length - 2] : null;
                const latestNum = parseFloat(latest?.value ?? '');
                const prevNum = prev ? parseFloat(prev.value) : NaN;
                const trend = !isNaN(latestNum) && !isNaN(prevNum) ? (latestNum > prevNum ? '↑' : latestNum < prevNum ? '↓' : '→') : '';
                const trendColor = trend === '↑' ? 'text-red-500' : trend === '↓' ? 'text-blue-500' : 'text-gray-400';
                return (
                  <div key={i} className="bg-white rounded-xl border p-3 flex items-center justify-between">
                    <span className="text-sm text-gray-700"><PortalLabTerm name={t.testName} /></span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-end gap-px h-4">
                        {points.slice(-5).map((p: any, j: number) => {
                          const vals = points.slice(-5).map((pp: any) => parseFloat(pp.value)).filter((v: number) => !isNaN(v));
                          const max = Math.max(...vals);
                          const v = parseFloat(p.value);
                          const h = max > 0 && !isNaN(v) ? Math.max(2, (v / max) * 16) : 4;
                          {/* 🔴 색만으로 판정을 말하지 않는다(§4.6) — 의미는 p.finding 에서 가져온다.
                              판정이 비어 있으면 '정상'이 아니라 판정 미상이다(미상을 정상으로 접지 않는다) */}
                          const findingWord = tAttr(JUDGMENT_LABEL[findingJudgment(p.finding)]);
                          const barLabel = `${p.date ?? '일자 미상'} ${p.value ?? ''}${t.unit ?? ''} · ${findingWord}`;
                          return <div key={j} aria-label={barLabel} title={barLabel} className={`w-1.5 rounded-sm ${p.finding === 'ABNORMAL' ? 'bg-amber-400' : p.finding === 'CRITICAL' ? 'bg-red-400' : 'bg-blue-300'}`} style={{ height: `${h}px` }} />;
                        })}
                      </div>
                      <span className="font-medium text-gray-900 text-sm w-20 text-right">{latest?.value} {t.unit ?? ''}</span>
                      <span className={`text-xs font-bold ${trendColor}`}>{trend}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   검진 예약 + 문진 세그먼트
   ═══════════════════════════════════════════════════════════════ */

/* ── 검진 예약 캘린더 ── */
interface DayCapacity { date: string; capacity: number; reserved: number; available: number; isWeekend: boolean }

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtKDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${dow})`;
};

function CheckupCalendar({ selectedDate, onSelect }: { selectedDate: string; onSelect: (date: string, cap: DayCapacity) => void }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = toYmd(today);
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() }); // m: 0~11

  const monthFirst = new Date(view.y, view.m, 1);
  const monthLast = new Date(view.y, view.m + 1, 0);
  // 과거 달은 오늘부터, 그 외엔 1일부터 조회
  const fromDate = monthFirst < today ? today : monthFirst;
  const fromYmd = toYmd(fromDate);
  const toYmdStr = toYmd(monthLast);

  const { data: capRes, isLoading, isError: capIsError, error: capError, refetch: refetchCap } = useQuery({
    queryKey: ['portal-checkup-capacity', view.y, view.m],
    queryFn: () => apiClient.get<{ data: DayCapacity[] }>('/api/v1/portal/checkup-capacity', { from: fromYmd, to: toYmdStr }),
  });
  const capMap = new Map((capRes?.data ?? []).map((c) => [c.date, c]));

  // 네비게이션 한계: 과거 달 금지, +3개월까지
  const limit = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const canPrev = monthFirst > new Date(today.getFullYear(), today.getMonth(), 1);
  const canNext = monthFirst < limit;
  const move = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const leadingBlanks = monthFirst.getDay(); // 일요일=0
  const daysInMonth = monthLast.getDate();
  const cells: (DayCapacity | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = toYmd(new Date(view.y, view.m, d));
    cells.push(capMap.get(ymd) ?? { date: ymd, capacity: 0, reserved: 0, available: 0, isWeekend: [0, 6].includes(new Date(view.y, view.m, d).getDay()) });
  }

  return (
    <div className="bg-white rounded-xl border border-blue-100 p-3">
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => canPrev && move(-1)} disabled={!canPrev}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">‹</button>
        <span className="text-sm font-semibold text-gray-800">{view.y}<Unit>년</Unit> {view.m + 1}월</span>
        <button onClick={() => canNext && move(1)} disabled={!canNext}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">›</button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
          <div key={w} className={`text-center text-[10px] font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">불러오는 중...</div>
      ) : capIsError ? (
        // 🔴 (포털 A6) 종전엔 조회 실패 = 모든 날 정원 0 → 평일 전부 "마감"으로 잠겼다(자리가 없다고 믿는다)
        <QueryErrorFallback error={capError} onRetry={() => refetchCap()} size="compact" />
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cap, idx) => {
            if (!cap) return <div key={`b${idx}`} />;
            const isPast = cap.date < todayYmd;
            const isFull = !cap.isWeekend && cap.available <= 0;
            const disabled = isPast || cap.isWeekend || isFull;
            const isSel = cap.date === selectedDate;
            const dayNum = Number(cap.date.slice(8, 10));
            // 가용률에 따른 색상
            let tone = 'bg-blue-50 text-blue-700 hover:bg-blue-100'; // 여유
            if (disabled) tone = 'bg-gray-50 text-gray-300';
            else if (cap.available <= 5) tone = 'bg-amber-50 text-amber-700 hover:bg-amber-100'; // 마감임박
            return (
              <button
                key={cap.date}
                onClick={() => !disabled && onSelect(cap.date, cap)}
                disabled={disabled}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center transition ${
                  isSel ? 'ring-2 ring-blue-500 bg-blue-600 text-white' : tone
                }`}
              >
                <span className="text-xs font-semibold leading-none">{dayNum}</span>
                {!disabled && !isSel && (
                  <span className="text-[8px] leading-none mt-0.5">{cap.available}석</span>
                )}
                {isFull && !isPast && <span className="text-[8px] leading-none mt-0.5"><PT k="마감" /></span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 범례 */}
      <div className="flex items-center gap-2.5 mt-2.5 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded bg-blue-100 inline-block" /><PT k="여유" /></span>
        <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded bg-amber-100 inline-block" /><PT k="마감임박" /></span>
        <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded bg-gray-100 inline-block" /><PT k="마감/주말" /></span>
      </div>
    </div>
  );
}

function CheckupReserveSegment({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedCap, setSelectedCap] = useState<DayCapacity | null>(null);
  const [questForm, setQuestForm] = useState<{ visitId: string; qId: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  // 내 예약 현황 (예약~진행 상태)
  const { data: myVisitsRes, isError: myVisitsIsError, error: myVisitsError, refetch: refetchMyVisits } = useQuery({
    queryKey: ['portal-checkup-my', patientId],
    queryFn: () => apiClient.get<any>('/api/v1/portal/checkup-visits'),
  });
  const allVisits = (myVisitsRes?.data ?? []) as any[];

  // 프로그램 목록
  const { data: programsRes, isError: programsIsError, error: programsError, refetch: refetchPrograms } = useQuery({
    queryKey: ['portal-checkup-programs'],
    queryFn: () => apiClient.get<any>('/api/v1/portal/checkup-programs'),
  });
  const programs = programsRes?.data ?? [];

  const reserve = useMutation({
    mutationFn: (body: { programId: string; scheduledDate: string }) =>
      apiClient.post('/api/v1/portal/checkup-reserve', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-checkup-my'] });
      setSelectedProgram(null);
      setSelectedDate('');
      setSelectedCap(null);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/portal/checkup-visits/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal-checkup-my'] }),
  });

  const saveQuest = useMutation({
    mutationFn: (body: { visitId: string; questionnaireId: string; answers: unknown }) =>
      apiClient.post(`/api/v1/portal/checkup-visits/${body.visitId}/questionnaire`, { questionnaireId: body.questionnaireId, answers: body.answers }),
    onSuccess: () => { setQuestForm(null); setAnswers({}); },
  });

  const fmtPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n);

  // 문진 폼 렌더링
  if (questForm) {
    return <PortalQuestionnaireForm visitId={questForm.visitId} onClose={() => setQuestForm(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* 내 예약 현황 */}
      {/* 🔴 (포털 A6) 내 예약 조회 실패를 "예약 없음"(목록 숨김)으로 접지 않는다 */}
      {myVisitsIsError && <QueryErrorFallback error={myVisitsError} onRetry={() => refetchMyVisits()} size="compact" />}
      {allVisits.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2"><PT k="내 예약" /></h3>
          {allVisits.filter((v: any) => ['RESERVED', 'CHECKED_IN', 'IN_PROGRESS'].includes(v.status)).map((v: any) => (
            <div key={v.id} className="bg-white rounded-xl border p-4 mb-2">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold text-sm">{v.program?.name}</div>
                  <div className="text-xs text-gray-500">{v.scheduledDate?.slice(0, 10)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {v.status === 'RESERVED' && (
                    <>
                      <button onClick={() => setQuestForm({ visitId: v.id, qId: '' })}
                        className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium">
                        <PT k="문진 작성" />
                      </button>
                      <button onClick={() => cancel.mutate(v.id)}
                        className="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs font-medium">
                        취소
                      </button>
                    </>
                  )}
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium whitespace-nowrap">
                    {v.status === 'RESERVED' ? '예약' : v.status === 'CHECKED_IN' ? '접수' : '진행중'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 프로그램 선택 */}
      <h3 className="text-sm font-semibold text-gray-900"><PT k="검진 프로그램" /></h3>
      {programsIsError && <QueryErrorFallback error={programsError} onRetry={() => refetchPrograms()} size="compact" />}
      <div className="space-y-2">
        {programs.map((p: any) => {
          const isSelected = selectedProgram === p.id;
          return (
            <div key={p.id}>
              <button onClick={() => setSelectedProgram(isSelected ? null : p.id)}
                className={`w-full text-left bg-white rounded-xl border p-4 transition ${isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'hover:border-gray-300'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-sm">{p.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{p.code} · {p.duration}<Unit>분</Unit> · {(p.items as any[])?.length ?? 0}항목</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-blue-600">{fmtPrice(p.price)}<Unit>원</Unit></div>
                    {p.discountRate > 0 && <div className="text-xs text-red-500">-{p.discountRate}<Unit>%</Unit></div>}
                  </div>
                </div>
                {p.description && <p className="text-xs text-gray-500 mt-2 line-clamp-2">{p.description}</p>}
              </button>

              {/* 날짜 선택(캘린더) + 예약 */}
              {isSelected && (
                <div className="bg-blue-50 rounded-xl p-4 mt-1 space-y-3">
                  <label className="text-xs font-medium text-blue-700 block"><PT k="예약 날짜 선택" /></label>
                  <CheckupCalendar
                    selectedDate={selectedDate}
                    onSelect={(date, cap) => { setSelectedDate(date); setSelectedCap(cap); }}
                  />
                  {selectedDate && selectedCap && (
                    <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                      <span className="text-xs font-medium text-gray-700">{fmtKDate(selectedDate)}</span>
                      <span className={`text-xs font-semibold ${selectedCap.available > 0 ? 'text-blue-600' : 'text-red-500'}`}>
                        {selectedCap.isWeekend ? '주말 — 검진 불가' : selectedCap.available > 0 ? `잔여 ${selectedCap.available}석 / ${selectedCap.capacity}석` : '예약 마감'}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => reserve.mutate({ programId: p.id, scheduledDate: selectedDate })}
                    disabled={!selectedDate || reserve.isPending || !selectedCap || selectedCap.isWeekend || selectedCap.available <= 0}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {reserve.isPending ? '예약 중...' : '예약하기'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 포털 문진 작성 폼 ── */
function PortalQuestionnaireForm({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const tAttr = usePortalTAttr();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const { data: qRes, isLoading, isError: qIsError, error: qError, refetch: refetchQ } = useQuery({
    queryKey: ['portal-quest', visitId],
    queryFn: () => apiClient.get<any>(`/api/v1/portal/checkup-visits/${visitId}/questionnaire`),
  });
  const template = qRes?.data?.template;
  const existing = qRes?.data?.response;

  // 기존 응답 복원
  useState(() => {
    if (existing?.answers) setAnswers(existing.answers as Record<string, unknown>);
  });

  const save = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/portal/checkup-visits/${visitId}/questionnaire`, {
      questionnaireId: template?.id,
      answers,
    }),
    onSuccess: () => onClose(),
  });

  if (isLoading) return <SkeletonCard lines={4} />;
  // 🔴 (포털 A6) 조회 실패를 "문진 템플릿이 없습니다"로 말하지 않는다
  if (qIsError) return <QueryErrorFallback error={qError} onRetry={() => refetchQ()} size="compact" />;
  if (!template) return <EmptyState icon="📝" title="문진 템플릿이 없습니다" />;

  const sections = (template.sections ?? []) as any[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{template.title}</h3>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600"><PT k="닫기" /></button>
      </div>

      {sections.map((sec: any, si: number) => (
        <div key={si} className="bg-white rounded-xl border p-4 space-y-3">
          <h4 className="text-xs font-semibold text-gray-700">{sec.title}</h4>
          {(sec.questions ?? []).map((q: any) => (
            <div key={q.id}>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                {q.label}{q.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {q.type === 'text' && (
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={q.label}
                  value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              )}
              {q.type === 'select' && (
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
                  <option value=""><PT k="선택" /></option>
                  {q.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {q.type === 'multiselect' && (
                <div className="flex flex-wrap gap-1.5">
                  {q.options?.map((o: string) => {
                    const selected = ((answers[q.id] as string[]) ?? []).includes(o);
                    return (
                      <button key={o} type="button"
                        onClick={() => {
                          const prev = (answers[q.id] as string[]) ?? [];
                          setAnswers({ ...answers, [q.id]: selected ? prev.filter((s) => s !== o) : [...prev, o] });
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs border ${selected ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}
              {q.type === 'boolean' && (
                <div className="flex gap-2">
                  {['true', 'false'].map((v) => (
                    <button key={v} type="button"
                      onClick={() => setAnswers({ ...answers, [q.id]: v === 'true' })}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border ${String(answers[q.id]) === v ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>
                      {v === 'true' ? '예' : '아니오'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
        {save.isPending ? '저장 중...' : '문진 응답 저장'}
      </button>
    </div>
  );
}

/**
 * 내 기록 요약 카드 (Glass).
 *
 * 🔴 **원형 "건강 점수" 게이지는 폐지했다**(2026-08-18 · P15-b · 환자에게 직접 노출되던 것).
 *    서버가 LLM 에게 `진료 횟수 / 검사 횟수` 만 주고 0~100 점을 만들게 한 뒤, 이 카드가 그 숫자를
 *    `양호 / 보통 / 주의` 색등급과 함께 환자에게 보여줬다. 그 점수 뒤에는 검증된 산출 도구가 없다
 *    (영양·운동·정신건강 항목 배지는 병원에 자료조차 없는 값이었다).
 *    W9 에서 "점수를 못 찾으면 0 → 빨간 '주의'" 를 `산출 불가` 로 고친 바 있으나, 그것은 **없을 때**의
 *    처리였다. 진짜 문제는 **있을 때** — 지어낸 숫자가 등급으로 읽힌다는 쪽이었다.
 *
 *    → 점수를 그리지 않는다. 대신 **셀 수 있는 사실**(진료·검사·활성 문제 건수)과, 실제 진료 기록을
 *      근거로 한 다음 방문 권고만 보여준다. 서버는 `source: 'UNAVAILABLE'` + 사유를 내려주고
 *      화면은 그 사유를 그대로 말한다(숨기면 결함이 화면으로 옮겨갈 뿐이다).
 */
function MyRecordSummaryCard() {
  const tAttr = usePortalTAttr();
  const { data: scoreData, isLoading, isError: scoreIsError, error: scoreError, refetch: refetchScore } = useQuery({
    queryKey: ['portal-ai-health-score'],
    queryFn: () => apiClient.fetch<{ data: Record<string, unknown> }>('/api/v1/portal/health-score'),
    staleTime: 10 * 60 * 1000,
  });
  const { data: followupData, isError: followupIsError, error: followupError, refetch: refetchFollowup } = useQuery({
    queryKey: ['portal-ai-followup'],
    queryFn: () => apiClient.fetch<{ data: Record<string, unknown> }>('/api/v1/portal/followup-recommendation'),
    staleTime: 10 * 60 * 1000,
  });

  const raw = ((scoreData?.data as { data?: Record<string, unknown> })?.data ?? scoreData?.data) as Record<string, unknown> | null;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const encounterCount = num(raw?.encounterCount);
  const labCount = num(raw?.labCount);
  const activeProblemCount = num(raw?.activeProblemCount);
  const scoreReason = typeof raw?.reason === 'string' ? raw.reason : null;

  const followup = ((followupData?.data as { data?: Record<string, unknown> })?.data ?? followupData?.data) as Record<string, unknown> | null;
  const extractText = (v: unknown): string | undefined => {
    let text: string | undefined;
    if (typeof v === 'string') text = v;
    else if (typeof v === 'object' && v !== null) text = ((v as Record<string, unknown>).answer as string) ?? undefined;
    // WeRU.B 서버 에러 메시지가 권고문으로 렌더되지 않게 거른다.
    if (text && (text.includes('Error:') || text.includes('BadStatusLine') || text.includes('Connection aborted'))) return undefined;
    return text;
  };
  const nextVisit = extractText(followup?.recommendation);
  // 🔴 권고가 없는 이유를 구분해서 말한다 — 'UNAVAILABLE'(근거 없어 부르지 않음) vs 'FALLBACK'(응답 실패).
  const followupUnavailable = followup?.source === 'UNAVAILABLE' ? (typeof followup?.reason === 'string' ? followup.reason : null) : null;
  const followupFailed = followup?.source === 'FALLBACK';

  const Stat = ({ label, value }: { label: string; value: number | null }) => (
    <div className="flex-1 text-center">
      {/* 값을 못 받았으면 0 이 아니라 '-' — 0 건은 다른 사실이다. */}
      <p className="text-xl font-bold text-gray-800">{value == null ? '-' : value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-blue-100 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-gray-800 mb-3"><PT k="내 기록 요약" /></h3>
      {/* 🔴 조회 실패에 '-' 를 그리면 "기록이 없다"로 읽힌다 — 실패는 실패라고 말한다 */}
      {scoreIsError ? (
        <QueryErrorFallback error={scoreError} onRetry={() => refetchScore()} size="compact" />
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-400">기록을 불러오는 중...</span>
        </div>
      ) : (
        <>
          <div className="flex items-stretch divide-x divide-gray-100">
            <Stat label={tAttr('진료 기록')} value={encounterCount} />
            <Stat label={tAttr('검사 기록')} value={labCount} />
            <Stat label={tAttr('관리 중인 문제')} value={activeProblemCount} />
          </div>

          {/* 종합 '건강 점수'를 왜 보여주지 않는지 — 침묵하지 않고 사유를 밝힌다 */}
          {scoreReason && (
            <p className="text-[10px] text-gray-500 mt-3 leading-relaxed bg-gray-50 rounded-lg px-3 py-2">
              <PT k="종합 건강 점수:" /> <span className="font-medium"><PT k="산출 불가" /></span> — {scoreReason}
            </p>
          )}

          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[11px] font-semibold text-gray-600 mb-1"><PT k="다음 방문 권고" /></p>
            {followupIsError ? (
              <QueryErrorFallback error={followupError} onRetry={() => refetchFollowup()} size="compact" />
            ) : nextVisit ? (
              <p className="text-xs text-blue-700 leading-relaxed">{nextVisit}</p>
            ) : followupUnavailable ? (
              <p className="text-[11px] text-gray-500">산출 불가 — {followupUnavailable}</p>
            ) : followupFailed ? (
              <p className="text-[11px] text-gray-500">지금은 권고를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>
            ) : (
              <p className="text-[11px] text-gray-400">담당 의료진과 상의해 다음 방문 시기를 정하세요.</p>
            )}
          </div>
        </>
      )}
      <p className="text-[10px] text-gray-400 mt-3 text-center">
        위 건수는 병원에 기록된 건수이며, 건강 상태 평가가 아닙니다. 정확한 판단은 담당 의료진에게 문의하세요.
      </p>
    </div>
  );
}

// ── 내 건강검진권 (소비자 셀프 활성화·조회) ──
interface MyVoucher { serial: string; form: string; program: string | null; faceValue: number; balance: number; status: string; expiresAt: string | null }

function MyVoucherSection() {
  const tAttr = usePortalTAttr();
  const qc = useQueryClient();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['portal-vouchers'],
    queryFn: () => apiClient.get<{ data: MyVoucher[] }>('/api/v1/portal/vouchers/mine').then((r) => r.data),
  });
  const [serial, setSerial] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const activate = useMutation({
    mutationFn: () => apiClient.post('/api/v1/portal/vouchers/' + encodeURIComponent(serial.trim()) + '/activate', { activationCode: code.trim(), consent: true }),
    onSuccess: () => { setMsg('활성화되었습니다.'); setSerial(''); setCode(''); qc.invalidateQueries({ queryKey: ['portal-vouchers'] }); },
    onError: (e: unknown) => setMsg((e as { message?: string })?.message ?? '활성화 실패'),
  });

  const vouchers = data ?? [];
  const ST: Record<string, string> = { ACTIVE: 'text-emerald-600 bg-emerald-50', REDEEMED: 'text-gray-400 bg-gray-50', SOLD: 'text-indigo-600 bg-indigo-50', EXPIRED: 'text-gray-400 bg-gray-50', REFUNDED: 'text-red-500 bg-red-50' };

  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-4 shadow-sm">
      <h3 className="text-sm font-bold text-gray-800 mb-3"><PT k="🎫 내 건강검진권" /></h3>
      {/* 활성화 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={tAttr('검진권 번호')} className="flex-1 min-w-[140px] px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono" />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tAttr('활성화코드')} className="w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        <button onClick={() => { setMsg(''); activate.mutate(); }} disabled={!serial || !code || activate.isPending} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><PT k="활성화" /></button>
      </div>
      {msg && <p className={`text-xs mb-2 ${msg.includes('실패') ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</p>}
      {/* 목록 */}
      <div className="space-y-1.5">
        {vouchers.map((v) => (
          <div key={v.serial} className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50/80">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-700 truncate">{v.program ?? (v.form === 'AMOUNT' ? '금액권' : '검진권')}</p>
              <p className="text-[11px] text-gray-400 font-mono">{v.serial}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-gray-800">{v.balance.toLocaleString()}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ST[v.status] ?? 'text-gray-500 bg-gray-100'}`}>{v.status}</span>
            </div>
          </div>
        ))}
        {isError && <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />}
        {!isError && vouchers.length === 0 && <p className="text-xs text-gray-400 text-center py-3">활성화된 검진권이 없습니다. 위에서 번호·코드로 활성화하세요.</p>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   검사결과 묶음(2026-10-19 포털 세련화 A3)
   ═══════════════════════════════════════════════════════════════ */

const dayOf = (iso: string | null | undefined) => kstDateOf(iso) ?? ''; // 병원 시간대 날짜(정본 `lib/kst-today`)

/** 검사·기초검사를 날짜(병원 시간대)로 묶는다 — 최신 날짜 먼저 · 날짜 미상은 맨 끝 */
export function resultsByDate(labs: LabResult[], diags: DiagnosticTest[]) {
  const map = new Map<string, { date: string; labs: LabResult[]; diags: DiagnosticTest[]; abnormal: number }>();
  const at = (d: string) => map.get(d) ?? map.set(d, { date: d, labs: [], diags: [], abnormal: 0 }).get(d)!;
  for (const lr of labs) {
    const g = at(dayOf(lr.orderedAt));
    g.labs.push(lr);
    g.abnormal += (lr.items ?? []).filter((i) => { const j = labFlagJudgment(i.flag); return j != null && j !== 'NORMAL'; }).length;
  }
  for (const dt of diags) {
    const g = at(dayOf(dt.performedAt));
    g.diags.push(dt);
    if (dt.conclusion === 'ABNORMAL' || dt.conclusion === 'BORDERLINE') g.abnormal += 1;
  }
  return [...map.values()].sort((a, b) => (a.date === '' ? 1 : b.date === '' ? -1 : b.date.localeCompare(a.date)));
}

/** 최근 검사(가장 늦은 날짜)의 기준 밖 항목 — 진단·권고하지 않고 "의료진과 상의" 고정 문구만 */
function LatestAbnormalSummary({ labResults }: { labResults: LabResult[] }) {
  const latest = resultsByDate(labResults, []).find((g) => g.date !== '');
  if (!latest) return null;
  const items = latest.labs.flatMap((lr) => (lr.items ?? []).map((i) => ({ i, j: labFlagJudgment(i.flag) }))).filter((x) => x.j != null && x.j !== 'NORMAL');
  // 🔴 (2026-10-20 B8) 확인 전 항목은 판정이 비어 있다 — 그것을 "기준 밖 없음"으로 말하면 근거 없는 안심(P17)
  const pending = latest.labs.flatMap((lr) => lr.items ?? []).filter((i) => i.judgmentPending).length;
  return (
    <div className="bg-white rounded-xl border p-4" data-portal-latest-abnormal>
      <p className="text-sm font-semibold text-gray-900">
        <PT k="최근 검사" /> <span className="text-xs font-normal text-gray-500">{fmt(latest.date)}</span>
      </p>
      {pending > 0 && (
        <p className="text-xs text-amber-700 mt-1" data-portal-latest-pending>
          <PT k="의료진 확인 전인 항목" /> {pending} — <PT k="판정은 확인 후에 보입니다." />
        </p>
      )}
      {items.length === 0 ? (
        pending > 0 ? null : <p className="text-xs text-gray-600 mt-1"><PT k="이 날 검사에서 기준 밖으로 표시된 항목이 없습니다." /></p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {items.map(({ i, j }, k) => (
              <li key={k} className="flex justify-between text-xs">
                <span className="text-gray-700">{i.name}</span>
                <span>{i.value} {i.unit} · <JudgmentText j={j!} /></span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-500 mt-2"><PT k="기준 밖 결과의 의미는 다음 진료 때 의료진과 상의하세요." /></p>
        </>
      )}
    </div>
  );
}
