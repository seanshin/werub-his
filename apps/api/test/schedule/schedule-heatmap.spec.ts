/**
 * 시간대 혼잡 히트맵(기획 schedule-timegrid-and-scale P2 · `GET /appointments/heatmap`).
 * 지키는 것:
 *  ① 분모 = 휴진을 뺀 시간표 슬롯 · 분자 = 그 시에 시작하는 예약(취소·노쇼 제외 — 조회 조건)
 *  ② 휴진 칸 CLOSED·시간표 없는 칸 NO_SCHEDULE·확인 필요 칸 NEEDS_REVIEW 는 분모 null(0% 가 아니다)
 *  ③ 시간표 밖 예약은 숨기지 않고 센다
 *  ④ KST 자정 경계 — 조회 구간 [date 00:00+09:00, 다음날 00:00+09:00) · 휴진 @db.Date 는 dateOnlyValue
 *  ⑤ 쿼리 수 고정(N+1 없음) — 의사 30명이어도 시간표 1·예약 1·휴진 1
 */
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { buildHourHeatmap } from '../../src/modules/schedule/schedule-heatmap';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

const D = '2026-09-15';
const at = (hm: string) => new Date(`${D}T${hm}:00+09:00`);
const cellOf = (r: ReturnType<typeof buildHourHeatmap>, hour: number) => r.cells.find((c) => c.hour === hour);

describe('buildHourHeatmap — 순수 판정', () => {
  it('① 분모는 시간표 슬롯(30분), 분자는 그 시에 시작하는 예약', () => {
    const r = buildHourHeatmap({
      date: D,
      schedules: [{ doctorId: 'd1', period: 'AM', startTime: '09:00', endTime: '11:00' }],
      closures: [],
      appointments: [{ doctorId: 'd1', scheduledAt: at('09:00') }, { doctorId: 'd1', scheduledAt: at('09:30') }, { doctorId: 'd1', scheduledAt: at('10:00') }],
    });
    expect(cellOf(r, 9)).toMatchObject({ state: 'SCHEDULED', booked: 2, capacity: 2 });
    expect(cellOf(r, 10)).toMatchObject({ state: 'SCHEDULED', booked: 1, capacity: 2 });
    expect(r.totals).toEqual({ booked: 3, capacity: 4, bookedOutsideSchedule: 0 });
  });

  it('② 휴진 칸은 CLOSED·분모 null — 같은 의사 오후 세션은 그대로', () => {
    const r = buildHourHeatmap({
      date: D,
      schedules: [
        { doctorId: 'd1', period: 'AM', startTime: '09:00', endTime: '10:00' },
        { doctorId: 'd1', period: 'PM', startTime: '14:00', endTime: '15:00' },
      ],
      closures: [{ id: 'c1', doctorId: 'd1', period: 'AM' }],
      appointments: [],
    });
    expect(cellOf(r, 9)).toMatchObject({ state: 'CLOSED', capacity: null, closedSlots: 2 });
    expect(cellOf(r, 14)).toMatchObject({ state: 'SCHEDULED', capacity: 2, booked: 0 });
  });

  it('② 다른 의사가 같은 시에 진료하면 휴진 의사 슬롯만 빠진다', () => {
    const r = buildHourHeatmap({
      date: D,
      schedules: [
        { doctorId: 'd1', period: 'AM', startTime: '09:00', endTime: '10:00' },
        { doctorId: 'd2', period: 'AM', startTime: '09:00', endTime: '10:00' },
      ],
      closures: [{ id: 'c1', doctorId: 'd1', period: 'ALL' }],
      appointments: [],
    });
    expect(cellOf(r, 9)).toMatchObject({ state: 'SCHEDULED', capacity: 2, closedSlots: 2 });
  });

  it('② 종일 세션 + 반일 휴진은 NEEDS_REVIEW — 분모에 넣지도 빼지도 않고 따로 센다', () => {
    const r = buildHourHeatmap({
      date: D,
      schedules: [{ doctorId: 'd1', period: 'ALL', startTime: '09:00', endTime: '10:00' }],
      closures: [{ id: 'c1', doctorId: 'd1', period: 'AM' }],
      appointments: [],
    });
    expect(cellOf(r, 9)).toMatchObject({ state: 'NEEDS_REVIEW', capacity: null, reviewSlots: 2 });
  });

  it('③ 시간표 없는 시의 예약은 NO_SCHEDULE 로 보이고 합계에 따로 잡힌다(분모 0 을 비율로 만들지 않는다)', () => {
    const r = buildHourHeatmap({ date: D, schedules: [], closures: [], appointments: [{ doctorId: 'd9', scheduledAt: at('14:10') }] });
    expect(cellOf(r, 14)).toMatchObject({ state: 'NO_SCHEDULE', booked: 1, capacity: null });
    expect(r.totals).toEqual({ booked: 1, capacity: 0, bookedOutsideSchedule: 1 });
  });

  it('④ KST 자정 경계 — UTC 15:00(=KST 00:00) 예약은 0시 칸', () => {
    const r = buildHourHeatmap({ date: D, schedules: [], closures: [], appointments: [{ doctorId: 'd1', scheduledAt: new Date('2026-09-14T15:00:00Z') }] });
    expect(r.cells.map((c) => c.hour)).toEqual([0]);
  });

  it('대조군 — 아무것도 없으면 칸 0개(0% 칸을 지어내지 않는다)', () => {
    expect(buildHourHeatmap({ date: D, schedules: [], closures: [], appointments: [] }).cells).toEqual([]);
  });
});

describe('ScheduleService.getHourHeatmap — 조회 계약', () => {
  function makeService(nDoctors: number) {
    const schedules = Array.from({ length: nDoctors }, (_, i) => ({ doctorId: `d${i}`, period: 'AM', startTime: '09:00', endTime: '12:00' }));
    const prisma = {
      clinicSchedule: { findMany: vi.fn().mockResolvedValue(schedules) },
      appointment: { findMany: vi.fn().mockResolvedValue([{ doctorId: 'd0', scheduledAt: at('09:00') }]) },
      clinicClosure: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new ScheduleService(prisma as any, {} as any);
    return { svc, prisma };
  }

  it('⑤ 의사 30명이어도 쿼리는 시간표 1·예약 1·휴진 1', async () => {
    const { svc, prisma } = makeService(30);
    const res = await svc.getHourHeatmap({ date: D, departmentName: '내과' });
    expect(prisma.clinicSchedule.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.appointment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.clinicClosure.findMany).toHaveBeenCalledTimes(1);
    expect(res.data.cells.find((c) => c.hour === 9)).toMatchObject({ capacity: 60, booked: 1 });
  });

  it('④ 예약 구간은 KST 하루 [00:00+09:00, 다음날 00:00+09:00) · 취소·노쇼 제외 · 휴진 날짜는 dateOnlyValue', async () => {
    const { svc, prisma } = makeService(1);
    await svc.getHourHeatmap({ date: D });
    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.scheduledAt.gte.toISOString()).toBe('2026-09-14T15:00:00.000Z');
    expect(where.scheduledAt.lt.toISOString()).toBe('2026-09-15T15:00:00.000Z');
    expect(where.status.notIn).toEqual(['CANCELLED', 'NO_SHOW']);
    expect(prisma.clinicClosure.findMany.mock.calls[0][0].where.date.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('잘못된 날짜·by 는 400', async () => {
    const { svc } = makeService(1);
    await expect(svc.getHourHeatmap({ date: '2026-13-40' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getHourHeatmap({ date: D, by: 'doctor' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
