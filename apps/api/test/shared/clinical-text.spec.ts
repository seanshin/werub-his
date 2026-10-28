import { describe, it, expect } from 'vitest';
import {
  toChosung, isChosungQuery, jamoSimilarity, fuzzyCodeSearch, normalizeKoreanNumber, sinoToNumber,
} from '../../../../packages/shared/src/clinical-text';

interface Code { code: string; name: string; synonyms?: string[] }
const DRUGS: Code[] = [
  { code: 'D1', name: '메트포르민정 500mg' },
  { code: 'D2', name: '메트포르민서방정 500mg' },
  { code: 'D3', name: '아토르바스타틴칼슘정 20mg', synonyms: ['리피토'] },
  { code: 'D4', name: '암로디핀정 5mg', synonyms: ['노바스크'] },
];
const DX: Code[] = [
  { code: 'I10', name: '본태성 고혈압' },
  { code: 'E11', name: '제2형 당뇨병' },
  { code: 'E78', name: '이상지질혈증' },
];
const search = (q: string, items: Code[]) => fuzzyCodeSearch(q, items, { getName: (i) => i.name, getSynonyms: (i) => i.synonyms });

describe('초성 유틸', () => {
  it('초성 추출', () => {
    expect(toChosung('고혈압')).toBe('ㄱㅎㅇ');
    expect(toChosung('메트포르민')).toBe('ㅁㅌㅍㄹㅁ');
  });
  it('초성 질의 판별', () => {
    expect(isChosungQuery('ㄱㅎㅇ')).toBe(true);
    expect(isChosungQuery('고혈압')).toBe(false);
  });
});

describe('fuzzyCodeSearch', () => {
  it('정확/부분포함', () => {
    expect(search('메트포르민', DRUGS)[0].item.code).toMatch(/D1|D2/);
    expect(search('포르민', DRUGS).length).toBeGreaterThanOrEqual(2); // 부분포함
  });
  it('오타 내성(음소)', () => {
    const r = search('메트포르빈', DRUGS); // 빈→민 오타
    expect(r.map((h) => h.item.code)).toContain('D1');
  });
  it('동의어(상품명→성분)', () => {
    const r = search('리피토', DRUGS);
    expect(r[0].item.code).toBe('D3');
    expect(r[0].matchType).toBe('synonym');
  });
  it('초성 검색(ㄱㅎㅇ→고혈압)', () => {
    const r = search('ㄱㅎㅇ', DX);
    expect(r[0].item.code).toBe('I10');
    expect(r[0].matchType).toBe('chosung');
  });
  it('초성 부분(ㅁㅌㅍ→메트포르민)', () => {
    const r = search('ㅁㅌㅍ', DRUGS);
    expect(r.map((h) => h.item.code)).toEqual(expect.arrayContaining(['D1', 'D2']));
  });
  it('진단 부분포함(당뇨→제2형 당뇨병)', () => {
    const r = search('당뇨', DX);
    expect(r[0].item.code).toBe('E11');
  });
  it('빈 질의→빈 결과', () => expect(search('', DRUGS)).toEqual([]));
  it('무관 질의→저점수 배제', () => expect(search('xyz123', DX)).toEqual([]));
});

describe('수사 정규화(공용)', () => {
  it('한자어/소수', () => {
    expect(sinoToNumber('백삼십')).toBe(130);
    expect(normalizeKoreanNumber('삼십육점오')).toBe('36.5');
  });
  it('자릿값 없는 단어 보존', () => {
    expect(normalizeKoreanNumber('정맥주사')).toBe('정맥주사');
    expect(jamoSimilarity('메트포르민', '메트포르민')).toBe(1);
  });
});

/** 계사 '이' 오변환 회귀(2026-07-30 앰비언트 P1 골든이 노출) — 서술 어미의 이는 수사 2가 아니다 */
describe('수사 정규화 — 종결어미 계사 방어', () => {
  it('"백사십이었어요" → 140(142 아님)', () => {
    expect(normalizeKoreanNumber('혈압이 백사십이었어요')).toContain('140이었어요');
  });
  it('"백이었어요" → 100', () => {
    expect(normalizeKoreanNumber('백이었어요')).toBe('100이었어요');
  });
  it('자릿값 내부 이는 보존 — "백이십" → 120', () => {
    expect(normalizeKoreanNumber('백이십')).toBe('120');
    expect(normalizeKoreanNumber('백이십이었어요')).toBe('120이었어요');
  });
  it('계사 아닌 뒤따름은 종전대로 — "이십이 개월" → 22', () => {
    expect(normalizeKoreanNumber('이십이 개월')).toBe('22 개월');
  });
});
