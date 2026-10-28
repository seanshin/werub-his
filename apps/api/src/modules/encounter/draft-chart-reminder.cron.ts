import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 처방 달린 미서명(DRAFT) 진료 회수 알림 — 2026-08-03 신설.
 *
 * 🔴 처방은 이미 나갔는데 차트가 안 닫힌 진료가 쌓이고 있었다(운영 실측 30건·처방 111건).
 *    서명 전 진료는 법정 기록이 미완결이고, 서명이 청구 트리거라 수납·청구도 막힌다.
 *    대기열 완료 게이트(queue.completeRequiresSign)는 대기열 경유가 아닌 경로(CPOE·워크스테이션)를
 *    막지 못한다 — 그래서 쌓인 뒤에 담당의에게 회수를 알리는 크론이 필요하다.
 *
 * config `encounter.draftReminder.afterHours`(0=OFF 기본) · 매일 08시(pm2 TZ=KST).
 * 같은 진료 재알림은 `repeatDays` 간격으로 억제(매일 쏘면 알림 무시가 학습된다).
 *
 * 🔴 2026-10-10 수신자 — 진료의 doctorId 를 그대로 받던 탓에 관리자 계정이 연 진료 93건의 회수 알림이
 *    관리자 한 계정에 몰렸다(운영 실측 알림 1,341건 중 1,341건이 admin · 경보 등록부 targetRoles 는 DOCTOR).
 *    수신자는 작성 의사(활성 DOCTOR) → 담당의(입원 주치의·예약 의사 중 활성 DOCTOR) → 없으면 보내지 않고
 *    "수신자 없음"으로 센다(관리자에게 몰지 않는다 — 몰면 아무도 안 읽는 알림이 쌓인다).
 */
@Injectable()
export class DraftChartReminderCron {
  private readonly logger = new Logger(DraftChartReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Optional() private readonly config?: ConfigRuntimeService, // 미주입=OFF(무중단)
  ) {}

  @Cron('0 8 * * *', { name: 'draft-chart-reminder' })
  async remindDraftCharts(): Promise<{ notified: number; targets: number; noRecipient: number }> {
    const hours = Number((await this.config?.get('encounter.draftReminder.afterHours').catch(() => 0)) ?? 0);
    if (!hours || hours <= 0) return { notified: 0, targets: 0, noRecipient: 0 };
    const rd = Number(await this.config?.get('encounter.draftReminder.repeatDays').catch(() => 3));
    const repeatDays = Number.isFinite(rd) && rd > 0 ? rd : 3;

    const cutoff = new Date(Date.now() - hours * 3600_000);
    // 처방이 달린 DRAFT 만 — 처방 없는 DRAFT 는 진행 중 작성일 수 있다(회수 대상은 발행이 끝난 쪽)
    const drafts = await this.prisma.encounter.findMany({
      // doctorId 는 스키마상 필수(non-null) — 별도 필터 불요
      where: {
        status: 'DRAFT',
        createdAt: { lt: cutoff },
        prescriptions: { some: {} },
      },
      select: {
        id: true, doctorId: true, createdAt: true,
        doctor: { select: DOCTOR_PICK },
        admission: { select: { attendingDoctorId: true, attendingDoctor: { select: DOCTOR_PICK } } },
        appointment: { select: { doctorId: true, doctor: { select: DOCTOR_PICK } } },
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        _count: { select: { prescriptions: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200, // 폭주 방지 — 남은 건 다음 날 이어서
    });
    if (!drafts.length) return { notified: 0, targets: 0, noRecipient: 0 };

    const dedupeSince = new Date(Date.now() - repeatDays * 86_400_000);
    let notified = 0;
    let noRecipient = 0;
    for (const e of drafts) {
      const recipientId = draftChartRecipient(e);
      if (!recipientId) { noRecipient += 1; continue; }
      try {
        // 재알림 억제 — 같은 진료 알림이 repeatDays 내 있으면 스킵
        const recent = await this.prisma.notification.findFirst({
          where: { type: 'DRAFT_CHART_REMINDER', refId: e.id, createdAt: { gte: dedupeSince } },
          select: { id: true },
        });
        if (recent) continue;

        const days = Math.floor((Date.now() - e.createdAt.getTime()) / 86_400_000);
        // refId 는 엔티티 id(UUID) — 코드·MRN 을 넣으면 알림 자체가 유실된다(notification refId 계약)
        await this.notifications.notify(recipientId, {
          type: 'DRAFT_CHART_REMINDER',
          title: '📝 미서명 차트 회수',
          message: `${e.patient.familyName}${e.patient.givenName}(${e.patient.mrn}) — 처방 ${e._count.prescriptions}건이 발행됐는데 차트가 ${days}일째 미서명입니다. 서명해야 기록이 완결되고 수납·청구가 진행됩니다.`,
          severity: 'WARNING',
          refType: 'DRAFT_CHART',
          refId: e.id,
        });
        notified += 1;
      } catch (err) {
        this.logger.warn(`미서명 차트 알림 실패 encounter=${e.id}: ${(err as Error).message}`);
      }
    }
    if (notified) this.logger.log(`미서명 차트 회수 알림 ${notified}건 (대상 ${drafts.length})`);
    // 수신자 없음은 조용히 넘기지 않는다 — 작성자가 의사가 아니거나 비활성이고 담당의도 없는 진료(관리 화면·로그가 말한다)
    if (noRecipient) this.logger.warn(`미서명 차트 회수 알림 수신자 없음 ${noRecipient}건 — 작성자가 활성 의사가 아니고 담당의도 없다`);
    return { notified, targets: drafts.length, noRecipient };
  }
}

const DOCTOR_PICK = { role: true, isActive: true } as const;
type Pickable = { role: string; isActive: boolean } | null | undefined;
const isActiveDoctor = (u: Pickable) => !!u && u.isActive && u.role === 'DOCTOR';

/** 회수 알림 수신자 — 작성 의사 → 입원 주치의 → 예약 의사 · 모두 활성 DOCTOR 일 때만 · 없으면 null(관리자 대체 없음) */
export function draftChartRecipient(e: {
  doctorId: string;
  doctor?: Pickable;
  admission?: { attendingDoctorId: string | null; attendingDoctor?: Pickable } | null;
  appointment?: { doctorId: string; doctor?: Pickable } | null;
}): string | null {
  if (isActiveDoctor(e.doctor)) return e.doctorId;
  if (e.admission?.attendingDoctorId && isActiveDoctor(e.admission.attendingDoctor)) return e.admission.attendingDoctorId;
  if (e.appointment?.doctorId && isActiveDoctor(e.appointment.doctor)) return e.appointment.doctorId;
  return null;
}
