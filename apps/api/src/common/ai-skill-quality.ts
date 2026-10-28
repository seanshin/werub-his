/**
 * 진료 보조 AI **스킬 품질 임계 판정** — 정본. 기획서 `chart-ai-assistant-agent.plan.md` §4.6 계측 · §6-1 사람 게이트.
 *
 * 🔴 왜 있는가: §6-1 은 "검증층 폐기율이 X% 넘는 스킬은 탭에서 내린다"를 **사람 게이트**로 남겨 두었다.
 *    X 를 개발자가 감으로 박으면 그 순간부터 경보는 거짓 경보가 되고, 거짓 경보는 진짜 경보를 죽인다.
 *    그래서 이 파일은 **임계를 정하지 않는다** — 실측(호출 N·AI 통과 N)을 분모와 함께 내고,
 *    위원회가 화면에서 값을 넣으면 그때부터 판정한다(기본 미설정 · 조치 전부 OFF).
 *
 * 규약(어겼다가 걸린 것들을 그대로 막는다)
 *   · **표본 부족으로는 절대 내리지 않는다** — `calls < minCalls` 는 `INSUFFICIENT_SAMPLE`/effect NONE 이다.
 *   · **호출 0 의 통과율은 `0` 이 아니라 `null`** 이다(0 은 "전부 실패했다"라는 다른 사실).
 *   · **맵 게이트에 스칼라를 쓰면 영역별 설정이 통째로 사라진다** — 스칼라·배열은 통째 무시하고 기본 맵을 지킨다.
 *   · 근거 문자열(`basis`)에는 **분모를 반드시** 싣는다.
 *
 * 순수 함수다(모듈 의존 없음 · 테스트 가능).
 */
import { roundBy } from '@hospital-run/shared';
import { gateMode, type GateMode } from './gate-mode';
import { mergeTargetMap } from './qi-targets';

/** 계측 resourceType(`Ai<skill>Outcome`) ↔ config 맵 키 ↔ 화면 라벨 — 세 곳이 갈라지지 않게 한 줄로 묶는다 */
export interface AiQualitySkillDef {
  /** `skillMetrics` 가 내는 스킬명(감사 resourceType 에서 유래) */
  skill: 'RealtimeDdx' | 'AutoSoap' | 'InterpretLab' | 'RecommendDrugs';
  /** config 맵의 키 */
  key: 'realtimeDdx' | 'autoSoap' | 'interpretLab' | 'recommendDrugs';
  /** 화면 라벨(한국어) */
  label: string;
}

export const AI_QUALITY_SKILLS: readonly AiQualitySkillDef[] = [
  { skill: 'RealtimeDdx', key: 'realtimeDdx', label: '감별진단' },
  { skill: 'AutoSoap', key: 'autoSoap', label: 'SOAP 초안' },
  { skill: 'InterpretLab', key: 'interpretLab', label: '검사해석' },
  { skill: 'RecommendDrugs', key: 'recommendDrugs', label: '약물추천' },
] as const;

/** 알려진 스킬 키 — 맵 config 는 이 키만 채택한다(나머지는 무시) */
export const AI_SKILL_KEYS: readonly string[] = AI_QUALITY_SKILLS.map((s) => s.key);

/**
 * 최소 표본(호출 N) 기본 — 20. 🔴 이 값은 "판정을 시작할 수 있는 최소 관측 수"이지 품질 임계가 아니다.
 * 표본이 이보다 적으면 어떤 조치도 하지 않는다.
 */
export const AI_SKILL_MIN_CALLS_DEFAULT: Record<string, number> = {
  realtimeDdx: 20, autoSoap: 20, interpretLab: 20, recommendDrugs: 20,
};

/** 조치 기본 — **전부 OFF**. 위원회가 임계를 넣기 전까지 화면은 아무것도 내리지 않는다 */
export const AI_SKILL_ACTION_DEFAULT: Record<string, GateMode> = {
  realtimeDdx: 'OFF', autoSoap: 'OFF', interpretLab: 'OFF', recommendDrugs: 'OFF',
};

/** 최소 AI 통과율 기본 — 🔴 **빈 맵(미설정)**. 감으로 박은 임계는 거짓 경보가 된다 */
export const AI_SKILL_MIN_AI_RATE_DEFAULT: Record<string, number> = {};

/** 객체가 아닌 값(스칼라·배열·null)은 맵으로 읽지 않는다 — 통째로 덮는 사고를 막는다 */
function asMap(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * 최소 AI 통과율 맵 — 알려진 키 · 0 초과 1 이하의 유한수만 채택. 기본이 **빈 맵**이라
 * `mergeTargetMap`(base 에 있는 키만) 을 쓸 수 없어 같은 규약(부분 채택·형식 위반 무시)을 여기서 지킨다.
 */
export function resolveMinAiRate(raw: unknown): Record<string, number> {
  const out: Record<string, number> = { ...AI_SKILL_MIN_AI_RATE_DEFAULT };
  for (const [k, v] of Object.entries(asMap(raw))) {
    if (!AI_SKILL_KEYS.includes(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n <= 1) out[k] = n;
  }
  return out;
}

/** 최소 표본 맵 — 정본 `mergeTargetMap`(base 키만·유한 양수만). 스칼라가 오면 기본 맵 그대로 */
export function resolveMinCalls(raw: unknown): Record<string, number> {
  return mergeTargetMap(AI_SKILL_MIN_CALLS_DEFAULT, asMap(raw));
}

/** 조치 맵 — 정본 `gateMode`(per-rule 맵이므로 부재는 OFF). 스칼라가 오면 전 스킬 OFF(전부 BLOCK 이 되지 않는다) */
export function resolveActions(raw: unknown): Record<string, GateMode> {
  const obj = asMap(raw);
  const out: Record<string, GateMode> = { ...AI_SKILL_ACTION_DEFAULT };
  for (const key of AI_SKILL_KEYS) out[key] = gateMode(obj[key], 'OFF');
  return out;
}

export type SkillQualityStatus = 'OK' | 'DEGRADED' | 'INSUFFICIENT_SAMPLE' | 'UNCONFIGURED' | 'UNMEASURED';
/** 화면이 무엇을 해야 하는가 — 상태와 조치의 곱(표본 부족·미설정은 언제나 NONE) */
export type SkillQualityEffect = 'NONE' | 'WARN' | 'HIDE';

export interface SkillQualityJudgement {
  /** 🔴 calls===0 이면 null(0 이 아니다) */
  aiRate: number | null;
  status: SkillQualityStatus;
  effect: SkillQualityEffect;
  /** 사람이 읽는 근거 — **반드시 분모 포함** */
  basis: string;
}

/**
 * 판정. 순서가 곧 규칙이다:
 *   1. 조치 OFF → UNCONFIGURED / NONE (운영이 켜지 않았다 — 실측만 보여준다)
 *   2. 호출 0 → UNMEASURED / NONE · aiRate null
 *   3. 표본 부족 → INSUFFICIENT_SAMPLE / NONE (🔴 표본 부족으로는 내리지 않는다)
 *   4. 임계 미설정 → UNCONFIGURED / NONE
 *   5. 임계 미달 → DEGRADED / (BLOCK ? HIDE : WARN)
 *   6. 그 외 → OK / NONE
 */
export function judgeSkillQuality(input: {
  calls: number;
  aiOk: number;
  minAiRate: number | null;
  minCalls: number;
  action: GateMode;
}): SkillQualityJudgement {
  const calls = Number.isFinite(input.calls) && input.calls > 0 ? Math.floor(input.calls) : 0;
  const aiOk = Number.isFinite(input.aiOk) && input.aiOk > 0 ? Math.floor(input.aiOk) : 0;
  // 🔴 표본이 없으면 비율은 산출 불가다 — 0 으로 만들지 않는다
  const aiRate = calls > 0 ? aiOk / calls : null;
  const minCalls = Number.isFinite(input.minCalls) && input.minCalls > 0 ? input.minCalls : 20;
  const minAiRate = input.minAiRate;
  const action = input.action;

  const rateText = calls === 0
    ? '호출 0건 — 통과율 산출 불가'
    : `AI 통과 ${aiOk}/${calls}(${roundBy((aiRate as number) * 100, 'percent')}%)`;
  const thText = minAiRate == null ? '임계 미설정' : `임계 ${roundBy(minAiRate * 100, 'percent')}%`;
  const sampleText = `표본 ${minCalls} 미만이면 판정 보류`;
  const mk = (status: SkillQualityStatus, effect: SkillQualityEffect, tail: string): SkillQualityJudgement =>
    ({ aiRate, status, effect, basis: [rateText, thText, sampleText, tail].join(' · ') });

  if (action === 'OFF') return mk('UNCONFIGURED', 'NONE', '조치 OFF — 화면 반영 없음(위원회 미설정)');
  if (calls === 0) return mk('UNMEASURED', 'NONE', '표본 없음 — 판정하지 않는다');
  if (calls < minCalls) return mk('INSUFFICIENT_SAMPLE', 'NONE', `표본 부족(${calls}/${minCalls}) — 표본 부족으로는 내리지 않는다`);
  if (minAiRate == null) return mk('UNCONFIGURED', 'NONE', '임계 미설정 — 위원회가 실측에서 정한다');
  if ((aiRate as number) < minAiRate) {
    return action === 'BLOCK'
      ? mk('DEGRADED', 'HIDE', '임계 미달 — 탭에서 내린다(BLOCK)')
      : mk('DEGRADED', 'WARN', '임계 미달 — 화면 경고(WARN)');
  }
  return mk('OK', 'NONE', '임계 충족');
}
