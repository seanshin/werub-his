/**
 * 간호 원내 규정 정본(2026-10-26) — 값 검사·진통제 판정·재평가 판정.
 *  · 🔴 형식 밖 규정은 null(지어내지 않음) · 분류 모르는 약은 null(진통제 아님으로 접지 않음)
 *  · 재평가 = 사건 뒤 통증 기록(같은 시각은 아님) · 마지막 기록이 기준 이상이면 새 사건
 */
import { describe, it, expect } from 'vitest';
import { HANDOFF_ACK_MODES, HANDOFF_ACK_MODE_DESC, HANDOFF_ACK_MODE_LABEL, isAnalgesicMed, normalizeHandoffAckMode, normalizePainReassessRule, painReassessDue } from '../src/nursing-rules';

const NOW = new Date('2026-10-26T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
const RULE = { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 30 };

describe('규정 값', () => {
  it('통증 규정 — 경계 · 형식 밖 null · 진통제 기한 null 허용', () => {
    expect(normalizePainReassessRule(RULE)).toEqual(RULE);
    expect(normalizePainReassessRule({ ...RULE, afterAnalgesicMinutes: null })).toMatchObject({ afterAnalgesicMinutes: null });
    expect(normalizePainReassessRule({ thresholdScore: 4, withinMinutes: 60 })).toMatchObject({ afterAnalgesicMinutes: null });
    for (const bad of [null, [], 'x', { ...RULE, thresholdScore: 0 }, { ...RULE, thresholdScore: 4.5 }, { ...RULE, withinMinutes: 14 }, { ...RULE, withinMinutes: 481 }, { ...RULE, afterAnalgesicMinutes: 10 }]) {
      expect(normalizePainReassessRule(bad)).toBeNull();
    }
  });
  it('인수 방식 — 어휘만 · 라벨·설명 전부', () => {
    expect(normalizeHandoffAckMode('SEPARATE')).toBe('SEPARATE');
    expect(normalizeHandoffAckMode('separate')).toBeNull();
    for (const m of HANDOFF_ACK_MODES) { expect(HANDOFF_ACK_MODE_LABEL[m]).toBeTruthy(); expect(HANDOFF_ACK_MODE_DESC[m]).toBeTruthy(); }
  });
  it('🔴 진통제 판정 — 분류 · 마약성 · 분류 모름 null', () => {
    expect(isAnalgesicMed({ category: '해열·진통·소염제' })).toBe(true);
    expect(isAnalgesicMed({ category: '혈압강하제' })).toBe(false);
    expect(isAnalgesicMed({ category: null, highAlertCategory: 'OPIOID' })).toBe(true);
    expect(isAnalgesicMed({ category: null, highAlertCategory: 'INSULIN' })).toBe(false);
    expect(isAnalgesicMed({ category: null })).toBeNull();
    expect(isAnalgesicMed(null)).toBeNull();
  });
});

describe('재평가 판정', () => {
  it('사건 없음 null · 기준 미만 마지막 기록이 앞선 사건을 닫는다', () => {
    expect(painReassessDue(RULE, [], [], NOW)).toBeNull();
    expect(painReassessDue(RULE, [{ at: at(100), score: 8 }, { at: at(50), score: 2 }], [], NOW)).toBeNull();
  });
  it('기한 전 DUE · 기한 지나면 OVERDUE(경계 = 지연)', () => {
    expect(painReassessDue(RULE, [{ at: at(20), score: 4 }], [], NOW)).toMatchObject({ status: 'DUE', minutes: 40 });
    expect(painReassessDue(RULE, [{ at: at(60), score: 4 }], [], NOW)).toMatchObject({ status: 'OVERDUE', minutes: 0 });
  });
  it('🔴 진통제 — 마지막 기록과 같은 시각 투여는 재평가되지 않은 사건 · 앞선 투여는 닫힘 · 끈 규정은 무시', () => {
    expect(painReassessDue(RULE, [{ at: at(40), score: 2 }], [{ at: at(40), name: 'A' }], NOW)).toMatchObject({ trigger: { kind: 'ANALGESIC' }, status: 'OVERDUE', minutes: 10 });
    expect(painReassessDue(RULE, [{ at: at(10), score: 2 }], [{ at: at(40), name: 'A' }], NOW)).toBeNull();
    expect(painReassessDue({ ...RULE, afterAnalgesicMinutes: null }, [], [{ at: at(40), name: 'A' }], NOW)).toBeNull();
  });
  it('여러 사건이면 기한이 가장 이른 것', () => {
    const r = painReassessDue(RULE, [{ at: at(50), score: 7 }], [{ at: at(45), name: 'A' }], NOW);
    expect(r).toMatchObject({ trigger: { kind: 'ANALGESIC' }, minutes: 15, status: 'OVERDUE' });
  });
});
