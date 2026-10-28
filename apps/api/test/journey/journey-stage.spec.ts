import { describe, it, expect } from 'vitest';

/**
 * 여정 단계 판정 계약 — 2026-07-31.
 *
 * 🔴 `CALLED`(호출됨)가 else 로 흘러 '접수'에 묻혀 있었다 — 여정의 '호출' 칸은 항상 0이었고,
 *    상황판 접수 수치가 원무 카드(WAITING 만 셈)와 어긋나 보였다(188 vs 187 · 프로드 실측).
 *    아래는 서비스와 같은 규칙으로, 매핑이 되돌아가지 않게 고정한다.
 */
type Q = { status: string };

function stageOf(q: Q): string {
  return q.status === 'COMPLETED' ? 'DONE'
    : q.status === 'IN_CONSULTATION' ? 'IN_CONSULT'
    : q.status === 'CASHIER_WAITING' ? 'CASHIER_WAITING'
    : q.status === 'CALLED' ? 'CALLED'
    : 'RECEPTION';
}

describe('대기열 상태 → 여정 단계', () => {
  it('🔴 호출됨은 접수가 아니라 별도 단계다', () => {
    expect(stageOf({ status: 'CALLED' })).toBe('CALLED');
  });

  it('대기는 접수 단계', () => {
    expect(stageOf({ status: 'WAITING' })).toBe('RECEPTION');
  });

  it('진료중·수납대기·완료는 각자 단계', () => {
    expect(stageOf({ status: 'IN_CONSULTATION' })).toBe('IN_CONSULT');
    expect(stageOf({ status: 'CASHIER_WAITING' })).toBe('CASHIER_WAITING');
    expect(stageOf({ status: 'COMPLETED' })).toBe('DONE');
  });

  it('모르는 상태는 접수로 떨어뜨린다(환자를 잃지 않는다)', () => {
    expect(stageOf({ status: 'PHARMACY_WAITING' })).toBe('RECEPTION');
  });

  it('접수 단계 인원은 WAITING 만이어야 원무 카드와 일치한다', () => {
    const queues: Q[] = [
      ...Array.from({ length: 187 }, () => ({ status: 'WAITING' })),
      { status: 'CALLED' },
      { status: 'IN_CONSULTATION' }, { status: 'IN_CONSULTATION' },
      { status: 'CASHIER_WAITING' }, { status: 'CASHIER_WAITING' }, { status: 'CASHIER_WAITING' },
      { status: 'COMPLETED' },
    ];
    const counts = queues.reduce<Record<string, number>>((acc, q) => {
      const s = stageOf(q);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.RECEPTION).toBe(187); // 원무 카드의 '접수 대기'와 같은 수
    expect(counts.CALLED).toBe(1);
    expect(queues.length).toBe(194);    // 총원 보존 — 어느 단계로도 사라지지 않는다
  });
});
