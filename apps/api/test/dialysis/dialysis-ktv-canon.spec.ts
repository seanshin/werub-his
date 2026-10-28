import { describe, it, expect, vi } from 'vitest';
import { DialysisService } from '../../src/modules/dialysis/dialysis.service';

/**
 * 🔴 Kt/V 원장 가드 — 이연 회수 T2-4(2026-08-18).
 *
 * 종전 동작: 투석 완료 화면이 보낸 **실측 Kt/V 는 DTO 누락으로 버려지고**,
 * 서버가 체중 기반 **비진단 근사식**으로 그 자리를 채워 원장 컬럼에 저장했다.
 * 그 값 위에서 `getStats` 가 '적절도 달성률'을 계산해 지표로 유통했다(P15).
 *
 * 규약: Kt/V 는 **실측만 저장한다.** 근사치는 저장하지 않고 참고용으로만 응답에 싣는다.
 * 표본이 없으면 달성률은 0% 가 아니라 **산출 불가(null)** 다.
 */

function makeService(sessions: { ktV: number }[] = []) {
  const session = {
    id: 's1', status: 'IN_PROGRESS', preWeight: 70,
    order: { duration: 240, dryWeight: 65 },
  };
  const captured: Record<string, unknown>[] = [];
  const prisma = {
    dialysisSession: {
      findUnique: vi.fn().mockResolvedValue(session),
      updateMany: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        captured.push(data);
        return Promise.resolve({ count: 1 });
      }),
      findMany: vi.fn().mockResolvedValue(sessions),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    dialysisOrder: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  return { svc: new DialysisService(prisma as never), captured, prisma };
}

describe('Kt/V 는 실측만 원장에 남는다', () => {
  it('🔴 실측을 보내면 그 값이 저장된다(근사식이 덮지 않는다)', async () => {
    const { svc, captured } = makeService();
    await svc.completeSession('s1', { postWeight: 67, actualDuration: 240, ktV: 1.45 });
    expect(Number(captured[0].ktV)).toBe(1.45);
  });

  it('🔴 실측이 없으면 원장 Kt/V 는 비워 둔다 — 근사치를 기록으로 만들지 않는다', async () => {
    const { svc, captured } = makeService();
    const out = await svc.completeSession('s1', { postWeight: 67, actualDuration: 240 });
    expect(captured[0].ktV).toBeUndefined();
    // 참고 추정치는 이름으로 구분해 응답에만 싣는다
    expect((out as { estimatedKtV: number | null }).estimatedKtV).toBeGreaterThan(0);
    expect((out as { ktVSource: string | null }).ktVSource).toBeNull();
  });

  it('실측을 보내면 추정치를 만들지 않는다', async () => {
    const { svc } = makeService();
    const out = await svc.completeSession('s1', { postWeight: 67, actualDuration: 240, ktV: 1.45 });
    expect((out as { estimatedKtV: number | null }).estimatedKtV).toBeNull();
    expect((out as { ktVSource: string | null }).ktVSource).toBe('MEASURED');
  });
});

describe('적절도 달성률은 표본을 밝힌다', () => {
  it('🔴 표본이 없으면 0% 가 아니라 산출 불가(null)', async () => {
    const { svc } = makeService([]);
    const stats = await svc.getStats() as { ktVRate: number | null; ktVAvg: number | null; ktVSampleN: number };
    expect(stats.ktVRate).toBeNull();
    expect(stats.ktVAvg).toBeNull();
    expect(stats.ktVSampleN).toBe(0);
  });

  it('표본이 있으면 달성률과 분모를 함께 낸다', async () => {
    const { svc } = makeService([{ ktV: 1.4 }, { ktV: 1.0 }]);
    const stats = await svc.getStats() as { ktVRate: number | null; ktVSampleN: number };
    expect(stats.ktVRate).toBe(50);
    expect(stats.ktVSampleN).toBe(2);
  });
});
