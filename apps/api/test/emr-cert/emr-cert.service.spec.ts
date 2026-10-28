import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmrCertService } from '../../src/modules/emr-cert/emr-cert.service';

/**
 * 🔴 이 스펙은 종전에 **하드코딩을 계약으로 굳혀뒀다** — `expect(result.total).toBe(59)`.
 *    지표 10건이 전부 `status:'PASS'` 상수였고 총계는 리터럴 59 였는데, 스펙은 그 59 를
 *    지켜주고 있었다(2026-08-14 W8·P15). 지금 계약은 **"수치는 실집계이거나 미측정"** 이다.
 */

function prismaWith(counts: Record<string, number>) {
  const c = (k: string) => vi.fn().mockResolvedValue(counts[k] ?? 0);
  return {
    patient: { count: c('patient') },
    encounter: { count: c('encounter') },
    prescription: { count: c('prescription') },
    order: { count: c('order') },
    labResult: { count: c('labResult') },
    durRule: { count: c('durRule') },
    auditLog: { count: c('auditLog') },
    diagnosisCode: { count: c('diagnosisCode') },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  } as never;
}

describe('EmrCertService', () => {
  let service: EmrCertService;

  beforeEach(() => {
    service = new EmrCertService(prismaWith({
      patient: 874, encounter: 5000, prescription: 300, order: 400,
      labResult: 900, durRule: 12, auditLog: 20000, diagnosisCode: 18184,
    }));
    process.env.ENCRYPTION_KEY = 'test-key';
  });

  describe('getChecklist', () => {
    it('등재/측정/미측정 수가 서로 맞는다', async () => {
      const r = await service.getChecklist();
      expect(r.registered).toBe(r.measured + r.notMeasured);
      expect(r.passed + r.partial + r.failed).toBe(r.measured);
      expect(r.indicators).toBeInstanceOf(Array);
      expect(r.indicators).toHaveLength(r.registered);
    });

    it('🔴 총계 리터럴 금지 — 등재 수는 지표 배열에서만 나온다', async () => {
      const r = await service.getChecklist();
      expect(r.registered).toBe(r.indicators.length);
      // 인증 기준 지표 수는 시스템이 모르는 사실 → 등록 전엔 null(59 같은 상수를 박지 않는다)
      expect(r.standardIndicatorCount).toBeNull();
      expect(r.coverage).toBeNull();
    });

    it('🔴 통과율의 분모는 "측정된 지표"이고, 근거 문구가 함께 나간다', async () => {
      const r = await service.getChecklist();
      expect(r.passRate).toBe(Math.round((r.passed / r.measured) * 100));
      expect(r.passRateBasis).toContain(String(r.measured));
    });

    it('🔴 미측정 지표는 PASS 로 위장하지 않는다', async () => {
      const r = await service.getChecklist();
      const notMeasured = r.indicators.filter((i) => !i.measured);
      expect(notMeasured.length).toBeGreaterThan(0);
      notMeasured.forEach((i) => {
        expect(i.status).toBe('NOT_MEASURED');
        expect(i.basis).toBeTruthy(); // 왜 못 세는지 말한다
      });
    });

    it('🔴 실집계가 0건이면 미충족이다 — 데이터가 없는데 통과로 세지 않는다', async () => {
      const empty = new EmrCertService(prismaWith({}));
      const r = await empty.getChecklist();
      const patients = r.indicators.find((i) => i.name === '환자 등록/조회');
      expect(patients?.status).toBe('FAIL');
      expect(patients?.measured).toBe(true);
      expect(r.passed).toBeLessThan(r.measured);
    });

    it('측정된 지표는 근거(집계값)를 반드시 동봉한다', async () => {
      const r = await service.getChecklist();
      r.indicators.filter((i) => i.measured).forEach((i) => expect(i.basis).toBeTruthy());
    });

    it('기준 지표 수가 등록돼 있으면 등재율을 산출한다', async () => {
      const prisma = prismaWith({ patient: 1 }) as unknown as { systemConfig: { findUnique: ReturnType<typeof vi.fn> } };
      prisma.systemConfig.findUnique = vi.fn().mockResolvedValue({ value: 59 });
      const svc = new EmrCertService(prisma as never);
      const r = await svc.getChecklist();
      expect(r.standardIndicatorCount).toBe(59);
      expect(r.coverage).toBe(Math.round((r.registered / 59) * 100));
    });

    it('집계가 던지면 통과가 아니라 미측정이 된다', async () => {
      const prisma = prismaWith({}) as unknown as { patient: { count: ReturnType<typeof vi.fn> } };
      prisma.patient.count = vi.fn().mockRejectedValue(new Error('db down'));
      const svc = new EmrCertService(prisma as never);
      const r = await svc.getChecklist();
      const patients = r.indicators.find((i) => i.name === '환자 등록/조회');
      expect(patients?.status).toBe('NOT_MEASURED');
      expect(patients?.measured).toBe(false);
    });
  });

  describe('getByCategory', () => {
    it('카테고리로 거른다', async () => {
      const result = await service.getByCategory('기능');
      expect(result.length).toBeGreaterThan(0);
      result.forEach((i) => expect(i.category).toBe('기능'));
    });

    it('없는 카테고리는 빈 목록', async () => {
      expect(await service.getByCategory('없는카테고리')).toHaveLength(0);
    });

    it('보안 카테고리도 실집계로 판정된다', async () => {
      const result = await service.getByCategory('보안');
      expect(result.length).toBeGreaterThan(0);
      const audit = result.find((i) => i.name === '감사추적(Audit Trail)');
      expect(audit?.measured).toBe(true);
      expect(audit?.basis).toContain('감사 로그');
    });
  });
});
