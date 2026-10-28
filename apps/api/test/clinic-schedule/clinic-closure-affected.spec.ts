/**
 * 휴진 영향 예약 — outpatient-workflow §5-2 `GET clinic-closure/affected/:date` (2026-09-14)
 *
 * 지키는 것:
 *  ① 겹침 경계 — 세션 끝 시각에 시작하는 예약은 그 세션이 아니다 · 세션 끝에 딱 끝나는 예약은 그 세션이다(예약 가능성 검증과 같은 규칙)
 *  ② 종일 휴진은 그날 예약 전부 · 반일 휴진은 같은 period 세션만
 *  ③ 판정 불가(시간표 밖 예약·종일 세션+반일 휴진)는 영향으로도 무관으로도 세지 않고 needsReview
 *  ④ 다른 의사 예약·취소/노쇼/완료 예약은 제외(조회 조건)
 *  ⑤ 아무것도 바꾸지 않는다 — 예약 update·발송 호출 0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ClinicScheduleService, classifyClosureImpact } from '../../src/modules/clinic-schedule/clinic-schedule.service';

const DATE = '2026-09-16'; // 수요일
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+09:00`);
const AM = { period: 'AM', startTime: '09:00', endTime: '12:30' };
const PM = { period: 'PM', startTime: '13:30', endTime: '17:30' };

describe('classifyClosureImpact — 순수 판정', () => {
  const amClosure = [{ id: 'c-am', period: 'AM' }];

  it('① 경계 — 세션 끝(12:30)에 시작하는 예약은 오전 세션이 아니다(시간표 밖 → 확인 필요)', () => {
    const v = classifyClosureImpact({ dateKey: DATE, scheduledAt: at('12:30'), durationMinutes: 30 }, amClosure, [AM, PM]);
    expect(v).toEqual({ kind: 'NEEDS_REVIEW', closureId: 'c-am', basis: 'OUTSIDE_SCHEDULE' });
  });

  it('① 경계 — 세션 끝에 딱 끝나는 예약(12:00+30분)은 오전 세션 → 영향', () => {
    const v = classifyClosureImpact({ dateKey: DATE, scheduledAt: at('12:00'), durationMinutes: 30 }, amClosure, [AM, PM]);
    expect(v).toEqual({ kind: 'AFFECTED', closureId: 'c-am', basis: 'SESSION' });
  });

  it('① 경계 — 세션 시작 시각(09:00)에 시작하는 예약은 그 세션 → 영향', () => {
    const v = classifyClosureImpact({ dateKey: DATE, scheduledAt: at('09:00'), durationMinutes: 15 }, amClosure, [AM, PM]);
    expect(v.kind).toBe('AFFECTED');
  });

  it('② 반일 휴진 — 다른 period 세션 예약은 무관(대조군)', () => {
    const v = classifyClosureImpact({ dateKey: DATE, scheduledAt: at('14:00'), durationMinutes: 30 }, amClosure, [AM, PM]);
    expect(v).toEqual({ kind: 'UNAFFECTED' });
  });

  it('② 종일 휴진(period null·ALL) — 시간표와 무관하게 영향', () => {
    for (const period of [null, 'ALL']) {
      const v = classifyClosureImpact({ dateKey: DATE, scheduledAt: at('19:00'), durationMinutes: 30 }, [{ id: 'c', period }], []);
      expect(v).toEqual({ kind: 'AFFECTED', closureId: 'c', basis: 'FULL_DAY' });
    }
  });

  it('③ 종일 세션(ALL)인데 오전 휴진 — 어느 반쪽인지 모른다 → 확인 필요', () => {
    const ALLDAY = { period: 'ALL', startTime: '09:00', endTime: '18:00' };
    const v = classifyClosureImpact({ dateKey: DATE, scheduledAt: at('10:00'), durationMinutes: 30 }, amClosure, [ALLDAY]);
    expect(v).toEqual({ kind: 'NEEDS_REVIEW', closureId: 'c-am', basis: 'ALL_DAY_SESSION_HALF_CLOSURE' });
  });
});

describe('ClinicScheduleService.findClosureAffected', () => {
  let prisma: any;
  let svc: ClinicScheduleService;
  const patient = (n: string) => ({ id: `p-${n}`, mrn: `M${n}`, familyName: '김', givenName: n, phone: null });

  beforeEach(() => {
    prisma = {
      clinicClosure: { findMany: vi.fn() },
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([{ doctorId: 'd1', ...AM }, { doctorId: 'd1', ...PM }]) },
      appointment: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    };
    svc = new ClinicScheduleService(prisma);
  });

  it('④ 조회 조건 — 휴진 의사만·그날 KST 하루·취소/노쇼/완료 제외', async () => {
    prisma.clinicClosure.findMany.mockResolvedValue([{ id: 'c1', doctorId: 'd1', period: 'AM', reason: '학회', doctor: {}, substitute: null }]);
    prisma.appointment.findMany.mockResolvedValue([]);
    await svc.findClosureAffected(DATE);
    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.doctorId).toEqual({ in: ['d1'] });
    expect(where.status).toEqual({ notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] });
    expect(where.scheduledAt.gte.toISOString()).toBe('2026-09-15T15:00:00.000Z');
    expect(where.scheduledAt.lt.toISOString()).toBe('2026-09-16T15:00:00.000Z');
  });

  it('② ③ ⑤ 분류 — 오전 예약은 영향·오후는 제외·시간표 밖은 확인 필요 · 아무것도 바꾸지 않는다', async () => {
    prisma.clinicClosure.findMany.mockResolvedValue([{ id: 'c1', doctorId: 'd1', period: 'AM', reason: '학회', doctor: {}, substitute: { id: 'd2' } }]);
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'a1', doctorId: 'd1', scheduledAt: at('10:00'), duration: 30, status: 'SCHEDULED', patient: patient('1') },
      { id: 'a2', doctorId: 'd1', scheduledAt: at('14:00'), duration: 30, status: 'CONFIRMED', patient: patient('2') },
      { id: 'a3', doctorId: 'd1', scheduledAt: at('12:30'), duration: 30, status: 'SCHEDULED', patient: patient('3') },
    ]);
    const out: any = await svc.findClosureAffected(DATE);
    expect(out.affected.map((r: any) => r.appointmentId)).toEqual(['a1']);
    expect(out.needsReview.map((r: any) => r.appointmentId)).toEqual(['a3']);
    expect(out.affected[0]).toMatchObject({ contactNeeded: true, basis: 'SESSION', substitute: { id: 'd2' } });
    expect(out.counts).toEqual({ affected: 1, needsReview: 1 });
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('휴진이 없는 날은 예약을 조회하지 않고 빈 목록', async () => {
    prisma.clinicClosure.findMany.mockResolvedValue([]);
    const out: any = await svc.findClosureAffected(DATE);
    expect(out).toMatchObject({ affected: [], needsReview: [], counts: { affected: 0, needsReview: 0 } });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('날짜 형식이 틀리면 400', async () => {
    await expect(svc.findClosureAffected('2026-9-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.findClosureAffected('nope')).rejects.toBeInstanceOf(BadRequestException);
  });
});
