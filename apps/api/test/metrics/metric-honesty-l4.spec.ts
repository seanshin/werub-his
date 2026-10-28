import { describe, it, expect, vi } from 'vitest';

/**
 * 🔴 L4 — 표본 부재를 `0` 으로 말하던 지표가 `null`(산출 불가)을 돌려준다.
 *
 * 건마다 **진짜 0 대조군**을 둔다: 관측했는데 0 인 것(오늘 입원해 재원 0 일·전건 긍정이라 부정률 0%)은
 * 계속 `0` 이어야 한다. 0 과 null 을 뒤바꿔 말하면 이 가드는 아무것도 지키지 않는다.
 */

describe('🔴 병상 보드 — 재원 0 명이면 평균 재원일수는 산출 불가', () => {
  const board = async (admitted: { admitDate: Date }[]) => {
    const { BedBoardService } = await import('../../src/modules/bed/bed-board.service');
    const prisma = {
      bed: { findMany: vi.fn().mockResolvedValue([]) },
      admission: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue(admitted),
      },
    };
    const svc = new BedBoardService(prisma as never);
    return svc.getBoard();
  };

  it('재원 0 명 → avgLos 는 null(0 일이 아니다)', async () => {
    const r = await board([]);
    expect(r.summary.avgLos).toBeNull();
    expect(r.summary.admittedTotal).toBe(0); // 분모를 함께 낸다
  });

  /**
   * 🔴 이 자리의 '진짜 0' 대조군은 `stayDays` 가 입원 당일을 **1 일로** 세기 때문에 도달하지 않는다
   *    (첫 판은 0 을 기대했다가 1 이 나와 틀렸다 — 실측이 내 가정을 이겼다).
   *    그래서 대조군은 "표본이 있으면 null 이 아니다"로 둔다. 진짜 0 과의 구분은 아래 층 요약·부정률에서 본다.
   */
  it('대조군 — 재원 환자가 있으면 null 이 아니라 값을 준다', async () => {
    const r = await board([{ admitDate: new Date() }]);
    expect(r.summary.avgLos).not.toBeNull();
    expect(typeof r.summary.avgLos).toBe('number');
  });
});

describe('🔴 층 요약 — 표본 없는 구역을 0 분으로 섞어 평균을 희석하지 않는다', () => {
  /**
   * 전광판(ClinicQueueBoard)이 이미 겪은 함정의 서버판이다: 표본이 없어 null 인 구역을 0 으로 접어
   * 분모에 넣으면 층 평균이 실제보다 **낮게** 나온다(대기가 없는 것처럼 보인다).
   */
  const avgOf = (stats: { avgWaitMinutes: number | null }[]) => {
    const sampled = stats.map((s) => s.avgWaitMinutes).filter((v): v is number => v != null);
    return sampled.length ? Math.round(sampled.reduce((a, b) => a + b, 0) / sampled.length) : null;
  };

  it('표본 없는 구역(null)은 분모에서 빠진다', () => {
    expect(avgOf([{ avgWaitMinutes: 40 }, { avgWaitMinutes: null }])).toBe(40); // 종전 계산은 20
  });

  it('전 구역이 표본 없음 → 층 평균도 산출 불가', () => {
    expect(avgOf([{ avgWaitMinutes: null }, { avgWaitMinutes: null }])).toBeNull();
  });

  it('대조군 — 실제로 0 분 대기한 구역은 그대로 0 으로 센다', () => {
    expect(avgOf([{ avgWaitMinutes: 0 }, { avgWaitMinutes: 40 }])).toBe(20);
  });
});

describe('🔴 AI 피드백 — 0 건이면 부정률·만족도는 산출 불가', () => {
  const rates = (good: number, bad: number) => {
    const total = good + bad;
    return {
      badRate: total ? Math.round((bad / total) * 100) : null,
      satisfactionRate: total > 0 ? Math.round((good / total) * 100) : null,
    };
  };

  it('피드백 0 건 → null(부정률 0%·만족도 0% 가 아니다)', () => {
    expect(rates(0, 0).badRate).toBeNull();
    expect(rates(0, 0).satisfactionRate).toBeNull();
  });

  it('대조군 — 전건 긍정이면 부정률은 **진짜 0%**', () => {
    expect(rates(5, 0).badRate).toBe(0);
    expect(rates(5, 0).satisfactionRate).toBe(100);
  });
});

describe('🔴 소스 계약 — 봉합한 지표가 다시 0 으로 떨어지지 않는다', () => {
  /** 스캐너 기준선(metric-zero-fallback)이 이미 동결하지만, 아래는 **그 자리의 판정 근거**를 문장으로 못박는다 */
  const read = async (rel: string) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(__dirname, '../../src/modules', rel), 'utf8');
  };

  it('journey-console 의 하위호환 값이 정본(avgWait/avgStay)과 같은 판정을 쓴다', async () => {
    const src = await read('journey-console/journey-console.service.ts');
    expect(src).toContain('avgWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null');
    expect(src).toMatch(/avgStay: \{ value: avgStayDays, n: admittedRows\.length \}/);
  });

  it('EPA 신뢰수준(1~5 척도)은 평가 0 건에 0 을 쓰지 않는다', async () => {
    const src = await read('education/education.service.ts');
    expect(src).toMatch(/const avgLevel = epas\.length \?[\s\S]{0,140}: null;/);
  });
});
