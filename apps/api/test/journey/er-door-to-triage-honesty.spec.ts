import { describe, it, expect, vi } from 'vitest';
import { JourneyAnalyticsService } from '../../src/modules/journey-console/journey-analytics.service';

/**
 * door-to-triage 정직성 가드 — 시드 흐름 전수 검토 5단계(응급).
 *
 * 🔴 무엇이 있었나: 접수 화면이 도착 시각을 따로 받지 못해 도착과 분류가 **같은 순간**으로
 *    기록된다. 그 건을 그대로 세면 소요 **0분**이 되고, KTAS 목표(최소 1분) 아래라
 *    화면은 "위반율 0% = 전건 목표 달성"이라고 말한다 — 근거 없이 안심시키는 것(P17).
 *    0 은 "빨랐다"가 아니라 **"잴 수 없다"**다. 산출에서 빼되 **몇 건을 뺐는지 함께** 낸다.
 *
 * 계약: ① 동시 기록 건은 분모에 들어가지 않는다 ② 그 건수를 응답이 밝힌다
 *       ③ 진짜로 잰 건은 그대로 센다(대조군 — 무조건 빼지 않는다)
 *       ④ 분류 기록 자체가 없는 건은 **다른 이유**라 따로 센다
 */

const T0 = new Date('2026-08-20T01:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function erOf(rows: Record<string, unknown>[]) {
  const prisma = {
    emergencyVisit: { findMany: vi.fn(async () => rows) },
    waitingQueue: { findMany: vi.fn(async () => []) },
    admission: { findMany: vi.fn(async () => []) },
  };
  return new JourneyAnalyticsService(prisma as never).getFlowAnalytics({}).then((r) => r.er as {
    count: number;
    doorToTriage: { count: number; avg: number; breachRate: number | null };
    doorToTriageUnmeasurable: number;
    triageActMissing: number;
  });
}

const row = (o: Partial<Record<string, unknown>>) => ({
  arrivalAt: T0, triagedAt: null, treatmentStartedAt: null, dispositionAt: null, triageLevel: 'LEVEL_2', ...o,
});

describe('도착→트리아지 — 잴 수 없는 것을 0분으로 세지 않는다', () => {
  it('① 도착=분류 동시 기록은 분모에서 빠지고 ② 몇 건인지 밝힌다', async () => {
    const er = await erOf([row({ triagedAt: T0 }), row({ triagedAt: T0, triageLevel: 'LEVEL_1' })]);
    expect(er.count).toBe(2);
    expect(er.doorToTriage.count).toBe(0); // 산출 불가 — 0분 성적이 아니다
    expect(er.doorToTriageUnmeasurable).toBe(2);
    expect(er.doorToTriage.breachRate).toBeNull();
  });

  it('③ 대조군 — 실제로 잰 건은 그대로 센다(무조건 빼지 않는다)', async () => {
    const er = await erOf([row({ triagedAt: min(25) }), row({ triagedAt: T0 })]);
    expect(er.doorToTriage.count).toBe(1);
    expect(er.doorToTriage.avg).toBe(25);
    expect(er.doorToTriageUnmeasurable).toBe(1);
    // LEVEL_2 목표 10분 → 25분은 위반. 동시 기록 건이 위반율을 희석하지 않는다.
    expect(er.doorToTriage.breachRate).toBe(100);
  });

  it('④ 분류 기록 자체가 없는 건은 따로 센다 — 두 이유를 섞지 않는다', async () => {
    const er = await erOf([row({ triagedAt: null }), row({ triagedAt: T0 })]);
    expect(er.triageActMissing).toBe(1);
    expect(er.doorToTriageUnmeasurable).toBe(1);
    expect(er.doorToTriage.count).toBe(0);
  });
});
