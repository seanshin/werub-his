/**
 * 직원 유휴 만료 시행(2026-10-12 결정 `auth.staffIdleTimeout` = ENFORCE_ALL · 사용자 지시 "모든 클라이언트 시행").
 *  · 🔴 종전: 유휴 키를 `EX 기준+60초` 로 써서 31분 넘게 쉬면 키가 사라져 **그냥 통과** · 판정 순간 키를 지워 다음 요청도 통과
 *  · 이제: 키는 세션보다 오래 남는다 · 기준을 넘기면 401 SESSION_IDLE_EXPIRED + 그 세션(refresh 포함) 폐기 → 다음 요청·refresh 도 막힘
 *  · 대조군: 기준 안의 활동은 통과하고 시각을 갱신한다 · 관리자·CRM 은 60분
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, IDLE_KEY_RETENTION_SEC } from '../../src/modules/auth/strategies/jwt.strategy';

const U = '00000000-0000-4000-a000-000000000001';
const SID = 'sess-1';
const MIN = 60_000;

function fakeRedis(init: Record<string, string> = {}) {
  const kv = new Map(Object.entries(init));
  const ex = new Map<string, number>();
  const sets = new Map<string, Set<string>>([[`sessions:${U}`, new Set([SID])]]);
  const r: any = {
    kv, ex, sets,
    get: vi.fn(async (k: string) => kv.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, mode?: string, sec?: number) => { kv.set(k, v); if (mode === 'EX') ex.set(k, sec!); return 'OK'; }),
    del: vi.fn(async (k: string) => { kv.delete(k); return 1; }),
    multi: () => {
      const ops: Array<() => void> = [];
      const m: any = {
        del: (k: string) => { ops.push(() => kv.delete(k)); return m; },
        srem: (k: string, v: string) => { ops.push(() => sets.get(k)?.delete(v)); return m; },
        exec: async () => { ops.forEach((o) => o()); return []; },
      };
      return m;
    },
  };
  return r;
}
const session = () => JSON.stringify({ userId: U, lastActiveAt: new Date().toISOString() });
function strategy(redis: ReturnType<typeof fakeRedis>, role = 'DOCTOR') {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ id: U, role, isActive: true, accountStage: 'ACTIVE' }) } };
  return new JwtStrategy({ getOrThrow: () => 'secret' } as never, prisma as never, redis as never);
}
const live = (lastMsAgo: number) => fakeRedis({
  [`session:${SID}`]: session(), [`refresh:sess:${SID}`]: 'rt', [`idle:${SID}`]: String(Date.now() - lastMsAgo),
});

describe('🔴 직원 유휴 만료 — 실제로 끊는다', () => {
  it('기준(임상 30분)을 넘기면 401 SESSION_IDLE_EXPIRED · 세션·refresh·세션 목록에서 폐기', async () => {
    const redis = live(31 * MIN);
    const e = await strategy(redis).validate({ sub: U, sid: SID } as never).catch((x) => x);
    expect(e).toBeInstanceOf(UnauthorizedException);
    expect((e as UnauthorizedException).getResponse()).toMatchObject({ code: 'SESSION_IDLE_EXPIRED' });
    expect(redis.kv.has(`session:${SID}`)).toBe(false);
    expect(redis.kv.has(`refresh:sess:${SID}`)).toBe(false);
    expect(redis.sets.get(`sessions:${U}`)!.has(SID)).toBe(false);
  });
  it('🔴 종전 구멍 — 기준을 한참 넘긴(2시간) 요청도 통과하지 않는다 · 만료 다음 요청도 막힌다', async () => {
    const redis = live(120 * MIN);
    const s = strategy(redis);
    await expect(s.validate({ sub: U, sid: SID } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    const next = await s.validate({ sub: U, sid: SID } as never).catch((x) => x);
    expect(next).toBeInstanceOf(UnauthorizedException); // 세션이 폐기돼 SESSION_REVOKED
  });
  it('🔴 유휴 키는 세션보다 오래 남는다(EX 8일) — 기준+60초로 사라지지 않는다', async () => {
    const redis = live(1 * MIN);
    await strategy(redis).validate({ sub: U, sid: SID } as never);
    expect(redis.ex.get(`idle:${SID}`)).toBe(IDLE_KEY_RETENTION_SEC);
    expect(IDLE_KEY_RETENTION_SEC).toBeGreaterThan(7 * 24 * 3600);
  });
  it('대조군 — 기준 안의 활동은 통과하고 시각을 갱신한다 · 관리자는 60분(45분 통과)', async () => {
    const r1 = live(29 * MIN);
    await expect(strategy(r1).validate({ sub: U, sid: SID } as never)).resolves.toBeTruthy();
    expect(Date.now() - Number(r1.kv.get(`idle:${SID}`))).toBeLessThan(5_000);
    const r2 = live(45 * MIN);
    await expect(strategy(r2, 'ADMIN').validate({ sub: U, sid: SID } as never)).resolves.toBeTruthy();
    const r3 = live(61 * MIN);
    await expect(strategy(r3, 'ADMIN').validate({ sub: U, sid: SID } as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('레거시 토큰(sid 없음) — 사용자 단위 키를 지우지 않아 다음 요청도 막힌다', async () => {
    const redis = fakeRedis({ [`idle:${U}`]: String(Date.now() - 40 * MIN) });
    const s = strategy(redis);
    await expect(s.validate({ sub: U } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(s.validate({ sub: U } as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
