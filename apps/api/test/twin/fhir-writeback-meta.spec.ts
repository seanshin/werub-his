import { describe, it, expect, vi } from 'vitest';
import { FhirWritebackController } from '../../src/modules/twin/fhir-writeback.controller';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';

/**
 * 🔴 트윈 FHIR write-back 응답이 **서버 할당 meta(versionId/lastUpdated)를 클라이언트 meta 로 덮지 않는다** (2026-09-01 · 발굴).
 * 종전엔 `{ meta: {versionId:'1', lastUpdated}, ...body }` 순서라 body.meta 가 서버 meta 를 클로버링 →
 * FHIR 클라이언트가 versionId/lastUpdated 를 못 받아 ETag/낙관적 동시성이 깨졌다.
 */
function ctrl(created: any) {
  const prisma: any = {
    patientAiConsent: { findUnique: vi.fn().mockResolvedValue({ consented: true, revokedAt: null }) },
    twinRiskAssessment: { create: vi.fn().mockResolvedValue(created) },
  };
  const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
  // 정본의 실제 판정(assertPatientAccess·hasSystemScope)을 그대로 쓴다 — 가정한 모양의 목 금지
  const smartAuth = new SmartAuthService({} as any, {} as any, {} as any, {} as never);
  return { c: new FhirWritebackController(prisma, audit, smartAuth), prisma };
}

const tok = (scope: string, patient?: string): any => ({ client_id: 'twin', scope, patient });

const validBody = (extraMeta: Record<string, unknown> = {}) => ({
  resourceType: 'RiskAssessment',
  subject: { reference: 'Patient/p1' },
  status: 'final',
  meta: { tag: [{ code: 'machine-generated' }], ...extraMeta },
  extension: [{ url: 'https://x/twin-ai-generated', valueBoolean: true }],
});

describe('FHIR write-back 응답 meta', () => {
  it('🔴 서버 versionId/lastUpdated 가 클라이언트 meta 를 이긴다(클로버링 방지)', async () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const { c } = ctrl({ id: 'ra-1', createdAt: now, method: 'AI' });
    // 클라이언트가 versionId:'99'·낡은 lastUpdated 를 보내도 서버 값이 이겨야 한다
    const res: any = await c.createRiskAssessment(
      validBody({ versionId: '99', lastUpdated: '2000-01-01' }) as any,
      { smartClient: tok('patient/RiskAssessment.write', 'p1') },
    );
    expect(res.meta.versionId).toBe('1');
    expect(res.meta.lastUpdated).toBe(now);
    expect(res.id).toBe('ra-1');
    // 클라이언트 tag 는 보존
    expect(res.meta.tag).toEqual([{ code: 'machine-generated' }]);
  });

  it('🔴 토큰 환자 스코프 불일치는 차단(IDOR)', async () => {
    const { c } = ctrl({ id: 'ra-2', createdAt: new Date(), method: 'AI' });
    await expect(
      c.createRiskAssessment(validBody() as any, { smartClient: tok('patient/RiskAssessment.write', 'OTHER') }),
    ).rejects.toThrow();
  });

  it('🔴 환자 문맥 없는 patient/·user/ 쓰기 토큰은 차단 — 저장 0', async () => {
    for (const scope of ['patient/RiskAssessment.write', 'user/*.write']) {
      const { c, prisma } = ctrl({ id: 'x', createdAt: new Date(), method: 'AI' });
      await expect(c.createRiskAssessment(validBody() as any, { smartClient: tok(scope) })).rejects.toThrow(/환자 컨텍스트/);
      expect(prisma.twinRiskAssessment.create).not.toHaveBeenCalled();
    }
  });

  it('대조군 — system/* 쓰기(M2M)는 환자 문맥 없이 통과한다(의도된 설계)', async () => {
    const { c, prisma } = ctrl({ id: 'ra-3', createdAt: new Date(), method: 'AI' });
    await c.createRiskAssessment(validBody() as any, { smartClient: tok('system/RiskAssessment.write') });
    expect(prisma.twinRiskAssessment.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 system/*.read 만으로는 쓰기의 환자 문맥 면제가 안 된다(action 을 본다)', async () => {
    const { c } = ctrl({ id: 'x', createdAt: new Date(), method: 'AI' });
    await expect(
      c.createRiskAssessment(validBody() as any, { smartClient: tok('system/*.read patient/RiskAssessment.write') }),
    ).rejects.toThrow(/환자 컨텍스트/);
  });
});
