import { describe, it, expect, vi } from 'vitest';
import { psaDensity, psaDensityUnavailableReason } from '@hospital-run/shared';
import { UrologyService } from '../../src/modules/urology/urology.service';

/** PSA 밀도(2026-10-10) — 같은 검사 행의 PSA ÷ 전립선 용적 · 서버 계산 · 분모 없으면 산출 불가 */
describe('psaDensity 정본', () => {
  it('PSA ÷ 용적 · 소수 2자리', () => {
    expect(psaDensity(6.0, 40)).toBe(0.15);
    expect(psaDensity('4.5', '30.0')).toBe(0.15);
    expect(psaDensity(0, 25)).toBe(0); // 측정된 0 은 0
  });
  it('🔴 분모 없음·0 이하·PSA 없음 → null(0 이 아니다) · 이유', () => {
    expect(psaDensity(5, null)).toBeNull();
    expect(psaDensity(5, 0)).toBeNull();
    expect(psaDensity(null, 30)).toBeNull();
    expect(psaDensityUnavailableReason(5, null)).toBe('NO_VOLUME');
    expect(psaDensityUnavailableReason(5, 0)).toBe('INVALID_VOLUME');
    expect(psaDensityUnavailableReason(null, 30)).toBe('NO_PSA');
    expect(psaDensityUnavailableReason(5, 30)).toBeNull();
  });
});

describe('UrologyService — 검사 목록·추이에 PSA 밀도', () => {
  const prisma = {
    urologyExam: {
      findMany: vi.fn(async (a: any) => (a.select
        ? [{ examinedAt: new Date('2026-10-01'), psaValue: 6, prostateVolume: 40 }, { examinedAt: new Date('2026-10-02'), psaValue: 7, prostateVolume: null }]
        : [{ id: 'e1', psaValue: 6, prostateVolume: 40 }, { id: 'e2', psaValue: 7, prostateVolume: null }])),
    },
  };
  const s = new UrologyService(prisma as never);
  it('같은 행 값으로만 — 다른 날 용적을 끌어오지 않는다', async () => {
    const rows: any[] = await s.getExams('p1');
    expect(rows.map((r) => [r.psaDensity, r.psaDensityUnavailable])).toEqual([[0.15, null], [null, 'NO_VOLUME']]);
    const trend = await s.getPsaTrend('p1');
    expect(trend.map((t) => t.psaDensity)).toEqual([0.15, null]);
  });
});
