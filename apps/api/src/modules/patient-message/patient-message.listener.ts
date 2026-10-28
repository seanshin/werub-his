import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification/notification.service';
import { JourneyService } from '../journey/journey.service';

export interface PatientMessageSentPayload {
  patientId: string;
  messageId: string;
  doctorId: string | null;
}

/**
 * 환자가 포털·앱에서 담당의에게 메시지를 보냈다 → 지정 의사에게 원내 알림 + 여정 이벤트.
 * 🔴 담당 미지정(doctorId null)이면 **알릴 사람이 없다** — 아무에게나 보내지 않는다.
 *    그 메시지는 받은편지함의 "담당 미지정" 묶음으로만 보인다(화면이 그 사실을 말한다).
 * 🔴 알림 본문에 메시지 내용을 싣지 않는다 — 내용은 스레드 열람(감사됨)에서만 본다.
 */
@Injectable()
export class PatientMessageListener {
  private readonly logger = new Logger(PatientMessageListener.name);

  constructor(
    private readonly notification: NotificationService,
    private readonly journey: JourneyService,
  ) {}

  @OnEvent('patient.message_sent')
  async onPatientMessageSent(payload: PatientMessageSentPayload) {
    if (!payload?.patientId) return;
    this.journey.emit({
      patientId: payload.patientId,
      eventType: 'PATIENT_MESSAGE_SENT',
      title: '담당의에게 메시지 전송',
      doctorId: payload.doctorId ?? undefined,
      refType: 'PatientMessage',
      refId: payload.messageId,
    });
    if (!payload.doctorId) return;
    try {
      await this.notification.notify(payload.doctorId, {
        type: 'PATIENT_MESSAGE',
        title: '환자 메시지 도착',
        message: '담당 환자에게서 새 메시지가 왔습니다. 환자 메시지함에서 확인하세요.',
        refType: 'PatientMessage',
        refId: payload.messageId,
      });
    } catch (e) {
      this.logger.warn(`PATIENT_MESSAGE notify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
