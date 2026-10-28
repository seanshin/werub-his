/**
 * 🔴 CSSD 로드 회수 — 감염위험 여정 이벤트가 **발행되지 못한 건**을 응답이 말한다.
 * 종전: 진료건 조회가 `.catch(() => null)` 이라 이벤트가 발행되지 않아도 `ok:true` + affectedEncounters 에
 *       그 id 가 담겨 **전건 통보된 것처럼** 읽혔다. 회수는 임상 후속조치(감염 징후 모니터링)를 부른다.
 * 재주입: `.catch(() => null)` + notifyFailed 미집계로 되돌리면 첫 케이스가 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';

describe('CSSD 회수 — 여정 이벤트 발행 실패', () => {
  const mk = (encounterImpl: (args: any) => Promise<any>) => {
    const emit = vi.fn();
    const prisma: any = {
      sterilizationLoad: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'load-1', loadNo: 'L-001',
          packages: [
            { id: 'p1', lotNo: 'LOT-1', status: 'USED', usedEncounterId: 'enc-1' },
            { id: 'p2', lotNo: 'LOT-2', status: 'USED', usedEncounterId: 'enc-2' },
          ],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      sterilePackage: { update: vi.fn().mockResolvedValue({}) },
      encounter: { findUnique: vi.fn(encounterImpl) },
      $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))),
    };
    const svc = new CssdPackageService(prisma, {} as any, { emit } as any);
    vi.spyOn(svc as any, 'event').mockResolvedValue(true);
    vi.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    return { svc, prisma, emit };
  };

  it('🔴 한 건의 진료건 조회가 실패하면 journeyNotifyFailed 에 담기고 journeyNotified 는 1', async () => {
    const { svc, emit } = mk(async ({ where }: any) =>
      where.id === 'enc-1' ? { patientId: 'pat-1' } : Promise.reject(new Error('DB down')));
    const r: any = await svc.recallLoad('load-1', 'u1', '지연양성');
    expect(r.affectedEncounters).toEqual(['enc-1', 'enc-2']);
    expect(r.journeyNotifyFailed).toEqual(['enc-2']);
    expect(r.journeyNotified).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('전건 성공이면 journeyNotifyFailed 는 비어 있다 — 거짓 경보를 만들지 않는다', async () => {
    const { svc, emit } = mk(async ({ where }: any) => ({ patientId: `pat-${where.id}` }));
    const r: any = await svc.recallLoad('load-1', 'u1');
    expect(r.journeyNotifyFailed).toEqual([]);
    expect(r.journeyNotified).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
