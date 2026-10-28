import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrmService } from '../../src/modules/crm/crm.service';

describe('CRM 캠페인 발송 (F: spec 밀도 보강)', () => {
  let service: CrmService;
  let mockPrisma: any;
  let mockChannel: any;

  const campaign = (over: any = {}) => ({
    id: 'cmp-1', name: '검진 안내', type: 'PROMOTION', channel: 'SMS', status: 'DRAFT',
    subject: '건강검진', content: '{{patientName}}님, 검진 안내드립니다.', segmentId: 'seg-1',
    segment: {}, template: null, ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 10, 0, 0)); // 로컬 10:00 — 발송 허용 시간대
    mockPrisma = {
      crmCampaign: { findUnique: vi.fn().mockResolvedValue(campaign()), update: vi.fn().mockResolvedValue({}) },
      crmCampaignLog: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientCommunicationLog: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientConsentCrm: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve(create)) },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '영수', phone: '010-1234-5678' }) },
      crmSegment: { findUnique: vi.fn().mockResolvedValue({ id: 'seg-1', rules: {} }), update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve(data)) },
      $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    // 🔴 발송은 실제 채널 호출을 거친다(2026-08-13 W6) — 종전엔 호출 없이 전원 'SENT' 를 찍었다
    mockChannel = { send: vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' }) };
    service = new CrmService(mockPrisma, mockChannel);
    // 수신처가 있어야 보낼 수 있다 — 대상 조회가 phone/email 을 동봉한다
    vi.spyOn(service as any, 'getSegmentPatients').mockResolvedValue([
      { id: 'pt-1', familyName: '김', givenName: '영수', phone: '010-1234-5678', email: null },
      { id: 'pt-2', familyName: '이', givenName: '민지', phone: '010-2222-3333', email: null },
    ]);
    vi.spyOn(service as any, 'countSegmentPatients').mockResolvedValue(42);
  });

  afterEach(() => vi.useRealTimers());

  it('야간(21시 이후) 광고 발송 차단 — 정보통신망법 §50의8', async () => {
    vi.setSystemTime(new Date(2026, 6, 16, 22, 0, 0));
    await expect(service.sendCampaign('cmp-1')).rejects.toThrow(/08:00~21:00/);
  });

  it('마케팅 동의 없는 대상은 CONSENT_DENIED로 제외·동의자만 발송', async () => {
    mockPrisma.patientConsentCrm.findMany.mockResolvedValue([{ patientId: 'pt-1' }]); // pt-1만 동의
    const r = await service.sendCampaign('cmp-1');
    expect(r).toEqual({ sentCount: 1, failedCount: 1, totalTargets: 2 });
    expect(mockChannel.send, '동의자에게만 실제 발송을 시도한다').toHaveBeenCalledTimes(1);
    const logs = mockPrisma.crmCampaignLog.createMany.mock.calls[0][0].data;
    expect(logs.find((l: any) => l.patientId === 'pt-2')).toMatchObject({ status: 'FAILED', errorMessage: 'CONSENT_DENIED' });
  });

  it('진료 목적 REMINDER는 동의 확인 없이 발송', async () => {
    mockPrisma.crmCampaign.findUnique.mockResolvedValue(campaign({ type: 'REMINDER' }));
    const r = await service.sendCampaign('cmp-1');
    expect(r.sentCount).toBe(2);
    expect(mockPrisma.patientConsentCrm.findMany).not.toHaveBeenCalled();
  });

  it('🔴 수신처(phone/email)가 없으면 발송하지 않는다 — 종전엔 null 이어도 SENT 로 셌다', async () => {
    mockPrisma.crmCampaign.findUnique.mockResolvedValue(campaign({ type: 'REMINDER' }));
    vi.spyOn(service as any, 'getSegmentPatients').mockResolvedValue([
      { id: 'pt-9', familyName: '박', givenName: '무연락', phone: null, email: null },
    ]);
    const r = await service.sendCampaign('cmp-1');
    expect(r.sentCount).toBe(0);
    expect(r.failedCount).toBe(1);
    const logs = mockPrisma.crmCampaignLog.createMany.mock.calls[0][0].data;
    expect(logs[0]).toMatchObject({ status: 'FAILED', errorMessage: 'NO_CONTACT' });
    expect(mockChannel.send).not.toHaveBeenCalled();
  });

  it('🔴 제공자가 없어 나가지 않은 건은 SENT 가 아니다(SIMULATED)', async () => {
    mockPrisma.crmCampaign.findUnique.mockResolvedValue(campaign({ type: 'REMINDER' }));
    mockChannel.send.mockResolvedValue({ success: true, simulated: true });
    const r = await service.sendCampaign('cmp-1');
    expect(r.sentCount, '기록만 된 것을 발송으로 세면 화면이 "발송 완료"라 거짓말한다').toBe(0);
    const logs = mockPrisma.crmCampaignLog.createMany.mock.calls[0][0].data;
    expect(logs[0]).toMatchObject({ status: 'SIMULATED', errorMessage: 'SIMULATED_NO_PROVIDER' });
  });

  it('🔴 도달수는 발송수의 복사본이 아니다 — 확인 경로가 없으면 0', async () => {
    mockPrisma.crmCampaign.findUnique.mockResolvedValue(campaign({ type: 'REMINDER' }));
    await service.sendCampaign('cmp-1');
    const upd = mockPrisma.crmCampaign.update.mock.calls[0][0].data;
    expect(upd.sentCount).toBe(2);
    expect(upd.deliveredCount, 'deliveredCount = sentCount 는 도달률 100%를 정의상 참으로 만든다').toBe(0);
  });

  it('변수 치환 — {{patientName}} 실명 반영', async () => {
    mockPrisma.crmCampaign.findUnique.mockResolvedValue(campaign({ type: 'REMINDER' }));
    await service.sendCampaign('cmp-1');
    const comm = mockPrisma.patientCommunicationLog.createMany.mock.calls[0][0].data[0];
    expect(comm.content).toBe('김영수님, 검진 안내드립니다.');
  });

  it('DRAFT/SCHEDULED 외 상태는 발송 거부', async () => {
    mockPrisma.crmCampaign.findUnique.mockResolvedValue(campaign({ status: 'COMPLETED' }));
    await expect(service.sendCampaign('cmp-1')).rejects.toThrow(/발송 가능한 상태/);
  });

  it('동의 철회 시 withdrawnAt 기록·consented=false', async () => {
    const r = await service.updatePatientConsent('pt-1', { channel: 'SMS', type: 'MARKETING', consented: false });
    expect(r.consented).toBe(false);
    expect(r.withdrawnAt).toBeInstanceOf(Date);
    expect(r.consentedAt).toBeUndefined();
  });

  it('세그먼트 새로고침 — patientCount 재계산', async () => {
    const r = await service.refreshSegment('seg-1');
    expect(r.patientCount).toBe(42);
    expect(r.lastRefreshedAt).toBeInstanceOf(Date);
  });
});
