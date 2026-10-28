import { describe, it, expect } from 'vitest';
import { subjectiveText, objectiveText, planText, fieldTexts, appendText } from './ambient-chip-text';
import type { AmbientEntities } from '@/lib/voice-api';

const empty: AmbientEntities = { vitals: [], medications: [], symptoms: [], plan: [] };
const e = (over: Partial<AmbientEntities>): AmbientEntities => ({ ...empty, ...over });

/** 앰비언트 P1 — 발화 단건 반영 문구 골든 */

describe('subjectiveText — 긍정/부정 분리 보존', () => {
  it('긍정 증상은 "호소."', () => {
    expect(subjectiveText(e({ symptoms: [{ term: '기침', negated: false }, { term: '발열', negated: false }] })))
      .toBe('기침, 발열 호소.');
  });
  it('부정 증상은 "부인." — 유실 금지', () => {
    expect(subjectiveText(e({ symptoms: [{ term: '흉통', negated: true }] }))).toBe('흉통 부인.');
  });
  it('혼합은 둘 다', () => {
    const t = subjectiveText(e({ symptoms: [{ term: '기침', negated: false }, { term: '흉통', negated: true }] }))!;
    expect(t).toBe('기침 호소. 흉통 부인.');
  });
  it('증상 없으면 null', () => expect(subjectiveText(empty)).toBeNull());
});

describe('objectiveText — 활력 표기', () => {
  it('BP 는 수축/이완 슬래시', () => {
    expect(objectiveText(e({ vitals: [{ type: 'BP', value: [130, 85], unit: 'mmHg', raw: '' }] }))).toBe('BP 130/85 mmHg');
  });
  it('단일값 활력', () => {
    expect(objectiveText(e({ vitals: [{ type: 'TEMP', value: [38.2], unit: '℃', raw: '' }] }))).toBe('TEMP 38.2 ℃');
  });
  it('복수 활력은 콤마 결합', () => {
    const t = objectiveText(e({ vitals: [
      { type: 'BP', value: [130, 85], unit: 'mmHg', raw: '' },
      { type: 'TEMP', value: [38.2], unit: '℃', raw: '' },
    ] }))!;
    expect(t).toBe('BP 130/85 mmHg, TEMP 38.2 ℃');
  });
});

describe('planText — 계획+약물', () => {
  it('계획과 약물명을 줄바꿈 결합', () => {
    expect(planText(e({ plan: [{ kind: 'IMAGING', text: '흉부 X-ray' }], medications: [{ name: '아목시실린', raw: '' }] })))
      .toBe('흉부 X-ray\n아목시실린');
  });
});

describe('fieldTexts — A(평가)는 절대 제안하지 않음', () => {
  it('S/O/P 만 산출', () => {
    const out = fieldTexts(e({
      symptoms: [{ term: '기침', negated: false }],
      vitals: [{ type: 'BP', value: [130, 85], unit: 'mmHg', raw: '' }],
      plan: [{ kind: 'LAB', text: 'CBC' }],
    }));
    expect(out.map((x) => x.field)).toEqual(['subjective', 'objective', 'plan']);
    expect(out.some((x) => x.field === 'assessment')).toBe(false);
  });
  it('추출 없으면 빈 배열(버튼 미표시)', () => expect(fieldTexts(empty)).toEqual([]));
});

describe('appendText — 덮어쓰기 금지·중복 방지', () => {
  it('빈 필드면 그대로', () => expect(appendText('', '기침 호소.')).toBe('기침 호소.'));
  it('기존 내용 뒤에 줄바꿈 append', () => {
    expect(appendText('두통 호소.', '기침 호소.')).toBe('두통 호소.\n기침 호소.');
  });
  it('이미 포함된 문장은 재부착 안 함(중복 반영 방지)', () => {
    expect(appendText('두통 호소.\n기침 호소.', '기침 호소.')).toBe('두통 호소.\n기침 호소.');
  });
  it('수기 입력을 지우지 않음', () => {
    const manual = '환자가 직접 기술한 내용';
    expect(appendText(manual, '추가')).toContain(manual);
  });
  it('빈 추가는 무시', () => expect(appendText('원본', '   ')).toBe('원본'));
});
