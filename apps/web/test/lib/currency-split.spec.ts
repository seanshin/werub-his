import { describe, it, expect } from 'vitest';
import { splitCurrency } from '../../src/lib/currency-split';

/** 통화 단위 축소 골든 — 2026-07-31. 숫자가 주인공이고 단위는 보조다. */
describe('splitCurrency', () => {
  it('원 단위를 분리한다', () => {
    expect(splitCurrency('12,000원')).toEqual({ amount: '12,000', unit: '원' });
  });

  it('🔴 만원은 원으로 잘리지 않는다(긴 접미사 우선)', () => {
    expect(splitCurrency('1,016만원')).toEqual({ amount: '1,016', unit: '만원' });
    expect(splitCurrency('3억원')).toEqual({ amount: '3', unit: '억원' });
  });

  it('기호 표기는 기호를 단위로 본다', () => {
    expect(splitCurrency('₩1,016')).toEqual({ amount: '1,016', unit: '₩' });
  });

  it('단위가 없으면 전부 숫자로 둔다(임의 절단 금지)', () => {
    expect(splitCurrency('1,016')).toEqual({ amount: '1,016', unit: '' });
    expect(splitCurrency('-')).toEqual({ amount: '-', unit: '' });
  });

  it('빈 값·null 은 빈 결과', () => {
    expect(splitCurrency('')).toEqual({ amount: '', unit: '' });
    expect(splitCurrency(null as unknown as string)).toEqual({ amount: '', unit: '' });
  });

  it('음수·소수도 숫자 쪽에 남는다', () => {
    expect(splitCurrency('-1,200원')).toEqual({ amount: '-1,200', unit: '원' });
  });
});

import { splitValueUnit } from '../../src/lib/currency-split';

/** 일반 단위(%·명·건·일·℃…) 골든 — 통화와 같은 규칙, 다만 잘못 자르면 값이 망가지므로 좁게 */
describe('splitValueUnit', () => {
  it('퍼센트·개수·기간 단위를 분리한다', () => {
    expect(splitValueUnit('84%')).toEqual({ amount: '84', unit: '%' });
    expect(splitValueUnit('187명')).toEqual({ amount: '187', unit: '명' });
    expect(splitValueUnit('47.4일')).toEqual({ amount: '47.4', unit: '일' });
    expect(splitValueUnit('53건')).toEqual({ amount: '53', unit: '건' });
  });

  it('임상 단위도 분리한다(공백 유무 무관)', () => {
    expect(splitValueUnit('36.6℃')).toEqual({ amount: '36.6', unit: '℃' });
    expect(splitValueUnit('126/76 mmHg')).toEqual({ amount: '126/76', unit: 'mmHg' });
    expect(splitValueUnit('6.6 %')).toEqual({ amount: '6.6', unit: '%' });
  });

  it('🔴 날짜·차트번호·시각은 자르지 않는다(뒤가 숫자)', () => {
    expect(splitValueUnit('2026-07-31')).toEqual({ amount: '2026-07-31', unit: '' });
    expect(splitValueUnit('P2026-1370')).toEqual({ amount: 'P2026-1370', unit: '' });
    expect(splitValueUnit('10:30')).toEqual({ amount: '10:30', unit: '' });
  });

  it('🔴 숫자가 없으면 단위로 보지 않는다', () => {
    expect(splitValueUnit('없음')).toEqual({ amount: '없음', unit: '' });
    expect(splitValueUnit('—')).toEqual({ amount: '—', unit: '' });
    expect(splitValueUnit('A형')).toEqual({ amount: 'A형', unit: '' });
  });

  it('통화도 같은 함수로 처리된다(만원 우선 규칙 유지)', () => {
    expect(splitValueUnit('1,016만원')).toEqual({ amount: '1,016', unit: '만원' });
    expect(splitValueUnit('₩1,016')).toEqual({ amount: '1,016', unit: '₩' });
  });
});
