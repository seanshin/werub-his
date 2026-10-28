import { describe, it, expect, vi } from 'vitest';
import { SafetyQualityBoardService } from '../../src/modules/qi/safety-quality-board.service';

/**
 * 🔴 감염·질·안전 보드의 **표본 창** 계약 — W8 Q6(2026-08-14).
 *
 * `/admin/qi` 계열 보드는 달성률 88% 를 오늘의 상태처럼 냈고, 같은 순간
 * `/qi/target-achievement` 는 '산출 불가'였다. 판정 함수는 W7 에서 이미 정본으로 수렴했다 —
 * 갈라진 것은 **표본 창**이었다. 실측: `qi_measurements` 의 최신 period 는 **2026-05**(3개월 전).
 *
 * 보드가 '지표별 최신 측정'을 보는 것 자체는 타당하다. 금지되는 것은 **그 사실을 숨기는 것**이다.
 */

function prismaMock(qiRows: Record<string, unknown>[]) {
  return {
    safetyIncident: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
    infectionSurveillance: { count: vi.fn().mockResolvedValue(0) },
    handHygieneObservation: { findMany: vi.fn().mockResolvedValue([]) },
    qiMeasurement: { findMany: vi.fn().mockResolvedValue(qiRows) },
  } as never;
}

const measurement = (period: string, value: number, name: string, target: number) => ({
  indicatorId: `${name}-${period}`, meetTarget: true, value, period,
  measuredAt: new Date(`${period}-15T00:00:00+09:00`),
  indicator: { name, targetValue: target },
});

describe('🔴 묵은 값을 오늘의 사실처럼 내지 않는다', () => {
  it('달성률과 함께 **기준 시점**을 낸다', async () => {
    const svc = new SafetyQualityBoardService(prismaMock([
      measurement('2026-05', 1.51, '인공호흡기 관련 폐렴 발생률', 2.0),
      measurement('2026-05', 91, '손위생 수행률', 95),
    ]));
    const r = await svc.getBoard();
    expect(r.summary.qiRate).toBe(50); // 판정 2건 중 1건 달성
    expect(r.summary.qiLatestPeriod).toBe('2026-05');
    expect(r.summary.qiIsCurrentPeriod).toBe(false);
    expect(r.summary.qiStaleMonths).toBeGreaterThan(0);
    /**
     * 🔴 2026-09-10: 서버는 **표시 문장을 만들지 않는다**(로케일을 모른다). 조각만 준다 —
     *    화면이 조립한다(`command-center-view.ts` `boardNote`). 그래서 문장이 아니라 **조각**을 못박는다.
     */
    expect(r.summary.qiLatestPeriod).toBe('2026-05');
    expect(r.summary.qiIsCurrentPeriod).toBe(false);
    expect(typeof r.summary.qiStaleMonths).toBe('number');
    expect(r.summary, '표시 문장을 서버가 다시 만들고 있다 — 그러면 그 줄만 한국어로 남는다')
      .not.toHaveProperty('qiBasis');
  });

  it('이번 달 측정이면 묵음 표시가 붙지 않는다', async () => {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const svc = new SafetyQualityBoardService(prismaMock([measurement(cur, 1.51, '인공호흡기 관련 폐렴 발생률', 2.0)]));
    const r = await svc.getBoard();
    expect(r.summary.qiIsCurrentPeriod).toBe(true);
    expect(r.summary.qiStaleMonths).toBe(0);
  });

  it('측정이 하나도 없으면 달성률은 0% 가 아니라 null', async () => {
    const r = await new SafetyQualityBoardService(prismaMock([])).getBoard();
    expect(r.summary.qiRate).toBeNull();
    expect(r.summary.qiLatestPeriod).toBeNull();
    // 측정이 없으면 조각이 null — '산출 불가'라는 **문장**은 화면이 만든다
    expect(r.summary.qiLatestPeriod).toBeNull();
    expect(r.summary.qiRate).toBeNull();
  });
});
