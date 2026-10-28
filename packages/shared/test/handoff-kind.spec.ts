/** 인계 종류 판정(2026-10-26) — 종류 + 보낸 사람 직종 · 교대 새 종류는 직종으로 */
import { describe, it, expect } from 'vitest';
import { handoffKindOf, shiftHandoffTypeFor, HANDOFF_TYPES, HANDOFF_TYPE_LABEL, HANDOFF_KIND_LABEL } from '../src/handoff';

describe('handoffKindOf', () => {
  it('SHIFT_CHANGE 는 보낸 사람이 간호사면 간호 교대 · 아니면 의사 교대 · 미상 직종도 의사 교대', () => {
    expect(handoffKindOf('SHIFT_CHANGE', 'NURSE')).toBe('NURSING_SHIFT');
    expect(handoffKindOf('SHIFT_CHANGE', 'DOCTOR')).toBe('PHYSICIAN_SHIFT');
    expect(handoffKindOf('SHIFT_CHANGE', null)).toBe('PHYSICIAN_SHIFT');
  });
  it('나머지 종류는 그대로 · 모르면 UNKNOWN', () => {
    expect(handoffKindOf('NURSING_SHIFT', 'DOCTOR')).toBe('NURSING_SHIFT');
    expect(handoffKindOf('ICU_TO_WARD', 'NURSE')).toBe('ICU_TO_WARD');
    expect(handoffKindOf('XYZ', 'NURSE')).toBe('UNKNOWN');
    expect(handoffKindOf(null, 'NURSE')).toBe('UNKNOWN');
  });
  it('교대 새 종류 · 라벨 빠짐 없음', () => {
    expect(shiftHandoffTypeFor('NURSE')).toBe('NURSING_SHIFT');
    expect(shiftHandoffTypeFor('ADMIN')).toBe('SHIFT_CHANGE');
    for (const t of HANDOFF_TYPES) expect(HANDOFF_TYPE_LABEL[t]).toBeTruthy();
    expect(Object.keys(HANDOFF_KIND_LABEL)).toHaveLength(6);
  });
});
