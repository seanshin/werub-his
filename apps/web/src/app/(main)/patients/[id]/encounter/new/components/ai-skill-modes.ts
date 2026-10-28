/**
 * 진료 보조 패널 — 스킬(탭)별 **관계 모드**와 결정론 **스킬 라우터**의 정본.
 *
 * 정본 규약: `docs/01-plan/features/clinical-ux-agent-era.plan.md` §7.2 (관계 모드 5종) ·
 *           `docs/01-plan/features/chart-ai-assistant-agent.plan.md` §4.2 (스킬 사양표) · §4.3 (트리거·감시 모드).
 *
 * 🔴 이 파일에는 **자동실행(Auto) 모드가 없다.** §7.2 — 자동실행은 기본 금지이고, 켤 때는 config 게이트·감사·되돌리기가
 *    필요하다(사람 결정 §6-4 미결). 화면이 그 모드를 말할 근거가 없으므로 어휘 자체를 두지 않는다.
 * 🔴 라우터는 **순수 함수**다 — 네트워크 호출·LLM 호출이 없다. 접힌 패널에서 PHI 가 나가지 않게 하는 구조적 보장이
 *    "호출 코드를 안 부른다"가 아니라 "호출할 수단이 이 파일에 없다"여야 가드가 재주입에 실패한다.
 */

export type AiTab = 'ddx' | 'soap' | 'lab' | 'drug' | 'qa' | 'edu' | 'chat' | 'knowledge' | 'reasoning' | 'autorecord';

/** §7.2 다섯 모드 중 화면이 쓰는 넷 — 자동실행은 의도적으로 없다 */
export type AiSkillMode = '감시' | '보조' | '초안' | '실행제안';

/** 모드의 뜻(한 줄) — 배지 tooltip·범례 */
export const AI_SKILL_MODE_MEANING: Record<AiSkillMode, string> = {
  감시: '사람이 놓친 것을 찾아 띄운다 — 입력하지 않고 알리기만 한다',
  보조: '후보를 제안한다 — 사람이 고르기 전에는 아무것도 입력되지 않는다',
  초안: '문서를 미리 쓴다 — 초안 표식이 남고, 서명 전까지 법정기록이 아니다',
  실행제안: '실행 가능한 행위를 만든다 — 실행 버튼은 사람의 것이고 미리보기가 먼저다',
};

export const AI_SKILL_MODE_ORDER: AiSkillMode[] = ['감시', '보조', '초안', '실행제안'];

/** §4.2 스킬 사양표의 "관계 모드" 열 — 탭 10개 전부. `modes` 가 둘이면 '감시→보조'처럼 단계 전이를 뜻한다 */
export const AI_SKILL_MODES: Record<AiTab, { label: string; modes: AiSkillMode[] }> = {
  ddx: { label: '감별진단', modes: ['감시', '보조'] },
  soap: { label: 'SOAP초안', modes: ['초안'] },
  lab: { label: '검사해석', modes: ['보조'] },
  drug: { label: '약물추천', modes: ['실행제안'] },
  qa: { label: '기록품질', modes: ['감시'] },
  edu: { label: '환자설명', modes: ['초안'] },
  reasoning: { label: '추론', modes: ['보조'] },
  autorecord: { label: '자동기록', modes: ['초안'] },
  chat: { label: 'AI질문', modes: ['보조'] },
  knowledge: { label: '지식검색', modes: ['보조'] },
};

export function skillModeText(tab: AiTab): string {
  return AI_SKILL_MODES[tab].modes.join('→');
}

/** 배지 색 — 모드마다 하나(색만 다르고 뜻은 tooltip 이 말한다) */
export const AI_SKILL_MODE_TONE: Record<AiSkillMode, string> = {
  감시: 'bg-sky-100 text-sky-800',
  보조: 'bg-indigo-100 text-indigo-800',
  초안: 'bg-violet-100 text-violet-800',
  실행제안: 'bg-amber-100 text-amber-800',
};

/* ── 스킬 라우터(감시 모드) — 결정론 · 이미 손에 있는 데이터만 본다 ── */

export interface SkillSuggestion {
  /** 눌렀을 때 열 탭 */
  tab: AiTab;
  /** 접힘 바·헤더 칩 문구 */
  label: string;
  /** 왜 제안하는지(툴팁) */
  reason: string;
  /** DDx 는 열자마자 실행(감시 규약 — 패널이 열려 있을 때만 LLM 을 부른다) */
  runOnOpen?: boolean;
}

export interface SkillRouterInput {
  /** 브리핑(배치 A) — 없으면 그 축은 제안하지 않는다(모르는 것을 0 으로 접지 않는다) */
  brief: { abnormalLabCount?: number | null; allergy?: { status?: string | null } | null } | null | undefined;
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  hasDdxResult: boolean;
  hasDrugResult: boolean;
  hasLabResult: boolean;
}

/** S/O 자동 감별진단 최소 글자 수(§4.2 감별진단 트리거) */
export const DDX_SUGGEST_MIN_CHARS = 20;

/**
 * 제안 목록 — 순서는 안전 관련(검사 이상·알레르기 미문진)이 앞.
 * 🔴 여기서는 아무것도 호출하지 않는다. "지금 돌릴 근거가 있다"만 뜻한다(§4.3).
 */
export function computeSkillSuggestions(input: SkillRouterInput): SkillSuggestion[] {
  const out: SkillSuggestion[] = [];
  const brief = input.brief;
  const abnormal = brief?.abnormalLabCount;
  if (typeof abnormal === 'number' && abnormal > 0 && !input.hasLabResult) {
    out.push({ tab: 'lab', label: `검사 이상 ${abnormal}`, reason: `최근 30일 검사 이상 ${abnormal}건 — 검사해석 스킬을 열 근거가 있습니다` });
  }
  if (brief?.allergy?.status === 'NOT_ASSESSED') {
    // 알레르기 문진은 스킬이 아니라 사람의 일 — 탭은 검사해석/약물추천이 아니라 브리핑을 보게 감별진단(기본 탭)으로 연다
    out.push({ tab: 'ddx', label: '알레르기 미문진', reason: '알레르기 상태가 미문진(NOT_ASSESSED)입니다 — 처방 전 문진이 필요합니다(브리핑 헤더 참조)' });
  }
  const s = (input.soap.subjective ?? '').trim();
  if (s.length >= DDX_SUGGEST_MIN_CHARS && !input.hasDdxResult) {
    out.push({ tab: 'ddx', label: '감별진단 대기', reason: `S ${s.length}자 입력됨 — 패널을 열면 감별진단을 실행합니다(접힌 상태에서는 부르지 않습니다)`, runOnOpen: true });
  }
  if ((input.soap.assessment ?? '').trim().length > 0 && !input.hasDrugResult) {
    out.push({ tab: 'drug', label: '약물추천 가능', reason: 'A(진단)가 입력되어 약물추천 스킬을 돌릴 근거가 있습니다(실행제안 — 처방은 사람이 합니다)' });
  }
  return out;
}
