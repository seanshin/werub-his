import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';

/**
 * 🔴 `Promise.all` 안에서 조각이 실패했을 때 포털이 **"정상"으로 말하지 않는지**에 대한 가드(2026-08-21).
 *
 * 두 자리 모두 실운영 화면이 읽는 값이다:
 *  1) 검진 스테이션 대기 조회 실패 → 모든 검사실이 "0명 대기 · 여유(LOW)"로 보였다.
 *     바로 그 위 주석이 "0 으로도, 난수로도 채우지 않는다"라고 적어둔 규칙을 실패 경로가 어겼다.
 *  2) 보호자 긴급열람(BTG) 관리자 통보 `.catch(() => undefined)` → 통보가 한 건도 남지 않아도
 *     화면은 "관리자에게 즉시 통보됩니다"라고 말한 채 토큰을 내줬다(감시 없는 열람).
 */
function svc(prisma: Record<string, unknown>) {
  return new PortalService(
    prisma as never, null as never, null as never, null as never,
    null as never, null as never, null as never,
  ) as unknown as Record<string, (...a: unknown[]) => Promise<any>>;
}

describe('검진 여정 — 대기 조회 실패를 "여유(0명)"로 말하지 않는다', () => {
  const checkup = {
    id: 'ck-1', checkedInAt: new Date(),
    program: { name: '기본검진', category: 'BASIC', duration: 180 },
    items: [
      { testName: '혈액검사', category: 'LAB', finding: 'PENDING', value: null, unit: null, referenceRange: null, completedAt: null },
    ],
  };
  let prisma: any;

  beforeEach(() => {
    prisma = {
      patientJourneyEvent: { findMany: vi.fn().mockResolvedValue([]) },
      checkupStationLog: { groupBy: vi.fn().mockRejectedValue(new Error('DB timeout')), findFirst: vi.fn().mockResolvedValue(null) },
      checkupStation: { findMany: vi.fn().mockResolvedValue([{ stationId: 'ck-blood', avgMinutes: 5 }]) },
    };
  });

  it('대기 집계가 실패하면 waitingCount=null · congestionLevel=UNKNOWN', async () => {
    const res = await svc(prisma).buildCheckupStatus('p-1', null, checkup, new Date(), new Date());
    expect(res.nextRecommended.waitingCount).toBeNull();
    expect(res.nextRecommended.congestionLevel).toBe('UNKNOWN');
    expect(res.nextRecommended.estimatedWaitMinutes).toBeNull();
  });

  it('집계에 성공하고 진짜 0명이면 여유(LOW)로 말한다 — 실패와 0을 뒤섞지 않는다', async () => {
    prisma.checkupStationLog.groupBy.mockResolvedValue([]);
    const res = await svc(prisma).buildCheckupStatus('p-1', null, checkup, new Date(), new Date());
    expect(res.nextRecommended.waitingCount).toBe(0);
    expect(res.nextRecommended.congestionLevel).toBe('LOW');
  });
});

describe('보호자 긴급열람(BTG) — 관리자 통보가 실제로 남았는지 말한다', () => {
  const account = { id: 'acc-1', patientId: 'p-guardian', isActive: true };
  const dependent = {
    id: 'p-dep', mrn: 'P2026-0001', familyName: '김', givenName: '아이',
    dateOfBirth: new Date('2020-01-01'),
    account: { id: 'acc-dep' },
  };

  function prismaWith(notifyRejects: boolean, admins: { id: string }[]) {
    return {
      patientAccount: { findUnique: vi.fn().mockResolvedValue(account) },
      patient: {
        // mrn 조회(피부양자) / id 조회(보호자 이름) 두 쓰임을 인자로 가른다
        findUnique: vi.fn().mockImplementation((args: any) =>
          Promise.resolve(args.where?.mrn ? dependent : { familyName: '김', givenName: '보호' })),
        findFirst: vi.fn().mockResolvedValue(dependent),
      },
      patientGuardian: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'rel-1' }),
        update: vi.fn().mockResolvedValue({ id: 'rel-1' }),
      },
      user: { findMany: vi.fn().mockResolvedValue(admins) },
      notification: {
        create: notifyRejects
          ? vi.fn().mockRejectedValue(new Error('refId 계약 위반(P2023)'))
          : vi.fn().mockResolvedValue({ id: 'n-1' }),
      },
      portalAuditLog: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  const dto = { dependentMrn: 'P2026-0001', reason: '응급실 이송 — 보호자 확인 필요' };

  it('통보가 전부 실패하면 oversight.notifiedAdmins=0 으로 그 사실을 낸다', async () => {
    const prisma = prismaWith(true, [{ id: 'admin-1' }, { id: 'admin-2' }]);
    const res = await svc(prisma).breakTheGlass('acc-1', dto);
    expect(res.token).toBeTruthy();           // 열람 자체는 막지 않는다(막으면 방치된다)
    expect(res.oversight.notifiedAdmins).toBe(0);
    expect(res.oversight.notifyFailed).toBe(2);
  });

  it('관리자가 아예 없어도 0 으로 드러난다', async () => {
    const prisma = prismaWith(false, []);
    const res = await svc(prisma).breakTheGlass('acc-1', dto);
    expect(res.oversight.notifiedAdmins).toBe(0);
    expect(res.oversight.adminCount).toBe(0);
  });

  it('통보가 남으면 그 수를 정확히 센다', async () => {
    const prisma = prismaWith(false, [{ id: 'admin-1' }, { id: 'admin-2' }]);
    const res = await svc(prisma).breakTheGlass('acc-1', dto);
    expect(res.oversight.notifiedAdmins).toBe(2);
    expect(res.oversight.notifyFailed).toBe(0);
  });

  it('감사 원장에도 도달 수를 남긴다(NOTIFY:n/N) — "보냈다"가 아니라 "남았다"', async () => {
    const prisma = prismaWith(true, [{ id: 'admin-1' }]);
    await svc(prisma).breakTheGlass('acc-1', dto);
    const detail = JSON.stringify(prisma.portalAuditLog.create.mock.calls);
    expect(detail).toContain('NOTIFY:0/1');
  });
});
