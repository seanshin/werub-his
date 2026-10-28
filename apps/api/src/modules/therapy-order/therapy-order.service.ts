import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { THERAPY_EXECUTOR_PROFESSIONS } from '@hospital-run/shared';
import { assertTherapyExecutor } from '../../common/therapy-executor';
import { assertOrderTransition, buildOrderData, emitOrderCreated, orderTransitionData } from '../order/order.service';
import { completeTherapyOrder } from './therapy-completion';
import { CreateTherapyOrderDto, UpdateTherapyOrderDto, CompleteTherapyOrderDto } from './dto/therapy-order.dto';

@Injectable()
export class TherapyOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 일정 생성 권한 — 비의사는 본인이 입력한 치료 처방의 오더에만(치료사는 치료 직종이어야).
   * 🔴 `create` 본문에서 분리한 이유: 멱등 스캐너가 이 권한 조회(findUnique)를 '만들기 전 중복 확인'으로 읽어
   *    무방비 자리에서 빠졌다(가드가 다른 이유로 통과). 실제 재시도 심판은 여전히 `orderId` 유니크다(판정 등록부).
   */
  private async assertScheduleAllowed(orderId: string, userId?: string): Promise<void> {
    if (!userId) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!u || u.role === 'DOCTOR' || u.role === 'ADMIN') return;
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { prescription: { select: { createdBy: true, type: true } } } });
    if (!order || order.prescription?.type !== 'THERAPY') {
      throw new BadRequestException({ code: 'THERAPY_ORDER_REQUIRED', message: '치료 처방에 딸린 오더가 아닙니다.' });
    }
    if (order.prescription.createdBy !== userId) {
      throw new ForbiddenException({ code: 'THERAPY_ORDER_NOT_OWN', message: '본인이 입력한 치료 처방에만 일정을 붙일 수 있습니다.' });
    }
    if (u.role === 'LAB_TECH') await assertTherapyExecutor(this.prisma, userId, THERAPY_EXECUTOR_PROFESSIONS);
  }

  /**
   * 치료 일정 생성.
   * 🔴 (2026-09-29) 종전 DOCTOR/ADMIN 전용이라, 간호사·치료사가 의사 승인을 받아 치료 처방을 넣어도 2단계(일정)에서 403 이었다.
   *    비의사는 **본인이 입력한(=지정 의사 승인을 거친) 치료 처방의 오더**에만 일정을 붙일 수 있다 — 남의 오더에 일정을 얹어
   *    승인 없는 치료를 만들지 못하게. 치료사(LAB_TECH)는 치료 직종이어야 한다.
   */
  async create(dto: CreateTherapyOrderDto, userId?: string) {
    await this.assertScheduleAllowed(dto.orderId, userId);
    const therapyOrder = await this.prisma.therapyOrder.create({
      data: {
        orderId: dto.orderId,
        therapyType: dto.therapyType,
        scheduledDate: new Date(dto.scheduledDate),
        scheduledTime: dto.scheduledTime,
        duration: dto.duration,
        therapistId: dto.therapistId,
        stationId: dto.stationId,
        isRecurring: dto.isRecurring ?? false,
        recurPattern: dto.recurPattern,
        recurEndDate: dto.recurEndDate ? new Date(dto.recurEndDate) : null,
        totalSessions: dto.totalSessions,
        sessionNo: 1,
      },
      include: { order: { include: { prescription: { include: { encounter: { select: { patientId: true } } } } } } },
    });

    // 반복 일정이면 나머지 세션 자동 생성
    if (dto.isRecurring && dto.totalSessions && dto.totalSessions > 1) {
      await this.generateRecurringSessions(therapyOrder, dto);
    }

    return therapyOrder;
  }

  /** 반복 일정 자동 생성 (MWF, DAILY, TTS, WEEKLY) */
  private async generateRecurringSessions(first: any, dto: CreateTherapyOrderDto) {
    const pattern = dto.recurPattern ?? 'DAILY';
    const total = dto.totalSessions ?? 10;
    const dates = this.computeRecurringDates(new Date(dto.scheduledDate), pattern, total);

    // 첫 번째는 이미 생성됨, 나머지를 트랜잭션으로 일괄 생성
    const createdOrderIds: string[] = [];
    if (dates.length > 1) {
      await this.prisma.$transaction(async (tx) => {
        for (let i = 1; i < dates.length; i++) {
          const order = await tx.order.create({
            data: buildOrderData({
              prescriptionId: first.order.prescriptionId,
              type: 'THERAPY',
              notes: `${dto.therapyType} #${i + 1}/${total}`,
            }),
          });
          createdOrderIds.push(order.id);
          await tx.therapyOrder.create({
            data: {
              orderId: order.id,
              therapyType: dto.therapyType,
              scheduledDate: dates[i],
              scheduledTime: dto.scheduledTime,
              duration: dto.duration,
              therapistId: dto.therapistId,
              stationId: dto.stationId,
              isRecurring: true,
              recurPattern: dto.recurPattern,
              totalSessions: total,
              sessionNo: i + 1,
            },
          });
        }
      });
      for (const oid of createdOrderIds) {
        emitOrderCreated(this.eventEmitter, { orderId: oid, type: 'THERAPY', patientId: first.order?.prescription?.encounter?.patientId });
      }
    }
  }

  /** 패턴에 따라 날짜 배열 생성 */
  private computeRecurringDates(start: Date, pattern: string, count: number): Date[] {
    const dates: Date[] = [new Date(start)];
    const cursor = new Date(start);
    const allowedDays = this.parsePattern(pattern);

    while (dates.length < count) {
      cursor.setDate(cursor.getDate() + 1);
      const dow = cursor.getDay(); // 0=일, 1=월, ..., 6=토
      if (allowedDays.includes(dow)) {
        dates.push(new Date(cursor));
      }
    }
    return dates;
  }

  private parsePattern(pattern: string): number[] {
    switch (pattern.toUpperCase()) {
      case 'MWF': return [1, 3, 5]; // 월수금
      case 'TTS': return [2, 4, 6]; // 화목토
      case 'DAILY': return [1, 2, 3, 4, 5]; // 평일
      case 'WEEKLY': return [new Date().getDay() || 1]; // 같은 요일
      default: return [1, 2, 3, 4, 5]; // 기본 평일
    }
  }

  /** 환자별 치료 오더 이력 — 차트 '치료 이력' 탭 (TherapyOrder→order→prescription→encounter.patientId) */
  async findByPatient(patientId: string) {
    return this.prisma.therapyOrder.findMany({
      where: { order: { prescription: { encounter: { patientId } } } },
      include: { therapist: { select: { id: true, familyName: true, givenName: true } } },
      orderBy: [{ scheduledDate: 'desc' }, { scheduledTime: 'desc' }],
      take: 200,
    });
  }

  async findByDate(date: string, stationId?: string, therapistId?: string) {
    const d = new Date(date);
    const nextDay = new Date(d);
    nextDay.setDate(nextDay.getDate() + 1);

    return this.prisma.therapyOrder.findMany({
      where: {
        scheduledDate: { gte: d, lt: nextDay },
        ...(stationId ? { stationId } : {}),
        ...(therapistId ? { therapistId } : {}),
      },
      include: {
        order: {
          include: {
            prescription: { include: { encounter: { include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } } } },
          },
        },
        therapist: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findById(id: string) {
    const order = await this.prisma.therapyOrder.findUnique({
      where: { id },
      include: {
        order: { include: { prescription: { include: { encounter: { include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } } } } } },
        therapist: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    if (!order) throw new NotFoundException('치료 오더를 찾을 수 없습니다');
    return order;
  }

  async update(id: string, dto: UpdateTherapyOrderDto) {
    await this.findById(id);
    return this.prisma.therapyOrder.update({
      where: { id },
      data: {
        ...(dto.scheduledDate ? { scheduledDate: new Date(dto.scheduledDate) } : {}),
        scheduledTime: dto.scheduledTime,
        duration: dto.duration,
        therapistId: dto.therapistId,
        stationId: dto.stationId,
      },
    });
  }

  async start(id: string, userId?: string) {
    await assertTherapyExecutor(this.prisma, userId, THERAPY_EXECUTOR_PROFESSIONS);
    const therapy = await this.findById(id);
    // 🔴 (2026-09-15 P3) 상태를 보지 않아 취소·완료된 오더도 '시행 중'으로 되살아났다 — 상태기계 정본을 따른다
    if (therapy.order.status === 'IN_PROGRESS') return { started: true };
    assertOrderTransition(therapy.order.status, 'IN_PROGRESS');
    await this.prisma.order.update({
      where: { id: therapy.orderId },
      data: orderTransitionData('IN_PROGRESS', userId), // 시행자 스탬프 누락 교정
    });
    return { started: true };
  }

  async complete(id: string, dto?: CompleteTherapyOrderDto, userId?: string) {
    await assertTherapyExecutor(this.prisma, userId, THERAPY_EXECUTOR_PROFESSIONS);
    // 정본 `therapy-completion.ts` — 상태 전이 검사·이미 완료 멱등·청구/여정 이벤트는 새로 완료된 때만
    return completeTherapyOrder(this.prisma, this.eventEmitter, id, dto?.resultData as Record<string, unknown> | undefined, userId);
  }

  async getStats(date: string) {
    const d = new Date(date);
    const nextDay = new Date(d);
    nextDay.setDate(nextDay.getDate() + 1);

    const [total, completed, byType] = await Promise.all([
      this.prisma.therapyOrder.count({ where: { scheduledDate: { gte: d, lt: nextDay } } }),
      this.prisma.therapyOrder.count({ where: { scheduledDate: { gte: d, lt: nextDay }, completedAt: { not: null } } }),
      this.prisma.therapyOrder.groupBy({
        by: ['therapyType'],
        where: { scheduledDate: { gte: d, lt: nextDay } },
        _count: true,
      }),
    ]);

    return { total, completed, remaining: total - completed, byType };
  }
}
