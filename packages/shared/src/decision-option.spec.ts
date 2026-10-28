import { describe, it, expect } from 'vitest';
import {
  checkChosenOption, readOptions, isSpecialChoice,
  CHOSEN_MODIFIED, CHOSEN_NONE_OF_ABOVE,
  type DecisionOptionShape,
} from './decision-option';

/**
 * 위원회 의결 **선택** 정본 (2026-08-27 · 계획서 §3.1 · 가드 G1~G4·G13).
 *
 * 🔴 이 가드가 지키는 것 — 전부 실측에서 나온 것이다:
 *   · 종전 의결은 자유서술 + 사람이 손으로 타이핑하는 액션뿐이라 **"B안으로 의결"이 구조로 남지 않았다**
 *   · 고른 선택지의 `enact` 가 **그대로** 집행 대상이 되어야 한다(사람이 다시 타이핑하면 정본이 둘)
 *   · `enact:null`(바꾸지 않음)과 **부재**(자동 반영 대상 아님)는 다른 사실이다
 *   · "A안을 일부 수정하여 의결" 은 실제 위원회에서 가장 흔한 형태다 — 강제하면 거짓 데이터가 된다
 */
const OPTS: DecisionOptionShape[] = [
  { value: 'A', label: 'A안', effect: '그대로 둔다', enact: null },
  { value: 'B', label: 'B안', effect: '게이트를 BLOCK 으로', enact: { kind: 'GATE_MODE', target: { key: 'dur.enforce', mode: 'BLOCK' } } },
  { value: 'C', label: 'C안', effect: '자동 반영 대상이 아니다' }, // 🔴 enact 부재
];

describe('의결 선택 — 선택지가 있으면 골라야 한다', () => {
  it('🔴 G1 — 선택지 있는 안건은 고르지 않으면 의결할 수 없다', () => {
    expect(checkChosenOption(OPTS, undefined)).toMatchObject({ ok: false, code: 'CHOICE_REQUIRED' });
    expect(checkChosenOption(OPTS, { value: '', snapshot: OPTS })).toMatchObject({ ok: false, code: 'CHOICE_REQUIRED' });
  });

  it('선택지 없는 안건은 종전대로 자유서술 의결 — 고르라고 강제하지 않는다', () => {
    expect(checkChosenOption([], undefined)).toEqual({ ok: true, enact: null });
    expect(checkChosenOption(null, undefined)).toEqual({ ok: true, enact: null });
  });

  it('🔴 G2 — 스냅샷 없이 값만 보내면 거부한다(무엇을 보고 골랐는지가 근거다)', () => {
    expect(checkChosenOption(OPTS, { value: 'B', snapshot: [] })).toMatchObject({ ok: false, code: 'SNAPSHOT_REQUIRED' });
  });

  it('🔴 G2-b — 안건의 선택지와 다른 스냅샷은 거부한다(임의 목록을 근거로 삼지 않는다)', () => {
    const fake: DecisionOptionShape[] = [{ value: 'B', label: '다른 라벨', effect: '다른 설명' }];
    expect(checkChosenOption(OPTS, { value: 'B', snapshot: fake })).toMatchObject({ ok: false, code: 'SNAPSHOT_MISMATCH' });
  });

  it('🔴 G3 — 고른 선택지의 enact 가 그대로 집행 대상이 된다(사람이 다시 타이핑하지 않는다)', () => {
    const r = checkChosenOption(OPTS, { value: 'B', snapshot: OPTS });
    expect(r.ok).toBe(true);
    expect(r.enact).toEqual({ kind: 'GATE_MODE', target: { key: 'dur.enforce', mode: 'BLOCK' } });
  });

  it('🔴 G4 — enact:null(바꾸지 않음)과 부재(대상 아님)는 둘 다 집행 0건이지만 다른 사실이다', () => {
    expect(checkChosenOption(OPTS, { value: 'A', snapshot: OPTS })).toEqual({ ok: true, enact: null });
    expect(checkChosenOption(OPTS, { value: 'C', snapshot: OPTS })).toEqual({ ok: true, enact: null });
    // 🔴 뜻의 차이는 선택지 원문에 남아 있어야 한다 — 여기서 뭉개면 되돌릴 수 없다
    expect('enact' in OPTS[0]).toBe(true);
    expect('enact' in OPTS[2]).toBe(false);
  });

  it('선택지에 없는 값은 거부한다', () => {
    expect(checkChosenOption(OPTS, { value: 'Z', snapshot: OPTS })).toMatchObject({ ok: false, code: 'UNKNOWN_CHOICE' });
  });
});

describe('🔴 G13 — "A안을 일부 수정하여 의결"', () => {
  it('수정 의결은 사유가 있어야 한다', () => {
    expect(checkChosenOption(OPTS, { value: CHOSEN_MODIFIED, snapshot: OPTS }))
      .toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
  });

  /**
   * 🔴 **이 픽스처는 일부러 전 선택지에 `enact` 를 넣었다.**
   *
   * 처음 가드는 `OPTS` 로만 검증했는데 `OPTS[0]` 이 `enact:null` 이라,
   * "수정 의결이 원안의 enact 를 물려받는다"는 결함을 **재주입해도 통과했다**
   * (다른 이유로 통과한 가드 — 이 저장소에서 반복해 나온 형태다).
   * 어느 선택지를 물려받든 드러나도록 전부 실제 값을 갖게 한다.
   */
  const ALL_ENACT: DecisionOptionShape[] = [
    { value: 'X', label: 'X안', effect: 'x', enact: { kind: 'CONFIG_CHANGE', target: { key: 'a', value: 1 } } },
    { value: 'Y', label: 'Y안', effect: 'y', enact: { kind: 'GATE_MODE', target: { key: 'b', mode: 'BLOCK' } } },
  ];

  it('🔴 수정 의결·선택지 밖 의결은 자동 집행하지 않는다 — 의결하지 않은 것을 하면 안 된다', () => {
    for (const opts of [OPTS, ALL_ENACT]) {
      const mod = checkChosenOption(opts, { value: CHOSEN_MODIFIED, snapshot: opts, note: '기한만 3개월로' });
      expect(mod, '수정 의결이 원안 enact 를 물려받으면 위원회가 의결하지 않은 것을 집행한다')
        .toEqual({ ok: true, enact: null });
      const none = checkChosenOption(opts, { value: CHOSEN_NONE_OF_ABOVE, snapshot: opts, note: '전면 재검토' });
      expect(none).toEqual({ ok: true, enact: null });
    }
  });

  it('특수값 판별', () => {
    expect(isSpecialChoice(CHOSEN_MODIFIED)).toBe(true);
    expect(isSpecialChoice('B')).toBe(false);
    expect(isSpecialChoice(null)).toBe(false);
  });
});

describe('readOptions — 미상 형태를 지어내지 않는다', () => {
  it('배열이 아니거나 모양이 다르면 버린다', () => {
    expect(readOptions(null)).toEqual([]);
    expect(readOptions({ value: 'A' })).toEqual([]);
    expect(readOptions([{ value: 'A' }, { value: 'B', label: 'B', effect: 'e' }]))
      .toEqual([{ value: 'B', label: 'B', effect: 'e' }]);
  });

  it('🔴 enact 는 보존한다(정본을 지나며 사라지면 집행 대상이 없어진다)', () => {
    const r = readOptions([{ value: 'B', label: 'B', effect: 'e', enact: { kind: 'X', target: {} } }]);
    expect(r[0].enact).toEqual({ kind: 'X', target: {} });
  });
});
