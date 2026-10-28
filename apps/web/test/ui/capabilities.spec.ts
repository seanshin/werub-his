import { describe, it, expect } from 'vitest';
import { tabCapability } from '../../src/lib/capabilities';

/**
 * 화면 단위 작성 가능성 매트릭스 — 2026-08-03.
 * 배지가 서버 실권한과 다르게 말하면 안 된다(각 항목 근거는 lib/capabilities 주석).
 */
describe('탭 × 역할 작성 가능성', () => {
  const cases: [string, string, 'write' | 'delegated' | 'readonly'][] = [
    // 진료 기록 — 작성은 의사
    ['encounters', 'DOCTOR', 'write'],
    ['encounters', 'NURSE', 'readonly'],
    ['encounters', 'PHARMACIST', 'readonly'],
    // 활력 — 의사·간호사
    ['vitals', 'NURSE', 'write'],
    ['vitals', 'DOCTOR', 'write'],
    ['vitals', 'PHARMACIST', 'readonly'],
    // 간호기록 — 간호사
    ['nursing', 'NURSE', 'write'],
    ['nursing', 'DOCTOR', 'readonly'],
    // 처방 — 의사 직접·간호사/임상병리사는 위임(승인)·약사는 검토
    ['medications', 'DOCTOR', 'write'],
    ['medications', 'NURSE', 'delegated'],
    ['medications', 'LAB_TECH', 'delegated'],
    ['medications', 'PHARMACIST', 'readonly'],
    // 검사 결과 — 이 화면에선 전 역할 열람(입력은 오더 단위 워크스테이션)
    ['labresults', 'LAB_TECH', 'readonly'],
    ['labresults', 'DOCTOR', 'readonly'],
  ];
  it.each(cases)('%s × %s → %s', (tab, role, mode) => {
    expect(tabCapability(tab, role)?.mode).toBe(mode);
  });

  it('열람 전용에는 반드시 "작성은 어디서" 가 담긴다', () => {
    for (const [tab, role] of [['encounters', 'NURSE'], ['medications', 'PHARMACIST'], ['labresults', 'LAB_TECH']] as const) {
      const cap = tabCapability(tab, role)!;
      expect(cap.mode).toBe('readonly');
      expect(cap.reason.length).toBeGreaterThan(8); // 이유 없는 자물쇠는 좌절만 남긴다
    }
  });

  it('매핑 없는 탭은 배지를 붙이지 않는다', () => {
    expect(tabCapability('overview', 'NURSE')).toBeNull();
    expect(tabCapability('timeline', 'DOCTOR')).toBeNull();
  });
});
