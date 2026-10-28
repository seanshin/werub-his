import { describe, it, expect, vi } from 'vitest';
import { OpeningService } from '../../src/modules/opening/opening.service';
import { OPENING_REGISTRY, INSTITUTION_KEY_PREFIX } from '../../src/modules/opening/opening.registry';

/**
 * 기관이 추가한 개원 항목 (P3 · 2026-08-28).
 *
 * 🔴 이 기능의 위험 넷 — 넷 다 **화면에서는 사실처럼 보인다**:
 *  ① 기관이 만든 항목이 **법정 항목처럼** 보이는 것(출처를 안 밝힘)
 *  ② 기관이 **연결 키를 들어** 남의 상태를 자기 상태인 척하는 것
 *  ③ 항목을 지워 **그에 붙은 기록이 무엇이었는지** 사라지는 것
 *  ④ **국가 간 선행**을 걸어 영영 안 풀리는 순서를 만드는 것
 */
const CUSTOM = {
  key: 'inst.abc0123456',
  countries: ['KR'],
  phase: 'O9_POST',
  title: '개원 첫 주 민원 집계',
  owner: '원무',
  authority: null,
  dueBy: 'AFTER_OPENING',
  cycle: null,
  note: null,
  dependsOn: [] as string[],
  isActive: true,
  inactiveReason: null,
};

function makeSvc(opts: {
  customRows?: Array<Record<string, unknown>>;
  customOne?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
} = {}) {
  const rows = opts.customRows ?? [];
  const create = vi.fn(async (a: { data: Record<string, unknown> }) => ({ ...CUSTOM, ...a.data }));
  const update = vi.fn(async (a: { data: Record<string, unknown> }) => ({ ...CUSTOM, ...a.data }));
  const del = vi.fn(async () => CUSTOM);
  const upsert = vi.fn(async (a: unknown) => a);
  const recUpdate = vi.fn(async (a: unknown) => a);
  const prisma = {
    openingCustomTask: {
      findMany: vi.fn(async (a?: { where?: { dependsOn?: { has: string } } }) => {
        if (a?.where?.dependsOn) return rows.filter((r) => (r.dependsOn as string[]).includes(a.where!.dependsOn!.has));
        return rows;
      }),
      findUnique: vi.fn(async () => (opts.customOne === undefined ? CUSTOM : opts.customOne)),
      create, update, delete: del,
    },
    openingTaskRecord: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => opts.record ?? null),
      upsert, deleteMany: vi.fn(async () => ({ count: 1 })), update: recUpdate,
    },
    committee: { findMany: vi.fn(async () => []) },
  };
  const goLive = { rollup: vi.fn(async () => ({ items: [] })) };
  const decisions = { list: vi.fn(async () => ({ items: [] })) };
  const svc = new OpeningService(prisma as never, goLive as never, decisions as never);
  return { svc, create, update, del, upsert, recUpdate };
}

const BASE = {
  phase: 'O9_POST', title: '개원 첫 주 민원 집계', owner: '원무',
  countries: ['KR'], dueBy: 'AFTER_OPENING',
};

describe('🔴 네임스페이스 — 코드 항목과 기관 항목이 부딪히지 않는다', () => {
  it('🔴 레지스트리는 `inst.` 접두어를 쓰지 않는다 — 쓰면 기관 항목이 코드 항목을 덮는다', () => {
    const bad = OPENING_REGISTRY.filter((d) => d.key.startsWith(INSTITUTION_KEY_PREFIX));
    expect(bad.map((d) => d.key)).toEqual([]);
  });

  it('발급되는 키는 `inst.` 로 시작한다(사람이 짓지 않는다)', async () => {
    const { svc, create } = makeSvc();
    await svc.createCustomTask(BASE, 'u1');
    const key = (create.mock.calls[0][0] as { data: { key: string } }).data.key;
    expect(key.startsWith(INSTITUTION_KEY_PREFIX)).toBe(true);
    // 🔴 경로 조작 여지가 없어야 한다 — 이 키가 업로드 디렉터리 이름이 된다
    expect(key).toMatch(/^inst\.[0-9a-f]{10}$/);
  });
});

describe('🔴 기관 항목은 연결 키를 가질 수 없다 — 파생은 코드 정본만 한다', () => {
  const CTRL = require('fs').readFileSync(
    require('path').join(process.cwd(), 'src/modules/opening/opening.controller.ts'), 'utf-8',
  );
  const DTO = CTRL.slice(CTRL.indexOf('class CustomTaskDto'), CTRL.indexOf('class CustomTaskActiveDto'));

  it('🔴 DTO 가 연결 키를 받지 않는다 — 전역 whitelist 가 지우므로 서버에 닿지도 않는다', () => {
    expect(DTO).not.toMatch(/goLiveKey/);
    expect(DTO).not.toMatch(/decisionKey/);
    expect(DTO).not.toMatch(/committeeCode/);
  });

  it('🔴 스키마에도 연결 키 컬럼이 없다 — 우회 경로가 생겨도 담을 곳이 없다', () => {
    const schema = require('fs').readFileSync(
      require('path').join(process.cwd(), 'prisma/schema.prisma'), 'utf-8',
    ) as string;
    const model = schema.slice(
      schema.indexOf('model OpeningCustomTask {'),
      schema.indexOf('}', schema.indexOf('model OpeningCustomTask {')),
    );
    expect(model).not.toMatch(/goLiveKey|decisionKey|committeeCode/);
  });

  it('🔴 기관 항목은 파생 계산을 아예 거치지 않는다', () => {
    const SRC = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src/modules/opening/opening.service.ts'), 'utf-8',
    ) as string;
    expect(SRC).toMatch(/origin === 'INSTITUTION'\s*\n?\s*\?\s*null/);
  });
});

describe('🔴 국가 — 비울 수 없고, 국가 간에 선행을 걸지 않는다', () => {
  it('국가가 비면 거부한다(모든 나라인지 안 정한 건지 구분되지 않는다)', async () => {
    const { svc } = makeSvc();
    await expect(svc.createCustomTask({ ...BASE, countries: [] }, 'u1')).rejects.toThrow(/어느 나라/);
  });

  it('모르는 국가 코드를 거부한다', async () => {
    const { svc } = makeSvc();
    await expect(svc.createCustomTask({ ...BASE, countries: ['ZZ'] }, 'u1')).rejects.toThrow(/모르는 국가/);
  });

  it('🔴 다른 나라 항목을 선행으로 걸 수 없다 — 영영 안 풀리는 순서가 된다', async () => {
    const ae = OPENING_REGISTRY.find((d) => d.countries.length === 1 && d.countries[0] === 'AE')!;
    const { svc } = makeSvc();
    await expect(
      svc.createCustomTask({ ...BASE, countries: ['KR'], dependsOn: [ae.key] }, 'u1'),
    ).rejects.toThrow(/다른 나라/);
  });

  it('같은 나라 항목은 선행으로 걸린다', async () => {
    const kr = OPENING_REGISTRY.find((d) => d.countries.includes('KR'))!;
    const { svc, create } = makeSvc();
    await svc.createCustomTask({ ...BASE, countries: ['KR'], dependsOn: [kr.key] }, 'u1');
    expect((create.mock.calls[0][0] as { data: { dependsOn: string[] } }).data.dependsOn).toEqual([kr.key]);
  });

  it('없는 항목을 선행으로 걸 수 없다', async () => {
    const { svc } = makeSvc();
    await expect(svc.createCustomTask({ ...BASE, dependsOn: ['open.nope'] }, 'u1')).rejects.toThrow(/선행 항목이 없/);
  });

  it('자기 자신을 선행으로 걸 수 없다', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.updateCustomTask(CUSTOM.key, { ...BASE, dependsOn: [CUSTOM.key] }),
    ).rejects.toThrow(/자기 자신/);
  });
});

describe('어휘 — 정본이 정한 것만 받는다', () => {
  it('모르는 단계를 거부한다', async () => {
    const { svc } = makeSvc();
    await expect(svc.createCustomTask({ ...BASE, phase: 'O99' }, 'u1')).rejects.toThrow(/단계/);
  });

  it('모르는 기한 구분을 거부한다', async () => {
    const { svc } = makeSvc();
    await expect(svc.createCustomTask({ ...BASE, dueBy: 'SOMEDAY' }, 'u1')).rejects.toThrow(/기한/);
  });

  it('🔴 주기 반복이 아닌데 주기를 들면 거부한다(모순이다)', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.createCustomTask({ ...BASE, dueBy: 'AFTER_OPENING', cycle: 'MONTHLY' }, 'u1'),
    ).rejects.toThrow(/주기 반복/);
  });

  it('🔴 주기 반복인데 주기를 모르는 것은 **막지 않는다** — 모르는 것을 강제하면 아무 값이나 채워진다', async () => {
    const { svc, create } = makeSvc();
    await svc.createCustomTask({ ...BASE, dueBy: 'RECURRING' }, 'u1');
    expect((create.mock.calls[0][0] as { data: { cycle: unknown } }).data.cycle).toBeNull();
  });

  it('이름·담당은 빈 값을 받지 않는다', async () => {
    const { svc } = makeSvc();
    await expect(svc.createCustomTask({ ...BASE, title: '  ' }, 'u1')).rejects.toThrow(/이름/);
    await expect(svc.createCustomTask({ ...BASE, owner: '' }, 'u1')).rejects.toThrow(/담당/);
  });

  it('🔴 제출처는 강제하지 않는다 — 모르면 null(빈 문자열로 아는 척하지 않는다)', async () => {
    const { svc, create } = makeSvc();
    await svc.createCustomTask({ ...BASE, authority: '   ' }, 'u1');
    expect((create.mock.calls[0][0] as { data: { authority: unknown } }).data.authority).toBeNull();
  });
});

describe('🔴 내리기는 삭제가 아니다', () => {
  it('사유 없이 내릴 수 없다 — 사유 없이 사라지면 빠뜨린 것과 구분되지 않는다', async () => {
    const { svc } = makeSvc();
    await expect(svc.setCustomTaskActive(CUSTOM.key, false)).rejects.toThrow(/사유/);
  });

  it('사유가 있으면 내려간다', async () => {
    const { svc, update } = makeSvc();
    await svc.setCustomTaskActive(CUSTOM.key, false, '올해는 하지 않기로 했다');
    const data = (update.mock.calls[0][0] as { data: { isActive: boolean; inactiveReason: string } }).data;
    expect(data.isActive).toBe(false);
    expect(data.inactiveReason).toBe('올해는 하지 않기로 했다');
  });

  it('🔴 다시 올리면 내려둔 사유를 지운다 — 남아 있으면 아직 내려간 것으로 읽힌다', async () => {
    const { svc, update } = makeSvc();
    await svc.setCustomTaskActive(CUSTOM.key, true);
    expect((update.mock.calls[0][0] as { data: { inactiveReason: unknown } }).data.inactiveReason).toBeNull();
  });

  it('🔴 기록이 있는 항목은 지우지 않는다 — 그 기록이 무엇이었는지 사라진다', async () => {
    const { svc } = makeSvc({ record: { taskKey: CUSTOM.key } });
    await expect(svc.deleteCustomTask(CUSTOM.key)).rejects.toThrow(/기록이 있는/);
  });

  it('기록이 없으면 지울 수 있다(오타 회수)', async () => {
    const { svc, del } = makeSvc({ record: null });
    await svc.deleteCustomTask(CUSTOM.key);
    expect(del).toHaveBeenCalledOnce();
  });

  it('🔴 이 항목을 선행으로 걸고 있으면 지우지 않는다 — 순서가 조용히 사라진다', async () => {
    const { svc } = makeSvc({ record: null, customRows: [{ ...CUSTOM, key: 'inst.other00000', title: '뒤 항목', dependsOn: [CUSTOM.key] }] });
    await expect(svc.deleteCustomTask(CUSTOM.key)).rejects.toThrow(/선행으로 걸고 있는/);
  });
});

describe('🔴 코드 항목은 화면에서 고치거나 지우지 않는다', () => {
  const reg = OPENING_REGISTRY[0].key;

  it('수정 거부', async () => {
    const { svc } = makeSvc();
    await expect(svc.updateCustomTask(reg, BASE)).rejects.toThrow(/기본 목록/);
  });

  it('삭제 거부', async () => {
    const { svc } = makeSvc();
    await expect(svc.deleteCustomTask(reg)).rejects.toThrow(/기본 목록/);
  });

  it('내리기 거부 — 대신 "해당 없음"으로 기록하는 길이 이미 있다', async () => {
    const { svc } = makeSvc();
    await expect(svc.setCustomTaskActive(reg, false, '사유')).rejects.toThrow(/기본 목록/);
  });
});

describe('🔴 기관 항목에도 기록·증빙 경로가 통한다', () => {
  it('기관 항목에 기록할 수 있다 — 한쪽만 고치면 조용히 404 가 된다', async () => {
    const { svc, upsert } = makeSvc();
    await svc.record(CUSTOM.key, { state: 'RECORDED' }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('기관 항목에 증빙을 붙일 수 있다', async () => {
    const { svc, recUpdate } = makeSvc({ record: { taskKey: CUSTOM.key, attachments: [] } });
    await svc.addAttachment(CUSTOM.key, { filename: 'x.png', originalName: '증빙.png', mimetype: 'image/png', size: 10 }, 'u1');
    expect(recUpdate).toHaveBeenCalledOnce();
  });

  it('🔴 내려둔 항목에는 새 기록을 받지 않는다', async () => {
    const { svc } = makeSvc({ customOne: { ...CUSTOM, isActive: false } });
    await expect(svc.record(CUSTOM.key, { state: 'RECORDED' }, 'u1')).rejects.toThrow(/내려둔/);
  });

  it('🔴 내려둔 항목의 기록 철회는 된다 — 이미 남은 것은 지울 수 있어야 한다', async () => {
    const { svc } = makeSvc({ customOne: { ...CUSTOM, isActive: false } });
    await expect(svc.clearRecord(CUSTOM.key)).resolves.toMatchObject({ cleared: true });
  });

  it('없는 기관 키는 거부한다(아무 키나 기록할 수 없다)', async () => {
    const { svc } = makeSvc({ customOne: null });
    await expect(svc.record('inst.deadbeef00', { state: 'RECORDED' }, 'u1')).rejects.toThrow(/찾을 수 없/);
  });

  it('🔴 증빙 판독이 기관 항목의 제목을 찾는다 — 못 찾으면 전부 "행정 증빙 문서"가 된다', async () => {
    const { svc } = makeSvc();
    await expect(svc.taskTitle(CUSTOM.key)).resolves.toBe(CUSTOM.title);
  });
});

describe('🔴 화면이 출처를 밝힌다 — 섞으면 두 방향으로 거짓말한다', () => {
  it('모든 항목이 origin 을 들고 있고, 기관 항목은 INSTITUTION 이다', async () => {
    const { svc } = makeSvc({ customRows: [CUSTOM] });
    const ov = await svc.overview('KR');
    const all = ov.phases.flatMap((p) => p.tasks);
    expect(all.every((t) => t.origin === 'REGISTRY' || t.origin === 'INSTITUTION')).toBe(true);
    expect(all.find((t) => t.key === CUSTOM.key)?.origin).toBe('INSTITUTION');
  });

  it('🔴 단계마다 "그중 기관 항목 몇 건"을 센다 — 안 밝히면 법정 항목 분모로 읽힌다', async () => {
    const { svc } = makeSvc({ customRows: [CUSTOM] });
    const ov = await svc.overview('KR');
    const o9 = ov.phases.find((p) => p.phase === 'O9_POST')!;
    expect(o9.institutional).toBe(1);
    expect(o9.total).toBe(1);
  });

  it('🔴 내려둔 항목은 분모에서 빠지되 **사라지지는 않는다**(개수를 밝힌다)', async () => {
    const down = { ...CUSTOM, isActive: false, inactiveReason: '올해는 안 한다' };
    const { svc } = makeSvc({ customRows: [down] });
    const ov = await svc.overview('KR');
    expect(ov.phases.find((p) => p.phase === 'O9_POST')!.total).toBe(0);
    expect(ov.inactiveCustom).toHaveLength(1);
    expect(ov.inactiveCustom[0].reason).toBe('올해는 안 한다');
  });

  it('🔴 다른 나라의 기관 항목은 이 나라 목록에 섞이지 않는다', async () => {
    const { svc } = makeSvc({ customRows: [{ ...CUSTOM, countries: ['AE'] }] });
    const ov = await svc.overview('KR');
    expect(ov.phases.flatMap((p) => p.tasks).some((t) => t.key === CUSTOM.key)).toBe(false);
  });

  it('기관 항목에는 파생이 붙지 않는다(언제나 사람 기록이다)', async () => {
    const { svc } = makeSvc({ customRows: [CUSTOM] });
    const ov = await svc.overview('KR');
    const t = ov.phases.flatMap((p) => p.tasks).find((x) => x.key === CUSTOM.key)!;
    expect(t.derived).toBeNull();
    expect(t.state).toBe('NOT_RECORDED');
  });
});
