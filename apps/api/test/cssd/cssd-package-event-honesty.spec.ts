/**
 * 🔴 (2026-09-14) CSSD 패키지 이벤트 원장 기록 실패가 `.catch(() => null)` 로 삼켜졌다 — 멸균 합격·로드 회수의 근거 원장이 조용히 빈다.
 * 지키는 것: ① 기록 실패는 warn·false ② 로드 회수 응답이 기록 못 한 건수를 싣는다(상태 변경은 이미 커밋 — 던지지 않음)
 *           ③ 대조군 — 전건 기록되면 0
 */
import { describe, expect, it, vi } from 'vitest';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';

function mk(eventCreate: (args: any) => Promise<any>) {
  const prisma: any = {
    packageEvent: { create: vi.fn(eventCreate) },
    sterilizationLoad: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'load-1', loadNo: 'L-001', biResult: 'PENDING', ciResult: 'PENDING',
        packages: [
          { id: 'p1', lotNo: 'LOT-1', status: 'IN_LOAD', usedEncounterId: null, template: { shelfLifeDays: 30 } },
          { id: 'p2', lotNo: 'LOT-2', status: 'IN_LOAD', usedEncounterId: null, template: { shelfLifeDays: 30 } },
        ],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    sterilePackage: { update: vi.fn().mockResolvedValue({}) },
    encounter: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const svc = new CssdPackageService(prisma, {} as any, { emit: vi.fn() } as any);
  const warn = vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  return { svc, prisma, warn };
}

describe('CSSD 패키지 이벤트 원장 — 기록 실패를 숨기지 않는다', () => {
  it('① event() 실패는 warn 하고 false', async () => {
    const { svc, warn } = mk(async () => { throw new Error('DB down'); });
    await expect((svc as any).event('p1', '리콜', 'u1')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('p1');
  });

  it('② 로드 회수 응답이 원장 미기록 건수를 싣는다(회수는 반영됨)', async () => {
    const { svc, prisma } = mk(async ({ data }: any) => { if (data.packageId === 'p2') throw new Error('DB down'); return {}; });
    const r: any = await svc.recallLoad('load-1', 'u1');
    expect(r.recalled).toBe(2);
    expect(r.eventsNotRecorded).toBe(1);
    expect(prisma.sterilePackage.update).toHaveBeenCalledTimes(2);
  });

  it('③ 대조군 — 전건 기록되면 0', async () => {
    const { svc, warn } = mk(async () => ({}));
    const r: any = await svc.recallLoad('load-1', 'u1');
    expect(r.eventsNotRecorded).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
