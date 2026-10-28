import { describe, it, expect, vi } from 'vitest';
import { QuestionnaireAdminService } from '../../src/modules/questionnaire/questionnaire-admin.service';

/**
 * 🔴 W8(P16) — 문진 SMS 는 `SMS_API_KEY` 가 **있으면** 주석 `// TODO` 만 두고 `{ sent: true }` 를
 *    돌려줬다(키를 넣는 순간 전건 "발송 완료"). 리마인더는 보내지도 않고 `reminderSentAt` 을 세워
 *    **그 환자가 다시는 리마인더를 못 받게** 만들었고, '재발송'은 상태만 'SENT' 로 바꿨다.
 *    지금은 발송 판정 정본(CrmChannelService)으로 수렴한다.
 */

/**
 * 목은 정본(`readSmsHeader`)의 실제 반환 모양 — SMS 머리말 `[기관명] ` 은
 * `systemConfig.findMany({where:{key:{in}},select:{key,value}})` 의 **DB 행**에서 온다(종전엔 '[Hospital RUN]' 상수).
 */
function prismaWith(extra: Record<string, unknown> = {}, hospitalName: string | null = '위루비병원') {
  return {
    systemConfig: { findMany: vi.fn(async () => (hospitalName ? [{ key: 'hospital.name', value: hospitalName }] : [])) },
    ...extra,
  } as never;
}

function channelReturning(r: { success: boolean; simulated?: boolean }) {
  return { send: vi.fn().mockResolvedValue(r) } as never;
}

describe('QuestionnaireAdminService — 발송 판정', () => {
  describe('sendViaSms', () => {
    it('🔴 제공자가 없으면 SIMULATED — 발송으로 세지 않는다', async () => {
      const svc = new QuestionnaireAdminService(prismaWith(), {} as never, channelReturning({ success: true, simulated: true }));
      const r = await svc.sendViaSms('p1', 'tok', '01012345678');
      expect(r.delivery).toBe('SIMULATED');
      expect(r.message).toMatch(/보내지 않았습니다/);
    });

    it('실제로 나갔을 때만 SENT', async () => {
      const svc = new QuestionnaireAdminService(prismaWith(), {} as never, channelReturning({ success: true }));
      expect((await svc.sendViaSms('p1', 'tok', '01012345678')).delivery).toBe('SENT');
    });

    it('🔴 머리말 기관명은 정본(DB 행)에서 온다 — 미설정이면 머리말을 지어내지 않는다', async () => {
      const ch = channelReturning({ success: true }) as unknown as { send: ReturnType<typeof vi.fn> };
      await new QuestionnaireAdminService(prismaWith(), {} as never, ch as never).sendViaSms('p1', 'tok', '01012345678');
      expect(ch.send.mock.calls[0][3]).toMatch(/^\[위루비병원\] 사전 문진표/);
      expect(ch.send.mock.calls[0][3]).not.toContain('Hospital RUN');

      const ch2 = channelReturning({ success: true }) as unknown as { send: ReturnType<typeof vi.fn> };
      await new QuestionnaireAdminService(prismaWith({}, null), {} as never, ch2 as never).sendViaSms('p1', 'tok', '01012345678');
      expect(ch2.send.mock.calls[0][3]).toMatch(/^사전 문진표/);
    });

    it('🔴 연락처가 없으면 시도하지 않고 FAILED', async () => {
      const channel = channelReturning({ success: true }) as unknown as { send: ReturnType<typeof vi.fn> };
      const svc = new QuestionnaireAdminService(prismaWith(), {} as never, channel as never);
      expect((await svc.sendViaSms('p1', 'tok', null)).delivery).toBe('FAILED');
      expect(channel.send).not.toHaveBeenCalled();
    });
  });

  describe('sendReminders', () => {
    const pending = [
      { id: 't1', patientId: 'p1', token: 'tok1', patient: { phone: '01011112222' } },
      { id: 't2', patientId: 'p2', token: 'tok2', patient: { phone: null } },
    ];

    it('🔴 나가지 않은 건은 reminderSentAt 을 찍지 않는다(미발송의 영구화 차단)', async () => {
      const update = vi.fn().mockResolvedValue({});
      const prisma = prismaWith({ questionnaireToken: { findMany: vi.fn().mockResolvedValue(pending), update } });
      const svc = new QuestionnaireAdminService(prisma, {} as never, channelReturning({ success: true, simulated: true }));

      const r = await svc.sendReminders();

      expect(r.total).toBe(2);
      expect(r.sent).toBe(0);
      expect(r.simulated).toBe(1);
      expect(r.failed).toBe(1); // 연락처 없음
      expect(update).not.toHaveBeenCalled();
    });

    it('실제로 나간 건만 마킹한다', async () => {
      const update = vi.fn().mockResolvedValue({});
      const prisma = prismaWith({ questionnaireToken: { findMany: vi.fn().mockResolvedValue(pending), update } });
      const svc = new QuestionnaireAdminService(prisma, {} as never, channelReturning({ success: true }));

      const r = await svc.sendReminders();

      expect(r.sent).toBe(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1' } }));
    });
  });

  describe('resend', () => {
    const token = { id: 't1', patientId: 'p1', token: 'tok1', patient: { familyName: '김', givenName: '환자', phone: '01011112222' } };

    it('🔴 보내지 못했으면 상태를 SENT 로 바꾸지 않는다 (만료 연장만)', async () => {
      const update = vi.fn().mockResolvedValue({});
      const prisma = prismaWith({ questionnaireToken: { findUnique: vi.fn().mockResolvedValue(token), update } });
      const svc = new QuestionnaireAdminService(prisma, {} as never, channelReturning({ success: true, simulated: true }));

      const r = await svc.resend('t1');

      expect(r.delivery).toBe('SIMULATED');
      expect(update).toHaveBeenCalledTimes(1); // 만료 연장 1회뿐
      expect(update.mock.calls[0][0].data).not.toHaveProperty('status');
    });

    it('나갔으면 발송 상태를 기록한다', async () => {
      const update = vi.fn().mockResolvedValue({});
      const prisma = prismaWith({ questionnaireToken: { findUnique: vi.fn().mockResolvedValue(token), update } });
      const svc = new QuestionnaireAdminService(prisma, {} as never, channelReturning({ success: true }));

      const r = await svc.resend('t1');

      expect(r.delivery).toBe('SENT');
      expect(update).toHaveBeenCalledTimes(2);
      expect(update.mock.calls[1][0].data).toMatchObject({ status: 'SENT' });
    });
  });
});
