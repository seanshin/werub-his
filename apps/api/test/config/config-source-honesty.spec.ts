import { describe, it, expect } from 'vitest';
import { ConfigRuntimeService, DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';

/**
 * 🔴 **"설정돼 있다"와 "기본값으로 떨어졌다"는 다른 사실이다.**
 *
 * 종전 `getAll()`/`GET /:key` 는 DB 행 값과 코드 `DEFAULTS` 값을 **같은 모양**으로 내려줬다.
 * 그래서 화면은 어떤 값이 사람이 정한 것이고 어떤 값이 아무도 정한 적 없는 것인지 말할 수 없었고,
 * 2026-09-09 ERP SSO 진단이 실제로 여기서 막혔다(`erp.allowedRoles` 를 되돌리기 전 값을 확인할 방법이 없었다).
 *
 * 🔴 이 가드가 지키는 것은 **드러내는 것**이지 막는 것이 아니다 — 기본값으로 도는 것은 결함이 아니다
 *    (CLAUDE.md §4 "기본값으로 떨어진 것을 조용히 하지 않는다 — 다만 막지 않는다").
 *
 * 🔴 재주입 역검증: 아래 네 갈래를 되돌리면 각각 이 파일의 한 케이스가 실패한다.
 *    ① `source: db ? 'db' : 'default'` 를 상수로 · ② 미등재 DB 행 수집 루프 삭제 ·
 *    ③ `getWithSource` 의 `unset` 을 `default` 로 · ④ 컨트롤러 `data` 를 `{value,source}` 객체로.
 */

/** 정본이 실제로 쓰는 모양의 prisma 대역 — 내가 가정한 모양이 아니라 서비스가 부르는 메서드만 둔다 */
function fakePrisma(rows: { key: string; value: unknown; category: string; label: string }[]) {
  return {
    systemConfig: {
      findMany: async ({ where }: any) => {
        if (where?.category?.notIn) return rows.filter((r) => !where.category.notIn.includes(r.category));
        if (typeof where?.category === 'string') return rows.filter((r) => r.category === where.category);
        return rows;
      },
      findUnique: async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null,
    },
  } as any;
}

const events = { emit: () => true } as any;

/** DEFAULTS 에서 실재하는 키 하나를 고른다 — 리터럴을 박으면 키가 사라져도 가드가 조용히 통과한다 */
const REGISTERED_KEY = Object.keys(DEFAULTS)[0];

describe('설정값 출처 정직성 — 기본값을 "설정됨"으로 말하지 않는다', () => {
  it('DB 행이 있는 키는 source=db · 없는 키는 source=default 로 갈린다', async () => {
    const svc = new ConfigRuntimeService(
      fakePrisma([{ key: REGISTERED_KEY, value: 'SET_BY_HUMAN', category: DEFAULTS[REGISTERED_KEY].category, label: 'x' }]),
      events,
    );
    const list = await svc.getAll();
    const stored = list.find((e) => e.key === REGISTERED_KEY);
    expect(stored?.source).toBe('db');
    expect(stored?.value).toBe('SET_BY_HUMAN');

    // 나머지는 전부 코드 기본값이다 — 하나라도 'db' 로 나오면 출처를 지어낸 것이다
    const others = list.filter((e) => e.key !== REGISTERED_KEY && e.registered);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((e) => e.source === 'default')).toBe(true);
  });

  it('🔴 DEFAULTS 미등재인데 DB 행이 있는 키도 목록에 뜬다(종전엔 통째로 시야 밖이었다)', async () => {
    const orphan = { key: 'zzz.seed.residue', value: { locked: true }, category: 'general', label: '시드 잔재' };
    const svc = new ConfigRuntimeService(fakePrisma([orphan]), events);
    const list = await svc.getAll();
    const row = list.find((e) => e.key === orphan.key);
    expect(row, '미등재 DB 행이 목록에서 빠지면 되돌릴 자리가 없다').toBeDefined();
    expect(row?.registered).toBe(false);
    expect(row?.source).toBe('db');
    // 설명을 지어내지 않는다 — 행이 가진 label 을 그대로 쓴다
    expect(row?.description).toBe('시드 잔재');
  });

  it('🔴 미등재 행을 드러내려다 ACL 을 열지 않는다 — `?category=access` 로도 새지 않는다', async () => {
    const acl = { key: 'access.dept.원무과', value: { allowedPaths: ['/billing'] }, category: 'access', label: '원무과 메뉴 접근 권한' };
    const svc = new ConfigRuntimeService(fakePrisma([acl]), events);
    // 이 EP 는 역할 가드가 없다(전 직원 읽기) — 카테고리 파라미터로도 뚫리면 안 된다
    expect((await svc.getAll('access')).some((e) => e.key === acl.key)).toBe(false);
    expect((await svc.getAll()).some((e) => e.key === acl.key)).toBe(false);
  });

  it('getWithSource 는 db / default / unset 세 상태를 갈라 말한다', async () => {
    const svc = new ConfigRuntimeService(
      fakePrisma([{ key: REGISTERED_KEY, value: 1, category: 'general', label: 'x' }]),
      events,
    );
    expect(await svc.getWithSource(REGISTERED_KEY)).toEqual({ value: 1, source: 'db', registered: true });

    const unstored = Object.keys(DEFAULTS).find((k) => k !== REGISTERED_KEY)!;
    const d = await svc.getWithSource(unstored);
    expect(d.source).toBe('default');
    expect(d.value).toEqual(DEFAULTS[unstored].value);

    // 🔴 `unset` 은 `default` 와 다른 사실이다 — 없는 정책을 "기본값"이라 부르지 않는다
    expect(await svc.getWithSource('no.such.key.anywhere')).toEqual({ value: null, source: 'unset', registered: false });
  });

  it('값은 `get()` 과 완전히 같다 — 출처를 더하려고 값을 바꾸지 않는다', async () => {
    const svc = new ConfigRuntimeService(
      fakePrisma([{ key: REGISTERED_KEY, value: 'V', category: 'general', label: 'x' }]),
      events,
    );
    for (const k of [REGISTERED_KEY, Object.keys(DEFAULTS)[1], 'no.such.key.anywhere']) {
      expect((await svc.getWithSource(k)).value).toEqual(await svc.get(k));
    }
  });

  it('🔴 GET /:key 의 `data` 는 값 그대로다 — 출처는 meta 로만 더한다(소비처 10곳 넘음)', async () => {
    const ctrl = new ConfigRuntimeController(Object.assign({ get: async () => null }, {
      getWithSource: async () => ({ value: 42, source: 'default', registered: true }),
    } as any) as never, { emitAsync: async () => [] } as never);
    const res: any = await ctrl.get('some.key');
    expect(res.data, 'data 를 객체로 바꾸면 값으로 읽는 화면이 전부 깨진다').toBe(42);
    expect(res.meta).toEqual({ source: 'default', registered: true });
  });
});

/**
 * 🔴 화면이 실제로 그리는지는 **렌더로** 본다 — `apps/web/test/ui/config-source-badge.spec.tsx`.
 *    여기서 소스 문자열을 대조하면 "import 만 넣고 렌더는 안 한" 자리를 통과시킨다(v4.x 에서 17파일 겪음).
 */
