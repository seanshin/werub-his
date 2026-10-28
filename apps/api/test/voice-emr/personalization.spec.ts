import { describe, it, expect } from 'vitest';
import { validateCustomPhrase, buildPersonalization, type CustomPhrase } from '../../src/modules/voice-emr/personalization';
import { processUtterance, type OrchestratorCtx } from '../../src/modules/voice-emr/orchestrator';
import { buildVocabShortlist } from '../../src/modules/voice-emr/vocab-shortlist';

describe('안전 검증(§B.6)', () => {
  it('🔴 안전어 shadowing ALIAS 거부', () => {
    expect(validateCustomPhrase({ type: 'ALIAS', pattern: '취소', action: { kind: 'query', ref: 'x' } }).error).toBe('RESERVED_SHADOWING');
    expect(validateCustomPhrase({ type: 'ALIAS', pattern: '오늘 서명 세트', action: { kind: 'order-set', ref: 'x' } }).error).toBe('RESERVED_SHADOWING');
  });
  it('ALIAS action 필수·kind 검증', () => {
    expect(validateCustomPhrase({ type: 'ALIAS', pattern: '내 세트' }).error).toBe('ALIAS_ACTION_REQUIRED');
    expect(validateCustomPhrase({ type: 'ALIAS', pattern: '내 세트', action: { kind: 'bogus', ref: 'x' } }).error).toBe('ALIAS_KIND_INVALID');
  });
  it('HABIT canonical 필수', () => {
    expect(validateCustomPhrase({ type: 'HABIT', pattern: '타이레놀' }).error).toBe('HABIT_CANONICAL_REQUIRED');
  });
  it('빈/과길이 거부', () => {
    expect(validateCustomPhrase({ type: 'VOCAB', pattern: '' }).error).toBe('EMPTY_PATTERN');
    expect(validateCustomPhrase({ type: 'VOCAB', pattern: 'x'.repeat(201) }).error).toBe('PATTERN_TOO_LONG');
  });
  it('유효 문구 통과', () => {
    expect(validateCustomPhrase({ type: 'VOCAB', pattern: '메트포르민' }).valid).toBe(true);
    expect(validateCustomPhrase({ type: 'HABIT', pattern: '타이레놀', action: { canonical: '아세트아미노펜' } }).valid).toBe(true);
  });
});

describe('buildPersonalization 분류', () => {
  const phrases: CustomPhrase[] = [
    { type: 'HABIT', pattern: '타이레놀', action: { canonical: '아세트아미노펜' } },
    { type: 'ALIAS', pattern: '고혈압 초진 세트', action: { kind: 'order-set', ref: 'HTN' }, priority: 10 },
    { type: 'VOCAB', pattern: '당화혈색소' },
    { type: 'MACRO', pattern: '기본 초진', action: { body: 'S:\nO:\nA:\nP:' } },
    { type: 'ALIAS', pattern: '취소 세트', action: { kind: 'query', ref: 'z' } }, // shadowing → 거부
    { type: 'VOCAB', pattern: '숨김', enabled: false }, // 비활성 → 제외
  ];
  const p = buildPersonalization(phrases);

  it('타입별 분류', () => {
    expect(p.parserPhrases.habits).toEqual([{ from: '타이레놀', to: '아세트아미노펜' }]);
    expect(p.parserPhrases.aliases?.[0].pattern).toBe('고혈압 초진 세트');
    expect(p.vocab).toEqual(['당화혈색소']);
    expect(p.macros[0].pattern).toBe('기본 초진');
  });
  it('shadowing 거부 목록', () => {
    expect(p.rejected).toContainEqual({ pattern: '취소 세트', error: 'RESERVED_SHADOWING' });
  });
  it('비활성 제외', () => expect(p.vocab).not.toContain('숨김'));
});

describe('개인화 종단(orchestrator 통합)', () => {
  const phrases: CustomPhrase[] = [
    { type: 'HABIT', pattern: '타이레놀', action: { canonical: '아세트아미노펜' } },
    { type: 'ALIAS', pattern: '고혈압 초진 세트', action: { kind: 'order-set', ref: 'HTN' } },
  ];
  const perso = buildPersonalization(phrases);
  const ctx: OrchestratorCtx = {
    patient: { name: '홍길동', mrn: '00012345' },
    customPhrases: perso.parserPhrases,
    lookupCandidates: () => [{ code: 'X', name: '아세트아미노펜정 500mg' }],
  };

  it('HABIT 적용(타이레놀→아세트아미노펜)', () => {
    const [o] = processUtterance('타이레놀 오백 처방', ctx) as any;
    expect(o.kind).toBe('order-rx');
    expect(o.nbest.candidates[0].name).toContain('아세트아미노펜');
  });
  it('ALIAS 해소도 needsConfirm(게이트 우회 불가)', () => {
    const [o] = processUtterance('내 고혈압 초진 세트', ctx) as any;
    expect(o.kind).toBe('alias');
    expect(o.needsConfirm).toBe(true); // 🔴 매크로도 확인 필수
    expect(o.patient.mrn).toBe('00012345');
  });

  it('VOCAB→shortlist 병합', () => {
    const p2 = buildPersonalization([{ type: 'VOCAB', pattern: '리피토' }, { type: 'VOCAB', pattern: '메트포르민' }]);
    const sl = buildVocabShortlist({ personalVocab: p2.vocab, patientMeds: ['노바스크'] });
    expect(sl.terms).toEqual(['리피토', '메트포르민', '노바스크']);
  });
});
