import { describe, it, expect } from 'vitest';
import { splitIntoColumns } from '../../src/hooks/useWideScreen';

/** 목록 2열 분할 골든 — 읽는 순서(위→아래, 왼→오른)를 깨지 않아야 한다 */
describe('splitIntoColumns', () => {
  it('1열이면 원본 그대로 한 덩어리', () => {
    expect(splitIntoColumns([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
  });

  it('2열은 앞쪽 절반이 왼쪽 — 순서가 유지된다', () => {
    expect(splitIntoColumns([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('홀수는 왼쪽이 하나 더 많다(위쪽부터 채움)', () => {
    expect(splitIntoColumns([1, 2, 3, 4, 5], 2)).toEqual([[1, 2, 3], [4, 5]]);
  });

  it('항목이 열 수보다 적으면 빈 열을 만들지 않는다', () => {
    expect(splitIntoColumns([1], 2)).toEqual([[1]]);
  });

  it('빈 목록은 한 덩어리(빈 배열)', () => {
    expect(splitIntoColumns([], 2)).toEqual([[]]);
  });
});
