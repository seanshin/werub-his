'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { QrImage } from '@/components/ui/QrImage';
import { AI_ORIGIN_TEXT, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { T, useTAttr, Data } from '@/components/ui/i18n-text';

/* ---------- Types ---------- */

interface SurveyQuestion {
  id: string;
  text: string;
  type: 'likert5' | 'nps' | 'text';
}

interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  targetDepartment: string | null;
  questions: SurveyQuestion[];
  isActive: boolean;
  createdAt: string;
}

interface DepartmentStat {
  department: string;
  nps: number | null;
  responseCount: number;
  itemScores: { questionId: string; questionText: string; avgScore: number }[];
}

interface TrendPoint {
  period: string;
  nps: number | null;
  responseCount: number;
  avgScore: number | null;
  scoredCount?: number;
}

interface SentimentResult {
  positive: number | null;
  neutral: number | null;
  negative: number | null;
  scoredCount: number;
  commentCount: number;
  topPositive: string[];
  topNegative: string[];
  aiSummary: string | null;
  /** 🔴 조회에 실패한 응답 원장 — 비어 있지 않으면 아래 수치는 불완전한 표본 위의 값이다 */
  unavailable?: string[];
}

const SENTIMENT_SOURCE_LABEL: Record<string, string> = {
  SURVEY_DISPATCH: '설문 발송 응답',
  SATISFACTION_SURVEY: '만족도 코멘트',
};

interface BenchmarkItem {
  category: string;
  hospital: number;
  national: number;
  gap: number;
}

/** 🔴 출처 없는 전국 평균은 표시하지 않는다 — 서버가 available 로 알린다. */
interface BenchmarkResult {
  available: boolean;
  reason?: string;
  source?: string;
  items: BenchmarkItem[];
}

/* ---------- Constants ---------- */

const TABS = [
  { key: 'survey', label: '설문 관리' },
  { key: 'dispatches', label: '발송 현황' },
  { key: 'department', label: '부서별 분석' },
  { key: 'trend', label: '추이 분석' },
  { key: 'benchmark', label: '벤치마크' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface SurveyDispatchItem { id: string; templateName: string; patientName: string | null; department: string | null; channel: string; trigger: string; status: string; npsScore: number | null; avgScore: number | null; createdAt: string; submittedAt: string | null; token: string }

const NPS_COLOR = (nps: number) =>
  nps >= 70 ? 'text-emerald-600' : nps >= 50 ? 'text-blue-600' : nps >= 30 ? 'text-amber-600' : 'text-red-600';

const NPS_BG = (nps: number) =>
  nps >= 70 ? 'bg-emerald-50' : nps >= 50 ? 'bg-blue-50' : nps >= 30 ? 'bg-amber-50' : 'bg-red-50';

const PRIORITY_STYLE: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-gray-100 text-gray-600',
};

function scoreBar(score: number, max: number = 5) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 w-8 text-right">{score.toFixed(1)}</span>
    </div>
  );
}

/* ---------- Component ---------- */

export default function SatisfactionPage() {
  const tAttr = useTAttr();
  const [tab, setTab] = useState<TabKey>('survey');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDept, setNewDept] = useState('');
  // 발송 모달
  const [dispatchFor, setDispatchFor] = useState<SurveyTemplate | null>(null);
  const [dChannel, setDChannel] = useState<'PORTAL' | 'TABLET' | 'SMS'>('PORTAL');
  const [dPatient, setDPatient] = useState('');
  const [dTrigger, setDTrigger] = useState<'MANUAL' | 'DISCHARGE'>('MANUAL');
  const [dispatchResult, setDispatchResult] = useState<{ url: string; channel: string } | null>(null);
  const qc = useQueryClient();

  /* ── Queries ── */

  const { data: templatesData, isLoading: loadingTemplates, isError, error, refetch } = useQuery({
    queryKey: ['satisfaction-templates'],
    queryFn: () => apiClient.get<{ data: SurveyTemplate[] }>('/api/v1/satisfaction/templates'),
  });

  const { data: deptStatsData, isLoading: loadingDept } = useQuery({
    queryKey: ['satisfaction-dept-stats'],
    queryFn: () => apiClient.get<{ data: DepartmentStat[] }>('/api/v1/satisfaction/stats/department'),
    enabled: tab === 'department',
  });

  const { data: trendData, isLoading: loadingTrend, isError: trendError, error: trendErrorObj, refetch: refetchTrend } = useQuery({
    queryKey: ['satisfaction-trend'],
    queryFn: () => apiClient.get<{ data: TrendPoint[] }>('/api/v1/satisfaction/stats/trend'),
    enabled: tab === 'trend',
  });

  const { data: sentimentData, isLoading: loadingSentiment, refetch: refetchSentiment } = useQuery({
    queryKey: ['satisfaction-sentiment'],
    queryFn: () => apiClient.get<{ data: SentimentResult }>('/api/v1/satisfaction/stats/sentiment'),
    enabled: tab === 'trend',
  });

  const { data: benchmarkData, isLoading: loadingBenchmark } = useQuery({
    queryKey: ['satisfaction-benchmark'],
    queryFn: () => apiClient.get<{ data: BenchmarkResult }>('/api/v1/satisfaction/benchmark'),
    enabled: tab === 'benchmark',
  });

  /* ── Mutations ── */

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string; targetDepartment?: string; questions: { text: string; type: 'likert5' | 'nps' | 'text' }[] }) =>
      apiClient.post('/api/v1/satisfaction/templates', body),
    onSuccess: () => {
      toast.success('설문 템플릿이 생성되었습니다.');
      qc.invalidateQueries({ queryKey: ['satisfaction-templates'] });
      setShowCreateModal(false);
      setNewName('');
      setNewDesc('');
      setNewDept('');
    },
    onError: () => toast.error('템플릿 생성에 실패했습니다.'),
  });

  const dispatchMutation = useMutation({
    mutationFn: (body: { templateId: string; channel: string; patientName?: string; trigger: string }) =>
      apiClient.post<{ data: { url: string; channel: string } }>('/api/v1/satisfaction/dispatch', body),
    onSuccess: (res) => {
      const data = (res as { data: { url: string; channel: string } })?.data;
      const full = `${window.location.origin}${data.url}`;
      setDispatchResult({ url: full, channel: data.channel });
      setDispatchFor(null);
      qc.invalidateQueries({ queryKey: ['survey-dispatches'] });
      toast.success('설문이 발송되었습니다.');
    },
    onError: () => toast.error('설문 발송에 실패했습니다.'),
  });

  const { data: dispatchesData } = useQuery({
    queryKey: ['survey-dispatches'],
    queryFn: () => apiClient.get<{ data: SurveyDispatchItem[] }>('/api/v1/satisfaction/dispatches'),
    enabled: tab === 'dispatches',
  });

  /* ── Data extraction ── */

  const templates: SurveyTemplate[] = (() => {
    const raw = templatesData?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as Record<string, unknown>)?.data as SurveyTemplate[] ?? [];
  })();

  const deptStats: DepartmentStat[] = (() => {
    const raw = deptStatsData?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as Record<string, unknown>)?.data as DepartmentStat[] ?? [];
  })();

  const trend: TrendPoint[] = (() => {
    const raw = trendData?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as Record<string, unknown>)?.data as TrendPoint[] ?? [];
  })();

  const sentiment: SentimentResult | null = (() => {
    const raw = sentimentData?.data as unknown as Record<string, unknown> | undefined;
    if (!raw) return null;
    // 🔴 `positive` 는 표본이 없으면 null 이라 값 타입으로 껍질을 판별하면 **표본 부재·조회 실패가
    //    통째로 null 로 접힌다**(= EmptyState). 항상 존재하는 키로 판별한다.
    if ('scoredCount' in raw) return raw as unknown as SentimentResult;
    return (raw.data as SentimentResult) ?? null;
  })();

  const benchmark: BenchmarkResult | null = (() => {
    const raw = benchmarkData?.data as unknown as Record<string, unknown> | undefined;
    if (!raw) return null;
    if (typeof raw.available === 'boolean') return raw as unknown as BenchmarkResult;
    return (raw.data as BenchmarkResult) ?? null;
  })();

  /* ── Handlers ── */

  const handleCreate = () => {
    if (!newName.trim()) { toast.error('설문명을 입력해주세요.'); return; }
    createMutation.mutate({
      name: newName,
      description: newDesc,
      targetDepartment: newDept || undefined,
      questions: [
        { text: '접수 편리성', type: 'likert5' },
        { text: '대기 시간', type: 'likert5' },
        { text: '의료진 친절도', type: 'likert5' },
        { text: '전반적 만족도 (NPS)', type: 'nps' },
        { text: '개선 의견', type: 'text' },
      ],
    });
  };

  /* ── Render helpers ── */

  const dispatches: SurveyDispatchItem[] = Array.isArray(dispatchesData?.data) ? dispatchesData!.data : [];
  const renderDispatchesTab = () => {
    const CH: Record<string, string> = { PORTAL: '📱 포털', TABLET: '📋 태블릿', SMS: '✉️ SMS', KIOSK: '🖥 키오스크' };
    // 상태 라벨(STL)·채널 라벨(CH)은 데이터 불변 — 렌더에서만 <T> 를 거친다
    const ST: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-700', COMPLETED: 'bg-emerald-100 text-emerald-700', EXPIRED: 'bg-gray-100 text-gray-500' };
    const STL: Record<string, string> = { PENDING: '대기', COMPLETED: '완료', EXPIRED: '만료' };
    return (
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="발송 현황" /></h3>
        {dispatches.length === 0 ? (
          <EmptyState icon="📋" title="발송된 설문이 없습니다." hint="설문 관리에서 발송하세요." />
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr><th className="text-left px-4 py-2.5"><T k="설문" /></th><th className="text-left px-4 py-2.5"><T k="대상@수신자" /></th><th className="px-4 py-2.5"><T k="채널" /></th><th className="px-4 py-2.5"><T k="상태" /></th><th className="px-4 py-2.5"><T k="점수" /></th><th className="px-4 py-2.5"><T k="발송일" /></th></tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dispatches.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{d.templateName}{d.trigger === 'DISCHARGE' && <span className="ml-1 text-[10px] text-teal-600">·<T k="퇴원" /></span>}</td>
                    <td className="px-4 py-2.5 text-gray-600">{d.patientName ?? '-'} <span className="text-gray-400 text-xs">{d.department ?? ''}</span></td>
                    <td className="px-4 py-2.5 text-center text-xs"><T k={CH[d.channel] ?? d.channel} /></td>
                    <td className="px-4 py-2.5 text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full ${ST[d.status]}`}><T k={STL[d.status] ?? d.status} /></span></td>
                    <td className="px-4 py-2.5 text-center text-gray-700">{d.status === 'COMPLETED' ? `${d.avgScore ?? '-'}${d.npsScore != null ? ` · NPS ${d.npsScore}` : ''}` : '-'}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-400">{kdate(new Date(d.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderSurveyTab = () => (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900"><T k="설문 템플릿" /></h3>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <T k="+ 새 설문 생성" />
          </button>
        </div>
      </div>

      {loadingTemplates ? (
        <div className="text-center py-12 text-gray-500"><T k="불러오는 중..." /></div>
      ) : (
        <div className="grid gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-semibold text-gray-900">{t.name}</h4>
                  <p className="text-sm text-gray-500 mt-0.5">{t.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {t.targetDepartment && (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">{t.targetDepartment}</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${t.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    <T k={t.isActive ? '활성' : '비활성'} />
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-400">
                  문항 {t.questions.length}개 | 생성일 {kdate(new Date(t.createdAt))}
                </div>
                <button
                  onClick={() => { setDispatchFor(t); setDChannel('PORTAL'); setDPatient(''); setDTrigger('MANUAL'); }}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <T k="📤 발송" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4"><T k="새 설문 템플릿" /></h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700"><T k="설문명 *" /></label>
                <input value={newName} onChange={e => setNewName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('예: 외래 만족도 조사')} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700"><T k="설명" /></label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('설문 목적 및 대상')} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700"><T k="대상 부서 (선택)" /></label>
                <input value={newDept} onChange={e => setNewDept(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('비워두면 전체 부서')} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><T k="취소" /></button>
              <button onClick={handleCreate} disabled={createMutation.isPending} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="생성" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderDepartmentTab = () => (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="부서별 NPS 및 항목 점수" /></h3>
      {loadingDept ? (
        <div className="text-center py-12 text-gray-500"><T k="불러오는 중..." /></div>
      ) : deptStats.length === 0 ? (
        <EmptyState icon="📊" title="완료된 설문 응답이 없습니다." hint="응답이 쌓이면 부서별 NPS와 항목 점수가 표시됩니다." />
      ) : (
        <div className="grid gap-4">
          {deptStats.map(dept => (
            <div key={dept.department} className="bg-white rounded-2xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h4 className="font-semibold text-gray-900">{dept.department}</h4>
                  <span className="text-xs text-gray-400"><T k="응답" /> {dept.responseCount}<Unit>건</Unit></span>
                </div>
                {/* 🔴 2026-10-08 — 점수 응답 0 이면 서버가 nps:null(산출 불가)을 준다 — NPS 0 으로 그리지 않는다 */}
                {dept.nps == null ? (
                  <div className="px-3 py-1 rounded-full text-sm font-bold bg-gray-50 text-gray-400" data-nps-unavailable>NPS {RATIO_UNAVAILABLE}</div>
                ) : (
                  <div className={`px-3 py-1 rounded-full text-sm font-bold ${NPS_BG(dept.nps)} ${NPS_COLOR(dept.nps)}`}>
                    NPS {dept.nps}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {dept.itemScores.map(item => (
                  <div key={item.questionId} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-40 shrink-0">{item.questionText}</span>
                    {scoreBar(item.avgScore)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTrendTab = () => (
    <div className="space-y-6">
      {/* Monthly Trend */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="월별 만족도 추이" /></h3>
        {loadingTrend ? (
          <div className="text-center py-12 text-gray-500"><T k="불러오는 중..." /></div>
        ) : trendError ? (
          // 🔴 조회 실패를 "응답이 없습니다"로 말하지 않는다(서버가 `.catch(()=>[])` 를 걷어냈다)
          <QueryErrorFallback error={trendErrorObj} onRetry={refetchTrend} />
        ) : trend.length === 0 ? (
          <EmptyState icon="📈" title="추이를 산출할 응답이 없습니다." hint="설문 응답이 제출되면 기간별 NPS 추이가 집계됩니다." />
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium"><T k="기간" /></th>
                  <th className="text-center px-4 py-3 font-medium">NPS</th>
                  <th className="text-center px-4 py-3 font-medium"><T k="평균 점수" /></th>
                  <th className="text-center px-4 py-3 font-medium"><T k="응답 수" /></th>
                  <th className="px-4 py-3 font-medium"><T k="추이" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {trend.map((t, i) => {
                  const prevNps = i > 0 ? trend[i - 1].nps : t.nps;
                  // 어느 한쪽이라도 산출 불가면 차이도 없다(0 으로 접지 않는다)
                  const diff = t.nps != null && prevNps != null ? t.nps - prevNps : null;
                  return (
                    <tr key={t.period} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{t.period}</td>
                      <td className={`px-4 py-3 text-center font-bold ${t.nps != null ? NPS_COLOR(t.nps) : 'text-gray-400'}`}>{t.nps ?? RATIO_UNAVAILABLE}</td>
                      {/* 🔴 (2026-09-16 J3) 점수 문항 응답이 0건인 분기는 서버가 avgScore: null(산출 불가) 을 보낸다 — `.toFixed` 로 터지지도, 0.0 으로 그리지도 않는다 */}
                      <td className="px-4 py-3 text-center">{t.avgScore != null ? t.avgScore.toFixed(1) : <span className="text-gray-400">{RATIO_UNAVAILABLE}</span>}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{t.responseCount}</td>
                      <td className="px-4 py-3">
                        {diff != null && diff > 0 && <span className="text-emerald-600 text-xs font-medium">+{diff}</span>}
                        {diff != null && diff < 0 && <span className="text-red-600 text-xs font-medium">{diff}</span>}
                        {(diff == null || diff === 0) && <span className="text-gray-400 text-xs">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sentiment Analysis */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{AI_ORIGIN_TEXT} <T k="감성 분석" /></h3>
        {loadingSentiment ? (
          <div className="text-center py-12 text-gray-500">{AI_ORIGIN_TEXT} <T k="분석 중..." /></div>
        ) : sentiment && (sentiment.scoredCount > 0 || sentiment.commentCount > 0 || (sentiment.unavailable?.length ?? 0) > 0) ? (
          <div className="bg-white rounded-2xl border p-5 space-y-4">
            {/* 🔴 원장 조회가 실패하면 '응답 0건'이 아니라 실패라고 말한다 — 종전에는 두 조회 모두
                `.catch(() => [])` 라 DB 장애가 "분석할 응답이 없습니다"로 읽혔다. */}
            {(sentiment.unavailable?.length ?? 0) > 0 && (
              <QueryErrorFallback
                size="compact"
                error={new Error(`${sentiment.unavailable!.map(u => SENTIMENT_SOURCE_LABEL[u] ?? u).join('·')} 조회에 실패했습니다 — 응답이 없는 것이 아니라 아래 표본이 불완전합니다.`)}
                onRetry={() => void refetchSentiment()}
              />
            )}
            {sentiment.scoredCount > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-emerald-50 rounded-xl">
                    <p className="text-2xl font-bold text-emerald-600">{sentiment.positive}<Unit>%</Unit></p>
                    <p className="text-xs text-gray-500 mt-1"><T k="긍정" /></p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-2xl font-bold text-gray-600">{sentiment.neutral}<Unit>%</Unit></p>
                    <p className="text-xs text-gray-500 mt-1"><T k="중립" /></p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-xl">
                    <p className="text-2xl font-bold text-red-600">{sentiment.negative}<Unit>%</Unit></p>
                    <p className="text-xs text-gray-500 mt-1"><T k="부정" /></p>
                  </div>
                </div>
                <p className="text-xs text-gray-400"><T k="평점 응답" /> {sentiment.scoredCount}<Unit>건</Unit> 기준</p>
              </>
            ) : (
              <p className="text-sm text-gray-500"><T k="평점 응답이 없어 긍·부정 비율을 산출할 수 없습니다." /></p>
            )}

            {(sentiment.topPositive.length > 0 || sentiment.topNegative.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2"><T k="긍정 키워드" /></p>
                  <div className="flex flex-wrap gap-1.5">
                    {sentiment.topPositive.map(k => (
                      <span key={k} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full whitespace-nowrap">{k}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2"><T k="부정 키워드" /></p>
                  <div className="flex flex-wrap gap-1.5">
                    {sentiment.topNegative.map(k => (
                      <span key={k} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full whitespace-nowrap">{k}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-xs font-medium text-blue-700 mb-1">{AI_ORIGIN_TEXT} <T k="분석 요약" /></p>
              {/* 🔴 코멘트가 있을 때만 AI 를 부른다 — 종전에는 예시 문장을 지어내 분석을 만들었다 */}
              <p className="text-sm text-gray-700 leading-relaxed">
                {sentiment.aiSummary ?? (sentiment.commentCount === 0
                  ? <T k="주관식 코멘트가 없어 분석할 내용이 없습니다." />
                  : <T k="분석을 불러오지 못했습니다." />)}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState icon="📊" title="분석할 응답이 없습니다." hint="설문 응답(평점·주관식)이 제출되면 감성 분석이 표시됩니다." />
        )}
      </div>
    </div>
  );

  const renderBenchmarkTab = () => (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="전국 평균 벤치마크 비교" /></h3>
      {loadingBenchmark ? (
        <div className="text-center py-12 text-gray-500"><T k="불러오는 중..." /></div>
      ) : !benchmark?.available ? (
        /* 🔴 종전에는 10개 항목이 전부 하드코딩이었는데 하단에 '출처: 건강보험심사평가원
           환자경험평가 (2025)' 를 붙여, 측정된 적 없는 숫자에 공식 출처를 달아 놓았다. */
        <EmptyState
          icon="📉"
          title="벤치마크를 표시할 수 없습니다."
          // 🔴 서버 사유는 데이터 · 폴백만 카탈로그 키
          hint={benchmark?.reason ? <Data>{benchmark.reason}</Data> : '전국 평균 비교 기준이 등재되지 않았습니다.'}
        />
      ) : (
        <div className="bg-white rounded-2xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium"><T k="항목" /></th>
                <th className="text-center px-4 py-3 font-medium"><T k="우리 병원" /></th>
                <th className="text-center px-4 py-3 font-medium"><T k="전국 평균" /></th>
                <th className="text-center px-4 py-3 font-medium"><T k="차이" /></th>
                <th className="px-4 py-3 font-medium"><T k="비교" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {benchmark.items.map(b => (
                <tr key={b.category} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{b.category}</td>
                  <td className="px-4 py-3 text-center font-semibold">{b.hospital.toFixed(1)}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.national.toFixed(1)}</td>
                  <td className={`px-4 py-3 text-center font-medium ${b.gap >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {b.gap >= 0 ? '+' : ''}{b.gap.toFixed(1)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(b.hospital, 100)}%` }} />
                      </div>
                      <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-400 rounded-full" style={{ width: `${Math.min(b.national, 100)}%` }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t bg-gray-50 flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-blue-500 rounded-sm" /> <T k="우리 병원" /></span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-gray-400 rounded-sm" /> <T k="전국 평균" /></span>
            {benchmark.source && <span className="ml-auto"><T k="출처" />: {benchmark.source}</span>}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="환자 만족도" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="설문 관리 / 부서별 분석 / 추이 분석 / 벤치마크 비교" /></p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border hover:bg-gray-50'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : <>
      {tab === 'survey' && renderSurveyTab()}
      {tab === 'dispatches' && renderDispatchesTab()}
      {tab === 'department' && renderDepartmentTab()}
      {tab === 'trend' && renderTrendTab()}
      {tab === 'benchmark' && renderBenchmarkTab()}
      </>}

      {/* 발송 모달 */}
      {dispatchFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setDispatchFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1"><T k="설문 발송" /></h3>
            <p className="text-sm text-gray-500 mb-4">{dispatchFor.name}</p>
            <label className="block text-xs font-semibold text-gray-600 mb-1"><T k="발송 채널" /></label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {([['PORTAL', '📱 환자포털'], ['TABLET', '📋 태블릿'], ['SMS', '✉️ SMS']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setDChannel(v)} className={`py-2 text-xs rounded-lg border-2 ${dChannel === v ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-100 text-gray-500'}`}><T k={l} /></button>
              ))}
            </div>
            <label className="block text-xs font-semibold text-gray-600 mb-1"><T k="환자명 (선택)" /></label>
            <input value={dPatient} onChange={e => setDPatient(e.target.value)} placeholder="예: 홍길동"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-4 outline-none focus:ring-2 focus:ring-blue-100" />
            <label className="block text-xs font-semibold text-gray-600 mb-1"><T k="발송 시점" /></label>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {([['MANUAL', '일반 발송'], ['DISCHARGE', '퇴원 시']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setDTrigger(v)} className={`py-2 text-xs rounded-lg border-2 ${dTrigger === v ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-100 text-gray-500'}`}><T k={l} /></button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDispatchFor(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><T k="취소" /></button>
              <button onClick={() => dispatchMutation.mutate({ templateId: dispatchFor.id, channel: dChannel, patientName: dPatient || undefined, trigger: dTrigger })}
                disabled={dispatchMutation.isPending}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="발송" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 발송 결과(링크/QR) */}
      {dispatchResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setDispatchResult(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-2">✅</div>
            <h3 className="text-lg font-bold mb-1"><T k="설문이 발송되었습니다" /></h3>
            <p className="text-xs text-gray-500 mb-4"><T k={dispatchResult.channel === 'TABLET' ? '태블릿에서 아래 링크/QR로 작성' : dispatchResult.channel === 'SMS' ? 'SMS로 링크 전송(데모: 아래 링크)' : '환자포털/링크로 작성'} /></p>
            {/* 🔴 설문 링크(1회용 토큰)를 외부 QR API 로 보내던 것 봉합 — 로컬 생성 */}
            <QrImage value={dispatchResult.url} size={180} alt={tAttr('설문 QR')} className="mx-auto mb-3 rounded-lg border" />
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 mb-4">
              <input readOnly value={dispatchResult.url} className="flex-1 text-xs bg-transparent outline-none text-gray-600" />
              <button onClick={() => { navigator.clipboard?.writeText(dispatchResult.url); toast.success('복사됨'); }} className="text-xs px-2 py-1 bg-blue-600 text-white rounded"><T k="복사" /></button>
            </div>
            <div className="flex justify-center gap-2">
              <a href={dispatchResult.url} target="_blank" rel="noopener" className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"><T k="열기" /></a>
              <button onClick={() => setDispatchResult(null)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="확인" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
