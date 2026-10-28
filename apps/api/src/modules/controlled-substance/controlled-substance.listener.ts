import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ControlledSubstanceService } from './controlled-substance.service';

/**
 * 약국 조제 완료 → 마약류 통제원장 상태 전이(PRESCRIBED/VERIFIED → DISPENSED).
 * CPOE 자동발행 원장(prescriptionId 링크)이 대상 — 원장 없는 처방은 no-op.
 * best-effort: 원장 전이 실패가 조제 흐름에 영향 주지 않음.
 */
@Injectable()
export class ControlledSubstanceListener {
  private readonly logger = new Logger(ControlledSubstanceListener.name);

  constructor(private readonly cs: ControlledSubstanceService) {}

  @OnEvent('dispensing.completed')
  async onDispensingCompleted(evt: { prescriptionId?: string; dispensedBy?: string }) {
    if (!evt?.prescriptionId) return;
    try {
      const r = await this.cs.markDispensedByPrescription(evt.prescriptionId, evt.dispensedBy);
      if (r) this.logger.log(`마약류 원장 조제 전이: rx=${evt.prescriptionId} log=${r.id}`);
    } catch (e) {
      this.logger.warn(`마약류 원장 조제 전이 실패 rx=${evt.prescriptionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
