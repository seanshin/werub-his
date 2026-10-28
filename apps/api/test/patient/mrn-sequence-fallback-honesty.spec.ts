/**
 * 🔴 (2026-09-14) 운영 DB 에 `mrn_daily_seq` 가 없어 발번이 늘 count 폴백으로 갔는데 빈 catch 라 흔적이 없었다.
 * 지키는 것: ① 시퀀스 실패 시 폴백 번호를 내면서 warn 을 남긴다 ② 대조군 — 시퀀스가 되면 warn 없음 ③ 폴백 번호 모양 유지
 */
import { describe, expect, it, vi } from 'vitest';
import { PatientService } from '../../src/modules/patient/patient.service';

function make(queryRaw: ReturnType<typeof vi.fn>) {
  const prisma = {
    $queryRaw: queryRaw,
    patient: { count: vi.fn().mockResolvedValue(6), findUnique: vi.fn().mockResolvedValue(null) },
  };
  const svc = Object.create(PatientService.prototype) as PatientService & { prisma: unknown; logger: { warn: ReturnType<typeof vi.fn> } };
  (svc as any).prisma = prisma;
  (svc as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  return svc;
}

describe('MRN 시퀀스 폴백 정직성', () => {
  it('① 시퀀스 실패 → 폴백 번호 + warn 1회', async () => {
    const svc = make(vi.fn().mockRejectedValue(new Error('relation "mrn_daily_seq" does not exist')));
    const mrn = await (svc as any).generateMrn();
    expect(mrn).toMatch(/^HR-\d{8}-0007$/);
    expect(svc.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(svc.logger.warn.mock.calls[0][0])).toContain('mrn_daily_seq');
  });

  it('② 대조군 — 시퀀스가 되면 warn 없음', async () => {
    const svc = make(vi.fn().mockResolvedValue([{ nextval: BigInt(42) }]));
    const mrn = await (svc as any).generateMrn();
    expect(mrn).toMatch(/^HR-\d{8}-0042$/);
    expect(svc.logger.warn).not.toHaveBeenCalled();
  });
});
