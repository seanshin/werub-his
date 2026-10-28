import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataQualityService } from '../../src/modules/data-quality/data-quality.service';

/** P3 — C3 아웃리치·C4 정규화(결정적 규칙·감사) */
describe('DataQualityService — P3', () => {
  let svc: any;
  let prisma: any;
  const cfg: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(cfg)) delete cfg[k];
    prisma = {
      patient: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    svc = new DataQualityService(prisma, { get: vi.fn(async (k: string) => cfg[k]) } as never);
  });

  describe('C4 전화 정규화(결정적)', () => {
    const n = (v: string) => (svc as any).normalizePhone(v);
    it('국내 0-prefix → +82 변환', () => {
      expect(n('010-1234-5678')).toBe('+821012345678');
      expect(n('02 123 4567')).toBe('+8221234567');
    });
    it('이미 E.164면 유지·해석 불가는 제안 안 함(null)', () => {
      expect(n('+821012345678')).toBe('+821012345678');
      expect(n('1234')).toBeNull();
      expect(n('없음')).toBeNull();
    });
    it('적용 — 변경분만 update+감사로그 before/after', async () => {
      prisma.patient.findUnique.mockResolvedValue({ phone: '010-1111-2222' });
      const r = await svc.normalizeApply(['p1'], 'u1');
      expect(r.applied).toBe(1);
      expect(prisma.patient.update).toHaveBeenCalledWith(expect.objectContaining({ data: { phone: '+821011112222' } }));
      const audit = prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.changes).toEqual({ before: '010-1111-2222', after: '+821011112222' });
      expect(audit.resourceType).toBe('PATIENT_PHONE_NORMALIZE');
    });
    it('적용 — 이미 정규형이면 미변경(멱등)', async () => {
      prisma.patient.findUnique.mockResolvedValue({ phone: '+821011112222' });
      const r = await svc.normalizeApply(['p1'], 'u1');
      expect(r.applied).toBe(0);
      expect(prisma.patient.update).not.toHaveBeenCalled();
    });
  });

  describe('C3 아웃리치', () => {
    it('게이트 OFF → 정적 템플릿({{name}} 토큰·환자명 미전달)', async () => {
      const d = await svc.outreachDraft('recall', 'en');
      expect(d.mode).toBe('template');
      expect(d.text).toContain('{{name}}');
    });
    it('ko는 게이트와 무관하게 템플릿(불필요 AI 호출 억제)', async () => {
      cfg['quality.ai.enabled'] = true;
      const d = await svc.outreachDraft('passportExpiry', 'ko');
      expect(d.mode).toBe('template');
    });
    it('대상 요약 — 동의 보유 수 분리 산출', async () => {
      prisma.patient.count.mockResolvedValueOnce(100).mockResolvedValueOnce(20);
      const t = await svc.outreachTargets('recall');
      expect(t).toMatchObject({ total: 100, consented: 20 });
      expect(t.note).toBeTruthy();
    });
  });
});
