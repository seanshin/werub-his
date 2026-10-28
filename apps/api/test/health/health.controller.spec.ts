import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HIS_VERSION } from '@hospital-run/shared';
import { HealthController } from '../../src/modules/health/health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn(),
    };
    mockRedis = {
      ping: vi.fn(),
    };
    controller = new HealthController(mockPrisma, mockRedis);
  });

  describe('check', () => {
    it('should return status ok with version', () => {
      const result = controller.check();

      // 버전은 정본(HIS_VERSION) — '0.1.0' 하드코딩은 배포 버전과 무관한 낡은 표시였다(P6·2026-08-13)
      // 🔴 (2026-09-13) 커밋도 함께 — 배포 기록(BUILD_INFO.json)이 없는 테스트 환경에선 null 이어야 한다(지어내지 않는다)
      expect(result).toEqual({ status: 'ok', version: HIS_VERSION, commit: null });
    });

    it('should return correct status value', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
    });

    it('should return correct version value', () => {
      const result = controller.check();

      expect(result.version).toBe(HIS_VERSION);
    });

    it('should return exactly status·version·commit (화이트리스트 — 경로·env 를 내지 않는다)', () => {
      const result = controller.check();

      expect(Object.keys(result).sort()).toEqual(['commit', 'status', 'version']);
    });
  });

  describe('ready', () => {
    it('should return ok status for both db and redis when both available', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await controller.ready();

      expect(result.db).toBe('ok');
      expect(result.redis).toBe('ok');
    });

    it('should return error for db when postgres connection fails', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection failed'));
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await controller.ready();

      expect(result.db).toBe('error');
      expect(result.redis).toBe('ok');
    });

    it('should return error for redis when cache connection fails', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockRejectedValue(new Error('Redis unavailable'));

      const result = await controller.ready();

      expect(result.db).toBe('ok');
      expect(result.redis).toBe('error');
    });

    it('should return error for both when both connections fail', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('DB error'));
      mockRedis.ping.mockRejectedValue(new Error('Redis error'));

      const result = await controller.ready();

      expect(result.db).toBe('error');
      expect(result.redis).toBe('error');
    });

    it('should call prisma queryRaw to check database health', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockResolvedValue('PONG');

      await controller.ready();

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should call redis ping to check cache health', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockResolvedValue('PONG');

      await controller.ready();

      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should return object with db and redis properties', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await controller.ready();

      expect(result).toHaveProperty('db');
      expect(result).toHaveProperty('redis');
    });

    it('should handle quick succession of ready checks', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockResolvedValue('PONG');

      const result1 = await controller.ready();
      const result2 = await controller.ready();

      expect(result1.db).toBe('ok');
      expect(result2.db).toBe('ok');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('should handle redis timeout gracefully', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await controller.ready();

      expect(result.redis).toBe('error');
    });

    it('should handle database timeout gracefully', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('ETIMEDOUT'));
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await controller.ready();

      expect(result.db).toBe('error');
    });
  });

  describe('live', () => {
    it('should return undefined', () => {
      const result = controller.live();

      expect(result).toBeUndefined();
    });

    it('should not throw any error', () => {
      expect(() => controller.live()).not.toThrow();
    });

    it('should be callable without parameters', () => {
      const result = controller.live();

      expect(typeof result).toBe('undefined');
    });
  });

  describe('Kubernetes Health Check Pattern', () => {
    it('should support liveness probe with live endpoint', () => {
      const result = controller.live();

      expect(result).toBeUndefined();
    });

    it('should support readiness probe with ready endpoint', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await controller.ready();

      expect(result).toHaveProperty('db');
      expect(result).toHaveProperty('redis');
      expect(result.db).toBe('ok');
      expect(result.redis).toBe('ok');
    });

    it('should support startup probe with check endpoint', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
    });

    it('should return version info for tracking deployments', () => {
      const result = controller.check();

      expect(result).toHaveProperty('version');
      expect(typeof result.version).toBe('string');
    });
  });

  describe('Health Check Resilience', () => {
    it('should gracefully handle partial failures in ready check', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Timeout'));
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await controller.ready();

      expect(result.redis).toBe('ok');
      expect(result.db).toBe('error');
    });

    it('should provide independent status for each component', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(1);
      mockRedis.ping.mockRejectedValue(new Error('Unavailable'));

      const result = await controller.ready();

      expect(result.db).not.toBe(result.redis);
    });

    it('should not crash on unexpected errors', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Unknown error'));
      mockRedis.ping.mockRejectedValue(new Error('Unknown error'));

      const result = await controller.ready();

      expect(result).toEqual({ db: 'error', redis: 'error' });
    });
  });
});
