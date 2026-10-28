'use client';

import { Fragment, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs } from '@/lib/ui-settings';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { DoseSummaryText, PlanFractionsPanel, doseSummaryOf } from './radiation-dose';
import { PlanActions } from './radiation-plan-actions';
import { TOXICITY_ITEMS, buildToxicityBody, emptyToxicityForm, toxicityFormReady, type ToxicityForm } from './radiation-toxicity';

// 🔴 상태 라벨은 shared 정본(StatusBadge domain) 하나뿐이다 — 종전 로컬 표는 실제 값
//    (APPROVED·IN_TREATMENT·DELIVERING)을 몰라 치료 중인 계획이 영문 회색으로 떴다.
const TOXICITY_GRADE_COLOR: Record<number, string> = { 0: 'bg-emerald-100 text-emerald-700', 1: 'bg-yellow-100 text-yellow-700', 2: 'bg-orange-100 text-orange-700', 3: 'bg-red-100 text-red-700', 4: 'bg-red-800 text-white' };

type RadiationTab = 'plans' | 'today' | 'toxicity';

export default function RadiationPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [tab, setTab] = useState<RadiationTab>('plans');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [showToxicityModal, setShowToxicityModal] = useState(false);
  const [deliverTarget, setDeliverTarget] = useState<{ id: string; fractionNumber: number | null; patientName: string; perFraction: number | null } | null>(null);
  const [deliverForm, setDeliverForm] = useState({ deliveredDose: '', setupVerified: false, coneBeamCT: false });
  const [toxForm, setToxForm] = useState<ToxicityForm>(emptyToxicityForm);

  const deliverFraction = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.patch(`/api/v1/radiation/fractions/${id}/deliver`, body),
    onSuccess: () => {
      toast.success(tAttr('조사 완료'));
      setDeliverTarget(null);
      qc.invalidateQueries({ queryKey: ['radiation-fractions-today'] });
      qc.invalidateQueries({ queryKey: ['radiation-plans'] });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('조사 완료 실패')),
  });

  const addToxicity = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/radiation/plans/${selectedPlanId}/toxicity`, body),
    onSuccess: () => { toast.success(tAttr('부작용 기록 완료')); qc.invalidateQueries({ queryKey: ['radiation-toxicity'] }); setShowToxicityModal(false); },
    onError: () => toast.error(tAttr('부작용 기록 실패')),
  });

  const { data: plansData, isLoading: plansLoading, isError, error, refetch } = useQuery({
    queryKey: ['radiation-plans'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/radiation/plans'),
    enabled: tab === 'plans' || tab === 'toxicity',
  });

  const { data: todayData, isLoading: todayLoading, isError: todayIsError, error: todayError, refetch: refetchToday } = useQuery({
    queryKey: ['radiation-fractions-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/radiation/fractions/today'),
    enabled: tab === 'today',
    refetchInterval: pollMs('fast'),
  });

  const { data: toxicityData, isLoading: toxicityLoading, isError: toxicityIsError, error: toxicityError, refetch: refetchToxicity } = useQuery({
    queryKey: ['radiation-toxicity', selectedPlanId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/radiation/plans/${selectedPlanId}/toxicity`),
    enabled: tab === 'toxicity' && !!selectedPlanId,
  });

  const plans: Record<string, unknown>[] = (() => { const r = plansData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const fractions: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const toxicities: Record<string, unknown>[] = (() => { const r = toxicityData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  const GradeCell = ({ grade }: { grade: number | null | undefined }) => {
    // 🔴 미평가를 'Grade 0'(독성 없음·초록)으로 단정하지 않는다 — 방사선 피부염·점막염 미평가가
    //    "정상"으로 읽힌다(2026-08-13 W4).
    if (typeof grade !== 'number') {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500"><T k="미평가" /></span>;
    }
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TOXICITY_GRADE_COLOR[grade] ?? 'bg-gray-100'}`}>Grade {grade}</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="방사선종양" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="방사선 치료 계획 / 분할 조사 / 부작용 관리" /></p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'plans' as RadiationTab, label: '치료현황' },
          { key: 'today' as RadiationTab, label: '오늘일정' },
          { key: 'toxicity' as RadiationTab, label: '부작용추적' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* 치료현황 */}
      {tab === 'plans' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="기법" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="선량/분할" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[160px]"><T k="진행률" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[170px]"><T k="누적선량" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
            </tr></thead>
            <tbody>
              {plansLoading ? <LoadingRows cols={7} />
              : plans.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="치료 계획 없음" /></td></tr>
              : plans.map((p) => {
                const patient = p.patient as Record<string, unknown> | undefined;
                // 🔴 서버는 `fractions: [{status}]` 를 주는데 화면은 없는 `deliveredFractions` 를 읽어
                //    **진행률이 항상 0%** 였다(P11). 조사된 분획을 직접 센다.
                const fracList = Array.isArray(p.fractions) ? (p.fractions as { status?: string }[]) : [];
                const delivered = fracList.filter((f) => f.status === 'DELIVERED').length;
                const total = (p.totalFractions as number) ?? 0;
                const pct = total > 0 ? Math.round((delivered / total) * 100) : null;
                const expanded = expandedPlanId === (p.id as string);
                return (
                  <Fragment key={p.id as string}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                      <p className="text-[10px] text-gray-400">{(patient?.mrn as string) ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{(p.diagnosis as string) ?? '-'}</td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 whitespace-nowrap">{(p.technique as string) ?? '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{p.totalDose != null ? String(p.totalDose) : '-'}Gy / {total}fx</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        {/* 분할 수를 모르면 비율을 지어내지 않는다 */}
                        <span className="text-[10px] font-bold text-gray-600 w-16 text-right whitespace-nowrap">
                          {pct === null ? <Tf k="{횟수}회" params={{ 횟수: delivered }} /> : <>{delivered}/{total} ({pct}<Unit>%</Unit>)</>}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <DoseSummaryText summary={doseSummaryOf(p)} />
                      <button type="button" onClick={() => setExpandedPlanId(expanded ? null : (p.id as string))} aria-expanded={expanded}
                        className="block mt-1 text-[10px] text-blue-600 hover:underline"><T k={expanded ? '분할 기록 닫기' : '분할 기록'} /></button>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge domain="radiationPlan" status={(p.status as string) ?? ''} className="text-[10px] font-bold" />
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-gray-50/60"><td colSpan={7} className="px-6 py-3"><PlanActions plan={p} /><PlanFractionsPanel planId={p.id as string} /></td></tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 오늘일정 */}
      {tab === 'today' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="분할 #" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[150px]"><T k="선량" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[120px]"><T k="치료실/장비" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="액션" /></th>
            </tr></thead>
            <tbody>
              {todayIsError ? <tr><td colSpan={6} className="px-4 py-3"><QueryErrorFallback error={todayError} onRetry={refetchToday} size="compact" /></td></tr>
              : todayLoading ? <LoadingRows cols={6} />
              : fractions.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="오늘 조사 일정 없음" /></td></tr>
              : fractions.map((f) => {
                // 🔴 서버는 `plan.patient`·`plan.fractionDose`·`plan.machine` 로 실어 보내는데
                //    화면은 `f.patient`·`f.dose`·`f.room` 을 읽어 **환자·선량·장비 칸이 늘 비어** 있었다(P11).
                const plan = f.plan as Record<string, unknown> | undefined;
                const patient = plan?.patient as Record<string, unknown> | undefined;
                const perFraction = plan?.fractionDose != null ? Number(plan.fractionDose) : null;
                const status = f.status as string;
                return (
                  <tr key={f.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                      <p className="text-[10px] text-gray-400">{(patient?.mrn as string) ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(f.fractionNumber as number) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {perFraction != null ? `${perFraction}Gy` : <T k="미기재" />}
                      {/* 조사 전에 지금까지의 누적을 본다(서버 요약 · 기록된 조사선량 합) */}
                      <div className="text-[10px] text-gray-500"><T k="누적" />: <DoseSummaryText summary={doseSummaryOf(f)} /></div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(plan?.machine as string) ?? <T k="미기재" />}</td>
                    <td className="px-4 py-3">
                      <StatusBadge domain="radiationFraction" status={status} className="text-[10px] font-bold" />
                    </td>
                    <td className="px-4 py-3">
                      {/* 🔴 종전엔 빈 body 를 보내 서버 검증(조사선량 필수)에 걸려 **100% 실패**했다.
                          실제 조사선량을 받는다 — 처방 분할선량을 채워두되 확인은 사람이 한다. */}
                      {status === 'SCHEDULED' && (
                        <button onClick={() => setDeliverTarget({
                          id: f.id as string,
                          fractionNumber: (f.fractionNumber as number) ?? null,
                          patientName: `${(patient?.familyName as string) ?? ''}${(patient?.givenName as string) ?? ''}`,
                          perFraction,
                        })}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"><T k="조사 완료" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 부작용추적 */}
      {tab === 'toxicity' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
            <div className="flex items-center">
              <label className="text-sm font-medium text-gray-700 mr-3"><T k="치료 계획 선택" /></label>
            <select
              value={selectedPlanId ?? ''}
              onChange={(e) => setSelectedPlanId(e.target.value || null)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{tAttr('-- 선택 --')}</option>
              {plans.map((p) => {
                const patient = p.patient as Record<string, unknown> | undefined;
                return <option key={p.id as string} value={p.id as string}>{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''} - {(p.diagnosis as string) ?? ''}</option>;
              })}
            </select>
            </div>
            {selectedPlanId && (
              <button onClick={() => { setShowToxicityModal(true); setToxForm(emptyToxicityForm()); }}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">
                + <T k="부작용 기록" />
              </button>
            )}
          </div>

          {selectedPlanId && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="주차" /></th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="피부" /></th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="점막염" /></th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="피로" /></th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="오심" /></th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="통증" /></th>
                </tr></thead>
                <tbody>
                  {toxicityIsError ? <tr><td colSpan={6} className="px-4 py-3"><QueryErrorFallback error={toxicityError} onRetry={refetchToxicity} size="compact" /></td></tr>
                  : toxicityLoading ? <LoadingRows cols={6} />
                  : toxicities.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="부작용 기록 없음" /></td></tr>
                  : toxicities.map((t) => (
                    <tr key={t.id as string ?? (t.week as number)} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">Week {(t.week as number) ?? '-'}</td>
                      <td className="px-4 py-3 text-center"><GradeCell grade={t.skinGrade as number | null} /></td>
                      <td className="px-4 py-3 text-center"><GradeCell grade={t.mucositisGrade as number | null} /></td>
                      <td className="px-4 py-3 text-center"><GradeCell grade={t.fatigueGrade as number | null} /></td>
                      <td className="px-4 py-3 text-center"><GradeCell grade={t.nauseaGrade as number | null} /></td>
                      <td className="px-4 py-3 text-center"><GradeCell grade={t.painGrade as number | null} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 부작용 기록 모달 */}
      {showToxicityModal && selectedPlanId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowToxicityModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="부작용 기록" /></h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="치료 주차" /></label>
              <input value={toxForm.week ?? ''} onChange={e => setToxForm(f => ({ ...f, week: e.target.value === '' ? null : Number(e.target.value) }))}
                type="number" min={1} className="w-full border rounded-xl px-3 py-2 text-sm" />
            </div>
            {TOXICITY_ITEMS.map(item => (
              <div key={item.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1"><Tf k="{항목} (Grade 0~4)" params={{ 항목: <T k={item.label} /> }} /></label>
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3, 4].map(g => (
                    <button key={g} type="button" aria-pressed={toxForm[item.key] === g} onClick={() => setToxForm(f => ({ ...f, [item.key]: f[item.key] === g ? null : g }))}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                        toxForm[item.key] === g
                          ? g === 0 ? 'bg-emerald-600 text-white border-emerald-600' : g <= 2 ? 'bg-amber-500 text-white border-amber-500' : 'bg-red-600 text-white border-red-600'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}>{g}</button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="비고" /></label>
              <textarea value={toxForm.notes} onChange={e => setToxForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder={tAttr('추가 증상, 관리 조치...')} className="w-full border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => addToxicity.mutate(buildToxicityBody(toxForm))} disabled={addToxicity.isPending || !toxicityFormReady(toxForm)} data-tox-save
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                <T k={addToxicity.isPending ? '저장 중...' : '부작용 기록'} /></button>
              <button onClick={() => setShowToxicityModal(false)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 조사 완료 — 실제 조사선량을 받는다. 서버는 처방 분할선량과의 이탈·누적 총선량을 검증한다. */}
      {deliverTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900"><T k="조사 완료 기록" /></h3>
              <p className="text-xs text-gray-500 mt-1">
                {deliverTarget.patientName || <T k="환자 미상" />}
                {deliverTarget.fractionNumber != null && <>{' · '}<Tf k="분할 #{번호}" params={{ 번호: deliverTarget.fractionNumber }} /></>}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <T k="실제 조사선량 (Gy)" />
                {deliverTarget.perFraction != null && <Tf className="ml-1 text-gray-400" k="· 처방 {선량}Gy" params={{ 선량: deliverTarget.perFraction }} />}
              </label>
              <input
                type="number" step="0.01" min="0"
                value={deliverForm.deliveredDose}
                onChange={(e) => setDeliverForm((f) => ({ ...f, deliveredDose: e.target.value }))}
                placeholder={deliverTarget.perFraction != null ? String(deliverTarget.perFraction) : tAttr('조사선량')}
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-gray-400"><T k="처방과 다르면 서버가 이탈을 검증합니다 — 실제 값을 그대로 입력하세요." /></p>
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={deliverForm.setupVerified}
                  onChange={(e) => setDeliverForm((f) => ({ ...f, setupVerified: e.target.checked }))} />
                <T k="셋업 확인" />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={deliverForm.coneBeamCT}
                  onChange={(e) => setDeliverForm((f) => ({ ...f, coneBeamCT: e.target.checked }))} />
                <T k="CBCT 시행" />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => deliverFraction.mutate({
                  id: deliverTarget.id,
                  body: {
                    deliveredDose: parseFloat(deliverForm.deliveredDose),
                    setupVerified: deliverForm.setupVerified,
                    coneBeamCT: deliverForm.coneBeamCT,
                  },
                })}
                disabled={deliverFraction.isPending || !(parseFloat(deliverForm.deliveredDose) > 0)}
                className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                <T k={deliverFraction.isPending ? '기록 중...' : '조사 완료'} />
              </button>
              <button onClick={() => { setDeliverTarget(null); setDeliverForm({ deliveredDose: '', setupVerified: false, coneBeamCT: false }); }}
                className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
