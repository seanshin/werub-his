import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { IcuService, ICU_BUNDLE_NOT_PERSISTED } from '../../src/modules/icu/icu.service';

/**
 * 🔴 ICU 번들 6종 P16(2026-09-15) — 저장 모델이 없는데 "기록됐다"는 모양(completedAt·recordedAt=now)과
 *    지어낸 값(SBT PASS·준수율 100·RASS 0·CRRT 혈류 200·ECMO RPM 3000)을 돌려줬다.
 *    기록 흉내를 멈추고 저장되지 않았다는 사실만 말한다.
 */
const METHODS = [
  ['recordSepsisBundle', 'SEPSIS_BUNDLE'],
  ['recordInfectionBundle', 'INFECTION_BUNDLE'],
  ['recordSedation', 'SEDATION'],
  ['recordCrrt', 'CRRT'],
  ['recordEcmo', 'ECMO'],
  ['recordWeaningTrial', 'WEANING_TRIAL'],
] as const;

describe('ICU 번들 6종 — 저장하지 않으면 기록됐다고 말하지 않는다', () => {
  let prisma: any; let svc: any;
  beforeEach(() => {
    prisma = { icuAdmission: { findUnique: vi.fn() } };
    svc = new IcuService(prisma as any, {} as any);
  });

  it.each(METHODS)('%s → recorded:false · NOT_PERSISTED · 시각/기록자 null · 지어낸 값 없음', async (m, kind) => {
    prisma.icuAdmission.findUnique.mockResolvedValue({ id: 'a1' });
    const r = await svc[m]('a1', { recordedBy: 'u1', result: 'FAIL', rass: -3, bloodFlowRate: 150 });
    expect(r).toEqual({ admissionId: 'a1', kind, ...ICU_BUNDLE_NOT_PERSISTED });
    expect(r.recorded).toBe(false);
    expect(r.reason).toBe('NOT_PERSISTED');
    expect(r.recordedAt).toBeNull();
    expect(r.recordedBy).toBeNull();
    const json = JSON.stringify(r);
    for (const fab of ['PASS', 'CONTINUE_WEANING', 'CVVHDF', 'citrate', 'heparin', 'T-piece', 'completedAt', 'complianceRate', '"rass"', '"rpm"', '"result"']) {
      expect(json, `지어낸 값/기록 흉내 필드가 남았다: ${fab}`).not.toContain(fab);
    }
  });

  it('대조군 — 입원이 없으면 404(잘못된 id 를 "저장 안 됨"으로 흐리지 않는다)', async () => {
    prisma.icuAdmission.findUnique.mockResolvedValue(null);
    await expect(svc.recordWeaningTrial('nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
