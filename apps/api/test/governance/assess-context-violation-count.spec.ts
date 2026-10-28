import { describe, it, expect, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';

/**
 * 🔴 안건 컨텍스트의 '30일 위반 건수' 집계 실패를 `0` 으로 접지 않는다(2026-08-21).
 *
 * 이 수는 위원회가 안전 게이트를 OFF→WARN→BLOCK 으로 올릴지 판단할 때 읽는 근거이고,
 * AI 영향 평가 프롬프트에도 그대로 들어간다. 이 저장소는 이미 `gate_violation_logs` 0행을
 * "위반 없음"으로 읽었다가 **탐지기가 죽어 있던 것**을 놓친 적이 있다(v4.4.0 DUR 43룰 매칭 0).
 * 못 세었으면 `null`(산출 불가)이라고 말한다.
 *
 * 재주입 역검증: `.catch(() => 0)` 으로 되돌리면 첫 it 이 실패한다.
 */
const AGENDA = {
  id: 'ag-1', committeeId: 'c-1', status: 'SUBMITTED',
  title: 'DUR 처방 게이트(BLOCK) 운영 현황 정기 검토',
  body: '정기 검토',
  sourceRef: { type: 'SAFETY_GATE', key: 'dur.enforce' },
  committee: { code: 'DTC', name: '약사위원회' },
};

function makeSvc(countRejects: boolean) {
  const prisma = {
    committeeSurfaceMap: { findMany: vi.fn(async () => []) },
    gateViolationLog: {
      count: countRejects
        ? vi.fn(async () => { throw new Error('DB timeout'); })
        : vi.fn(async () => 0),
    },
    formularyRequest: { findUnique: vi.fn(async () => null) },
    committee: { findMany: vi.fn(async () => []) },
    systemConfig: { findMany: vi.fn(async () => []) },
  };
  const config = { get: vi.fn(async () => 'BLOCK'), getAll: vi.fn(async () => []) };
  return new GovernanceService(prisma as never, undefined, undefined, config as never, undefined);
}

describe('안건 컨텍스트 — 위반 집계 실패는 0건이 아니다', () => {
  it('집계가 실패하면 violations30d=null 과 산출 불가 사유를 함께 낸다', async () => {
    const ctx: any = await makeSvc(true).buildAssessContext(AGENDA as never);
    expect(ctx.sourceRefData.violations30d).toBeNull();
    expect(ctx.sourceRefData.violations30dNote).toMatch(/산출 불가/);
  });

  it('집계에 성공한 진짜 0건은 0으로 낸다(실패와 뒤섞지 않는다)', async () => {
    const ctx: any = await makeSvc(false).buildAssessContext(AGENDA as never);
    expect(ctx.sourceRefData.violations30d).toBe(0);
    expect(ctx.sourceRefData.violations30dNote).toBeUndefined();
  });
});
