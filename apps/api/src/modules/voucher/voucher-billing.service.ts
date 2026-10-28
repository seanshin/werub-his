import { Injectable } from '@nestjs/common';
import { IntegrationOutboxService, type HisEvent } from '../integration/integration-outbox.service';

// 검진권 생애주기 자금 이벤트 → ERP(domain voucher→finance). ERP 미설정 시 outbox graceful skip.
// ⚠️ ERP 회신(Blocker 1): 임상 진료비 billing.line_recorded 핸들러와 충돌(lineId/chartNo 필수)하므로
//    검진권 전용 event_type 사용 — 정산=voucher.settled / 그 외=voucher.line_recorded.
// lineType: purchase|resale|commission|redeem|topup|refund|forfeit|settlement|redeem_reversal
@Injectable()
export class VoucherBillingService {
  constructor(private readonly outbox: IntegrationOutboxService) {}

  emit(lineType: string, ref: string, payload: Record<string, unknown>) {
    const eventType: HisEvent = lineType === 'settlement' ? 'voucher.settled' : 'voucher.line_recorded';
    void this.outbox.enqueue('voucher', eventType, `voucher:${lineType}:${ref}`, { lineType, source: 'voucher', ...payload });
  }
}
