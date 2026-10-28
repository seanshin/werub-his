/**
 * 스크라이브 초안 ↔ 확정 수정량 정본(`common/util/scribe-edit-measure.ts`) — 측정 정의의 계약.
 *
 * 🔴 지키는 사실:
 *    ① 같으면 0 — 진짜 0 은 0 으로 말한다(대조군)
 *    ② 초안이 없으면 null — 재지 못한 것을 0(무수정)으로 말하지 않는다
 *    ③ 초안에 있던 섹션을 지우면 1(전부 수정) — 가장 큰 수정을 미측정으로 빼지 않는다
 *    ④ 상한 초과는 CAPPED — 앞부분만 잰 하한을 비율로 내지 않는다
 *    ⑤ 전체 거리는 서명 경로(`Encounter.aiEditDistance`)와 같은 수 — 정본이 둘이 되지 않는다
 */
import { describe, it, expect } from 'vitest';
import {
  measureScribeEdit,
  measureTextEdit,
  scribeDraftSoap,
  scribeSignedText,
} from '../../src/common/util/scribe-edit-measure';
import { EDIT_DISTANCE_CAP, levenshteinCapped } from '../../src/common/util/edit-distance';

describe('measureTextEdit — 조각 하나', () => {
  it('대조군 — 같으면 거리 0 · 정규화 0', () => {
    expect(measureTextEdit('두통 호소', '두통 호소')).toEqual({
      status: 'MEASURED', distance: 0, normalized: 0, draftLength: 5, finalLength: 5,
    });
  });

  it('정규화 = 거리 ÷ 긴 쪽 길이', () => {
    const m = measureTextEdit('abcd', 'abXdEF');
    expect(m?.status).toBe('MEASURED');
    if (m?.status !== 'MEASURED') throw new Error('unreachable');
    expect(m.distance).toBe(3);
    expect(m.normalized).toBeCloseTo(3 / 6, 10);
  });

  it('🔴 초안이 없으면(null·undefined·공백) null — 0 이 아니다', () => {
    expect(measureTextEdit(null, '무엇')).toBeNull();
    expect(measureTextEdit(undefined, '무엇')).toBeNull();
    expect(measureTextEdit('   ', '무엇')).toBeNull();
  });

  it('🔴 확정본 인자가 없으면(null) null — 0 이 아니다', () => {
    expect(measureTextEdit('초안', null)).toBeNull();
    expect(measureTextEdit('초안', undefined)).toBeNull();
  });

  it('🔴 확정본이 빈 문자열이면 "지웠다" — 정규화 1', () => {
    const m = measureTextEdit('초안 문장', '');
    expect(m).toMatchObject({ status: 'MEASURED', distance: 5, normalized: 1 });
  });

  it('🔴 상한 초과는 재지 않고 CAPPED — 하한 거리를 비율로 내지 않는다', () => {
    const long = 'a'.repeat(EDIT_DISTANCE_CAP + 1);
    expect(measureTextEdit(long, 'b')).toEqual({ status: 'CAPPED', draftLength: EDIT_DISTANCE_CAP + 1, finalLength: 1 });
    expect(measureTextEdit('b', long)?.status).toBe('CAPPED');
    // 경계 — 정확히 상한이면 잰다
    expect(measureTextEdit('a'.repeat(EDIT_DISTANCE_CAP), 'a'.repeat(EDIT_DISTANCE_CAP))?.status).toBe('MEASURED');
  });
});

describe('measureScribeEdit — 스냅샷 + 서명 기록', () => {
  const record = { subjective: '두통 호소. 3일째.', objective: 'BP 120/80', assessment: '긴장성 두통', plan: '타이레놀 500mg' };

  it('🔴 스냅샷이 없거나 SOAP 텍스트가 없으면 null — 측정 대상이 아니다', () => {
    expect(measureScribeEdit(null, record)).toBeNull();
    expect(measureScribeEdit({}, record)).toBeNull();
    expect(measureScribeEdit({ soap: { subjective: '  ' } }, record)).toBeNull();
    expect(measureScribeEdit([], record)).toBeNull();
  });

  it('초안이 낸 섹션만 잰다 — 나머지 섹션은 null(의사가 직접 쓴 A 를 수정량으로 세지 않는다)', () => {
    const m = measureScribeEdit({ appliedFields: { subjective: '두통 호소.' } }, record)!;
    expect(m.sections.subjective).toMatchObject({ status: 'MEASURED', distance: levenshteinCapped('두통 호소.', record.subjective) });
    expect(m.sections.objective).toBeNull();
    expect(m.sections.assessment).toBeNull();
    expect(m.sections.plan).toBeNull();
  });

  it('대조군 — 초안 그대로 서명하면 섹션·전체 모두 0', () => {
    const m = measureScribeEdit({ soap: { subjective: record.subjective, plan: record.plan } }, record)!;
    expect(m.sections.subjective).toMatchObject({ distance: 0, normalized: 0 });
    expect(m.sections.plan).toMatchObject({ distance: 0, normalized: 0 });
    expect(m.overall).toMatchObject({ distance: 0, normalized: 0 });
  });

  it('🔴 초안에 있던 섹션이 확정본에서 비면(null) 지운 것 — 정규화 1', () => {
    const m = measureScribeEdit({ soap: { plan: '타이레놀' } }, { ...record, plan: null })!;
    expect(m.sections.plan).toMatchObject({ status: 'MEASURED', normalized: 1 });
  });

  it('⑤ 전체 거리 = 서명 경로가 저장하는 수(같은 이어붙이기 규칙)', () => {
    const snap = { soap: { subjective: '두통', plan: '타이레놀' } };
    const draft = scribeDraftSoap(snap)!;
    const signCanon = levenshteinCapped(draft.text, scribeSignedText(draft.fields, record));
    expect(measureScribeEdit(snap, record)!.overall).toMatchObject({ status: 'MEASURED', distance: signCanon });
  });

  it('앰비언트 반영분(appliedFields)이 녹음 초안(soap)보다 우선한다', () => {
    const m = measureScribeEdit({ appliedFields: { plan: record.plan }, soap: { subjective: '전혀 다름' } }, record)!;
    expect(m.sections.subjective).toBeNull();
    expect(m.sections.plan).toMatchObject({ distance: 0 });
  });
});
