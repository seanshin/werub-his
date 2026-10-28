import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AllergyService } from '../../src/modules/allergy/allergy.service';

/**
 * 알레르기 변경 → 환자 브리핑 무효화(2026-09-30 진료 작성 화면 재검토).
 * 🔴 종전엔 알레르기 등록·정정·문진이 브리핑 캐시를 지우지 않아, 헤더는 🚫알레르기인데
 *    AI 보조 패널 브리핑은 '알레르기 없음(문진 확인)'을 최대 하루 들고 있었다.
 */
describe('알레르기 쓰기는 allergy.changed 를 낸다', () => {
  const mk = () => {
    const emit = vi.fn();
    const prisma = {
      allergy: { create: vi.fn(async () => ({ id: 'a1' })), update: vi.fn(async () => ({ id: 'a1' })), findFirst: vi.fn(async () => ({ id: 'a1', patientId: 'p1' })), count: vi.fn(async () => 0) },
      allergyAssessment: { create: vi.fn(async () => ({ id: 's1' })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    return { svc: new AllergyService(prisma as never, { emit } as never), emit };
  };
  it('등록·문진 기록 후 환자 id 로 발행', async () => {
    const { svc, emit } = mk();
    await svc.create('p1', { type: 'DRUG', allergen: 'Penicillin' } as never, 'u');
    await svc.assess('p1', { result: 'NO_KNOWN_ALLERGIES' } as never, 'u');
    expect(emit.mock.calls).toEqual([['allergy.changed', { patientId: 'p1' }], ['allergy.changed', { patientId: 'p1' }]]);
  });
  it('대조군 — 쓰기가 실패하면(모순 NKA) 발행하지 않는다', async () => {
    const { svc, emit } = mk();
    (svc as unknown as { prisma: { allergy: { count: () => Promise<number> } } }).prisma.allergy.count = async () => 2;
    await expect(svc.assess('p1', { result: 'NO_KNOWN_ALLERGIES' } as never, 'u')).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
  it('브리핑이 그 이벤트를 받아 캐시를 지운다', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/medical-ai/patient-brief.service.ts'), 'utf8');
    expect(src).toMatch(/@OnEvent\('allergy\.changed'\)[^\n]*invalidate\(/);
  });
});
