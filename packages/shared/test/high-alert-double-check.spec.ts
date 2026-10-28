import { describe, it, expect } from 'vitest';
import {
  requiresIndependentDoubleCheck,
  isParenteralRoute,
  buildDoubleCheckBypassMarker,
  parseDoubleCheckBypass,
  DOUBLE_CHECK_BYPASS_TAG,
  BYPASS_REASON_UNSTATED,
  ALWAYS_DOUBLE_CHECK,
  PARENTERAL_ONLY_DOUBLE_CHECK,
  HIGH_ALERT_CATEGORIES,
} from '../src/high-alert-double-check';

describe('고위험약 독립 이중확인 범위 정본(IPSG.3)', () => {
  it('운영 7분류가 상시군/비경구한정군으로 남김없이 나뉜다(미분류 규칙 없음)', () => {
    const covered = [...ALWAYS_DOUBLE_CHECK, ...PARENTERAL_ONLY_DOUBLE_CHECK].sort();
    expect(covered).toEqual([...HIGH_ALERT_CATEGORIES].sort());
    // 두 군이 겹치지 않는다
    expect(ALWAYS_DOUBLE_CHECK.some((c) => PARENTERAL_ONLY_DOUBLE_CHECK.includes(c))).toBe(false);
  });

  it('고위험 아님 → 요구하지 않음(모든 약에 걸지 않는다)', () => {
    const r = requiresIndependentDoubleCheck({ highAlertFlag: false, highAlertCategory: null, route: 'IV' });
    expect(r.required).toBe(false);
  });

  it.each(ALWAYS_DOUBLE_CHECK)('%s 는 경구여도 요구한다(경로 무관 상시군)', (cat) => {
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route: 'PO' }).required).toBe(true);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route: 'IV' }).required).toBe(true);
  });

  it.each(PARENTERAL_ONLY_DOUBLE_CHECK)('%s 는 경구면 요구하지 않고 주사면 요구한다', (cat) => {
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route: 'PO' }).required).toBe(false);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route: '경구' }).required).toBe(false);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route: 'IV' }).required).toBe(true);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route: 'SC' }).required).toBe(true);
  });

  it('경로 미상·분류 미등재는 안전측(요구함)으로 접는다 — 보호가 조용히 사라지지 않게', () => {
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: 'OPIOID', route: '' }).required).toBe(true);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: 'OPIOID', route: '???' }).required).toBe(true);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: 'NEW_CATEGORY', route: 'IV' }).required).toBe(true);
    expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: null, route: null }).required).toBe(true);
  });

  it('판정에는 항상 사람이 읽을 사유가 붙는다(근거 없이 경고하지 않는다)', () => {
    for (const cat of HIGH_ALERT_CATEGORIES) {
      for (const route of ['PO', 'IV', '']) {
        expect(requiresIndependentDoubleCheck({ highAlertFlag: true, highAlertCategory: cat, route }).reason.length).toBeGreaterThan(5);
      }
    }
  });

  it('경로 판별 — 모르면 null(추정 금지)', () => {
    expect(isParenteralRoute('IV')).toBe(true);
    expect(isParenteralRoute('정맥주사')).toBe(true);
    expect(isParenteralRoute('PO')).toBe(false);
    expect(isParenteralRoute('설하')).toBe(false);
    expect(isParenteralRoute('')).toBeNull();
    expect(isParenteralRoute('ZZZ')).toBeNull();
  });
});

describe('우회 표식 — 막지 않되 보이게', () => {
  it('사유가 있으면 표식에 담긴다', () => {
    const m = buildDoubleCheckBypassMarker({ at: '2026-08-18T01:00:00.000Z', nurseId: 'n-1', reason: '단독 근무 — 2차 확인 간호사 부재' });
    expect(m).toContain(DOUBLE_CHECK_BYPASS_TAG);
    const p = parseDoubleCheckBypass(`투여 완료 ${m}`);
    expect(p).toEqual({ at: '2026-08-18T01:00:00.000Z', nurseId: 'n-1', reason: '단독 근무 — 2차 확인 간호사 부재' });
  });

  it('사유 미기재를 "사유 있음"으로 위장하지 않는다', () => {
    const m = buildDoubleCheckBypassMarker({ at: '2026-08-18T01:00:00.000Z', nurseId: 'n-1' });
    expect(parseDoubleCheckBypass(m)?.reason).toBe(BYPASS_REASON_UNSTATED);
  });

  it('사유 필드가 없던 구 표식도 읽는다(기존 기록이 다시 침묵하면 안 된다)', () => {
    const legacy = `[${DOUBLE_CHECK_BYPASS_TAG} 2026-08-01T00:00:00.000Z nurse=n-9]`;
    expect(parseDoubleCheckBypass(legacy)).toEqual({ at: '2026-08-01T00:00:00.000Z', nurseId: 'n-9', reason: BYPASS_REASON_UNSTATED });
  });

  it('표식이 없으면 null — 없는 우회를 만들어내지 않는다', () => {
    expect(parseDoubleCheckBypass('일반 메모')).toBeNull();
    expect(parseDoubleCheckBypass(null)).toBeNull();
  });

  it('사유에 대괄호를 넣어도 표식 파싱이 깨지지 않는다', () => {
    const m = buildDoubleCheckBypassMarker({ nurseId: 'n-1', reason: '기타 [야간] 단독' });
    expect(parseDoubleCheckBypass(m)?.reason).toBe('기타  야간  단독');
  });
});
