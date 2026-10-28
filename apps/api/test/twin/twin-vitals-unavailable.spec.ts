import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TwinController } from '../../src/modules/twin/twin.controller';

/**
 * 🔴 트윈 활력 EP — 조기경보(EWS) **조회 실패**를 "기록 없음"으로 넘기지 않는다(2026-08-21).
 *
 * `Promise.all` 안의 `.catch(() => null)` 때문에 `latestEws: null` 이 두 가지 뜻을 가졌다:
 * ① 조기경보 기록이 없다 ② 조회가 실패했다. 받는 쪽은 위험엔진이다 —
 * 실패를 '위험 신호 없음'으로 읽으면 경보가 조용히 사라진다.
 *
 * 재주입 역검증: `.catch(() => null)` 로 되돌리면 `unavailable` 이 사라져 첫 it 이 실패한다.
 */
describe('트윈 vitals — 실패와 부재를 구분해서 낸다', () => {
  let controller: TwinController;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      patient: {
        findUnique: vi.fn().mockResolvedValue({ smokingStatus: 'NEVER' }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      patientAiConsent: { findUnique: vi.fn().mockResolvedValue({ consented: true, revokedAt: null }) },
      preVisitVitals: { findMany: vi.fn().mockResolvedValue([]) },
      earlyWarningScore: { findFirst: vi.fn().mockRejectedValue(new Error('DB timeout')) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    controller = new TwinController(
      { get: () => undefined } as never, // ConfigService
      prisma as never,
      { log: vi.fn().mockResolvedValue({}) } as never, // AuditService
      {} as never, // SmartAuthService
    );
  });

  it('EWS 조회가 실패하면 unavailable 에 latestEws 를 실어 "모른다"고 말한다', async () => {
    const res: any = await controller.vitals('11111111-1111-4111-8111-111111111111', 'u-1');
    expect(res.data.latestEws).toBeNull();
    expect(res.data.unavailable).toContain('latestEws');
  });

  it('EWS 가 실제로 없을 때는 실패로 말하지 않는다(거짓 경보 금지)', async () => {
    prisma.earlyWarningScore.findFirst.mockResolvedValue(null);
    const res: any = await controller.vitals('11111111-1111-4111-8111-111111111111', 'u-1');
    expect(res.data.latestEws).toBeNull();
    expect(res.data.unavailable).toEqual([]);
  });
});
