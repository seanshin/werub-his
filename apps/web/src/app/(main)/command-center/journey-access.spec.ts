import { describe, it, expect } from 'vitest';
import { canSeeJourneyBoard } from './journey-access';

/**
 * 통합 상황판의 여정 섹션 — 경영 관제 EP 를 임상 역할이 부르지 않는가.
 * 🔴 재주입: 판정을 `() => true` 로 되돌리면 첫 번째 it 이 실패한다.
 */
describe('여정 보드 조회 판정', () => {
  it('🔴 nav 가 여는 임상 4역할은 부르지 않는다(종전 전원 403)', () => {
    for (const role of ['DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH']) {
      expect(canSeeJourneyBoard(role)).toBe(false);
    }
  });

  /** 🔴 대조군 — 무조건 false 로 만들면 여기서 실패한다 */
  it('대조군: 관리자·경영진은 부른다', () => {
    expect(canSeeJourneyBoard('ADMIN')).toBe(true);
    expect(canSeeJourneyBoard('EXECUTIVE')).toBe(true);
  });

  it('역할을 모르면 부르지 않는다', () => {
    expect(canSeeJourneyBoard(undefined)).toBe(false);
    expect(canSeeJourneyBoard('')).toBe(false);
  });
});
