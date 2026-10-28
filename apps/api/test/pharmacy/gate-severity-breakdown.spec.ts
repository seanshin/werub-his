import { describe, it, expect, vi } from 'vitest';
import { SafetyGateService } from '../../src/modules/safety-gate/safety-gate.service';

/**
 * 🔴 외부 점검 — 안전 게이트 관제 카드가 "30일 차단 3건"이라 적었는데 실제는 **BLOCK 2 + WARN 1** 이었다.
 * 한 게이트의 원장에는 그 게이트가 WARN 이던 기간의 경고가 함께 쌓인다. 경고 통과를 차단이라 부르면
 * "게이트가 실제로 잡고 있다"는 초록 문구가 **잡지 않은 건까지** 근거로 쓴다.
 *
 * 지킨다: 집계가 심각도를 **나눠서** 내려보낸다(화면이 나눠 말할 수 있게).
 */
describe('🔴 안전 게이트 집계 — 차단과 경고를 나눠 센다', () => {
  it('blocked30d · warned30d 가 심각도별로 따로 센다', async () => {
    const counts: Array<Record<string, any>> = [];
    const prisma = {
      gateViolationLog: {
        count: vi.fn(async ({ where }: any) => {
          counts.push(where);
          if (where.severity === 'BLOCK') return 2;
          if (where.severity === 'WARN') return 1;
          if (where.severity === 'OVERRIDE') return 0;
          return 3; // notIn(면제) — 전체 위반
        }),
        findMany: vi.fn(async () => []),
      },
    } as any;
    const svc = new SafetyGateService(prisma, { get: vi.fn() } as any);

    const d7 = new Date('2026-09-15T00:00:00Z');
    const d30 = new Date('2026-08-23T00:00:00Z');
    const stat = await (svc as any).fromViolationLog('pharmacy.durGate.enforce', d7, d30);

    expect(stat.violations30d, '전체 위반 수는 종전 그대로다').toBe(3);
    expect(stat.blocked30d, '차단만 세지 않았다').toBe(2);
    expect(stat.warned30d, '경고를 따로 세지 않았다').toBe(1);
    expect(stat.blocked30d + stat.warned30d).toBeLessThanOrEqual(stat.violations30d);
    // 대조군 — 심각도별 질의가 실제로 나갔다(0 이면 이 가드는 아무것도 보증하지 않는다)
    expect(counts.filter((w) => w.severity === 'BLOCK' || w.severity === 'WARN')).toHaveLength(2);
  });
});
