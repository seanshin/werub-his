import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ChronicService } from './chronic.service';

const COND_KO: Record<string, string> = { DM: '당뇨', HTN: '고혈압', DYSLIPID: '이상지질', CKD: '만성콩팥병' };

/**
 * 만성질환 모니터링 리콜(능동) — care-gap의 RECALL(핵심지표 미측정 >90일/측정없음) 환자를
 * 담당의에게 일 1회 통지. 주간 dedup.
 * pull-only 대시보드를 능동 추적관리로 보강.
 */
@Injectable()
export class ChronicRecallCronService {
  private readonly logger = new Logger(ChronicRecallCronService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly chronic: ChronicService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkRecalls() {
    try {
      const { gaps } = await this.chronic.getCareGaps();
      const recalls = gaps.filter((g) => g.gaps.includes('RECALL')).slice(0, 300);
      if (!recalls.length) return;
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);

      let notified = 0;
      for (const r of recalls) {
        // 주간 dedup — 같은 환자 리콜 통지가 7일 내 있으면 스킵
        const recent = await this.prisma.notification.findFirst({
          where: { type: 'CHRONIC_RECALL', refId: r.patientId, createdAt: { gte: weekAgo } },
          select: { id: true },
        });
        if (recent) continue;

        const doctorId = await this.resolveDoctor(r.patientId);
        if (!doctorId) continue;

        const conds = r.conditions.map((c) => COND_KO[c] ?? c).join('·') || '만성질환';
        const overdue = r.overdueDays == null ? '핵심지표 측정 기록 없음' : `핵심지표 측정 ${r.overdueDays}일 경과`;
        const n = await this.notifications.create(doctorId, {
          type: 'CHRONIC_RECALL',
          title: '🔔 만성질환 모니터링 리콜',
          message: `${r.name} (${conds}) — ${overdue}. 추적검사·내원 안내가 필요합니다.`,
          severity: 'INFO',
          refType: 'PATIENT',
          refId: r.patientId,
        });
        this.notifications.pushNotification(doctorId, {
          id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity,
          refType: n.refType ?? undefined, refId: n.refId ?? undefined,
        });
        notified += 1;
      }
      if (notified) this.logger.log(`만성질환 리콜 통지 ${notified}명 (대상 ${recalls.length})`);
    } catch (e) {
      this.logger.warn(`만성질환 리콜 cron 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 담당의 — 최근 외래 진료의 > 재원 주치의 (maybeAlert와 동일 정책) */
  private async resolveDoctor(patientId: string): Promise<string | null> {
    const enc = await this.prisma.encounter.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' }, select: { doctorId: true } });
    if (enc?.doctorId) return enc.doctorId;
    // 🔴 (2026-09-15) 조회 실패를 "담당의 없음"으로 접지 않는다 — 전파(크론이 실패를 로그로 남긴다)
    const adm = await this.prisma.admission.findFirst({ where: { patientId, status: 'ADMITTED' }, orderBy: { admitDate: 'desc' }, select: { attendingDoctorId: true } });
    return adm?.attendingDoctorId ?? null;
  }
}
