import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CrmCronService } from '../../src/modules/crm/crm-cron.service';
import { CrmChannelService } from '../../src/modules/crm/crm-channel.service';

/**
 * 🔴 가드 — **provider 부재 시 SENT 금지**(W8 2026-08-14).
 *
 * W6 에서 리마인더 4종은 `deliver()` 로 모아 "나간 대로 적게" 고쳤는데, 해외환자 사후관리
 * 4경로(D+1·D+7·D+30·D+180)는 `logComm()` 이라는 **두 번째 기록 경로**가 남아
 * `status:'SENT'` 를 무조건 찍었다. WHATSAPP/WECHAT 은 스텁이라 실발송 0인데 전건 '발송 완료'.
 * → 리마인더와 **같은 `deliver()`** 로 수렴(판정 로직을 새로 만들지 않는다).
 */
describe('CRM 해외환자 사후관리 — 발송 시도 ≠ 도달', () => {
  let service: CrmCronService;
  let prisma: any;
  let channel: any;

  const DAY = 86400_000;
  const caseRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1', status: 'DISCHARGED', interpreterLang: 'en', updatedAt: new Date(Date.now() - 1 * DAY),
    patient: { id: 'p1', familyName: '김', givenName: '해외', nameEn: 'John Doe', email: 'j@x.example', phone: '+8210', preferredLanguage: 'en' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      crmForeignPatientCase: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
      patientCommunicationLog: { create: vi.fn().mockResolvedValue({}) },
    };
    channel = {
      send: vi.fn().mockResolvedValue({ success: true }),
      getChannelForLanguage: vi.fn().mockReturnValue('WHATSAPP'),
      renderEmailTemplate: vi.fn().mockReturnValue('<html/>'),
    };
    service = new CrmCronService(prisma, channel as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it('🔴 채널을 실제로 부른다 — 종전엔 호출 없이 로그만 남겼다', async () => {
    prisma.crmForeignPatientCase.findMany.mockResolvedValue([caseRow()]);
    await service.foreignPatientFollowUp();
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('🔴 제공자 없음(simulated) 은 SENT 가 아니라 SIMULATED 로 적는다', async () => {
    prisma.crmForeignPatientCase.findMany.mockResolvedValue([caseRow()]);
    channel.send.mockResolvedValue({ success: true, simulated: true });
    const tally = await service.foreignPatientFollowUp();
    expect(prisma.patientCommunicationLog.create.mock.calls[0][0].data.status).toBe('SIMULATED');
    expect(tally).toEqual({ SENT: 0, SIMULATED: 1, FAILED: 0 });
  });

  it('🔴 수신처가 없으면 발송을 시도하지 않고 FAILED — 환자 UUID 로 대체하지 않는다', async () => {
    prisma.crmForeignPatientCase.findMany.mockResolvedValue([
      caseRow({ patient: { ...caseRow().patient, phone: null } }),
    ]);
    const tally = await service.foreignPatientFollowUp();
    expect(channel.send).not.toHaveBeenCalled();
    expect(prisma.patientCommunicationLog.create.mock.calls[0][0].data.status).toBe('FAILED');
    expect(tally.FAILED).toBe(1);
  });

  it('발송 실패는 FAILED · 실제 발송만 SENT', async () => {
    prisma.crmForeignPatientCase.findMany.mockResolvedValue([caseRow()]);
    channel.send.mockResolvedValue({ success: false, error: 'boom' });
    expect((await service.foreignPatientFollowUp()).FAILED).toBe(1);

    prisma.patientCommunicationLog.create.mockClear();
    channel.send.mockResolvedValue({ success: true });
    expect((await service.foreignPatientFollowUp()).SENT).toBe(1);
    expect(prisma.patientCommunicationLog.create.mock.calls[0][0].data.status).toBe('SENT');
  });

  it('D+7 결과요약(EMAIL)도 같은 판정을 쓴다 — 이메일 없으면 FAILED', async () => {
    prisma.crmForeignPatientCase.findMany.mockResolvedValue([
      caseRow({ status: 'FOLLOW_UP', updatedAt: new Date(Date.now() - 7 * DAY), patient: { ...caseRow().patient, email: null } }),
    ]);
    const tally = await service.foreignPatientFollowUp();
    expect(channel.send).not.toHaveBeenCalled();
    expect(tally.FAILED).toBe(1);
  });
});

/**
 * 🔴 채널 스텁이 `simulated` 없이 성공을 반환하면 위 가드가 전부 무력해진다 — 원천에서 막는다.
 */
describe('CrmChannelService — 스텁 채널은 반드시 simulated 를 세운다', () => {
  const prisma = () => ({ systemConfig: { findUnique: vi.fn().mockResolvedValue(null) }, patientAccount: { findFirst: vi.fn().mockResolvedValue(null) } }) as any;
  // 🔴 모드는 REAL 로 고정한다 — "스텁 채널은 실발송이 아니다"를 **발신이 허용된 상태에서** 확인해야
  //    의미가 있다. 리허설 모드로 두면 모드 차단 때문에 통과해 원래 검사가 헛돈다.
  const mode = (m: 'DEV' | 'REHEARSAL' | 'REAL' = 'REAL') => ({ effective: vi.fn().mockResolvedValue(m) }) as any;
  const svc = (m?: 'DEV' | 'REHEARSAL' | 'REAL') => new CrmChannelService(prisma(), mode(m));

  it('🔴 리얼이 아니면 구현된 채널도 나가지 않는다(리허설 중 실제 발송 사고 방지)', async () => {
    for (const m of ['DEV', 'REHEARSAL'] as const) {
      const r = await svc(m).send('EMAIL', 'a@b.example', 's', 'c');
      expect(r.simulated, `${m} 모드에서는 EMAIL 도 나가면 안 된다`).toBe(true);
      expect(r.messageId).toContain(`mode-${m.toLowerCase()}`);
    }
  });

  it('대조군 — 리얼 모드에서는 모드 차단이 끼어들지 않는다', async () => {
    // PORTAL 은 DB 기록 채널이라 실제 provider 를 탄다(모드 차단이면 messageId 가 mode- 로 시작한다)
    const r = await svc('REAL').send('PORTAL', 'x', 's', 'c');
    expect(String(r.messageId ?? '')).not.toContain('mode-');
  });

  it('WHATSAPP / WECHAT 은 실발송이 아니다', async () => {
    for (const ch of ['WHATSAPP', 'WECHAT']) {
      const r = await svc().send(ch, '+8210', 's', 'c');
      expect(r.simulated, `${ch} 는 제공자가 없다`).toBe(true);
    }
  });

  it('미등록 채널(SMS·PUSH)도 simulated', async () => {
    expect((await svc().send('SMS', '010', 's', 'c')).simulated).toBe(true);
    expect((await svc().send('PUSH', 'tok', 's', 'c')).simulated).toBe(true);
  });

  it('🔴 PORTAL 은 받을 계정이 없으면 성공이 아니다(fail-open 봉합)', async () => {
    const r = await svc().send('PORTAL', 'p1', 's', 'c');
    expect(r.success).toBe(false);
    expect(r.error).toBe('NO_PORTAL_ACCOUNT');
  });
});
