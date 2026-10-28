import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DutyScheduleService } from '../../src/modules/duty-schedule/duty-schedule.service';

// P1 근무 규칙(전이·연속야간·근무간휴식) 사전차단 — config duty.constraint.enforce
describe('DutyScheduleService P1 근무 규칙', () => {
  let service: DutyScheduleService;
  let prisma: any;
  let cfg: { get: any };

  beforeEach(() => {
    cfg = { get: vi.fn(async (k: string) => (k === 'duty.maxConsecutiveDays' ? 6 : 'BLOCK')) };
    prisma = {
      user: { findMany: vi.fn(async () => [{ id: 'u-1', familyName: '김', givenName: '간호', role: 'NURSE', department: '내과' }]) },
      dutyEntry: {
        findMany: vi.fn(async () => []), // 인접일 배정
        findFirst: vi.fn(async () => null), // 중복·연속야간
        create: vi.fn(async ({ data }: any) => ({ id: 'de-1', ...data })),
      },
    };
    // 🔴 정본은 교대 요청과 결재선을 한 트랜잭션에서 만든다(K1) — 목도 같은 모양이라야 콜백이 실제로 돈다
    prisma.$transaction = vi.fn(async (cb: any) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb)));
    service = new DutyScheduleService(prisma, cfg as any);
  });

  // 전일 야간(N) → 당일 주간(D) 배정
  const prevNight = () => { prisma.dutyEntry.findMany = vi.fn(async () => [{ date: new Date('2026-07-02T00:00:00Z'), shift: 'NIGHT' }]); };
  const assignDay = () => service.assign({ date: '2026-07-03', shift: 'DAY' as any, staffId: 'u-1' });

  it('BLOCK — 전일 야간 후 당일 주간 배정 차단', async () => {
    prevNight();
    const r = await assignDay();
    expect((r as any).error).toMatch(/근무 규칙 위반/);
    expect(prisma.dutyEntry.create).not.toHaveBeenCalled();
  });

  it('WARN — 위반이어도 배정하되 경고 동반', async () => {
    cfg.get = vi.fn(async (k: string) => (k === 'duty.maxConsecutiveDays' ? 6 : 'WARN'));
    prevNight();
    const r = await assignDay();
    expect((r as any).warnings?.length).toBeGreaterThan(0);
    expect((r as any).data).toBeDefined();
    expect(prisma.dutyEntry.create).toHaveBeenCalled();
  });

  it('OFF — 무검증 통과(경고 없음)', async () => {
    cfg.get = vi.fn(async (k: string) => (k === 'duty.maxConsecutiveDays' ? 6 : 'OFF'));
    prevNight();
    const r = await assignDay();
    expect((r as any).data).toBeDefined();
    expect((r as any).warnings).toBeUndefined();
  });

  it('BLOCK — 규칙 위반 없으면(전날 배정 없음) 정상 배정', async () => {
    const r = await assignDay();
    expect((r as any).data).toBeDefined();
    expect(prisma.dutyEntry.create).toHaveBeenCalled();
  });

  it('BLOCK — 연속 야간 상한(3) 초과 차단', async () => {
    // 야간 배정 시도(당일 05), 직전일(04·03·02) 연속 NIGHT 존재. existing(당일)은 없음.
    prisma.dutyEntry.findMany = vi.fn(async () => []); // 인접일 D/E 없음
    const target = new Date('2026-07-05T00:00:00Z').getTime();
    prisma.dutyEntry.findFirst = vi.fn(async ({ where }: any) => {
      if (where.shift === 'NIGHT' && where.date && where.date.getTime() < target) return { id: 'n' }; // 직전일 연속 NIGHT
      return null; // 당일 existing 없음
    });
    const r = await service.assign({ date: '2026-07-05', shift: 'NIGHT' as any, staffId: 'u-1' });
    expect((r as any).error).toMatch(/연속 야간|규칙 위반/);
  });

  it('BLOCK — 연속 근무일 상한(6) 초과 차단(P1b)', async () => {
    prisma.dutyEntry.findMany = vi.fn(async () => []); // 인접 전이 위반 없음
    const target = new Date('2026-07-10T00:00:00Z').getTime();
    prisma.dutyEntry.findFirst = vi.fn(async ({ where }: any) => {
      // 연속야간(shift=NIGHT) 없음, 연속근무(shift 미지정·직전일) 있음
      if (!where.shift && where.date && where.date.getTime() < target) return { id: 'w' };
      return null;
    });
    const r = await service.assign({ date: '2026-07-10', shift: 'DAY' as any, staffId: 'u-1' });
    expect((r as any).error).toMatch(/연속 근무|규칙 위반/);
  });

  // P2 on-call·교대 전자결재
  it('on-call 배정 — upsert(과별·call level)', async () => {
    prisma.onCallSchedule = { upsert: vi.fn(async ({ create }: any) => ({ id: 'oc-1', ...create })), findMany: vi.fn(async () => []), delete: vi.fn() };
    const r = await service.assignOnCall({ date: '2026-07-10', department: '내과', callLevel: 'FIRST', staffId: 'u-1' });
    expect((r as any).data).toBeDefined();
    expect(prisma.onCallSchedule.upsert).toHaveBeenCalled();
  });

  it('교대 요청 — eApproval ON 시 HR_DUTY_SWAP 전자결재 상신', async () => {
    cfg.get = vi.fn(async (k: string) => (k === 'duty.swap.eApproval' ? 'true' : k === 'duty.maxConsecutiveDays' ? 6 : 'OFF'));
    prisma.dutySwapRequest = { create: vi.fn(async ({ data }: any) => ({ id: 'sw-1', ...data })) };
    prisma.staff = { findUnique: vi.fn(async () => ({ id: 'staff-t' })) };
    prisma.eApprovalRelay = { create: vi.fn(async () => ({ id: 'relay-1', refId: 'sw-1' })) };
    prisma.notification = { create: vi.fn(async () => ({})) };
    const r = await service.requestSwap({ requesterId: 'u-1', targetId: 'u-2', originalDate: '2026-07-10', originalShift: 'DAY', swapDate: '2026-07-11', swapShift: 'NIGHT', reason: 't' });
    expect(prisma.eApprovalRelay.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ docType: 'HR_DUTY_SWAP' }) }));
    expect((r as any).relayId).toBe('relay-1');
  });

  it('교대 요청 — eApproval OFF면 기존 자체 등록(relay 없음)', async () => {
    cfg.get = vi.fn(async () => 'OFF');
    prisma.dutySwapRequest = { create: vi.fn(async ({ data }: any) => ({ id: 'sw-1', ...data })) };
    prisma.eApprovalRelay = { create: vi.fn() };
    const r = await service.requestSwap({ requesterId: 'u-1', targetId: 'u-2', originalDate: '2026-07-10', originalShift: 'DAY', swapDate: '2026-07-11', swapShift: 'NIGHT', reason: 't' });
    expect(prisma.eApprovalRelay.create).not.toHaveBeenCalled();
    expect((r as any).relayId).toBeUndefined();
  });
});
