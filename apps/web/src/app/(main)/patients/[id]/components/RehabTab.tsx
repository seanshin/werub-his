'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import ScoreTrendChart from '@/components/specialty/ScoreTrendChart';
import type { ScoreSeries } from '@/components/specialty/ScoreTrendChart';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const ASSESSMENT_TYPE_LABEL: Record<string, string> = {
  BARTHEL: 'Barthel Index', FIM: 'FIM', MMT: 'MMT (도수근력)', ROM: 'ROM (관절가동범위)',
  BERG: 'Berg 균형', TUG: 'TUG', MBI: 'MBI', MMSE: 'MMSE',
};
const SESSION_TYPE_LABEL: Record<string, string> = { PT: '물리치료', OT: '작업치료', ST: '언어치료', RT: '호흡재활', HYDRO: '수치료' };
const SESSION_TYPE_COLOR: Record<string, string> = {
  PT: 'bg-blue-100 text-blue-700', OT: 'bg-emerald-100 text-emerald-700',
  ST: 'bg-violet-100 text-violet-700', RT: 'bg-amber-100 text-amber-700',
  HYDRO: 'bg-cyan-100 text-cyan-700',
};
const STATUS_LABEL: Record<string, string> = { ACTIVE: '진행 중', COMPLETED: '완료', CANCELLED: '취소', DRAFT: '초안' };
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-blue-100 text-blue-700', COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-gray-100 text-gray-500', DRAFT: 'bg-yellow-100 text-yellow-700',
};

type RehabSubTab = 'assessments' | 'plans' | 'sessions';

interface RehabTabProps {
  patientId: string;
}

export function RehabTab({ patientId }: RehabTabProps) {
  const [tab, setTab] = useState<RehabSubTab>('assessments');

  const { data: assessmentsData, isLoading: assessmentsLoading, isError, error, refetch } = useQuery({
    queryKey: ['rehab-assessments', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/rehab/assessments/${patientId}`),
    enabled: tab === 'assessments' && !!patientId,
  });

  const { data: plansData, isLoading: plansLoading, isError: plansIsError, error: plansError, refetch: refetchPlans } = useQuery({
    queryKey: ['rehab-plans', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/rehab/plans`, { patientId }),
    enabled: tab === 'plans' && !!patientId,
  });

  const { data: sessionsData, isLoading: sessionsLoading, isError: sessionsIsError, error: sessionsError, refetch: refetchSessions } = useQuery({
    queryKey: ['rehab-sessions', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/rehab/sessions`, { patientId }),
    enabled: tab === 'sessions' && !!patientId,
  });

  const { data: progressData, isError: progressIsError, error: progressError, refetch: refetchProgress } = useQuery({
    queryKey: ['rehab-progress', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/rehab/patients/${patientId}/progress`),
    enabled: tab === 'assessments' && !!patientId,
  });

  const assessments: Record<string, unknown>[] = (() => { const r = assessmentsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const plans: Record<string, unknown>[] = (() => { const r = plansData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const sessions: Record<string, unknown>[] = (() => { const r = sessionsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const trendSeries: ScoreSeries[] = useMemo(() => {
    const progressRaw = progressData?.data;
    const progress = (typeof progressRaw === 'object' && progressRaw !== null)
      ? (progressRaw as Record<string, unknown>).data ?? progressRaw
      : null;
    if (!progress || typeof progress !== 'object') return [];

    const series: ScoreSeries[] = [];
    const prog = progress as Record<string, unknown>;

    // BE getPatientProgress 는 { assessments: [{ assessedAt, barthel, fim, ... }] } 형태로 반환.
    // (구형 prog.barthel/fimScores 배열 폴백 유지)
    const assessments = (Array.isArray(prog.assessments) ? prog.assessments : []) as Record<string, unknown>[];
    const fromAssessments = (key: string) =>
      assessments
        .filter((a) => a[key] != null && a.assessedAt != null)
        .map((a) => ({ date: a.assessedAt as string, value: Number(a[key]) }));
    const legacy = (arr: unknown) =>
      Array.isArray(arr)
        ? (arr as Record<string, unknown>[]).map((p) => ({
            date: (p.date ?? p.assessedAt ?? p.createdAt) as string,
            value: Number(p.score ?? p.value ?? p.totalScore ?? 0),
          }))
        : [];

    const barthelData = fromAssessments('barthel').length > 0 ? fromAssessments('barthel') : legacy(prog.barthel ?? prog.barthelScores);
    if (barthelData.length > 0) {
      series.push({ name: 'Barthel', color: '#3b82f6', maxScore: 100, data: barthelData });
    }

    const fimData = fromAssessments('fim').length > 0 ? fromAssessments('fim') : legacy(prog.fim ?? prog.fimScores);
    if (fimData.length > 0) {
      series.push({ name: 'FIM', color: '#10b981', maxScore: 126, data: fimData });
    }

    return series;
  }, [progressData]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'assessments' as RehabSubTab, label: '평가 이력' },
          { key: 'plans' as RehabSubTab, label: '치료 계획' },
          { key: 'sessions' as RehabSubTab, label: '세션 이력' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 평가 이력 */}
      {tab === 'assessments' && (
        <div className="space-y-4">
          {/* 🔴 추이 조회 실패를 "추이 없음"(차트 미표시)으로 접지 않는다 */}
          {progressIsError && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3"><T k="Barthel / FIM 추이" /></h3>
              <QueryErrorFallback error={progressError} onRetry={() => refetchProgress()} size="compact" />
            </div>
          )}
          {!progressIsError && trendSeries.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3"><T k="Barthel / FIM 추이" /></h3>
              <ScoreTrendChart series={trendSeries} />
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="평가유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="점수" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="등급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="평가자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
              </tr></thead>
              <tbody>
                {assessmentsLoading ? <LoadingRows cols={6} />
                : assessments.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="평가 기록 없음" /></td></tr>
                : assessments.map((a) => {
                  const assessor = a.assessor as Record<string, unknown> | undefined;
                  return (
                    <tr key={a.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs text-gray-700">{a.assessedAt ? kdate(a.assessedAt as string) : '-'}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{ASSESSMENT_TYPE_LABEL[a.assessmentType as string] ?? (a.assessmentType as string) ?? '-'}</span></td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">{(a.totalScore ?? a.score) != null ? `${a.totalScore ?? a.score}` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{(a.grade as string) ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{assessor ? `${(assessor.familyName as string) ?? ''}${(assessor.givenName as string) ?? ''}` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 max-w-[150px] truncate">{(a.notes as string) ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 치료 계획 */}
      {tab === 'plans' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="계획명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치료유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="빈도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방의" /></th>
            </tr></thead>
            <tbody>
              {plansIsError ? <tr><td colSpan={6} className="p-4"><QueryErrorFallback error={plansError} onRetry={() => refetchPlans()} size="compact" /></td></tr>
              : plansLoading ? <LoadingRows cols={6} />
              : plans.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="치료 계획 없음" /></td></tr>
              : plans.map((p) => {
                const doc = p.prescriber as Record<string, unknown> | undefined;
                const status = (p.status as string) ?? 'ACTIVE';
                return (
                  <tr key={p.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">{(p.planName ?? p.title ?? p.diagnosis) as string ?? '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {Array.isArray(p.therapies ?? p.therapyTypes)
                          ? ((p.therapies ?? p.therapyTypes) as string[]).map((t) => (
                            <span key={t} className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${SESSION_TYPE_COLOR[t] ?? 'bg-gray-100 text-gray-600'}`}>{SESSION_TYPE_LABEL[t] ?? t}</span>
                          ))
                          : <span className="text-xs text-gray-400">-</span>
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(p.frequency as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {p.startDate ? kdate(p.startDate as string) : '?'}
                      {' ~ '}
                      {p.endDate ? kdate(p.endDate as string) : '진행 중'}
                    </td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[status] ?? 'bg-gray-100'}`}>{STATUS_LABEL[status] ?? status}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 세션 이력 */}
      {tab === 'sessions' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치료유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치료사" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간(분)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소견" /></th>
            </tr></thead>
            <tbody>
              {sessionsIsError ? <tr><td colSpan={6} className="p-4"><QueryErrorFallback error={sessionsError} onRetry={() => refetchSessions()} size="compact" /></td></tr>
              : sessionsLoading ? <LoadingRows cols={6} />
              : sessions.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="세션 기록 없음" /></td></tr>
              : sessions.map((s) => {
                const therapist = s.therapist as Record<string, unknown> | undefined;
                const status = (s.status as string) ?? '';
                const sessionType = (s.sessionType ?? s.therapyType) as string ?? '';
                return (
                  <tr key={s.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{(s.scheduledAt ?? s.startedAt ?? s.createdAt) ? kdate(((s.scheduledAt ?? s.startedAt ?? s.createdAt) as string)) : '-'}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${SESSION_TYPE_COLOR[sessionType] ?? 'bg-gray-100 text-gray-600'}`}>{(SESSION_TYPE_LABEL[sessionType] ?? sessionType) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{therapist ? `${(therapist.familyName as string) ?? ''}${(therapist.givenName as string) ?? ''}` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-900">{(s.durationMinutes ?? s.duration) != null ? `${s.durationMinutes ?? s.duration}` : '-'}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[status] ?? 'bg-gray-100'}`}>{(STATUS_LABEL[status] ?? status) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-[150px] truncate">{(s.notes ?? s.findings) as string ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
