import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';

/**
 * 진료비 단계적 발생(progressive billing) — 행위 시행 완료 이벤트마다 라인 1건 발행.
 * 발생/정산은 동일 lineId(=prescriptionId)·ref로 ERP 멱등 upsert(이중과금 0).
 */
@Injectable()
export class BillingAccrualListener {
  private readonly logger = new Logger(BillingAccrualListener.name);

  constructor(private readonly billing: BillingService) {}

  @OnEvent('lab.result.completed')
  async onLab(payload: { prescriptionId?: string }) {
    await this.accrue(payload?.prescriptionId, 'lab');
  }

  @OnEvent('imaging.result.reported')
  async onImaging(payload: { prescriptionId?: string }) {
    await this.accrue(payload?.prescriptionId, 'imaging');
  }

  @OnEvent('dispensing.completed')
  async onDispensing(payload: { prescriptionId?: string; orderId?: string }) {
    // 조제 이벤트는 prescriptionId 미동봉 — orderId가 prescription 참조인 경우만(없으면 정산서 발생)
    await this.accrue(payload?.prescriptionId, 'dispensing');
  }

  @OnEvent('therapy.session.completed')
  async onTherapyCompleted(payload: { prescriptionId?: string }) {
    // 치료 세션 완료 — 수가코드 있는 처방만 라인 발행(코드 미해석은 emitAccrualLine이 미발행)
    await this.accrue(payload?.prescriptionId, 'therapy');
  }

  @OnEvent('compounding.released')
  async onCompoundingReleased(payload: { prescriptionId?: string }) {
    // 무균조제 불출 — 처방 연동 건만 라인 발행(lineId=prescriptionId라 일반 조제 완료와 멱등·이중과금 없음)
    await this.accrue(payload?.prescriptionId, 'compounding');
  }

  @OnEvent('order.cancelled')
  async onCancel(payload: { prescriptionId?: string }) {
    if (!payload?.prescriptionId) return;
    await this.billing.emitAccrualLine(payload.prescriptionId, true).catch((e) =>
      this.logger.warn(`accrual cancel 실패: ${(e as Error).message}`),
    );
  }

  private async accrue(prescriptionId: string | undefined, src: string) {
    if (!prescriptionId) return; // 처방 출처 없으면 정산 시 일괄 반영
    try {
      await this.billing.emitAccrualLine(prescriptionId, false);
    } catch (e) {
      this.logger.warn(`accrual(${src}) 실패: ${(e as Error).message}`);
    }
  }
}
