/**
 * 🔴 CSSD 자동 만료 크론 — **조용히 스킵하지 않는다**(2026-08-27).
 *
 * 원 결함: `expireOverdue()` 가 만료 대상 조회를 `.catch(() => [])` 로 접었다.
 *   ① 조회가 실패하면 만료 처리가 통째로 스킵되고
 *   ② 로그는 `if (pkgs.length || sets.count)` 안에만 있어 **아무 흔적도 남지 않았다**.
 *   → 운영에서 "만료 0건"과 "탐지기가 죽었다"가 구분되지 않는다(v4.4.0 DUR 43룰 매칭 0 과 같은 유형).
 *
 * 재주입 검증(실제로 되돌려 확인함):
 *   · `findMany(...).catch(() => [])` 로 되돌리면 → '조회 실패' 케이스 3건이 실패한다
 *     (ok=true 로 나오고, packagesFound 가 null 이 아니라 0 이 되며, error 로그가 안 찍힌다)
 *   · 요약 로그를 `if (packagesExpired || sets)` 로 다시 감싸면 → '0건이어도 한 줄' 케이스가 실패한다
 *   · update 의 `.catch(() => {})` 를 되살리면 → '건별 실패' 케이스가 실패한다
 * 대조군: 전부 성공하는 경로에서는 ok=true·failures=[]·error 로그 0 (무조건 실패라 말하지 않는다).
 */
import { describe, it, expect, vi } from 'vitest';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';

type PrismaStub = {
  sterilePackage: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  packageEvent: { create: ReturnType<typeof vi.fn> };
  instrumentSet: { updateMany: ReturnType<typeof vi.fn> };
};

function mk(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma: PrismaStub = {
    sterilePackage: {
      findMany: vi.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
      update: vi.fn().mockResolvedValue({}),
    },
    packageEvent: { create: vi.fn().mockResolvedValue({}) },
    instrumentSet: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
    ...(overrides as object),
  } as PrismaStub;
  const svc = new CssdPackageService(prisma as never, {} as never, undefined);
  const errors: string[] = [];
  const logs: string[] = [];
  vi.spyOn((svc as unknown as { logger: { error: unknown } }).logger, 'error')
    .mockImplementation(((m: string) => { errors.push(m); }) as never);
  vi.spyOn((svc as unknown as { logger: { log: unknown } }).logger, 'log')
    .mockImplementation(((m: string) => { logs.push(m); }) as never);
  return { svc, prisma, errors, logs };
}

describe('CSSD 자동 만료 크론 — 실패를 "없음"으로 번역하지 않는다', () => {
  it('🔴 조회가 실패하면 ok=false · packagesFound=null(0 아님) · failures 에 사유가 담긴다', async () => {
    const { svc } = mk();
    const p = (svc as unknown as { prisma: PrismaStub }).prisma;
    p.sterilePackage.findMany.mockRejectedValue(new Error('DB down'));

    const r = await svc.expireOverdue();

    expect(r.ok, '조회 실패를 성공으로 말하면 안 된다').toBe(false);
    // 0 은 "만료 대상이 없었다"는 **다른 사실**이다. 모르는 것은 null 로 말한다.
    expect(r.packagesFound).toBeNull();
    expect(r.packagesExpired).toBe(0);
    expect(r.failures.join(' ')).toContain('DB down');
  });

  it('🔴 조회가 실패해도 error 로그로 흔적이 남는다 — 조용히 아무 일도 안 하는 상태가 없다', async () => {
    const { svc, errors } = mk();
    const p = (svc as unknown as { prisma: PrismaStub }).prisma;
    p.sterilePackage.findMany.mockRejectedValue(new Error('DB down'));

    await svc.expireOverdue();

    expect(errors.length, '실패했는데 로그가 없으면 아무도 모른다').toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('조회실패');
  });

  it('🔴 패키지 조회가 실패해도 기구 세트 만료는 계속 시도한다(한쪽 실패가 전체를 멈추지 않는다)', async () => {
    const { svc } = mk();
    const p = (svc as unknown as { prisma: PrismaStub }).prisma;
    p.sterilePackage.findMany.mockRejectedValue(new Error('DB down'));

    const r = await svc.expireOverdue();

    expect(p.instrumentSet.updateMany).toHaveBeenCalledTimes(1);
    expect(r.sets).toBe(3);
  });

  it('🔴 건별 만료 처리 실패는 세어지고, 상태를 못 바꾼 건에는 "만료" 이벤트를 적지 않는다', async () => {
    const { svc } = mk();
    const p = (svc as unknown as { prisma: PrismaStub }).prisma;
    p.sterilePackage.update.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'p2') throw new Error('row locked');
      return {};
    });

    const r = await svc.expireOverdue();

    expect(r.packagesFound).toBe(2);
    expect(r.packagesExpired).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toContain('p2');
    // 일어나지 않은 일(만료)을 원장에 적지 않는다 — p1 것 하나만
    expect(p.packageEvent.create).toHaveBeenCalledTimes(1);
  });

  it('기구 세트 처리 실패는 0 이 아니라 null 로 말한다', async () => {
    const { svc } = mk();
    const p = (svc as unknown as { prisma: PrismaStub }).prisma;
    p.instrumentSet.updateMany.mockRejectedValue(new Error('deadlock'));

    const r = await svc.expireOverdue();

    expect(r.sets, '"0건 만료"와 "처리 못 했다"는 다른 사실이다').toBeNull();
    expect(r.ok).toBe(false);
  });

  it('만료 대상이 0건이어도 요약 로그는 남는다 — "돌았는데 0건"과 "안 돌았다"를 구분한다', async () => {
    const { svc, logs, errors } = mk();
    const p = (svc as unknown as { prisma: PrismaStub }).prisma;
    p.sterilePackage.findMany.mockResolvedValue([]);
    p.instrumentSet.updateMany.mockResolvedValue({ count: 0 });

    const r = await svc.expireOverdue();

    expect(r).toEqual({ ok: true, packagesFound: 0, packagesExpired: 0, sets: 0, failures: [] });
    expect(logs.length, '0건일 때 로그가 없으면 크론이 죽어도 알 수 없다').toBe(1);
    expect(errors.length).toBe(0);
  });

  it('대조군 — 전부 성공하면 ok=true·failures=[]·error 로그 0 (무조건 실패라 말하지 않는다)', async () => {
    const { svc, errors, logs } = mk();

    const r = await svc.expireOverdue();

    expect(r).toEqual({ ok: true, packagesFound: 2, packagesExpired: 2, sets: 3, failures: [] });
    expect(errors).toEqual([]);
    expect(logs[0]).toContain('2/2');
  });
});
