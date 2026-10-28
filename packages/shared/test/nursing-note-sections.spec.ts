import { describe, it, expect } from 'vitest';
import { nursingNoteSections } from '../src/nursing-note';

describe('nursingNoteSections — 형식대로 펼친다', () => {
  it('🔴 SOAP 은 S·O·A·P(종전 차트 탭은 본문이 비었다)', () => {
    expect(nursingNoteSections({ noteType: 'SOAP', subjective: '두통', objective: 'BT 38.2', assessment: '고열', plan: '해열제' }))
      .toEqual([{ label: 'S', text: '두통' }, { label: 'O', text: 'BT 38.2' }, { label: 'A', text: '고열' }, { label: 'P', text: '해열제' }]);
  });
  it('🔴 SBAR 은 S·B·A·R 라벨(저장은 focus·data·action·response)', () => {
    expect(nursingNoteSections({ noteType: 'SBAR', focus: '흉통', data: 'MI 병력', action: 'ECG', response: '주치의 보고' }).map((s) => s.label)).toEqual(['S', 'B', 'A', 'R']);
  });
  it('🔴 DARE 의 E 가 나온다 · 형식 밖 칸 값은 버리지 않고 뒤에', () => {
    expect(nursingNoteSections({ noteType: 'DARE', data: 'd', education: '교육함' }).map((s) => s.label)).toEqual(['D', 'E']);
    expect(nursingNoteSections({ noteType: 'DAR', data: 'd', content: '추가' })).toEqual([{ label: 'D', text: 'd' }, { label: '', text: '추가' }]);
  });
  it('빈 칸·공백은 빼고 · 모르는 형식도 값은 보인다', () => {
    expect(nursingNoteSections({ noteType: 'X', plan: ' p ', data: '  ' })).toEqual([{ label: 'P', text: 'p' }]);
  });
});
