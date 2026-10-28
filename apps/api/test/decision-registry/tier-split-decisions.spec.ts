import { describe, it, expect } from 'vitest';
import { DECISION_REGISTRY, LAYER_RANK } from '../../src/modules/decision-registry/decision.registry';

/**
 * tier-split 사람 결정 등재 가드 (2026-08-25)
 *
 * 🔴 `tier-split-appliance.plan.md` §7 의 4건은 **2026-07-15부터 미결**이었고
 *    기획서 안에만 있었다 — 등재하지 않으면 문서 안에서 늙는다.
 *    그중 #2(처리 경계)는 AgentEMR 2단계·어플라이언스·LoopSpec L2 를 함께 막고 있다.
 */
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);

describe('tier-split 사람 결정이 화면에 올라와 있다', () => {
  const keys = [
    'legal.phiBoundary.gpuTier',
    'legal.erpMrn.pseudonymization',
    'legal.regulatoryAxis.review',
    'policy.metrics.upstreamScope',
  ];

  it('🔴 4건 전부 등재돼 있다 — 빠지면 기획서 안에서만 늙는다', () => {
    for (const k of keys) expect(byKey(k), `미등재: ${k}`).toBeDefined();
  });

  it('🔴 처리 경계 결정은 두 선택지가 서로 다른 후속을 명시한다(둘 다 그냥 기록이 아니다)', () => {
    const d = byKey('legal.phiBoundary.gpuTier')!;
    const values = d.options.map((o) => o.value);
    expect(values).toContain('ON_PREM_GPU');
    expect(values).toContain('ENTRUSTED_KEEP');
    // 위탁 유지를 고르면 규범 개정이 동반 필수 — 그 사실이 선택지 설명에 있어야 한다
    const entrusted = d.options.find((o) => o.value === 'ENTRUSTED_KEEP')!;
    expect(entrusted.effect).toMatch(/개정/);
    expect(d.afterDecision).toMatch(/개정/);
  });

  it('🔴 무엇을 막고 있는지 적혀 있다 — 결정의 값은 그것이 여는 것으로 판단된다', () => {
    const d = byKey('legal.phiBoundary.gpuTier')!;
    expect(d.blocks).toMatch(/AgentEMR/);
    expect((d.opens ?? []).length).toBeGreaterThan(0);
  });

  it('🔴 주장을 직접 확인할 경로가 있다(믿으라고 하지 않는다)', () => {
    const d = byKey('legal.phiBoundary.gpuTier')!;
    expect((d.verifyHow ?? []).length).toBeGreaterThanOrEqual(2);
    expect((d.verifyHow ?? []).join(' ')).toMatch(/INV-PHI-03|lspci/);
  });

  it('🔴 하위 층이 상위 층을 선행 조건으로 가리킨다 — 반대 방향은 금지', () => {
    const child = byKey('policy.metrics.upstreamScope')!;
    expect(child.layer).toBe('INTERNAL_COMMITTEE');
    for (const dep of child.dependsOn ?? []) {
      const parent = byKey(dep)!;
      expect(parent, `선행 항목 없음: ${dep}`).toBeDefined();
      // 상위(더 높은 rank)만 가리킬 수 있다
      expect(LAYER_RANK[parent.layer]).toBeGreaterThanOrEqual(LAYER_RANK[child.layer]);
    }
  });

  it('대조군 — 위원회 항목은 이 화면이 적용하지 않는다고 말한다', () => {
    const d = byKey('policy.metrics.upstreamScope')!;
    expect(d.approvalPath).toBe('COMMITTEE');
    expect(d.afterDecision).toMatch(/적용/);
  });
});
