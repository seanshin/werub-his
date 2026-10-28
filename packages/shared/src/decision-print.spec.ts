import { describe, it, expect } from 'vitest';
import { diffDecisionPrintLines, parseDecisionPrintLine, decisionPrintCanonLine } from './decision-print';
import { issuedDocumentTypeLabel, documentTypeOfIssueNo, isServerBuiltDocumentType } from './issued-document';

describe('결정 인쇄본 정본 줄·대조', () => {
  it('줄 왕복 — 만든 줄을 다시 읽으면 같은 값', () => {
    const l = decisionPrintCanonLine({ key: 'a.b', decided: true, record: { choice: 'ON', decidedAt: '2026-10-01T00:00:00.000Z' } });
    expect(parseDecisionPrintLine(l)).toEqual({ key: 'a.b', state: 'REAL', choice: 'ON', decidedAt: '2026-10-01T00:00:00.000Z' });
  });
  it('🔴 같으면 빈 차이 · 바뀜·사라짐·새로 생김을 키 단위로', () => {
    const a = ['a|OPEN||', 'b|REAL|X|t1', 'c|SEED|Y|t2'];
    expect(diffDecisionPrintLines(a, a)).toEqual([]);
    const d = diffDecisionPrintLines(a, ['a|REAL|ON|t3', 'c|SEED|Y|t2', 'z|OPEN||']);
    expect(d.map((x) => [x.key, x.before?.state ?? null, x.after?.state ?? null])).toEqual([['a', 'OPEN', 'REAL'], ['b', 'REAL', null], ['z', null, 'OPEN']]);
  });
});

describe('발급 원장 종류 정본', () => {
  it('서버 생성 종류 · 라벨 · 모르는 종류는 null', () => {
    expect(isServerBuiltDocumentType('DECISION_REGISTER')).toBe(true);
    expect(isServerBuiltDocumentType('RECEIPT')).toBe(false);
    expect(issuedDocumentTypeLabel('DECISION_RECORD')).toBe('의사결정서');
    expect(issuedDocumentTypeLabel('NOPE')).toBeNull();
    expect(documentTypeOfIssueNo('WRB-ERP_MEDICAL_CONTRACT-20260628-0001')).toBe('ERP_MEDICAL_CONTRACT');
  });
});
