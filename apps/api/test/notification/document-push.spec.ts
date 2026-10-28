import { describe, it, expect, vi } from 'vitest';
import { NotificationListener } from '../../src/modules/notification/notification.listener';

/**
 * 서류 발급 완료·반려 → 환자 앱(2026-10-10).
 * 🔴 종전엔 개별 서류가 발급·반려돼도 환자에게 아무것도 가지 않았다(실손 번들만). 이제 게이트(마스터·유형 설정 · 기본 OFF)를 거쳐 보낸다.
 */
function mk(req: { bundleId: string | null; deliveryMethod: string } | null) {
  const deliver = vi.fn(async () => ({ attempted: true, sent: true, reason: 'SENT', pushChannel: 'UNAVAILABLE' }));
  const prisma = { documentRequest: { findUnique: vi.fn(async () => req) } };
  const l = new NotificationListener({} as never, {} as never, prisma as never, { deliver } as never);
  return { l, deliver };
}

describe('서류 발급 환자 알림', () => {
  it('개별 신청 발급 완료 → 게이트로(DOCUMENT_READY) · 수령 방법별 문구', async () => {
    for (const [m, phrase] of [['PORTAL', '내려받'], ['VISIT', '창구'], ['MAIL', '신청하신 방법']] as const) {
      const { l, deliver } = mk({ bundleId: null, deliveryMethod: m });
      await l.handleDocumentReadyForPatient({ requestId: 'r1', patientId: 'p1' });
      expect(deliver).toHaveBeenCalledWith('p1', 'DOCUMENT_READY', '서류 발급 완료', expect.stringContaining(phrase));
    }
  });
  it('실손 번들 소속은 보내지 않는다(번들 알림 몫 — 두 번 알리지 않는다) · 없는 요청도', async () => {
    for (const req of [{ bundleId: 'b1', deliveryMethod: 'PORTAL' }, null]) {
      const { l, deliver } = mk(req);
      const r = await l.handleDocumentReadyForPatient({ requestId: 'r1', patientId: 'p1' });
      expect(deliver).not.toHaveBeenCalled();
      expect(r.reason).toBe('NOT_APPLICABLE');
    }
  });
  it('🔴 반려 → 게이트로(DOCUMENT_REJECTED) · 사유는 싣지 않는다(잠금 화면)', async () => {
    const { l, deliver } = mk(null);
    await l.handleDocumentRejectedForPatient({ requestId: 'r1', patientId: 'p1' });
    const [, type, , body] = deliver.mock.calls[0] as unknown as [string, string, string, string];
    expect(type).toBe('DOCUMENT_REJECTED');
    expect(body).not.toMatch(/NOT_ELIGIBLE|INSUFFICIENT|NO_RECORD/);
  });
});
