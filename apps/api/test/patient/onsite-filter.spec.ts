import { describe, it, expect } from 'vitest';
import { kstDayStart, onsitePatientWhere, parseOnsiteStates, ONSITE_QUEUE_STATUSES, ONSITE_STATE_KEYS, ONSITE_DEFAULT_KEYS } from '../../src/modules/patient/onsite-filter';

/**
 * 원내 환자 판정 골든 — 2026-07-31.
 * 🔴 '오늘'을 서버 로컬로 자르면 컨테이너(UTC)에서 오전 기록이 전날로 밀린다 → KST 고정.
 */
describe('kstDayStart', () => {
  it('KST 자정 경계를 UTC 로 정확히 환산한다(전날 15:00Z)', () => {
    expect(kstDayStart(new Date('2026-07-31T02:00:00Z')).toISOString()).toBe('2026-07-30T15:00:00.000Z');
  });

  it('🔴 UTC 기준 오전(=KST 오후)도 같은 날로 본다', () => {
    const morning = kstDayStart(new Date('2026-07-31T09:30:00Z')); // KST 18:30
    expect(morning.toISOString()).toBe('2026-07-30T15:00:00.000Z');
  });

  it('🔴 KST 자정 직후(UTC 15:10Z)는 새 날이다', () => {
    expect(kstDayStart(new Date('2026-07-30T15:10:00Z')).toISOString()).toBe('2026-07-30T15:00:00.000Z');
    expect(kstDayStart(new Date('2026-07-30T14:50:00Z')).toISOString()).toBe('2026-07-29T15:00:00.000Z');
  });
});

describe('onsitePatientWhere', () => {
  const w = onsitePatientWhere(undefined, new Date('2026-07-31T02:00:00Z'));

  it('재원·오늘 대기열·오늘 미서명 진료 3경로를 OR 로 본다', () => {
    expect(w.OR).toHaveLength(3);
    expect(w.OR[0]).toEqual({ admissions: { some: { status: 'ADMITTED' } } });
  });

  it('재원은 날짜 조건을 걸지 않는다(어제 입원한 환자도 지금 원내)', () => {
    expect(JSON.stringify(w.OR[0])).not.toContain('createdAt');
  });

  it('완료·취소·미방문 대기열은 원내로 보지 않는다', () => {
    expect(ONSITE_QUEUE_STATUSES).not.toContain('COMPLETED' as never);
    expect(ONSITE_QUEUE_STATUSES).not.toContain('CANCELLED' as never);
    expect(ONSITE_QUEUE_STATUSES).not.toContain('NO_SHOW' as never);
  });

  it('수납·약국 대기도 아직 원내다(진료만 끝났을 뿐)', () => {
    expect(ONSITE_QUEUE_STATUSES).toContain('CASHIER_WAITING');
    expect(ONSITE_QUEUE_STATUSES).toContain('PHARMACY_WAITING');
  });

  it('서명된 진료는 원내 근거가 아니다(귀가했을 수 있음)', () => {
    expect(JSON.stringify(w.OR[2])).toContain('DRAFT');
    expect(JSON.stringify(w.OR[2])).not.toContain('SIGNED');
  });
});

describe('상태 선택(parseOnsiteStates)', () => {
  it('빈 값·onsite 는 기본 시야(원내 상태 전부)로 해석한다', () => {
    expect(parseOnsiteStates(undefined)).toEqual(ONSITE_DEFAULT_KEYS);
    expect(parseOnsiteStates('onsite')).toEqual(ONSITE_DEFAULT_KEYS);
  });

  it('콤마 목록에서 유효한 키만 남긴다', () => {
    expect(parseOnsiteStates('admitted,cashier')).toEqual(['admitted', 'cashier']);
  });

  it('🔴 전부 알 수 없는 값이면 빈 목록이 아니라 기본 시야로 — 필터가 조용히 0건을 내지 않게', () => {
    expect(parseOnsiteStates('bogus,nope')).toEqual(ONSITE_DEFAULT_KEYS);
  });

  it('일부만 유효하면 유효한 것만(알 수 없는 값은 조용히 버림)', () => {
    expect(parseOnsiteStates('waiting,bogus')).toEqual(['waiting']);
  });
});

describe('상태별 where 구성', () => {
  const NOW = new Date('2026-07-31T02:00:00Z');

  it('재원만 고르면 대기열·진료 조건을 넣지 않는다', () => {
    const w = onsitePatientWhere('admitted', NOW);
    expect(w.OR).toHaveLength(1);
    expect(JSON.stringify(w.OR)).not.toContain('waitingQueues');
  });

  it('대기열 상태 여러 개는 한 조건으로 묶는다(in)', () => {
    const w = onsitePatientWhere('waiting,cashier', NOW);
    expect(w.OR).toHaveLength(1);
    expect(JSON.stringify(w.OR[0])).toContain('WAITING');
    expect(JSON.stringify(w.OR[0])).toContain('CASHIER_WAITING');
  });

  it('입원+대기열+진료를 함께 고르면 OR 3개', () => {
    expect(onsitePatientWhere('admitted,waiting,drafting', NOW).OR).toHaveLength(3);
  });

  it('대기열 조건에는 오늘(KST) 경계가 함께 걸린다', () => {
    const w = onsitePatientWhere('waiting', NOW);
    expect(JSON.stringify(w.OR[0])).toContain('2026-07-30T15:00:00.000Z');
  });
});

describe('예약(booked) — 원내가 아니라 "오늘 올 사람"', () => {
  const NOW = new Date('2026-07-31T02:00:00Z');

  it('🔴 기본 시야(원내 전체)에는 들어가지 않는다 — 도착 전이라 원내 수가 부풀려지면 안 된다', () => {
    expect(ONSITE_DEFAULT_KEYS).not.toContain('booked');
    expect(ONSITE_STATE_KEYS).toContain('booked');
    expect(JSON.stringify(onsitePatientWhere('onsite', NOW))).not.toContain('appointments');
  });

  it('명시적으로 고르면 오늘(KST) 예약만 — 도착 전 상태(SCHEDULED·CONFIRMED)', () => {
    const w = onsitePatientWhere('booked', NOW);
    const j = JSON.stringify(w);
    expect(j).toContain('appointments');
    expect(j).toContain('SCHEDULED');
    expect(j).toContain('CONFIRMED');
    expect(j).not.toContain('CANCELLED');
    expect(j).not.toContain('NO_SHOW');
    expect(j).toContain('2026-07-30T15:00:00.000Z');       // 오늘 시작(KST)
    expect(j).toContain('2026-07-31T15:00:00.000Z');       // 내일 시작 미만
  });

  it('원내 상태와 함께 고르면 합집합으로 본다', () => {
    expect(onsitePatientWhere('admitted,booked', NOW).OR).toHaveLength(2);
  });
});
