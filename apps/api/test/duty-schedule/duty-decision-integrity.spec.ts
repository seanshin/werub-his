import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DutyScheduleService } from '../../src/modules/duty-schedule/duty-schedule.service';

/**
 * 당직 결정·재편성 무결성(2026-09-15 N3).
 * 🔴 ① 교대·휴가 승인이 상태를 보지 않아 거절된 요청을 다시 승인할 수 있었다 — 교대는 **근무가 또 교환**됐다.
 * 🔴 ② 관리 화면 자동 편성은 '전체'를 `''` 로 보낸다. 직원 풀은 `''` 을 전체로, 삭제는 `department:''` 로 걸러
 *    기존 배정을 하나도 못 지웠다 → 재편성마다 같은 달 배정이 한 벌씩 쌓였다.
 * 목은 조건부 갱신(`where status=PENDING`)을 **실제로 평가**한다 — 무조건 count 1 을 주면 가드가 헛돈다.
 */
const ID = '11111111-1111-4111-8111-111111111111';

function mkPrisma(initial: string) {
  const rows: Record<string, any> = {
    swap: { id: ID, status: initial, requesterId: 'u-a', targetId: 'u-b', originalDate: '2026-06-01', originalShift: 'DAY', swapDate: '2026-06-02', swapShift: 'NIGHT' },
    leave: { id: ID, status: initial },
  };
  const cond = (row: any) => vi.fn(async ({ where, data }: any) => {
    const ok = where.id === row.id && (where.status === undefined || where.status === row.status);
    if (ok) Object.assign(row, data);
    return { count: ok ? 1 : 0 };
  });
  const entries = [
    { id: 'e1', date: new Date('2026-06-01T00:00:00Z'), shift: 'DAY', staffId: 'u-a', staffName: 'A', role: 'nurse', department: '내과' },
    { id: 'e2', date: new Date('2026-06-02T00:00:00Z'), shift: 'NIGHT', staffId: 'u-b', staffName: 'B', role: 'nurse', department: '내과' },
  ];
  const p: any = {
    rows, entries,
    dutySwapRequest: {
      findUnique: vi.fn(async () => ({ ...rows.swap })),
      update: vi.fn(async ({ data }: any) => Object.assign(rows.swap, data)),
      updateMany: cond(rows.swap),
    },
    dutyLeaveRequest: {
      findUnique: vi.fn(async () => ({ ...rows.leave })),
      update: vi.fn(async ({ data }: any) => Object.assign(rows.leave, data)),
      updateMany: cond(rows.leave),
    },
    dutyEntry: {
      findFirst: vi.fn(async ({ where }: any) => entries.find((e) => e.staffId === where.staffId && e.shift === where.shift) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(entries.find((e) => e.id === where.id)!, data)),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async ({ data }: any) => ({ count: data.length })),
    },
    user: {
      findMany: vi.fn(async ({ where }: any = {}) => [
        { id: 'u-a', familyName: '김', givenName: 'A', role: 'NURSE', department: '내과' },
        { id: 'u-b', familyName: '이', givenName: 'B', role: 'NURSE', department: '외과' },
      ].filter((u) => !where?.department || u.department === where.department)),
    },
    $transaction: vi.fn(async (ops: any) => Promise.all(ops)),
  };
  return p;
}

describe('🔴 교대·휴가 결정은 PENDING 에서만', () => {
  it('대조군 — PENDING 교대 승인은 승인되고 근무가 교환된다', async () => {
    const p = mkPrisma('PENDING');
    const r = await new DutyScheduleService(p).handleSwap(ID, true);
    expect(r.data.status).toBe('APPROVED');
    expect(p.entries[0].staffId).toBe('u-b');
  });

  it('🔴 거절된 교대를 다시 승인하면 409 · 근무는 교환되지 않는다', async () => {
    const p = mkPrisma('REJECTED');
    await expect(new DutyScheduleService(p).handleSwap(ID, true)).rejects.toThrow(ConflictException);
    expect(p.rows.swap.status).toBe('REJECTED');
    expect(p.dutyEntry.update).not.toHaveBeenCalled();
  });

  it('🔴 이미 승인된 교대를 재승인해도 근무가 되돌려지지 않는다(409)', async () => {
    const p = mkPrisma('APPROVED');
    await expect(new DutyScheduleService(p).handleSwap(ID, true)).rejects.toThrow(ConflictException);
    expect(p.dutyEntry.update).not.toHaveBeenCalled();
  });

  it('대조군 — PENDING 휴가 거절은 거절된다', async () => {
    const p = mkPrisma('PENDING');
    const r = await new DutyScheduleService(p).handleLeave(ID, false);
    expect(r.data.status).toBe('REJECTED');
  });

  it('🔴 거절된 휴가를 다시 승인하면 409 · 상태 불변', async () => {
    const p = mkPrisma('REJECTED');
    await expect(new DutyScheduleService(p).handleLeave(ID, true)).rejects.toThrow(ConflictException);
    expect(p.rows.leave.status).toBe('REJECTED');
  });
});

describe("🔴 자동 편성 '전체'는 `''` 이든 '전체'든 같은 범위를 지우고 만든다", () => {
  for (const dept of ['', '전체']) {
    it(`department=${JSON.stringify(dept)} → 삭제·직원 조회에 department 필터가 없다(전 부서 재생성)`, async () => {
      const p = mkPrisma('PENDING');
      await new DutyScheduleService(p).autoGenerate('2026-06', dept, {});
      expect(p.dutyEntry.deleteMany.mock.calls[0][0].where).not.toHaveProperty('department');
      expect(p.user.findMany.mock.calls[0][0].where).not.toHaveProperty('department');
    });
  }

  it('대조군 — 특정 부서는 그 부서만 지운다', async () => {
    const p = mkPrisma('PENDING');
    await new DutyScheduleService(p).autoGenerate('2026-06', '내과', {});
    expect(p.dutyEntry.deleteMany.mock.calls[0][0].where.department).toBe('내과');
  });
});
