import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 원외처방전 만료 로직 (pharmacy.service.ts expireExternalPrescriptions) ──
// 3일(72시간) 초과한 EXTERNAL/ORDERED 오더를 CANCELLED로 변경하는 로직을 단위 테스트

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000; // 259,200,000 ms

/**
 * 주어진 생성 시각이 만료 기준(3일 전)보다 이전인지 확인
 * → true면 만료 대상
 */
function isExpired(createdAt: Date, now: Date = new Date()): boolean {
  const threeDaysAgo = new Date(now.getTime() - THREE_DAYS_MS);
  return createdAt < threeDaysAgo;
}

/**
 * 처방전 목록에서 만료 대상을 필터링
 */
interface ExternalOrder {
  id: string;
  pharmacyType: string;
  status: string;
  createdAt: Date;
}

function filterExpiredOrders(orders: ExternalOrder[], now: Date = new Date()): ExternalOrder[] {
  const threeDaysAgo = new Date(now.getTime() - THREE_DAYS_MS);
  return orders.filter(
    (o) =>
      o.pharmacyType === 'EXTERNAL' &&
      o.status === 'ORDERED' &&
      o.createdAt < threeDaysAgo,
  );
}

/**
 * 만료 처리 시뮬레이션 — 실제 Prisma 없이 순수 로직만 검증
 */
function simulateExpiry(orders: ExternalOrder[], now: Date = new Date()): {
  expiredCount: number;
  expiredOrders: ExternalOrder[];
} {
  const expired = filterExpiredOrders(orders, now);
  return { expiredCount: expired.length, expiredOrders: expired };
}

describe('PharmacyService - 원외처방전 자동 만료 (expireExternalPrescriptions)', () => {
  const NOW = new Date('2026-05-27T00:00:00Z');

  // ── 3일 만료 기준 계산 ──
  describe('3일 만료 기준 계산', () => {
    it('정확히 3일 전 시각 계산', () => {
      const threeDaysAgo = new Date(NOW.getTime() - THREE_DAYS_MS);
      expect(threeDaysAgo).toEqual(new Date('2026-05-24T00:00:00Z'));
    });

    it('72시간 = 3 * 24 * 60 * 60 * 1000 ms', () => {
      expect(THREE_DAYS_MS).toBe(259_200_000);
    });

    it('3일 초과한 오더는 만료 대상', () => {
      const createdAt = new Date('2026-05-23T23:59:59Z'); // 3일 + 1초 전
      expect(isExpired(createdAt, NOW)).toBe(true);
    });

    it('정확히 3일 전(경계값)은 만료 대상 아님 (lt, not lte)', () => {
      const createdAt = new Date('2026-05-24T00:00:00Z'); // 정확히 3일 전
      expect(isExpired(createdAt, NOW)).toBe(false);
    });

    it('2일 전 오더는 만료 대상 아님', () => {
      const createdAt = new Date('2026-05-25T12:00:00Z'); // 약 2일 전
      expect(isExpired(createdAt, NOW)).toBe(false);
    });

    it('1시간 전 오더는 만료 대상 아님', () => {
      const createdAt = new Date('2026-05-26T23:00:00Z');
      expect(isExpired(createdAt, NOW)).toBe(false);
    });
  });

  // ── 만료 조건: pharmacyType === 'EXTERNAL' && status === 'ORDERED' ──
  describe('만료 조건 필터링', () => {
    const oldDate = new Date('2026-05-20T00:00:00Z'); // 7일 전 (명확히 만료)

    it('EXTERNAL + ORDERED + 3일 초과 → 만료 대상', () => {
      const orders: ExternalOrder[] = [
        { id: 'ord-1', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: oldDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(1);
    });

    it('INTERNAL 오더는 만료 대상 아님', () => {
      const orders: ExternalOrder[] = [
        { id: 'ord-2', pharmacyType: 'INTERNAL', status: 'ORDERED', createdAt: oldDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });

    it('EXTERNAL이지만 COMPLETED 상태는 만료 대상 아님', () => {
      const orders: ExternalOrder[] = [
        { id: 'ord-3', pharmacyType: 'EXTERNAL', status: 'COMPLETED', createdAt: oldDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });

    it('EXTERNAL이지만 CANCELLED 상태는 만료 대상 아님', () => {
      const orders: ExternalOrder[] = [
        { id: 'ord-4', pharmacyType: 'EXTERNAL', status: 'CANCELLED', createdAt: oldDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });

    it('EXTERNAL이지만 IN_PROGRESS 상태는 만료 대상 아님', () => {
      const orders: ExternalOrder[] = [
        { id: 'ord-5', pharmacyType: 'EXTERNAL', status: 'IN_PROGRESS', createdAt: oldDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });
  });

  // ── 최근 오더는 만료 안 됨 ──
  describe('3일 미만 오더는 만료되지 않음', () => {
    it('오늘 생성 오더는 만료 대상 아님', () => {
      const orders: ExternalOrder[] = [
        {
          id: 'ord-6',
          pharmacyType: 'EXTERNAL',
          status: 'ORDERED',
          createdAt: new Date('2026-05-27T00:00:00Z'),
        },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });

    it('어제 생성 오더는 만료 대상 아님', () => {
      const orders: ExternalOrder[] = [
        {
          id: 'ord-7',
          pharmacyType: 'EXTERNAL',
          status: 'ORDERED',
          createdAt: new Date('2026-05-26T12:00:00Z'),
        },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });

    it('2.9일 전 오더는 만료 대상 아님', () => {
      const almostThreeDays = new Date(NOW.getTime() - THREE_DAYS_MS + 60000); // 만료까지 1분 남음
      const orders: ExternalOrder[] = [
        { id: 'ord-8', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: almostThreeDays },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });
  });

  // ── 복수 오더 처리 ──
  describe('복수 오더 일괄 만료 처리', () => {
    it('여러 만료 오더를 한 번에 처리', () => {
      const oldDate = new Date('2026-05-20T00:00:00Z');
      const orders: ExternalOrder[] = [
        { id: 'ord-a', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: oldDate },
        { id: 'ord-b', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: oldDate },
        { id: 'ord-c', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: oldDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(3);
    });

    it('만료 오더와 유효 오더가 혼재할 때 만료 오더만 처리', () => {
      const oldDate = new Date('2026-05-20T00:00:00Z');
      const recentDate = new Date('2026-05-26T12:00:00Z');
      const orders: ExternalOrder[] = [
        { id: 'ord-expired-1', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: oldDate },
        { id: 'ord-expired-2', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: oldDate },
        { id: 'ord-valid-1', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: recentDate },
        { id: 'ord-valid-2', pharmacyType: 'INTERNAL', status: 'ORDERED', createdAt: oldDate },
      ];
      const { expiredCount, expiredOrders } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(2);
      expect(expiredOrders.map((o) => o.id)).toEqual(['ord-expired-1', 'ord-expired-2']);
    });

    it('만료 오더가 없으면 expiredCount = 0', () => {
      const recentDate = new Date('2026-05-26T12:00:00Z');
      const orders: ExternalOrder[] = [
        { id: 'ord-v1', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: recentDate },
        { id: 'ord-v2', pharmacyType: 'EXTERNAL', status: 'ORDERED', createdAt: recentDate },
      ];
      const { expiredCount } = simulateExpiry(orders, NOW);
      expect(expiredCount).toBe(0);
    });

    it('빈 오더 목록은 expiredCount = 0', () => {
      const { expiredCount } = simulateExpiry([], NOW);
      expect(expiredCount).toBe(0);
    });
  });
});
