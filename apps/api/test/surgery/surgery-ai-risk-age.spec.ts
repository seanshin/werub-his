/**
 * 수술 위험도 AI — 나이를 모르면 예측하지 않는다(2026-10-05).
 * 🔴 종전: `ageOf(dob) ?? 50` — 생년월일이 없는 환자를 50세로 지어내 그 위의 위험도를 'AI' 출처로 돌려줬다.
 * 재주입: `?? 50` 폴백을 되돌리면 실패한다(AI 가 불리고 source 가 AI 가 된다).
 */
import { describe, it, expect, vi } from 'vitest';
import { SurgeryService } from '../../src/modules/surgery/surgery.service';

function mk(dob: Date | null) {
  const prisma: any = { surgery: { findUnique: vi.fn(async () => ({ id: 's1', patientId: 'p1', procedureName: '충수절제', procedureCode: null, patient: { dateOfBirth: dob, gender: 'FEMALE' } })) } };
  const ai: any = { predictComplication: vi.fn(async () => ({ risk_level: 'LOW' })), getDisclaimer: vi.fn(async () => 'd') };
  return { svc: new SurgeryService(prisma, {} as never, undefined, ai), ai };
}

describe('수술 위험도 AI — 나이 미상', () => {
  it('🔴 생년월일이 없으면 AI 를 부르지 않고 UNAVAILABLE(AGE_UNKNOWN)', async () => {
    const { svc, ai } = mk(null);
    expect(await svc.predictRiskAI('s1')).toMatchObject({ prediction: null, source: 'UNAVAILABLE', reason: 'AGE_UNKNOWN' });
    expect(ai.predictComplication).not.toHaveBeenCalled();
  });
  it('대조군 — 생년월일이 있으면 실제 나이로 부른다', async () => {
    const { svc, ai } = mk(new Date('1980-01-01'));
    expect(await svc.predictRiskAI('s1')).toMatchObject({ source: 'AI' });
    expect((ai.predictComplication.mock.calls[0][0] as { age: number }).age).toBeGreaterThan(40);
  });
});
