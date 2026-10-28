import { describe, it, expect } from 'vitest';
import { handoffIllnessOf, handoffActionsOf, HANDOFF_ILLNESS, HANDOFF_ILLNESS_LABEL } from '../src/handoff';

/**
 * 인수인계 어휘 정본(2026-10-04) — 🔴 시드의 '위중'을 "중증도 미기재"로 그리던 것(적힌 값을 없다고 말함).
 * 재주입: 어휘 밖을 미기재로 접거나, 빈 값을 '안정'으로 접거나, 모르는 상태를 완료로 세면 실패한다.
 */
describe('중증도', () => {
  it('어휘 안 = 코드 · 라벨이 모두 있다', () => {
    for (const c of HANDOFF_ILLNESS) expect(handoffIllnessOf(c)).toEqual({ code: c, raw: c, offVocab: false });
    expect(Object.keys(HANDOFF_ILLNESS_LABEL).sort()).toEqual([...HANDOFF_ILLNESS].sort());
  });
  it('🔴 어휘 밖 = 원문 보존 + offVocab (미기재로 접지 않는다)', () => {
    expect(handoffIllnessOf('위중')).toEqual({ code: null, raw: '위중', offVocab: true });
  });
  it('🔴 비어 있으면 미기재 — 안정으로 접지 않는다', () => {
    for (const v of [null, undefined, '', '  ', 3]) expect(handoffIllnessOf(v)).toEqual({ code: null, raw: null, offVocab: false });
  });
});

describe('조치 목록', () => {
  it('🔴 배열이 아니면 null(모름) · DONE 만 완료 · 모양이 틀린 칸은 버린다', () => {
    expect(handoffActionsOf('문자열')).toBeNull();
    expect(handoffActionsOf(null)).toBeNull();
    const r = handoffActionsOf([{ action: 'a', status: 'DONE' }, { action: 'b', status: 'PENDING' }, { action: 'c', status: 'WHATEVER' }, { nope: 1 }])!;
    expect(r.items.map((i) => i.action)).toEqual(['a', 'b', 'c']);
    expect(r).toMatchObject({ done: 1, open: 2 });
  });
});

import { normalizeRosterWardDepartments } from '../src/shift';
describe('근무표 부서 ↔ 병동 연결 정규화', () => {
  it('모양이 어긋난 칸은 버리고 남는 게 없으면 null(미설정) · 중복·공백 정리', () => {
    expect(normalizeRosterWardDepartments({ w1: [' 간호부 (내과병동) ', '간호부 (내과병동)', 3], w2: 'x', '': ['a'] })).toEqual({ w1: ['간호부 (내과병동)'] });
    for (const v of [null, [], 'x', {}, { w: [] }]) expect(normalizeRosterWardDepartments(v)).toBeNull();
  });
});
