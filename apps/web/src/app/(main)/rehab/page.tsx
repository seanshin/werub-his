'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { bergFallRisk, buildRehabCompleteBody, emptyRehabCompleteForm, type RehabCompleteForm } from '@/lib/rehab-session';

// 라벨 맵 값은 i18n 키 — CANCELLED 는 무문맥 `취소`(=Cancel 버튼)가 이기므로 상태 문맥 키(status.ts 정본)로
const STATUS_LABEL: Record<string, string> = { ACTIVE: '진행', COMPLETED: '완료', CANCELLED: '취소@상태', PLANNED: '예정', ON_HOLD: '보류' };
const STATUS_COLOR: Record<string, string> = { ACTIVE: 'bg-emerald-100 text-emerald-700', COMPLETED: 'bg-blue-100 text-blue-700', CANCELLED: 'bg-gray-200 text-gray-600', PLANNED: 'bg-indigo-100 text-indigo-700', ON_HOLD: 'bg-amber-100 text-amber-700' };
const SESSION_STATUS: Record<string, string> = { SCHEDULED: '예정', IN_PROGRESS: '진행중', COMPLETED: '완료', CANCELLED: '취소@상태', NO_SHOW: '미방문' };
const SESSION_COLOR: Record<string, string> = { SCHEDULED: 'bg-indigo-100 text-indigo-700', IN_PROGRESS: 'bg-emerald-100 text-emerald-700', COMPLETED: 'bg-blue-100 text-blue-700', CANCELLED: 'bg-gray-200 text-gray-600', NO_SHOW: 'bg-red-100 text-red-700' };
const RISK_COLOR: Record<string, string> = { LOW: 'bg-emerald-100 text-emerald-700', MODERATE: 'bg-amber-100 text-amber-700', HIGH: 'bg-red-100 text-red-700' };
const RISK_LABEL: Record<string, string> = { LOW: '저위험', MODERATE: '중위험', HIGH: '고위험' };

type RehabTab = 'patients' | 'schedule' | 'assessments';

export default function RehabPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [tab, setTab] = useState<RehabTab>('patients');

  const { data: plansData, isLoading: plansLoading, isError, error, refetch } = useQuery({
    queryKey: ['rehab-plans'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/rehab/plans'),
    enabled: tab === 'patients',
  });

  const { data: sessionsData, isLoading: sessionsLoading, isError: sessionsIsError, error: sessionsError, refetch: refetchSessions } = useQuery({
    queryKey: ['rehab-sessions'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/rehab/sessions'),
    enabled: tab === 'schedule',
    refetchInterval: pollMs('fast'),
  });

  const { data: assessmentsData, isLoading: assessmentsLoading, isError: assessmentsIsError, error: assessmentsError, refetch: refetchAssessments } = useQuery({
    queryKey: ['rehab-assessments'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/rehab/assessments'),
    enabled: tab === 'assessments',
  });

  const [completeTarget, setCompleteTarget] = useState<Record<string, unknown> | null>(null);
  const [completeForm, setCompleteForm] = useState<RehabCompleteForm>(emptyRehabCompleteForm);

  const startSession = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/rehab/sessions/${id}/start`, {}),
    onSuccess: () => { toast.success(tAttr('치료 시작')); qc.invalidateQueries({ queryKey: ['rehab-sessions'] }); },
    onError: () => toast.error(tAttr('치료 시작 실패')),
  });

  const completeSession = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.patch(`/api/v1/rehab/sessions/${id}/complete`, body),
    onSuccess: () => { toast.success(tAttr('치료 완료')); qc.invalidateQueries({ queryKey: ['rehab-sessions'] }); setCompleteTarget(null); },
    onError: () => toast.error(tAttr('치료 완료 실패')),
  });

  const plans: Record<string, unknown>[] = (() => { const r = plansData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const sessions: Record<string, unknown>[] = (() => { const r = sessionsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const assessments: Record<string, unknown>[] = (() => { const r = assessmentsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="재활의학" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="재활 계획 / 치료 세션 / 기능 평가" /></p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'patients' as RehabTab, label: '환자현황' },
          { key: 'schedule' as RehabTab, label: '치료일정' },
          { key: 'assessments' as RehabTab, label: '재활평가' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* 환자현황 */}
      {tab === 'patients' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]">Barthel</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">FIM</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치료 유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
            </tr></thead>
            <tbody>
              {plansLoading ? <LoadingRows cols={6} />
              : plans.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="재활 계획 없음" /></td></tr>
              : plans.map((p) => {
                const patient = p.patient as Record<string, unknown> | undefined;
                const therapyTypes = Array.isArray(p.therapies)
                  ? (p.therapies as any[]).map(t => typeof t === 'string' ? t : (t as any)?.type ?? JSON.stringify(t))
                  : [];
                return (
                  <tr key={p.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                      <p className="text-[10px] text-gray-400">{(patient?.mrn as string) ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{(p.diagnosis as string) ?? '-'}</td>
                    {/* 🔴 RehabPlan 에는 점수 필드가 없다(정본은 RehabAssessment.barthel/fim) — 영구 '-' 였다 */}
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{((p.barthel ?? p.barthelScore) as number) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(p.fimScore as number) ?? '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {therapyTypes.map((t) => (
                          <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[p.status as string] ?? 'bg-gray-100'}`}><T k={STATUS_LABEL[p.status as string] ?? (p.status as string)} /></span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 치료일정 */}
      {tab === 'schedule' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치료사" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="치료 유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[140px]"><T k="액션" /></th>
            </tr></thead>
            <tbody>
              {sessionsIsError ? <tr><td colSpan={6} className="p-3"><QueryErrorFallback error={sessionsError} onRetry={() => refetchSessions()} size="compact" /></td></tr>
              : sessionsLoading ? <LoadingRows cols={6} />
              : sessions.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="오늘 치료 일정 없음" /></td></tr>
              : sessions.map((s) => {
                const plan = s.plan as Record<string, unknown> | undefined;
                const patient = plan?.patient as Record<string, unknown> | undefined;
                const therapist = s.therapist as Record<string, unknown> | undefined;
                const status = s.status as string;
                return (
                  <tr key={s.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{therapist ? `${(therapist.familyName as string) ?? ''}${(therapist.givenName as string) ?? ''}` : '-'}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                      <p className="text-[10px] text-gray-400">{(patient?.mrn as string) ?? ''}</p>
                    </td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{(s.therapyType as string) ?? '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(s.scheduledAt as string) ? kdate(s.scheduledAt as string, 'time') : '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SESSION_COLOR[status] ?? 'bg-gray-100'}`}><T k={SESSION_STATUS[status] ?? status} /></span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {status === 'SCHEDULED' && (
                          <button onClick={() => startSession.mutate(s.id as string)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"><T k="시작" /></button>
                        )}
                        {status === 'IN_PROGRESS' && (
                          <button onClick={() => { setCompleteTarget(s); setCompleteForm(emptyRehabCompleteForm()); }}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"><T k="완료" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 재활평가 */}
      {tab === 'assessments' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[160px]">Barthel (0-100)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">FIM</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">Berg</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="통증 VAS" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="보행" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="낙상 위험(Berg)" /></th>
            </tr></thead>
            <tbody>
              {assessmentsIsError ? <tr><td colSpan={7} className="p-3"><QueryErrorFallback error={assessmentsError} onRetry={() => refetchAssessments()} size="compact" /></td></tr>
              : assessmentsLoading ? <LoadingRows cols={7} />
              : assessments.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="평가 기록 없음" /></td></tr>
              : assessments.map((a) => {
                const patient = a.patient as Record<string, unknown> | undefined;
                // 🔴 Barthel 0 = '전면 의존'이라는 최악의 임상 상태다 — 미평가를 최악값으로 날조하지 않는다.
                //    (정본 필드는 RehabAssessment.barthel — barthelScore 는 존재하지 않는 이름이었다)
                const barthelRaw = (a.barthel ?? a.barthelScore) as number | null | undefined;
                const barthel = typeof barthelRaw === 'number' ? barthelRaw : null;
                return (
                  <tr key={a.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                      <p className="text-[10px] text-gray-400">{(patient?.mrn as string) ?? ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      {barthel == null ? (
                        <span className="text-xs text-gray-400"><T k="미평가" /></span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${barthel}%` }} />
                          </div>
                          <span className="text-xs font-bold text-gray-900 w-8 text-right">{barthel}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-700">{((a.fim ?? a.fimScore) as number) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-700">{((a.berg ?? a.bergScore) as number) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-700">{(a.vas as number | null) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(a.gait as string | null) ?? '-'}</td>
                    <td className="px-4 py-3">
                      {(() => { const r = bergFallRisk((a.berg ?? a.bergScore) as number | null); return r
                        ? <span data-berg-risk={r} className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[r]}`}><T k={RISK_LABEL[r]} /></span>
                        : <span className="text-xs text-gray-400">-</span>; })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 치료 완료 모달 */}
      {completeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCompleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="치료 완료 기록" /></h3>
            <p className="text-sm text-gray-500">
              {(completeTarget.plan as any)?.patient?.familyName}{(completeTarget.plan as any)?.patient?.givenName} — {completeTarget.therapyType as string}
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="수행한 활동" /></label>
              <textarea value={completeForm.activities} onChange={e => setCompleteForm(f => ({ ...f, activities: e.target.value }))}
                rows={2} placeholder={tAttr('예: ROM 운동, 보행 훈련 15분, 근력 강화')}
                className="w-full border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="혈압 (BP)" /></label>
                <input value={completeForm.bp} onChange={e => setCompleteForm(f => ({ ...f, bp: e.target.value }))}
                  placeholder="120/80" className="w-full border rounded-xl px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="심박수 (HR)" /></label>
                <input value={completeForm.hr} onChange={e => setCompleteForm(f => ({ ...f, hr: e.target.value }))}
                  placeholder={tAttr('회/분')} type="number" className="w-full border rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="치료 시간(분) — 비우면 시작~완료 시각으로 잽니다" /></label>
              <input value={completeForm.duration} onChange={e => setCompleteForm(f => ({ ...f, duration: e.target.value }))}
                type="number" min={1} data-rehab-duration className="w-full border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="진행 소견" /></label>
              <textarea value={completeForm.progress} onChange={e => setCompleteForm(f => ({ ...f, progress: e.target.value }))}
                rows={2} placeholder={tAttr('환자 상태, 개선 정도, 특이사항...')}
                className="w-full border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => completeSession.mutate({
                id: completeTarget.id as string,
                body: buildRehabCompleteBody(completeForm),
              })} disabled={completeSession.isPending}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                <T k={completeSession.isPending ? '저장 중...' : '치료 완료'} />
              </button>
              <button onClick={() => setCompleteTarget(null)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
