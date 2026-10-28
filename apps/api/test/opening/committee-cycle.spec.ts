import { describe, it, expect, vi } from 'vitest';
import { OpeningService, cyclePeriod } from '../../src/modules/opening/opening.service';

/**
 * 위원회 주기 준수 (P2 · 2026-08-28).
 *
 * 🔴 발단: `meetingCycle` 은 저장·표시만 되고 **준수를 계산하는 코드가 0개**였다.
 * 🔴 이 축의 위험은 **없는 위반을 만드는 것**이다 — 수시 위원회를 미준수라 하거나,
 *    기록이 없는 것을 "안 열렸다"고 단정하거나, 예정을 개최로 세는 것.
 */
const AUG_28 = new Date(2026, 7, 28);

describe('주기 구간', () => {
  it('월간은 그 달', () => {
    const p = cyclePeriod('MONTHLY', AUG_28)!;
    expect(p.label).toBe('2026년 8월');
    expect(p.from).toEqual(new Date(2026, 7, 1));
    expect(p.to).toEqual(new Date(2026, 8, 1));
  });

  it('분기는 그 분기', () => {
    expect(cyclePeriod('QUARTERLY', AUG_28)!.label).toBe('2026년 3분기');
  });

  it('반기·연간', () => {
    expect(cyclePeriod('SEMIANNUAL', AUG_28)!.label).toBe('2026년 하반기');
    expect(cyclePeriod('ANNUAL', AUG_28)!.label).toBe('2026년');
  });

  it('🔴 수시·미설정은 판정 대상이 아니다 — 주기 없는 것을 미준수라 하면 거짓 경보다', () => {
    expect(cyclePeriod('AD_HOC', AUG_28)).toBeNull();
    expect(cyclePeriod(null, AUG_28)).toBeNull();
    expect(cyclePeriod(undefined, AUG_28)).toBeNull();
  });
});

function makeSvc(committees: unknown[]) {
  const prisma = { committee: { findMany: vi.fn().mockResolvedValue(committees) } };
  return new OpeningService(prisma as never, {} as never, {} as never);
}

const M = (iso: string, status: string) => ({ scheduledAt: new Date(iso), status });

describe('판정', () => {
  it('🔴 예정(SCHEDULED)은 개최가 아니다 — 미래 일정을 개최로 세면 거짓이 된다', async () => {
    const svc = makeSvc([
      { id: 'a', code: 'X', name: 'X위', meetingCycle: 'MONTHLY', meetings: [M('2026-08-30T00:00:00+09:00', 'SCHEDULED')] },
    ]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.rows[0].heldThisPeriod).toBe(false);
  });

  it('이번 주기에 개최 기록이 있으면 true', async () => {
    const svc = makeSvc([
      { id: 'a', code: 'X', name: 'X위', meetingCycle: 'MONTHLY', meetings: [M('2026-08-05T00:00:00+09:00', 'COMPLETED')] },
    ]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.rows[0].heldThisPeriod).toBe(true);
  });

  it('지난 주기 개최는 이번 주기가 아니다', async () => {
    const svc = makeSvc([
      { id: 'a', code: 'X', name: 'X위', meetingCycle: 'MONTHLY', meetings: [M('2026-07-20T00:00:00+09:00', 'COMPLETED')] },
    ]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.rows[0].heldThisPeriod).toBe(false);
    expect(out.rows[0].lastHeldAt, '마지막 개최는 남긴다').not.toBeNull();
  });

  it('🔴 수시 위원회는 `null` 로 남는다 — false 가 아니다', async () => {
    const svc = makeSvc([
      { id: 'a', code: 'ETH', name: '윤리위', meetingCycle: 'AD_HOC', meetings: [] },
    ]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.rows[0].heldThisPeriod).toBeNull();
    expect(out.rows[0].reason).toContain('수시');
  });

  it('🔴 개최 기록이 없으면 lastHeldAt 은 `null` — 0 이나 오늘이 아니다', async () => {
    const svc = makeSvc([
      { id: 'a', code: 'X', name: 'X위', meetingCycle: 'MONTHLY', meetings: [M('2026-08-05T00:00:00+09:00', 'SCHEDULED')] },
    ]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.rows[0].lastHeldAt).toBeNull();
  });
});

describe('🔴 분모와 어휘', () => {
  it('판정 못 하는 것을 분모에 넣지 않는다', async () => {
    const svc = makeSvc([
      { id: 'a', code: 'A', name: 'A', meetingCycle: 'MONTHLY', meetings: [M('2026-08-05T00:00:00+09:00', 'COMPLETED')] },
      { id: 'b', code: 'B', name: 'B', meetingCycle: 'MONTHLY', meetings: [] },
      { id: 'c', code: 'C', name: 'C', meetingCycle: 'AD_HOC', meetings: [] },
    ]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.summary.judged, '수시는 분모에서 빠진다').toBe(2);
    expect(out.summary.withRecord).toBe(1);
    expect(out.summary.withoutRecord).toBe(1);
    expect(out.summary.notJudged).toBe(1);
  });

  it('🔴 "미개최"라 말하지 않는다 — 시스템에 안 남았을 뿐일 수 있다', async () => {
    const svc = makeSvc([]);
    const out = await svc.committeeCycleCompliance(AUG_28);
    expect(out.caveat).toContain('시스템에 남지 않았다');
    expect(out.caveat).toContain('예정(SCHEDULED)은 개최로 세지 않는다');
    // 필드 이름 자체가 판정이 아니라 사실이어야 한다
    expect(Object.keys(out.summary)).toContain('withoutRecord');
    expect(Object.keys(out.summary)).not.toContain('violations');
  });
});
