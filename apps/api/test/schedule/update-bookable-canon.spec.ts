/**
 * 🔴 (2026-09-14) 직원 예약 변경(`ScheduleService.update` — CRM 대행 변경도 이 경로)이 충돌만 보고
 * 휴진·진료 세션·정원(validateBookable)을 건너뛰었고, 충돌 검사가 의사 락 밖이라 경합 시 이중 예약이 가능했다.
 * 지키는 것: ① 휴진 날로 옮기면 거부하고 쓰지 않는다 ② 세션 밖이면 막지 않고 응답 warnings 로 말한다
 *           ③ 충돌 검사와 변경이 같은 의사 락 트랜잭션 안(락 → 충돌 조회 → update 순서)
 *           ④ 대조군 — 시각·길이를 안 바꾸는 수정(메모)은 슬롯 검증·락을 타지 않는다
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

const AM = { period: 'AM', startTime: '09:00', endTime: '12:30', maxPatients: 99 };

function make(opts: { schedules?: unknown[]; closures?: unknown[] } = {}) {
  const order: string[] = [];
  const existing = { id: 'a1', status: 'SCHEDULED', doctorId: 'd1', duration: 30, scheduledAt: new Date('2026-09-16T10:00:00+09:00') };
  const prisma: any = {
    appointment: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
      findMany: vi.fn(async () => { order.push('conflict'); return []; }),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(async (a: any) => { order.push('update'); return { id: 'a1', ...a.data }; }),
    },
    clinicSchedule: { findMany: vi.fn().mockResolvedValue(opts.schedules ?? [AM]) },
    clinicClosure: { findMany: vi.fn().mockResolvedValue(opts.closures ?? []) },
    $executeRaw: vi.fn(async () => { order.push('lock'); }),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (fn: any) => { order.push('tx'); return fn(prisma); }),
  };
  const s = new ScheduleService(prisma);
  (s as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  return { s, prisma, order };
}

describe('ScheduleService.update — 예약 가능성·락 정본', () => {
  it('① 종일 휴진 날로 옮기면 400 이고 쓰지 않는다', async () => {
    const { s, prisma } = make({ closures: [{ id: 'c', period: null }] });
    await expect(s.update('a1', { scheduledAt: '2026-09-17T10:00:00+09:00' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('② 진료 시간표 밖이면 막지 않고 warnings 로 말한다', async () => {
    const { s } = make();
    const r = await s.update('a1', { scheduledAt: '2026-09-17T15:00:00+09:00' }, 'u');
    expect(r.appointment.id).toBe('a1');
    expect(r.warnings.some((w) => w.includes('진료 시간표에 없는'))).toBe(true);
  });

  it('③ 락 → 충돌 조회 → 변경 순서로 한 트랜잭션 안', async () => {
    const { s, order } = make();
    await s.update('a1', { scheduledAt: '2026-09-17T10:00:00+09:00' }, 'u');
    expect(order).toEqual(['tx', 'lock', 'conflict', 'update']);
  });

  it('③-b 길이만 늘려도 같은 검증을 탄다', async () => {
    const { s, order, prisma } = make();
    await s.update('a1', { duration: 60 }, 'u');
    expect(order).toEqual(['tx', 'lock', 'conflict', 'update']);
    expect(prisma.clinicSchedule.findMany).toHaveBeenCalled();
  });

  it('④ 대조군 — 메모만 바꾸면 슬롯 검증·락 없음·warnings 빈 배열', async () => {
    const { s, prisma, order } = make({ closures: [{ id: 'c', period: null }] });
    const r = await s.update('a1', { notes: '보호자 동반' }, 'u');
    expect(r.warnings).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.clinicClosure.findMany).not.toHaveBeenCalled();
    expect(order).toEqual(['update']);
  });
});
