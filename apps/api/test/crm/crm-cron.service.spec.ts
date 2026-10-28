import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CrmCronService } from '../../src/modules/crm/crm-cron.service';

describe('CRM 자동화 크론 (F: spec 밀도 보강)', () => {
  let service: CrmCronService;
  let mockPrisma: any;
  let mockChannel: any;

  const DAY = 86400_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 8, 0, 0)); // 2026-07-20 월
    mockPrisma = {
      appointment: { findMany: vi.fn().mockResolvedValue([]) },
      checkupFollowUp: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
      patient: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      encounter: { groupBy: vi.fn().mockResolvedValue([]) },
      billing: { groupBy: vi.fn().mockResolvedValue([]) },
      patientCommunicationLog: { create: vi.fn().mockResolvedValue({}) },
    };
    // 기본은 실제 발송 성공 — 미구현 채널/실패는 각 테스트에서 명시한다
    mockChannel = { send: vi.fn().mockResolvedValue({ success: true }) };
    service = new CrmCronService(mockPrisma, mockChannel as any);
  });
  afterEach(() => vi.useRealTimers());

  describe('이탈 감지(churn)', () => {
    const setup = (lastVisits: Record<string, Date | null>) => {
      mockPrisma.patient.findMany.mockResolvedValue(Object.keys(lastVisits).map((id) => ({ id })));
      mockPrisma.encounter.groupBy.mockResolvedValue(
        Object.entries(lastVisits).filter(([, d]) => d).map(([patientId, d]) => ({ patientId, _max: { createdAt: d } })),
      );
    };

    it('마지막 진료 180일 초과·없음=HIGH · 90~180일=MEDIUM · 90일내=LOW', async () => {
      const now = Date.now();
      setup({
        h1: new Date(now - 200 * DAY), // HIGH
        h2: null,                       // HIGH(진료 없음)
        m1: new Date(now - 120 * DAY), // MEDIUM
        l1: new Date(now - 30 * DAY),  // LOW
      });
      await service.churnDetection();
      const calls = mockPrisma.patient.updateMany.mock.calls;
      const byRisk = (risk: string) => calls.find((c: any) => c[0].data.churnRisk === risk)?.[0].where.id.in ?? [];
      expect(byRisk('HIGH').sort()).toEqual(['h1', 'h2']);
      expect(byRisk('MEDIUM')).toEqual(['m1']);
      expect(byRisk('LOW')).toEqual(['l1']);
    });

    it('경계값 — 정확히 90일은 LOW(초과 아님)', async () => {
      setup({ b1: new Date(Date.now() - 90 * DAY + 1000) }); // 90일 직전 → LOW
      await service.churnDetection();
      const low = mockPrisma.patient.updateMany.mock.calls.find((c: any) => c[0].data.churnRisk === 'LOW');
      expect(low?.[0].where.id.in).toEqual(['b1']);
    });
  });

  describe('RFM 계산', () => {
    const runRfm = async (r: Date | null, f: number, m: number) => {
      mockPrisma.patient.findMany.mockResolvedValue([{ id: 'p1' }]);
      mockPrisma.encounter.groupBy
        .mockResolvedValueOnce(r ? [{ patientId: 'p1', _max: { createdAt: r } }] : [])
        .mockResolvedValueOnce([{ patientId: 'p1', _count: f }]);
      mockPrisma.billing.groupBy.mockResolvedValue([{ patientId: 'p1', _sum: { totalAmount: m } }]);
      await service.rfmCalculation();
      return mockPrisma.patient.updateMany.mock.calls[0][0].data;
    };

    it('최근·빈번·고액 = CHAMPION', async () => {
      const d = await runRfm(new Date(Date.now() - 10 * DAY), 12, 6_000_000);
      expect(d.rfmSegment).toBe('CHAMPION');
      expect(d.crmScore).toBe(100); // (5+5+5)/3*20
    });

    it('오래됨+빈번 = AT_RISK', async () => {
      const d = await runRfm(new Date(Date.now() - 300 * DAY), 6, 0); // r=2, f=4
      expect(d.rfmSegment).toBe('AT_RISK');
    });

    it('오래됨+저빈도 = CHURNED', async () => {
      const d = await runRfm(new Date(Date.now() - 400 * DAY), 0, 0); // r=1, f=1(0회→1점), m=1
      expect(d.rfmSegment).toBe('CHURNED');
    });

    it('진료 이력 없음 = NEW(999일·frequency 0)', async () => {
      const d = await runRfm(null, 0, 0);
      expect(d.rfmSegment).toBe('NEW');
      expect(d.crmScore).toBe(20); // (1+1+1)/3*20
    });
  });

  describe('예약 리마인더(D-1)', () => {
    it('내일 SCHEDULED 예약만 대상·PUSH 로그 생성', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([
        { scheduledAt: new Date(2026, 6, 21, 14, 30), patient: { id: 'p1', familyName: '김', givenName: '환자', phone: '010-0000-0000' }, doctor: { department: '내과' } },
      ]);
      await service.appointmentReminder();
      const where = mockPrisma.appointment.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('SCHEDULED');
      expect(mockPrisma.patientCommunicationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'PUSH', type: 'REMINDER', patientId: 'p1' }) }),
      );
    });

    /**
     * 🔴 리마인더 크론이 **채널을 부르지 않고** 'SENT' 만 적던 것(W6).
     * 환자에게 가지 않은 문자가 CRM 이력에 '발송 완료'로 남았다.
     */
    it('🔴 실제로 채널을 부른다 — 부르지 않고 SENT 를 적지 않는다', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([
        { scheduledAt: new Date(2026, 6, 21, 14, 30), patient: { id: 'p1', familyName: '김', givenName: '환자', phone: '010-0000-0000' }, doctor: { department: '내과' } },
      ]);
      await service.appointmentReminder();
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(mockChannel.send).toHaveBeenCalledWith('PUSH', '010-0000-0000', '예약 리마인더', expect.stringContaining('내일'));
    });

    it('🔴 채널이 미구현이면 SENT 가 아니라 SIMULATED 로 적는다', async () => {
      mockChannel.send.mockResolvedValue({ success: true, simulated: true });
      mockPrisma.appointment.findMany.mockResolvedValue([
        { scheduledAt: new Date(2026, 6, 21, 14, 30), patient: { id: 'p1', familyName: '김', givenName: '환자', phone: '010-0000-0000' }, doctor: { department: '내과' } },
      ]);
      await service.appointmentReminder();
      expect(mockPrisma.patientCommunicationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SIMULATED' }) }),
      );
    });

    it('🔴 연락처가 없으면 보낼 수 없다 — FAILED 로 적고 채널을 부르지 않는다', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([
        { scheduledAt: new Date(2026, 6, 21, 14, 30), patient: { id: 'p1', familyName: '김', givenName: '환자', phone: null }, doctor: { department: '내과' } },
      ]);
      await service.appointmentReminder();
      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(mockPrisma.patientCommunicationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });
  });

  describe('검진 리마인더', () => {
    it('D-1 발송 시 reminderSent=true 멱등 마킹(재발송 방지)', async () => {
      mockPrisma.checkupFollowUp.findMany
        .mockResolvedValueOnce([]) // D-7 없음
        .mockResolvedValueOnce([{ id: 'fu-1', patient: { id: 'p1', familyName: '이', givenName: '검진', phone: '010-1111-2222' } }]); // D-1
      await service.checkupReminder();
      expect(mockPrisma.checkupFollowUp.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'fu-1' }, data: { reminderSent: true } }),
      );
    });

    it('🔴 나가지 않았으면 reminderSent 를 세우지 않는다 — 세우면 다시는 안 보낸다', async () => {
      mockChannel.send.mockResolvedValue({ success: true, simulated: true });
      mockPrisma.checkupFollowUp.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'fu-1', patient: { id: 'p1', familyName: '이', givenName: '검진', phone: '010-1111-2222' } }]);
      await service.checkupReminder();
      expect(mockPrisma.checkupFollowUp.update).not.toHaveBeenCalled();
    });

    it('D-7 대상 필터 — completedAt null·reminderSent false만', async () => {
      await service.checkupReminder();
      const d7Where = mockPrisma.checkupFollowUp.findMany.mock.calls[0][0].where;
      expect(d7Where.completedAt).toBeNull();
      expect(d7Where.reminderSent).toBe(false);
    });
  });
});
