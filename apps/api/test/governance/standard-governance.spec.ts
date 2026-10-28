import { describe, it, expect, vi } from 'vitest';
import { StandardGovernanceService, DEFAULT_RULE, standardSurfaceKey, RULE_SCOPE_ALL } from '../../src/modules/gld/standard-governance.service';

/**
 * 표준 발효 거버넌스 (2026-08-27 · 계획서 §3.5 · 가드 G10·G11·G15).
 *
 * 🔴 발단(운영 실측): 발효 중인 진료 표준 9건(임상경로 5·프로토콜 4)에 **의결 근거가 하나도 없었다.**
 *
 * 🔴 **이 가드가 지키는 가장 중요한 것은 "막지 않는다"** 이다.
 *    지금 5개 임상경로가 환자에게 적용 중이고, 근거가 없다는 이유로 즉시 중단시키면
 *    그것은 안전측이 아니라 **진료 중단**이다.
 *
 * 재주입: 기본 게이트를 BLOCK 으로 바꾸거나, 위임 근거 없이 전결을 통과시키면 실패한다.
 */
function makeSvc(o: { rules?: unknown[]; decision?: unknown; maps?: unknown[] } = {}) {
  const prisma = {
    standardGovernanceRule: { findMany: vi.fn().mockResolvedValue(o.rules ?? []) },
    committeeDecision: { findUnique: vi.fn().mockResolvedValue(o.decision ?? null) },
    committeeSurfaceMap: { findMany: vi.fn().mockResolvedValue(o.maps ?? []) },
  };
  return new StandardGovernanceService(prisma as never);
}

describe('🔴 G10 — 막지 않는다 (기본 WARN)', () => {
  it('기본 게이트 모드는 WARN 이다 — BLOCK 이면 환자에게 적용 중인 표준이 멈춘다', () => {
    expect(DEFAULT_RULE.gateMode).toBe('WARN');
  });

  it('🔴 규칙이 없고 의결도 없으면 — WARN 이지만 발효는 된다(사실만 남는다)', async () => {
    const v = await makeSvc().evaluate({ kind: 'PATHWAY', code: 'CP-AMI-001', action: 'ENACT' });
    expect(v.ok).toBe(true);          // ← 막지 않는다
    expect(v.level).toBe('WARN');
    expect(v.reasons.join()).toContain('위원회 의결 근거가 없습니다');
  });

  it('🔴 규칙이 없다는 사실을 밝힌다 — 기본값을 정책인 척하지 않는다', async () => {
    const v = await makeSvc().evaluate({ kind: 'PATHWAY', code: 'CP-X', action: 'ENACT' });
    expect(v.ruleSource).toBe('DEFAULT');
  });

  it('BLOCK 으로 켜면 그때 막는다 — 승격은 위원회가 정한다', async () => {
    const svc = makeSvc({ rules: [{ standardKind: 'PATHWAY', standardCode: RULE_SCOPE_ALL, requireAll: false, actions: { ENACT: 'COMMITTEE' }, requireBasis: [], reviewCycleM: null, gateMode: 'BLOCK', delegationRef: null }] });
    const v = await svc.evaluate({ kind: 'PATHWAY', code: 'CP-AMI-001', action: 'ENACT' });
    expect(v.ok).toBe(false);
    expect(v.level).toBe('BLOCK');
    expect(() => svc.assertOrWarn(v)).toThrowError(/발효 요건 미충족/);
  });

  it('WARN 은 던지지 않는다', async () => {
    const svc = makeSvc();
    const v = await svc.evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT' });
    expect(() => svc.assertOrWarn(v)).not.toThrow();
  });
});

describe('🔴 G15 — 위임은 위원회가 의결한 적이 있어야 성립한다', () => {
  const delegated = (delegationRef: string | null) => ([{
    standardKind: 'PATHWAY', standardCode: RULE_SCOPE_ALL, requireAll: false,
    actions: { AMEND: 'DELEGATED' }, requireBasis: [], reviewCycleM: null, gateMode: 'WARN', delegationRef,
  }]);

  it('🔴 위임 근거가 없으면 전결을 통과시키지 않는다 — "부서장 전결"은 3층 원칙을 깬다', async () => {
    const v = await makeSvc({ rules: delegated(null) }).evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'AMEND' });
    expect(v.level).toBe('WARN');
    expect(v.reasons.join()).toContain('위임 근거 의결번호가 없습니다');
  });

  it('위임 근거가 있으면 통과한다', async () => {
    const v = await makeSvc({ rules: delegated('GOV-2026-003') }).evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'AMEND' });
    expect(v.level).toBe('PASS');
    expect(v.reasons.join()).toContain('GOV-2026-003');
  });
});

describe('의결 근거 판정', () => {
  const rule = [{ standardKind: 'PATHWAY', standardCode: RULE_SCOPE_ALL, requireAll: false, actions: { ENACT: 'COMMITTEE' }, requireBasis: [], reviewCycleM: null, gateMode: 'WARN', delegationRef: null }];

  it('유효한 의결이면 PASS', async () => {
    const v = await makeSvc({ rules: rule, decision: { decisionNo: 'GOV-2026-012', status: 'ENACTED', actions: [] } })
      .evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT', decisionNo: 'GOV-2026-012' });
    expect(v.level).toBe('PASS');
  });

  it('🔴 폐기·대체된 의결을 근거로 삼지 않는다', async () => {
    const v = await makeSvc({ rules: rule, decision: { decisionNo: 'GOV-2026-001', status: 'SUPERSEDED', actions: [] } })
      .evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT', decisionNo: 'GOV-2026-001' });
    expect(v.reasons.join()).toContain('SUPERSEDED');
  });

  it('없는 의결번호를 통과시키지 않는다', async () => {
    const v = await makeSvc({ rules: rule, decision: null })
      .evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT', decisionNo: 'GOV-9999-999' });
    expect(v.reasons.join()).toContain('찾을 수 없습니다');
  });

  it('🔴 근거를 기본으로 요구하지 않는다 — 강제하면 아무 문장이나 채워진다', () => {
    expect(DEFAULT_RULE.requireBasis).toEqual([]);
    expect(DEFAULT_RULE.reviewCycleM).toBeNull(); // 주기도 지어내지 않는다
  });

  it('요구하도록 정하면 그때 본다', async () => {
    const r = [{ ...rule[0], requireBasis: ['legal'] }];
    const v = await makeSvc({ rules: r, decision: { decisionNo: 'G', status: 'ENACTED', actions: [{ basis: {} }] } })
      .evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT', decisionNo: 'G' });
    expect(v.reasons.join()).toContain('필요한 근거가 없습니다');
  });
});

describe('합동 의결 — 자동 판정하지 않는다고 밝힌다', () => {
  it('🔴 담당이 둘 이상이면 "아직 자동 판정하지 않는다"를 말한다(조용히 통과시키지 않는다)', async () => {
    const v = await makeSvc({
      rules: [{ standardKind: 'PATHWAY', standardCode: RULE_SCOPE_ALL, requireAll: true, actions: { ENACT: 'COMMITTEE' }, requireBasis: [], reviewCycleM: null, gateMode: 'WARN', delegationRef: null }],
      decision: { decisionNo: 'G', status: 'ENACTED', actions: [] },
      maps: [{ committeeId: 'c1' }, { committeeId: 'c2' }],
    }).evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT', decisionNo: 'G' });
    expect(v.reasons.join()).toContain('아직 자동 판정하지 않습니다');
  });
});

describe('🔴 유형 기본 규칙의 범위 표식', () => {
  it("'*' 를 쓴다 — null 이면 Postgres 유니크가 중복을 막지 못해 기본 규칙이 둘 생긴다", () => {
    expect(RULE_SCOPE_ALL).toBe('*');
  });

  it('표준별 예외가 유형 기본을 이긴다', async () => {
    const rules = [
      { standardKind: 'PATHWAY', standardCode: RULE_SCOPE_ALL, requireAll: false, actions: { ENACT: 'COMMITTEE' }, requireBasis: [], reviewCycleM: null, gateMode: 'WARN', delegationRef: null },
      { standardKind: 'PATHWAY', standardCode: 'CP-AMI-001', requireAll: false, actions: { ENACT: 'NONE' }, requireBasis: [], reviewCycleM: null, gateMode: 'OFF', delegationRef: null },
    ];
    const v = await makeSvc({ rules }).evaluate({ kind: 'PATHWAY', code: 'CP-AMI-001', action: 'ENACT' });
    expect(v.level).toBe('PASS');       // 예외 규칙(NONE)이 적용됐다
    expect(v.gateMode).toBe('OFF');
    // 대조군 — 예외가 없는 표준은 기본 규칙을 탄다
    const other = await makeSvc({ rules }).evaluate({ kind: 'PATHWAY', code: 'CP-TKR-001', action: 'ENACT' });
    expect(other.level).toBe('WARN');
  });
});

describe('표면 키는 매핑 어휘를 따른다', () => {
  it('pathway:/protocol:/process: 접두사', () => {
    expect(standardSurfaceKey('PATHWAY', 'CP-AMI-001')).toBe('pathway:CP-AMI-001');
    expect(standardSurfaceKey('PROTOCOL', 'ER_V1')).toBe('protocol:ER_V1');
    expect(standardSurfaceKey('PROCESS', 'X')).toBe('process:X');
  });
});
