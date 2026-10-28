import { Injectable, BadRequestException, NotFoundException, Optional, Logger } from '@nestjs/common';
import { requireDateParam, assertDateParam, dateOnlyValue } from '../../common/day-range';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { WaitingQueueService } from '../waiting-queue/waiting-queue.service';
import { FcmPushService } from '../notification/fcm-push.service';
import { JourneyService } from '../journey/journey.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AppointmentQueryDto, CalendarQueryDto, AvailabilityQueryDto } from './dto/appointment-query.dto';
import {
  AppointmentConflictError,
  InvalidStatusTransitionError,
} from '../../domain/errors/domain-error';
import { localeDateTimeText, localeTimeText } from '@hospital-run/shared';
import { classifyClosureImpact, classifySessionClosure } from '../clinic-schedule/closure-impact';
import { buildHourHeatmap, HEATMAP_EXCLUDED_STATUSES } from './schedule-heatmap';

// 허용되는 상태 전이 맵 — CONFIRMED(확정) 2단계 반영
const VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/**
 * 🔴 예약 알림 발송 어댑터 — **구현되지 않았다**(2026-08-14 W8).
 * `implemented:false` 인 동안 이 서비스의 어떤 경로도 "발송했다"고 적을 수 없다.
 * SMS/카카오 계약·발신번호가 확보돼 어댑터가 붙는 날 여기를 true 로 바꾼다.
 * (법정보고 정본 `modules/infection-control/external-reporting.ts` 의 ExternalChannel 과 같은 모양)
 */
const APPOINTMENT_NOTIFY_ADAPTER = {
  name: '예약 알림 SMS/카카오 어댑터',
  implemented: false,
  manualFallback: '예약 확정·취소·노쇼 안내는 원무과에서 유선으로 안내하십시오',
} as const;

const APPT_INCLUDE = {
  patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
  doctor: { select: { id: true, familyName: true, givenName: true } },
} as const;

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly waitingQueue?: WaitingQueueService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly journey?: JourneyService,
    // 🔴 @Optional 은 모듈 imports 누락 시 조용한 no-op — ScheduleModule 에 NotificationModule 임포트 필수
    @Optional() private readonly fcmPush?: FcmPushService,
  ) {}

  // ── Create ──

  async create(dto: CreateAppointmentDto, userId: string | null) {
    const baseAt = new Date(dto.scheduledAt);
    const repeatWeeks = Math.min(Math.max(dto.repeatWeeks ?? 1, 1), 12);

    // 단건
    if (repeatWeeks === 1) return this.createOne(dto, userId, baseAt);

    // 반복예약(§G6·주간 N회) — recurringGroupId 공유. 회차별 검증 실패는 skip.
    const recurringGroupId = randomUUID();
    const created: Awaited<ReturnType<typeof this.createOne>>['appointment'][] = [];
    const warnings = new Set<string>();
    const skipped: { date: string; reason: string }[] = [];
    for (let i = 0; i < repeatWeeks; i++) {
      const at = new Date(baseAt.getTime() + i * 7 * 86400000);
      try {
        const r = await this.createOne(dto, userId, at, recurringGroupId);
        created.push(r.appointment);
        r.warnings.forEach((w) => warnings.add(w));
      } catch (e) {
        skipped.push({ date: at.toISOString(), reason: e instanceof Error ? e.message : '생성 실패' });
      }
    }
    if (!created.length) throw new BadRequestException('반복 예약을 생성할 수 있는 회차가 없습니다.');
    return { appointment: created[0], warnings: [...warnings], recurring: { requested: repeatWeeks, created: created.length, skipped } };
  }

  /** 단일 예약 생성(자동배정·검증·확정 2단계). 포털은 userId=null(createdBy 없음). */
  private async createOne(dto: CreateAppointmentDto, userId: string | null, scheduledAt: Date, recurringGroupId?: string) {
    const duration = dto.duration ?? 30;

    // 과거 시각 차단 — 포털/AI 셀프예약만(스태프는 워크인 백데이트 허용). 1분 여유.
    if ((dto.bookedVia ?? 'STAFF') !== 'STAFF' && scheduledAt.getTime() < Date.now() - 60000) {
      throw new BadRequestException('과거 시각으로는 예약할 수 없습니다.');
    }

    // 의사 미지정 + 과 지정 → 부하분산 자동배정(§5.7)
    let doctorId = dto.doctorId;
    if (!doctorId) {
      if (!dto.departmentName) throw new BadRequestException('doctorId 또는 departmentName이 필요합니다');
      const autoAssign = (await this.config?.get('appointment.autoAssign')) !== false; // 기본 ON
      if (!autoAssign) throw new BadRequestException('의사(doctorId)를 지정하세요 (자동배정 비활성)');
      const assigned = await this.resolveDoctorByLoad(dto.departmentName, scheduledAt, duration);
      if (!assigned) throw new BadRequestException('해당 시간대에 예약 가능한 의사가 없습니다');
      doctorId = assigned;
    }

    const warnings = await this.validateBookable(doctorId, scheduledAt, duration);

    // 확정 2단계(§5.8): 스태프 직접생성만 staffAutoConfirm(기본 ON) 시 즉시 CONFIRMED, 포털/AI 신청은 SCHEDULED
    const bookedVia = dto.bookedVia ?? 'STAFF';
    const staffAutoConfirm = (await this.config?.get('appointment.staffAutoConfirm')) !== false;
    const confirmNow = bookedVia === 'STAFF' && staffAutoConfirm && !!userId;

    // 이중예약 방지: 충돌검사+생성을 의사 락 트랜잭션에 원자화
    const appointment = await this.withDoctorLock(doctorId, async (tx) => {
      await this.validateNoConflict(doctorId, scheduledAt, duration, undefined, tx);
      return tx.appointment.create({
        data: {
          patientId: dto.patientId,
          doctorId,
          scheduledAt,
          duration,
          type: dto.type ?? 'INITIAL',
          reason: dto.reason,
          createdBy: userId,
          departmentName: dto.departmentName ?? null,
          bookedVia,
          ...(recurringGroupId ? { recurringGroupId } : {}),
          status: confirmNow ? AppointmentStatus.CONFIRMED : AppointmentStatus.SCHEDULED,
          ...(confirmNow ? { confirmedAt: new Date(), confirmedBy: userId } : {}),
        },
        include: APPT_INCLUDE,
      });
    });

    // 환자 여정 — 예약 접수(fire-and-forget). 종전 예약은 여정에 전혀 표현되지 않았음.
    this.journey?.emit({
      patientId: dto.patientId,
      eventType: 'APPOINTMENT_BOOKED',
      plannedAt: scheduledAt, // 여정 P2 확장: 예정 시각은 발생과 섞지 않는다(검진 예약과 같은 규약 · 종전엔 설명 글자에만 있었다)
      title: confirmNow ? '예약 확정' : '예약 신청',
      // 🔴 (2026-09-14) 예약 사유(dto.reason)는 자유 입력 — 환자 노출 유형이라 설명에 싣지 않는다(일시만).
      description: localeDateTimeText(scheduledAt, 'ko-KR', { timeZone: 'Asia/Seoul' }),
      department: dto.departmentName ?? undefined,
      doctorId,
      refType: 'Appointment',
      refId: appointment.id,
    });

    return { appointment, warnings };
  }

  // ── 예약 확정(2단계) ──

  async confirm(id: string, userId: string) {
    const existing = await this.prisma.appointment.findUniqueOrThrow({ where: { id } });
    if (existing.status !== AppointmentStatus.SCHEDULED) {
      throw new InvalidStatusTransitionError(existing.status, 'CONFIRMED');
    }
    const warnings = await this.validateBookable(existing.doctorId, existing.scheduledAt, existing.duration, id);
    // 그 사이 슬롯 변동 방지 재검증 — 락 안에서 원자화
    const appointment = await this.withDoctorLock(existing.doctorId, async (tx) => {
      await this.validateNoConflict(existing.doctorId, existing.scheduledAt, existing.duration, id, tx);
      return tx.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.CONFIRMED, confirmedAt: new Date(), confirmedBy: userId },
        include: APPT_INCLUDE,
      });
    });
    this.events?.emit('appointment.confirmed', { id, patientId: appointment.patientId });
    return { appointment, warnings };
  }

  // ── 포털 셀프 예약변경/취소(소유·검증 포함·H1/M1/M3) ──

  /** 환자 셀프 예약변경 — 본인·SCHEDULED/CONFIRMED·미래·충돌·가능성 검증 후 시각 변경(재확정 필요→SCHEDULED). */
  async rescheduleByPatient(appointmentId: string, patientId: string, newDate: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientId, status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] } },
    });
    if (!appt) throw new NotFoundException('변경할 수 있는 예약이 없습니다.');
    const scheduledAt = new Date(newDate);
    if (!(scheduledAt.getTime() > Date.now())) throw new BadRequestException('과거 시각으로는 변경할 수 없습니다.');
    await this.validateBookable(appt.doctorId, scheduledAt, appt.duration, appointmentId);
    // 이중예약 방지: 새 시각 충돌검사+변경을 의사 락 트랜잭션에 원자화
    return this.withDoctorLock(appt.doctorId, async (tx) => {
      await this.validateNoConflict(appt.doctorId, scheduledAt, appt.duration, appointmentId, tx);
      return tx.appointment.update({
        where: { id: appointmentId },
        data: { scheduledAt, status: AppointmentStatus.SCHEDULED }, // 새 시각 → 병원 재확정 대기
        select: { id: true, scheduledAt: true, status: true },
      });
    });
  }

  /** 환자 셀프 취소 — 본인 검증 + 대기자 자동안내 + 알림 이벤트(스태프 changeStatus와 동일 사이드이펙트). */
  async cancelByPatient(appointmentId: string, patientId: string, reason?: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientId, status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] } },
    });
    if (!appt) throw new NotFoundException('취소할 수 있는 예약이 없습니다.');
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason ?? '환자 직접 취소 (포털)' },
      select: { id: true, status: true },
    });
    this.events?.emit('appointment.cancelled', { id: appointmentId, patientId });
    try {
      await this.offerWaitlistOnOpening(appt.doctorId, appt.departmentName);
    } catch (e) {
      this.logger.warn(`대기자 안내 실패(비차단): ${e}`);
    }
    return updated;
  }

  // ── 가용 슬롯(§5.2) ──

  async getAvailability(query: AvailabilityQueryDto) {
    const duration = query.duration ?? 30;
    requireDateParam(query.date, '조회할 날짜');
    // 🔴 `date` 가 없으면 `undefined.split(...)` 로 **500** 이 났다(운영 실측).
    //    형식 검사는 있었지만 **값이 없는 경우**를 안 봤다 — 정본이 둘 다 본다.
    const date = query.date;
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) throw new BadRequestException('date는 YYYY-MM-DD 형식이어야 합니다');
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // TZ 독립 요일

    const schedules = await this.prisma.clinicSchedule.findMany({
      where: {
        dayOfWeek,
        isActive: true,
        ...(query.doctorId ? { doctorId: query.doctorId } : {}),
        ...(query.departmentName ? { departmentName: query.departmentName } : {}),
      },
      include: { doctor: { select: { id: true, familyName: true, givenName: true } } },
      orderBy: [{ departmentName: 'asc' }, { startTime: 'asc' }],
    });

    const doctorIds = [...new Set(schedules.map((s) => s.doctorId))];
    const dayStart = new Date(`${date}T00:00:00+09:00`);
    const dayEnd = new Date(`${date}T23:59:59+09:00`);
    const [appts, closures] = await Promise.all([
      doctorIds.length
        ? this.prisma.appointment.findMany({
            where: {
              doctorId: { in: doctorIds },
              scheduledAt: { gte: dayStart, lte: dayEnd },
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            },
            select: { doctorId: true, scheduledAt: true, duration: true },
          })
        : Promise.resolve([]),
      doctorIds.length
        ? // ClinicClosure.date는 @db.Date — createClosure/findClosures와 동일하게 UTC 자정(new Date('YYYY-MM-DD'))으로 비교
          this.prisma.clinicClosure.findMany({ where: { doctorId: { in: doctorIds }, date: new Date(date) } })
        : Promise.resolve([]),
    ]);

    const now = Date.now();
    const sessions = schedules.map((s) => {
      // 휴진 판정 정본 `clinic-schedule/closure-impact.ts` — 종일 세션+반일 휴진은 휴진도 열림도 아닌 `closureReview`(확인 필요).
      const closureVerdict = classifySessionClosure(s, closures.filter((c) => c.doctorId === s.doctorId));
      const closed = closureVerdict.kind === 'AFFECTED';
      const closureReview = closureVerdict.kind === 'NEEDS_REVIEW';
      const sStart = new Date(`${date}T${s.startTime}:00+09:00`).getTime();
      const sEnd = new Date(`${date}T${s.endTime}:00+09:00`).getTime();
      const sessionAppts = appts.filter(
        (a) => a.doctorId === s.doctorId && a.scheduledAt.getTime() >= sStart && a.scheduledAt.getTime() < sEnd,
      );
      const sessionFull = sessionAppts.length >= s.maxPatients;
      const slots: { start: string; end: string; available: boolean }[] = [];
      for (let t = sStart; t + duration * 60000 <= sEnd; t += duration * 60000) {
        const slotEnd = t + duration * 60000;
        const overlap = sessionAppts.some((a) => {
          const aStart = a.scheduledAt.getTime();
          return aStart < slotEnd && aStart + a.duration * 60000 > t;
        });
        slots.push({
          start: new Date(t).toISOString(),
          end: new Date(slotEnd).toISOString(),
          available: !closed && !sessionFull && !overlap && t >= now,
        });
      }
      return {
        doctorId: s.doctorId,
        doctorName: `${s.doctor.familyName ?? ''}${s.doctor.givenName ?? ''}`.trim(),
        departmentName: s.departmentName,
        roomName: s.roomName,
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        maxPatients: s.maxPatients,
        booked: sessionAppts.length,
        remaining: Math.max(0, s.maxPatients - sessionAppts.length),
        closed,
        closureReview,
        slots,
      };
    });

    return { data: { date, dayOfWeek, sessions } };
  }

  // ── 시간별 타임그리드(일 뷰·의사 레인) ──

  /** 일 뷰 — 의사 레인별 근무세션 + 그날 예약 블록. 시간축(workStart~workEnd) 동봉. */
  async getDayGrid(query: { date: string; departmentName?: string; doctorId?: string; groupBy?: 'doctor' | 'room' }) {
    requireDateParam(query.date, '조회할 날짜');
    // 🔴 `date` 가 없으면 `undefined.split(...)` 로 **500** 이 났다(운영 실측).
    //    형식 검사는 있었지만 **값이 없는 경우**를 안 봤다 — 정본이 둘 다 본다.
    const date = query.date;
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) throw new BadRequestException('date는 YYYY-MM-DD 형식이어야 합니다');
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    const schedules = await this.prisma.clinicSchedule.findMany({
      where: {
        dayOfWeek,
        isActive: true,
        ...(query.doctorId ? { doctorId: query.doctorId } : {}),
        ...(query.departmentName ? { departmentName: query.departmentName } : {}),
      },
      include: { doctor: { select: { id: true, familyName: true, givenName: true } } },
      orderBy: [{ departmentName: 'asc' }, { startTime: 'asc' }],
    });

    const doctorIds = [...new Set(schedules.map((s) => s.doctorId))];
    const dayStart = new Date(`${date}T00:00:00+09:00`);
    const dayEnd = new Date(`${date}T23:59:59+09:00`);
    const [appts, closures] = await Promise.all([
      doctorIds.length
        ? this.prisma.appointment.findMany({
            where: { doctorId: { in: doctorIds }, scheduledAt: { gte: dayStart, lte: dayEnd }, status: { notIn: ['CANCELLED'] } },
            select: {
              id: true, doctorId: true, scheduledAt: true, duration: true, status: true, type: true,
              patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
            },
            orderBy: { scheduledAt: 'asc' },
          })
        : Promise.resolve([]),
      doctorIds.length
        ? this.prisma.clinicClosure.findMany({ where: { doctorId: { in: doctorIds }, date: new Date(date) } })
        : Promise.resolve([]),
    ]);

    // 시간축 범위(근무 세션 최소 시작 ~ 최대 종료)
    let workStart = '24:00';
    let workEnd = '00:00';
    for (const s of schedules) {
      if (s.startTime < workStart) workStart = s.startTime;
      if (s.endTime > workEnd) workEnd = s.endTime;
    }
    if (workStart > workEnd) { workStart = '09:00'; workEnd = '18:00'; }

    // 핵심 개원 시간대(전일 00:00~23:59 응급/24h 세션 제외) — 새벽/야간 압축용 축 범위
    let coreStart = '24:00';
    let coreEnd = '00:00';
    for (const s of schedules) {
      if (s.startTime <= '00:00' && s.endTime >= '23:59') continue; // 전일 세션 제외
      if (s.startTime < coreStart) coreStart = s.startTime;
      if (s.endTime > coreEnd) coreEnd = s.endTime;
    }
    if (coreStart > coreEnd) { coreStart = workStart; coreEnd = workEnd; } // 전부 전일이면 폴백

    // 레인 구성(의사 또는 진료실)
    const groupBy: 'doctor' | 'room' = query.groupBy === 'room' ? 'room' : 'doctor';
    const docRoom = new Map<string, string>(); // 의사 → 그날 대표 진료실(예약→레인 매핑용)
    for (const s of schedules) if (s.roomName && !docRoom.has(s.doctorId)) docRoom.set(s.doctorId, s.roomName);
    const laneKeyOfSchedule = (s: (typeof schedules)[number]) => (groupBy === 'room' ? (s.roomName ?? '(미지정 진료실)') : s.doctorId);
    // 예약→레인: room 뷰에선 '예약 시각이 속한 그 의사 세션의 진료실'로 라우팅(하루 중 진료실 이동 대응). 미해당 시 대표 진료실 폴백.
    const apptKstMin = (d: Date) => { const k = new Date(d.getTime() + 9 * 3600000); return k.getUTCHours() * 60 + k.getUTCMinutes(); };
    const hmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const laneKeyOfAppt = (a: (typeof appts)[number]) => {
      if (groupBy !== 'room') return a.doctorId;
      const min = apptKstMin(a.scheduledAt);
      const sess = schedules.find((s) => s.doctorId === a.doctorId && hmToMin(s.startTime) <= min && min < hmToMin(s.endTime));
      return sess?.roomName ?? docRoom.get(a.doctorId) ?? '(미지정 진료실)';
    };

    const byLane = new Map<string, typeof schedules>();
    for (const s of schedules) {
      const k = laneKeyOfSchedule(s);
      const arr = byLane.get(k) ?? [];
      arr.push(s);
      byLane.set(k, arr);
    }
    const lanes = [...byLane.entries()].map(([key, laneSchedules]) => {
      const first = laneSchedules[0];
      const docNames = [...new Set(laneSchedules.map((s) => `${s.doctor.familyName ?? ''}${s.doctor.givenName ?? ''}`.trim()))];
      const sessions = laneSchedules.map((s) => ({
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        maxPatients: s.maxPatients,
        roomName: s.roomName,
        ...(() => {
          const v = classifySessionClosure(s, closures.filter((c) => c.doctorId === s.doctorId));
          return { closed: v.kind === 'AFFECTED', closureReview: v.kind === 'NEEDS_REVIEW' };
        })(),
      }));
      const laneAppts = appts
        .filter((a) => laneKeyOfAppt(a) === key)
        .map((a) => ({
          id: a.id,
          patientId: a.patient.id,
          scheduledAt: a.scheduledAt.toISOString(),
          duration: a.duration,
          status: a.status,
          type: a.type,
          patientName: `${a.patient.familyName ?? ''}${a.patient.givenName ?? ''}`.trim(),
          mrn: a.patient.mrn,
        }));
      const booked = laneAppts.filter((a) => a.status !== 'NO_SHOW').length;
      const maxPatients = laneSchedules.reduce((n, s) => n + s.maxPatients, 0);
      return {
        laneKey: key,
        title: groupBy === 'room' ? key : docNames[0],
        subtitle: groupBy === 'room' ? `${first.departmentName} · ${docNames.join(', ')}` : `${first.departmentName}${first.roomName ? ` · ${first.roomName}` : ''}`,
        doctorId: groupBy === 'doctor' ? first.doctorId : undefined,
        departmentName: first.departmentName,
        sessions,
        appointments: laneAppts,
        booked,
        maxPatients,
      };
    });

    return { data: { date, dayOfWeek, workStart, workEnd, coreStart, coreEnd, groupBy, lanes } };
  }

  // ── 시간대 혼잡 히트맵(기획 §4.4·§5 · P2) ──

  /**
   * 시간대별 예약 수 + 분모(시간표 슬롯). 판정은 순수 함수 `schedule-heatmap.ts` — 여기서는 조회만 한다.
   * 🔴 쿼리 3회 고정(시간표 1 + 예약·휴진 병렬 2) — 의사·시간 수에 비례해 늘지 않는다(N+1 금지 · 가드).
   * 날짜 경계: 예약은 KST 달력 하루 `[date 00:00+09:00, 다음날 00:00+09:00)`, 휴진(`@db.Date`)은 `dateOnlyValue` 정본.
   */
  async getHourHeatmap(query: { date: string; departmentName?: string; doctorId?: string; by?: string }) {
    requireDateParam(query.date, '조회할 날짜');
    const by = query.by ?? 'hour';
    if (by !== 'hour') throw new BadRequestException('by 는 hour 만 지원합니다');
    const date = query.date;
    const [y, m, d] = date.split('-').map(Number);
    // 🔴 달력에 없는 날짜(`2026-13-40`)는 Date 가 굴려서 받아 준다 — 되돌린 날짜가 입력과 같을 때만 받는다
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (!y || !m || !d || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      throw new BadRequestException('date는 YYYY-MM-DD 형식이어야 합니다');
    }
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    const schedules = await this.prisma.clinicSchedule.findMany({
      where: {
        dayOfWeek,
        isActive: true,
        ...(query.doctorId ? { doctorId: query.doctorId } : {}),
        ...(query.departmentName ? { departmentName: query.departmentName } : {}),
      },
      select: { doctorId: true, period: true, startTime: true, endTime: true },
    });
    const doctorIds = [...new Set(schedules.map((s) => s.doctorId))];
    const dayStart = new Date(`${date}T00:00:00+09:00`);
    const nextDayStart = new Date(dayStart.getTime() + 24 * 3600000);

    // 예약은 시간표가 없는 의사·시간에 잡혀 있어도 센다 — 과 필터면 예약의 과, 의사 필터면 그 의사(시간표 유무와 무관)
    const apptScope: Prisma.AppointmentWhereInput = query.doctorId
      ? { doctorId: query.doctorId }
      : query.departmentName
        ? { OR: [{ departmentName: query.departmentName }, ...(doctorIds.length ? [{ doctorId: { in: doctorIds } }] : [])] }
        : {};
    const [appointments, closures] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          ...apptScope,
          scheduledAt: { gte: dayStart, lt: nextDayStart },
          status: { notIn: [...HEATMAP_EXCLUDED_STATUSES] as AppointmentStatus[] },
        },
        select: { doctorId: true, scheduledAt: true },
      }),
      doctorIds.length
        ? this.prisma.clinicClosure.findMany({
            where: { doctorId: { in: doctorIds }, date: dateOnlyValue(date) as Date },
            select: { id: true, doctorId: true, period: true },
          })
        : Promise.resolve([] as Array<{ id: string; doctorId: string; period: string | null }>),
    ]);

    const built = buildHourHeatmap({ date, schedules, closures, appointments });
    return { data: { date, dayOfWeek, by: 'hour' as const, scheduleCount: schedules.length, ...built } };
  }

  /** 부하분산 자동배정(§5.7) — 해당 시각 가용 의사 중 잔여 슬롯비율 최대. */
  private async resolveDoctorByLoad(departmentName: string, scheduledAt: Date, duration: number): Promise<string | null> {
    const date = new Date(scheduledAt.getTime() + 9 * 3600000).toISOString().slice(0, 10); // KST 날짜
    const { data } = await this.getAvailability({ departmentName, date, duration });
    const ts = scheduledAt.getTime();
    const candidates = data.sessions
      // 자동 배정은 휴진 확인 필요(종일 세션+반일 휴진) 세션을 고르지 않는다 — 모르면 안전측(직원이 직접 고르면 검증이 경고한다).
      .filter((s) => !s.closed && !s.closureReview)
      .map((s) => {
        // 그리드 정확일치(=== ts) 대신 ts를 '포함하는' 슬롯 검사 — off-grid/초·밀리초 입력도 매칭
        const slot = s.slots.find((sl) => ts >= new Date(sl.start).getTime() && ts < new Date(sl.end).getTime());
        return {
          doctorId: s.doctorId,
          available: slot?.available ?? false,
          ratio: s.maxPatients > 0 ? s.remaining / s.maxPatients : 0,
        };
      })
      .filter((c) => c.available)
      .sort((a, b) => b.ratio - a.ratio);
    return candidates[0]?.doctorId ?? null;
  }

  // ── Read ──

  async findAll(query: AppointmentQueryDto) {
    const where = this.buildWhere(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { scheduledAt: 'asc' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          doctor: { select: { id: true, familyName: true, givenName: true } },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, hasMore: page * limit < total },
    };
  }

  async findById(id: string) {
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, phone: true } },
        doctor: { select: { id: true, familyName: true, givenName: true, email: true } },
      },
    });
  }

  // ── Calendar ──

  async getCalendar(query: CalendarQueryDto) {
    const baseDate = query.date ? new Date(query.date) : new Date();
    const { start, end } = this.getDateRange(baseDate, query.view ?? 'week');

    const where: Prisma.AppointmentWhereInput = {
      scheduledAt: { gte: start, lt: end },
      // 🔴 달력 기본은 활성 예약만이 맞지만, 노쇼·취소를 **어디서도 다시 볼 수 없으면**
      //    "노쇼 221" KPI 를 눌러 갈 곳이 없고 실수 취소를 복기할 수도 없다(P2·P7 — 2026-08-13 W3).
      ...(query.includeInactive === 'true' ? {} : { status: { notIn: ['CANCELLED', 'NO_SHOW'] } }),
      ...(query.doctorId && { doctorId: query.doctorId }),
    };

    const appointments = await this.prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
    });

    return {
      data: appointments,
      meta: {
        view: query.view ?? 'week',
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  }

  // ── Update ──

  async update(id: string, dto: UpdateAppointmentDto, userId: string) {
    const existing = await this.prisma.appointment.findUniqueOrThrow({ where: { id } });

    // 최종 상태면 수정 불가
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(existing.status)) {
      throw new InvalidStatusTransitionError(existing.status, 'UPDATE');
    }

    const data = {
      ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt) }),
      ...(dto.duration !== undefined && { duration: dto.duration }),
      ...(dto.type && { type: dto.type }),
      ...(dto.reason !== undefined && { reason: dto.reason }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    // 시각·길이를 건드리지 않는 수정(유형·사유·메모)은 슬롯 검증을 타지 않는다
    if (!dto.scheduledAt && dto.duration === undefined) {
      const appointment = await this.prisma.appointment.update({ where: { id }, data, include: APPT_INCLUDE });
      return { appointment, warnings: [] as string[] };
    }

    // 🔴 (2026-09-14) 종전 update 는 충돌만 봤다 — 휴진·진료 세션·정원(validateBookable)을 건너뛰어 직원·CRM 대행 변경이
    //    휴진일로 옮겨졌고, 충돌 검사도 의사 락 밖이라 경합 시 이중 예약이 가능했다. create·confirm·rescheduleByPatient 와 같은 순서로:
    //    가능성 검증(BLOCK=거부·WARN=응답 경고) → 의사 락 안에서 충돌 검사+변경을 원자화.
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : existing.scheduledAt;
    const duration = dto.duration ?? existing.duration;
    const warnings = await this.validateBookable(existing.doctorId, scheduledAt, duration, id);
    const appointment = await this.withDoctorLock(existing.doctorId, async (tx) => {
      await this.validateNoConflict(existing.doctorId, scheduledAt, duration, id, tx);
      return tx.appointment.update({ where: { id }, data, include: APPT_INCLUDE });
    });
    return { appointment, warnings };
  }

  // ── Status Transition ──

  async changeStatus(id: string, dto: ChangeStatusDto, userId: string) {
    const existing = await this.prisma.appointment.findUniqueOrThrow({ where: { id } });

    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed.includes(dto.status)) {
      throw new InvalidStatusTransitionError(existing.status, dto.status);
    }

    const updateData: Prisma.AppointmentUpdateInput = {
      status: dto.status,
    };

    if (dto.status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      updateData.canceller = { connect: { id: userId } };
      updateData.cancelReason = dto.cancelReason ?? null;
    }
    if (dto.status === 'NO_SHOW') {
      updateData.noShowAt = new Date();
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: updateData,
    });

    // 접수(CHECKED_IN) 시 대기열 자동 생성(§5.5·config checkinCreatesQueue 기본 ON)
    let queueId: string | null = null;
    if (dto.status === 'CHECKED_IN') {
      queueId = await this.maybeCreateQueue(updated);
      // 사전처방 ON_CHECKIN 자동 활성화 트리거 (pre-order 리스너 소비·비차단)
      this.events?.emit('appointment.checked_in', { id, patientId: updated.patientId });
    }
    // 취소 → 슬롯 개방 → 대기자 안내(§G6) + 알림 이벤트 (비차단 — 취소는 이미 커밋)
    if (dto.status === 'CANCELLED') {
      this.events?.emit('appointment.cancelled', { id, patientId: updated.patientId });
      try {
        await this.offerWaitlistOnOpening(updated.doctorId, updated.departmentName);
      } catch (e) {
        this.logger.warn(`대기자 안내 실패(비차단): ${e}`);
      }
    }
    if (dto.status === 'NO_SHOW') this.events?.emit('appointment.noShow', { id, patientId: updated.patientId });

    return { ...updated, queueId };
  }

  /** 예약 접수 시 WaitingQueue 엔트리 자동 생성(멱등·비차단). 생성/기존 큐 id 반환. */
  private async maybeCreateQueue(appt: {
    id: string; patientId: string; doctorId: string; departmentName: string | null; type: string; reason: string | null;
  }): Promise<string | null> {
    const enabled = (await this.config?.get('appointment.checkinCreatesQueue')) !== false; // 기본 ON
    if (!enabled || !this.waitingQueue) return null;
    // 예약에 과가 없으면(레거시/포털 예약) 담당의 소속 과로 보완
    let departmentName = appt.departmentName;
    if (!departmentName && appt.doctorId) {
      const doc = await this.prisma.user.findUnique({ where: { id: appt.doctorId }, select: { department: true } });
      departmentName = doc?.department ?? null;
    }
    if (!departmentName) return null;
    const existing = await this.prisma.waitingQueue.findUnique({ where: { appointmentId: appt.id } });
    if (existing) return existing.id;
    try {
      const res = await this.waitingQueue.checkIn({
        patientId: appt.patientId,
        doctorId: appt.doctorId,
        departmentName,
        visitType: appt.type,
        reason: appt.reason ?? undefined,
        appointmentId: appt.id,
        type: 'APPOINTMENT',
      });
      return (res as { data?: { id?: string } })?.data?.id ?? null;
    } catch (e) {
      this.logger.warn(`예약 접수 대기열 자동생성 실패(비차단): ${e}`);
      return null;
    }
  }

  /** 노쇼 처리(§G4) — SCHEDULED/CONFIRMED → NO_SHOW. */
  async noShow(id: string, userId: string) {
    return this.changeStatus(id, { status: AppointmentStatus.NO_SHOW } as ChangeStatusDto, userId);
  }

  /**
   * 접수 데스크 → 환자앱 도착 확인 호출(2026-08-05).
   * 곧 도착/지각 예약 환자에게 앱 인앱 알림+푸시로 도착 여부를 문의한다.
   * - 환자앱 계정이 없으면 400 — 접수원이 전화 등 다른 채널로 전환하도록 사유를 명시
   * - 같은 계정 10분 내 재호출은 400(중복 발송 방지) — 발송 시도≠도달이므로 남발 방지가 우선
   * - 인앱 알림(PatientNotification)이 정본이고 FCM 은 best-effort(실패해도 앱 내에서 보임)
   */
  async callPatient(id: string, userId: string) {
    const appt = await this.prisma.appointment.findUnique({ where: { id }, include: APPT_INCLUDE });
    if (!appt) throw new NotFoundException('예약을 찾을 수 없습니다');
    const callable: AppointmentStatus[] = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];
    if (!callable.includes(appt.status)) {
      throw new BadRequestException('접수 대기(예정·확정) 상태의 예약만 호출할 수 있습니다');
    }
    const account = await this.prisma.patientAccount.findFirst({
      where: { patientId: appt.patientId }, select: { id: true },
    });
    if (!account) {
      throw new BadRequestException('환자앱 계정이 없는 환자입니다 — 전화 등 다른 채널로 연락해 주세요');
    }
    const recent = await this.prisma.patientNotification.findFirst({
      where: { accountId: account.id, type: 'ARRIVAL_CHECK', createdAt: { gte: new Date(Date.now() - 10 * 60000) } },
      select: { id: true },
    });
    if (recent) throw new BadRequestException('10분 내 이미 호출한 환자입니다 — 잠시 후 다시 시도해 주세요');

    const hhmm = localeTimeText(appt.scheduledAt, 'ko-KR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
    });
    const late = appt.scheduledAt.getTime() < Date.now();
    const where = [appt.departmentName, appt.doctor ? `${appt.doctor.familyName}${appt.doctor.givenName} 선생님` : null]
      .filter(Boolean).join(' ');
    const pn = await this.prisma.patientNotification.create({
      data: {
        accountId: account.id,
        type: 'ARRIVAL_CHECK',
        title: late ? '예약 시간이 지났습니다 — 도착 확인' : '곧 예약 시간입니다 — 도착 확인',
        body: `${hhmm} ${where} 예약이 아직 접수되지 않았습니다. 병원에 도착하셨다면 접수 데스크(원무과)로 와주세요. 늦어지시면 앱에서 예약을 변경할 수 있습니다.`,
        data: { appointmentId: appt.id, route: '/(tabs)/appointments' },
        sentVia: 'DESK_CALL',
      },
    });
    /**
     * 🔴 **인앱 알림 생성과 단말 푸시는 다른 층이다.**
     *    종전엔 푸시를 fire-and-forget 으로 던지고 응답은 언제나 `sent: true` 였다 —
     *    FCM 자격이 없거나 발송이 실패해도 접수원 화면은
     *    **"환자앱으로 도착 확인 문의를 보냈습니다"** 라고 단정했다.
     *    환자 폰이 울리지 않았는데 접수 데스크는 기다린다.
     *
     * 🔴 정본(`PatientPushGateService`)이 이미 `pushChannel: ATTEMPTED|UNAVAILABLE` 로
     *    같은 사실을 말하고 있다 — 여기서는 그 어휘를 그대로 쓴다(정본이 둘이 되지 않게).
     */
    let pushChannel: 'ATTEMPTED' | 'UNAVAILABLE' | 'FAILED' = 'UNAVAILABLE';
    if (this.fcmPush?.isEnabled) {
      pushChannel = 'ATTEMPTED';
      // 🔴 await 하지 않는 이유는 종전과 같다(접수 동작을 푸시 지연에 묶지 않는다).
      //    다만 **실패를 성공이라 말하지 않기 위해** 결과를 원장에 남긴다.
      this.fcmPush.pushPatientNotification(pn.id).catch((e) =>
        this.logger.warn(`도착 확인 푸시 실패(인앱 알림은 생성됨): ${e instanceof Error ? e.message : String(e)}`));
    } else {
      this.logger.warn(`도착 확인: 인앱 알림은 기록됐으나 FCM 자격이 없어 단말 푸시는 나가지 않았다(appt=${appt.id})`);
    }
    this.logger.log(`도착 확인 호출: appt=${appt.id} by=${userId} push=${pushChannel}`);
    // 🔴 `sent` 는 **인앱 알림이 기록됐다**는 뜻이다 — 폰에 갔다는 뜻이 아니다(pushChannel 이 그것을 말한다)
    return { sent: true, notificationId: pn.id, late, pushChannel };
  }

  /** 자동 노쇼 스윕(config appointment.autoNoShow 기본 OFF) — 예정+유예 경과·미접수 → NO_SHOW. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoNoShowSweep(): Promise<void> {
    if ((await this.config?.get('appointment.autoNoShow')) !== true) return; // 기본 OFF
    const g = Number(await this.config?.get('appointment.autoNoShow.graceMinutes'));
    const graceMin = Number.isFinite(g) ? g : 30; // 0(유예없음) 존중 — `|| 30`은 0을 30으로 뒤집음
    const cutoff = new Date(Date.now() - graceMin * 60000);
    // 되돌아보는 창(기본 24h). 24h 하드코딩이던 시절엔 그보다 오래된 예약은 **켜도 영영 정리되지 않아**
    // SCHEDULED 로 쌓였다(2026-08-03 실측 118건). 0 이면 제한 없음 — 과거 누적분을 한 번에 정리할 때 쓴다.
    const lb = Number(await this.config?.get('appointment.autoNoShow.lookbackHours'));
    const lookbackHours = Number.isFinite(lb) ? lb : 24;
    const candidates = await this.prisma.appointment.findMany({
      where: {
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        scheduledAt: lookbackHours > 0
          ? { lt: cutoff, gte: new Date(Date.now() - lookbackHours * 3600000) }
          : { lt: cutoff },
        // 🔴 **진료 기록이 있으면 노쇼가 아니다.** 이 조건이 없어 온 환자를 안 왔다고 기록했다.
        encounter: { is: null },
      },
      select: { id: true, patientId: true },
    });

    // 🔴 **접수 기록(대기열)이 있으면 노쇼가 아니다.**
    //    주석은 처음부터 "예정+유예 경과·**미접수** → NO_SHOW" 라고 밝히고 있었는데
    //    구현에 그 조건이 없었다. 그 결과 전체 예약 397건 중 **385건이 NO_SHOW**,
    //    `COMPLETED` 는 0건이 됐다(노쇼율 99.5%). 접수·진료를 마친 환자까지 "안 왔다"고
    //    기록되면 환자 이력과 통계가 함께 거짓이 된다(2026-08-13 실측).
    const candidateIds = candidates.map((a) => a.id);
    const checkedIn = candidateIds.length
      ? await this.prisma.waitingQueue.findMany({
          where: { appointmentId: { in: candidateIds } },
          select: { appointmentId: true },
        })
      : [];
    const checkedInIds = new Set(checkedIn.map((w) => w.appointmentId));
    const stale = candidates.filter((a) => !checkedInIds.has(a.id));

    let updateFailed = 0;
    for (const a of stale) {
      // 🔴 (2026-09-16 E4) 종전엔 update 와 emit 이 **한 try 안에 있고 catch 가 비어 있었다.**
      //    update 가 커밋된 뒤 emit 이 던지면 상태는 NO_SHOW 로 바뀌었는데 알림만 사라지고,
      //    다음 스윕은 이미 NO_SHOW 라 후보로 잡지 않는다 — **환자 알림이 영구 유실되는데 로그 한 줄 없었다.**
      //    쓰기와 발행을 나누고, 실패는 각각 남긴다(스윕 자체는 계속 돈다).
      try {
        await this.prisma.appointment.update({ where: { id: a.id }, data: { status: AppointmentStatus.NO_SHOW, noShowAt: new Date() } });
      } catch (e) {
        updateFailed++;
        this.logger.warn(`자동 노쇼 전환 실패(다음 스윕 재시도) appointment=${a.id}: ${(e as Error).message}`);
        continue; // 상태가 안 바뀌었으면 알림도 보내지 않는다
      }
      try {
        this.events?.emit('appointment.noShow', { id: a.id, patientId: a.patientId, auto: true }); // 알림 어댑터 수신
      } catch (e) {
        // 🔴 상태는 이미 바뀌었다 — 다음 스윕이 다시 잡지 않으므로 여기서 말하지 않으면 아무도 모른다
        this.logger.error(`자동 노쇼 알림 발행 실패(상태는 NO_SHOW 로 전환됨) appointment=${a.id}: ${(e as Error).message}`);
      }
    }
    if (updateFailed) this.logger.warn(`자동 노쇼 전환 실패 ${updateFailed}건 — 다음 스윕에서 재시도합니다`);
    if (stale.length) this.logger.log(`자동 노쇼 전환 ${stale.length}건`);
  }

  /** 예약 통계(§G4) — 상태별·노쇼율·과별. */
  async getStats(query: { dateFrom?: string; dateTo?: string }) {
    assertDateParam(query.dateFrom, '조회 시작일');
    assertDateParam(query.dateTo, '조회 종료일');
    const where: Prisma.AppointmentWhereInput = {};
    const range: { gte?: Date; lte?: Date } = {};
    if (query.dateFrom) range.gte = new Date(query.dateFrom + 'T00:00:00+09:00');
    if (query.dateTo) range.lte = new Date(query.dateTo + 'T23:59:59+09:00');
    if (range.gte || range.lte) where.scheduledAt = range;

    const [grouped, byDept] = await Promise.all([
      this.prisma.appointment.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.appointment.groupBy({ by: ['departmentName'], where, _count: { _all: true } }),
    ]);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
    }
    const noShow = byStatus['NO_SHOW'] ?? 0;
    // 노쇼율 분모 = 내원 대상(취소 제외) — 취소가 많을수록 과소집계되던 문제 보정
    const denom = total - (byStatus['CANCELLED'] ?? 0);
    // 🔴 (2026-09-16 J3) 대상이 0건인 기간에 노쇼율 `0%` 를 냈다 — 미방문율은 QI 지표라 0% 는 '완벽'으로 읽힌다.
    const noShowRate = denom > 0 ? Math.round((noShow / denom) * 1000) / 10 : null;
    return {
      data: {
        total,
        byStatus,
        noShow,
        completed: byStatus['COMPLETED'] ?? 0,
        noShowRate,
        noShowDenominator: denom,
        noShowRateUnavailableReason: denom > 0 ? null : 'NO_VISIT_TARGET',
        byDepartment: byDept.map((d) => ({ departmentName: d.departmentName ?? '(미지정)', count: d._count._all })),
      },
    };
  }

  // ── 대기자명단(§G6) ──

  async registerWaitlist(
    dto: { patientId: string; departmentName: string; doctorId?: string; preferredFrom?: string; preferredTo?: string; note?: string },
    userId: string | null,
  ) {
    // 중복 방지: 같은 환자·과·의사의 WAITING 항목이 있으면 재사용(무한 등록 차단)
    const existing = await this.prisma.appointmentWaitlist.findFirst({
      where: { patientId: dto.patientId, departmentName: dto.departmentName, doctorId: dto.doctorId ?? null, status: 'WAITING' },
    });
    if (existing) return existing;
    return this.prisma.appointmentWaitlist.create({
      data: {
        patientId: dto.patientId,
        departmentName: dto.departmentName,
        doctorId: dto.doctorId ?? null,
        preferredFrom: dto.preferredFrom ? new Date(dto.preferredFrom) : null,
        preferredTo: dto.preferredTo ? new Date(dto.preferredTo) : null,
        note: dto.note ?? null,
        createdBy: userId,
      },
    });
  }

  async listWaitlist(query: { departmentName?: string; doctorId?: string; patientId?: string; status?: string }) {
    const data = await this.prisma.appointmentWaitlist.findMany({
      where: {
        ...(query.departmentName ? { departmentName: query.departmentName } : {}),
        ...(query.doctorId ? { doctorId: query.doctorId } : {}),
        ...(query.patientId ? { patientId: query.patientId } : {}),
        status: query.status ?? 'WAITING',
      },
      orderBy: { createdAt: 'asc' },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
    });
    return { data };
  }

  async cancelWaitlist(id: string) {
    const existing = await this.prisma.appointmentWaitlist.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('대기 항목을 찾을 수 없습니다.');
    if (existing.status === 'CANCELLED' || existing.status === 'BOOKED') return existing; // 멱등
    return this.prisma.appointmentWaitlist.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /** 예약 취소로 슬롯 개방 시 대기자 1명 자동 안내(WAITING→OFFERED). */
  private async offerWaitlistOnOpening(doctorId: string, departmentName: string | null): Promise<void> {
    if (!departmentName) return;
    const next = await this.prisma.appointmentWaitlist.findFirst({
      where: { departmentName, status: 'WAITING', OR: [{ doctorId }, { doctorId: null }] },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) return;
    // 🔴 2026-08-20 — `notifiedAt: new Date()` 를 찍고 있었으나 **통보 채널이 없다.**
    //    이 이벤트의 수신자 `onAppointmentNotify` 는 **존재하지만**
    //    `APPOINTMENT_NOTIFY_ADAPTER.implemented === false` 라 로그만 남기고 반환한다.
    //    (수신자가 발행과 같은 파일 안에 있어 "수신자 0"으로 오독하기 쉽다 — 수신자 유무가 아니라
    //     **그 수신자가 실제로 무엇을 하는지**를 봐야 한다. 1차 조사가 실제로 그렇게 틀렸다.)
    //    `appointmentWaitlist.notifiedAt` 을 읽는 화면도 없다. 즉 환자는 아무것도 받지 못하는데
    //    원장에는 "이 시각에 안내했다"가 남았다(P16 — 실행하지 않고 성공 상태만 기록).
    //    통보하지 않았으므로 시각을 남기지 않는다. 슬롯 선점 의미(OFFERED)는 종전 동작을 유지한다.
    //    어댑터 구현은 대외 발신이라 사람 판단 대기 — 붙는 날 **발송에 성공했을 때만** 채운다.
    await this.prisma.appointmentWaitlist.update({ where: { id: next.id }, data: { status: 'OFFERED', notifiedAt: null } });
    this.events?.emit('appointment.waitlist.offered', { waitlistId: next.id, patientId: next.patientId, doctorId, departmentName });
    this.logger.warn(
      `대기자 슬롯 선점(OFFERED) waitlist=${next.id} patient=${next.patientId} — 자동 통보 채널이 없습니다. ` +
        `환자는 안내받지 못했으므로 전화 등으로 직접 연락해야 합니다(${departmentName}).`,
    );
  }

  /**
   * 알림 어댑터(§G8) — 예약 확정/취소/노쇼/대기자 안내 이벤트 수신.
   *
   * 🔴 종전에는 config `appointment.reminder.send=true` 이면 `[예약알림·실발송(어댑터)]` 라고
   *    적었는데 **어댑터 호출은 `TODO(P3b+)` 로 비어 있었다**(2026-08-14 W8). 기본 OFF 라
   *    지금은 조용하지만, 계약이 체결돼 설정을 켜는 순간 한 통도 나가지 않으면서 로그는
   *    전건 "실발송" 이 된다 — 켜는 사람이 가장 먼저 속는 형태다.
   *
   *    설정을 켜는 것은 이 배치의 일이 아니다(config 는 OFF 그대로).
   *    로그가 **실제 동작과 일치**하게만 고친다: 어댑터가 없으면 무엇을 설정하든 미발송이다.
   *    실제 어댑터가 붙는 날 고칠 자리는 `APPOINTMENT_NOTIFY_ADAPTER` 와 여기뿐이다.
   */
  @OnEvent('appointment.confirmed')
  @OnEvent('appointment.cancelled')
  @OnEvent('appointment.noShow')
  @OnEvent('appointment.waitlist.offered')
  async onAppointmentNotify(payload: Record<string, unknown>): Promise<void> {
    const configured = (await this.config?.get('appointment.reminder.send')) === true;

    if (!APPOINTMENT_NOTIFY_ADAPTER.implemented) {
      // 미발송 — 설정이 켜져 있으면 "켰는데 안 나간다"는 사실을 경고로 드러낸다.
      if (configured) {
        this.logger.warn(
          `[예약알림·미발송] appointment.reminder.send=true 이지만 ${APPOINTMENT_NOTIFY_ADAPTER.name} 미구현 — ` +
            `아무것도 발송되지 않았습니다 · 조치: ${APPOINTMENT_NOTIFY_ADAPTER.manualFallback} · ${JSON.stringify(payload)}`,
        );
      } else {
        this.logger.log(`[예약알림·미발송(설정 OFF·어댑터 미구현)] ${JSON.stringify(payload)}`);
      }
      return;
    }

    /* c8 ignore start — 어댑터 미구축 구간 */
    if (!configured) {
      this.logger.log(`[예약알림·미발송(설정 OFF)] ${JSON.stringify(payload)}`);
      return;
    }
    this.logger.log(`[예약알림·실발송] ${JSON.stringify(payload)}`);
    /* c8 ignore stop */
  }

  // ── Conflict Validation ──

  /**
   * 이중예약 방지 — 의사 단위 advisory xact lock으로 충돌검사+쓰기를 원자화(check-then-act race 제거).
   * 선례: consult.assignWithCapacity. lock은 tx 종료 시 자동 해제.
   */
  private async withDoctorLock<T>(doctorId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt:${doctorId}`}))`;
      return fn(tx);
    });
  }

  private async validateNoConflict(
    doctorId: string,
    scheduledAt: Date,
    duration: number,
    excludeId?: string,
    client?: Prisma.TransactionClient,
  ) {
    const db = client ?? this.prisma;
    const endAt = new Date(scheduledAt.getTime() + duration * 60 * 1000);
    const bufferStart = new Date(scheduledAt.getTime() - 5 * 60 * 1000); // 5분 buffer

    const conflicts = await db.appointment.findMany({
      where: {
        doctorId,
        ...(excludeId && { id: { not: excludeId } }),
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        // 하한 추가 — 과거 예약 전량 로드 방지. 최대 진료시간(240분)만큼 앞선 예약도 겹칠 수 있어 -4h로 여유
        scheduledAt: { gte: new Date(scheduledAt.getTime() - 4 * 60 * 60 * 1000), lt: endAt },
      },
    });

    const overlapping = conflicts.filter((apt) => {
      const aptEnd = new Date(apt.scheduledAt.getTime() + apt.duration * 60 * 1000);
      return aptEnd > bufferStart;
    });

    if (overlapping.length > 0) {
      throw new AppointmentConflictError(doctorId, scheduledAt, overlapping[0].id);
    }
  }

  /**
   * 예약 가능성 검증(§5.1·P1) — 근무시간·휴진·정원. 게이트별 OFF/WARN/BLOCK.
   * config: appointment.enforce.workingHours(기본 WARN)·closure(기본 BLOCK)·capacity(기본 WARN).
   * BLOCK 위반 시 400(APPOINTMENT_NOT_BOOKABLE), WARN은 문자열 배열로 반환(응답 동봉).
   */
  private async validateBookable(doctorId: string, scheduledAt: Date, duration: number, excludeId?: string): Promise<string[]> {
    const lv = async (key: string, def: string) => String((await this.config?.get(key)) ?? def).toUpperCase();
    const [whLv, clLv, capLv] = await Promise.all([
      lv('appointment.enforce.workingHours', 'WARN'),
      lv('appointment.enforce.closure', 'BLOCK'),
      lv('appointment.enforce.capacity', 'WARN'),
    ]);
    if (whLv === 'OFF' && clLv === 'OFF' && capLv === 'OFF') return [];

    const kst = new Date(scheduledAt.getTime() + 9 * 3600000);
    const dateStr = kst.toISOString().slice(0, 10);
    const apptStart = scheduledAt.getTime();
    const apptEnd = apptStart + duration * 60000;

    const [y, m, d] = dateStr.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const schedules = await this.prisma.clinicSchedule.findMany({ where: { doctorId, dayOfWeek, isActive: true } });
    const covering = schedules.find((s) => {
      const sStart = new Date(`${dateStr}T${s.startTime}:00+09:00`).getTime();
      const sEnd = new Date(`${dateStr}T${s.endTime}:00+09:00`).getTime();
      return apptStart >= sStart && apptEnd <= sEnd;
    });

    const blocks: string[] = [];
    const warnings: string[] = [];
    const flag = (level: string, msg: string) => {
      if (level === 'BLOCK') blocks.push(msg);
      else if (level === 'WARN') warnings.push(msg);
    };

    // 근무시간
    if (whLv !== 'OFF' && !covering) flag(whLv, '해당 의사의 진료 시간표에 없는 시간대입니다.');

    // 휴진 — 판정 정본 `clinic-schedule/closure-impact.ts`(휴진 영향 예약 조회와 같은 함수).
    // 🔴 (2026-09-14) 종전 비교(`c.period === covering.period`)는 종일 세션에 반일 휴진이 걸리면 '휴진 아님'으로 통과시켰다.
    //    확인 필요(종일 세션+반일 휴진·시간표 밖 예약)는 **막지 않고 경고+기록**한다 — 오전/오후 어느 쪽인지 시간표가 말하지 않아
    //    막으면 정상 예약까지 굶기고(막으면 방치된다), 조용히 통과시키면 휴진한 반나절에 예약이 들어간다.
    if (clLv !== 'OFF') {
      const closures = await this.prisma.clinicClosure.findMany({ where: { doctorId, date: new Date(dateStr) } });
      const verdict = classifyClosureImpact(
        { dateKey: dateStr, scheduledAt, durationMinutes: duration },
        closures.map((c) => ({ id: c.id, period: c.period })),
        schedules.map((s) => ({ period: s.period, startTime: s.startTime, endTime: s.endTime })),
      );
      if (verdict.kind === 'AFFECTED') flag(clLv, '해당 일자·시간대는 휴진입니다.');
      else if (verdict.kind === 'NEEDS_REVIEW') {
        warnings.push('이 날짜에 반일 휴진이 있으나 이 예약 시간이 휴진 반나절에 속하는지 진료 시간표로 판정할 수 없습니다 — 휴진 여부를 확인하세요.');
        this.logger?.warn(`closure NEEDS_REVIEW doctor=${doctorId} date=${dateStr} closure=${verdict.closureId} basis=${verdict.basis}`);
      }
    }

    // 정원(세션 예약수 ≥ maxPatients)
    if (capLv !== 'OFF' && covering) {
      const count = await this.prisma.appointment.count({
        where: {
          doctorId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          scheduledAt: {
            gte: new Date(`${dateStr}T${covering.startTime}:00+09:00`),
            lt: new Date(`${dateStr}T${covering.endTime}:00+09:00`),
          },
        },
      });
      if (count >= covering.maxPatients) flag(capLv, `해당 진료 세션 정원(${covering.maxPatients}명)이 찼습니다.`);
    }

    if (blocks.length) {
      throw new BadRequestException({ code: 'APPOINTMENT_NOT_BOOKABLE', message: blocks.join(' '), blocks, warnings });
    }
    return warnings;
  }

  // ── Helpers ──

  private buildWhere(query: AppointmentQueryDto): Prisma.AppointmentWhereInput {
    const conditions: Prisma.AppointmentWhereInput[] = [];

    if (query.doctorId) conditions.push({ doctorId: query.doctorId });
    if (query.patientId) conditions.push({ patientId: query.patientId });
    if (query.status) conditions.push({ status: query.status });
    if (query.statuses) conditions.push({ status: { in: query.statuses.split(',').map((s) => s.trim()).filter(Boolean) as AppointmentStatus[] } });
    if (query.type) conditions.push({ type: query.type });
    // 날짜 경계는 KST(서버 TZ=Asia/Seoul) 기준 — UTC 자정으로 비교하면 새벽 KST 예약이 누락됨
    // date=today 또는 특정일(YYYY-MM-DD) → 그 날 하루
    // 🔴 'today' 특례는 전역 DateQueryPipe(YYYY-MM-DD 강제)가 컨트롤러 앞에서 400 으로 걸러
    //    **도달 불가**다(2026-09-01 운영 실증 — 의사 '오늘 예약' 위젯 3곳이 이걸로 죽어 있었다).
    //    FE 는 실날짜를 보낸다. 특례는 파이프 정책이 바뀔 때를 위해 사실 명시와 함께 남긴다.
    if (query.date) {
      const ymd = query.date === 'today'
        ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
        : query.date;
      conditions.push({ scheduledAt: { gte: new Date(ymd + 'T00:00:00+09:00'), lte: new Date(ymd + 'T23:59:59+09:00') } });
    }
    if (query.dateFrom) conditions.push({ scheduledAt: { gte: new Date(query.dateFrom + 'T00:00:00+09:00') } });
    if (query.dateTo) conditions.push({ scheduledAt: { lte: new Date(query.dateTo + 'T23:59:59+09:00') } });

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  private getDateRange(base: Date, view: 'week' | 'month') {
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);

    if (view === 'week') {
      const day = start.getDay();
      start.setDate(start.getDate() - day); // 일요일 시작
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    } else {
      start.setDate(1);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      return { start, end };
    }
  }
}
