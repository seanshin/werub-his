import { describe, it, expect } from 'vitest';
import { parseCursor, formatCursor, compareItems, applyCursor } from '../../src/modules/record-timeline/timeline-cursor';

/**
 * 커서 골든 — 2026-07-30 프로드 실측 결함에서 나온 계약.
 * 같은 초에 작성된 경과기록 9건처럼 **동일 시각 다수 항목**이 유실·중복되지 않아야 한다.
 */
const T = '2026-06-22T08:52:28.371Z';
const items = [
  { id: 'b', at: new Date(T) },
  { id: 'a', at: new Date(T) },
  { id: 'c', at: new Date(T) },
  { id: 'z', at: new Date('2026-07-10T04:35:49.000Z') }, // 더 최신
  { id: 'y', at: new Date('2026-05-25T02:00:00.000Z') }, // 더 과거
];

describe('파싱·직렬화', () => {
  it('`<ISO>|<id>` 를 왕복한다', () => {
    const c = parseCursor(formatCursor({ at: new Date(T), id: 'a|b' }))!;
    expect(c.at.toISOString()).toBe(T);
    expect(c.id).toBe('a|b'); // id 에 구분자가 있어도 마지막 것만 구분자로 본다
  });

  it('구형(시각만) 커서도 받는다', () => {
    expect(parseCursor(T)!.id).toBe('');
  });

  it('빈 값·깨진 값은 커서 없음', () => {
    expect(parseCursor(undefined)).toBeUndefined();
    expect(parseCursor('not-a-date|x')).toBeUndefined();
  });
});

describe('정렬은 결정적이어야 한다', () => {
  it('시각 내림차순 · 동일 시각은 id 오름차순', () => {
    expect([...items].sort(compareItems).map((i) => i.id)).toEqual(['z', 'a', 'b', 'c', 'y']);
  });
});

describe('커서 경계(applyCursor)', () => {
  const sorted = [...items].sort(compareItems);

  it('🔴 동일 시각의 뒤따르는 항목이 살아남는다(유실 금지)', () => {
    const cursor = parseCursor(formatCursor({ at: new Date(T), id: 'a' }))!;
    expect(applyCursor(sorted, cursor).map((i) => i.id)).toEqual(['b', 'c', 'y']);
  });

  it('🔴 커서 항목 자체와 그 앞은 다시 나오지 않는다(중복 금지)', () => {
    const cursor = parseCursor(formatCursor({ at: new Date(T), id: 'c' }))!;
    expect(applyCursor(sorted, cursor).map((i) => i.id)).toEqual(['y']);
  });

  it('전 페이지를 순회하면 전량이 정확히 한 번씩 나온다', () => {
    const seen: string[] = [];
    let cur = undefined as ReturnType<typeof parseCursor>;
    for (let guard = 0; guard < 10; guard++) {
      const page = applyCursor(sorted, cur).slice(0, 2);
      if (!page.length) break;
      seen.push(...page.map((i) => i.id));
      cur = parseCursor(formatCursor(page[page.length - 1]));
    }
    expect(seen).toEqual(['z', 'a', 'b', 'c', 'y']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('커서가 없으면 전량 그대로', () => {
    expect(applyCursor(sorted, undefined)).toHaveLength(5);
  });

  it('구형(시각만) 커서는 동일 시각 전부를 건너뛴다(종전 동작 유지)', () => {
    expect(applyCursor(sorted, parseCursor(T)).map((i) => i.id)).toEqual(['y']);
  });
});
