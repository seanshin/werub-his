import { describe, it, expect } from 'vitest';
import { consolidate, aiSuggestionsFrom } from '../../src/modules/scribe/ambient-soap';

/**
 * 앰비언트 → SOAP **정돈** 초안 골든(D2·§13.4) — 순수 로직.
 * 정본: docs/01-plan/features/voice-emr-ambient-conversation.plan.md §6·§13.4 D2
 *
 * 🔴 종전 `buildRuleSuggestions`(병합만) 스펙을 지웠다 — `consolidate()`(주호소·반복 병합·활력 최신값·
 *    계획 묶음·coverage 분모)로 교체됐는데 옛 스펙이 남아 있으면 존재하지 않는 export 를 불러 컴파일이
 *    깨진다(앞선 시도가 이 파일을 갱신하지 않고 남긴 자리 — §마치면 참조).
 *
 * 골든은 **실제 임상 대화문**(합성 단문이 아니라 반복·정정·복수 화자가 섞인 대화 흐름)으로 짠다 —
 * 2026-07-30 경험상 합성 문장만 쓰면 상류 NER 결함이 안 드러난다.
 */
const conversation = [
  { seq: 0, text: '어디가 불편해서 오셨어요', speaker: 'DOCTOR' },
  { seq: 1, text: '삼일 전부터 기침이 심하고 밤에 열이 나요', speaker: 'PATIENT' },
  { seq: 2, text: '가슴 통증은 없어요', speaker: 'PATIENT' },
  { seq: 3, text: '혈압 백삼십에 팔십오입니다', speaker: 'DOCTOR' },
  { seq: 4, text: '흉부 엑스레이 찍고 아목시실린 오백 밀리그램 처방할게요', speaker: 'DOCTOR' },
  { seq: 5, text: '기침이 계속 나요', speaker: 'PATIENT' }, // 반복 — 병합 대상(firstSeq=1 유지)
  { seq: 6, text: '혈압 다시 재보니 백삼십이에 팔십오예요', speaker: 'DOCTOR' }, // 재측정 — 값이 바뀌어 이력에 쌓인다
  { seq: 7, text: '집에서 재보니까 혈압이 백육십에 백이었어요', speaker: 'PATIENT' }, // 환자 발화 수치 — O 제외
  { seq: 8, text: '혈액검사도 나가겠습니다', speaker: 'DOCTOR' },
];

describe('consolidate — 주호소 승격·반복 병합·순서', () => {
  const { suggestions, skipped, coverage, structure } = consolidate(conversation);
  const byField = (f: string) => suggestions.find((s) => s.field === f);

  it('주호소(CC) = 가장 이른 seq 의 긍정 증상(문장 내 위치로 동률 해소)', () => {
    // seq1 한 발화 안에 기침·발열이 함께 있다 — 기침이 문장에서 먼저 나온다
    expect(structure.chiefComplaint).toEqual({ term: '기침', seq: 1 });
  });

  it('🔴 반복 언급은 한 항목으로 병합되고 최초 seq(출처)를 유지한다', () => {
    const cough = structure.symptoms.find((s) => s.term === '기침')!;
    expect(cough).toBeDefined();
    expect(cough.firstSeq).toBe(1); // seq5 에서 또 나와도 최초는 그대로
    expect(cough.seqs).toEqual([1, 5]); // 두 발화 모두 출처로 남는다
    expect(cough.negated).toBe(false);
  });

  it('긍정 증상 → 부인 증상 순서 고정(한 문장에 섞지 않는다)', () => {
    const s = byField('subjective')!;
    expect(s.text).toBe('CC: 기침\n기침, 발열 호소. 흉통 부인.');
    expect(s.sourceSeqs).toEqual([1, 2, 5]);
    expect(s.engine).toBe('RULE');
  });

  it('활력은 최신값이 대표 · 이전 값은 괄호로(재측정 흐름)', () => {
    const bp = structure.vitals.find((v) => v.type === 'BP')!;
    expect(bp.latest).toEqual([132, 85]); // seq6 이 최신
    expect(bp.latestSeq).toBe(6);
    expect(bp.history.map((h) => h.seq)).toEqual([3, 6]);
    const o = byField('objective')!;
    expect(o.text).toBe('BP 132/85mmHg (130/85 → 132/85)');
    expect(o.sourceSeqs).toEqual([3, 6]);
  });

  it('환자 발화 활력은 O 로 올리지 않고 skipped 로 보고(조용한 누락 금지 · §3.4)', () => {
    expect(byField('objective')!.text).not.toMatch(/160/);
    expect(skipped.some((x) => x.seq === 7 && x.field === 'objective' && x.reason === 'PATIENT_SPEAKER')).toBe(true);
  });

  it('계획은 종류별 묶음(LAB·IMAGING·MEDICATION 순) · 약물도 계획 아래 붙는다', () => {
    const p = byField('plan')!;
    expect(p.text).toMatch(/^Lab: /);
    expect(p.text).toMatch(/Imaging: /);
    expect(p.text).toMatch(/Med: .*아목시실린/);
    expect(p.text.indexOf('Lab:')).toBeLessThan(p.text.indexOf('Imaging:'));
    expect(p.text.indexOf('Imaging:')).toBeLessThan(p.text.indexOf('Med:'));
    expect(p.sourceSeqs).toEqual([4, 8]);
  });

  it('🔴 A(평가)는 규칙 경로가 절대 제안하지 않는다', () => {
    expect(byField('assessment')).toBeUndefined();
  });

  it('🔴 분모(coverage) — 다섯 수의 합이 전체 발화 수와 같다', () => {
    expect(coverage.utterances).toBe(conversation.length); // 9
    expect(coverage.withEntities + coverage.noEntities + coverage.lowConfidence + coverage.skipped).toBe(coverage.utterances);
    expect(coverage.noEntities).toBe(1); // seq0 인사말
    expect(coverage.skipped).toBe(1); // seq7(환자 수치만 있고 전부 제외됨)
    expect(coverage.withEntities).toBe(7);
  });
});

describe('consolidate — 긍정·부인 충돌(conflicted)', () => {
  it('같은 증상이 발화마다 엇갈리면 긍정 우선 + conflicted=true로 표시(문장에 섞지 않는다)', () => {
    const { structure } = consolidate([
      { seq: 0, text: '두통이 있어요', speaker: 'PATIENT' },
      { seq: 1, text: '두통은 없어요', speaker: 'PATIENT' },
    ]);
    const headache = structure.symptoms.find((s) => s.term === '두통')!;
    expect(headache.negated).toBe(false); // 하나라도 긍정이면 있음(발화 내 규약을 발화 간에도)
    expect(headache.conflicted).toBe(true);
    expect(headache.firstSeq).toBe(0);
    expect(headache.seqs).toEqual([0, 1]);
  });
});

describe('consolidate — 활력 반복 측정(같은 값)은 이력에 새로 쌓지 않는다', () => {
  it('같은 값의 재확인은 history 1건 그대로', () => {
    const { structure } = consolidate([
      { seq: 0, text: '혈압 백삼십에 팔십오입니다', speaker: 'DOCTOR' },
      { seq: 1, text: '혈압 백삼십에 팔십오 다시 확인했습니다', speaker: 'DOCTOR' },
    ]);
    const bp = structure.vitals.find((v) => v.type === 'BP')!;
    expect(bp.history).toHaveLength(1);
    expect(bp.latestSeq).toBe(0);
  });
});

describe('consolidate — 분모·경계값', () => {
  it('빈 대화 — 제안 0·CC 없음·coverage 는 0이 아니라 명시적으로 0(산출 불가는 화면 몫)', () => {
    const { suggestions, coverage, structure } = consolidate([]);
    expect(suggestions).toHaveLength(0);
    expect(structure.chiefComplaint).toBeNull();
    expect(coverage).toEqual({ utterances: 0, withEntities: 0, noEntities: 0, lowConfidence: 0, skipped: 0 });
  });

  it('저신뢰로 미리 뺀 발화 수는 opts 로 분모에만 더해진다(입력 목록에는 없다)', () => {
    const { coverage } = consolidate([{ seq: 0, text: '기침이 나요', speaker: 'PATIENT' }], { lowConfidence: 3 });
    expect(coverage).toEqual({ utterances: 4, withEntities: 1, noEntities: 0, lowConfidence: 3, skipped: 0 });
  });

  it('빈 발화·공백은 noEntities 로(제안 0)', () => {
    const { suggestions, coverage } = consolidate([{ seq: 0, text: '   ', speaker: 'PATIENT' }]);
    expect(suggestions).toHaveLength(0);
    expect(coverage).toMatchObject({ utterances: 1, noEntities: 1 });
  });

  it('수정본(editedText 반영된 text)이 그대로 쓰임 — 호출부가 넘긴 text 만 본다', () => {
    const { suggestions } = consolidate([{ seq: 0, text: '두통이 있어요', speaker: 'PATIENT' }]);
    expect(suggestions[0].text).toMatch(/두통/);
  });
});

describe('aiSuggestionsFrom — 방어적 파싱·A 접두 강제(변경 없음)', () => {
  it('soap 키에서 4필드 추출·A는 "(제안)" 접두', () => {
    const out = aiSuggestionsFrom({ soap: { subjective: '기침', objective: 'BP 130/85', assessment: '폐렴 의증', plan: 'CXR' } }, [0, 1]);
    expect(out.map((o) => o.field)).toEqual(['subjective', 'objective', 'assessment', 'plan']);
    expect(out.find((o) => o.field === 'assessment')!.text).toBe('(제안) 폐렴 의증');
    expect(out[0].engine).toBe('AI');
    expect(out[0].sourceSeqs).toEqual([0, 1]);
  });

  it('data 래핑·대문자 키도 흡수', () => {
    const out = aiSuggestionsFrom({ data: { SOAP: { S: '증상', A: '가설' } } }, []);
    expect(out.find((o) => o.field === 'subjective')!.text).toBe('증상');
    expect(out.find((o) => o.field === 'assessment')!.text).toBe('(제안) 가설');
  });

  it('이미 접두가 있으면 중복 부착 안 함', () => {
    const out = aiSuggestionsFrom({ soap: { assessment: '(제안) 폐렴' } }, []);
    expect(out.find((o) => o.field === 'assessment')!.text).toBe('(제안) 폐렴');
  });

  it('빈/비문자 응답은 제안 0(폴백은 규칙 경로가 담당)', () => {
    expect(aiSuggestionsFrom({}, [])).toHaveLength(0);
    expect(aiSuggestionsFrom(null, [])).toHaveLength(0);
    expect(aiSuggestionsFrom({ soap: { subjective: 123 } }, [])).toHaveLength(0);
  });
});
