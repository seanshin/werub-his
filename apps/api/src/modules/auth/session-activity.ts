/**
 * 세션 '마지막 활동' 기록 — 🔴 (2026-09-14 기획서 전체 검토) `AuthService.touchSession` 은 호출부가 0 이라
 * `session:{sid}.lastActiveAt` 이 **로그인 시각에 고정**돼 staff360 세션 목록·`/auth/session` 의 '마지막 활동'이 낡았다.
 * 게다가 그 메서드는 userId 의 **모든 세션**을 갱신하고 TTL 을 refresh 수명으로 **덮어써** 두 규칙을 어겼다:
 *  - 다른 기기의 활동이 내 세션을 연장하지 않는다(idle 키를 sid 단위로 가른 이유와 같다)
 *  - 활동 기록이 세션 수명을 늘리지 않는다 — 수명은 로그인·회전 때 정한 TTL 이 정본
 * 그래서 sid 하나만, TTL 은 그대로(`KEEPTTL`), 그리고 **스로틀**한다 — 모든 인증 요청마다 쓰면 Redis 쓰기가 요청 수만큼 는다.
 * 유휴 만료 집행은 이 파일 몫이 아니다(`jwt.strategy.ts` 의 `idle:` 키가 한다).
 */
export const SESSION_ACTIVITY_THROTTLE_MS = 60_000;

/** 갱신이 필요하면 새 JSON, 아니면 null(스로틀 안·손상된 값·다른 사용자) */
export function nextSessionActivity(raw: string, userId: string, now: number): string | null {
  let s: ({ userId?: string; lastActiveAt?: string } & Record<string, unknown>) | null;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || typeof s !== 'object' || s.userId !== userId) return null;
  const last = s.lastActiveAt ? Date.parse(s.lastActiveAt) : NaN;
  if (Number.isFinite(last) && now - last < SESSION_ACTIVITY_THROTTLE_MS) return null;
  return JSON.stringify({ ...s, lastActiveAt: new Date(now).toISOString() });
}

interface RedisLike {
  set(key: string, value: string, keepTtl: 'KEEPTTL'): Promise<unknown>;
}

/** `raw` 는 호출부가 이미 읽은 `session:{sid}` 값 — 다시 읽지 않는다. 쓰면 true */
export async function touchSessionActivity(
  redis: RedisLike,
  sid: string,
  raw: string,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  const next = nextSessionActivity(raw, userId, now);
  if (!next) return false;
  await redis.set(`session:${sid}`, next, 'KEEPTTL');
  return true;
}
