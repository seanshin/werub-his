/**
 * 포털 B1 남은 몫 — 예약 진료실까지 길안내(접수 전 · 2026-10-26).
 *  · 🔴 진료표 칸 정본 하나(scheduleSlotOf) — 접수·의사 변경 재계산·예약 길안내가 같은 규칙(13시 경계·종일 ALL)
 *  · 🔴 예약 원장의 진료실 칸은 운영에서 늘 비어 있다 → 진료표 기준 "예정" 진료실(basis CLINIC_SCHEDULE) · 진료표에 없으면 null(지어내지 않음)
 *  · 접수 뒤엔 대기표 길안내 id 만(경로를 두 번 계산하지 않는다)
 *  · 접수 창구는 RECEPTION 전부 — 하나를 고르지 않는다
 *  · 지난·끝난 예약 404 · 남의 예약 404 · 출입구 형식 400 · 보호자 범위 = 예약 구역
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';
import { scheduleSlotOf, scheduleWhereAt } from '../../src/modules/waiting-queue/schedule-slot';
import { guardianSectionOf } from '../../src/modules/portal/guardian-scope';

const SRC = join(__dirname, '../../src/modules');
const at = (h: number, m = 0, dayOffset = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };

describe('진료표 칸 정본', () => {
  it('13시 경계 — 12:59 오전 · 13:00 오후 · 요일은 그 시각의 요일', () => {
    const d = at(12, 59);
    expect(scheduleSlotOf(d)).toEqual({ dayOfWeek: d.getDay(), period: 'AM' });
    expect(scheduleSlotOf(at(13, 0)).period).toBe('PM');
    expect(scheduleWhereAt('doc1', at(9))).toEqual({ doctorId: 'doc1', dayOfWeek: at(9).getDay(), OR: [{ period: 'AM' }, { period: 'ALL' }], isActive: true });
  });
  it('🔴 접수·재계산이 정본을 쓴다 — 서비스에 13시 규칙을 따로 적지 않는다(구조)', () => {
    const s = readFileSync(join(SRC, 'waiting-queue/waiting-queue.service.ts'), 'utf8');
    expect(s).not.toMatch(/getHours\(\)\s*<\s*13/);
    expect(s.match(/clinicSchedule\.findFirst\(\{ where: scheduleWhereAt\(/g)?.length).toBe(3); // 접수·재계산·예약 길안내
  });
});

function wq(opts: { schedule?: { roomName: string } | null; clinicRoom?: { spaceNodeId: string | null } | null; space?: boolean; routeOut?: object } = {}) {
  const prisma: any = {
    clinicSchedule: { findFirst: vi.fn(async () => opts.schedule ?? null) },
    clinicRoom: { findUnique: vi.fn(async () => opts.clinicRoom ?? null) },
  };
  const spaceModel: any = opts.space === false ? undefined : {
    entrances: vi.fn(async () => [{ id: 'E1', name: '정문', floor: '1F', main: true }]),
    route: vi.fn(async () => opts.routeOut ?? { available: true, walkM: 40, steps: [], segments: [{ floor: '2F', points: [] }] }),
    floorsForRoute: vi.fn(async () => []),
  };
  return { svc: new WaitingQueueService(prisma, { emit: vi.fn() } as never, undefined, undefined, undefined, spaceModel), prisma, spaceModel };
}

describe('진료실까지 길안내 — 대기표·예약 공용', () => {
  it('진료표에 없으면 null · 있으면 그 진료실(반나절·종일 조건으로 찾는다)', async () => {
    const none = wq();
    expect(await none.svc.resolveScheduledRoom('doc1', at(10))).toBeNull();
    const some = wq({ schedule: { roomName: '내과 1진료실' } });
    expect(await some.svc.resolveScheduledRoom('doc1', at(15))).toBe('내과 1진료실');
    expect(some.prisma.clinicSchedule.findFirst.mock.calls[0][0].where).toMatchObject({ doctorId: 'doc1', OR: [{ period: 'PM' }, { period: 'ALL' }], isActive: true });
  });
  it('진료실 없음·공간 미연결·도면 없음은 이유로 · 통제 구역 제외로 계산', async () => {
    expect(await wq().svc.routeToRoom(null, undefined, false)).toMatchObject({ available: false, reason: 'ROOM_NOT_ASSIGNED' });
    expect(await wq({ clinicRoom: { spaceNodeId: null } }).svc.routeToRoom('외과 2진료실', undefined, false)).toMatchObject({ available: false, reason: 'ROOM_NOT_LINKED' });
    expect(await wq({ space: false }).svc.routeToRoom('내과 1진료실', undefined, false)).toMatchObject({ available: false, reason: 'NO_GEOMETRY' });
    const ok = wq({ clinicRoom: { spaceNodeId: 'sn1' } });
    const r: any = await ok.svc.routeToRoom('내과 1진료실', 'E2', true);
    expect(ok.spaceModel.route).toHaveBeenCalledWith({ from: 'entrance:E2', to: 'sn1', accessibleOnly: true, allowRestricted: false });
    expect(r).toMatchObject({ available: true, targetSpaceNodeId: 'sn1' });
  });
});

function portal(opts: { appt?: any; queue?: any; room?: string | null; receptions?: any[] } = {}) {
  const prisma: any = {
    appointment: { findFirst: vi.fn(async () => opts.appt ?? null) },
    waitingQueue: { findFirst: vi.fn(async () => opts.queue ?? null) },
    spaceNode: { findMany: vi.fn(async () => opts.receptions ?? [{ name: '접수/원무', floor: 1 }, { name: '검진 접수', floor: -1 }]) },
  };
  const waitingQueue: any = {
    resolveScheduledRoom: vi.fn(async () => opts.room ?? null),
    routeToRoom: vi.fn(async (room: string | null) => (room ? { available: true, walkM: 40 } : { available: false, reason: 'ROOM_NOT_ASSIGNED', entrances: [] })),
  };
  const svc = new PortalService(prisma, { get: vi.fn() } as never, { get: vi.fn() } as never, {} as never, waitingQueue, {} as never, {} as never, {} as never);
  return { svc, prisma, waitingQueue };
}
const APPT = { id: 'a1', doctorId: 'doc1', scheduledAt: at(14, 30), departmentName: '내과', status: 'CONFIRMED' };

describe('🔴 포털 예약 길안내(접수 전)', () => {
  it('진료표 기준 예정 진료실 · 같은 시각으로 찾는다 · 출발 출입구·엘리베이터 그대로 · 접수 창구는 전부(고르지 않음)', async () => {
    const m = portal({ appt: APPT, room: '내과 1진료실' });
    const r: any = await m.svc.getAppointmentRoute('p1', 'a1', 'E2', true);
    expect(m.waitingQueue.resolveScheduledRoom).toHaveBeenCalledWith('doc1', APPT.scheduledAt);
    expect(m.waitingQueue.routeToRoom).toHaveBeenCalledWith('내과 1진료실', 'E2', true);
    expect(r).toMatchObject({ checkedIn: false, room: { name: '내과 1진료실', basis: 'CLINIC_SCHEDULE' }, route: { available: true } });
    expect(r.receptions).toEqual([{ name: '접수/원무', floor: 1 }, { name: '검진 접수', floor: -1 }]);
    expect(m.prisma.spaceNode.findMany.mock.calls[0][0].where).toEqual({ spaceType: 'RECEPTION', isActive: true });
  });
  it('🔴 진료표에 없으면 진료실 null — 지어내지 않고 이유', async () => {
    const r: any = await portal({ appt: APPT, room: null }).svc.getAppointmentRoute('p1', 'a1', undefined, false);
    expect(r.room).toBeNull();
    expect(r.route).toMatchObject({ available: false, reason: 'ROOM_NOT_ASSIGNED' });
  });
  it('접수 뒤 = 대기표 길안내 id 만 · 경로를 계산하지 않는다', async () => {
    const m = portal({ appt: { ...APPT, status: 'CHECKED_IN' }, queue: { id: 'q9' }, room: '내과 1진료실' });
    expect(await m.svc.getAppointmentRoute('p1', 'a1', undefined, false)).toEqual({ appointmentId: 'a1', checkedIn: true, queueId: 'q9' });
    expect(m.waitingQueue.routeToRoom).not.toHaveBeenCalled();
    expect(m.prisma.waitingQueue.findFirst.mock.calls[0][0].where).toMatchObject({ appointmentId: 'a1' });
  });
  it('없는·남의·끝난 예약 404 · 지난 예약 404 · 대조군 오늘 아침 예약은 된다', async () => {
    const st = async (p: Promise<unknown>) => (await p.catch((e) => e))?.getStatus?.();
    const none = portal();
    expect(await st(none.svc.getAppointmentRoute('p1', 'a1', undefined, false))).toBe(404);
    expect(none.prisma.appointment.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'a1', patientId: 'p1', status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] } });
    expect(await st(portal({ appt: { ...APPT, scheduledAt: at(10, 0, -1) } }).svc.getAppointmentRoute('p1', 'a1', undefined, false))).toBe(404);
    const morning: any = await portal({ appt: { ...APPT, scheduledAt: at(0, 30) }, room: '내과 1진료실' }).svc.getAppointmentRoute('p1', 'a1', undefined, false);
    expect(morning.checkedIn).toBe(false);
  });
});

describe('컨트롤러·보호자 범위(구조)', () => {
  it('출입구는 origin(형식 검사) · 서비스로 넘김', () => {
    const s = readFileSync(join(SRC, 'portal/portal.controller.ts'), 'utf8');
    const body = s.slice(s.indexOf("@Get('appointments/:appointmentId/route')"), s.indexOf("@Get('appointments/:appointmentId/route')") + 1200);
    expect(body).toMatch(/@Query\('origin'\) origin/);
    expect(body).toMatch(/\/\^\[A-Za-z0-9-\]\{1,40\}\$\/\.test\(origin\)/);
    expect(body).toMatch(/getAppointmentRoute\(req\.portalPatientId, appointmentId/);
  });
  it('보호자 세션은 예약 구역으로 판정(돈 정보 아님)', () => {
    expect(guardianSectionOf('/api/v1/portal/appointments/a1/route')).toBe('appointments');
  });
});
