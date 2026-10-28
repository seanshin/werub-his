import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PATIENT_VISIBLE_ITEM_TYPES } from './patient-schedule.service';

/**
 * 치료일정 D-1 환자 리마인더(P3) — 매일 08:00 내일 예정 계획 항목을 환자별 1건으로 묶어 발송.
 * - config `treatmentSchedule.reminder`(기본 OFF) 게이트 — 선례 portal.medicationReminder
 * - 대상: ACTIVE 스케줄의 PLANNED/LINKED + 환자 노출 유형만(내부 항목 비발송 — 포털 노출 규칙과 동일)
 * - 멱등: PatientScheduleItem.remindedAt (재시작·중복 실행에도 1회만)
 * - 발송: 이벤트 발행 → notification.listener가 PatientNotification+FCM (createPatientPush는 private 관례)
 */
@Injectable()
export class ScheduleReminderCronService {
  private readonly logger = new Logger(ScheduleReminderCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendReminders(): Promise<{ patients: number; items: number }> {
    if ((await this.configRuntime.get('treatmentSchedule.reminder')) !== true) return { patients: 0, items: 0 };

    // 내일 KST 하루 창 — @db.Timestamptz라 KST 자정 경계로 계산
    const kstToday = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(new Date(`${kstToday}T00:00:00+09:00`).getTime() + 86400_000);
    const to = new Date(from.getTime() + 86400_000);
    const tomorrow = new Date(from.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

    const due = await this.prisma.patientScheduleItem.findMany({
      where: {
        plannedAt: { gte: from, lt: to },
        status: { in: ['PLANNED', 'LINKED'] },
        remindedAt: null,
        itemType: { in: [...PATIENT_VISIBLE_ITEM_TYPES] },
        schedule: { status: 'ACTIVE' },
      },
      include: { schedule: { select: { patientId: true } } },
      orderBy: { plannedAt: 'asc' },
      take: 500,
    });
    if (!due.length) return { patients: 0, items: 0 };

    const byPatient = new Map<string, typeof due>();
    for (const item of due) {
      const pid = item.schedule.patientId;
      const list = byPatient.get(pid) ?? [];
      list.push(item);
      byPatient.set(pid, list);
    }

    let patients = 0;
    for (const [patientId, items] of byPatient) {
      try {
        // 멱등 스탬프 선기록 — 발송 실패 시 재발송보다 미발송이 안전(중복 알림 방지 우선)
        await this.prisma.patientScheduleItem.updateMany({
          where: { id: { in: items.map((i) => i.id) }, remindedAt: null },
          data: { remindedAt: new Date() },
        });
        this.eventEmitter.emit('treatment.schedule.reminder', {
          patientId,
          date: tomorrow,
          count: items.length,
          firstTitle: items[0].title,
        });
        patients += 1;
      } catch (e) {
        this.logger.warn(`치료일정 리마인더 실패 patient=${patientId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (patients > 0) this.logger.log(`치료일정 D-1 리마인더: 환자 ${patients}명 · 항목 ${due.length}건`);
    return { patients, items: due.length };
  }
}
