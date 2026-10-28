import { describe, it, expect, vi } from 'vitest';
import { JourneyAnalyticsService } from '../../src/modules/journey-console/journey-analytics.service';
import { FLOW_TARGET_FALLBACK, checkInWindow, notFutureCheckIn, resolveFlowTargets } from '../../src/modules/journey-console/flow-canon';

/**
 * 여정 흐름 분석(/journey-console/analytics = 화면상 /flow-analytics) 계약 — W8(2026-08-14).
 *
 * 🔴 이 화면이 냈던 세 가지 거짓:
 *   Q8  날짜 정본을 안 써서 `from` 은 UTC 자정·`to` 는 KST 말일 → **KST 00:00~09:00 전량 누락**
 *   Q10 '접수→호출 대기'에 수납 대기 목표(30분)를 걸어, 같은 호출 지연을 관제는 10분으로 판정
 *   Q11 `startedAt: { not: null }` 이 완료 외래 436건 중 **431건(98.9%)** 을 잘라 "5건"으로 보이게 함
 */

function cfg(values: Record<string, unknown> = {}) {
  return { get: vi.fn(async (k: string) => (k in values ? values[k] : null)) } as never;
}

function prismaMock(opd: Record<string, unknown>[] = []) {
  return {
    waitingQueue: { findMany: vi.fn().mockResolvedValue(opd) },
    emergencyVisit: { findMany: vi.fn().mockResolvedValue([]) },
    admission: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('🔴 Q8 — 날짜는 정본(day-range) 하나', () => {
  it('date-only 하한은 **로컬(KST) 자정** — UTC 자정이 아니다', async () => {
    const prisma = prismaMock();
    await new JourneyAnalyticsService(prisma as never, cfg()).getFlowAnalytics({ from: '2026-08-13', to: '2026-08-13' });
    const where = prisma.waitingQueue.findMany.mock.calls[0][0].where;
    const gte: Date = where.completedAt.gte;
    // 로컬 자정이면 시/분/초가 0 이다. UTC 자정으로 파싱됐다면 KST 에서 09:00 이 된다.
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
  });

  it('상한은 **다음날 로컬 자정 미만(lt)** — 같은 날 하나만 주면 그 하루 전체', async () => {
    const prisma = prismaMock();
    await new JourneyAnalyticsService(prisma as never, cfg()).getFlowAnalytics({ from: '2026-08-13', to: '2026-08-13' });
    const where = prisma.waitingQueue.findMany.mock.calls[0][0].where;
    expect(where.completedAt.lte).toBeUndefined(); // 포함 상한 금지(그날이 통째로 빠지거나 하루가 밀린다)
    const lt: Date = where.completedAt.lt;
    expect(lt.getHours()).toBe(0);
    expect(lt.getTime() - where.completedAt.gte.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('응답의 period 는 상한이 배타임을 이름으로 말한다', async () => {
    const r = await new JourneyAnalyticsService(prismaMock() as never, cfg()).getFlowAnalytics({ from: '2026-08-13', to: '2026-08-13' });
    expect(r.period).toHaveProperty('toExclusive');
  });
});

describe('🔴 Q11 — 분자·분모가 같은 모집단(where 로 표본을 잘라내지 않는다)', () => {
  const t = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);

  it('`startedAt: { not: null }` 이 where 에 없다 — 완료 전량이 모집단', async () => {
    const prisma = prismaMock();
    await new JourneyAnalyticsService(prisma as never, cfg()).getFlowAnalytics({});
    const where = prisma.waitingQueue.findMany.mock.calls[0][0].where;
    expect(where.startedAt).toBeUndefined();
    expect(where.status).toBe('COMPLETED');
  });

  it('진료 시작 시각이 없는 완료 건도 count 에 남고, 단계별 표본만 줄어든다', async () => {
    // 실측 비율 재현: 완료 5건 중 startedAt 보유 1건
    const rows = [
      { checkedInAt: t(60), calledAt: t(50), startedAt: t(40), completedAt: t(10), departmentName: '내과' },
      ...Array.from({ length: 4 }, () => ({ checkedInAt: t(60), calledAt: null, startedAt: null, completedAt: t(10), departmentName: '내과' })),
    ];
    const r = await new JourneyAnalyticsService(prismaMock(rows) as never, cfg()).getFlowAnalytics({});
    expect(r.opd.count).toBe(5);              // 종전엔 1 로 보였다
    expect(r.opd.waitToConsult.count).toBe(1); // 단계 표본은 스스로 1 이라고 말한다
    expect(r.opd.total.count).toBe(5);
    expect(r.opd.countBasis).toContain('완료');
  });
});

describe('🔴 Q10 — 단계별 목표는 정본 하나(flow-canon)', () => {
  const t = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);

  it("'접수→호출 대기'의 목표는 호출 지연 목표(10분)다 — 수납 대기 목표(30분)가 아니다", async () => {
    const rows = [{ checkedInAt: t(80), calledAt: t(60), startedAt: t(55), completedAt: t(10), departmentName: '내과' }];
    const r = await new JourneyAnalyticsService(prismaMock(rows) as never, cfg()).getFlowAnalytics({});
    expect(r.opd.waitToCall.target).toBe(FLOW_TARGET_FALLBACK.callDelayMin);
    expect(r.opd.waitToCall.target).toBe(10);
    expect(r.opd.waitToConsult.target).toBe(FLOW_TARGET_FALLBACK.opdWaitMin);
  });

  it('config 개정이 두 화면에 동시에 반영된다(같은 키)', async () => {
    const rows = [{ checkedInAt: t(80), calledAt: t(60), startedAt: t(55), completedAt: t(10), departmentName: '내과' }];
    const r = await new JourneyAnalyticsService(prismaMock(rows) as never, cfg({ 'qi.targets.callDelayMinutes': 7 })).getFlowAnalytics({});
    expect(r.opd.waitToCall.target).toBe(7);
  });

  it('응답이 적용 목표를 함께 낸다(무엇을 위반이라 했는지)', async () => {
    const r = await new JourneyAnalyticsService(prismaMock() as never, cfg()).getFlowAnalytics({});
    expect(r.targets.opdWaitMin).toBe(30);
    expect(r.targets.callDelayMin).toBe(10);
    expect(r.targets.doorToTriage.LEVEL_1).toBe(1);
  });

  it('목표 해석은 flow-canon 하나 — 잘못된 config 는 조용히 폴백(fail-safe)', async () => {
    const t1 = await resolveFlowTargets(cfg({ 'qi.targets.callDelayMinutes': 'abc', 'qi.targets.opdWaitMinutes': -5 }));
    expect(t1.callDelayMin).toBe(FLOW_TARGET_FALLBACK.callDelayMin);
    expect(t1.opdWaitMin).toBe(FLOW_TARGET_FALLBACK.opdWaitMin);
  });
});

/**
 * 🔴 Q4 원칙 — **자르면 잘랐다고 말한다**. 조용한 truncation 은 "이게 전부"라는 거짓말이다.
 */
describe('🔴 목록을 자르면 잘렸음을 응답이 알린다', () => {
  const t = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);

  it('진료과 상위 12개로 자를 때 총계와 잘린 수를 함께 낸다', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      checkedInAt: t(60 + i), calledAt: t(50), startedAt: t(40), completedAt: t(10), departmentName: `과${i}`,
    }));
    const r = await new JourneyAnalyticsService(prismaMock(rows) as never, cfg()).getFlowAnalytics({});
    expect(r.opd.byDept).toHaveLength(12);
    expect(r.opd.byDeptTotal).toBe(20);
    expect(r.opd.byDeptTruncated).toBe(8);
  });

  it('자르지 않았으면 잘린 수는 0(있지도 않은 생략을 말하지 않는다)', async () => {
    const rows = [{ checkedInAt: t(60), calledAt: t(50), startedAt: t(40), completedAt: t(10), departmentName: '내과' }];
    const r = await new JourneyAnalyticsService(prismaMock(rows) as never, cfg()).getFlowAnalytics({});
    expect(r.opd.byDeptTruncated).toBe(0);
    expect(r.bottlenecksTruncated).toBe(0);
  });
});

describe('🔴 Q9 — 미래 접수 상한 정본', () => {
  it('notFutureCheckIn 은 항상 lte 상한을 낸다', () => {
    const now = new Date('2026-08-14T14:00:00+09:00');
    expect(notFutureCheckIn(now)).toEqual({ lte: now });
  });

  it('checkInWindow 은 구간 끝과 now 중 **이른 쪽**을 상한으로 쓴다', () => {
    const now = new Date('2026-08-14T14:00:00+09:00');
    const future = new Date('2099-01-01T00:00:00+09:00');
    const past = new Date('2026-08-10T00:00:00+09:00');
    expect(checkInWindow(undefined, future, now).lte).toEqual(now);
    expect(checkInWindow(undefined, past, now).lte).toEqual(past);
  });

  it('분석 외래 조회에도 상한이 붙는다', async () => {
    const prisma = prismaMock();
    await new JourneyAnalyticsService(prisma as never, cfg()).getFlowAnalytics({});
    const where = prisma.waitingQueue.findMany.mock.calls[0][0].where;
    expect(where.checkedInAt.lte).toBeInstanceOf(Date);
  });
});
