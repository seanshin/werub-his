import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutiveService } from '../../src/modules/executive/executive.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';

/**
 * 🔴 전 축 공통 정본 계약 — 화면 실사용 점검 W8(2026-08-14) Q9.
 *
 * `checkedInAt ≤ now` 상한이 `dashboard` **한 곳에만** 있었다. `executive`·`journey-console` 은 빠져
 * 대기 198명에 **아직 오지 않은 2명**이 섞였고, 그들은 경과가 음수라 화면에 '0분'으로 표시됐다.
 * 같은 화면군이 198 과 196 을 동시에 말한 것이다(P12).
 *
 * 이 저장소에서 하루 4회 재발한 패턴이고, `dashboard.service.ts` 의 코드 주석이 이미
 * "W3 반복 패턴"이라 경고하고 있었는데도 갈라졌다 — 그래서 **주석이 아니라 테스트**로 못 박는다.
 */

const SRC = join(__dirname, '../../src/modules');

function read(rel: string) {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('🔴 미래 체크인 제외는 전 축 공통이다 (동작)', () => {
  it('executive.getClinicalOverview — 현재 대기 카운트에 상한이 붙는다', async () => {
    const waitingQueue = { count: vi.fn().mockResolvedValue(0) };
    const prisma = {
      encounter: { count: vi.fn().mockResolvedValue(0) },
      appointment: { count: vi.fn().mockResolvedValue(0) },
      admission: { count: vi.fn().mockResolvedValue(0) },
      icuAdmission: { count: vi.fn().mockResolvedValue(0) },
      waitingQueue,
    };
    const r = await new ExecutiveService(prisma as never).getClinicalOverview();
    const where = waitingQueue.count.mock.calls[0][0].where;
    expect(where.checkedInAt?.lte).toBeInstanceOf(Date);
    expect(where.checkedInAt.lte.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    // 화면이 무엇을 셌는지 말할 수 있어야 한다
    expect(r.waitingBasis).toContain('미래 접수');
  });

  it('executive.getDoctorStats — 의료진별 대기에도 같은 상한', async () => {
    const waitingQueue = { groupBy: vi.fn().mockResolvedValue([]) };
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([]) },
      encounter: { groupBy: vi.fn().mockResolvedValue([]) },
      waitingQueue,
    };
    await new ExecutiveService(prisma as never).getDoctorStats();
    expect(waitingQueue.groupBy.mock.calls[0][0].where.checkedInAt?.lte).toBeInstanceOf(Date);
  });

  it('dashboard 요약·차트 — 오늘 접수에도 상한(하한 today 와 함께)', async () => {
    const waitingQueue = { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) };
    const prisma = {
      waitingQueue,
      dispensing: { groupBy: vi.fn().mockResolvedValue([]) },
      labResult: { groupBy: vi.fn().mockResolvedValue([]) },
      imagingResult: { groupBy: vi.fn().mockResolvedValue([]) },
      billing: { aggregate: vi.fn().mockResolvedValue({ _sum: {} }), count: vi.fn().mockResolvedValue(0) },
      claim: { aggregate: vi.fn().mockResolvedValue({ _sum: {} }) },
      patient: { count: vi.fn().mockResolvedValue(0) },
      encounter: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      appointment: { count: vi.fn().mockResolvedValue(0) },
      order: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      emergencyVisit: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new DashboardService(prisma as never);
    await svc.getDashboardSummary('today');
    const summaryWhere = waitingQueue.count.mock.calls[0][0].where;
    expect(summaryWhere.checkedInAt.gte).toBeInstanceOf(Date);
    expect(summaryWhere.checkedInAt.lte).toBeInstanceOf(Date);

    await svc.getChartData();
    const chartWhere = waitingQueue.findMany.mock.calls[0][0].where;
    expect(chartWhere.checkedInAt.lte).toBeInstanceOf(Date);
  });
});

/**
 * 구조 가드 — 새 코드가 상한 없이 대기 집합을 세는 것을 막는다.
 * (동작 테스트만으로는 **새로 추가된 쿼리**를 잡지 못한다 — 갈라짐은 항상 새 코드에서 온다.)
 */
describe('🔴 구조 가드: 대기 집합을 세는 곳은 정본 상한을 부른다', () => {
  const FILES = [
    'journey-console/journey-console.service.ts',
    'journey-console/journey-analytics.service.ts',
    'executive/executive.service.ts',
    'dashboard/dashboard.service.ts',
    'qi/qi.service.ts',
  ];

  it('OPD 대기/활성 집합을 쓰는 쿼리가 있는 파일은 flow-canon 상한을 import 한다', () => {
    for (const f of FILES) {
      const src = read(f);
      const usesWaitSet = /OPD_WAITING_STAGES|OPD_ACTIVE|status: 'WAITING'/.test(src);
      const usesQueue = /waitingQueue\.(count|findMany|groupBy)/.test(src);
      if (!usesWaitSet && !usesQueue) continue;
      expect(src, `${f} 가 대기 집합을 세면서 flow-canon 상한을 쓰지 않는다`).toMatch(/notFutureCheckIn|checkInWindow/);
    }
  });

  it('대기 단계 배열을 로컬에서 다시 선언하지 않는다 — 정본은 flow-canon 하나', () => {
    for (const f of FILES) {
      const src = read(f);
      // `['WAITING', 'CALLED']` 리터럴 재선언 금지(flow-canon 재수출은 허용)
      const localRedeclare = /=\s*\[\s*'WAITING'\s*,\s*'CALLED'\s*\]/.test(src);
      expect(localRedeclare, `${f} 가 대기 단계 배열을 로컬 재선언했다`).toBe(false);
    }
  });

  it('flow-canon 자신이 유일한 선언처다', () => {
    const canon = read('journey-console/flow-canon.ts');
    expect(canon).toMatch(/export const OPD_WAITING_STAGES = \['WAITING', 'CALLED'\]/);
  });
});
