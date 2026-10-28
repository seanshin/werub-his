/**
 * 자격조회 실패는 자격이 아니다(2026-10-14 결함 발굴 수납 P1-4).
 *  · 🔴 종전: 실패가 {status:'ERROR', copayCategory:'NHI'} 로 저장 → 최신 행이 되어 어제 VERIFIED 산정특례(10%)를 덮고 30% 청구
 *  · 이제: 읽을 때 ERROR 를 건너뛴다(최신 '쓸 수 있는' 기록) · 진료에 ERROR 행이 고정돼 있어도 건너뛴다
 *  · 대조군: 자격상실(EXPIRED)은 그대로 전액 · 쓸 수 있는 기록이 없으면 보험유형 폴백
 */
import { describe, it, expect, vi } from 'vitest';
import { EligibilityService } from '../../src/modules/eligibility/eligibility.service';

const VERIFIED_SPECIAL = { id: 'ok', status: 'VERIFIED', copayCategory: 'SPECIAL_CASE', queriedAt: new Date('2026-10-13') };
const ERROR_ROW = { id: 'err', status: 'ERROR', copayCategory: 'NHI', queriedAt: new Date('2026-10-14') };
function mk(rows: any[], pinned: string | null = null) {
  const prisma: any = {
    encounter: { findUnique: vi.fn().mockResolvedValue({ eligibilityCheckId: pinned }) },
    eligibilityCheck: {
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      // where.status.not 를 실제로 적용한다 — 목이 조건을 무시하면 가드가 헛돈다
      findFirst: vi.fn(async ({ where }: any) => rows.filter((r) => !where.status || r.status !== where.status.not).sort((a, b) => b.queriedAt - a.queriedAt)[0] ?? null),
    },
  };
  const svc = new EligibilityService(prisma, { get: vi.fn() } as any);
  vi.spyOn(svc, 'copayRateFor').mockImplementation(async (c: string) => (c === 'SPECIAL_CASE' ? 0.1 : c === 'NHI' ? 0.3 : 0.2));
  return svc;
}

describe('🔴 자격조회 실패 — 30% 로 접지 않는다', () => {
  it('최신이 ERROR 여도 그 전의 VERIFIED 산정특례 10%', async () => {
    expect(await mk([VERIFIED_SPECIAL, ERROR_ROW]).resolveCopayRate('p1', 'NHI' as any, 'OUTPATIENT')).toEqual({ rate: 0.1, copayCategory: 'SPECIAL_CASE' });
  });
  it('진료에 ERROR 행이 고정돼 있어도 건너뛴다', async () => {
    expect((await mk([VERIFIED_SPECIAL, ERROR_ROW], 'err').resolveCopayRate('p1', 'NHI' as any, 'OUTPATIENT', 'e1')).rate).toBe(0.1);
  });
  it('대조군 — ERROR 만 있으면 보험유형 폴백(의료급여는 NHI 30% 가 아니다) · EXPIRED 는 전액', async () => {
    const r = await mk([ERROR_ROW]).resolveCopayRate('p1', 'MEDICAID' as any, 'OUTPATIENT');
    expect(r.copayCategory).toBe('MEDICAID');
    expect((await mk([{ ...VERIFIED_SPECIAL, status: 'EXPIRED' }]).resolveCopayRate('p1', 'NHI' as any, 'OUTPATIENT')).rate).toBe(1);
  });
});
