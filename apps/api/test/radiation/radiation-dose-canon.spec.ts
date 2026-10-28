import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RadiationService } from '../../src/modules/radiation/radiation.service';
import { RADIATION_PLAN_STATUS_LABEL, RADIATION_FRACTION_STATUS_LABEL } from '@hospital-run/shared';

/**
 * 🔴 방사선 누적선량·상태 어휘 가드 — 이연 회수 T2-4(2026-08-18).
 *
 * 실측에서 두 가지가 겹쳐 있었다:
 *  ① 시드가 조사된 분획을 `COMPLETED`(정본은 `DELIVERED`)로 넣었고,
 *  ② 누적선량 합산 조건이 `status: 'DELIVERED'` 였다.
 * 그래서 이미 조사한 8회(16Gy)가 합산에서 빠져 **총선량 초과 차단이 헛돌았다.**
 * 누적은 상태 문자열이 아니라 **기록된 선량**으로 센다 — 환자 몸에 들어간 선량은 라벨과 무관하다.
 */

function makeService(fractions: { deliveredDose: number | null; status: string }[]) {
  const plan = { id: 'plan-1', totalDose: 60, fractionDose: 2, totalFractions: 30, planApprovedAt: new Date('2026-08-01'), status: 'IN_TREATMENT' };
  const fraction = { id: 'fx-9', planId: 'plan-1', status: 'SCHEDULED', plan };

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'plan-1' }]),
    radiationFraction: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        // 서비스가 어떤 조건으로 과거 분획을 찾는지 그대로 재현한다
        const byDose = 'deliveredDose' in where;
        return Promise.resolve(
          fractions.filter((f) => (byDose ? f.deliveredDose !== null : f.status === 'DELIVERED')),
        );
      }),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'fx-9', ...data })),
    },
    radiationPlan: { update: vi.fn().mockResolvedValue({}) },
  };

  const prisma = {
    radiationFraction: { findUnique: vi.fn().mockResolvedValue(fraction) },
    $transaction: vi.fn().mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const config = { getGateMode: vi.fn().mockResolvedValue('BLOCK'), get: vi.fn().mockResolvedValue(undefined) };
  return { svc: new RadiationService(prisma as never, config as never), tx };
}

describe('누적선량은 상태 라벨이 아니라 기록된 선량으로 센다', () => {
  it('🔴 상태가 COMPLETED 로 저장된 과거 분획도 누적에 포함된다(총선량 초과가 잡힌다)', async () => {
    // 60Gy 처방에 이미 32회 × 2Gy = 64Gy 가 들어갔다(허용 +5% = 63Gy 초과). 상태 어휘는 오염돼 있다.
    const past = Array.from({ length: 32 }, () => ({ deliveredDose: 2, status: 'COMPLETED' }));
    const { svc } = makeService(past);

    // 🔴 조사선량은 **처방 분할선량과 같은 2Gy** 다 — 분할 이탈 검증이 아니라
    //    누적 검증이 걸리는지를 본다(다른 이유로 막히면 이 가드는 아무것도 보증하지 않는다).
    await expect(
      svc.deliverFraction('fx-9', { deliveredDose: 2 }),
    ).rejects.toThrow(/누적선량/);
  });

  it('과거 조사가 없으면 정상 조사는 통과한다(과잉 차단이 아니다)', async () => {
    const { svc } = makeService([]);
    const out = await svc.deliverFraction('fx-9', { deliveredDose: 2 });
    expect(out).toBeTruthy();
  });
});

describe('상태 어휘 정합', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/modules/radiation/radiation.service.ts'), 'utf-8');
  const SEED = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');

  it('서버가 쓰는 상태 문자열이 전부 정본 라벨표에 있다', () => {
    const used = [...SRC.matchAll(/status: '([A-Z_]+)'/g)].map((m) => m[1]);
    const known = new Set([
      ...Object.keys(RADIATION_PLAN_STATUS_LABEL),
      ...Object.keys(RADIATION_FRACTION_STATUS_LABEL),
    ]);
    const unknown = [...new Set(used)].filter((s) => !known.has(s));
    expect(unknown, `라벨표에 없는 상태를 서버가 만든다: ${unknown.join(', ')}`).toEqual([]);
  });

  it('🔴 시드가 방사선 상태에 다른 어휘를 넣지 않는다 — DB 만 고치면 다음 시드에서 되살아난다', () => {
    const radBlocks = [...SEED.matchAll(/radiationFraction\.upsert\(\{[\s\S]{0,900}?\}\)/g)].map((m) => m[0]);
    expect(radBlocks.length, '방사선 분획 시드 블록을 찾지 못했다').toBeGreaterThan(0);
    for (const block of radBlocks) {
      const statuses = [...block.matchAll(/status: [^,\n]*'([A-Z_]+)'/g)].map((m) => m[1]);
      for (const st of statuses) {
        expect(
          Object.keys(RADIATION_FRACTION_STATUS_LABEL),
          `시드가 정본 밖 분획 상태를 넣는다: ${st}`,
        ).toContain(st);
      }
    }
  });
});
