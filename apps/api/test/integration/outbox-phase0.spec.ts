import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { IntegrationOutboxService, PHI_GRADE_EVENTS } from '../../src/modules/integration/integration-outbox.service';

/** Phase0(배치중립) — P0-1 가명화 게이트·P0-2 웹훅 egress 가드/PHI 와일드카드 제외 */
describe('IntegrationOutboxService — Phase0', () => {
  let svc: IntegrationOutboxService;
  let prisma: any;
  let config: any;
  const cfg: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(cfg)) delete cfg[k];
    prisma = {
      hisWebhook: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(({ data }: any) => Promise.resolve({ id: 'w1', ...data })), updateMany: vi.fn() },
      integrationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    };
    config = { get: vi.fn(async (k: string) => cfg[k]) };
    svc = new IntegrationOutboxService(prisma, config);
  });

  describe('P0-1 pseudonymizePayload', () => {
    const run = (p: object) => (svc as any).pseudonymizePayload(p);

    it('게이트 OFF(기본) — 원본 그대로', async () => {
      const r = await run({ chartNo: 'HR24-0001', amount: 100 });
      expect(r).toEqual({ chartNo: 'HR24-0001', amount: 100 });
    });

    it('ON+키 설정 — chartNo 제거·patientRef(HMAC 앞16) 치환·결정적', async () => {
      cfg['integration.pseudonymizeChartNo'] = true;
      cfg['integration.pseudonymKey'] = 'test-secret';
      const expected = createHmac('sha256', 'test-secret').update('HR24-0001').digest('hex').slice(0, 16);
      const r = await run({ chartNo: 'HR24-0001', amount: 100 });
      expect(r).toEqual({ amount: 100, patientRef: expected });
      // 결정적(환자당 안정 토큰 — ERP 대사 가능)
      expect(await run({ chartNo: 'HR24-0001' })).toEqual({ patientRef: expected });
      // 원본·토큰 동시 포함 금지
      expect((r as any).chartNo).toBeUndefined();
    });

    it('ON+키 미설정 — chartNo 제거만(fail-closed)', async () => {
      cfg['integration.pseudonymizeChartNo'] = true;
      const r = await run({ chartNo: 'HR24-0001', amount: 100 });
      expect(r).toEqual({ amount: 100 });
    });

    it('chartNo null/비문자열 — 필드 제거·chartNo 없는 페이로드는 무변', async () => {
      cfg['integration.pseudonymizeChartNo'] = true;
      cfg['integration.pseudonymKey'] = 'k';
      expect(await run({ chartNo: null, x: 1 })).toEqual({ x: 1 });
      expect(await run({ x: 1 })).toEqual({ x: 1 });
    });

    it('config 조회 오류 — chartNo 제거(원본 유출 차단)', async () => {
      config.get = vi.fn().mockRejectedValue(new Error('down'));
      const r = await run({ chartNo: 'HR24-0001', x: 1 });
      expect(r).toEqual({ x: 1 });
    });
  });

  describe('P0-2 PHI급 이벤트 와일드카드 제외', () => {
    it('* 구독자는 PHI급 이벤트 팬아웃 제외·명시 구독자는 수신', async () => {
      cfg['erp.webhookEnabled'] = false;
      prisma.hisWebhook.findMany.mockResolvedValue([
        { id: 'wild', targetUrl: 'https://a.example.com', events: ['*'], secret: 's', format: 'RAW' },
        { id: 'explicit', targetUrl: 'https://b.example.com', events: ['billing.line_recorded'], secret: 's', format: 'RAW' },
      ]);
      await svc.enqueue('billing', 'billing.line_recorded', 'ref1', { chartNo: 'X' });
      const rows = prisma.integrationOutbox.createMany.mock.calls[0][0].data;
      const targets = rows.map((r: any) => r.targetUrl);
      expect(targets).toEqual(['https://b.example.com']);
    });

    it('비PHI 이벤트는 * 구독 정상 팬아웃', async () => {
      cfg['erp.webhookEnabled'] = false;
      prisma.hisWebhook.findMany.mockResolvedValue([
        { id: 'wild', targetUrl: 'https://a.example.com', events: ['*'], secret: 's', format: 'RAW' },
      ]);
      await svc.enqueue('inventory', 'inventory.changed', 'ref2', { itemId: 'i1' });
      expect(prisma.integrationOutbox.createMany).toHaveBeenCalled();
      expect(PHI_GRADE_EVENTS.has('inventory.changed')).toBe(false);
    });
  });

  describe('test.* ERP 라우팅 제외 (2026-07 ERP 라이브니스 회신)', () => {
    it('test.ping 은 ERP 기본 수신부로 가지 않는다', async () => {
      cfg['erp.webhookEnabled'] = true;
      cfg['erp.webhookUrl'] = 'https://erp.example.com';
      prisma.hisWebhook.findMany.mockResolvedValue([]);
      await svc.enqueue('test', 'test.ping', 'enforce-gate-test-1', { ok: true });
      // ERP 기본 수신부만 제외 → 구독 웹훅도 없으므로 아무 행도 적재되지 않음
      expect(prisma.integrationOutbox.createMany).not.toHaveBeenCalled();
    });

    it('test.ping 을 명시 구독한 웹훅은 그대로 받는다(검증 유지)', async () => {
      cfg['erp.webhookEnabled'] = true;
      cfg['erp.webhookUrl'] = 'https://erp.example.com';
      prisma.hisWebhook.findMany.mockResolvedValue([
        { id: 'probe', targetUrl: 'https://probe.example.com', events: ['test.ping'], secret: 's', format: 'RAW' },
      ]);
      await svc.enqueue('test', 'test.ping', 'enforce-gate-test-2', { ok: true });
      const rows = prisma.integrationOutbox.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.targetUrl)).toEqual(['https://probe.example.com']);
    });

    it('운영 이벤트는 ERP 기본 수신부로 정상 라우팅', async () => {
      cfg['erp.webhookEnabled'] = true;
      cfg['erp.webhookUrl'] = 'https://erp.example.com';
      prisma.hisWebhook.findMany.mockResolvedValue([]);
      await svc.enqueue('billing', 'billing.line_recorded', 'ref-x', { amount: 1 });
      expect(prisma.integrationOutbox.createMany).toHaveBeenCalled();
      const rows = prisma.integrationOutbox.createMany.mock.calls[0][0].data;
      expect(rows[0].targetUrl).toContain('erp.example.com');
    });
  });

  describe('P0-2 웹훅 등록 egress 가드', () => {
    it('사설/loopback URL 등록 거부', async () => {
      for (const bad of ['http://127.0.0.1/hook', 'http://10.0.0.5/hook', 'http://192.168.1.9/x', 'http://169.254.1.1/x']) {
        await expect(svc.createWebhook({ name: 't', targetUrl: bad, events: ['staff.created'] })).rejects.toThrow();
      }
    });

    it('공인 URL은 등록 허용', async () => {
      const r = await svc.createWebhook({ name: 't', targetUrl: 'https://hooks.example.com/x', events: ['staff.created'] });
      expect(r.id).toBe('w1');
    });
  });
});
