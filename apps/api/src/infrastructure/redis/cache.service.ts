import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Redis 기반 쿼리 캐시 서비스.
 * API 응답을 캐싱하여 DB 부하를 줄입니다.
 *
 * 사용: await this.cache.getOrSet('dashboard:summary', 60, () => this.computeExpensiveQuery());
 */
@Injectable()
export class CacheService {
  constructor(@Optional() private readonly redis?: RedisService) {}

  /** 캐시에서 조회, 없으면 factory 실행 후 저장 */
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    if (!this.redis) return factory();

    try {
      const cached = await this.redis.get(`cache:${key}`);
      if (cached) return JSON.parse(cached) as T;
    } catch {
      // Redis 실패 시 DB 직접 조회
    }

    const result = await factory();

    try {
      await this.redis.setex(`cache:${key}`, ttlSeconds, JSON.stringify(result));
    } catch {
      // 캐시 저장 실패 무시
    }

    return result;
  }

  /** 캐시 무효화 (패턴 기반) */
  async invalidate(pattern: string): Promise<void> {
    if (!this.redis) return;
    try {
      const keys = await this.redis.keys(`cache:${pattern}`);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch {
      // 무효화 실패 무시
    }
  }

  /** 특정 키 삭제 */
  async del(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`cache:${key}`);
    } catch { /* ignore */ }
  }
}
