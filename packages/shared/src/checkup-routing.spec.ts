import { describe, it, expect } from 'vitest';
import { checkupItemPriority, estimatedWaitMinutes, rankNextStations, CHECKUP_PRIORITY_UNRULED } from './checkup-routing';

describe('검진 다음 검사 추천 정본(P0-6)', () => {
  it('순서 규칙: 이름 매칭이 카테고리보다 먼저 · 규칙 밖은 상담 앞', () => {
    expect(checkupItemPriority({ category: 'LAB', name: '혈액검사' })).toBe(1);
    expect(checkupItemPriority({ category: 'LAB', name: '소변검사' })).toBe(5); // LAB 이어도 이름이 먼저
    expect(checkupItemPriority({ category: 'DIAGNOSTIC', name: '심전도' })).toBe(3);
    expect(checkupItemPriority({ category: 'DIAGNOSTIC', name: '위내시경' })).toBe(6);
    expect(checkupItemPriority({ category: 'CONSULT', name: '결과상담' })).toBe(99);
    expect(checkupItemPriority({ category: 'ETC', name: null })).toBe(CHECKUP_PRIORITY_UNRULED);
  });

  it('예상 대기: 둘 중 하나라도 모르면 null(0 으로 치지 않는다)', () => {
    expect(estimatedWaitMinutes({ waitingCount: 3, avgMinutes: 5 })).toBe(15);
    expect(estimatedWaitMinutes({ waitingCount: null, avgMinutes: 5 })).toBeNull();
    expect(estimatedWaitMinutes({ waitingCount: 0, avgMinutes: null })).toBeNull();
  });

  it('🔴 우선순위가 대기보다 먼저 · 같은 순위 안에서는 짧은 대기 · 모르는 대기는 뒤로', () => {
    const r = rankNextStations([
      { key: 'eye', priority: 3, waitingCount: null, avgMinutes: 8 },
      { key: 'ecg', priority: 3, waitingCount: 2, avgMinutes: 5 },
      { key: 'xray', priority: 3, waitingCount: 0, avgMinutes: 5 },
      { key: 'endo', priority: 6, waitingCount: 0, avgMinutes: 20 },
      { key: 'blood', priority: 1, waitingCount: 9, avgMinutes: 4 },
    ]);
    expect(r.map((c) => c.key)).toEqual(['blood', 'xray', 'ecg', 'eye', 'endo']);
  });

  it('입력을 바꾸지 않는다', () => {
    const input = [{ key: 'b', priority: 2, waitingCount: 0, avgMinutes: 1 }, { key: 'a', priority: 1, waitingCount: 0, avgMinutes: 1 }];
    rankNextStations(input);
    expect(input.map((c) => c.key)).toEqual(['b', 'a']);
  });
});
