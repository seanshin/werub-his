'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Unit } from '@/components/ui/display';
import { ProposeAgendaButton } from '@/components/governance/ProposeAgendaModal';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Metric {
  key: string; domain: string; label: string; value: number; total?: number;
  drillDown: string; severityWhenOver: 'INFO' | 'WARNING' | 'CRITICAL'; threshold?: number; error?: boolean; detail?: string;
}
interface Summary { domains: { domain: string; metrics: Metric[] }[] }
interface DetailRow { id: string; title: string; sub?: string; href?: string }

const DOMAIN_LABEL: Record<string, string> = {
  patient: '환자', encounter: '진료기록', order: '처방/오더', admission: '입원',
  // surgery 는 3단계에서 지표가 들어왔는데 라벨이 없어 영문 키로 노출되고 있었다
  surgery: '수술', emergency: '응급', imaging: '영상',
  lab: '검사', billing: '청구', consent: '동의서', staff: '직원', appointment: '예약', master: '기관 마스터', voc: '고객의 소리',
  // 8·9단계(2026-08-24) — 지표와 함께 넣는다(라벨 없이 지표만 넣으면 영문 키로 노출된다: surgery 전례)
  checkup: '건강검진', nursing: '간호', safety: '환자안전',
};
const SEV_TONE: Record<string, string> = {
  INFO: 'text-gray-700', WARNING: 'text-amber-600', CRITICAL: 'text-rose-600',
};

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

/** 데이터 품질 관제 — 기획 data-quality-concierge.plan.md P1. 전 지표 워크리스트 딥링크 규약 */
export default function DataQualityPage() {
  const tAttr = useTAttr();
  const router = useRouter();
  const [tab, setTab] = useState('all');
  const [panelKey, setPanelKey] = useState<string | null>(null);

  const { data: briefData } = useQuery({
    queryKey: ['dq-briefing'],
    queryFn: () => apiClient.get<{ data: { mode: string; text: string; disclaimer?: string } }>('/api/v1/data-quality/briefing'),
    staleTime: 300_000,
  });
  const brief = unwrap<{ mode: string; text: string; disclaimer?: string }>(briefData);
  const [dupScores, setDupScores] = useState<{ group: string; score: number; reason: string }[] | null>(null);
  const [tool, setTool] = useState<'none' | 'outreach' | 'normalize'>('none');
  const [outType, setOutType] = useState<'recall' | 'infoUpdate' | 'passportExpiry'>('recall');
  const [outLang, setOutLang] = useState('ko');
  const [draft, setDraft] = useState<{ mode: string; language: string; text: string; disclaimer?: string } | null>(null);
  const [normRows, setNormRows] = useState<{ id: string; mrn: string; name: string; before: string; after: string }[] | null>(null);
  const [normSel, setNormSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: outTargetData } = useQuery({
    queryKey: ['dq-outreach', outType],
    queryFn: () => apiClient.get<{ data: { type: string; total: number; consented: number; note?: string } }>(`/api/v1/data-quality/outreach/targets?type=${outType}`),
    enabled: tool === 'outreach',
  });
  const outTargets = unwrap<{ type: string; total: number; consented: number; note?: string }>(outTargetData);

  const makeDraft = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post<{ data: { mode: string; language: string; text: string; disclaimer?: string } }>('/api/v1/data-quality/outreach/draft', { type: outType, language: outLang });
      setDraft(unwrap<{ mode: string; language: string; text: string; disclaimer?: string }>(r));
    } catch { setDraft(null); }
    setBusy(false);
  };

  const loadNormalize = async () => {
    setBusy(true);
    try {
      const r = await apiClient.get<{ data: { candidates: number; rows: { id: string; mrn: string; name: string; before: string; after: string }[] } }>('/api/v1/data-quality/normalize/preview');
      const d = unwrap<{ candidates: number; rows: { id: string; mrn: string; name: string; before: string; after: string }[] }>(r);
      setNormRows(d.rows); setNormSel(d.rows.map((x) => x.id));
    } catch { setNormRows([]); }
    setBusy(false);
  };

  const applyNormalize = async () => {
    if (!normSel.length) return;
    setBusy(true);
    try {
      await apiClient.post('/api/v1/data-quality/normalize/apply', { ids: normSel });
      await loadNormalize();
    } catch { /* noop */ }
    setBusy(false);
  };
  const [scoring, setScoring] = useState(false);
  const scoreDups = async () => {
    setScoring(true);
    try {
      const r = await apiClient.post<{ data: { mode: string; pairs: { group: string; score: number; reason: string }[] } }>('/api/v1/data-quality/duplicates/score?limit=10', {});
      const d = unwrap<{ mode: string; pairs: { group: string; score: number; reason: string }[] }>(r);
      setDupScores(d.mode === 'ai' ? d.pairs : []);
    } catch { setDupScores([]); }
    setScoring(false);
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dq-summary'],
    queryFn: () => apiClient.get<{ data: Summary }>('/api/v1/data-quality/summary'),
    refetchInterval: pollMs('slow'),
  });
  const summary = unwrap<Summary>(data);
  const domains = summary?.domains ?? [];
  const shown = tab === 'all' ? domains : domains.filter((d) => d.domain === tab);
  const selectedMetric = domains.flatMap((d) => d.metrics).find((m) => m.key === panelKey);

  const { data: detailData } = useQuery({
    queryKey: ['dq-detail', panelKey],
    queryFn: () => apiClient.get<{ data: DetailRow[] }>(`/api/v1/data-quality/detail?key=${panelKey}`),
    enabled: !!panelKey,
  });
  const rows = unwrap<DetailRow[]>(detailData) ?? [];

  const { data: trendData } = useQuery({
    queryKey: ['dq-trend', panelKey],
    queryFn: () => apiClient.get<{ data: { date: string; value: number }[] }>(`/api/v1/data-quality/trend?key=${panelKey}&days=30`),
    enabled: !!panelKey,
  });
  const trend = unwrap<{ date: string; value: number }[]>(trendData) ?? [];
  const trendMax = Math.max(1, ...trend.map((t) => t.value));

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const click = (m: Metric) => {
    if (m.drillDown === 'panel') setPanelKey(panelKey === m.key ? null : m.key);
    else router.push(m.drillDown);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="데이터 품질 관제" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="도메인별 품질 지표 — 카드를 누르면 해당 워크리스트로 이동합니다" /></p>
      </div>

      {brief?.text && (
        <div className="mb-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-bold text-gray-900">{brief.mode === 'ai' ? `🤖 ${AI_ORIGIN_TEXT} 품질 브리핑` : <T k="📋 우선 처리 요약" />}</span>
            {brief.mode === 'rule' && <span className="text-[10px] text-gray-400"><T k="(AI OFF — 규칙 기반)" /></span>}
          </div>
          <p className="text-xs text-gray-700 whitespace-pre-line">{brief.text}</p>
          {brief.disclaimer && <p className="text-[10px] text-gray-400 mt-1.5">{brief.disclaimer}</p>}
        </div>
      )}

      <div className="flex gap-1.5 mb-3">
        <button onClick={() => setTool(tool === 'outreach' ? 'none' : 'outreach')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium ${tool === 'outreach' ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 hover:bg-violet-100'}`}>
          <T k="✉️ 아웃리치 초안" />
        </button>
        <button onClick={() => { setTool(tool === 'normalize' ? 'none' : 'normalize'); if (tool !== 'normalize' && !normRows) void loadNormalize(); }}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium ${tool === 'normalize' ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'}`}>
          <T k="🧹 전화번호 정규화" />
        </button>
      </div>

      {tool === 'outreach' && (
        <div className="mb-4 bg-white rounded-2xl border border-violet-100 shadow-sm p-4">
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {([['recall', '미내원 리콜'], ['infoUpdate', '정보 갱신'], ['passportExpiry', '여권 만료']] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setOutType(v); setDraft(null); }}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium ${outType === v ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k={l} /></button>
            ))}
            <span className="mx-1 h-4 w-px bg-gray-200" />
            {['ko', 'en', 'mn', 'vi', 'zh', 'ru', 'ar', 'ja'].map((l) => (
              <button key={l} onClick={() => { setOutLang(l); setDraft(null); }}
                className={`px-2 py-1 text-xs rounded-lg font-medium ${outLang === l ? 'bg-violet-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>{l}</button>
            ))}
            <button onClick={makeDraft} disabled={busy} className="ml-auto px-3 py-1 text-xs rounded-lg bg-violet-600 text-white font-medium disabled:opacity-50">
              <T k={busy ? '생성 중...' : '초안 생성'} />
            </button>
          </div>
          {outTargets && (
            <p className="text-[11px] text-gray-500 mb-2">
              <T k="대상" /> {outTargets.total}<Unit>명</Unit> · <T k="마케팅 수신동의 보유" /> <span className="font-bold text-violet-700">{outTargets.consented}<Unit>명</Unit></span>
              {outTargets.note && <span className="block text-[10px] text-amber-600 mt-0.5">{outTargets.note}</span>}
            </p>
          )}
          {draft && (
            <div className="rounded-xl bg-violet-50/60 border border-violet-100 p-3">
              <p className="text-[10px] text-violet-400 mb-1">{draft.mode === 'ai' ? `${AI_ORIGIN_TEXT} 초안 · ${draft.language}` : `정적 템플릿 · ${draft.language}`}</p>
              <p className="text-xs text-gray-800 whitespace-pre-line">{draft.text}</p>
              <p className="text-[10px] text-gray-400 mt-1.5">{draft.disclaimer ?? '발송은 상담데스크에서 사람이 수행합니다(자동 발송 없음). {{name}}은 발송 시 치환됩니다.'}</p>
            </div>
          )}
        </div>
      )}

      {tool === 'normalize' && (
        <div className="mb-4 bg-white rounded-2xl border border-teal-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-900"><T k="전화번호 E.164 정규화 제안" /> {normRows ? `(${normRows.length}건)` : ''}</p>
            <div className="flex items-center gap-2">
              <button onClick={loadNormalize} disabled={busy} className="text-[11px] text-gray-500 hover:text-gray-700"><T k="새로고침" /></button>
              <button onClick={applyNormalize} disabled={busy || !normSel.length}
                className="px-3 py-1 text-xs rounded-lg bg-teal-600 text-white font-medium disabled:opacity-40">
                선택 {normSel.length}건 적용
              </button>
            </div>
          </div>
          {!normRows ? <p className="text-xs text-gray-400 py-4 text-center"><T k="불러오는 중..." /></p>
            : normRows.length === 0 ? <EmptyState icon="📋" title="정규화 대상이 없습니다" /> : (
            <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {normRows.map((r) => (
                <label key={r.id} className="py-2 flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={normSel.includes(r.id)}
                    onChange={(e) => setNormSel((prev) => e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id))} />
                  <span className="text-xs text-gray-700 w-40 truncate">{r.name} ({r.mrn})</span>
                  <span className="text-xs text-gray-400 line-through">{r.before}</span>
                  <span className="text-xs text-teal-700 font-medium">→ {r.after}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2"><T k="결정적 규칙(AI 미사용) · 적용 내역은 감사 로그에 before/after 보존" /></p>
        </div>
      )}

      <div className="flex gap-1.5 mb-4">
        {['all', ...domains.map((d) => d.domain)].map((d) => (
          <button key={d} onClick={() => setTab(d)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium ${tab === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={d === 'all' ? '전체' : DOMAIN_LABEL[d] ?? d} />
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><T k="지표 산출 중..." /></div>
      ) : (
        <div className="space-y-5">
          {shown.map((d) => (
            <div key={d.domain}>
              <h3 className="text-sm font-semibold text-gray-700 mb-2"><T k={DOMAIN_LABEL[d.domain] ?? d.domain} /></h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {d.metrics.map((m) => (
                  <button key={m.key} onClick={() => click(m)}
                    title={m.drillDown === 'panel' ? tAttr('클릭하면 상세 목록이 열립니다') : `이동: ${m.drillDown}`}
                    className={`bg-white rounded-xl border p-3 text-left transition-colors ${panelKey === m.key ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-100 hover:border-blue-200'}`}>
                    <p className="text-[11px] text-gray-500 mb-1 truncate">{m.label}</p>
                    {/* 🔴 집계 실패를 초록으로 그리지 않는다 — 서버는 실패를 `{error:true, value:-1}` 로 주는데
                        `m.value > 0` 이 거짓이라 **실패 지표가 "정상"(emerald)으로 보였다**(P17). */}
                    <p className={`text-xl font-bold ${m.error ? 'text-gray-400' : m.value > 0 ? SEV_TONE[m.severityWhenOver] : 'text-emerald-600'}`}>
                      {m.error ? <T k="집계 실패" /> : m.value}
                      {m.total != null && <span className="text-[10px] font-normal text-gray-400 ml-1">/ {m.total}</span>}
                    </p>
                    {m.detail && <p className="text-[10px] text-gray-400 truncate">{m.detail}</p>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {panelKey && selectedMetric && (
        <div className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900">{selectedMetric.label} — <T k="워크리스트 (상위 50)" /></h3>
            <div className="flex items-center gap-2">
              {panelKey === 'patient.dupSuspect' && (
                <button onClick={scoreDups} disabled={scoring}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 font-medium disabled:opacity-50">
                  <T k={scoring ? '판별 중...' : '🤖 AI 동일인 판별'} />
                </button>
              )}
              <ProposeAgendaButton
                sourceRef={{ type: 'DATA_QUALITY', key: selectedMetric.key }}
                defaultTitle={`[데이터 품질] ${selectedMetric.label} ${selectedMetric.value}건 — 개선 심의`}
                defaultBody={`지표: ${selectedMetric.key} (${DOMAIN_LABEL[selectedMetric.domain] ?? selectedMetric.domain})\n현재: ${selectedMetric.value}건${selectedMetric.total != null ? ` / 전체 ${selectedMetric.total}` : ''}${selectedMetric.threshold != null ? `\n임계: ${selectedMetric.threshold} (초과 시 ${selectedMetric.severityWhenOver})` : ''}${selectedMetric.detail ? `\n비고: ${selectedMetric.detail}` : ''}`}
                label="상정" />
              <button onClick={() => setPanelKey(null)} className="text-xs text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
            </div>
          </div>
          {panelKey === 'patient.dupSuspect' && dupScores !== null && (
            <div className="mb-3 rounded-xl bg-violet-50/50 border border-violet-100 p-3">
              {dupScores.length === 0 ? (
                <p className="text-[11px] text-violet-400"><T k="AI 판별 결과 없음 — quality.ai.enabled 게이트(기본 OFF) 또는 AI 서버 상태를 확인하세요. 병합 확정은 항상 사람이 합니다." /></p>
              ) : (
                <div className="space-y-1">
                  {dupScores.map((d2) => (
                    <p key={d2.group} className="text-[11px] text-violet-800">
                      <span className="font-bold">{d2.group}</span> — <T k="동일인 가능성" /> {(d2.score * 100).toFixed(0)}<Unit>%</Unit> · {d2.reason}
                    </p>
                  ))}
                  <p className="text-[11px] text-violet-500 mt-1"><T k="AI 참고 정보 — 병합 확정은 환자 관리의 병합 기능에서 사람이 수행합니다." /></p>
                </div>
              )}
            </div>
          )}
          {trend.length > 1 && (
            <div className="flex items-end gap-0.5 h-10 mb-3" title={tAttr('최근 30일 추이')}>
              {trend.map((t) => (
                <div key={t.date} className="flex-1 bg-blue-100 rounded-t" style={{ height: `${Math.max(8, (t.value / trendMax) * 100)}%` }} title={`${t.date}: ${t.value}`} />
              ))}
            </div>
          )}
          {rows.length === 0 ? (
            <EmptyState icon="📋" title="해당 항목이 없습니다" />
          ) : (
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {rows.map((r) => (
                <div key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{r.title}</p>
                    {r.sub && <p className="text-[10px] text-gray-400 truncate">{r.sub}</p>}
                  </div>
                  {r.href && (
                    <button onClick={() => router.push(r.href!)} className="shrink-0 text-[11px] text-blue-600 hover:text-blue-800 font-medium"><T k="열기" /> →</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
