import { describe, it, expect } from 'vitest';
import {
  OPENING_REGISTRY, PHASE_ORDER, PHASE_LABEL, PHASE_NOTE, PHASE_STAGE, REGISTRY_CAVEAT,
} from '../../src/modules/opening/opening.registry';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

/**
 * 개원 단계 레지스트리 가드 (2026-08-28 · 계획서 §5).
 *
 * 🔴 이 축의 가장 큰 위험은 **내가 모르는 것을 적는 것**이다 —
 *    법령 조문, 처리기한, 실재하지 않는 연결 키. 셋 다 화면에서는 사실처럼 보인다.
 */
describe('연결 키는 실재해야 한다 — 지어낸 키는 조용히 거짓말한다', () => {
  const glKeys = new Set(GO_LIVE_REGISTRY.map((d) => d.key));
  const dcKeys = new Set(DECISION_REGISTRY.map((d) => d.key));

  it('🔴 goLiveKey 가 운영 전환 관제 정본에 실재한다', () => {
    const bad = OPENING_REGISTRY.filter((d) => d.goLiveKey && !glKeys.has(d.goLiveKey));
    expect(bad.map((d) => `${d.key}→${d.goLiveKey}`)).toEqual([]);
  });

  it('🔴 decisionKey 가 결정 등록부 정본에 실재한다', () => {
    const bad = OPENING_REGISTRY.filter((d) => d.decisionKey && !dcKeys.has(d.decisionKey));
    expect(bad.map((d) => `${d.key}→${d.decisionKey}`)).toEqual([]);
  });

  it('🔴 연결 키는 최대 하나 — 둘을 들면 어느 쪽이 정본인지 모른다', () => {
    const multi = OPENING_REGISTRY.filter(
      (d) => [d.goLiveKey, d.decisionKey, d.committeeCode].filter(Boolean).length > 1,
    );
    expect(multi.map((d) => d.key)).toEqual([]);
  });

  it('선행 항목(dependsOn)이 레지스트리 안에 실재한다', () => {
    const keys = new Set(OPENING_REGISTRY.map((d) => d.key));
    const bad: string[] = [];
    for (const d of OPENING_REGISTRY) for (const k of d.dependsOn ?? []) if (!keys.has(k)) bad.push(`${d.key}→${k}`);
    expect(bad).toEqual([]);
  });

  it('키가 중복되지 않는다', () => {
    const keys = OPENING_REGISTRY.map((d) => d.key);
    expect(keys.length).toBe(new Set(keys).size);
  });
});

describe('🔴 모르는 것을 적지 않는다', () => {
  const SRC = OPENING_REGISTRY.map((d) => JSON.stringify(d)).join('\n');

  it('🔴 법령 조문을 지어내지 않는다 — 내가 검증할 수 없는 사실이다', () => {
    expect(SRC, '조문은 사람이 근거로 채운다 — 레지스트리가 만들지 않는다').not.toMatch(/제\s*\d+\s*조/);
    expect(SRC).not.toMatch(/의료법|약사법|감염병예방법/);
  });

  it('🔴 처리기한 일수를 지어내지 않는다', () => {
    expect(SRC).not.toMatch(/\d+\s*일\s*(이내|내)/);
  });

  it('🔴 절대 날짜를 박지 않는다 — 개원일이 아직 없다', () => {
    expect(SRC).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('🔴 목록이 전수라고 말하지 않는다', () => {
    expect(REGISTRY_CAVEAT).toContain('전수가 아니다');
    expect(REGISTRY_CAVEAT).toContain('근거는 비어 있다');
  });

  it('근거(basis)는 미기재가 기본이다 — 채워 넣지 않았다', () => {
    expect(OPENING_REGISTRY.every((d) => !('basis' in d))).toBe(true);
  });
});

describe('단계 구조', () => {
  it('모든 항목의 단계가 정의돼 있고, 라벨·설명·묶음이 빠짐없다', () => {
    const phases = new Set(PHASE_ORDER);
    expect(OPENING_REGISTRY.every((d) => phases.has(d.phase))).toBe(true);
    for (const p of PHASE_ORDER) {
      expect(PHASE_LABEL[p], p).toBeTruthy();
      expect(PHASE_NOTE[p], p).toBeTruthy();
      expect(PHASE_STAGE[p], p).toBeTruthy();
    }
  });

  it('개원 전·개원·개원 후 세 묶음이 다 있다', () => {
    const stages = new Set(PHASE_ORDER.map((p) => PHASE_STAGE[p]));
    expect([...stages].sort()).toEqual(['AFTER', 'AT', 'BEFORE']);
  });

  it('🔴 시스템 개시 단계는 58항목을 복제하지 않는다 — 정본은 운영 전환 관제다', () => {
    const sys = OPENING_REGISTRY.filter((d) => d.phase === 'O6_SYSTEM');
    expect(sys.length, 'go-live 항목을 베끼면 정본이 둘이 된다').toBeLessThan(10);
    expect(sys.some((d) => d.note?.includes('/admin/go-live'))).toBe(true);
  });

  it('🔴 개원 직후(O9)는 기본 목록이 없다 — 기관이 정한다', () => {
    expect(OPENING_REGISTRY.filter((d) => d.phase === 'O9_POST')).toEqual([]);
    expect(PHASE_NOTE.O9_POST).toContain('기관이 정한다');
  });
});
