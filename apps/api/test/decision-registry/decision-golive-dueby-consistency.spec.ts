/**
 * 🔴 결정 항목의 `goLive` 와 `dueBy` 는 같은 사실(개시와의 관계)을 두 번 말한다 — 둘이 갈라지면 화면이 거짓말을 한다 (2026-09-13).
 *
 * 실측: 61건 중 `identity.foreignNames` 한 건이 `goLive: CAN_FOLLOW`(개시 뒤에 해도 된다) 인데 `dueBy: BEFORE_GO_LIVE`(개시 전까지) 였다.
 * 개시 필수 목록은 goLive 로 세고 기한 필터는 dueBy 로 세서, 같은 항목이 "개시 필수 15"에는 없고 "개시 전 기한 16"에는 있었다.
 *
 * 규칙(나머지 60건 실측 분포에서 도출 — 지어내지 않았다):
 *   REQUIRED_BEFORE ⇔ BEFORE_GO_LIVE (양방향)
 *   CAN_FOLLOW      ⇒ WITHIN_30D | NONE
 *   NOT_RELATED     ⇒ NONE
 * 재주입: 어느 항목이든 한 필드만 바꾸면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { DECISION_REGISTRY, type DecisionDef } from '../../src/modules/decision-registry/decision.registry';

const ALLOWED: Record<DecisionDef['goLive'], ReadonlyArray<DecisionDef['dueBy']>> = {
  REQUIRED_BEFORE: ['BEFORE_GO_LIVE'],
  CAN_FOLLOW: ['WITHIN_30D', 'NONE'],
  NOT_RELATED: ['NONE'],
};

describe('결정 등록부 — goLive ↔ dueBy 가 같은 말을 한다', () => {
  it('대조군 — 세 goLive 값이 모두 표본으로 있다(표본이 없으면 그 규칙은 검사되지 않는다)', () => {
    const used = new Set(DECISION_REGISTRY.map((d) => d.goLive));
    expect([...used].sort()).toEqual(['CAN_FOLLOW', 'NOT_RELATED', 'REQUIRED_BEFORE']);
  });

  it('🔴 모든 항목이 규칙을 지킨다', () => {
    const bad = DECISION_REGISTRY.filter((d) => !ALLOWED[d.goLive].includes(d.dueBy)).map(
      (d) => `${d.key}: goLive=${d.goLive} · dueBy=${d.dueBy}`,
    );
    expect(bad, `두 필드가 서로 다른 말을 한다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 개시 필수 목록과 개시 전 기한 목록이 같은 집합이다(화면 필터 둘이 같은 답을 낸다)', () => {
    const required = DECISION_REGISTRY.filter((d) => d.goLive === 'REQUIRED_BEFORE').map((d) => d.key).sort();
    const due = DECISION_REGISTRY.filter((d) => d.dueBy === 'BEFORE_GO_LIVE').map((d) => d.key).sort();
    expect(due).toEqual(required);
    expect(required.length, '개시 필수가 0이면 이 가드는 아무것도 보증하지 않는다').toBeGreaterThan(0);
  });
});
