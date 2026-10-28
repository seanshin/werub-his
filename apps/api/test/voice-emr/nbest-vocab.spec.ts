import { describe, it, expect } from 'vitest';
import { matchNbest, jamoSimilarity, toJamo, type Candidate } from '../../src/modules/voice-emr/nbest-matcher';
import { buildVocabShortlist } from '../../src/modules/voice-emr/vocab-shortlist';

const DRUGS: Candidate[] = [
  { code: 'A001', name: '메트포르민정 500mg', form: '정' },
  { code: 'A002', name: '메트포르민서방정 500mg', form: '서방정' },
  { code: 'A003', name: '아토르바스타틴칼슘정 20mg', synonyms: ['리피토'], form: '정' },
  { code: 'A004', name: '로수바스타틴정 10mg', synonyms: ['크레스토'], form: '정' },
  { code: 'A005', name: '암로디핀정 5mg', synonyms: ['노바스크'], form: '정' },
  { code: 'A006', name: '푸로세미드정 40mg', synonyms: ['라식스'], form: '정' },
];

describe('자모 분해·유사도', () => {
  it('자모 분해', () => expect(toJamo('약')).toBe('ㅇㅑㄱ'));
  it('유사 발음 높은 점수', () => expect(jamoSimilarity('메트포르민', '메트포르민')).toBe(1));
  it('오인식 근사', () => expect(jamoSimilarity('메트포르민', '메트포르빈')).toBeGreaterThan(0.8));
});

describe('n-best 매칭', () => {
  it('상품명→성분(동의어)', () => {
    const r = matchNbest('리피토', DRUGS);
    expect(r.candidates[0].code).toBe('A003');
    expect(r.candidates[0].via).toBe('synonym');
  });
  it('부분포함(메트포르민→2후보)', () => {
    const r = matchNbest('메트포르민', DRUGS);
    const codes = r.candidates.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['A001', 'A002'])); // 정·서방정 둘 다
  });
  it('서방정 명시 → 서방정 상위·preSelect', () => {
    const r = matchNbest('메트포르민 서방정', DRUGS, { delta: 0.03 });
    expect(r.candidates[0].code).toBe('A002');
  });
  it('오인식(메트포르빈) → 여전히 메트포르민 후보', () => {
    const r = matchNbest('메트포르빈', DRUGS);
    expect(r.candidates.map((c) => c.code)).toContain('A001');
  });
  it('모호하면 preSelect 안 함(단일 자동선택 금지)', () => {
    const r = matchNbest('메트포르민', DRUGS); // 정/서방정 근접 → preSelect null
    expect(r.preSelect).toBeNull();
  });
  it('확실하면 preSelect(확인은 여전히 필수)', () => {
    const r = matchNbest('노바스크', DRUGS);
    expect(r.preSelect).toBe('A005');
  });
});

describe('vocab shortlist(≤200·우선순위·truncated)', () => {
  it('우선순위 병합·중복 제거', () => {
    const r = buildVocabShortlist({
      personalVocab: ['메트포르민', '리피토'],
      patientMeds: ['리피토', '노바스크'], // 리피토 중복 제거
      deptTop: ['당화혈색소'],
    });
    expect(r.terms).toEqual(['메트포르민', '리피토', '노바스크', '당화혈색소']);
    expect(r.truncated).toBe(false);
  });
  it('200 상한 초과 → truncated+dropped', () => {
    const many = Array.from({ length: 250 }, (_, i) => `약${i}`);
    const r = buildVocabShortlist({ deptTop: many });
    expect(r.terms).toHaveLength(200);
    expect(r.truncated).toBe(true);
    expect(r.dropped).toBe(50);
  });
  it('개인 VOCAB 최우선(상한 내 보존)', () => {
    const filler = Array.from({ length: 200 }, (_, i) => `f${i}`);
    const r = buildVocabShortlist({ personalVocab: ['내약'], deptTop: filler });
    expect(r.terms[0]).toBe('내약'); // 개인 우선
    expect(r.terms).toContain('내약');
  });
});
