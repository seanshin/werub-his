/**
 * 결정 엔진 — 순수 규칙(2026-10-11 사용자 "엔진 형태로 세팅 후에 변경되고, 전후 관계에도 영향을 주고,
 * 보호하거나 설정에 영향을 줄 수 있어야 함").
 *
 * 등록부(`decision.registry.ts`)를 읽어 세 가지를 **파생**한다 — 손으로 목록을 두지 않는다(두면 갈라진다).
 *  ① 결정이 바꾸는 설정 — 선택지 `enact` 의 두 모양(`{kind,target:{key,newValue}}` · `{key,newValue}`) + `configKey`
 *  ② 결정에 묶인 설정(역방향) — 설정 키 → 그 설정을 정하는 결정들(보호의 대상)
 *  ③ 전후 관계 — `dependsOn` 정방향(선행) · 역방향(후행)
 */
import { DECISION_REGISTRY, type DecisionDef } from './decision.registry';
import { DECIDED_SETTING_ALLOWED, QI_FLOW_SETTING_ALLOWED, type DecisionMechanism } from '@hospital-run/shared';

/** 선택지 집행 대상 → `{key, value}` (설정 변경이 아니면 null) */
export function enactConfigOf(enact: unknown): { key: string; value: unknown } | null {
  if (!enact || typeof enact !== 'object') return null;
  const e = enact as { kind?: unknown; target?: { key?: unknown; newValue?: unknown }; key?: unknown; newValue?: unknown };
  if (e.kind != null) {
    if (e.kind !== 'CONFIG_CHANGE' || !e.target || typeof e.target.key !== 'string') return null;
    return { key: e.target.key, value: e.target.newValue };
  }
  return typeof e.key === 'string' ? { key: e.key, value: e.newValue } : null;
}

/** 이 결정이 이 선택으로 정하는 설정 값들 — 선택지에 집행 대상이 없으면 빈 배열(바꾸지 않는다) */
export function decidedConfigOf(d: DecisionDef, choice: string | null | undefined): Array<{ key: string; value: unknown }> {
  const opt = d.options.find((o) => o.value === choice);
  const c = opt ? enactConfigOf(opt.enact) : null;
  return c ? [c] : [];
}

/** 결정이 건드릴 수 있는 설정 키 전부(어느 선택이든) */
export function configKeysOf(d: DecisionDef): string[] {
  const keys = new Set<string>();
  if (d.configKey) keys.add(d.configKey);
  for (const o of d.options) { const c = enactConfigOf(o.enact); if (c) keys.add(c.key); }
  return [...keys];
}

let governedCache: Map<string, string[]> | null = null;
/** 설정 키 → 그 설정을 정하는 결정 키들 */
export function governedConfigMap(registry: DecisionDef[] = DECISION_REGISTRY): Map<string, string[]> {
  if (registry === DECISION_REGISTRY && governedCache) return governedCache;
  const m = new Map<string, string[]>();
  for (const d of registry) for (const k of configKeysOf(d)) m.set(k, [...(m.get(k) ?? []), d.key]);
  if (registry === DECISION_REGISTRY) governedCache = m;
  return m;
}

/** 이 결정에 기대는(dependsOn 으로 가리키는) 후행 결정 */
export function downstreamOf(key: string, registry: DecisionDef[] = DECISION_REGISTRY): DecisionDef[] {
  return registry.filter((d) => (d.dependsOn ?? []).includes(key));
}

/**
 * 부정 결정 — "확인했다/체결했다" 계열이 아닌 선택. 선행 결정이 이 값이면 후행은 적용되지 않는다.
 * 🔴 정본은 여기 하나 — 결정 기록(선행 판정)과 엔진(영향 미리보기)이 같은 규칙을 쓴다.
 */
export const NEGATIVE_CHOICE_RE = /^(NOT_|OFF$|UNSET$|DRAFT$|KEEP_OFF$|NONE$|PENDING$|DEVICE_APPLIES$)/;
export const isNegativeChoice = (choice: string | null | undefined) => !!choice && NEGATIVE_CHOICE_RE.test(choice);

/** 두 설정 값이 같은가 — JSON 비교(숫자·불리언·문자열·객체) */
export const sameConfigValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 결정 방식 — 처리 경로·집행 바인딩·선택지의 집행 대상에서 파생(손으로 붙이지 않는다).
 * 🔴 `UNBOUND` = 선택지가 설정 값을 들고 있는데 반영 경로가 없다(권한자 경로인데 enactKind 없음) — 등록부 결함이다(가드가 0을 강제).
 */
export function mechanismOf(d: DecisionDef): DecisionMechanism {
  const setsConfig = d.options.some((o) => !!enactConfigOf(o.enact));
  const nonConfig = d.options.some((o) => o.enact != null && !enactConfigOf(o.enact));
  switch (d.approvalPath) {
    case 'PER_EVENT_DIALOG': return 'PER_EVENT';
    case 'AUTHORIZED_ROLE':
      if (d.enactKind) return 'AUTO_APPLY';
      return setsConfig || nonConfig ? 'UNBOUND' : 'CONFIRM_ONLY';
    case 'COMMITTEE': return setsConfig || nonConfig ? 'COMMITTEE_APPLY' : 'COMMITTEE_RECORD';
    case 'CODE_CHANGE': return setsConfig ? 'MIXED' : 'DEV_APPLY';
    default: return 'UNBOUND';
  }
}

/** 설정 허용 값 규칙(설정 저장·집행 엔진이 같은 규칙으로 거른다) — 규칙이 없으면 null */
export function allowedRuleOf(key: string): readonly (string | boolean)[] | { int: readonly [number, number] } | 'DATE' | null {
  return (DECIDED_SETTING_ALLOWED[key] as never) ?? (QI_FLOW_SETTING_ALLOWED[key] as never) ?? null;
}
