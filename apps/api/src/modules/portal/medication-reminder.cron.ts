import { Injectable, Logger } from '@nestjs/common';
import { todayDateOnly } from '../../common/day-range';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { parseFrequencySlots } from './frequency-slots.util';

/**
 * F-2 복약 리마인더 cron (기획 patient-portal-enhancement §3.2 · 설계 §3.2 — 선례 chronic-recall-cron)
 * - config `portal.medicationReminder`(기본 OFF) 게이트 — opt-in 기능이라 선례와 달리 게이트 추가
 * - 대상: NotificationSetting(type=MEDICATION_REMINDER, enabled) **opt-in 계정만** + 활성 admission 없는 환자
 *   (입원 중 원내 투약은 간호 MAR 소관 — 이중 알림 방지, 기획 §7-11 종결)
 * - 멱등: MedicationCheckLog (prescriptionId, slotDate, slot) UNIQUE — reminded_at 기존재 시 skip
 * - 발송: 이벤트 발행 → notification.listener 핸들러가 PatientNotification+FCM (관례 — createPatientPush는 private)
 */
@Injectable()
export class MedicationReminderCronService {
  private readonly logger = new Logger(MedicationReminderCronService.name);

  private static readonly DEFAULT_TIMES: Record<string, string> = {
    '아침 식후': '08:00',
    '점심 식후': '12:30',
    '저녁 식후': '18:30',
    '취침 전': '21:30',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sendReminders() {
    if ((await this.configRuntime.get('portal.medicationReminder')) !== true) return;

    const times =
      ((await this.configRuntime.get('portal.medicationReminderTimes')) as Record<string, string> | null) ??
      MedicationReminderCronService.DEFAULT_TIMES;
    const slotNow = this.resolveCurrentSlot(times, new Date());
    if (!slotNow) return;

    const dailyCap = Number((await this.configRuntime.get('portal.medicationReminderDailyCap')) ?? 6);
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정은 하루 밀린다(정본)

    // opt-in 계정만 (미등록 type이 설정 무시 발송되는 기존 갭을 재현하지 않음 — 설계 §0)
    const optIns = await this.prisma.notificationSetting.findMany({
      where: { type: 'MEDICATION_REMINDER', enabled: true },
      select: { account: { select: { patientId: true } } },
    });

    let sent = 0;
    for (const setting of optIns) {
      const patientId = setting.account?.patientId;
      if (!patientId) continue;
      try {
        sent += await this.remindPatient(patientId, slotNow, today, dailyCap);
      } catch (e) {
        this.logger.warn(`리마인더 처리 실패 patient=${patientId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (sent > 0) this.logger.log(`복약 리마인더 발송: 슬롯='${slotNow}' ${sent}건`);
  }

  /** 슬롯 발송 시각 ±15분 창에 현재 시각이 들어가는 슬롯 (없으면 null) */
  private resolveCurrentSlot(times: Record<string, string>, now: Date): string | null {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const [slot, hhmm] of Object.entries(times)) {
      const [h, m] = String(hhmm).split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      // 자정 wrap — 분 차이를 원형(mod 1440) 거리로 계산 (예: 23:55 슬롯 vs 00:05 현재 = 10분)
      const diff = Math.abs(nowMin - (h * 60 + m));
      if (Math.min(diff, 1440 - diff) <= 15) return slot;
    }
    return null;
  }

  private async remindPatient(patientId: string, slotNow: string, today: Date, dailyCap: number): Promise<number> {
    // 입원 중 제외 — 원내 투약은 간호 MAR 소관
    const admitted = await this.prisma.admission.findFirst({
      where: { patientId, status: 'ADMITTED' },
      select: { id: true },
    });
    if (admitted) return 0;

    // 계정당 일일 상한
    const sentToday = await this.prisma.medicationCheckLog.count({
      where: { patientId, slotDate: today, remindedAt: { not: null } },
    });
    if (sentToday >= dailyCap) return 0;

    // 발송 직전 재검증 — ACTIVE **약** 처방만(중단·취소 반영)
    // 🔴 W9(2026-08-14): type 필터가 없어 Prescription 에 함께 담기는 LAB/IMAGING 오더까지
    //    복약 리마인더 대상이었다(운영 환자 1인 기준 9건 중 9건이 검사·영상 오더).
    //    이름(medicationCode)이 없으니 "약 복용 시간입니다"만 반복 발송되고,
    //    MedicationCheckLog 에는 검사 오더에 대한 복약 기록이 남는다. 포털 조회 5곳과 동일 수렴.
    const rxList = await this.prisma.prescription.findMany({
      where: { status: 'ACTIVE', type: 'MEDICATION', encounter: { patientId } },
      include: { medicationCode: { select: { nameKo: true } } },
    });

    let sent = 0;
    for (const rx of rxList) {
      if (sentToday + sent >= dailyCap) break;
      if (!parseFrequencySlots(rx.frequency).includes(slotNow)) continue;

      // 멱등 — 이미 발송된 (처방, 오늘, 슬롯) 또는 환자가 이미 체크한 슬롯(taken != null)은 skip
      const existing = await this.prisma.medicationCheckLog.findUnique({
        where: { prescriptionId_slotDate_slot: { prescriptionId: rx.id, slotDate: today, slot: slotNow } },
        select: { remindedAt: true, taken: true },
      });
      if (existing?.remindedAt || existing?.taken != null) continue;

      await this.prisma.medicationCheckLog.upsert({
        where: { prescriptionId_slotDate_slot: { prescriptionId: rx.id, slotDate: today, slot: slotNow } },
        create: { patientId, prescriptionId: rx.id, slotDate: today, slot: slotNow, remindedAt: new Date() },
        update: { remindedAt: new Date() },
      });
      this.eventEmitter.emit('portal.medication_reminder', {
        patientId,
        prescriptionId: rx.id,
        slot: slotNow,
        medicationName: rx.medicationCode?.nameKo ?? undefined,
      });
      sent += 1;
    }
    return sent;
  }
}
