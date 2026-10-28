import { describe, it, expect } from 'vitest';

// 오더 상태 전이 규칙
const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  ORDERED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

// 처방 유형 → 부서 라우팅
const TYPE_TO_DEPARTMENT: Record<string, string> = {
  MEDICATION: 'PHARMACY',
  LAB: 'LAB',
  IMAGING: 'IMAGING',
};

function isValidTransition(from: string, to: string): boolean {
  return VALID_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

describe('Order (OCS) Logic', () => {
  describe('Status Transitions', () => {
    it('ORDERED → RECEIVED (valid)', () => {
      expect(isValidTransition('ORDERED', 'RECEIVED')).toBe(true);
    });

    it('ORDERED → CANCELLED (valid)', () => {
      expect(isValidTransition('ORDERED', 'CANCELLED')).toBe(true);
    });

    it('RECEIVED → IN_PROGRESS (valid)', () => {
      expect(isValidTransition('RECEIVED', 'IN_PROGRESS')).toBe(true);
    });

    it('IN_PROGRESS → COMPLETED (valid)', () => {
      expect(isValidTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    });

    it('COMPLETED → any (invalid, terminal)', () => {
      expect(isValidTransition('COMPLETED', 'ORDERED')).toBe(false);
      expect(isValidTransition('COMPLETED', 'CANCELLED')).toBe(false);
    });

    it('CANCELLED → any (invalid, terminal)', () => {
      expect(isValidTransition('CANCELLED', 'ORDERED')).toBe(false);
    });

    it('ORDERED → COMPLETED (invalid, skip)', () => {
      expect(isValidTransition('ORDERED', 'COMPLETED')).toBe(false);
    });
  });

  describe('Department Routing', () => {
    it('MEDICATION → PHARMACY', () => {
      expect(TYPE_TO_DEPARTMENT['MEDICATION']).toBe('PHARMACY');
    });

    it('LAB → LAB', () => {
      expect(TYPE_TO_DEPARTMENT['LAB']).toBe('LAB');
    });

    it('IMAGING → IMAGING', () => {
      expect(TYPE_TO_DEPARTMENT['IMAGING']).toBe('IMAGING');
    });
  });
});
