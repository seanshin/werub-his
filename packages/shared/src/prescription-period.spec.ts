import { describe, it, expect } from 'vitest';
import {
  dosingWindow,
  isKnownDosing,
  isScreenedForInteraction,
  dispensingStage,
  orderClaimsCompleteButNot,
  DOSING_STATE_LABEL,
  DISPENSING_STAGE_LABEL,
} from './prescription-period';

const NOW = new Date('2026-08-26T12:00:00+09:00');

describe('dosingWindow — 투여기간 3상태', () => {
  it('투여일수가 남아 있으면 DOSING', () => {
    const w = dosingWindow({ createdAt: '2026-08-24T09:00:00+09:00', duration: 7 }, NOW);
    expect(w.state).toBe('DOSING');
    expect(w.endsAt).not.toBeNull();
    expect(w.daysSinceEnd).toBeNull();
  });

  it('투여일수가 지났으면 ENDED + 경과일', () => {
    const w = dosingWindow({ createdAt: '2026-08-01T09:00:00+09:00', duration: 3 }, NOW);
    expect(w.state).toBe('ENDED');
    expect(w.daysSinceEnd).toBe(22);
  });

  it('🔴 duration 이 없으면 UNKNOWN — ENDED 도 DOSING 도 아니다', () => {
    // 운영 활성 594건 중 186건이 이 경우다. 어느 쪽으로 단정해도 거짓이 된다.
    for (const d of [null, undefined, 0, -1, NaN]) {
      const w = dosingWindow({ createdAt: '2026-01-01T00:00:00Z', duration: d as number | null }, NOW);
      expect(w.state).toBe('UNKNOWN');
      // 🔴 모르는 시각을 지어내지 않는다
      expect(w.endsAt).toBeNull();
    }
  });

  it('🔴 처방 시각을 모르면 UNKNOWN — 추정하지 않는다', () => {
    expect(dosingWindow({ createdAt: null, duration: 7 }, NOW).state).toBe('UNKNOWN');
    expect(dosingWindow({ createdAt: 'not-a-date', duration: 7 }, NOW).state).toBe('UNKNOWN');
  });

  it('경계: 종료 시각 직전은 DOSING, 직후는 ENDED', () => {
    const start = new Date('2026-08-20T00:00:00Z');
    const end = new Date(start.getTime() + 3 * 86400000);
    expect(dosingWindow({ createdAt: start, duration: 3 }, new Date(end.getTime() - 1)).state).toBe('DOSING');
    expect(dosingWindow({ createdAt: start, duration: 3 }, new Date(end.getTime() + 1)).state).toBe('ENDED');
  });
});

describe('표시 판정과 안전 점검 판정은 다르다', () => {
  it('🔴 표시: UNKNOWN 을 "복용 중"이라 쓰지 않는다', () => {
    expect(isKnownDosing('DOSING')).toBe(true);
    expect(isKnownDosing('UNKNOWN')).toBe(false);
    expect(isKnownDosing('ENDED')).toBe(false);
  });

  it('🔴 안전 점검: UNKNOWN 은 포함하고 ENDED 만 뺀다', () => {
    // 빠뜨리면 진짜 상호작용을 놓치고, 끝난 약을 넣으면 거짓 경보가 진짜 경보를 죽인다.
    expect(isScreenedForInteraction('DOSING')).toBe(true);
    expect(isScreenedForInteraction('UNKNOWN')).toBe(true);
    expect(isScreenedForInteraction('ENDED')).toBe(false);
  });

  it('🔴 두 판정이 같아지면 한쪽은 반드시 거짓이다 — UNKNOWN 에서 갈라져야 한다', () => {
    // 대조군: 이 단언이 깨지면 두 함수를 하나로 합친 것이다.
    expect(isKnownDosing('UNKNOWN')).not.toBe(isScreenedForInteraction('UNKNOWN'));
  });

  it('라벨 정본이 세 상태를 모두 덮는다', () => {
    for (const s of ['DOSING', 'ENDED', 'UNKNOWN'] as const) {
      expect(DOSING_STATE_LABEL[s]).toBeTruthy();
    }
  });
});

describe('dispensingStage — 오더가 아니라 조제가 정본', () => {
  it('🔴 조제 완료(DISPENSED)인데 오더가 COMPLETED 여도 "불출 완료"가 아니다', () => {
    const stage = dispensingStage({ orderStatus: 'COMPLETED', dispensingStatus: 'DISPENSED' });
    expect(stage).toBe('DISPENSED');
    expect(stage).not.toBe('ISSUED');
    // 라벨이 검수 전임을 말해야 한다
    expect(DISPENSING_STAGE_LABEL[stage]).toContain('검수');
  });

  it('🔴 검수 완료(VERIFIED)도 아직 불출 전이다', () => {
    const stage = dispensingStage({ orderStatus: 'COMPLETED', dispensingStatus: 'VERIFIED' });
    expect(stage).toBe('VERIFIED');
    expect(DISPENSING_STAGE_LABEL[stage]).toContain('불출');
  });

  it('불출(ISSUED)까지 가야 끝난 것이다', () => {
    expect(dispensingStage({ orderStatus: 'COMPLETED', dispensingStatus: 'ISSUED' })).toBe('ISSUED');
  });

  it('조제 기록이 없으면 오더 상태로만 말한다', () => {
    expect(dispensingStage({ orderStatus: 'ORDERED' })).toBe('NOT_STARTED');
    expect(dispensingStage({ orderStatus: 'RECEIVED' })).toBe('NOT_STARTED');
    expect(dispensingStage({ orderStatus: 'IN_PROGRESS' })).toBe('PREPARING');
    expect(dispensingStage({ orderStatus: 'CANCELLED' })).toBe('CANCELLED');
  });

  it('조제 취소는 오더 상태보다 우선한다', () => {
    expect(dispensingStage({ orderStatus: 'COMPLETED', dispensingStatus: 'CANCELLED' })).toBe('CANCELLED');
  });
});

describe('orderClaimsCompleteButNot — "완료"가 거짓이 되는 조건', () => {
  it('🔴 조제/검수 대기 중인 COMPLETED 오더는 완료라고 말하면 안 된다', () => {
    expect(orderClaimsCompleteButNot({ orderStatus: 'COMPLETED', dispensingStatus: 'PENDING' })).toBe(true);
    expect(orderClaimsCompleteButNot({ orderStatus: 'COMPLETED', dispensingStatus: 'DISPENSED' })).toBe(true);
    expect(orderClaimsCompleteButNot({ orderStatus: 'COMPLETED', dispensingStatus: 'VERIFIED' })).toBe(true);
  });

  it('대조군: 진짜로 끝났거나 아직 시작 전이면 거짓 경보를 내지 않는다', () => {
    // 🔴 무조건 true 를 내는 가드는 가드가 아니다.
    expect(orderClaimsCompleteButNot({ orderStatus: 'COMPLETED', dispensingStatus: 'ISSUED' })).toBe(false);
    expect(orderClaimsCompleteButNot({ orderStatus: 'ORDERED' })).toBe(false);
    expect(orderClaimsCompleteButNot({ orderStatus: 'IN_PROGRESS', dispensingStatus: 'PENDING' })).toBe(false);
    expect(orderClaimsCompleteButNot({ orderStatus: 'COMPLETED', dispensingStatus: 'CANCELLED' })).toBe(false);
  });
});

describe('중단(discontinuedAt) — 2026-09-30', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  it('중단 시각이 지났으면 기간이 남았어도 ENDED · 종료 시각은 중단 시각', () => {
    const w = dosingWindow({ createdAt: '2026-09-25T00:00:00Z', duration: 30, discontinuedAt: '2026-09-28T09:00:00Z' }, now);
    expect(w.state).toBe('ENDED');
    expect(w.endsAt).toBe('2026-09-28T09:00:00.000Z');
  });
  it('기간을 몰라도 중단 시각은 안다 — UNKNOWN 이 아니라 ENDED', () => {
    expect(dosingWindow({ createdAt: '2026-09-25T00:00:00Z', duration: null, discontinuedAt: '2026-09-29T00:00:00Z' }, now).state).toBe('ENDED');
  });
  it('대조군 — 중단 시각이 없으면 종전대로 기간으로 판정', () => {
    expect(dosingWindow({ createdAt: '2026-09-25T00:00:00Z', duration: 30 }, now).state).toBe('DOSING');
  });
});
