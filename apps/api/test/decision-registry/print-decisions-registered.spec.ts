/**
 * 인쇄본 발급 원장·개발 반영 추적의 사람 결정 D1~D6 등재(2026-10-12 · 배치 10-H).
 *  · 🔴 기획서 §4 표는 정본이 아니다 — 등록부 키가 정본이고, 기획서는 그 키를 가리킨다(문서 안에서만 늙지 않게)
 *  · 위원회 몫 → 배정 위원회·개발 시드(사용자 지시 — 위원회 몫은 DEV-SEED 로 결정해 둔다) · 시드 선택은 등록부 선택지 안
 *  · 현행 기본값과 같은 선택지가 있다(P0·P1 이 기본값으로 구현됐다는 사실과 맞는다)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decisionCommitteeOf, decisionDomainOf, decisionSubdomainOf } from '@hospital-run/shared';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { DECISION_BATCH_2026_10_H } from '../../src/modules/decision-registry/decision.registry.batch-2026-10-h';
import { DECISION_DEV_SEEDS } from '../../prisma/seeds/decision-dev-seeds';

const KEYS = {
  D1: 'print.verify.publicScope', D2: 'print.issue.phiRetention', D3: 'print.issue.roles',
  D4: 'governance.registerPeriodicIssue', D5: 'governance.devEnactmentConfirmer', D6: 'governance.seedImplementedPolicy',
} as const;

describe('🔴 사람 결정 D1~D6 — 등록부 정본', () => {
  it('6건 전부 등록부에 있고 배치 10-H 와 같다', () => {
    expect(DECISION_BATCH_2026_10_H.map((d) => d.key).sort()).toEqual(Object.values(KEYS).sort());
    for (const k of Object.values(KEYS)) expect(DECISION_REGISTRY.some((d) => d.key === k), k).toBe(true);
  });
  it('기획서가 등록부 키를 가리킨다', () => {
    const plan = readFileSync(join(__dirname, '../../../../docs/01-plan/features/decision-print-remaining.plan.md'), 'utf8');
    for (const [id, k] of Object.entries(KEYS)) expect(plan, `${id} → ${k}`).toContain(`\`${k}\``);
  });
  it('위원회 배정 — D1·D2 의무기록위원회 · D3~D6 운영위원회 · 영역·세부 분류가 있다', () => {
    for (const k of [KEYS.D1, KEYS.D2]) expect(decisionCommitteeOf(k)?.lead, k).toBe('MRC');
    for (const k of [KEYS.D3, KEYS.D4, KEYS.D5, KEYS.D6]) expect(decisionCommitteeOf(k)?.lead, k).toBe('OPS');
    for (const d of DECISION_BATCH_2026_10_H) {
      const dom = decisionDomainOf(d.key, d.track);
      expect(dom, d.key).not.toBeNull();
      expect(decisionSubdomainOf(d.key, d.track, d.layer, dom), d.key).not.toBeNull();
    }
  });
  it('🔴 현행 기본값과 같은 선택지 — D1 공개 최소+직원 대조 · D2 원장 미등재 · D3 관리자만 · D4 수시', () => {
    const has = (k: string, v: string) => DECISION_REGISTRY.find((d) => d.key === k)!.options.some((o) => o.value === v);
    expect(has(KEYS.D1, 'PUBLIC_MIN_STAFF_DIFF')).toBe(true);
    expect(has(KEYS.D2, 'NOT_REGISTERED')).toBe(true);
    expect(has(KEYS.D3, 'ADMIN_ONLY')).toBe(true);
    expect(has(KEYS.D4, 'ON_DEMAND')).toBe(true);
  });
  it('개발 시드 — 6건 · 선택은 등록부 선택지 안 · 설정을 바꾸지 않는다 · 배열 끝에 붙었다(시드 id 순번)', () => {
    // 그 뒤 배치(10-I~)가 끝에 더 붙는다 — 10-H 6건이 이어서 붙었는지만 본다(순번 id 는 붙인 순서)
    const at = DECISION_DEV_SEEDS.findIndex((x) => x.key === KEYS.D1);
    const tail = DECISION_DEV_SEEDS.slice(at, at + 6);
    expect(tail.map((s) => s.key)).toEqual(Object.values(KEYS));
    for (const s of tail) {
      const d = DECISION_REGISTRY.find((x) => x.key === s.key)!;
      expect(d.options.map((o) => o.value), s.key).toContain(s.choice);
      expect(s.config).toBeNull();
    }
    // 🔴 D6 시드는 원칙을 정하지 않는다(건별) — 시드가 "시드대로 둔다"를 고르면 시드가 정책을 정하는 것을 시드가 공식화한다
    expect(tail.find((s) => s.key === KEYS.D6)!.choice).toBe('PER_KEY');
  });
});
