/**
 * 테스트용 인메모리 Redis — SMART 인가 코드·launch 문맥 저장의 정본이 Redis 로 옮겨지면서 필요해졌다.
 * 🔴 이것은 **테스트 도구**다. 운영 코드에는 메모리 폴백이 없다(정본이 둘이면 갈라진다).
 */
export function fakeRedis() {
  const store = new Map<string, { v: string; exp: number }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp <= Date.now()) { store.delete(k); return null; }
    return e;
  };
  return {
    _store: store,
    async set(k: string, v: string, _mode?: string, ttlSec?: number) {
      store.set(k, { v, exp: Date.now() + (ttlSec ?? 300) * 1000 });
      return 'OK';
    },
    async get(k: string) { return live(k)?.v ?? null; },
    async getdel(k: string) { const e = live(k); store.delete(k); return e?.v ?? null; },
    async exists(k: string) { return live(k) ? 1 : 0; },
    async del(k: string) { return store.delete(k) ? 1 : 0; },
    /** 저장된 JSON 을 꺼내 본다(테스트 편의 — 종전 `(svc as any).launchContexts.get()` 자리) */
    read(k: string) { const e = live(k); return e ? JSON.parse(e.v) : undefined; },
    ttlMs(k: string) { const e = live(k); return e ? e.exp - Date.now() : -1; },
  };
}
