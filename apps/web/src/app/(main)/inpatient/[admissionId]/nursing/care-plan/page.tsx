'use client';

import { Term } from '@/components/ui/term';

import { use, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Intervention {
  id: string; nicCode?: string; name: string; status: string;
  /** 🔴 이행 기록 — 종전엔 status 만 있어 "COMPLETED" 여도 누가 언제 했는지 알 수 없었다 */
  performedAt?: string | null; performedBy?: string | null;
}
interface Outcome { id: string; nocCode?: string; name: string; baselineScore?: number; targetScore?: number; currentScore?: number; status: string }
interface Diagnosis { id: string; nandaCode: string; nandaName: string; relatedFactors?: string; expectedOutcome?: string; status: string; interventions: Intervention[]; outcomes: Outcome[] }
interface Assessment { id: string; assessedAt?: string; diagnoses: Diagnosis[] }
interface CarePlan { assessments: Assessment[] }

interface CarePlanSuggestion {
  enabled: boolean; source: string; hasAssessment: boolean;
  diagnoses: { nandaCode: string; nandaName: string; relatedFactors: string; confidence: number; interventions: { nicCode: string; name: string }[] }[];
}

const DX_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: '활성', cls: 'bg-indigo-100 text-indigo-700' },
  RESOLVED: { label: '해결', cls: 'bg-gray-100 text-gray-500' },
};
const NOC_STATUS: Record<string, { label: string; cls: string }> = {
  NOT_MET: { label: '미달성', cls: 'bg-rose-100 text-rose-700' },
  PARTIALLY_MET: { label: '부분달성', cls: 'bg-amber-100 text-amber-700' },
  MET: { label: '달성', cls: 'bg-emerald-100 text-emerald-700' },
};

export default function NursingCarePlanPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['care-plan', admissionId] });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['care-plan', admissionId],
    queryFn: () => apiClient.get<{ data: CarePlan }>(`/api/v1/admissions/${admissionId}/care-plan`),
  });

  const plan = (data as { data?: { data?: CarePlan } } | undefined)?.data?.data ?? (data as { data?: CarePlan } | undefined)?.data;
  const assessment = plan?.assessments?.[0];
  const diagnoses = assessment?.diagnoses ?? [];

  // ── AI 제안 ──
  const [suggest, setSuggest] = useState<CarePlanSuggestion | null>(null);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'ready' | 'disabled' | 'error'>('idle');
  const fetchSuggest = async () => {
    setAiState('loading'); setSuggest(null);
    try {
      const res = await apiClient.get<{ data: CarePlanSuggestion }>(`/api/v1/admissions/${admissionId}/ai-care-plan`);
      const r = ((res as { data?: { data?: CarePlanSuggestion } })?.data?.data ?? (res as { data?: CarePlanSuggestion })?.data) as CarePlanSuggestion;
      setSuggest(r); setAiState('ready');
    } catch (e) {
      setAiState((e as { code?: string })?.code === 'AI_ASSIST_DISABLED' ? 'disabled' : 'error');
    }
  };

  // ── 변이 ──
  const addDiagnosis = useMutation({
    mutationFn: (s: CarePlanSuggestion['diagnoses'][number]) => (async () => {
      if (!assessment) throw new Error('간호초기평가 필요');
      const created = await apiClient.post<{ data: { id: string } }>(`/api/v1/nursing-assessments/${assessment.id}/diagnoses`, {
        nandaCode: s.nandaCode, nandaName: s.nandaName, relatedFactors: s.relatedFactors, expectedOutcome: '관련 증상 완화 및 상태 개선',
      });
      const dxId = (created as { data?: { data?: { id: string } } })?.data?.data?.id ?? (created as { data?: { id: string } })?.data?.id;
      for (const iv of s.interventions) {
        await apiClient.post(`/api/v1/nursing-diagnoses/${dxId}/interventions`, { nicCode: iv.nicCode, name: iv.name });
      }
    })(),
    onSuccess: invalidate,
  });
  const resolveDx = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/nursing-diagnoses/${id}/resolve`, {}), onSuccess: invalidate });
  /** 🔴 이행 기록 — 수행자는 보내지 않는다(서버가 인증 주체로 채운다. 본문으로 받으면 남의 이름으로 적힌다) */
  const performIntervention = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/nursing-interventions/${id}`, { status: 'COMPLETED' }),
    onSuccess: invalidate,
  });
  const addIntervention = useMutation({ mutationFn: (v: { dxId: string; name: string }) => apiClient.post(`/api/v1/nursing-diagnoses/${v.dxId}/interventions`, { name: v.name }), onSuccess: invalidate });
  const addOutcome = useMutation({ mutationFn: (v: { dxId: string; name: string; targetScore: number }) => apiClient.post(`/api/v1/nursing-diagnoses/${v.dxId}/outcomes`, { name: v.name, baselineScore: 2, targetScore: v.targetScore }), onSuccess: invalidate });
  const evaluateOutcome = useMutation({ mutationFn: (v: { id: string; currentScore: number }) => apiClient.patch(`/api/v1/nursing-outcomes/${v.id}/evaluate`, { currentScore: v.currentScore }), onSuccess: invalidate });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href={`/inpatient/${admissionId}/nursing/assessment`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600">
        ← <T k="간호 사정" />
      </Link>
      <h1 className="text-2xl font-bold text-gray-900"><T k="간호과정 (ADPIE)" /></h1>

      {isLoading ? (
        <div className="h-24 bg-gray-50 rounded-xl animate-pulse" />
      ) : !assessment ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-2">
          <p className="text-gray-900 font-semibold"><T k="간호초기평가가 필요합니다" /></p>
          <p className="text-sm text-gray-500"><T k="간호진단(NANDA)은 사정 데이터를 근거로 합니다. 먼저 사정을 작성하세요." /></p>
          <Link href={`/inpatient/${admissionId}/nursing/assessment`} className="inline-block mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"><T k="간호 사정 작성" /></Link>
        </div>
      ) : (
        <>
          {/* AI 제안 패널 */}
          <div className="relative rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
            <span className="absolute left-0 top-0 h-full w-1 rounded-l bg-gradient-to-b from-amber-400 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-amber-800">✦ {AI_ORIGIN_TEXT} <T k="간호과정 제안" /></span>
              {aiState === 'idle' && <button onClick={fetchSuggest} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs hover:bg-amber-700"><T k="제안 받기" /></button>}
              {aiState === 'loading' && <span className="flex items-center gap-1.5 text-xs text-amber-700"><span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" /><T k="분석 중…" /></span>}
              {(aiState === 'ready' || aiState === 'error' || aiState === 'disabled') && <button onClick={fetchSuggest} className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs hover:bg-amber-100"><T k="다시" /></button>}
            </div>
            {/* 🔴 AI 표기(AI_ORIGIN_TEXT)를 문장 가운데 끼운 자리 — 어순이 언어마다 달라 조각내 번역하면
                뜻이 무너진다. 동적 조합이라 이번 스코프 밖(원문 유지). */}
            {aiState === 'disabled' && <p className="mt-2 text-[11px] text-gray-500">간호 {AI_ORIGIN_TEXT} 보조가 비활성 상태입니다(관리자 설정 필요).</p>}
            {aiState === 'error' && <p className="mt-2 text-[11px] text-rose-600"><T k="제안을 불러오지 못했습니다." /></p>}
            {aiState === 'ready' && suggest && (
              suggest.diagnoses.length === 0 ? (
                <p className="mt-2 text-[11px] text-gray-500"><T k="사정 데이터 기준 제안할 간호진단이 없습니다(정상 범위). 표준코드에서 직접 선택하세요." /></p>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-gray-500"><T k="간호 사정·EWS·낙상 근거로 표준코드(NANDA-NIC)에서 제안합니다. 검토 후 추가하세요." /></p>
                  {suggest.diagnoses.map((s) => (
                    <div key={s.nandaCode} className="bg-white rounded-lg border border-amber-200 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">NANDA {s.nandaCode}</span>
                        <span className="text-sm font-semibold text-gray-800">{s.nandaName}</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px]">신뢰도 {Math.round(s.confidence * 100)}<Unit>%</Unit></span>
                        <button onClick={() => addDiagnosis.mutate(s)} disabled={addDiagnosis.isPending} className="ml-auto min-h-[44px] px-3 py-2 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"><T k="진단으로 추가" /></button>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500"><T k="관련요인" />: {s.relatedFactors}</p>
                      {s.interventions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.interventions.map((iv) => (
                            <span key={iv.nicCode} className="px-1.5 py-0.5 rounded-full bg-white border border-emerald-200 text-[10px] text-emerald-700">NIC {iv.nicCode} {iv.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400"><T k="제안은 표준코드에서만 선택됩니다. 최종 진단·중재 확정과 책임은 간호사에게 있습니다." /></p>
                </div>
              )
            )}
          </div>

          {/* 표준코드에서 직접 추가(NANDA 마스터) — AI 제안이 비거나 추가 진단 필요 시 */}
          <NandaCodePicker onAdd={(code, nameKo) => addDiagnosis.mutate({ nandaCode: code, nandaName: nameKo, relatedFactors: '(수동 추가)', confidence: 0, interventions: [] })} />

          {/* 진단 목록 */}
          <div className="space-y-3">
            {diagnoses.length === 0 ? (
              <p className="text-sm text-gray-400 px-1"><T k="등록된 간호진단이 없습니다. 위 제안에서 추가하거나 직접 작성하세요." /></p>
            ) : (
              diagnoses.map((dx) => <DiagnosisCard key={dx.id} dx={dx}
                onResolve={() => resolveDx.mutate(dx.id)}
                onAddIntervention={(name) => addIntervention.mutate({ dxId: dx.id, name })}
                onPerform={(ivId) => performIntervention.mutate(ivId)}
                onAddOutcome={(name, target) => addOutcome.mutate({ dxId: dx.id, name, targetScore: target })}
                onEvaluate={(id, score) => evaluateOutcome.mutate({ id, currentScore: score })}
              />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NandaCodePicker({ onAdd }: { onAdd: (code: string, nameKo: string) => void }) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ code: string; nameKo: string; nameEn?: string | null; domain?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const search = async (term: string) => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: { code: string; nameKo: string; nameEn?: string | null; domain?: string }[] }>(`/api/v1/nursing-codes`, { system: 'NANDA', q: term || undefined, limit: 20 });
      const d = ((res as { data?: { data?: { code: string; nameKo: string; nameEn?: string | null; domain?: string }[] } })?.data?.data) ?? (res as { data?: { code: string; nameKo: string; nameEn?: string | null; domain?: string }[] })?.data ?? [];
      setRows(d);
    } catch { setRows([]); } finally { setLoading(false); }
  };
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      {!open ? (
        <button onClick={() => { setOpen(true); search(''); }} className="text-sm text-indigo-600 hover:text-indigo-700"><T k="+ 표준코드(NANDA)에서 진단 추가" /></button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-1">
            <input value={q} onChange={(e) => { setQ(e.target.value); search(e.target.value); }} placeholder={tAttr('NANDA 검색(예: 통증, 낙상)…')} className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm" autoFocus />
            <button onClick={() => setOpen(false)} className="px-2 py-1 text-gray-400 text-xs"><T k="닫기" /></button>
          </div>
          <div className="max-h-48 overflow-auto space-y-1">
            {loading ? <p className="text-xs text-gray-400"><T k="검색 중…" /></p> : rows.length === 0 ? <p className="text-xs text-gray-400"><T k="결과 없음" /></p> : rows.map((r) => (
              <div key={r.code} className="flex items-center gap-2 text-xs py-1 border-b border-gray-50 last:border-0">
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">{r.code}</span>
                <span className="flex-1 text-gray-700"><Term nameKo={r.nameKo} nameEn={r.nameEn} />{r.domain ? <span className="text-gray-400"> · {r.domain}</span> : null}</span>
                <button onClick={() => { onAdd(r.code, r.nameKo); setOpen(false); setQ(''); }} className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] hover:bg-emerald-700"><T k="추가" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DiagnosisCard({ dx, onResolve, onAddIntervention, onAddOutcome, onEvaluate, onPerform }: {
  dx: Diagnosis;
  onResolve: () => void;
  onAddIntervention: (name: string) => void;
  /** 중재 이행 기록 — 수행자는 서버가 인증 주체에서 채운다(본문으로 보내지 않는다) */
  onPerform?: (interventionId: string) => void;
  onAddOutcome: (name: string, target: number) => void;
  onEvaluate: (id: string, score: number) => void;
}) {
  const tAttr = useTAttr();
  const [ivName, setIvName] = useState('');
  const [ocName, setOcName] = useState('');
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">NANDA {dx.nandaCode}</span>
        <span className="text-sm font-semibold text-gray-800">{dx.nandaName}</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${DX_STATUS[dx.status]?.cls ?? ''}`}><T k={DX_STATUS[dx.status]?.label ?? dx.status} /></span>
        {dx.status === 'ACTIVE' && <button onClick={onResolve} className="ml-auto px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] hover:bg-gray-200"><T k="해결" /></button>}
      </div>
      {dx.relatedFactors && <p className="text-[11px] text-gray-500"><T k="관련요인" />: {dx.relatedFactors}</p>}

      {/* 중재(NIC) */}
      <div className="pl-2 border-l-2 border-emerald-100 space-y-1">
        <p className="text-[10px] font-semibold text-emerald-700"><T k="중재 (NIC)" /></p>
        {dx.interventions.map((iv) => (
          <div key={iv.id} className="flex items-start justify-between gap-2">
            <p className="text-xs text-gray-700 flex-1">
              • {iv.nicCode ? `[${iv.nicCode}] ` : ''}{iv.name}
              {/* 🔴 이행은 상태가 아니라 기록이다 — 수행 시각이 없으면 "완료"라고 말하지 않는다 */}
              {iv.performedAt
                ? <span className="text-emerald-700"> · <T k="이행" /> {kdate(new Date(iv.performedAt), 'datetime')}</span>
                : <span className="text-gray-400"> · <T k="미이행" /></span>}
            </p>
            {!iv.performedAt && (
              <button
                onClick={() => onPerform?.(iv.id)}
                className="shrink-0 min-h-[44px] px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-medium hover:bg-emerald-100">
                <T k="이행 기록" />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-1">
          <input value={ivName} onChange={(e) => setIvName(e.target.value)} placeholder={tAttr('중재 추가…')} className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" />
          <button onClick={() => { if (ivName.trim()) { onAddIntervention(ivName.trim()); setIvName(''); } }} className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700">+</button>
        </div>
      </div>

      {/* 결과(NOC) */}
      <div className="pl-2 border-l-2 border-purple-100 space-y-1">
        <p className="text-[10px] font-semibold text-purple-700"><T k="결과 (NOC · 1–5 Likert)" /></p>
        {dx.outcomes.map((oc) => (
          <div key={oc.id} className="flex items-center gap-2 text-xs text-gray-700">
            <span className="flex-1">• {oc.name} <span className="text-gray-400">{/* 🔴 '기준'은 이미 'As of'(기준 시점)로 등재돼 있다 — NOC 은 **baseline 점수**라 문맥 키 */}{tAttr('기준@척도')}{oc.baselineScore ?? '-'}/{tAttr('목표')}{oc.targetScore ?? '-'}/{tAttr('현재')}{oc.currentScore ?? '-'}</span></span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${NOC_STATUS[oc.status]?.cls ?? ''}`}><T k={NOC_STATUS[oc.status]?.label ?? oc.status} /></span>
            <select defaultValue="" onChange={(e) => { if (e.target.value) onEvaluate(oc.id, Number(e.target.value)); }} className="px-1 py-0.5 border border-gray-200 rounded text-[10px]">
              <option value="">{tAttr('평가')}</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        ))}
        <div className="flex gap-1">
          <input value={ocName} onChange={(e) => setOcName(e.target.value)} placeholder={tAttr('기대결과 추가…')} className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" />
          <button onClick={() => { if (ocName.trim()) { onAddOutcome(ocName.trim(), 5); setOcName(''); } }} className="px-2 py-1 rounded bg-purple-600 text-white text-[11px] hover:bg-purple-700">+</button>
        </div>
      </div>
    </div>
  );
}
