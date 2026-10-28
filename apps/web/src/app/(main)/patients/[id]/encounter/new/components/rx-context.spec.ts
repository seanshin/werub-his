import { describe, it, expect } from 'vitest';
import { drugShort, isAbnormalLab, sortLabs, allergyNotice } from './rx-context';

describe('약품명 축약', () => {
  it('성분·규격 괄호와 언더스코어 뒤를 잘라 상품명만 남긴다', () => {
    expect(drugShort('아이리토정10밀리그램(아토르바스타틴칼슘삼수화물)_(10.85mg/1정)')).toBe('아이리토정10밀리그램');
    expect(drugShort('글리포엠정(글리메피리드,메트포르민염산염)')).toBe('글리포엠정');
  });

  it('괄호가 없으면 그대로', () => {
    expect(drugShort('로사르탄정 50mg')).toBe('로사르탄정 50mg');
  });

  it('잘라서 빈 문자열이 되면 원문을 유지한다(정보를 잃지 않는다)', () => {
    expect(drugShort('(성분만표기)')).toBe('(성분만표기)');
  });
});

describe('검사 이상치 판정·정렬', () => {
  it('H/L/A 플래그가 붙은 항목만 이상치', () => {
    expect(isAbnormalLab('HbA1c 6.6%(H)')).toBe(true);
    expect(isAbnormalLab('Creatinine 1.0mg/dL')).toBe(false);
    expect(isAbnormalLab('K 3.0mmol/L(L)')).toBe(true);
  });

  it('이상치를 앞으로 올리고 나머지 순서는 유지한다', () => {
    const out = sortLabs(['Creatinine 1.0mg/dL', 'LDL 82mg/dL', 'HbA1c 6.6%(H)']);
    expect(out[0]).toBe('HbA1c 6.6%(H)');
    expect(out.slice(1)).toEqual(['Creatinine 1.0mg/dL', 'LDL 82mg/dL']);
  });
});

describe('🔴 알레르기 표기 — 미문진 ≠ 무알레르기', () => {
  it('빈 배열은 "기록 없음"이며 "없음"이라 단정하지 않는다', () => {
    const n = allergyNotice([]);
    expect(n.kind).toBe('NO_RECORD');
    expect(n.text).toContain('기록 없음');
    expect(n.text).not.toMatch(/^알레르기 없음$|무알레르기|없습니다/);
  });

  it('undefined(미조회)도 같은 취급', () => {
    expect(allergyNotice(undefined).kind).toBe('NO_RECORD');
  });

  it('값이 있으면 목록 표기', () => {
    expect(allergyNotice(['페니실린']).kind).toBe('LIST');
  });
});
