import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MedAdminStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * 투약 지연 알림(B3 보강) — 예정 시각이 지난 미시행(SCHEDULED) 투약을 담당 간호사에게 능동 통지.
 * 투약은 간호 업무이므로 배정 간호사(NursePatientAssignment·활성·primary)가 1차 대상,
 *  배정이 없으면 주치의(attendingDoctor)로 폴백(알림 유실 방지).
 * 윈도우 기반 dedup: 직전 30분에 "막 지연된" 건만 통지.
 */
@Injectable()
export class MedicationOverdueCronService {
  private readonly logger = new Logger(MedicationOverdueCronService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkOverdue() {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - 30 * 60000);
      const overdue = await this.prisma.medicationAdministration.findMany({
        where: { status: MedAdminStatus.SCHEDULED, scheduledAt: { gte: windowStart, lt: now } },
        select: { patientId: true, patient: { select: { familyName: true, givenName: true } } },
        take: 300,
      });
      if (!overdue.length) return;

      const byPatient = new Map<string, { name: string; count: number }>();
      for (const m of overdue) {
        const e = byPatient.get(m.patientId) ?? { name: `${m.patient.familyName ?? ''}${m.patient.givenName ?? ''}`.trim(), count: 0 };
        e.count += 1;
        byPatient.set(m.patientId, e);
      }

      let notified = 0;
      for (const [patientId, info] of byPatient) {
        const adm = await this.prisma.admission.findFirst({
          where: { patientId, status: 'ADMITTED' },
          select: {
            attendingDoctorId: true,
            nurseAssignments: {
              where: { releasedAt: null },
              orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'desc' }],
              select: { nurseId: true },
            },
          },
        });
        if (!adm) continue;
        // 1차: 배정 간호사(활성·primary 우선), 폴백: 주치의
        const recipientId = adm.nurseAssignments[0]?.nurseId ?? adm.attendingDoctorId;
        if (!recipientId) continue;
        const n = await this.notifications.create(recipientId, {
          type: 'MED_OVERDUE',
          title: '⏰ 투약 지연',
          message: `${info.name} — 예정 투약 ${info.count}건 지연(시각 경과). 확인 바랍니다.`,
          severity: 'WARNING',
          refType: 'PATIENT',
          refId: patientId,
        });
        this.notifications.pushNotification(recipientId, {
          id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity,
          refType: n.refType ?? undefined, refId: n.refId ?? undefined,
        });
        notified += 1;
      }
      if (notified) this.logger.log(`투약 지연 통지 ${notified}명 (${overdue.length}건)`);
    } catch (e) {
      this.logger.warn(`투약 지연 cron 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
