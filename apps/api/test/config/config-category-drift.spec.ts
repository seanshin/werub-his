import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigRuntimeService, DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { CONFIG_ENV_OVERRIDES } from '../../src/common/config-env-overrides';

/**
 * 설정 출처가 "기본값"이라 거짓말하던 행(외부 점검).
 *
 * 무엇이 틀려 있었나:
 *   · `getAll(category)` 가 `where: { category }` 로만 골랐다. DEFAULTS 미등재 시절에 `set()` 이 만든 행은
 *     `category='general'` 로 굳어 있어 그 목록에 안 잡혔고, 루프는 `db` 를 못 찾아 **저장된 값이 있는데도
 *     코드 기본값을 `source:'default'`** 로 내보냈다 — "사람이 정한 값"을 "아무도 정한 적 없다"고 말했다.
 *   · `set()` 의 update 가 `{ value, updatedBy }` 뿐이라 틀린 category 가 영원히 굳었다(자기교정 없음).
 *
 * 🔴 재주입하면 반드시 실패한다:
 *   - getAll 의 `OR: [{ category }, { key: { in: 등재키 } }]` 를 `{ category }` 로 되돌리면 → '옛 category 행도 같이 읽는다' 실패
 *   - set() 의 `...(def ? { category: def.category } : {})` 를 지우면 → '쓰면 category 가 정본으로 돌아온다' 실패
 *
 * 🔴 목은 정본(prisma)이 실제로 받는 질의 모양대로 **OR 를 평가**한다 — `where.OR` 를 못 보는 목은
 *    질의를 되돌려도 통과시킨다(재주입 역검증에서 확인).
 */
function fakePrisma(rows: { key: string; value: unknown; category: string; label: string }[]) {
  const matches = (r: (typeof rows)[number], where: any): boolean => {
    if (!where) return true;
    if (Array.isArray(where.OR)) return where.OR.some((w: any) => matches(r, w));
    if (typeof where.category === 'string') return r.category === where.category;
    if (where.category?.notIn) return !where.category.notIn.includes(r.category);
    if (where.key?.in) return where.key.in.includes(r.key);
    return true;
  };
  const upsert = vi.fn(async () => ({}));
  const findMany = vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)));
  return {
    systemConfig: { findMany, findUnique: async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null, upsert },
  } as any;
}
const events = { emit: () => true } as any;

/** 리터럴을 박지 않는다 — 카테고리가 general 이 아닌 등재 키 하나를 정본에서 고른다 */
const DRIFTED = Object.values(DEFAULTS).find((e) => e.category !== 'general' && !(e.key in CONFIG_ENV_OVERRIDES))!;
/** env 덮어쓰기 대상 키(정본 `CONFIG_ENV_OVERRIDES`) — 그 경로가 이 변경으로 깨지지 않았는지 본다 */
const ENV_KEY = Object.keys(CONFIG_ENV_OVERRIDES)[0];

describe('🔴 설정 출처 — category 가 옛날 것으로 굳은 DB 행을 "기본값"이라 말하지 않는다', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('대조군 — 픽스처가 분기를 겨눈다(등재 키 · general 아닌 카테고리 · env 대상 아님)', () => {
    expect(DRIFTED).toBeDefined();
    expect(DRIFTED.category).not.toBe('general');
    expect(ENV_KEY).toBeDefined();
    expect(DEFAULTS[ENV_KEY].category).not.toBe('general');
  });

  it('옛 category(general)로 굳은 행도 그 키의 카테고리 목록이 함께 읽는다 — source=db', async () => {
    const prisma = fakePrisma([{ key: DRIFTED.key, value: 'SET_BY_HUMAN', category: 'general', label: 'x' }]);
    const svc = new ConfigRuntimeService(prisma, events);
    const rows = await svc.getAll(DRIFTED.category);
    const row = rows.find((r) => r.key === DRIFTED.key);
    expect(row?.value).toBe('SET_BY_HUMAN');
    expect(row?.source, "'default' 면 사람이 정한 값을 없다고 말한 것이다").toBe('db');
    expect(row?.registered).toBe(true);
    // 같은 행이 두 번 나오지 않는다(등재 루프가 한 번 그렸으면 미등재 루프는 건너뛴다)
    expect(rows.filter((r) => r.key === DRIFTED.key)).toHaveLength(1);
  });

  it('[대조군] 행이 없으면 종전대로 source=default — 없는 값을 "설정됨"으로 말하지 않는다', async () => {
    const svc = new ConfigRuntimeService(fakePrisma([]), events);
    const row = (await svc.getAll(DRIFTED.category)).find((r) => r.key === DRIFTED.key);
    expect(row?.source).toBe('default');
    expect(row?.value).toEqual(DRIFTED.value);
  });

  it('env 덮어쓰기는 여전히 맨 앞이다 — 굳은 행이 있어도 source=env', async () => {
    vi.stubEnv(CONFIG_ENV_OVERRIDES[ENV_KEY], 'https://from-env.test');
    const prisma = fakePrisma([{ key: ENV_KEY, value: 'https://from-db.test', category: 'general', label: 'x' }]);
    const svc = new ConfigRuntimeService(prisma, events);
    const row = (await svc.getAll(DEFAULTS[ENV_KEY].category)).find((r) => r.key === ENV_KEY);
    expect(row?.source).toBe('env');
    expect(row?.value).toBe('https://from-env.test');
  });

  it('[대조군] category 없이 부르면 종전 질의(notIn 제외 카테고리) 그대로다', async () => {
    const prisma = fakePrisma([]);
    await new ConfigRuntimeService(prisma, events).getAll();
    const where = prisma.systemConfig.findMany.mock.calls.at(-1)![0].where;
    expect(where.category.notIn).toBeDefined();
    expect(where.OR).toBeUndefined();
  });

  it('쓰면 category 가 정본으로 되돌아온다(등재 키만) · 미등재 키는 손대지 않는다', async () => {
    const prisma = fakePrisma([]);
    const svc = new ConfigRuntimeService(prisma, events);
    await svc.set(DRIFTED.key, 'v', 'admin-1');
    const args = prisma.systemConfig.upsert.mock.calls[0][0];
    expect(args.update.category).toBe(DRIFTED.category);
    expect(args.create.category).toBe(DRIFTED.category);

    prisma.systemConfig.upsert.mockClear();
    await svc.set('some.unregistered.key', 1, 'admin-1');
    const args2 = prisma.systemConfig.upsert.mock.calls[0][0];
    expect(args2.update.category, '정본에 없는 키를 재분류했다').toBeUndefined();
    expect(args2.create.category).toBe('general');
  });
});
