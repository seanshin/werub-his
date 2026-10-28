'use client';

import { AiOriginLabel } from '@/components/ai/AiOriginLabel';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { decideProposal, markProposalPresented, proposalIdFrom } from '@/lib/ai-proposal';

import { EmptyState, Unit, KDate } from '@/components/ui/display';
import { AI_ORIGIN_TEXT, formatNum } from '@hospital-run/shared';
import { readAiTextStream, soapFromStreamText } from '@/lib/ai-stream-read';
import { T, useTAttr } from '@/components/ui/i18n-text';
import {
  AI_SKILL_MODES, AI_SKILL_MODE_MEANING, AI_SKILL_MODE_ORDER, AI_SKILL_MODE_TONE, skillModeText,
  computeSkillSuggestions, type AiTab, type SkillSuggestion,
} from './ai-skill-modes';

interface DdxItem {
  rank: number;
  code: string;
  name: string;
  probability: number;
  urgency: string;
  reasoning: string;
  keyFindings?: string[];
  suggestedQuestions?: string[];
}

interface SuggestedTest {
  name: string;
  priority: string;
  reason: string;
}

interface DdxResult extends SkillEnvelope {
  differentials: DdxItem[];
  suggestedTests: SuggestedTest[];
  redFlags: string[];
}

/**
 * 스킬 출력 계약(서버 정본 `medical-ai/ai-verify.ts`) — 모든 스킬 응답에 붙는다.
 * 🔴 `source` 는 서버가 정한다. FE 가 빈 배열을 보고 "아직 안 눌렀다"처럼 그리지 않는다(2026-08-19 실측: 감별진단 15~23초 뒤 [] 침묵).
 */
export interface SkillEnvelope {
  source?: 'AI' | 'FALLBACK' | 'UNAVAILABLE' | string;
  reason?: string;
  latencyMs?: number;
  verify?: { passed: string[]; failed: string[] };
  groundedOn?: string[];
  /** 실시간 응답 캐시(입력 해시) 적중 — 화면은 "캐시 · 시각" 으로 말한다(§4.6-a) */
  cached?: boolean;
  cachedAt?: string;
}

/** 서버 정본 `medical-ai/patient-brief.service.ts` */
interface PatientBrief {
  computedAt: string; trigger: 'BATCH' | 'LAZY' | 'REFRESH'; basis: string[];
  allergy: { status: string; items: string[] };
  activeMedications: string[]; activeProblems: string[];
  recentLabs: Array<{ testName: string; value: string; unit: string | null; flag: string | null }>; abnormalLabCount: number;
  latestVitals: { measuredAt: string; systolicBp: number | null; diastolicBp: number | null; heartRate: number | null; spo2: number | null } | null;
  unavailable: string[];
  /** 배치 B — LLM 사전 스킬(야간·검증층 통과분만). 없으면 실시간만 */
  skills?: { labInterpretation?: (LabResult & { computedAt: string; basedOn: string[] }) | null } | null;
}

interface SoapDraft extends SkillEnvelope {
  assessment: string;
  plan: string | string[];
  confidence: number | null;
  references: string[];
  /**
   * 서버 제안 원장(`AiProposal`) id — 있으면 이 초안의 노출·수락/거부가 원장에 남는다(기획서 §2.1).
   * 🔴 스트리밍 SOAP 경로는 제안을 만들지 않는다(다른 EP) → null 이고, 그때는 아무것도 보고하지 않는다.
   */
  proposalId?: string | null;
}

interface LabFinding {
  test: string;
  interpretation: string;
  severity: string;
}

interface LabResult extends SkillEnvelope {
  summary: string;
  findings: LabFinding[];
  clinicalImplication: string;
  suggestedActions: string[];
  confidence: number | null;
}

/** 서버 DUR 정본 재검증 판정 — LLM 문자열이 아니다. `UNRESOLVED`=약가마스터 미매칭(오더 불가) · `null`=미검증 */
type DurVerdict = 'PASS' | 'WARNING' | 'BLOCK' | 'UNRESOLVED';
interface DrugRec {
  name: string;
  dosage: string;
  reason: string;
  guideline: string;
  cdssCheck?: string;
  modelNote?: string;
  durVerdict?: DurVerdict | null;
  durVerdictBasis?: string;
  durWarnings?: Array<{ type?: string; severity?: string; message: string }>;
  medicationCodeId?: string;
  resolvedName?: string;
  /**
   * 약가마스터 매칭 방식(서버 `drug-verdict.ts`) — 없을 수 있다(구버전 응답).
   * `INGREDIENT_GROUP` 은 상품이 아니라 **성분 대표 1건**으로 판정했다는 뜻이라 화면이 그렇게 말한다.
   */
  resolution?: 'EXACT' | 'INGREDIENT_GROUP' | 'AMBIGUOUS' | 'NONE' | string;
}

interface SuggestedOrderSetItem { type: string; name: string; code?: string; medicationCodeId?: string; procedureCodeId?: string; dosage?: string; frequency?: string; duration?: number; route?: string; certType?: string; required?: boolean; isDefault?: boolean }
interface DrugResult extends SkillEnvelope {
  recommendations: DrugRec[];
  contraindicated: string[];
  orderSetSuggested: string | null;
  // P3-a: 서버가 DB 재검증 후 동봉하는 실 약속처방(items 포함) — 클릭 적용용
  orderSet?: { id: string; code: string; name: string; items: SuggestedOrderSetItem[]; ageGroup?: string; contraindications?: Array<{ note?: string }> } | null;
}

interface ChartQaIssue {
  category: string;
  level: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  suggestion?: string;
}

interface ChartQaResult extends SkillEnvelope {
  score: number;
  grade: string;
  level: string;
  totalIssues: number;
  issues: ChartQaIssue[];
}

interface EducationSection {
  heading: string;
  content: string;
}

interface EducationResult {
  title: string;
  sections: EducationSection[];
  precautions: string[];
  followUpCriteria: string[];
  summary: string;
}

interface ClinicalQaResult {
  answer: string;
  evidenceLevel: string;
  keyPoints: string[];
  references: string[];
  relatedQuestions: string[];
}

interface KnowledgeItem {
  id: string;
  title: string;
  category: string;
  content: string;
  relevance: number;
  source?: string;
}

interface KnowledgeSearchResult {
  results: KnowledgeItem[];
  totalCount: number;
}

type KnowledgeCategory = 'drug' | 'guideline' | 'disease' | 'procedure' | 'icd10' | '전체';

/**
 * 스킬 **품질 임계** 적용(기획서 §6-1 · 서버 정본 `GET /api/v1/ai/skill-quality`).
 * 운영이 `/admin/ai-settings` 에서 정한 임계에 미달한 스킬을 화면이 어떻게 다룰지 — `WARN`(경고) · `HIDE`(탭 내림).
 *
 * 🔴 `HIDE` 여도 **조용히 없애지 않는다.** 탭은 남고, 왜 내렸는지를 화면이 밝힌다("막으면 방치된다").
 * 🔴 조회에 실패하면 임계를 **적용하지 않는다**(NONE). 다만 그것을 `.catch(() => 기본값)` 으로 삼키지 않고
 *    `qualityState` 로 구분한다 — "임계가 없다"와 "임계를 못 읽었다"는 다른 사실이다.
 */
type SkillQualityEffect = 'NONE' | 'WARN' | 'HIDE';
interface SkillQualityRow { skill: string; label?: string; status?: string; effect?: string; basis?: string }
interface SkillQuality { windowDays?: number; generatedAt?: string; skills?: SkillQualityRow[] }
/** 탭 → 서버 스킬 enum. 여기 없는 탭은 임계 대상이 아니다 */
const TAB_SKILL: Partial<Record<AiTab, string>> = {
  ddx: 'RealtimeDdx', soap: 'AutoSoap', lab: 'InterpretLab', drug: 'RecommendDrugs',
};

/** 펼침 여부 기억 — 기본은 접힘, 한 번 펼치면 다음 진료에서도 펼친 상태로 */
const AI_PANEL_OPEN_KEY = 'encounter.aiPanel.open';
/** 접힘 바에 무엇이 들어 있는지 — 열기 전에 알 수 있게(탭 라벨과 같은 어휘) */
const AI_FEATURE_HINT = '감별진단 · SOAP초안 · 검사해석 · 약물추천 · 기록품질 · 환자설명 · 자동기록';

const URGENCY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-500 text-white',
  HIGH: 'bg-orange-500 text-white',
  MODERATE: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-green-100 text-green-800',
};

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-600 bg-red-50',
  HIGH: 'text-orange-600 bg-orange-50',
  MODERATE: 'text-yellow-700 bg-yellow-50',
  NORMAL: 'text-green-600 bg-green-50',
};

interface AiAssistantPanelProps {
  patientId: string;
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  /**
   * @param meta 초안 출처 — `proposalId` 가 있으면 부모가 적용(수락) 사실을 **제안 원장**에도 남긴다.
   *   추론·자동기록 탭은 제안을 만들지 않으므로 meta 없이 부른다(가산적 인자 — 기존 호출부 그대로 동작).
   */
  /** false 를 돌려주면 반영하지 않은 것이다(의사가 덮어쓰기를 취소) — '반영되었습니다'라고 말하지 않는다 */
  onApplySoap?: (assessment: string, plan: string, meta?: { proposalId?: string | null }) => boolean | void;
  onApplyDiagnosis?: (code: string, name: string) => void;
  /**
   * 🔴 **프리필**이지 오더 생성이 아니다(§4.5) — 부모는 처방 탭으로 전환하고 검색어를 채운다.
   *    실제 처방은 처방 폼이 만든다(DUR·승인 토큰·step-up 은 처방 파이프 정본이 강제 — 우회 금지).
   *    무슨 일이 일어났는지는 **실제로 그 일을 한 부모**가 말한다(패널은 성공 토스트를 띄우지 않는다).
   */
  onOrderDrug?: (drugName: string, dosage: string, medicationCodeId?: string) => void;
  onOrderTest?: (testName: string) => void;
  onApplyOrderSet?: (items: SuggestedOrderSetItem[], orderSetId?: string, meta?: { name?: string; ageGroup?: string; contraindications?: Array<{ note?: string }> }) => void;
  encounterId: string | null;
}

const REASON_LABEL: Record<string, string> = {
  EMPTY_RESULT: '결과 없음(모델이 빈 응답)',
  PARSE_FAILED: '응답 형식 오류',
  TIMEOUT: '시간 초과',
  UPSTREAM_ERROR: 'AI 서버 오류',
  UPSTREAM_FALLBACK: '규칙 기반 대체(AI 소견 아님)',
  // 🔴 401/403 — 재시도로 풀리지 않는다(관리자가 키를 교체해야 한다). "서버 오류"와 다른 사실이라 다르게 말한다.
  UPSTREAM_AUTH: 'AI 서버 키 인증 실패 — 관리자 키 교체 필요',
};
const VERIFY_LABEL: Record<string, string> = {
  KOREAN: '한국어 아님', LAB_DIRECTION: '검사 방향 반전', ONLY_PROVIDED_TESTS: '보내지 않은 검사 언급', SEX_AGE: '성별/연령 부적합', FORBIDDEN_ADVICE: '금칙 조언',
};
function reasonText(r?: string) {
  if (!r) return '';
  if (r.startsWith('VERIFY_REJECTED:')) {
    const rule = r.slice('VERIFY_REJECTED:'.length).replace(/\(.*$/, '');
    return `검증 실패 — ${VERIFY_LABEL[rule] ?? rule}`;
  }
  return REASON_LABEL[r] ?? r;
}
/**
 * 스킬 출처 고지 — AI(검증 통과·지연) / FALLBACK(사유·실패 규칙) / UNAVAILABLE(산출 불가). 조용한 빈 화면 대신 이것이 뜬다.
 */
export function SkillNotice({ env, className = '' }: { env: SkillEnvelope | null | undefined; className?: string }) {
  const tAttr = useTAttr();
  if (!env || !env.source) return null;
  const sec = env.latencyMs != null ? formatNum(env.latencyMs / 1000, 'seconds') : null;
  // 실시간 응답 캐시 적중 — 지금 계산한 것처럼 그리지 않는다(캐시 시각을 함께 낸다)
  const cachedTag = env.cached ? <span className="text-gray-400" data-skill-cached title={tAttr("같은 입력에 대한 최근 응답을 재사용했습니다")}>캐시{env.cachedAt ? <> · <KDate value={env.cachedAt} mode="time" /></> : null}</span> : null;
  if (env.source === 'AI') {
    return (
      <div className={`flex flex-wrap items-center gap-2 text-[11px] text-gray-500 ${className}`} data-skill-source="AI">
        <AiOriginLabel note={null} />
        <span>검증 통과{env.verify?.passed?.length ? ` ${env.verify.passed.length}규칙` : ''}{sec ? ` · ${sec}` : ''}</span>
        {env.groundedOn?.length ? <span className="text-gray-400" title={env.groundedOn.join(' · ')}>근거 {env.groundedOn.length}축</span> : null}
        {cachedTag}
      </div>
    );
  }
  if (env.source === 'UNAVAILABLE') {
    return <div className={`rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5 text-[11px] text-gray-600 ${className}`} data-skill-source="UNAVAILABLE">산출 불가 — {reasonText(env.reason) || '원자료 없음'} {cachedTag}</div>;
  }
  const failed = env.verify?.failed ?? [];
  return (
    <div className={`rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800 ${className}`} data-skill-source="FALLBACK">
      <span className="font-semibold">{AI_ORIGIN_TEXT} 소견으로 쓸 수 없음</span> — {reasonText(env.reason)}{sec ? ` · ${sec}` : ''} {cachedTag}
      {failed.length > 0 && <div className="mt-0.5 text-amber-700">실패 규칙: {failed.map((f) => { const k = f.replace(/\(.*$/, ''); return VERIFY_LABEL[k] ?? f; }).join(' · ')}</div>}
      <div className="mt-0.5 text-amber-700/80"><T k="아래 내용은 참고로만 접어 둡니다 — 적용 버튼은 비활성입니다." /></div>
    </div>
  );
}

/**
 * 관계 모드 배지(§7.2) — 정본 `ai-skill-modes.ts`. 탭이 사람과 어떤 관계로 일하는지 화면이 말한다.
 * 범례는 tooltip 하나로(4모드 · 자동실행 없음).
 */
export function SkillModeBadge({ tab, className = '' }: { tab: AiTab; className?: string }) {
  const tAttr = useTAttr();
  const def = AI_SKILL_MODES[tab];
  const legend = AI_SKILL_MODE_ORDER.map((m) => `${m}: ${AI_SKILL_MODE_MEANING[m]}`).join('\n');
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} data-skill-mode={skillModeText(tab)}>
      {def.modes.map((m, i) => (
        <span key={m} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[9px] text-gray-400" aria-hidden="true">→</span>}
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${AI_SKILL_MODE_TONE[m]}`} title={`${m} — ${AI_SKILL_MODE_MEANING[m]}`}>{m}</span>
        </span>
      ))}
      <span className="text-[10px] text-gray-400 cursor-help" title={`관계 모드 범례\n${legend}\n(자동실행 모드는 이 화면에 없습니다 — 기본 금지)`} aria-label={tAttr("관계 모드 범례")}>ⓘ</span>
    </span>
  );
}

/** 검사해석 본문 — 사전 해석(배치 B)과 실시간 해석이 같은 렌더를 쓴다(정본 하나) */
function LabInterpretationBody({ r }: { r: LabResult }) {
  return (
    <>
      {r.summary && (
        <div className="bg-indigo-50 rounded-xl p-3">
          <p className="text-xs font-bold text-indigo-700">{r.summary}</p>
        </div>
      )}
      {r.findings?.map((f, i) => (
        <div key={i} className="flex items-start gap-2 py-1">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_COLOR[f.severity] ?? ''}`}>
            {f.severity}
          </span>
          <div>
            <p className="text-xs font-medium text-gray-800">{f.test}</p>
            <p className="text-[10px] text-gray-500">{f.interpretation}</p>
          </div>
        </div>
      ))}
      {r.clinicalImplication && (
        <div className="bg-amber-50 rounded-xl p-3">
          <p className="text-xs text-amber-800">{r.clinicalImplication}</p>
        </div>
      )}
      {r.suggestedActions?.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="추가 조치" /></p>
          {r.suggestedActions.map((a, i) => (
            <p key={i} className="text-xs text-indigo-600">- {a}</p>
          ))}
        </div>
      )}
    </>
  );
}

/** DUR 판정 배지 — 서버 정본 판정만. 색은 판정마다 하나, 근거는 title */
const DUR_BADGE: Record<DurVerdict, { label: string; cls: string }> = {
  PASS: { label: 'DUR 통과', cls: 'bg-green-100 text-green-700' },
  WARNING: { label: 'DUR 주의', cls: 'bg-amber-100 text-amber-700' },
  BLOCK: { label: 'DUR 차단', cls: 'bg-rose-100 text-rose-700' },
  UNRESOLVED: { label: '약가마스터 미매칭', cls: 'bg-gray-100 text-gray-500' },
};
function durBadgeOf(v: DurVerdict | null | undefined) {
  return (v && DUR_BADGE[v]) || { label: 'DUR 미검증', cls: 'bg-gray-100 text-gray-500' };
}

export function AiAssistantPanel({ patientId, soap, onApplySoap, onApplyDiagnosis, onOrderDrug, onOrderTest, onApplyOrderSet, encounterId }: AiAssistantPanelProps) {
  const tAttr = useTAttr();
  // 기본은 **접힘** — 진료 입력이 주 작업이고 보조는 필요할 때 연다.
  // 최초 렌더를 항상 접힘으로 두고 저장값은 effect 에서 복원(서버 렌더와 어긋나지 않게).
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem(AI_PANEL_OPEN_KEY) === '1') setCollapsed(false); } catch { /* 저장소 차단 환경 */ }
  }, []);
  const toggle = (next: boolean) => {
    setCollapsed(next);
    try { localStorage.setItem(AI_PANEL_OPEN_KEY, next ? '0' : '1'); } catch { /* 무시 */ }
  };
  const [activeTab, setActiveTab] = useState<AiTab>('ddx');

  // 하이브리드 배치 A — 환자 AI 브리핑(결정론·LLM 없음·Redis 사전계산 또는 lazy). 기준 시각·근거 축을 화면이 말한다(§3.3 최신성)
  // 접힌 상태에서도 한 번 읽는다 — 감시 배지("검사 이상 n"·"알레르기 미문진")의 유일한 근거이고, HIS 안 조회라 AI 서버로 PHI 가 나가지 않는다.
  // 🔴 LLM 스킬(realtime-ddx 등)은 여전히 **펼친 뒤에만** 부른다(아래 effect 의 `if (collapsed) return`).
  const [brief, setBrief] = useState<PatientBrief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const loadBrief = useCallback((refresh = false) => {
    if (!patientId) return;
    setBriefError(null);
    apiClient.get<{ data: PatientBrief | null }>(`/api/v1/ai/brief/${patientId}${refresh ? '?refresh=1' : ''}`)
      .then((r) => { const d = (r.data as unknown as Record<string, unknown>)?.data ?? r.data; setBrief((d as PatientBrief | null) ?? null); })
      .catch((e: { message?: string }) => setBriefError(e?.message ?? '브리핑 조회 실패'));
  }, [patientId]);
  useEffect(() => {
    if (!patientId) return;
    loadBrief(false);
  }, [patientId, loadBrief]);

  // 스킬 품질 임계(§6-1) — 패널을 **펼칠 때 1회**만 읽는다(접힌 패널은 아무것도 그리지 않으므로 부를 이유가 없다).
  // 🔴 실패해도 패널은 정상 동작한다. 다만 실패를 기본값으로 접지 않고 상태로 남긴다(임계 미적용 ≠ 조회 실패).
  const [quality, setQuality] = useState<SkillQuality | null>(null);
  const [qualityState, setQualityState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  useEffect(() => {
    if (collapsed) return;
    if (qualityState !== 'idle') return;
    setQualityState('loading');
    apiClient.get<{ data: SkillQuality }>('/api/v1/ai/skill-quality')
      .then((r) => {
        const d = (r.data as unknown as Record<string, unknown>)?.data ?? r.data;
        setQuality((d as SkillQuality) ?? null);
        setQualityState('loaded');
      })
      .catch(() => setQualityState('error'));
  }, [collapsed, qualityState]);

  /** 이 탭의 서버 판정 행 — 없으면 null(임계 대상 아님 · 미보고 · 조회 실패) */
  const qualityRowOf = useCallback((tab: AiTab): SkillQualityRow | null => {
    const key = TAB_SKILL[tab];
    if (!key || !quality?.skills?.length) return null;
    return quality.skills.find((s) => s?.skill === key) ?? null;
  }, [quality]);
  /** 화면에 적용할 효과 — 서버가 말한 것만. 모르면 NONE(아무것도 내리지 않는다) */
  const qualityEffectOf = useCallback((tab: AiTab): SkillQualityEffect => {
    const e = qualityRowOf(tab)?.effect;
    return e === 'WARN' || e === 'HIDE' ? e : 'NONE';
  }, [qualityRowOf]);

  // 피드백(탭별 👍/👎)
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 'GOOD' | 'BAD'>>({});
  const sendFeedback = useCallback(async (feature: string, rating: 'GOOD' | 'BAD', aiResponse?: string) => {
    setFeedbackGiven((f) => ({ ...f, [feature]: rating }));
    try { await apiClient.post('/api/v1/ai/feedback', { feature, rating, aiResponse: aiResponse?.slice(0, 2000) }); } catch { /* silent */ }
  }, []);

  // DDx state
  const [ddxResult, setDdxResult] = useState<DdxResult | null>(null);
  const [ddxLoading, setDdxLoading] = useState(false);
  // 🔴 실패는 실패라고 말한다(§7.9) — 종전 `catch {}` 가 타임아웃·오류를 "아직 안 눌렀다"처럼 그렸다
  const [ddxError, setDdxError] = useState<string | null>(null);
  const ddxTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ddxAbortRef = useRef<AbortController | null>(null);
  // 제안 칩("감별진단 대기")으로 연 경우 — 디바운스 없이 즉시 1회(펼친 뒤에만 실행되는 것은 같다)
  const ddxImmediateRef = useRef(false);

  // SOAP draft state
  const [soapDraft, setSoapDraft] = useState<SoapDraft | null>(null);
  const [soapLoading, setSoapLoading] = useState(false);
  const [soapStreaming, setSoapStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [useStreaming, setUseStreaming] = useState(false);

  // Lab interpretation state
  const [labResult, setLabResult] = useState<LabResult | null>(null);
  const [labLoading, setLabLoading] = useState(false);

  // Drug recommendation state
  const [drugResult, setDrugResult] = useState<DrugResult | null>(null);
  const [drugLoading, setDrugLoading] = useState(false);

  // Chart QA state
  const [chartQaResult, setChartQaResult] = useState<ChartQaResult | null>(null);
  const [chartQaLoading, setChartQaLoading] = useState(false);

  // Patient Education state
  const [eduResult, setEduResult] = useState<EducationResult | null>(null);
  const [eduLoading, setEduLoading] = useState(false);
  // 복사 실패 시 본문을 선택해 주기 위한 참조 — "복사됨"을 거짓으로 말하지 않기 위한 폴백
  const eduBodyRef = useRef<HTMLDivElement>(null);

  // Clinical Q&A state
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatResult, setChatResult] = useState<ClinicalQaResult | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  // Knowledge Search state
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeCategory, setKnowledgeCategory] = useState<KnowledgeCategory>('전체');
  const [knowledgeResult, setKnowledgeResult] = useState<KnowledgeSearchResult | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeDetail, setKnowledgeDetail] = useState<KnowledgeItem | null>(null);

  // Auto DDx on S/O change (debounced 2s)
  const fetchDdx = useCallback(async () => {
    if (!patientId || !soap.subjective || soap.subjective.length < 5) return;
    // 이전 요청 취소 — 늦게 도착한 응답이 새 입력 결과를 덮어쓰는 경합 방지
    ddxAbortRef.current?.abort();
    const controller = new AbortController();
    ddxAbortRef.current = controller;
    setDdxLoading(true);
    setDdxError(null);
    // 20초 SLA(기획서 §4.2) — 넘으면 TIMEOUT 으로 말한다
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await apiClient.fetch<{ data: DdxResult }>('/api/v1/ai/realtime-ddx', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          subjective: soap.subjective,
          objective: soap.objective || undefined,
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const data = (res.data as unknown as Record<string, unknown>)?.data as DdxResult ?? res.data;
      setDdxResult(data);
    } catch (e) {
      // 새 입력으로 취소된 것은 실패가 아니다 — 그 외(타임아웃·오류)는 화면에 말한다
      if (ddxAbortRef.current === controller) {
        setDdxError(controller.signal.aborted ? `시간 초과(20초) — ${AI_ORIGIN_TEXT} 서버가 제때 응답하지 않았습니다` : `호출 실패 — ${(e as { message?: string })?.message ?? '원인 미상'}`);
      }
    } finally {
      clearTimeout(timeoutId);
      if (ddxAbortRef.current === controller) setDdxLoading(false);
    }
  }, [patientId, soap.subjective, soap.objective]);

  useEffect(() => {
    // 🔴 접힌 패널에서는 자동 호출하지 않는다 — 결과를 볼 화면이 없는데 AI 서버로 PHI 가 나가고 있었다.
    if (collapsed) return;
    // 운영이 품질 미달로 내린 스킬은 자동으로도 부르지 않는다(내렸는데 뒤에서 계속 도는 일이 없게)
    if (qualityEffectOf('ddx') === 'HIDE') return;
    if (!soap.subjective || soap.subjective.length < 5) return;
    if (ddxTimer.current) clearTimeout(ddxTimer.current);
    const delay = ddxImmediateRef.current ? 0 : 2000;
    ddxImmediateRef.current = false;
    ddxTimer.current = setTimeout(fetchDdx, delay);
    return () => { if (ddxTimer.current) clearTimeout(ddxTimer.current); };
  }, [collapsed, soap.subjective, soap.objective, fetchDdx, qualityEffectOf]);

  /**
   * 노출 보고(PRESENTED) — 🔴 **실제로 그려질 때만** 1회. 서버가 만든 것(GENERATED)과 사람이 본 것은 다른 사실이고,
   * 둘을 섞으면 감독 화면의 "검토 시간"이 통째로 거짓이 된다(shared `AI_PROPOSAL_STATUS_EFFECT`).
   * 그래서 초안이 생겼다는 것만으로 보내지 않고 **패널이 펼쳐져 있고 SOAP 탭이 활성일 때**만 보낸다.
   * 재렌더로 여러 번 가지 않게 제안 id 로 기억한다(서버도 멱등이지만 호출 자체를 줄인다).
   */
  const soapPresentedRef = useRef<string | null>(null);
  useEffect(() => {
    const pid = soapDraft?.proposalId;
    if (!pid || collapsed || activeTab !== 'soap') return;
    if (soapPresentedRef.current === pid) return;
    soapPresentedRef.current = pid;
    void markProposalPresented(pid, 'encounter-new');
  }, [soapDraft?.proposalId, collapsed, activeTab]);

  const handleAutoSoap = async () => {
    if (!soap.subjective) return toast.warning('S 내용을 먼저 입력하세요.');
    setSoapLoading(true);
    try {
      const res = await apiClient.post<{ data: SoapDraft }>('/api/v1/ai/auto-soap', {
        patientId,
        subjective: soap.subjective,
        objective: soap.objective || undefined,
        differentials: ddxResult?.differentials,
        // 제안 원장의 대상 — 재진입(기존 진료)이면 그 진료에 붙는다. 신규는 아직 없어 보내지 않는다(서버가 미확정으로 밝힘)
        ...(encounterId ? { encounterId } : {}),
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as SoapDraft ?? res.data;
      // 🔴 없으면 null 이다 — 화면이 제안 id 를 지어내지 않는다(원장에 못 남긴 사실은 그대로 둔다)
      setSoapDraft({ ...data, proposalId: proposalIdFrom(data) ?? proposalIdFrom(res.data) });
      setActiveTab('soap');
    } catch {
      toast.error('SOAP 초안 생성 실패');
    } finally {
      setSoapLoading(false);
    }
  };

  const handleStreamingSoap = async () => {
    if (!soap.subjective) return toast.warning('S 내용을 먼저 입력하세요.');
    setSoapStreaming(true);
    setStreamingText('');
    setSoapDraft(null);
    setActiveTab('soap');
    try {
      // 정본 토큰 키는 'accessToken'(api-client) — 종전 'token' 오기로 스트리밍이 항상 401이었음(2026-07-07 검토)
      const token = apiClient.getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const text = `S: ${soap.subjective}\nO: ${soap.objective || ''}`;
      const response = await fetch(`${apiUrl}/api/v1/ai/summarize/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, specialty: 'general' }),
      });
      if (!response.ok) {
        // 429 AI_UPSTREAM_BUSY(서버가 Retry-After 로 2회 다시 보낸 뒤에도 바쁨)는 고장과 다른 말로
        if (response.status === 429) {
          toast.warning('AI 서버가 바쁩니다 — 잠시 후 다시 시도하세요');
          return;
        }
        throw new Error('Stream request failed');
      }
      const streamed = await readAiTextStream(response.body!, 'response', setStreamingText);
      if (!streamed.ok) {
        setStreamingText('');
        if (streamed.busy) toast.warning('AI 서버가 바쁩니다 — 잠시 후 다시 시도하세요');
        else toast.error('스트리밍 SOAP 생성 실패');
        return;
      }
      // 상류는 SOAP 을 JSON 문자열로 흘려보낸다 — 종전 `A:/P:` 줄 찾기로는 초안이 만들어진 적이 없다
      const sections = soapFromStreamText(streamed.text);
      if (!sections) toast.warning('AI 응답에서 A·P 를 찾지 못했습니다 — 초안을 만들지 않았습니다');
      else {
        // 🔴 신뢰도는 **모델 자기보고**다. 스트리밍 경로는 모델이 신뢰도를 준 적이 없다 —
        //    종전 `0.7` 은 화면이 지어낸 상수였다(P15). 미보고는 `null` 로 두고 표시부가 '미보고'라 말한다.
        setSoapDraft({ assessment: sections.assessment, plan: sections.plan, confidence: null, references: [] });
      }
    } catch {
      toast.error('스트리밍 SOAP 생성 실패');
    } finally {
      setSoapStreaming(false);
    }
  };

  const handleInterpretLab = async () => {
    setLabLoading(true);
    try {
      // 최근 검사 결과 조회
      const labRes = await apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/lab/patients/${patientId}/results`);
      const labData = (labRes.data as unknown as Record<string, unknown>)?.data ?? labRes.data;
      const recent = Array.isArray(labData) ? labData[0] : labData;

      if (!recent?.items?.length) {
        toast.warning('최근 검사 결과가 없습니다.');
        setLabLoading(false);
        return;
      }

      const results = recent.items.map((item: Record<string, unknown>) => ({
        testName: item.testName,
        value: item.value,
        unit: item.unit || undefined,
        normalMin: item.normalMin || item.refMin || undefined,
        normalMax: item.normalMax || item.refMax || undefined,
        // 🔴 LIS flag(H/L/HH/LL) 가 방향의 정본 — 종전엔 안 보내서 모델이 K 5.9 를 "저하"라 답했다(2026-08-19 실측)
        flag: (item.flag as string | undefined) || undefined,
      }));

      const res = await apiClient.post<{ data: LabResult }>('/api/v1/ai/interpret-lab', {
        patientId,
        results,
        clinicalContext: soap.subjective || undefined,
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as LabResult ?? res.data;
      setLabResult(data);
      setActiveTab('lab');
    } catch {
      toast.error('검사 해석 실패');
    } finally {
      setLabLoading(false);
    }
  };

  const handleRecommendDrugs = async () => {
    if (!soap.assessment) return toast.warning('A (진단) 내용을 먼저 입력하세요.');
    setDrugLoading(true);
    try {
      const res = await apiClient.post<{ data: DrugResult }>('/api/v1/ai/recommend-drugs', {
        patientId,
        // 🔴 현 진료를 넘긴다. 종전엔 빠져 있어 서버가 **다른(과거) 진료**를 기준으로
        //    임신 여부·현 처방을 읽고 DUR 재검증을 했다(같은 파일 chart-qa 는 넘기고 있었다).
        encounterId: encounterId || undefined,
        diagnosis: soap.assessment,
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as DrugResult ?? res.data;
      setDrugResult(data);
      setActiveTab('drug');
    } catch {
      toast.error('약물 추천 실패');
    } finally {
      setDrugLoading(false);
    }
  };

  const handleChartQa = async () => {
    // encounterId 없이도(저장 전) 폼 값으로 본다 — 종전엔 조용히 return 이라 새 진료에서 버튼이 아무 일도 안 했다
    setChartQaLoading(true);
    try {
      const res = await apiClient.post<{ data: ChartQaResult }>('/api/v1/ai/chart-qa', {
        encounterId: encounterId || undefined,
        subjective: soap.subjective,
        objective: soap.objective || undefined,
        assessment: soap.assessment || undefined,
        plan: soap.plan || undefined,
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as ChartQaResult ?? res.data;
      setChartQaResult(data);
      setActiveTab('qa');
    } catch {
      toast.error('품질검사 실패');
    } finally {
      setChartQaLoading(false);
    }
  };

  const handlePatientEducation = async () => {
    if (!soap.assessment) return toast.warning('A (진단) 내용을 먼저 입력하세요.');
    setEduLoading(true);
    try {
      const res = await apiClient.post<{ data: EducationResult }>('/api/v1/ai/patient-education', {
        diagnosis: soap.assessment,
        treatmentPlan: soap.plan || undefined,
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as EducationResult ?? res.data;
      setEduResult(data);
      setActiveTab('edu');
    } catch {
      toast.error('설명문 생성 실패');
    } finally {
      setEduLoading(false);
    }
  };

  /**
   * 설명문 복사 — 🔴 복사가 실패해도 "복사되었습니다"라고 말하지 않는다.
   * 종전엔 클립보드 쓰기를 **기다리지도 않고** 성공 토스트를 띄웠다(권한 거부·비보안 컨텍스트에서 거짓말).
   * 실패하면 본문을 선택해 두고(사람이 Ctrl+C 로 복사할 수 있게) 실패했다고 말한다.
   */
  const copyEducation = async () => {
    if (!eduResult) return;
    const text = [
      eduResult.title,
      '',
      ...(eduResult.sections ?? []).map((s) => `[${s.heading}]\n${s.content}`),
      '',
      eduResult.precautions?.length ? `[주의사항]\n${eduResult.precautions.map((p) => `- ${p}`).join('\n')}` : '',
      eduResult.followUpCriteria?.length ? `[재방문 기준]\n${eduResult.followUpCriteria.map((c) => `- ${c}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('클립보드 사용 불가');
      await navigator.clipboard.writeText(text);
      toast.success('클립보드에 복사되었습니다');
    } catch {
      let selected = false;
      try {
        const el = eduBodyRef.current;
        const sel = typeof window !== 'undefined' ? window.getSelection() : null;
        if (el && sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          selected = true;
        }
      } catch { /* 선택도 실패 — 그래도 성공했다고 말하지 않는다 */ }
      toast.error(selected
        ? '복사하지 못했습니다 — 본문을 선택해 두었습니다. Ctrl+C(⌘C)로 복사하세요.'
        : '복사하지 못했습니다 — 본문을 직접 선택해 복사하세요.');
    }
  };

  const handleClinicalQa = async () => {
    if (!chatQuestion.trim()) return;
    setChatLoading(true);
    try {
      const res = await apiClient.post<{ data: ClinicalQaResult }>('/api/v1/ai/clinical-qa', {
        question: chatQuestion,
        patientContext: soap.subjective ? `S: ${soap.subjective.slice(0, 200)}` : undefined,
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as ClinicalQaResult ?? res.data;
      setChatResult(data);
    } catch {
      toast.error(`${AI_ORIGIN_TEXT} 답변 실패`);
    } finally {
      setChatLoading(false);
    }
  };

  const handleKnowledgeSearch = async () => {
    if (!knowledgeQuery.trim()) return;
    setKnowledgeLoading(true);
    setKnowledgeDetail(null);
    try {
      const res = await apiClient.post<{ data: KnowledgeSearchResult }>('/api/v1/ai/knowledge/search', {
        query: knowledgeQuery.trim(),
        category: knowledgeCategory === '전체' ? undefined : knowledgeCategory,
        limit: 5,
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as KnowledgeSearchResult ?? res.data;
      setKnowledgeResult(data);
    } catch {
      toast.error('지식 검색 실패');
    } finally {
      setKnowledgeLoading(false);
    }
  };

  // 스킬 라우터(감시 모드 · §4.3) — 결정론. 브리핑·폼 값·이미 받은 결과만 보고 "지금 돌릴 근거가 있다"를 센다.
  // 🔴 접힌 상태에서 LLM 을 부르지 않는다 — 배지는 호출 결과가 아니라 호출 **근거**의 개수다.
  const suggestions: SkillSuggestion[] = computeSkillSuggestions({
    brief, soap, hasDdxResult: !!ddxResult, hasDrugResult: !!drugResult, hasLabResult: !!labResult,
  });
  const openSuggestion = (sg: SkillSuggestion) => {
    if (sg.runOnOpen && sg.tab === 'ddx') ddxImmediateRef.current = true;
    setActiveTab(sg.tab);
    if (collapsed) toggle(false);
  };
  const renderSuggestionChips = (max: number, dark = false) => (
    <>
      {suggestions.slice(0, max).map((sg) => (
        <button key={`${sg.tab}:${sg.label}`} type="button" onClick={() => openSuggestion(sg)} title={sg.reason}
          data-suggestion-tab={sg.tab}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${dark ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
          {sg.label}
        </button>
      ))}
      {suggestions.length > max && <span className={`text-[10px] ${dark ? 'text-white/70' : 'text-gray-400'}`}>+{suggestions.length - max}</span>}
    </>
  );

  if (collapsed) {
    // 접힘 바 — 종전엔 큰 빈 카드에 'WeRU.B ⌄' 만 떠 있어 무엇이 열리는지 알 수 없었다.
    // 감시 배지("제안 N")와 제안 칩은 여기서도 보인다 — 칩을 누르면 펼치고 그 탭으로 간다.
    return (
      <div className="flex w-full items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-2 shadow-sm transition-colors hover:border-indigo-200" data-ai-panel-collapsed>
        <button
          type="button"
          onClick={() => toggle(false)}
          aria-expanded={false}
          title={`${AI_ORIGIN_TEXT} 진료 보조 펼치기`}
          className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" />
            </svg>
          </span>
          <span className="text-xs font-semibold text-gray-800">{AI_ORIGIN_TEXT} 진료 보조</span>
          {suggestions.length > 0 ? (
            <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white" data-suggestion-count={suggestions.length}
              title={suggestions.map((sg) => `${sg.label} — ${sg.reason}`).join('\n')}>제안 {suggestions.length}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">{AI_FEATURE_HINT}</span>
          )}
        </button>
        {suggestions.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {renderSuggestionChips(3)}
          </div>
        )}
        <button type="button" onClick={() => toggle(false)} aria-expanded={false} className="group flex shrink-0 items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600">
          <T k="펼치기" />
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    );
  }

  // 탭별 피드백 위젯
  const FeedbackRow = ({ feature, response }: { feature: string; response?: string }) => {
    const given = feedbackGiven[feature];
    return (
      <div className="flex items-center gap-2 pt-2 mt-2 border-t border-gray-50 text-[11px] text-gray-400">
        <span><T k="도움이 되었나요?" /></span>
        <button onClick={() => sendFeedback(feature, 'GOOD', response)} disabled={!!given}
          className={`px-1.5 py-0.5 rounded ${given === 'GOOD' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100'}`}>👍</button>
        <button onClick={() => sendFeedback(feature, 'BAD', response)} disabled={!!given}
          className={`px-1.5 py-0.5 rounded ${given === 'BAD' ? 'bg-red-100 text-red-600' : 'hover:bg-gray-100'}`}>👎</button>
        {given && <span className="text-gray-300"><T k="감사합니다" /></span>}
      </div>
    );
  };

  // 현재 탭에 적용되는 품질 판정(§6-1) — 서버가 말한 것만. 조회 실패·미보고면 NONE 이다.
  const activeQualityRow = qualityRowOf(activeTab);
  const activeEffect = qualityEffectOf(activeTab);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" />
            </svg>
          </div>
          <span className="text-sm font-bold text-white">{AI_ORIGIN_TEXT} 진료 보조</span>
          {(ddxLoading || soapLoading || soapStreaming || labLoading || drugLoading) && (
            <span className="text-xs text-white/70 animate-pulse"><T k="처리중..." /></span>
          )}
          {suggestions.length > 0 && (
            <span className="flex items-center gap-1 ml-1" data-suggestion-count={suggestions.length}>
              <span className="text-[10px] font-semibold text-white/80" title={tAttr("감시 모드 — 지금 돌릴 근거가 있는 스킬(호출 결과가 아니라 근거의 개수)")}>제안 {suggestions.length}</span>
              {renderSuggestionChips(4, true)}
            </span>
          )}
        </div>
        <button onClick={() => toggle(true)} aria-expanded title={tAttr("접기")}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/15 hover:text-white">
          <T k="접기" />
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* 환자 브리핑(배치 A) — 종전 "AI 인지 · 복용약물 2" 배지는 알레르기 3상태·검사·활력을 말하지 않았다. 기준 시각·근거 축·못 센 축을 함께 낸다 */}
      {briefError && (
        <div className="px-3 py-1.5 bg-rose-50 border-b border-rose-100 text-[11px] text-rose-700">브리핑을 불러오지 못했습니다 — {briefError} <button onClick={() => loadBrief(true)} className="underline ml-1"><T k="재시도" /></button></div>
      )}
      {brief && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-indigo-50/60 border-b border-indigo-100 text-[11px]" data-brief-trigger={brief.trigger}>
          <span className="text-indigo-500 font-medium"><T k="브리핑" /></span>
          <span className="text-indigo-300" title={`근거: ${brief.basis.join(' · ')}`}>{brief.trigger === 'BATCH' ? '야간 배치' : brief.trigger === 'REFRESH' ? '재계산' : '즉시 계산'} · <KDate value={brief.computedAt} mode="datetime" /> 기준</span>
          <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${brief.allergy.status === 'HAS_ALLERGIES' ? 'bg-red-100 text-red-700' : brief.allergy.status === 'NO_KNOWN_ALLERGIES' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`} title={brief.allergy.items.join(', ') || undefined}>
            {brief.allergy.status === 'HAS_ALLERGIES' ? `알레르기 ${brief.allergy.items.length}` : brief.allergy.status === 'NO_KNOWN_ALLERGIES' ? '알레르기 없음(문진 확인)' : brief.allergy.status === 'UNABLE_TO_ASSESS' ? '알레르기 확인 불가' : brief.allergy.status === 'UNAVAILABLE' ? '알레르기 조회 불가' : '알레르기 미문진'}
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap" title={brief.activeMedications.join(', ') || '없음'}>활성약 {brief.activeMedications.length}</span>
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap" title={brief.activeProblems.join(', ') || '없음'}>활성문제 {brief.activeProblems.length}</span>
          <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${brief.abnormalLabCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'}`} title={brief.recentLabs.filter((l) => l.flag && l.flag !== 'N').map((l) => `${l.testName} ${l.value}${l.unit ?? ''}(${l.flag})`).join(', ') || '이상 없음'}>
            검사 이상 {brief.abnormalLabCount}/{brief.recentLabs.length}(30일)
          </span>
          {brief.latestVitals && (
            <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap" title={`측정 ${brief.latestVitals.measuredAt}`}>
              활력 {brief.latestVitals.systolicBp ?? '—'}/{brief.latestVitals.diastolicBp ?? '—'} · HR {brief.latestVitals.heartRate ?? '—'} · SpO2 {brief.latestVitals.spo2 ?? '—'}
            </span>
          )}
          {brief.unavailable.length > 0 && <span className="text-rose-500" title={brief.unavailable.join(', ')}>못 센 축 {brief.unavailable.length}</span>}
          <button onClick={() => loadBrief(true)} className="ml-auto text-indigo-400 hover:text-indigo-600 underline"><T k="재계산" /></button>
        </div>
      )}

      {/* Tabs - 2 rows */}
      <div className="border-b border-gray-100">
        <div className="flex">
          {([
            { key: 'ddx' as AiTab, label: '감별진단', count: ddxResult?.differentials?.length },
            { key: 'soap' as AiTab, label: 'SOAP초안' },
            { key: 'lab' as AiTab, label: '검사해석' },
            { key: 'drug' as AiTab, label: '약물추천' },
          ]).map(tab => {
            // 🔴 품질 임계 — 내려도 탭은 남는다(숨기면 사람이 이유를 모른 채 방치된다). 상태 점은 색만으로 말하지 않는다(title 필수).
            const eff = qualityEffectOf(tab.key);
            const qRow = qualityRowOf(tab.key);
            return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              data-tab-quality-effect={eff}
              title={eff === 'HIDE' ? `품질 미달로 내림 — ${qRow?.basis ?? '운영이 정한 임계에 미달했습니다'}`
                : eff === 'WARN' ? `품질 경고 — ${qRow?.basis ?? '검증 통과율이 임계 미만입니다'}` : undefined}
              className={`flex-1 py-2 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : eff === 'HIDE'
                    ? 'border-transparent text-gray-300 hover:text-gray-500'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {tab.label}
              {eff === 'WARN' && (
                <span className="ml-0.5 text-[10px] text-amber-600" aria-hidden="true">●</span>
              )}
              {eff === 'HIDE' && (
                <span className="ml-0.5 text-[9px] bg-gray-200 text-gray-600 px-1 py-0.5 rounded-full font-semibold whitespace-nowrap"><T k="품질 미달로 내림" /></span>
              )}
              {eff !== 'HIDE' && tab.count != null && tab.count > 0 && (
                <span className="ml-0.5 text-[9px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded-full">{tab.count}</span>
              )}
            </button>
            );
          })}
        </div>
        <div className="flex">
          {([
            { key: 'qa' as AiTab, label: '기록품질', badge: chartQaResult ? chartQaResult.grade : undefined },
            { key: 'edu' as AiTab, label: '환자설명' },
            { key: 'reasoning' as AiTab, label: '추론' },
            { key: 'autorecord' as AiTab, label: '자동기록' },
            { key: 'chat' as AiTab, label: `${AI_ORIGIN_TEXT}질문` },
            { key: 'knowledge' as AiTab, label: '지식검색' },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {tab.label}
              {tab.badge && (
                <span className={`ml-0.5 text-[9px] px-1 py-0.5 rounded-full font-bold ${
                  tab.badge === 'A' ? 'bg-green-100 text-green-700' :
                  tab.badge === 'B' ? 'bg-blue-100 text-blue-700' :
                  tab.badge === 'C' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[600px] overflow-y-auto space-y-3">
        {/* 관계 모드(§7.2) — 이 탭이 사람과 어떤 관계로 일하는지. 정본 ai-skill-modes.ts */}
        <div className="flex items-center justify-between gap-2 -mt-1">
          <span className="text-[11px] font-semibold text-gray-700">{AI_SKILL_MODES[activeTab].label}</span>
          <SkillModeBadge tab={activeTab} />
        </div>

        {/* 🔴 품질 임계 미달(§6-1) — 경고는 결과 위에, 내림은 결과 자리에 **사유**를 그린다. 조용히 사라지는 탭은 없다. */}
        {activeEffect === 'WARN' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800" role="status" data-quality-effect="WARN">
            <span className="font-semibold">품질 임계 미달</span> — 이 스킬은 {quality?.windowDays == null ? '최근' : `최근 ${quality.windowDays}일`} 검증 통과율이 임계 미만입니다
            {activeQualityRow?.basis ? ` — ${activeQualityRow.basis}` : ''}. 결과를 특히 주의해서 확인하세요.
          </div>
        )}
        {activeEffect === 'HIDE' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-[11px] text-rose-800" role="status" data-quality-effect="HIDE">
            <p className="text-xs font-semibold">
              {activeQualityRow?.label || AI_SKILL_MODES[activeTab].label} 은(는) 품질 임계 미달로 운영이 내렸습니다
              {activeQualityRow?.basis ? ` — ${activeQualityRow.basis}` : ''}.
            </p>
            <p className="mt-1">관리자 &gt; AI 설정에서 임계를 조정할 수 있습니다.</p>
            <p className="mt-1 text-rose-700/80"><T k="내린 동안 이 스킬은 실행되지 않습니다 — 탭을 없애지 않는 이유는, 숨기면 왜 안 나오는지 알 수 없기 때문입니다." /></p>
          </div>
        )}

        {/* DDx Tab */}
        {activeTab === 'ddx' && activeEffect !== 'HIDE' && (
          <>
            {ddxLoading && (
              <div className="flex items-center justify-center py-6">
                <svg className="animate-spin h-5 w-5 text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span className="ml-2 text-xs text-indigo-500"><T k="감별진단 분석 중..." /></span>
              </div>
            )}

            {!ddxLoading && ddxError && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700" role="status">
                {ddxError}
                <button onClick={fetchDdx} className="ml-2 underline"><T k="재시도" /></button>
              </div>
            )}
            {!ddxLoading && ddxResult && <SkillNotice env={ddxResult} />}
            {!ddxLoading && !ddxError && !ddxResult && (
              <div className="text-center py-6">
                <p className="text-xs text-gray-400"><T k="S/O 입력 시 자동으로 감별진단이 표시됩니다." /></p>
                <button onClick={fetchDdx} disabled={!soap.subjective}
                  className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-50">
                  <T k="수동 분석" />
                </button>
              </div>
            )}
            {!ddxLoading && !ddxError && ddxResult && !ddxResult.differentials?.length && ddxResult.source !== 'FALLBACK' && (
              <p className="text-center text-xs text-gray-400 py-3"><T k="감별진단이 비어 있습니다." /></p>
            )}

            {/* Red Flags */}
            {ddxResult?.redFlags && ddxResult.redFlags.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-xs font-bold text-red-700 mb-1">Red Flags</p>
                {ddxResult.redFlags.map((flag, i) => (
                  <p key={i} className="text-xs text-red-600">- {flag}</p>
                ))}
              </div>
            )}

            {/* Differentials */}
            {ddxResult?.differentials?.map((dx) => (
              <div key={dx.rank} className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${URGENCY_COLOR[dx.urgency] ?? 'bg-gray-100 text-gray-600'}`}>
                      {dx.urgency}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{dx.rank}. {dx.name}</span>
                  </div>
                  <span className="text-sm font-bold text-indigo-600">{dx.probability}<Unit>%</Unit></span>
                </div>
                {dx.code && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 font-mono">{dx.code}</span>
                    {onApplyDiagnosis && (
                      <button onClick={() => { onApplyDiagnosis(dx.code, dx.name); toast.success(`${dx.code} ${dx.name} 진단 적용`); }}
                        className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 font-medium"><T k="진단 적용" /></button>
                    )}
                  </div>
                )}
                {dx.reasoning && <p className="text-xs text-gray-600">{dx.reasoning}</p>}
                {dx.keyFindings && dx.keyFindings.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {dx.keyFindings.map((f, i) => (
                      <span key={i} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{f}</span>
                    ))}
                  </div>
                )}
                {dx.suggestedQuestions && dx.suggestedQuestions.length > 0 && (
                  <div className="mt-1">
                    <p className="text-[10px] font-medium text-gray-500"><T k="추가 확인 질문:" /></p>
                    {dx.suggestedQuestions.map((q, i) => (
                      <p key={i} className="text-[10px] text-indigo-500">? {q}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Suggested Tests */}
            {ddxResult?.suggestedTests && ddxResult.suggestedTests.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-bold text-gray-700 mb-2"><T k="권장 검사" /></p>
                {ddxResult.suggestedTests.map((test, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      test.priority === 'STAT' ? 'bg-red-500 text-white' : test.priority === 'URGENT' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-600'
                    }`}>{test.priority}</span>
                    <span className="text-xs text-gray-800 flex-1">{test.name}</span>
                    <span className="text-[10px] text-gray-400">{test.reason}</span>
                    {onOrderTest && (
                      // 🔴 P16 봉합 — 종전 `검사 오더 추가` 성공 토스트는 거짓이었다(아무것도 생성되지 않는다).
                      //    이 버튼은 검사 탭 프리필이고, 결과는 프리필을 실제로 수행한 부모가 말한다.
                      <button onClick={() => onOrderTest(test.name)}
                        title={tAttr("검사 탭으로 전환하고 검색어를 채웁니다 — 오더 확정은 검사 폼에서 합니다")}
                        className="min-h-[44px] text-[10px] px-2 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 font-medium whitespace-nowrap flex-shrink-0"><T k="검사 폼에 채우기" /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* SOAP Draft Tab */}
        {activeTab === 'soap' && activeEffect !== 'HIDE' && (
          <>
            {/* Streaming toggle */}
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useStreaming}
                  onChange={e => setUseStreaming(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-[10px] text-gray-500"><T k="스트리밍 생성" /></span>
              </label>
            </div>

            {/* Generate buttons */}
            {useStreaming ? (
              <button onClick={handleStreamingSoap} disabled={soapStreaming || !soap.subjective}
                className="w-full py-2 text-xs font-medium bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100 disabled:opacity-50">
                {soapStreaming ? `${AI_ORIGIN_TEXT} 스트리밍 생성 중...` : `${AI_ORIGIN_TEXT} SOAP 스트리밍 생성`}
              </button>
            ) : (
              <button onClick={handleAutoSoap} disabled={soapLoading || !soap.subjective}
                className="w-full py-2 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50">
                {soapLoading ? `${AI_ORIGIN_TEXT} 초안 생성 중...` : `${AI_ORIGIN_TEXT} SOAP 초안 생성`}
              </button>
            )}

            {/* Streaming output */}
            {soapStreaming && streamingText && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-violet-500 uppercase mb-1"><T k="스트리밍 출력" /></p>
                <p className="text-xs text-gray-800 whitespace-pre-wrap">{streamingText}<span className="animate-pulse">|</span></p>
              </div>
            )}

            {soapDraft && (
              <div className="space-y-3">
                <SkillNotice env={soapDraft} />
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-1"><T k="Assessment (평가)" /></p>
                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{soapDraft.assessment}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-1"><T k="Plan (계획)" /></p>
                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{Array.isArray(soapDraft.plan) ? soapDraft.plan.join('\n') : soapDraft.plan}</p>
                </div>
                {soapDraft.references?.length > 0 && (
                  <p className="text-[10px] text-indigo-500">참고: {soapDraft.references.join(', ')}</p>
                )}
                <div className="flex items-center justify-between">
                  {/* 🔴 신뢰도는 모델 자기보고 — 없으면 0% 가 아니라 '미보고' */}
                  <span className="text-[10px] text-gray-400">모델 자기보고 신뢰도: {soapDraft.confidence == null ? '미보고' : <>{Math.round(soapDraft.confidence * 100)}<Unit>%</Unit></>}</span>
                  <div className="flex gap-2">
                    {/* 검증 실패(FALLBACK)면 폼에 넣지 않는다 — 실측: 영어 SOAP + ACS 아스피린 회피가 그대로 들어갈 뻔했다 */}
                    <button onClick={() => { const ok = onApplySoap?.(soapDraft.assessment, Array.isArray(soapDraft.plan) ? soapDraft.plan.join('\n') : soapDraft.plan, { proposalId: soapDraft.proposalId ?? null }); if (ok !== false) toast.success('SOAP에 반영되었습니다.'); }}
                      disabled={soapDraft.source != null && soapDraft.source !== 'AI'}
                      title={soapDraft.source != null && soapDraft.source !== 'AI' ? '검증을 통과하지 못한 초안은 적용할 수 없습니다' : undefined}
                      className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      <T k="차트에 적용" />
                    </button>
                    {/* 🔴 '무시'는 **명시적 거부**다 — 만료(결정 없이 지나감)와 섞으면 거부율이 통째로 거짓이 된다.
                        사유는 강제하지 않는다(필수로 강제하면 거짓 사유가 쌓인다 — shared 규약). */}
                    <button onClick={() => {
                      const pid = soapDraft.proposalId;
                      if (pid) void decideProposal(pid, { decision: 'REJECTED', clientContext: 'encounter-new' });
                      setSoapDraft(null); setStreamingText('');
                    }}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                      <T k="무시" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!soapDraft && !soapLoading && !soapStreaming && !streamingText && (
              <p className="text-xs text-gray-400 text-center py-4">S/O 입력 후 {AI_ORIGIN_TEXT} 초안 생성 버튼을 클릭하세요.</p>
            )}
          </>
        )}

        {/* Lab Interpretation Tab */}
        {activeTab === 'lab' && activeEffect !== 'HIDE' && (() => {
          // 배치 B 사전 해석(야간·검증층 통과분) — 있으면 먼저 보이고, 실시간 결과가 오면 그 아래로 내려간다(둘 다 기준 시각을 말한다)
          const pre = brief?.skills?.labInterpretation ?? null;
          return (
          <>
            {pre && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2" data-lab-precomputed>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-indigo-700">
                    <T k="사전 해석" /> <span className="font-normal text-indigo-500">(야간 배치 · <KDate value={pre.computedAt} mode="datetime" /> 기준{pre.basedOn?.length ? ` · ${pre.basedOn.join(' · ')}` : ''})</span>
                  </span>
                  <button onClick={handleInterpretLab} disabled={labLoading}
                    className="min-h-[44px] px-3 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {labLoading ? '해석 중...' : '지금 다시 해석'}
                  </button>
                </div>
                <SkillNotice env={pre} />
                <LabInterpretationBody r={pre} />
              </div>
            )}
            {!pre && (
              <button onClick={handleInterpretLab} disabled={labLoading}
                className="w-full py-2 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50">
                {labLoading ? '검사 결과 분석 중...' : `최근 검사 결과 ${AI_ORIGIN_TEXT} 해석`}
              </button>
            )}

            {labResult && (
              <div className="space-y-3">
                {pre && <p className="text-[11px] font-semibold text-gray-700"><T k="실시간 해석" /></p>}
                <SkillNotice env={labResult} />
                <LabInterpretationBody r={labResult} />
              </div>
            )}

            {!labResult && !labLoading && !pre && (
              <p className="text-xs text-gray-400 text-center py-4">버튼을 클릭하여 최근 검사 결과를 {AI_ORIGIN_TEXT}로 해석합니다.</p>
            )}
          </>
          );
        })()}

        {/* Drug Recommendation Tab */}
        {activeTab === 'drug' && activeEffect !== 'HIDE' && (
          <>
            <button onClick={handleRecommendDrugs} disabled={drugLoading || !soap.assessment}
              className="w-full py-2 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50">
              {drugLoading ? '약물 추천 분석 중...' : `${AI_ORIGIN_TEXT} 약물 추천`}
            </button>

            {drugResult && (
              <div className="space-y-3">
                <SkillNotice env={drugResult} />
                {drugResult.recommendations?.map((rec, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-900">{rec.name}</span>
                      <div className="flex items-center gap-1">
                        {/* 🔴 DUR 판정은 서버 정본 결과(durVerdict)만 — LLM 문자열 "PASS"(cdssCheck) 를 초록으로 그리지 않는다.
                            PASS 초록 · WARNING 황색 · BLOCK 적색 · UNRESOLVED(약가마스터 미매칭)/null(미검증) 회색. 근거는 title */}
                        {(() => { const b = durBadgeOf(rec.durVerdict); return (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${b.cls}`} data-dur-verdict={rec.durVerdict ?? 'null'}
                            title={rec.durVerdictBasis ?? (rec.durVerdict == null ? 'DUR 정본 재검증 결과가 없습니다' : undefined)}>{b.label}</span>
                        ); })()}
                        {/* 성분 대표 판정 — 상품 1건이 아니라 성분 그룹 대표로 DUR 을 본 것이면 그렇게 말한다(필드가 없을 수 있다) */}
                        {rec.resolution === 'INGREDIENT_GROUP' && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 whitespace-nowrap"
                            data-drug-resolution="INGREDIENT_GROUP"
                            title={rec.durVerdictBasis ?? '같은 성분의 대표 품목으로 판정했습니다 — 실제 처방 품목은 처방 폼에서 고릅니다'}>성분 대표 판정</span>
                        )}
                        {onOrderDrug && (() => {
                          // 화면 정직성 — 차단/미매칭 약은 프리필도 하지 않는다. 처방 파이프의 DUR 게이트는 그대로 따로 강제된다(이건 게이트가 아니다)
                          const blocked = rec.durVerdict === 'BLOCK' || rec.durVerdict === 'UNRESOLVED';
                          const why = rec.durVerdict === 'BLOCK' ? `DUR 차단 — ${rec.durVerdictBasis ?? '처방 파이프에서도 차단됩니다'}`
                            : rec.durVerdict === 'UNRESOLVED' ? '약가마스터에 매칭되지 않은 약명 — 처방 폼에서 직접 검색하세요'
                            : '처방 탭으로 전환하고 검색어를 채웁니다 — 처방 확정은 처방 폼에서 합니다(DUR·승인 적용)';
                          // 🔴 P16 봉합 — 종전 `처방 추가` 성공 토스트는 거짓이었다(부모는 안내 토스트만 띄웠고 아무것도 추가되지 않았다).
                          return (
                            <button onClick={() => onOrderDrug(rec.resolvedName || rec.name, rec.dosage, rec.medicationCodeId)}
                              disabled={blocked} title={why}
                              className="min-h-[44px] text-[10px] px-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"><T k="처방 폼에 채우기" /></button>
                          );
                        })()}
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-600">{rec.dosage}</p>
                    {rec.resolvedName && rec.resolvedName !== rec.name && <p className="text-[10px] text-gray-500">약가마스터 매칭: {rec.resolvedName}</p>}
                    <p className="text-[10px] text-indigo-500">{rec.reason}</p>
                    {rec.guideline && <p className="text-[9px] text-gray-400">근거: {rec.guideline}</p>}
                    {rec.modelNote && <p className="text-[10px] text-gray-500">모델 메모: {rec.modelNote}</p>}
                    {rec.durWarnings && rec.durWarnings.length > 0 && (
                      <div className="mt-1 space-y-0.5" data-dur-warnings>
                        {rec.durWarnings.slice(0, 3).map((w, wi) => (
                          <p key={wi} className={`text-[10px] ${['ERROR', 'BLOCK', 'CONTRAINDICATED', 'CRITICAL'].includes(String(w.severity ?? '').toUpperCase()) ? 'text-rose-700' : 'text-amber-700'}`}>
                            <span className="font-semibold">{w.type ? `[${w.type}] ` : ''}</span>{w.message}
                          </p>
                        ))}
                        {rec.durWarnings.length > 3 && <p className="text-[10px] text-gray-400">외 {rec.durWarnings.length - 3}건 — 처방 폼에서 전체 확인</p>}
                      </div>
                    )}
                  </div>
                ))}

                {drugResult.contraindicated?.length > 0 && (
                  <div className="bg-red-50 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-red-700 mb-1">금기/주의</p>
                    {drugResult.contraindicated.map((c, i) => (
                      <p key={i} className="text-xs text-red-600">- {c}</p>
                    ))}
                  </div>
                )}

                {drugResult.orderSet ? (
                  <div className="flex items-center justify-between bg-indigo-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-[10px] text-indigo-600">
                      <T k="관련 약속처방:" /> <span className="font-medium">{drugResult.orderSet.name}</span>
                      <span className="ml-1 font-mono text-indigo-400">{drugResult.orderSet.code}</span>
                    </span>
                    {onApplyOrderSet && (
                      <button type="button"
                        onClick={() => onApplyOrderSet(drugResult.orderSet!.items ?? [], drugResult.orderSet!.id,
                          { name: drugResult.orderSet!.name, ageGroup: drugResult.orderSet!.ageGroup, contraindications: drugResult.orderSet!.contraindications })}
                        className="px-2 py-0.5 text-[10px] font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 whitespace-nowrap">
                        <T k="적용 (검토 모달)" />
                      </button>
                    )}
                  </div>
                ) : drugResult.orderSetSuggested && (
                  <p className="text-[10px] text-indigo-500">관련 약속처방: {drugResult.orderSetSuggested}</p>
                )}
              </div>
            )}

            {!drugResult && !drugLoading && (
              <p className="text-xs text-gray-400 text-center py-4">A (진단) 입력 후 {AI_ORIGIN_TEXT} 약물 추천 버튼을 클릭하세요.</p>
            )}
          </>
        )}
        {/* Chart QA Tab */}
        {activeTab === 'qa' && (
          <>
            {/* encounterId 없이도(저장 전) 폼 값으로 본다 — 종전 disabled 조건이 서버가 이미 허용하는 경로를 막고 있었다 */}
            <button onClick={handleChartQa} disabled={chartQaLoading || !(soap.subjective || soap.objective || soap.assessment || soap.plan)}
              className="w-full py-2 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50">
              {chartQaLoading ? '품질검사 중...' : '의무기록 품질검사'}
            </button>

            {chartQaResult && (
              <div className="space-y-3">
                <SkillNotice env={chartQaResult} />
                {/* Score */}
                <div className={`rounded-xl p-4 text-center ${
                  chartQaResult.grade === 'A' ? 'bg-green-50' :
                  chartQaResult.grade === 'B' ? 'bg-blue-50' :
                  chartQaResult.grade === 'C' ? 'bg-amber-50' : 'bg-red-50'
                }`}>
                  <p className={`text-3xl font-black ${
                    chartQaResult.grade === 'A' ? 'text-green-600' :
                    chartQaResult.grade === 'B' ? 'text-blue-600' :
                    chartQaResult.grade === 'C' ? 'text-amber-600' : 'text-red-600'
                  }`}>{chartQaResult.score}점</p>
                  <p className="text-xs text-gray-500 mt-1">등급 {chartQaResult.grade} / 이슈 {chartQaResult.totalIssues}<Unit>건</Unit></p>
                </div>

                {/* Issues */}
                {chartQaResult.issues.map((issue, i) => (
                  <div key={i} className={`rounded-xl p-3 ${
                    issue.level === 'ERROR' ? 'bg-red-50 border border-red-200' :
                    issue.level === 'WARNING' ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        issue.level === 'ERROR' ? 'bg-red-600 text-white' :
                        issue.level === 'WARNING' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white'
                      }`}>{issue.level}</span>
                      <span className="text-[10px] text-gray-500">{issue.category}</span>
                    </div>
                    <p className="text-xs text-gray-800">{issue.message}</p>
                    {issue.suggestion && <p className="text-[10px] text-indigo-500 mt-1">{issue.suggestion}</p>}
                  </div>
                ))}

                {chartQaResult.totalIssues === 0 && (
                  // 제안할 것이 없다는 뜻이지 기록이 우수하다는 보증이 아니다(감시 모드 · 최종 판단은 작성자)
                  <p className="text-xs text-gray-500 text-center py-2"><T k="제안할 기록품질 이슈가 없습니다 — 기록 내용의 보증은 아닙니다" /></p>
                )}
              </div>
            )}

            {!chartQaResult && !chartQaLoading && (
              <p className="text-xs text-gray-400 text-center py-4"><T k="서명 전 의무기록 품질을 검사합니다." /></p>
            )}
          </>
        )}

        {/* Patient Education Tab */}
        {activeTab === 'edu' && (
          <>
            <button onClick={handlePatientEducation} disabled={eduLoading || !soap.assessment}
              className="w-full py-2 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50">
              {eduLoading ? '설명문 생성 중...' : '환자 설명문 생성'}
            </button>

            {eduResult && (
              <div className="space-y-3">
                <div ref={eduBodyRef} className="space-y-3">
                <div className="bg-indigo-50 rounded-xl p-3">
                  <p className="text-sm font-bold text-indigo-800">{eduResult.title}</p>
                  {eduResult.summary && <p className="text-xs text-indigo-600 mt-1">{eduResult.summary}</p>}
                </div>

                {eduResult.sections?.map((sec, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs font-bold text-gray-700 mb-1">{sec.heading}</p>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap">{sec.content}</p>
                  </div>
                ))}

                {eduResult.precautions?.length > 0 && (
                  <div className="bg-amber-50 rounded-xl p-3">
                    <p className="text-xs font-bold text-amber-700 mb-1"><T k="주의사항" /></p>
                    {eduResult.precautions.map((p, i) => (
                      <p key={i} className="text-xs text-amber-600">- {p}</p>
                    ))}
                  </div>
                )}

                {eduResult.followUpCriteria?.length > 0 && (
                  <div className="bg-red-50 rounded-xl p-3">
                    <p className="text-xs font-bold text-red-700 mb-1"><T k="이런 경우 즉시 방문하세요" /></p>
                    {eduResult.followUpCriteria.map((c, i) => (
                      <p key={i} className="text-xs text-red-600">- {c}</p>
                    ))}
                  </div>
                )}
                </div>

                {/* 🔴 이 탭에는 **발행 경로가 없다**(검수 큐 미구축 — 스키마·사람 게이트). 없는 것을 있는 척하는 '발행' 버튼을 두지 않는다(가짜 게이트 금지). */}
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800" data-edu-no-publish>
                  {AI_ORIGIN_TEXT} 초안입니다 — 환자 발행 경로가 아직 없습니다(검수 큐 미구축). 필요하면 내용을 복사해 기존 문서 경로로 발행하세요.
                </p>

                <button onClick={copyEducation}
                  className="w-full min-h-[44px] text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                  <T k="설명문 복사" />
                </button>
              </div>
            )}

            {!eduResult && !eduLoading && (
              <p className="text-xs text-gray-400 text-center py-4"><T k="A (진단) 입력 후 환자 설명문을 생성합니다." /></p>
            )}
          </>
        )}

        {/* Clinical Q&A Tab */}
        {activeTab === 'chat' && (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatQuestion}
                onChange={e => setChatQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleClinicalQa()}
                placeholder={tAttr("임상 질문을 입력하세요...")}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button onClick={handleClinicalQa} disabled={chatLoading || !chatQuestion.trim()}
                className="px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 shrink-0">
                {chatLoading ? '...' : '질문'}
              </button>
            </div>

            {chatResult && (
              <div className="space-y-3 mt-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      chatResult.evidenceLevel === 'A' ? 'bg-green-100 text-green-700' :
                      chatResult.evidenceLevel === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>근거 {chatResult.evidenceLevel}</span>
                  </div>
                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{chatResult.answer}</p>
                </div>

                {chatResult.keyPoints?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="핵심 포인트" /></p>
                    {chatResult.keyPoints.map((k, i) => (
                      <p key={i} className="text-xs text-indigo-600">- {k}</p>
                    ))}
                  </div>
                )}

                {chatResult.references?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="참고문헌" /></p>
                    {chatResult.references.map((r, i) => (
                      <p key={i} className="text-[10px] text-gray-400">{i + 1}. {r}</p>
                    ))}
                  </div>
                )}

                {chatResult.relatedQuestions?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="관련 질문" /></p>
                    {chatResult.relatedQuestions.map((q, i) => (
                      <button key={i} onClick={() => { setChatQuestion(q); handleClinicalQa(); }}
                        className="block text-xs text-indigo-500 hover:text-indigo-700 hover:underline">
                        ? {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!chatResult && !chatLoading && (
              <div className="text-center py-4">
                <p className="text-xs text-gray-400 mb-2"><T k="임상 질문 예시:" /></p>
                {['NSTEMI 초기 치료 프로토콜?', '고령 환자 항응고제 선택?', 'eGFR 30 이하 메트포르민 사용?'].map((q, i) => (
                  <button key={i} onClick={() => setChatQuestion(q)}
                    className="block mx-auto text-[10px] text-indigo-500 hover:text-indigo-700 hover:underline mb-1">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Knowledge Search Tab */}
        {activeTab === 'knowledge' && (
          <>
            {knowledgeDetail ? (
              <div className="space-y-3">
                <button onClick={() => setKnowledgeDetail(null)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  <T k="목록으로" />
                </button>
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                      knowledgeDetail.category === 'drug' ? 'bg-green-100 text-green-700' :
                      knowledgeDetail.category === 'guideline' ? 'bg-blue-100 text-blue-700' :
                      knowledgeDetail.category === 'disease' ? 'bg-red-100 text-red-700' :
                      knowledgeDetail.category === 'procedure' ? 'bg-purple-100 text-purple-700' :
                      knowledgeDetail.category === 'icd10' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                    }`}>{knowledgeDetail.category}</span>
                    <span className="text-[10px] text-gray-400">관련도 {Math.round(knowledgeDetail.relevance * 100)}<Unit>%</Unit></span>
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 mb-2">{knowledgeDetail.title}</h4>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{knowledgeDetail.content}</p>
                  {knowledgeDetail.source && (
                    <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-200">출처: {knowledgeDetail.source}</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={knowledgeCategory}
                      onChange={(e) => setKnowledgeCategory(e.target.value as KnowledgeCategory)}
                      className="px-2 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                    >
                      <option value="전체"><T k="전체" /></option>
                      <option value="drug"><T k="약물" /></option>
                      <option value="guideline"><T k="가이드라인" /></option>
                      <option value="disease"><T k="질환" /></option>
                      <option value="procedure"><T k="시술" /></option>
                      <option value="icd10">ICD-10</option>
                    </select>
                    <input
                      type="text"
                      value={knowledgeQuery}
                      onChange={(e) => setKnowledgeQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleKnowledgeSearch()}
                      placeholder={tAttr("검색어를 입력하세요...")}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <button onClick={handleKnowledgeSearch} disabled={knowledgeLoading || !knowledgeQuery.trim()}
                      className="px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 shrink-0">
                      {knowledgeLoading ? '...' : '검색'}
                    </button>
                  </div>
                </div>

                {knowledgeLoading && (
                  <div className="flex items-center justify-center py-6">
                    <svg className="animate-spin h-5 w-5 text-indigo-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span className="ml-2 text-xs text-indigo-500"><T k="검색 중..." /></span>
                  </div>
                )}

                {knowledgeResult && !knowledgeLoading && (
                  <div className="space-y-2 mt-2">
                    <p className="text-[10px] text-gray-400">{knowledgeResult.totalCount}<Unit>건</Unit> <T k="검색됨" /></p>
                    {knowledgeResult.results?.length === 0 && (
                      <EmptyState icon="🔍" title="검색 결과가 없습니다." />
                    )}
                    {knowledgeResult.results?.map((item) => (
                      <button key={item.id} onClick={() => setKnowledgeDetail(item)}
                        className="w-full text-left bg-gray-50 rounded-xl p-3 hover:bg-indigo-50 transition-colors space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-900 line-clamp-1">{item.title}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-2 whitespace-nowrap ${
                            item.category === 'drug' ? 'bg-green-100 text-green-700' :
                            item.category === 'guideline' ? 'bg-blue-100 text-blue-700' :
                            item.category === 'disease' ? 'bg-red-100 text-red-700' :
                            item.category === 'procedure' ? 'bg-purple-100 text-purple-700' :
                            item.category === 'icd10' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                          }`}>{item.category}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(item.relevance * 100)}%` }} />
                          </div>
                          <span className="text-[9px] text-gray-400 shrink-0">{Math.round(item.relevance * 100)}<Unit>%</Unit></span>
                        </div>
                        <p className="text-[10px] text-gray-500 line-clamp-2">{item.content}</p>
                      </button>
                    ))}
                  </div>
                )}

                {!knowledgeResult && !knowledgeLoading && (
                  <div className="text-center py-6">
                    <p className="text-xs text-gray-400 mb-2"><T k="의학 지식을 검색하세요" /></p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {['메트포르민 용법', '고혈압 가이드라인', 'J06.9', '위내시경'].map((q, i) => (
                        <button key={i} onClick={() => setKnowledgeQuery(q)}
                          className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-500 rounded-full hover:bg-indigo-100">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* 5단계 추론 체인 */}
        {activeTab === 'reasoning' && (
          <ReasoningTab patientId={patientId} soap={soap} onApplySoap={onApplySoap} />
        )}

        {/* 자동 의무기록 */}
        {activeTab === 'autorecord' && (
          <AutoRecordTab soap={soap} onApplySoap={onApplySoap} />
        )}

        {/* 탭별 피드백(결과 있을 때) */}
        {activeTab === 'ddx' && ddxResult && <FeedbackRow feature="ddx" response={JSON.stringify(ddxResult).slice(0, 2000)} />}
        {activeTab === 'lab' && labResult && <FeedbackRow feature="lab" response={JSON.stringify(labResult).slice(0, 2000)} />}
        {activeTab === 'drug' && drugResult && <FeedbackRow feature="drug" response={JSON.stringify(drugResult).slice(0, 2000)} />}
        {activeTab === 'soap' && soapDraft && <FeedbackRow feature="soap" response={JSON.stringify(soapDraft).slice(0, 2000)} />}
      </div>

      {/* Footer — SaMD 책임귀속 고지 */}
      <div className="px-4 py-2 bg-amber-50/60 border-t border-amber-100">
        {/* 🔴 브랜드만 쓰면 AI 산출물이라는 사실이 가려진다(AI기본법 §31) — "AI"를 병기한다.
            문구는 정본 부품이 낸다(하드코딩하면 운영이 config 로 고쳐도 이 화면만 옛 문구로 남는다). */}
        <p className="text-[11px] text-amber-700 text-center flex items-center justify-center gap-1.5 flex-wrap">
          <AiOriginLabel variant="inline" />
          <span>— 임상 <b>참고·보조 도구</b>입니다. 진단·처방의 <b>최종 판단과 책임은 담당 의사</b>에게 있습니다.</span>
        </p>
      </div>
    </div>
  );
}

/* ── 5단계 추론 체인 탭 ── */
function ReasoningTab({ patientId, soap, onApplySoap }: { patientId: string; soap: any; onApplySoap?: (a: string, p: string) => boolean | void }) {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const symptoms = soap.subjective?.split(/[,，、\n]/).map((s: string) => s.trim()).filter(Boolean) ?? [];
      const res = await apiClient.post<any>('/api/v1/ai/reasoning/chain', { symptoms, history: soap.objective ?? '' });
      setResult(res?.data);
    } catch { setResult({ error: '추론 실패' }); }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <button onClick={run} disabled={loading || !soap.subjective}
        className="w-full px-3 py-2 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
        {loading ? '추론 중...' : '5단계 임상 추론 실행'}
      </button>
      {result && !result.error && (
        <div className="space-y-2">
          <SkillNotice env={result} />
          {(result.steps ?? []).map((step: any, i: number) => (
            <div key={i} className="bg-violet-50 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-violet-700">Step {i + 1}. {step.name ?? ''}</p>
              <p className="text-xs text-violet-900 mt-0.5 whitespace-pre-wrap">{step.result ?? JSON.stringify(step)}</p>
            </div>
          ))}
          {result.assessment && result.plan && onApplySoap && result.source === 'AI' && (
            <button onClick={() => onApplySoap(result.assessment, result.plan)}
              className="w-full px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg text-[11px] font-medium hover:bg-violet-200">
              <T k="A/P에 적용" />
            </button>
          )}
        </div>
      )}
      {result?.error && <p className="text-xs text-red-500">{result.error}</p>}
      {!soap.subjective && <p className="text-xs text-gray-400 text-center"><T k="S(주관적 소견)를 입력하면 추론을 실행할 수 있습니다" /></p>}
    </div>
  );
}

/* ── 자동 의무기록 탭 ── */
function AutoRecordTab({ soap, onApplySoap }: { soap: any; onApplySoap?: (a: string, p: string) => boolean | void }) {
  const [conversation, setConversation] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!conversation.trim()) return;
    setLoading(true);
    try {
      const res = await apiClient.post<any>('/api/v1/ai/auto-record', { conversation });
      setResult(res?.data);
    } catch { setResult({ error: '자동 기록 실패' }); }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <textarea value={conversation} onChange={e => setConversation(e.target.value)}
        rows={4} placeholder="진료 대화를 입력하세요...&#10;예: 어디가 불편하세요?&#10;3일 전부터 머리가 아프고 열이 나요..."
        className="w-full border rounded-lg px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-indigo-200" />
      <button onClick={run} disabled={loading || !conversation.trim()}
        className="w-full px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
        {loading ? '변환 중...' : '대화 → SOAP 자동 변환'}
      </button>
      {result && !result.error && (
        <div className="space-y-2">
          {result.soap && (
            <div className="bg-indigo-50 rounded-lg p-2.5 space-y-1">
              <p className="text-[10px] font-bold text-indigo-700"><T k="자동 생성 SOAP" /></p>
              {['subjective', 'objective', 'assessment', 'plan'].map(k => (
                <div key={k}><span className="text-[9px] font-bold text-indigo-500">{k[0].toUpperCase()}:</span> <span className="text-xs text-indigo-900">{result.soap[k] ?? '-'}</span></div>
              ))}
            </div>
          )}
          {result.icd_codes?.length > 0 && (
            <p className="text-xs text-gray-600">ICD-10: {result.icd_codes.join(', ')}</p>
          )}
          {result.prescriptions?.length > 0 && (
            <p className="text-xs text-gray-600">처방 추천: {result.prescriptions.map((p: any) => p.name ?? p).join(', ')}</p>
          )}
          {onApplySoap && result.soap?.assessment && (
            <button onClick={() => onApplySoap(result.soap.assessment, result.soap.plan ?? '')}
              className="w-full px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-medium hover:bg-indigo-200">
              <T k="A/P에 적용" />
            </button>
          )}
        </div>
      )}
      {result?.error && <p className="text-xs text-red-500">{result.error}</p>}
    </div>
  );
}
