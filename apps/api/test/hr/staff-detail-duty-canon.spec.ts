/**
 * 🔴 (2026-09-14 P3) 직원 상세·내 인사기록의 `schedules` 가 쓰기가 끊긴 옛 StaffSchedule 을 include 해 낡은 근무표를 보였다.
 * 지키는 것: ① 상세의 schedules 는 DutyEntry(+승인 휴가 OFF)에서 조립된다 ② 옛 관계 include 를 요청하지 않는다
 *           ③ 최근 30건·날짜 내림차순 ④ 계정 없는 직원은 빈 목록(지어내지 않음) ⑤ 변경 메서드는 존재 확인만(근무표 조회 없음)
 */
import { describe, expect, it, vi } from 'vitest';
import { HrService } from '../../src/modules/hr/hr.service';

const STAFF = { id: 's1', userId: 'u1', familyName: '김', givenName: '간호', position: null, department: '내과' };

function make(opts: { staff?: typeof STAFF | null; duty?: unknown[]; leaves?: unknown[] } = {}) {
  const prisma = {
    staff: {
      findUnique: vi.fn().mockResolvedValue(opts.staff === undefined ? STAFF : opts.staff),
      update: vi.fn().mockResolvedValue(STAFF),
    },
    dutyEntry: { findMany: vi.fn().mockResolvedValue(opts.duty ?? []) },
    leaveRequest: { findMany: vi.fn().mockResolvedValue(opts.leaves ?? []) },
  };
  const svc = Object.create(HrService.prototype) as HrService;
  (svc as any).prisma = prisma;
  (svc as any).emitStaff = vi.fn();
  return { svc, prisma };
}

const duty = (day: number) => ({ id: `d${day}`, staffId: 'u1', date: new Date(Date.UTC(2026, 8, day)), shift: 'DAY', startTime: '07:00', endTime: '15:00', notes: null, createdAt: new Date() });

describe('직원 상세 근무표 — DutyEntry 정본', () => {
  it('① DutyEntry 에서 조립 · ② 옛 include 없음', async () => {
    const { svc, prisma } = make({ duty: [duty(1), duty(3)] });
    const r: any = await svc.findById('s1');
    expect(prisma.dutyEntry.findMany).toHaveBeenCalled();
    expect(prisma.staff.findUnique.mock.calls[0][0].include).toBeUndefined();
    expect(r.schedules.map((x: any) => x.id)).toEqual(['d3', 'd1']);
    expect(r.schedules[0]).toMatchObject({ staffId: 's1', shiftType: 'DAY' });
    expect(r.schedules[0].staff).toBeUndefined();
  });

  it('③ 최근 30건만', async () => {
    const { svc } = make({ duty: Array.from({ length: 35 }, (_, i) => duty(i + 1)) });
    const r: any = await svc.findByUserId('u1');
    expect(r.schedules).toHaveLength(30);
  });

  it('④ 계정 없는 직원은 빈 목록', async () => {
    const { svc, prisma } = make({ staff: { ...STAFF, userId: null } as any });
    const r: any = await svc.findById('s1');
    expect(r.schedules).toEqual([]);
    expect(prisma.dutyEntry.findMany).not.toHaveBeenCalled();
  });

  it('⑤ 변경 메서드는 존재 확인만', async () => {
    const { svc, prisma } = make();
    await svc.resign('s1');
    expect(prisma.dutyEntry.findMany).not.toHaveBeenCalled();
  });
});
