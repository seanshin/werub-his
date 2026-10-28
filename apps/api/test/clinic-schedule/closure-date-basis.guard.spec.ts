import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClinicScheduleService } from '../../src/modules/clinic-schedule/clinic-schedule.service';

/**
 * 가드 — 화면 실사용 점검 W8 (2026-08-14)
 *
 * 🔴 원 결함(S2): 휴진 등록이 절대 반영되지 않았다.
 *    ClinicClosure.date 는 `@db.Date`(달력 날짜)이고 Prisma 는 넘겨준 Date 의 **UTC 날짜 부분**을 쓴다.
 *    - 저장: `new Date('2026-08-14')` → UTC 자정 → DB 2026-08-14
 *    - 조회(findToday): `new Date(y, m, d)` → **KST 자정** = 2026-08-13T15:00Z → DB 비교값 2026-08-13
 *    → 정확히 하루 어긋나 오늘 등록한 휴진이 오늘 진료 목록에서 한 번도 걸리지 않았다.
 *
 * 이 가드는 **저장과 조회가 같은 순간을 쓴다**는 사실을 못 박는다.
 * (한쪽만 KST 자정으로 바꾸면 이번에는 저장이 하루 앞으로 밀린다 — 반드시 같은 기준이어야 한다)
 *
 * 🔴 원 결함(S3 동반): 유니크가 (doctorId, dayOfWeek, period) 뿐이라
 *    'ALL'(종일) 이 있는 요일에 AM/PM 을 겹쳐 만들 수 있었다.
 */
describe('ClinicSchedule — 휴진 날짜 기준 (W8 가드)', () => {
  let service: ClinicScheduleService;
  let p: any;

  beforeEach(() => {
    p = {
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
      clinicClosure: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
      waitingQueue: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    service = new ClinicScheduleService(p);
  });

  const dateArg = (mock: any) => mock.mock.calls[0][0].data?.date ?? mock.mock.calls[0][0].where?.date;

  it('저장과 조회가 같은 순간을 쓴다 — 하루 어긋나지 않는다', async () => {
    const day = '2026-08-14';

    await service.createClosure({ doctorId: 'doc-1', date: day, reason: '학회' });
    const saved: Date = dateArg(p.clinicClosure.create);

    p.clinicClosure.findMany.mockClear();
    await service.findClosures(day);
    const queried: Date = dateArg(p.clinicClosure.findMany);

    expect(saved.toISOString()).toBe(queried.toISOString());
    // @db.Date 컬럼 비교의 정본 = 그 달력 날짜의 UTC 자정
    expect(saved.toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('findToday 의 휴진 조회도 같은 기준이다 — KST 자정(전날)로 밀리지 않는다', async () => {
    // KST 로 2026-08-14 00:30 (= 2026-08-13T15:30Z) — 로컬 자정 파싱이 전날로 밀리는 최악의 시각
    const now = new Date(2026, 7, 14, 0, 30, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await service.findToday();
      const queried: Date = p.clinicClosure.findMany.mock.calls[0][0].where.date;
      expect(queried.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('그날 등록한 휴진이 그날 진료 목록에서 실제로 제외된다', async () => {
    const now = new Date(2026, 7, 14, 10, 0, 0); // 오전
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await service.createClosure({ doctorId: 'doc-1', date: '2026-08-14', reason: '학회' });
      const savedDate: Date = dateArg(p.clinicClosure.create);

      // 저장된 행이 그대로 돌아온다고 가정 — 조회 조건이 같은 날짜면 걸린다
      p.clinicClosure.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.date.getTime() === savedDate.getTime() ? [{ doctorId: 'doc-1', period: null }] : []),
      );

      await service.findToday();
      const where = p.clinicSchedule.findMany.mock.calls[0][0].where;
      expect(where.doctorId).toEqual({ notIn: ['doc-1'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('날짜 형식이 틀리면 Invalid Date 를 DB 로 넘기지 않고 400 을 낸다', async () => {
    await expect(service.createClosure({ doctorId: 'doc-1', date: '아무거나', reason: 'x' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.findClosures('2026-13-99x')).rejects.toThrow(BadRequestException);
  });

  it('중복 휴진은 "등록됐다" 가 아니라 409 로 말한다', async () => {
    p.clinicClosure.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      service.createClosure({ doctorId: 'doc-1', date: '2026-08-14', reason: '학회' }),
    ).rejects.toThrow(ConflictException);
  });

  it('종일(ALL) 슬롯이 있는 요일에 AM 을 겹쳐 만들 수 없다', async () => {
    p.clinicSchedule.findMany.mockResolvedValue([{ id: 's-all', period: 'ALL' }]);
    await expect(
      service.create({
        doctorId: 'doc-1', departmentName: '내과', roomName: '1번실',
        dayOfWeek: 1, period: 'AM', startTime: '09:00', endTime: '12:30',
      }),
    ).rejects.toThrow(ConflictException);
    expect(p.clinicSchedule.create).not.toHaveBeenCalled();
  });
});
