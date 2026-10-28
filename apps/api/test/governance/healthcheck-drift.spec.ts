import { describe, expect, it, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';

/**
 * 헬스체크 드리프트 분류 계약(2026-08-05 재검토) — 동적/키자재 네임스페이스는 설계상 DB 전용이라
 * 드리프트가 아니다(종전 31건 중 20건 오탐). 실드리프트(구키·미등재 소비 키)만 집계한다.
 */

const DB_KEYS = [
  // 동적 키(오탐이었던 것들)
  'access.dept.원무과', 'access.role.DOCTOR', 'access.custom-page.guide', 'access.menu.overrides',
  'feature-access.config.orders', 'pacs.access.DOCTOR', 'rbac.roleOverrides',
  // 키자재/동적 시크릿
  'sign.jwksPrivateSecret', 'sign.jwksKid', 'smart.idToken.jwksPublicJwk', 'erp.targetTokenSecret', 'lis.targetTokenSecret',
  // 실드리프트(구키 — DEFAULTS 에 없음)
  'clinical.vitals.threshold', 'general.hospital.name',
  // 정상 등재 키
  'dur.enforce', 'chemo.cycleGate', 'erp.targetAuthEnforce',
];

function makeSvc() {
  const registered = new Set(['dur.enforce', 'chemo.cycleGate', 'erp.targetAuthEnforce']);
  const prisma = {
    systemConfig: { findMany: vi.fn(async () => DB_KEYS.map((key) => ({ key }))) },
    // 🔴 healthCheck 가 코드 없는 위원회도 함께 본다(2026-08-27) — 목이 빠뜨리면 헬스체크가 통째로 죽는다
    committee: { findMany: vi.fn(async () => []) },
  };
  const enactment = { hasDefaultKey: (k: string) => registered.has(k) };
  const config = { getAll: vi.fn(async () => []), get: vi.fn(async () => null) };
  return new GovernanceService(prisma as never, enactment as never, undefined, config as never, undefined);
}

describe('healthCheck 드리프트 분류', () => {
  it('동적 키·키자재 12건 제외, 실드리프트 2건만 집계(오탐 재발 방지)', async () => {
    const h = await makeSvc().healthCheck();
    expect(h.configDrift.count).toBe(2);
    expect(h.configDrift.keys.sort()).toEqual(['clinical.vitals.threshold', 'general.hospital.name']);
    expect(h.configDrift.ignoredDynamic).toBe(12);
  });

  it('등재된 실사용 키(chemo.cycleGate·erp.targetAuthEnforce)는 드리프트 아님 — 2026-08-05 등재 해소분', async () => {
    const h = await makeSvc().healthCheck();
    expect(h.configDrift.keys).not.toContain('chemo.cycleGate');
    expect(h.configDrift.keys).not.toContain('erp.targetAuthEnforce');
  });
});
