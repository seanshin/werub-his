import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationOutboxService, buildSlackMessage } from '../../src/modules/integration/integration-outbox.service';

describe('buildSlackMessage (W.Channel 리치카드)', () => {
  it('이벤트 라벨·color·fields·footer·title_link 구성', () => {
    const m = buildSlackMessage('billing.settled', 'voucher:settlement:1', { amount: 5000, currency: 'KRW', url: 'https://his.example.org/x', nested: { a: 1 } }) as any;
    expect(m.text).toContain('진료비 정산');
    expect(m.attachments[0].color).toBe('#2eb67d');
    expect(m.attachments[0].title_link).toBe('https://his.example.org/x');
    const keys = m.attachments[0].fields.map((f: any) => f.title);
    expect(keys).toContain('amount');
    expect(keys).toContain('currency');
    expect(keys).not.toContain('nested'); // 객체 필드는 제외(PHI/과다노출 방지)
    expect(m.attachments[0].footer).toContain('billing.settled');
  });
});

describe('IntegrationOutboxService — his_webhooks', () => {
  let svc: IntegrationOutboxService;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      hisWebhook: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn((a: any) => Promise.resolve({ id: 'w1', ...a.data })), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
      integrationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    config = { get: vi.fn().mockResolvedValue(undefined) }; // ERP 비활성
    svc = new IntegrationOutboxService(prisma, config);
  });

  it('eventCatalog: 알려진 이벤트 목록 반환', () => {
    const c = svc.eventCatalog();
    expect(c).toContain('staff.attendance_recorded');
    expect(c).toContain('billing.line_recorded');
  });

  describe('createWebhook 검증', () => {
    it('http(s) 아닌 targetUrl 거부', async () => {
      await expect(svc.createWebhook({ name: 'x', targetUrl: 'ftp://e', events: ['*'] })).rejects.toThrow(/http/);
    });
    it('유효 이벤트 없으면 거부', async () => {
      await expect(svc.createWebhook({ name: 'x', targetUrl: 'https://erp.example.com/hook', events: ['BOGUS'] })).rejects.toThrow(/이벤트/);
    });
    it('정상 등록 — secret 자동 생성', async () => {
      const r = await svc.createWebhook({ name: 'ERP', targetUrl: 'https://erp.example.com/hook', events: ['staff.attendance_recorded', '*'] });
      expect(prisma.hisWebhook.create).toHaveBeenCalled();
      const created = prisma.hisWebhook.create.mock.calls[0][0].data;
      expect(created.secret).toBeTruthy();
      expect(created.events).toEqual(['staff.attendance_recorded', '*']);
    });
  });

  describe('enqueue 팬아웃', () => {
    it('활성 구독이 이벤트 매칭 시 outbox 행에 secret + ref 접미(::wh:) 포함', async () => {
      prisma.hisWebhook.findMany.mockResolvedValue([{ id: 'wh-9', targetUrl: 'https://erp.example.com/hook', events: ['staff.attendance_recorded'], secret: 'sec' }]);
      await svc.enqueue('hr', 'staff.attendance_recorded', 'att:E1:100:CLOCK_IN', { x: 1 });
      const rows = prisma.integrationOutbox.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1); // ERP 비활성 → 구독행만
      expect(rows[0].targetUrl).toBe('https://erp.example.com/hook');
      expect(rows[0].secret).toBe('sec');
      expect(rows[0].ref).toBe('att:E1:100:CLOCK_IN::wh:wh-9');
    });

    it('이벤트 불일치 구독은 팬아웃 제외', async () => {
      prisma.hisWebhook.findMany.mockResolvedValue([{ id: 'wh-9', targetUrl: 'https://e/h', events: ['billing.settled'], secret: 's' }]);
      await svc.enqueue('hr', 'staff.attendance_recorded', 'r1', {});
      expect(prisma.integrationOutbox.createMany).not.toHaveBeenCalled(); // ERP도 비활성 → 행 0
    });

    it("'*' 구독은 모든 이벤트 수신", async () => {
      prisma.hisWebhook.findMany.mockResolvedValue([{ id: 'wAll', targetUrl: 'https://e/h', events: ['*'], secret: 's' }]);
      await svc.enqueue('billing', 'billing.settled', 'b1', {});
      const rows = prisma.integrationOutbox.createMany.mock.calls[0][0].data;
      expect(rows[0].ref).toBe('b1::wh:wAll');
    });
  });
});
