'use client';

/**
 * F-7 처방·투약 AI 쉬운 설명 (설계 §5.5·§6.4·§6.5)
 * - DrugExplainSheet: 약 단위 4단(💊무슨 약/⏰어떻게 먹나/⚠️주의/🚨연락) — 고령자 스캔 가독(불릿)
 * - PrescriptionExplainSheet: "이번 처방 한눈에"(encounter 단위) — 약별 한 줄 + DUR 쉬운 말 + 복용 스케줄 표
 * 규약: dark: 금지(.portal-dark 매핑 유틸만) · 허용 폰트(text-sm/xs/[10px]/[8px]/lg)만 · LLM 결과는 전부 텍스트 노드
 * 로딩: 시트 내 bounce 3점 + 단계 문구 — 닫아도 잡은 서버에서 계속(sessionStorage jobId로 재열람 시 이어짐)
 * 에러/OFF(404)/미해석: 조용한 폴백 카드(빨간 에러 금지)
 * 표기 4층(§6.5): ✨WeRU.B 헤더 · bg-indigo-50 본문 · 출처 이중 표기(e약은요 개정일+생성일) · 서버 disclaimer 우선
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { portalDateText } from './portal-date';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import PortalSheet from './PortalSheet';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { PT, usePortalTAttr } from './PT';

const DEFAULT_DISCLAIMER =
  '본 설명은 인공지능이 생성한 참고 정보로, 복약지도를 대체하지 않습니다. 복용·중단 등 최종 판단은 반드시 의사·약사와 상의하세요.';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 5 * 60_000;

interface ExplainSource { name?: string; updateDe?: string | null; generatedAt?: string | null }
interface DrugExplain {
  drugName?: string;
  purpose?: string;
  usage?: { text?: string; slots?: string[] };
  cautions?: string[];
  sideEffects?: string[];
  whenToCall?: string[];
  source?: ExplainSource;
  disclaimer?: string | null;
}
interface EncounterExplainItem { prescriptionId: string; drugName?: string; status: string; explain?: DrugExplain }
interface DurNote { type?: string; drugs?: string[]; detail?: string; easy?: string | null }
interface EncounterExplain {
  status: string;
  items?: EncounterExplainItem[];
  dur?: { checked?: boolean; notes?: DurNote[]; disclaimer?: string | null } | null;
  schedule?: { prescriptionId: string; drugName?: string; dosage?: string | null; slots?: string[]; duration?: number | null }[];
}

type Phase = 'loading' | 'ready' | 'unavailable';

const fmtDate = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : portalDateText(d, 'date'); // 무효면 종전처럼 null(소비처가 줄을 숨긴다)
};

/* ── 공용 조각 ── */

function BounceLoading({ stage }: { stage: string }) {
  return (
    <div className="py-8">
      <div className="flex items-center justify-center gap-1.5">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
      <p className="text-xs text-gray-500 text-center mt-3">{stage}</p>
      <p className="text-[10px] text-gray-400 text-center mt-1">창을 닫아도 준비는 계속돼요. 잠시 후 다시 열면 결과를 볼 수 있어요.</p>
    </div>
  );
}

/** 조용한 폴백 — 빨간 에러 금지(PortalAiLabExplain 폴백 선례) */
function QuietFallback({ message }: { message: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
      <p className="text-sm text-gray-600">{message}</p>
      <p className="text-xs text-gray-400 mt-1">정확한 복약 상담은 약사에게 문의해 주세요.</p>
    </div>
  );
}

function BrandHeader() {
  return <p className="text-xs font-semibold text-indigo-700">✨ {AI_ORIGIN_TEXT} 쉬운 설명</p>;
}

function SourceAndDisclaimer({ source, disclaimer }: { source?: ExplainSource; disclaimer?: string | null }) {
  const gen = fmtDate(source?.generatedAt);
  return (
    <div className="pt-1">
      <p className="text-[10px] text-gray-500">
        출처: 식약처 e약은요{source?.updateDe ? `(개정 ${source.updateDe})` : ''} · {AI_ORIGIN_TEXT}{gen ? ` 생성 ${gen}` : ''}
      </p>
      <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">{disclaimer || DEFAULT_DISCLAIMER}</p>
      <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
        관련 규정: 「약사법」상 복약지도가 아닌 참고 정보 제공 · 「AI기본법」에 따른 인공지능 생성물 표시 · 본 설명은 원내 약사 검수(승인)를 거쳐 제공됩니다
      </p>
    </div>
  );
}

function Bullets({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-1.5 text-sm text-gray-800 leading-relaxed">
          <span className="text-indigo-400 shrink-0">•</span>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

function ExplainSection({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
      <p className="text-sm font-bold text-gray-900 mb-1.5">{icon} {title}</p>
      {children}
    </section>
  );
}

/** 잡 폴링 공통 훅 — sessionStorage jobId 보관(시트 재열람 시 이어짐), 3초 간격·최대 5분(§5.3) */
function useExplainFlow(opts: {
  open: boolean;
  storageKey: string;
  /** 최초 요청 — READY 즉시 결과 | jobId(PENDING/항상 잡) */
  begin: () => Promise<{ result?: unknown; jobId?: string }>;
  pollPath: (jobId: string) => string;
  /** 잡 DONE result → 표시 결과(null이면 폴백) */
  parseResult: (r: unknown) => unknown | null;
}) {
  const { open, storageKey, begin, pollPath, parseResult } = opts;
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<unknown>(null);
  const [stage, setStage] = useState('약 정보를 확인하고 있어요');
  // UNAVAILABLE 세분(PENDING_REVIEW=약사 검수 대기 — 승인제) — 폴백 문구 분기용
  const [reason, setReason] = useState<string | null>(null);
  const retriedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stageTimer = setTimeout(() => { if (!cancelled) setStage('쉬운 말로 정리하고 있어요'); }, 8000);
    setPhase('loading');
    setStage('약 정보를 확인하고 있어요');
    setReason(null);
    retriedRef.current = false;

    const finishWith = (r: unknown) => {
      const parsed = parseResult(r);
      setReason((r as { reason?: string } | null)?.reason ?? null);
      if (parsed) { setData(parsed); setPhase('ready'); } else setPhase('unavailable');
    };

    const poll = async (jobId: string, startedAt: number) => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_MAX_MS) { sessionStorage.removeItem(storageKey); setPhase('unavailable'); return; }
      try {
        const res = await apiClient.get<{ data: { status: string; result?: unknown } }>(pollPath(jobId));
        const job = res?.data;
        if (cancelled) return;
        if (job?.status === 'DONE') { sessionStorage.removeItem(storageKey); finishWith(job.result); }
        else if (job?.status === 'ERROR') { sessionStorage.removeItem(storageKey); setPhase('unavailable'); }
        else timer = setTimeout(() => poll(jobId, startedAt), POLL_INTERVAL_MS);
      } catch {
        // 잡 만료(404) 등 — 1회만 새로 시작, 반복 실패는 조용한 폴백
        sessionStorage.removeItem(storageKey);
        if (!retriedRef.current) { retriedRef.current = true; start(); } else if (!cancelled) setPhase('unavailable');
      }
    };

    const start = async () => {
      try {
        const { result, jobId } = await begin();
        if (cancelled) return;
        if (result !== undefined) { finishWith(result); return; }
        if (jobId) {
          sessionStorage.setItem(storageKey, JSON.stringify({ jobId, at: Date.now() }));
          poll(jobId, Date.now());
        } else setPhase('unavailable');
      } catch {
        if (!cancelled) setPhase('unavailable'); // config OFF(404)·네트워크 — 조용한 폴백
      }
    };

    // 진행 중이던 잡이 있으면 이어서 폴링(닫아도 잡 지속 — §6.4)
    let resumed = false;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const { jobId, at } = JSON.parse(saved) as { jobId: string; at: number };
        if (jobId && Date.now() - (at ?? 0) < POLL_MAX_MS) { resumed = true; poll(jobId, at ?? Date.now()); }
        else sessionStorage.removeItem(storageKey);
      }
    } catch { sessionStorage.removeItem(storageKey); }
    if (!resumed) start();

    return () => { cancelled = true; clearTimeout(timer); clearTimeout(stageTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey]);

  return { phase, data, stage, reason };
}

/* ═══════════ 약 단위 시트 ═══════════ */

export function DrugExplainSheet({
  open, onClose, prescriptionId, byName, drugName,
}: {
  open: boolean;
  onClose: () => void;
  /** 처방 ID 진입(투약 탭) — byName과 택1 */
  prescriptionId?: string;
  /** 명칭 진입(퇴원약 — 처방 레코드 없는 자유 JSON) — 본인 퇴원요약+마스터 정확일치 단일만 서버 허용 */
  byName?: string;
  drugName: string;
}) {
  const tAttr = usePortalTAttr();
  const { phase, data, stage, reason } = useExplainFlow({
    open,
    storageKey: byName ? `portal-explain-job:name:${byName}` : `portal-explain-job:med:${prescriptionId}`,
    begin: async () => {
      const res = await apiClient.get<{ data: { status: string; explain?: DrugExplain; jobId?: string } }>(
        byName
          ? `/api/v1/portal/medications/explain-by-name?name=${encodeURIComponent(byName)}`
          : `/api/v1/portal/medications/${prescriptionId}/explain`,
      );
      const d = res?.data;
      if (d?.status === 'READY' && d.explain) return { result: { status: 'READY', explain: d.explain } };
      if (d?.status === 'PENDING' && d.jobId) return { jobId: d.jobId };
      return { result: d ?? null }; // UNAVAILABLE(+reason) 원본 전달 — 검수 대기 문구 분기
    },
    pollPath: (jobId) => `/api/v1/portal/medications/explain-jobs/${jobId}`,
    parseResult: (r) => {
      const rr = r as { status?: string; explain?: DrugExplain } | null;
      return rr?.status === 'READY' && rr.explain ? rr.explain : null;
    },
  });
  const explain = data as DrugExplain | null;
  const cautions = [...(explain?.cautions ?? []), ...(explain?.sideEffects ?? [])]; // sideEffects는 '주의하세요'에 병합(설계 §5.2)

  return (
    <PortalSheet open={open} onClose={onClose} title={drugName || '약 설명'}>
      {phase === 'loading' && <BounceLoading stage={stage} />}
      {phase === 'unavailable' && (
        <QuietFallback message={reason === 'PENDING_REVIEW' ? '약사님이 검수 중인 설명이에요. 검수가 끝나면 보실 수 있어요.' : '아직 준비되지 않은 약이에요.'} />
      )}
      {phase === 'ready' && explain && (
        <div className="space-y-3">
          <BrandHeader />
          {explain.purpose ? (
            <ExplainSection icon="💊" title={tAttr('무슨 약인가요')}>
              <p className="text-sm text-gray-800 leading-relaxed">{explain.purpose}</p>
            </ExplainSection>
          ) : null}
          <ExplainSection icon="⏰" title={tAttr('어떻게 먹나요')}>
            <p className="text-sm text-gray-800 leading-relaxed">{explain.usage?.text || '처방전의 용법을 따라 주세요.'}</p>
            {(explain.usage?.slots?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {explain.usage!.slots!.map(s => (
                  <span key={s} className="text-[10px] font-medium bg-white text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">{s}</span>
                ))}
              </div>
            )}
          </ExplainSection>
          {cautions.length > 0 && (
            <ExplainSection icon="⚠️" title={tAttr('주의하세요')}>
              <Bullets lines={cautions} />
            </ExplainSection>
          )}
          {(explain.whenToCall?.length ?? 0) > 0 && (
            <ExplainSection icon="🚨" title={tAttr('이럴 땐 연락하세요')}>
              <Bullets lines={explain.whenToCall!} />
            </ExplainSection>
          )}
          <SourceAndDisclaimer source={explain.source} disclaimer={explain.disclaimer} />
        </div>
      )}
    </PortalSheet>
  );
}

/* ═══════════ 처방전 단위 시트 — "이번 처방 한눈에" ═══════════ */

export function PrescriptionExplainSheet({
  open, onClose, encounterId,
}: { open: boolean; onClose: () => void; encounterId: string }) {
  const tAttr = usePortalTAttr();
  const { phase, data, stage } = useExplainFlow({
    open,
    storageKey: `portal-explain-job:enc:${encounterId}`,
    begin: async () => {
      const res = await apiClient.post<{ data: { jobId?: string } }>(`/api/v1/portal/prescriptions/${encounterId}/explain`);
      const jobId = res?.data?.jobId;
      return jobId ? { jobId } : { result: null };
    },
    pollPath: (jobId) => `/api/v1/portal/prescriptions/explain-jobs/${jobId}`,
    parseResult: (r) => {
      const rr = r as EncounterExplain | null;
      return rr?.status === 'READY' ? rr : null;
    },
  });
  const result = data as EncounterExplain | null;
  const items = result?.items ?? [];
  const durNotes = result?.dur?.notes ?? [];
  const schedule = (result?.schedule ?? []).filter(s => (s.slots?.length ?? 0) > 0);
  const slotCols = ['아침 식후', '점심 식후', '저녁 식후', '취침 전'].filter(col => schedule.some(s => s.slots?.includes(col)));
  const firstSource = items.find(i => i.explain?.source)?.explain?.source;
  const firstDisclaimer = items.find(i => i.explain?.disclaimer)?.explain?.disclaimer ?? null;

  return (
    <PortalSheet open={open} onClose={onClose} title={tAttr('이번 처방 한눈에')}>
      {phase === 'loading' && <BounceLoading stage={stage} />}
      {phase === 'unavailable' && <QuietFallback message="이 진료의 처방 설명을 아직 준비하지 못했어요." />}
      {phase === 'ready' && result && (
        <div className="space-y-3">
          <BrandHeader />

          {/* 약별 역할 한 줄 */}
          {items.map(item => (
            <div key={item.prescriptionId} className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <p className="text-sm font-bold text-gray-900">💊 {item.drugName || '약'}</p>
              {item.status === 'READY' && item.explain ? (
                <>
                  <p className="text-sm text-gray-800 leading-relaxed mt-1">{item.explain.purpose}</p>
                  {item.explain.usage?.text && <p className="text-xs text-gray-500 mt-1">{item.explain.usage.text}</p>}
                  {item.explain.source?.updateDe && (
                    <p className="text-[10px] text-gray-400 mt-1">e약은요 개정 {item.explain.source.updateDe}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  {item.status === 'PENDING_REVIEW' ? '약사님이 검수 중인 설명이에요.' : '이 약의 설명은 아직 준비되지 않았어요. 약사에게 문의해 주세요.'}
                </p>
              )}
            </div>
          ))}

          {/* DUR — 쉬운 말 + 원 유형명 배지 병기(§6.5-⑤ — 경고 강도 희석 방지) */}
          {result.dur?.checked && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-sm font-bold text-gray-900 mb-1.5"><PT k="⚠️ 함께 먹을 때 확인할 점" /></p>
              {durNotes.length > 0 ? (
                <div className="space-y-2">
                  {durNotes.map((n, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 shrink-0 mt-0.5">{n.type || 'DUR'}</span>
                      <p className="text-sm text-gray-800 leading-relaxed">{n.easy || n.detail || ''}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">특별한 주의 항목이 발견되지 않았어요.</p>
              )}
              {result.dur?.disclaimer && <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">{result.dur.disclaimer}</p>}
            </div>
          )}

          {/* 복용 스케줄 표 */}
          {schedule.length > 0 && slotCols.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-sm font-bold text-gray-900 mb-1.5"><PT k="🗓️ 복용 스케줄" /></p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-100">
                      <th className="text-left pb-1 pr-2 font-medium">약</th>
                      {slotCols.map(c => <th key={c} className="pb-1 px-1 font-medium whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map(s => (
                      <tr key={s.prescriptionId} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 pr-2 text-gray-800">
                          {s.drugName}
                          {s.duration ? <span className="text-[10px] text-gray-400 ml-1">{s.duration}<Unit>일</Unit></span> : null}
                        </td>
                        {slotCols.map(c => (
                          <td key={c} className="py-1.5 px-1 text-center">
                            {s.slots?.includes(c) ? <span className="text-indigo-600 font-bold">✓</span> : <span className="text-gray-200">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <SourceAndDisclaimer source={firstSource} disclaimer={firstDisclaimer} />
        </div>
      )}
    </PortalSheet>
  );
}
