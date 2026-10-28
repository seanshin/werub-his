import { describe, it, expect } from 'vitest';
import { orderTrackPhaseOf, currentAndNextStage, attentionThresholdsOf } from '../src/order-tracking';

/** 오더 추적 정본(2026-10-06) — 재주입: 결과 미확인 부서·현재 단계 판정·기준 정규화를 되돌리면 실패한다. */
const st = (pairs: [string, string | null][]) => pairs.map(([key, at]) => ({ key, at })) as never;

describe('국면', () => {
  it('🔴 결과 미확인은 검사·영상의 완료 + 의사 확인 없음뿐 · 약제 완료는 완료', () => {
    expect(orderTrackPhaseOf({ department: 'LAB', status: 'COMPLETED', stages: st([['ACKNOWLEDGED', null]]) })).toBe('RESULT_UNACK');
    expect(orderTrackPhaseOf({ department: 'LAB', status: 'COMPLETED', stages: st([['ACKNOWLEDGED', '2026-10-06T00:00:00Z']]) })).toBe('DONE');
    expect(orderTrackPhaseOf({ department: 'PHARMACY', status: 'COMPLETED', stages: st([]) })).toBe('DONE');
    expect(orderTrackPhaseOf({ department: 'IMAGING', status: 'IN_PROGRESS', stages: st([]) })).toBe('IN_PROCESS');
    expect(orderTrackPhaseOf({ department: 'LAB', status: 'CANCELLED', stages: st([]) })).toBe('CANCELLED');
  });
});

describe('지금·다음 단계', () => {
  it('🔴 시각 있는 마지막 단계(단계 순서) · 그 뒤 첫 빈 단계 · 앞의 빈 단계는 건너뛴다 · 취소 제외', () => {
    const r = currentAndNextStage(st([['ORDERED', 'a'], ['RECEIVED', null], ['COLLECTED', 'b'], ['RESULTED', null], ['CANCELLED', null]]));
    expect(r.current?.key).toBe('COLLECTED');
    expect(r.next).toBe('RESULTED');
    expect(currentAndNextStage(st([['ORDERED', null]]))).toEqual({ current: null, next: 'ORDERED' });
  });
});

describe('주의 기준', () => {
  it('🔴 미설정·빈 값은 null(판정 안 함) · 모르는 키·0·음수·문자는 버린다', () => {
    expect(attentionThresholdsOf(null)).toBeNull();
    expect(attentionThresholdsOf({})).toBeNull();
    expect(attentionThresholdsOf({ STAT: 30, ROUTINE: 0, URGENT: '60', BOGUS: 5 })).toEqual({ STAT: 30 });
    expect(attentionThresholdsOf([30])).toBeNull();
  });
});

import { patientOrderNotes } from '../src/order-tracking';
describe('환자별 확인 사항', () => {
  const o = (over: Record<string, unknown>) => ({ department: 'LAB', priority: 'ROUTINE', phase: 'WAITING', critical: false, attention: null, sinceOrderedMin: 10, carriedOver: false, dur: null, ...over }) as never;
  it('🔴 긴급(STAT·위급) → 주의 → 참고 순 · 해당 없는 항목은 싣지 않는다 · 주의는 기준(attention=true)이 있을 때만', () => {
    const n = patientOrderNotes([
      o({ priority: 'STAT', phase: 'IN_PROCESS', sinceOrderedMin: 40 }),
      o({ critical: true, phase: 'RESULT_UNACK', sinceOrderedMin: null }),
      o({ phase: 'RESULT_UNACK', sinceOrderedMin: null }),
      o({ phase: 'WAITING', sinceOrderedMin: 55, carriedOver: true }),
      o({ department: 'PHARMACY', phase: 'DONE', dur: { warned: true, overridden: true }, sinceOrderedMin: null }),
    ]);
    expect(n.map((x) => x.code)).toEqual(['STAT_ACTIVE', 'CRITICAL_UNACK', 'RESULT_UNACK', 'DUR_OVERRIDDEN', 'CARRIED_OVER', 'WAITING']);
    expect(n[0]).toEqual({ code: 'STAT_ACTIVE', level: 'URGENT', count: 1, minutes: 40 });
    expect(n.find((x) => x.code === 'WAITING')!.minutes).toBe(55);
    expect(patientOrderNotes([o({ phase: 'DONE', sinceOrderedMin: null })])).toEqual([]);
    expect(patientOrderNotes([o({ attention: true })]).map((x) => x.code)).toEqual(['ATTENTION_OVER', 'WAITING']);
  });
});
