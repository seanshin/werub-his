/**
 * 사람 몫 할 일 상태 파생(2026-10-26) — 🔴 확인 불가가 섞이면 "끝남"이라 말하지 않는다 · INFO 는 세지 않는다 · 판정 수단 없으면 MANUAL.
 * 라벨 정본 — 항목·확인 코드·상태 라벨이 빠짐없이 있다.
 */
import { describe, it, expect } from 'vitest';
import { HUMAN_ACTIONS, HUMAN_ACTION_IDS, HUMAN_ACTION_STATE_LABELS, HUMAN_CHECK_LABELS, HUMAN_PHASE_LABELS, humanActionState } from '../src/human-actions';

describe('상태 파생', () => {
  it('전부 충족 = 끝남 · INFO 무시', () => {
    expect(humanActionState(true, [{ state: 'MET' }, { state: 'INFO' }])).toBe('DONE');
  });
  it('🔴 충족 + 확인 불가 = 확인 불가(끝남 아님)', () => {
    expect(humanActionState(true, [{ state: 'MET' }, { state: 'UNKNOWN' }])).toBe('UNKNOWN');
  });
  it('미충족이 있으면 일부/남음', () => {
    expect(humanActionState(true, [{ state: 'MET' }, { state: 'UNMET' }])).toBe('PARTIAL');
    expect(humanActionState(true, [{ state: 'UNMET' }, { state: 'UNKNOWN' }])).toBe('PENDING');
  });
  it('판정 항목 없음 = 확인 불가 · 판정 수단 없음 = MANUAL', () => {
    expect(humanActionState(true, [])).toBe('UNKNOWN');
    expect(humanActionState(false, [{ state: 'MET' }])).toBe('MANUAL');
  });
});

describe('라벨 정본', () => {
  it('정의 H1~H10 순서 · 하러 가는 곳 1개 이상 · 단계 라벨', () => {
    expect(HUMAN_ACTIONS.map((d) => d.id)).toEqual([...HUMAN_ACTION_IDS]);
    for (const d of HUMAN_ACTIONS) {
      expect(d.links.length, d.id).toBeGreaterThan(0);
      expect(HUMAN_PHASE_LABELS[d.phase], d.id).toBeTruthy();
    }
    for (const s of ['DONE', 'PARTIAL', 'PENDING', 'UNKNOWN', 'MANUAL'] as const) expect(HUMAN_ACTION_STATE_LABELS[s]).toBeTruthy();
    expect(Object.keys(HUMAN_CHECK_LABELS).length).toBeGreaterThanOrEqual(11);
  });
});
