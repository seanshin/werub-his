import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { todayRange, dateOnlyValue } from '../../common/day-range';
import { classifyClosureImpact } from './closure-impact';

/**
 * 🔴 화면 실사용 점검 W8 — 휴진(ClinicClosure.date)은 `@db.Date`(달력 날짜) 컬럼이다.
 *    저장은 UTC 자정인데 조회가 KST 자정이라 **정확히 하루 어긋나**,
 *    오늘 등록한 휴진이 오늘 진료 목록에 절대 반영되지 않았다.
 *
 *    🔴 정본은 `common/day-range.ts` 의 `dateOnlyValue` **하나**다.
 *       같은 결함이 `waiting-queue`·`queue-display` 에도 있었고(접수 시 휴진 필터 무력·전광판 오표시),
 *       모듈마다 헬퍼를 따로 두면 또 갈라진다 — **한 곳만 고치면 갈라진다.**
 */
const toDateOnly = dateOnlyValue;

// 휴진 영향 판정은 `closure-impact.ts` 한 곳 — 예약 가능성 검증(schedule.service validateBookable)도 같은 함수를 쓴다.
export { classifyClosureImpact, type ClosureImpactVerdict } from './closure-impact';

@Injectable()
export class ClinicScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const schedules = await this.prisma.clinicSchedule.findMany({
      where: { isActive: true },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, role: true } } },
      orderBy: [{ departmentName: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }],
    });
    return { data: schedules };
  }

  async findToday(department?: string) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hour = now.getHours();
    const period = hour < 13 ? 'AM' : 'PM';

    // 오늘(KST 달력 날짜)의 휴진 — `@db.Date` 비교는 그 날짜의 UTC 자정으로 한다.
    // 🔴 종전 `new Date(y,m,d)`(KST 자정)는 DB 에서 **전날**로 해석돼 휴진이 한 번도 걸리지 않았다.
    const todayDateOnly = toDateOnly(now)!;
    const closures = await this.prisma.clinicClosure.findMany({
      where: {
        date: todayDateOnly,
        OR: [{ period }, { period: null }],
      },
    });
    const closedDoctorIds = closures.map((c) => c.doctorId);

    const where: Prisma.ClinicScheduleWhereInput = {
      dayOfWeek,
      isActive: true,
      doctorId: { notIn: closedDoctorIds },
      OR: [{ period }, { period: 'ALL' }],
    };
    if (department) {
      where.departmentName = department;
    }

    const schedules = await this.prisma.clinicSchedule.findMany({
      where,
      include: { doctor: { select: { id: true, familyName: true, givenName: true, role: true } } },
      orderBy: [{ departmentName: 'asc' }],
    });

    // Add waiting count for each doctor
    // checkedInAt 은 timestamptz(순간) — 이쪽은 KST 자정 구간이 맞다(`todayRange`).
    const today = todayRange(now);
    const doctorIds = schedules.map((s) => s.doctorId);
    const waitingCounts = await this.prisma.waitingQueue.groupBy({
      by: ['doctorId'],
      where: {
        doctorId: { in: doctorIds },
        status: 'WAITING',
        checkedInAt: { gte: today.gte, lt: today.lt },
      },
      _count: true,
    });
    const countMap = new Map(waitingCounts.map((w) => [w.doctorId, w._count]));

    const result = schedules.map((s) => ({
      ...s,
      waitingCount: countMap.get(s.doctorId) ?? 0,
    }));

    return { data: result };
  }

  async findWeek() {
    const schedules = await this.prisma.clinicSchedule.findMany({
      where: { isActive: true },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, role: true } } },
      orderBy: [{ departmentName: 'asc' }, { dayOfWeek: 'asc' }],
    });

    // Group by doctor
    const grouped: Record<string, any> = {};
    for (const s of schedules) {
      const key = s.doctorId;
      if (!grouped[key]) {
        grouped[key] = {
          doctor: s.doctor,
          departmentName: s.departmentName,
          roomName: s.roomName,
          slots: [],
        };
      }
      grouped[key].slots.push({
        dayOfWeek: s.dayOfWeek,
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        maxPatients: s.maxPatients,
        id: s.id,
      });
    }

    return { data: Object.values(grouped) };
  }

  async create(data: {
    doctorId: string;
    departmentName: string;
    roomName: string;
    dayOfWeek: number;
    period: string;
    startTime: string;
    endTime: string;
    maxPatients?: number;
  }) {
    // 🔴 화면 실사용 점검 W8 — 유니크는 (doctorId, dayOfWeek, period) 뿐이라
    //    'ALL'(종일) 슬롯이 이미 있는 요일에 AM/PM 을 또 만들 수 있었다(같은 시간을 두 번 정의).
    //    관리 그리드가 'ALL' 을 못 보고 '-' 로 그리던 동안 클릭 한 번이면 만들어지는 상태였다.
    const sameDay = await this.prisma.clinicSchedule.findMany({
      where: { doctorId: data.doctorId, dayOfWeek: data.dayOfWeek, isActive: true },
      select: { id: true, period: true },
    });
    const isAll = data.period === 'ALL';
    const conflict = sameDay.find((s) => (isAll ? true : s.period === 'ALL' || s.period === data.period));
    if (conflict) {
      throw new ConflictException(
        conflict.period === 'ALL'
          ? '이미 종일 진료가 등록된 요일입니다.'
          : `이미 등록된 시간대입니다 (${conflict.period}).`,
      );
    }

    const schedule = await this.prisma.clinicSchedule.create({ data });
    return { data: schedule };
  }

  async update(
    id: string,
    data: Partial<{
      departmentName: string;
      roomName: string;
      startTime: string;
      endTime: string;
      maxPatients: number;
      isActive: boolean;
    }>,
  ) {
    const schedule = await this.prisma.clinicSchedule.update({
      where: { id },
      data,
    });
    return { data: schedule };
  }

  async delete(id: string) {
    await this.prisma.clinicSchedule.delete({ where: { id } });
    return { data: { success: true } };
  }

  // --- Closure ---

  async findClosures(date?: string) {
    const where: Prisma.ClinicClosureWhereInput = {};
    if (date) {
      // 🔴 종전 `new Date(date)` 는 형식이 틀리면 Invalid Date 를 그대로 Prisma 로 넘겨 500 이 났다.
      const dateOnly = toDateOnly(date);
      if (!dateOnly) throw new BadRequestException('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).');
      where.date = dateOnly;
    }
    const closures = await this.prisma.clinicClosure.findMany({
      where,
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true } },
        substitute: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: { date: 'asc' },
    });
    return { data: closures };
  }

  async createClosure(data: {
    doctorId: string;
    date: string;
    period?: string;
    reason: string;
    substituteId?: string;
  }) {
    // 저장·조회를 같은 기준(KST 달력 날짜 → UTC 자정)으로 맞춘다 — findToday/findClosures 와 한 벌.
    const dateOnly = toDateOnly(data.date);
    if (!dateOnly) throw new BadRequestException('휴진 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).');

    try {
      const closure = await this.prisma.clinicClosure.create({
        data: {
          doctorId: data.doctorId,
          date: dateOnly,
          period: data.period ?? null,
          reason: data.reason,
          substituteId: data.substituteId ?? null,
        },
      });
      return { data: closure };
    } catch (err: unknown) {
      // 같은 의사·날짜·시간대 중복은 유니크 위반 — "등록됐다"가 아니라 무엇이 막았는지 말한다.
      const code = (err as { code?: string } | null)?.code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'P2002' || msg.includes('Unique constraint')) {
        throw new ConflictException('이미 등록된 휴진입니다 (같은 의사·날짜·시간대).');
      }
      if (code === 'P2003' || msg.includes('Foreign key')) {
        throw new BadRequestException('의사 또는 대진 의사 계정을 찾을 수 없습니다.');
      }
      throw err;
    }
  }

  /**
   * 특정일 휴진이 닿는 기존 예약 — outpatient-workflow §5-2 `GET clinic-closure/affected/:date`.
   *
   * 🔴 착수 전 실측: 휴진은 등록·삭제만 있었고 **그날 이미 잡힌 예약 환자를 찾는 경로가 없었다** —
   *    휴진을 넣은 사람은 누구에게 연락해야 하는지 기억으로 찾아야 했다(워크리스트 부재).
   * 🔴 자동 취소·자동 문자 **없음** — 목록과 "연락 필요"만 준다. 옮길지·취소할지·대진으로 볼지는 사람이 정한다.
   * 겹침 판정은 예약 가능성 검증(`schedule.service.ts validateBookable`)과 **같은 규칙**을 쓴다:
   *   예약 [시작, 시작+소요) 이 진료 세션 [시작, 끝) 안에 들어가면 그 세션 소속이고,
   *   휴진이 종일(period null·ALL)이거나 소속 세션의 period 와 같으면 영향이다.
   *   판정할 수 없는 것(세션 밖 예약·종일 세션인데 반일 휴진)은 영향으로도 무관으로도 세지 않고 **확인 필요**로 따로 준다.
   */
  async findClosureAffected(date: string) {
    const dateOnly = toDateOnly(date);
    if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
      throw new BadRequestException('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    }
    const dateKey = String(date).trim();
    const closures = await this.prisma.clinicClosure.findMany({
      where: { date: dateOnly },
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true } },
        substitute: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    if (closures.length === 0) {
      return { date: dateKey, closures: [], affected: [], needsReview: [], counts: { affected: 0, needsReview: 0 } };
    }

    const doctorIds = [...new Set(closures.map((c) => c.doctorId))];
    const [y, m, d] = dateKey.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const dayStart = new Date(`${dateKey}T00:00:00+09:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600000);

    const [schedules, appointments] = await Promise.all([
      this.prisma.clinicSchedule.findMany({
        where: { doctorId: { in: doctorIds }, dayOfWeek, isActive: true },
        select: { doctorId: true, period: true, startTime: true, endTime: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          doctorId: { in: doctorIds },
          scheduledAt: { gte: dayStart, lt: dayEnd },
          // 이미 끝났거나 오지 않기로 한 예약은 연락 대상이 아니다
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] },
        },
        select: {
          id: true, doctorId: true, scheduledAt: true, duration: true, status: true, departmentName: true, roomName: true,
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true, phone: true } },
        },
        orderBy: { scheduledAt: 'asc' },
      }),
    ]);

    const affected: Array<Record<string, unknown>> = [];
    const needsReview: Array<Record<string, unknown>> = [];
    for (const appt of appointments) {
      const doctorClosures = closures.filter((c) => c.doctorId === appt.doctorId);
      const doctorSchedules = schedules.filter((s) => s.doctorId === appt.doctorId);
      const verdict = classifyClosureImpact(
        { dateKey, scheduledAt: appt.scheduledAt, durationMinutes: appt.duration },
        doctorClosures.map((c) => ({ id: c.id, period: c.period })),
        doctorSchedules,
      );
      if (verdict.kind === 'UNAFFECTED') continue;
      const closure = doctorClosures.find((c) => c.id === verdict.closureId) ?? doctorClosures[0];
      const row = {
        appointmentId: appt.id,
        scheduledAt: appt.scheduledAt,
        durationMinutes: appt.duration,
        appointmentStatus: appt.status,
        departmentName: appt.departmentName,
        roomName: appt.roomName,
        patient: appt.patient,
        doctorId: appt.doctorId,
        closureId: closure.id,
        closurePeriod: closure.period,
        closureReason: closure.reason,
        substitute: closure.substitute,
        basis: verdict.basis,
        // 연락은 사람이 한다 — 이 값은 "이 환자에게 누군가 연락해야 한다"는 표시일 뿐, 발송 여부가 아니다
        contactNeeded: true,
      };
      (verdict.kind === 'AFFECTED' ? affected : needsReview).push(row);
    }

    return {
      date: dateKey,
      closures: closures.map((c) => ({ id: c.id, doctor: c.doctor, period: c.period, reason: c.reason, substitute: c.substitute })),
      affected,
      needsReview,
      counts: { affected: affected.length, needsReview: needsReview.length },
    };
  }

  async deleteClosure(id: string) {
    const closure = await this.prisma.clinicClosure.findUnique({ where: { id } });
    if (!closure) throw new NotFoundException('Closure not found');
    await this.prisma.clinicClosure.delete({ where: { id } });
    return { data: { success: true } };
  }
}
