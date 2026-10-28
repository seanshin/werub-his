/**
 * 🔴 (2026-09-14 기획서 전체 검토) `touchSession` 호출부가 0 이라 세션 '마지막 활동'이 로그인 시각에 고정됐다.
 * 지키는 것:
 *  ① 인증 요청(jwt.strategy)이 **그 sid 세션만** lastActiveAt 을 갱신한다 — 다른 기기 세션은 불변(대조군)
 *  ② TTL 을 덮어쓰지 않는다(`KEEPTTL`) — 활동이 세션 수명을 늘리지 않는다
 *  ③ 60초 스로틀 — 스로틀 안이면 쓰지 않는다 · 경계를 넘으면 쓴다(대조군)
 *  ④ 손상된 값·다른 사용자 세션은 쓰지 않는다
 */
import { describe, expect, it, vi } from 'vitest';
import { nextSessionActivity, SESSION_ACTIVITY_THROTTLE_MS, touchSessionActivity } from '../../src/modules/auth/session-activity';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';

const NOW = Date.parse('2026-09-14T05:00:00Z');
const U = 'user-1';

function fakeRedis(initial: Record<string, { value: string; ttl: number }>) {
  const store = new Map(Object.entries(initial));
  const calls: unknown[][] = [];
  return {
    store,
    calls,
    async get(k: string) { return store.get(k)?.value ?? null; },
    async set(k: string, v: string, ...args: unknown[]) {
      calls.push([k, v, ...args]);
      const prev = store.get(k);
      const keep = args[0] === 'KEEPTTL';
      const ex = args[0] === 'EX' ? Number(args[1]) : undefined;
      store.set(k, { value: v, ttl: keep ? prev?.ttl ?? -1 : ex ?? -1 });
      return 'OK';
    },
    async del(k: string) { store.delete(k); return 1; },
  };
}

describe('세션 마지막 활동 — 순수 판정', () => {
  it('③ 스로틀 안이면 null, 경계를 넘으면 새 lastActiveAt', () => {
    const inside = JSON.stringify({ userId: U, lastActiveAt: new Date(NOW - SESSION_ACTIVITY_THROTTLE_MS + 1000).toISOString() });
    expect(nextSessionActivity(inside, U, NOW)).toBeNull();
    const outside = JSON.stringify({ userId: U, createdAt: 'c', lastActiveAt: new Date(NOW - SESSION_ACTIVITY_THROTTLE_MS - 1).toISOString() });
    const next = JSON.parse(nextSessionActivity(outside, U, NOW)!);
    expect(next).toEqual({ userId: U, createdAt: 'c', lastActiveAt: new Date(NOW).toISOString() });
  });

  it('④ 손상된 값·다른 사용자 세션은 쓰지 않는다', () => {
    expect(nextSessionActivity('{not json', U, NOW)).toBeNull();
    expect(nextSessionActivity(JSON.stringify({ userId: 'other', lastActiveAt: '2026-01-01T00:00:00Z' }), U, NOW)).toBeNull();
  });
});

describe('세션 마지막 활동 — jwt.strategy 배선', () => {
  function strategy(redis: ReturnType<typeof fakeRedis>) {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ id: U, role: 'DOCTOR', isActive: true, accountStage: 'ACTIVE' }) } };
    const config = { getOrThrow: () => 'secret' };
    return new JwtStrategy(config as never, prisma as never, redis as never);
  }

  it('① 그 sid 만 갱신 · 다른 기기 세션 불변 · ② TTL 유지(KEEPTTL)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const old = new Date(NOW - 10 * 60_000).toISOString();
    const redis = fakeRedis({
      'session:A': { value: JSON.stringify({ userId: U, createdAt: old, lastActiveAt: old }), ttl: 1234 },
      'session:B': { value: JSON.stringify({ userId: U, createdAt: old, lastActiveAt: old }), ttl: 999 },
    });
    await strategy(redis).validate({ sub: U, email: 'e', role: 'DOCTOR', sid: 'A' } as never);
    expect(JSON.parse(redis.store.get('session:A')!.value).lastActiveAt).toBe(new Date(NOW).toISOString());
    expect(redis.store.get('session:A')!.ttl).toBe(1234);
    expect(redis.calls.find((c) => c[0] === 'session:A')?.[2]).toBe('KEEPTTL');
    expect(JSON.parse(redis.store.get('session:B')!.value).lastActiveAt).toBe(old);
    vi.useRealTimers();
  });

  it('③ 스로틀 안의 연속 요청은 세션 키를 다시 쓰지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const recent = new Date(NOW - 5_000).toISOString();
    const redis = fakeRedis({ 'session:A': { value: JSON.stringify({ userId: U, lastActiveAt: recent }), ttl: 50 } });
    await strategy(redis).validate({ sub: U, email: 'e', role: 'DOCTOR', sid: 'A' } as never);
    expect(redis.calls.filter((c) => c[0] === 'session:A')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('쓰기 헬퍼는 KEEPTTL 로만 쓴다', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const wrote = await touchSessionActivity({ set }, 'S', JSON.stringify({ userId: U }), U, NOW);
    expect(wrote).toBe(true);
    expect(set).toHaveBeenCalledWith('session:S', expect.any(String), 'KEEPTTL');
  });
});
