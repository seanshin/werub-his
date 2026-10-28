import {
  HANDOFF_ACK_MODE_CODE_DEFAULT, HANDOFF_ACK_MODE_KEY, PAIN_REASSESS_RULE_KEY,
  RISK_REASSESS_INTERVAL_DEFAULT, RISK_REASSESS_INTERVAL_KEY, normalizeRiskReassessIntervals, type RiskReassessIntervals,
  RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN, RESTRAINT_CHECK_INTERVAL_KEY,
  normalizeHandoffAckMode, normalizePainReassessRule, normalizeRestraintCheckInterval,
  type HandoffAckMode, type NursingRuleSource, type PainReassessRule,
} from '@hospital-run/shared';
import type { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 간호 원내 규정 읽기 정본(2026-10-26) — 보호대 점검 간격 · 통증 재평가 규정 · 인계 인수 방식.
 * 환자안전(보호대)·입원(인계 인수 확인)·간호 규정 화면이 같은 함수로 읽는다(출처 판정이 갈라지지 않게).
 * 🔴 사람이 입력한 형식 맞는 값(DB·환경)만 원내 설정이다 — 코드 기본값은 원내 규정이 아니다.
 */
type ConfigLike = Pick<ConfigRuntimeService, 'getWithSource'> | undefined | null;

async function readSource<T>(config: ConfigLike, key: string, normalize: (raw: unknown) => T | null): Promise<{ value: T | null; source: 'CONFIGURED' | 'SEED' | 'NONE' | 'UNKNOWN' }> {
  if (!config) return { value: null, source: 'UNKNOWN' };
  try {
    const r = await config.getWithSource(key);
    const v = normalize(r.value);
    if (v == null || (r.source !== 'db' && r.source !== 'env')) return { value: null, source: 'NONE' };
    // 개발 시드 행 — 그 값으로 동작하되 원내 설정이라 말하지 않는다
    return { value: v, source: r.source === 'db' && r.seeded ? 'SEED' : 'CONFIGURED' };
  } catch {
    return { value: null, source: 'UNKNOWN' };
  }
}

/** 보호대 점검 간격 — 비었거나 실패해도 코드 기본값으로 감시는 계속(끄는 쪽이 덜 안전) */
export async function readRestraintInterval(config: ConfigLike): Promise<{ minutes: number; source: 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN' }> {
  const r = await readSource(config, RESTRAINT_CHECK_INTERVAL_KEY, normalizeRestraintCheckInterval);
  if (r.source === 'CONFIGURED' || r.source === 'SEED') return { minutes: r.value!, source: r.source };
  return { minutes: RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN, source: r.source === 'UNKNOWN' ? 'UNKNOWN' : 'CODE_DEFAULT' };
}

/** 통증 재평가 규정 — 🔴 기본값 없음(미설정이면 null · UNSET) */
export async function readPainReassessRule(config: ConfigLike): Promise<{ rule: PainReassessRule | null; source: Extract<NursingRuleSource, 'CONFIGURED' | 'SEED' | 'UNSET' | 'UNKNOWN'> }> {
  const r = await readSource(config, PAIN_REASSESS_RULE_KEY, normalizePainReassessRule);
  return { rule: r.value, source: r.source === 'NONE' ? 'UNSET' : r.source };
}

/**
 * 인계 인수 방식 — 비었으면 코드 기본값(OFFER_BOTH · 종전 동작).
 * 🔴 조회 실패면 mode=null(모른다) — 호출부가 "늘 묶음"으로 짐작해 담당을 넘기지 않는다(담당 이동은 되돌리기 번거로운 쪽).
 */
export async function readHandoffAckMode(config: ConfigLike): Promise<{ mode: HandoffAckMode | null; source: Extract<NursingRuleSource, 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN'> }> {
  const r = await readSource(config, HANDOFF_ACK_MODE_KEY, normalizeHandoffAckMode);
  if (r.source === 'CONFIGURED' || r.source === 'SEED') return { mode: r.value, source: r.source };
  if (r.source === 'UNKNOWN') return { mode: null, source: 'UNKNOWN' };
  return { mode: HANDOFF_ACK_MODE_CODE_DEFAULT, source: 'CODE_DEFAULT' };
}

/**
 * 낙상·욕창 위험 재평가 주기 — 비었거나 형식 밖·조회 실패면 코드 기본값으로 **일정은 계속 만든다**(끄는 쪽이 덜 안전) · 출처를 함께 말한다.
 */
export async function readRiskReassessIntervals(config: ConfigLike): Promise<{ table: RiskReassessIntervals; source: 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN' }> {
  const r = await readSource(config, RISK_REASSESS_INTERVAL_KEY, normalizeRiskReassessIntervals);
  if (r.source === 'CONFIGURED' || r.source === 'SEED') return { table: r.value!, source: r.source };
  return { table: RISK_REASSESS_INTERVAL_DEFAULT, source: r.source === 'UNKNOWN' ? 'UNKNOWN' : 'CODE_DEFAULT' };
}
