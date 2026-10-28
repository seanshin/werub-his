/**
 * 🔴 약국 AI 처방검토 — 검증에 떨어진 결과를 "AI" 라 부르지 않는다 (2026-08-20).
 *
 * `recommendDrugs` 는 검증층(`ai-verify`)에 떨어지면 스스로 `source:'FALLBACK'` 을 돌려준다.
 * 그런데 `reviewPrescriptionAI` 는 그것과 **무관하게** `source: 'AI'` 를 붙였고,
 * 약국 화면(`(main)/pharmacy/page.tsx`·workstation)이 그대로 "AI" 로 그렸다 —
 * 3상태 규약(AI / FALLBACK / UNAVAILABLE)이 그 자리에서 무너졌다.
 *
 * 재주입: `source` 를 다시 `'AI'` 상수로 되돌리면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

function mk(aiResult: unknown) {
  const prisma: any = {
    order: {
      findUnique: vi.fn(async () => ({
        id: 'o1',
        prescription: {
          medicationCode: { nameKo: '암로디핀' },
          encounter: { chiefComplaint: '고혈압', patient: { id: 'p1', dateOfBirth: new Date('1970-01-01'), gender: 'MALE' } },
        },
      })),
    },
  };
  const medicalAi: any = { recommendDrugs: vi.fn(async () => aiResult) };
  return new PharmacyService(prisma, {} as never, {} as never, {} as never, medicalAi);
}

describe('reviewPrescriptionAI — 출처를 지어내지 않는다', () => {
  it('🔴 검증 탈락(FALLBACK)을 AI 라 부르지 않는다', async () => {
    const svc = mk({ source: 'FALLBACK', reason: 'VERIFY_REJECTED:KOREAN', recommendations: [] });
    const r = await (svc as unknown as { reviewPrescriptionAI: (id: string) => Promise<{ source: string }> }).reviewPrescriptionAI('o1');
    expect(r.source).toBe('FALLBACK');
  });

  it('AI 로 나온 것만 AI 라 부른다', async () => {
    const svc = mk({ source: 'AI', recommendations: [{ name: '암로디핀' }] });
    const r = await (svc as unknown as { reviewPrescriptionAI: (id: string) => Promise<{ source: string }> }).reviewPrescriptionAI('o1');
    expect(r.source).toBe('AI');
  });

  it('🔴 출처가 없으면 AI 라 단정하지 않는다 — 모르면 FALLBACK', async () => {
    const svc = mk({ recommendations: [] });
    const r = await (svc as unknown as { reviewPrescriptionAI: (id: string) => Promise<{ source: string }> }).reviewPrescriptionAI('o1');
    expect(r.source).toBe('FALLBACK');
  });
});
