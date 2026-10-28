/**
 * 🔴 (2026-09-15) 가용 슬롯(`getAvailability`)·일 뷰(`getDayGrid`)가 예약 검증과 다른 휴진 판정을 들고 있었다 —
 *    `c.period === 'ALL' || c.period === s.period` 는 종일(ALL) 세션에 오전 휴진이 걸리면 '휴진 아님'으로 그려
 *    휴진한 오전 슬롯을 환자 셀프 예약에 내놨다.
 * 지키는 것: ① 종일 세션+반일 휴진 → closed=false·closureReview=true(추측해 닫지도 열지도 않음)
 *           ② 대조군: 오전 세션+오전 휴진 → closed · 오후 세션+오전 휴진 → 열림 · 종일 휴진 → closed
 *           ③ 포털은 closureReview 슬롯을 내놓지 않는다 · 직원 조회는 슬롯을 그대로(검증이 경고)
 *           ④ 자동 배정은 closureReview 세션을 고르지 않는다 ⑤ 일 뷰도 같은 판정 ⑥ 옛 비교가 소스에 없다
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';
import { PortalService } from '../../src/modules/portal/portal.service';
import { classifySessionClosure } from '../../src/modules/clinic-schedule/closure-impact';

const DATE = '2099-09-16'; // 미래 — 슬롯이 '지난 시각'으로 닫히지 않게
const doctor = { id: 'd1', familyName: '김', givenName: '의사' };
const sess = (period: string, startTime: string, endTime: string) => ({
  doctorId: 'd1', period, startTime, endTime, maxPatients: 20, departmentName: '내과', roomName: null, doctor,
});

function svc(schedules: unknown[], closures: unknown[]) {
  const prisma = {
    clinicSchedule: { findMany: vi.fn().mockResolvedValue(schedules) },
    clinicClosure: { findMany: vi.fn().mockResolvedValue(closures) },
    appointment: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
  const s = new ScheduleService(prisma as any, { get: vi.fn().mockResolvedValue(undefined) } as any);
  (s as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  return s as any;
}

const avail = async (schedules: unknown[], closures: unknown[]) =>
  (await svc(schedules, closures).getAvailability({ date: DATE, duration: 30 })).data.sessions;

describe('가용 슬롯·일 뷰 — 휴진 판정 정본(classifySessionClosure)', () => {
  it('① 종일 세션 + 오전 휴진 → 휴진 아님으로 그리지 않는다(closureReview)', async () => {
    const [s] = await avail([sess('ALL', '09:00', '17:30')], [{ id: 'c', doctorId: 'd1', period: 'AM' }]);
    expect(s.closed).toBe(false);
    expect(s.closureReview).toBe(true);
    expect(s.slots.some((x: any) => x.available)).toBe(true); // 직원 조회는 슬롯 유지(검증이 경고)
  });

  it('② 대조군 — 오전 세션+오전 휴진=closed · 오후 세션+오전 휴진=열림 · 종일 휴진=closed', async () => {
    const [am, pm] = await avail([sess('AM', '09:00', '12:30'), sess('PM', '13:30', '17:30')], [{ id: 'c', doctorId: 'd1', period: 'AM' }]);
    expect([am.closed, am.closureReview]).toEqual([true, false]);
    expect([pm.closed, pm.closureReview]).toEqual([false, false]);
    const [all] = await avail([sess('ALL', '09:00', '17:30')], [{ id: 'c', doctorId: 'd1', period: null }]);
    expect([all.closed, all.closureReview]).toEqual([true, false]);
    const [other] = await avail([sess('ALL', '09:00', '17:30')], [{ id: 'c', doctorId: 'd2', period: 'AM' }]);
    expect([other.closed, other.closureReview]).toEqual([false, false]); // 다른 의사 휴진은 닿지 않는다
  });

  it('③ 포털 셀프 예약은 closureReview 세션 슬롯을 내놓지 않는다 — 열린 세션은 그대로', async () => {
    const schedule = svc([sess('ALL', '09:00', '17:30')], [{ id: 'c', doctorId: 'd1', period: 'AM' }]);
    const portal = Object.create(PortalService.prototype) as any;
    portal.configRuntime = { get: vi.fn().mockResolvedValue(true) };
    portal.schedule = schedule;
    const [s] = (await portal.getAppointmentAvailability({ date: DATE })).data.sessions;
    expect(s.closureReview).toBe(true);
    expect(s.slots.length).toBeGreaterThan(0);
    expect(s.slots.every((x: any) => x.available === false)).toBe(true);

    const openSchedule = svc([sess('ALL', '09:00', '17:30')], []);
    portal.schedule = openSchedule;
    const [o] = (await portal.getAppointmentAvailability({ date: DATE })).data.sessions;
    expect(o.slots.some((x: any) => x.available)).toBe(true);
  });

  it('④ 자동 배정은 closureReview 세션을 고르지 않는다', async () => {
    const s = svc([sess('ALL', '09:00', '17:30')], [{ id: 'c', doctorId: 'd1', period: 'AM' }]);
    expect(await s.resolveDoctorByLoad('내과', new Date(`${DATE}T10:00:00+09:00`), 30)).toBeNull();
    const open = svc([sess('ALL', '09:00', '17:30')], []);
    expect(await open.resolveDoctorByLoad('내과', new Date(`${DATE}T10:00:00+09:00`), 30)).toBe('d1');
  });

  it('⑤ 일 뷰도 같은 판정', async () => {
    const s = svc([sess('ALL', '09:00', '17:30')], [{ id: 'c', doctorId: 'd1', period: 'PM' }]);
    const grid = (await s.getDayGrid({ date: DATE })).data;
    const [session] = grid.lanes[0].sessions;
    expect([session.closed, session.closureReview]).toEqual([false, true]);
  });

  it('⑥ 순수 판정 + 옛 비교가 schedule.service 에 없다', () => {
    expect(classifySessionClosure({ period: 'PM' }, [{ id: 'c', period: 'AM' }]).kind).toBe('UNAFFECTED');
    expect(classifySessionClosure({ period: 'AM' }, [{ id: 'c', period: 'ALL' }]).kind).toBe('AFFECTED');
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/schedule/schedule.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/c\.period === s\.period/);
    expect((src.match(/classifySessionClosure\(/g) ?? []).length).toBe(2);
  });
});
