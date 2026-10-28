import { describe, it, expect } from 'vitest';
import { buildLanes, laneRange, laneTicks, nowPos, type RxInput } from './prescription-lanes';

/**
 * 처방 시계열(레인) 골든 — 2026-07-30.
 * 불변: 같은 약은 한 레인 · 기간 없는 처방은 만들어내지 않고 시점 표시 · 취소는 진행 중 아님.
 */
const DAY = 86400000;
const NOW = Date.parse('2026-07-30T09:00:00+09:00');
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const rx = (over: Partial<RxInput> & { id: string }): RxInput => ({
  at: at(10), title: '메트포르민', code: 'M1', rxType: 'MEDICATION', status: 'ACTIVE', ...over,
});

describe('buildLanes — 약품별 묶기', () => {
  it('같은 코드는 한 레인에 여러 막대로 누적(반복 처방)', () => {
    const { lanes } = buildLanes([
      rx({ id: 'a', at: at(90), duration: 30 }),
      rx({ id: 'b', at: at(50), duration: 30 }),
    ], NOW);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].bars.map((b) => b.id)).toEqual(['a', 'b']); // 시작순
  });

  it('이름이 달라도 코드가 같으면 한 레인(표기 차이 흡수)', () => {
    const { lanes } = buildLanes([
      rx({ id: 'a', title: '메트포르민정', code: 'M1' }),
      rx({ id: 'b', title: '메트포르민 서방정', code: 'M1' }),
    ], NOW);
    expect(lanes).toHaveLength(1);
  });

  it('코드가 없으면 이름으로 묶는다', () => {
    const { lanes } = buildLanes([
      rx({ id: 'a', code: null, title: '병실 내 보행', rxType: 'ACTIVITY' }),
      rx({ id: 'b', code: null, title: '병실 내 보행', rxType: 'ACTIVITY' }),
      rx({ id: 'c', code: null, title: '체위 변경', rxType: 'NURSING' }),
    ], NOW);
    expect(lanes).toHaveLength(2);
  });

  it('최근 처방이 있는 레인이 위로', () => {
    const { lanes } = buildLanes([
      rx({ id: 'old', code: 'A', title: '가', at: at(100) }),
      rx({ id: 'new', code: 'B', title: '나', at: at(2) }),
    ], NOW);
    expect(lanes[0].name).toBe('나');
  });
});

describe('막대 — 기간 유무', () => {
  it('기간이 있으면 시작+일수로 종료 계산', () => {
    const { lanes } = buildLanes([rx({ id: 'a', at: at(10), duration: 5 })], NOW);
    const b = lanes[0].bars[0];
    expect(b.hasDuration).toBe(true);
    expect(b.days).toBe(5);
    expect(b.endMs - b.startMs).toBe(5 * DAY);
  });

  it('기간이 없으면 종료=시작(시점 표시)이고 없는 기간을 만들지 않음', () => {
    const { lanes } = buildLanes([rx({ id: 'a', duration: null })], NOW);
    const b = lanes[0].bars[0];
    expect(b.hasDuration).toBe(false);
    expect(b.days).toBe(0);
    expect(b.endMs).toBe(b.startMs);
    expect(b.width).toBeGreaterThan(0); // 보이긴 해야 함(최소폭)
  });

  it('막대 좌표는 0~1 범위 안', () => {
    const { lanes } = buildLanes([rx({ id: 'a', at: at(60), duration: 30 }), rx({ id: 'b', at: at(1), duration: 3 })], NOW);
    for (const l of lanes) for (const b of l.bars) {
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(1.0001);
    }
  });

  it('용량·용법·일수를 라벨로 요약', () => {
    const { lanes } = buildLanes([rx({ id: 'a', dosage: '500mg', frequency: 'bid', duration: 30 })], NOW);
    expect(lanes[0].bars[0].label).toBe('500mg · bid · 30일');
  });
});

describe('진행 중 판정', () => {
  it('기간 내면 진행 중', () => {
    const { lanes } = buildLanes([rx({ id: 'a', at: at(3), duration: 30 })], NOW);
    expect(lanes[0].ongoing).toBe(true);
  });

  it('기간이 끝났으면 진행 중 아님', () => {
    const { lanes } = buildLanes([rx({ id: 'a', at: at(60), duration: 30 })], NOW);
    expect(lanes[0].ongoing).toBe(false);
  });

  it('취소된 처방은 기간 내라도 진행 중 아님', () => {
    const { lanes } = buildLanes([rx({ id: 'a', at: at(3), duration: 30, status: 'CANCELLED' })], NOW);
    expect(lanes[0].ongoing).toBe(false);
  });

  it('기간 미상은 최근 7일 이내만 진행 중으로 본다(추정 최소화)', () => {
    expect(buildLanes([rx({ id: 'a', at: at(3), duration: null })], NOW).lanes[0].ongoing).toBe(true);
    expect(buildLanes([rx({ id: 'a', at: at(20), duration: null })], NOW).lanes[0].ongoing).toBe(false);
  });
});

describe('축 — 범위·눈금·오늘', () => {
  it('범위는 최초 처방 이전~오늘 이후(여백 포함)', () => {
    const r = laneRange([rx({ id: 'a', at: at(30), duration: 5 })], NOW)!;
    expect(r.startMs).toBeLessThan(NOW - 30 * DAY);
    expect(r.endMs).toBeGreaterThanOrEqual(NOW);
  });

  it('빈 입력이면 범위 없음', () => {
    expect(laneRange([], NOW)).toBeNull();
    expect(buildLanes([], NOW).lanes).toEqual([]);
  });

  it('눈금은 최대 12개', () => {
    const r = laneRange([rx({ id: 'a', at: at(1000) })], NOW)!;
    expect(laneTicks(r).length).toBeLessThanOrEqual(12);
  });

  it('오늘 위치는 0~1, 범위 밖이면 null', () => {
    const r = laneRange([rx({ id: 'a', at: at(30) })], NOW)!;
    const p = nowPos(r, NOW)!;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(nowPos(r, r.endMs + DAY)).toBeNull();
  });
});
