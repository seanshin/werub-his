/**
 * CRM 포털 메시지 — 받을 곳이 없으면 보냈다고 하지 않는다(2026-10-13 결함 발굴 C3).
 *  · 🔴 종전: 환자 포털 계정이 없어 알림을 안 만들었는데 통신 로그 SENT · success:true · 대량 발송 수에 셈
 */
import { describe, it, expect, vi } from 'vitest';
import { CrmService } from '../../src/modules/crm/crm.service';

const mk = (accounts: Record<string, boolean>) => {
  const logs: any[] = []; const notes: any[] = [];
  const prisma: any = {
    patientAccount: { findFirst: vi.fn(async ({ where }: any) => (accounts[where.patientId] ? { id: `acc-${where.patientId}` } : null)) },
    patientNotification: { create: vi.fn(async ({ data }: any) => { notes.push(data); return data; }) },
    patientCommunicationLog: { create: vi.fn(async ({ data }: any) => { logs.push(data); return data; }) },
  };
  return { svc: new CrmService(prisma as never, {} as never), logs, notes };
};

describe('🔴 포털 메시지 — 계정 없음은 미발송', () => {
  it('계정 없으면 FAILED · success:false · 알림 없음 · 대조군: 계정 있으면 SENT', async () => {
    const { svc, logs, notes } = mk({ p1: true });
    expect(await svc.sendPortalMessage({ patientId: 'p2', subject: 's', content: 'c' }, 'u')).toEqual({ success: false, reason: 'NO_PORTAL_ACCOUNT' });
    expect(logs[0].status).toBe('FAILED');
    expect(notes).toHaveLength(0);
    expect(await svc.sendPortalMessage({ patientId: 'p1', subject: 's', content: 'c' }, 'u')).toEqual({ success: true });
    expect(logs[1].status).toBe('SENT');
  });
  it('대량 — 보낸 수와 못 보낸 수를 따로', async () => {
    const { svc } = mk({ p1: true, p3: true });
    expect(await svc.sendPortalMessageBulk({ patientIds: ['p1', 'p2', 'p3'], subject: 's', content: 'c' }, 'u')).toEqual({ sentCount: 2, notSentCount: 1, requested: 3 });
  });
});
