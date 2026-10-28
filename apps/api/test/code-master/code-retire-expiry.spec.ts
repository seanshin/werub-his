import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeUsageService } from '../../src/modules/code-master/code-usage.service';

/**
 * C3 — 폐지는 삭제가 아니고, 만료 경보는 **쓰이는 것만** 낸다(2026-08-26).
 *
 * 🔴 `validTo` 는 원래 있었는데 **그것이 지난 코드를 계속 쓰고 있는지 아무도 보지 않았다.**
 * 🔴 폐지하면서 후속 코드를 잇지 않으면 과거 기록이 무엇으로 바뀌었는지 알 수 없다.
 */
const SCHEMA = join(process.cwd(), 'prisma/schema.prisma');
const SVC = join(process.cwd(), 'src/modules/code-master/code-usage.service.ts');

const mk = (opts: { expired?: unknown[]; usage?: number | null }) => {
  const rows = opts.expired ?? [];
  const count = vi.fn().mockImplementation(() =>
    opts.usage === null ? Promise.reject(new Error('db')) : Promise.resolve(opts.usage ?? 0));
  const base = { findMany: vi.fn().mockResolvedValue(rows), update: vi.fn().mockResolvedValue({}), count };
  return new Proxy({ diagnosisCode: base, procedureCode: base, medicationCode: base } as Record<string, unknown>, {
    get: (t, p) => (t as Record<string, unknown>)[p as string] ?? { count },
  }) as never;
};

describe('코드 폐지', () => {
  const schema = readFileSync(SCHEMA, 'utf8');
  const src = readFileSync(SVC, 'utf8');

  it('세 코드 모델 모두 후속 코드 자리를 갖는다', () => {
    expect((schema.match(/successor_code/g) ?? []).length).toBe(3);
    expect((schema.match(/retired_reason/g) ?? []).length).toBe(3);
  });

  it('🔴 폐지는 행을 지우지 않는다(validTo 를 채운다)', () => {
    const i = src.indexOf('async retire(');
    const block = src.slice(i, i + 1600);
    expect(block).toContain('validTo: end');
    expect(block).not.toMatch(/\.delete\(/);
  });

  it('🔴 사유 없이 폐지되지 않는다', async () => {
    const svc = new CodeUsageService(mk({}));
    await expect(svc.retire('diagnosis', 'x', { validTo: '2026-12-31', reason: '' })).rejects.toThrow();
  });

  it('🔴 후속 코드가 없으면 그 사실을 결과에 남긴다', async () => {
    const svc = new CodeUsageService(mk({ usage: 0 }));
    const r = await svc.retire('diagnosis', 'x', { validTo: '2026-12-31', reason: '고시 폐지' });
    expect(r.warning).toContain('후속 코드가 지정되지 않았습니다');
  });

  it('대조군 — 후속 코드를 주면 경고하지 않는다', async () => {
    const svc = new CodeUsageService(mk({ usage: 0 }));
    const r = await svc.retire('diagnosis', 'x', { validTo: '2026-12-31', successorCode: 'A99', reason: '개정' });
    expect(r.warning).toBeNull();
    expect(r.successorCode).toBe('A99');
  });

  it('🔴 사용 중이어도 폐지는 막지 않는다(고시에서 없어진 코드는 없어져야 한다)', async () => {
    const svc = new CodeUsageService(mk({ usage: 7 }));
    const r = await svc.retire('diagnosis', 'x', { validTo: '2026-12-31', reason: '고시 폐지' });
    expect(r.retired).toBe(true);
    expect(r.usage.total).toBeGreaterThan(0);
  });
});

describe('만료 경보', () => {
  const expired = [{ id: '1', code: 'A', nameKo: '가', validTo: new Date('2020-01-01'), successorCode: null }];

  it('만료됐고 아직 쓰이면 낸다', async () => {
    const r = await new CodeUsageService(mk({ expired, usage: 4 })).expiredButUsed('diagnosis');
    expect(r.items).toHaveLength(1);
    // 목이 참조 테이블마다 같은 수를 돌려주므로 합계는 참조 수의 배수다 — 여기서 보는 것은
    // "쓰이는 것으로 판정했는가"이지 정확한 합계가 아니다(합계 계산은 getUsage 테스트가 본다)
    expect(r.items[0].usedCount).toBeGreaterThan(0);
  });

  it('🔴 대조군 — 만료됐지만 쓰이지 않으면 경보하지 않는다(거짓 경보 금지)', async () => {
    const r = await new CodeUsageService(mk({ expired, usage: 0 })).expiredButUsed('diagnosis');
    expect(r.items).toHaveLength(0);
    expect(r.scanned).toBe(1);
  });

  it('🔴 사용 건수를 못 세면 "안 쓰임"에 섞지 않고 따로 센다', async () => {
    const r = await new CodeUsageService(mk({ expired, usage: null })).expiredButUsed('diagnosis');
    expect(r.items).toHaveLength(0);
    expect(r.uncounted).toBe(1);
  });

  it('자르면 잘랐다고 말한다', async () => {
    const many = Array.from({ length: 2 }, (_, i) => ({ ...expired[0], id: String(i) }));
    const r = await new CodeUsageService(mk({ expired: many, usage: 1 })).expiredButUsed('diagnosis', 2);
    expect(r.truncated).toBe(true);
  });
});
