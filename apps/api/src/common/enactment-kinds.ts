/**
 * 집행 kind 어휘 **정본**.
 *
 * 🔴 여기 따로 둔 이유(2026-08-27): 결정 등록부(`decision.registry.ts`)가 이 어휘를 써야 하는데,
 *    집행 엔진(`gld/governance-enactment.service.ts`)은 등록부를 import 한다 — 순환이 된다.
 *    그렇다고 등록부에 어휘를 **다시 적으면** 두 곳이 갈라지고, 갈라진 것을 아무도 모른 채
 *    "집행 kind 가 아닌 값"이 바인딩에 들어간다(이 저장소에서 반복된 유형).
 *    → 어휘만 여기로 올리고 **양쪽이 이것을 import** 한다.
 */
export const ENACTABLE_KINDS: ReadonlySet<string> = new Set([
  'MANUAL', 'CONFIG_CHANGE', 'GATE_MODE',
  'FORMULARY', 'MASTER_DATA', 'TEMPLATE', 'ACCESS', 'PUBLISH', 'RETENTION',
]);

export type EnactmentKind =
  | 'MANUAL' | 'CONFIG_CHANGE' | 'GATE_MODE'
  | 'FORMULARY' | 'MASTER_DATA' | 'TEMPLATE' | 'ACCESS' | 'PUBLISH' | 'RETENTION';

/** 엔진이 **자동 집행**하는 kind(MANUAL 제외) — 크론 where·집행 루프·역추적 필터가 공유 */
export const AUTO_ENACT_KINDS: string[] = [...ENACTABLE_KINDS].filter((k) => k !== 'MANUAL');
