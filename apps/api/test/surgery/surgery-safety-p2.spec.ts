import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurgeryAdvancedService } from '../../src/modules/surgery/surgery-advanced.service';

// P2-A 오부위수술(laterality)·P2-D 수술 계수 대조 게이트
describe('SurgeryAdvancedService P2 안전게이트', () => {
  let svc: SurgeryAdvancedService;
  let prisma: any;
  let cfg: { get: any };

  beforeEach(() => {
    prisma = {
      surgicalChecklist: { findUnique: vi.fn(async () => ({ surgeryId: 's1' })), update: vi.fn(async () => ({ id: 'cl-1' })) },
      surgery: { findUnique: vi.fn() },
      preAnesthesiaEvaluation: { findUnique: vi.fn(async () => ({ status: 'COMPLETED' })) },
    };
    cfg = { get: vi.fn(async () => 'OFF') };
    svc = new SurgeryAdvancedService(prisma as any, cfg as any);
  });

  // ── 계수 대조(P2-D) ──
  it('assertCountReconciled — MISMATCH+해소기록 없음 → 차단', async () => {
    prisma.surgicalChecklist.findUnique = vi.fn(async () => ({ countStatus: 'MISMATCH', countDiscrepancyNote: null }));
    await expect(svc.assertCountReconciled('s1')).rejects.toThrow(/계수 불일치|MISMATCH/);
  });
  it('assertCountReconciled — MISMATCH+해소기록 있음 → 통과', async () => {
    prisma.surgicalChecklist.findUnique = vi.fn(async () => ({ countStatus: 'MISMATCH', countDiscrepancyNote: 'X-ray 확인, 잔류물 없음' }));
    await expect(svc.assertCountReconciled('s1')).resolves.toBe(true);
  });
  it('assertCountReconciled — MATCH → 통과', async () => {
    prisma.surgicalChecklist.findUnique = vi.fn(async () => ({ countStatus: 'MATCH', countDiscrepancyNote: null }));
    await expect(svc.assertCountReconciled('s1')).resolves.toBe(true);
  });

  // ── 오부위수술 laterality(P2-A) — Sign-In 게이트 ──
  const blockCfg = (k: string) => (k === 'surgery.siteVerify.enforce' ? 'BLOCK' : 'false');

  it('laterality — 좌우구분 술식(슬관절)+미기재 → 차단(BLOCK)', async () => {
    cfg.get = vi.fn(async (k: string) => blockCfg(k));
    prisma.surgery.findUnique = vi.fn(async () => ({ procedureName: '슬관절 전치환술', bodySite: '슬관절', laterality: null }));
    await expect(svc.updateChecklist('s1', 'signIn', {}, 'u1')).rejects.toThrow(/좌우|laterality/);
  });
  it('laterality — 좌우 기재(RIGHT) → 통과', async () => {
    cfg.get = vi.fn(async (k: string) => blockCfg(k));
    prisma.surgery.findUnique = vi.fn(async () => ({ procedureName: '슬관절 전치환술', bodySite: '슬관절', laterality: 'RIGHT' }));
    await expect(svc.updateChecklist('s1', 'signIn', {}, 'u1')).resolves.toBeDefined();
  });
  it('laterality — 좌우무관 술식(충수절제술) → 통과', async () => {
    cfg.get = vi.fn(async (k: string) => blockCfg(k));
    prisma.surgery.findUnique = vi.fn(async () => ({ procedureName: '충수절제술', bodySite: null, laterality: null }));
    await expect(svc.updateChecklist('s1', 'signIn', {}, 'u1')).resolves.toBeDefined();
  });
  it('laterality — 게이트 OFF면 미기재여도 통과', async () => {
    cfg.get = vi.fn(async () => 'OFF');
    prisma.surgery.findUnique = vi.fn(async () => ({ procedureName: '슬관절', bodySite: '슬관절', laterality: null }));
    await expect(svc.updateChecklist('s1', 'signIn', {}, 'u1')).resolves.toBeDefined();
  });

  // ── 계수 필드 저장(signOut) ──
  it('updateChecklist signOut — countItems/status/note 저장', async () => {
    await svc.updateChecklist('s1', 'signOut', { countItems: [{ item: 'GAUZE', initial: 10, final: 10, status: 'MATCH' }], countStatus: 'MATCH' } as any, 'u1');
    const arg = prisma.surgicalChecklist.update.mock.calls[0][0];
    expect(arg.data.countStatus).toBe('MATCH');
    expect(arg.data.countItems).toBeDefined();
  });
});
