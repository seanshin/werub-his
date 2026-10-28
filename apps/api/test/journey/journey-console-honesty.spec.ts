import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JourneyConsoleService } from '../../src/modules/journey-console/journey-console.service';
import { JourneyAckService } from '../../src/modules/journey-console/journey-ack.service';

/**
 * 🔴 목은 **정본이 실제로 부르는 모양** 그대로. 종전에는 인자 하나를 아예 넘기지 않고도
 *    통과하고 있었다(목에 없는 것은 부르지 않으니까) — 그래서 여기서 진짜 서비스를 만든다.
 */
function ackOf(prisma: unknown): JourneyAckService {
  const p = prisma as { journeyDelayAck?: unknown };
  if (!p.journeyDelayAck) {
    (p as Record<string, unknown>).journeyDelayAck = {
      findMany: async () => [],
      create: async (a: { data: unknown }) => a.data,
    };
  }
  return new JourneyAckService(prisma as never);
}

/**
 * 환자여정 관제 — "화면이 거짓말하지 않는다" 계약 (재설계 P0 · 2026-08-10).
 *
 * 🔴 라이브 실측이 드러낸 것: 접수대기 196명이 평균 352분(5시간 52분)을 기다리는 동안
 *    화면은 **"평균 대기 0m · 임계 접수지연 0건"** 이라고 말하고 있었다. 두 가지가 겹친 결과다.
 *      ① RECEPTION 단계에 지연 판정이 아예 없었다(flag 는 호출·수납·진료에만).
 *      ② 평균 대기가 표본을 잃으면(오늘 startedAt 보유 1건 + 600분 상한 필터) **0 으로 표시**됐다.
 *    n=0 은 값이 아니라 "모른다"다. 아래 계약이 되돌아감을 막는다.
 */

const patient = { id: 'p1', mrn: 'P-1', familyName: '홍', givenName: '길동', insuranceType: 'NHI' };

/** getBoard 가 부르는 최소 prisma 목 */
function boardPrisma(queues: Record<string, unknown>[]) {
  return {
    waitingQueue: { findMany: vi.fn().mockResolvedValue(queues) },
    admission: { findMany: vi.fn().mockResolvedValue([]) },
    billing: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
}

/** config 목 — 지정 키만 값을 주고 나머지는 null(코드 폴백) */
function cfg(values: Record<string, unknown> = {}) {
  return { get: vi.fn(async (k: string) => (k in values ? values[k] : null)) } as never;
}

function minutesAgo(m: number) {
  return new Date(Date.now() - m * 60_000);
}

describe('🔴 접수대기 지연 감지 (WAIT_DELAY)', () => {
  it('목표 대기(30분)를 넘긴 접수대기에 flag 가 붙는다 — 종전엔 판정 자체가 없었다', async () => {
    const svc = new JourneyConsoleService(
      boardPrisma([{ patientId: 'p1', patient, status: 'WAITING', checkedInAt: minutesAgo(352), departmentName: '내과', encounterId: null, doctor: null }]), ackOf(boardPrisma([{ patientId: 'p1', patient, status: 'WAITING', checkedInAt: minutesAgo(352), departmentName: '내과', encounterId: null, doctor: null }])), cfg(),
    );
    const board = await svc.getBoard({ track: 'OPD' }, false);
    expect(board.opd).toHaveLength(1);
    expect(board.opd[0].stage).toBe('RECEPTION');
    expect(board.opd[0].flags).toContain('WAIT_DELAY');
  });

  it('목표 이내 대기에는 flag 가 붙지 않는다', async () => {
    const svc = new JourneyConsoleService(
      boardPrisma([{ patientId: 'p1', patient, status: 'WAITING', checkedInAt: minutesAgo(5), departmentName: '내과', encounterId: null, doctor: null }]), ackOf(boardPrisma([{ patientId: 'p1', patient, status: 'WAITING', checkedInAt: minutesAgo(5), departmentName: '내과', encounterId: null, doctor: null }])), cfg(),
    );
    const board = await svc.getBoard({ track: 'OPD' }, false);
    expect(board.opd[0].flags).toEqual([]);
  });

  it('임계는 config 정본을 따른다 — 보드와 분석이 같은 기준을 본다', async () => {
    // 목표를 400분으로 올리면 352분 대기는 더 이상 지연이 아니다
    const svc = new JourneyConsoleService(
      boardPrisma([{ patientId: 'p1', patient, status: 'WAITING', checkedInAt: minutesAgo(352), departmentName: '내과', encounterId: null, doctor: null }]), ackOf(boardPrisma([{ patientId: 'p1', patient, status: 'WAITING', checkedInAt: minutesAgo(352), departmentName: '내과', encounterId: null, doctor: null }])), cfg({ 'qi.targets.opdWaitMinutes': 400 }),
    );
    const board = await svc.getBoard({ track: 'OPD' }, false);
    expect(board.opd[0].flags).not.toContain('WAIT_DELAY');
  });
});

describe('🔴 응급 트리아지 지연은 KTAS 등급별 목표로 판정한다', () => {
  function erPrisma(visits: Record<string, unknown>[]) {
    return {
      waitingQueue: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]) },
      emergencyVisit: { findMany: vi.fn().mockResolvedValue(visits) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
  }
  const visit = (level: string, arrivedMinAgo: number) => ({
    patientId: 'p1', patient, status: 'PENDING_TRIAGE', triageLevel: level,
    chiefComplaint: '흉통', arrivalAt: minutesAgo(arrivedMinAgo),
    triagedAt: null, treatmentStartedAt: null, dispositionAt: null,
  });

  it('LEVEL_1 은 1분 목표 — 5분이면 이미 지연', async () => {
    const svc = new JourneyConsoleService(erPrisma([visit('LEVEL_1', 5)]), ackOf(erPrisma([visit('LEVEL_1', 5)])), cfg());
    const board = await svc.getBoard({ track: 'ER' }, false);
    expect(board.er[0].stage).toBe('ER_ARRIVED');
    expect(board.er[0].flags).toContain('TRIAGE_DELAY');
  });

  it('🔴 LEVEL_5 는 120분 목표 — 같은 5분이 지연이 아니다(등급 혼합 단일 임계 금지)', async () => {
    const svc = new JourneyConsoleService(erPrisma([visit('LEVEL_5', 5)]), ackOf(erPrisma([visit('LEVEL_5', 5)])), cfg());
    const board = await svc.getBoard({ track: 'ER' }, false);
    expect(board.er[0].flags).not.toContain('TRIAGE_DELAY');
  });

  it('이미 트리아지된 건은 door-to-triage 판정 대상이 아니다', async () => {
    const svc = new JourneyConsoleService(
      erPrisma([{ ...visit('LEVEL_1', 300), status: 'TRIAGED', triagedAt: minutesAgo(290) }]), ackOf(erPrisma([{ ...visit('LEVEL_1', 300), status: 'TRIAGED', triagedAt: minutesAgo(290) }])), cfg(),
    );
    const board = await svc.getBoard({ track: 'ER' }, false);
    expect(board.er[0].stage).toBe('ER_TRIAGED');
    expect(board.er[0].flags).not.toContain('TRIAGE_DELAY');
  });

  it('KTAS 목표는 분석 화면과 같은 config 키를 쓴다', async () => {
    const svc = new JourneyConsoleService(erPrisma([visit('LEVEL_1', 5)]), ackOf(erPrisma([visit('LEVEL_1', 5)])), cfg({ 'qi.targets.doorToTriage': { LEVEL_1: 10 } }));
    const board = await svc.getBoard({ track: 'ER' }, false);
    expect(board.er[0].flags).not.toContain('TRIAGE_DELAY'); // 목표 10분 → 5분은 아직 여유
  });

  it('OPD 트랙만 조회하면 응급을 건드리지 않는다(전역 스캔 방지)', async () => {
    const prisma = erPrisma([visit('LEVEL_1', 5)]);
    const svc = new JourneyConsoleService(prisma, ackOf(prisma), cfg());
    await svc.getBoard({ track: 'OPD' }, false);
    expect((prisma as unknown as { emergencyVisit: { findMany: ReturnType<typeof vi.fn> } }).emergencyVisit.findMany).not.toHaveBeenCalled();
  });
});

describe('🔴 표본이 없으면 0 이 아니라 "모른다"', () => {
  /** getKpi 가 부르는 prisma 목 — waitingNow 표본과 오늘 수납 건수를 주입 */
  function kpiPrisma(opts: { waiting: Record<string, unknown>[]; paidTodayCount: number; paidTodaySum: number | null; triageDelay?: number }) {
    return {
      waitingQueue: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue(opts.waiting),
      },
      admission: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      // 🔴 W8 Q12 — KPI 는 응급 트리아지 지연도 센다(종전엔 키 자체가 없었다).
      emergencyVisit: { count: vi.fn().mockResolvedValue(opts.triageDelay ?? 0) },
      billing: {
        // P4-1: 미수 건수는 count · 금액은 행(findMany)에서 — aggregate 는 오늘 수납 하나
        aggregate: vi.fn().mockResolvedValueOnce({ _sum: { paidAmount: opts.paidTodaySum }, _count: opts.paidTodayCount }),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      bed: { count: vi.fn().mockResolvedValue(0) },
    } as never;
  }

  it('대기 표본 0 → avgWait.value = null (0 아님)', async () => {
    const svc = new JourneyConsoleService(kpiPrisma({ waiting: [], paidTodayCount: 0, paidTodaySum: null }), ackOf(kpiPrisma({ waiting: [], paidTodayCount: 0, paidTodaySum: null })), cfg());
    const kpi = await svc.getKpi();
    expect(kpi.avgWait).toEqual({ value: null, n: 0 });
  });

  it('오늘 수납 건수 0 → revenueToday.n = 0 (화면이 산출불가로 표시할 근거)', async () => {
    const svc = new JourneyConsoleService(kpiPrisma({ waiting: [], paidTodayCount: 0, paidTodaySum: null }), ackOf(kpiPrisma({ waiting: [], paidTodayCount: 0, paidTodaySum: null })), cfg());
    const kpi = await svc.getKpi();
    expect(kpi.revenueToday.n).toBe(0);
  });

  it('🔴 600분 상한이 사라졌다 — 상한은 이상치가 아니라 실제 지연을 지운다', async () => {
    const svc = new JourneyConsoleService(
      kpiPrisma({ waiting: [{ checkedInAt: minutesAgo(700) }, { checkedInAt: minutesAgo(100) }], paidTodayCount: 0, paidTodaySum: null }), ackOf(kpiPrisma({ waiting: [{ checkedInAt: minutesAgo(700) }, { checkedInAt: minutesAgo(100) }], paidTodayCount: 0, paidTodaySum: null })), cfg(),
    );
    const kpi = await svc.getKpi();
    expect(kpi.avgWait.n).toBe(2); // 700분 건이 버려지지 않는다
    expect(kpi.avgWait.value).toBe(400); // (700+100)/2
  });

  it('KPI 가 적용 임계를 함께 반환한다(무엇을 지연이라 했는지 화면이 보여줄 수 있게)', async () => {
    const svc = new JourneyConsoleService(
      kpiPrisma({ waiting: [], paidTodayCount: 0, paidTodaySum: null }), ackOf(kpiPrisma({ waiting: [], paidTodayCount: 0, paidTodaySum: null })), cfg({ 'qi.targets.opdWaitMinutes': 25 }),
    );
    const kpi = await svc.getKpi();
    expect(kpi.thresholds.opdWaitMin).toBe(25);
  });
});

/**
 * 🔴 W8 Q12 — 보드 카드에 붙는 flag 와 상단 KPI `alerts` 의 **키 집합이 같아야 한다**.
 *    종전: 보드는 `TRIAGE_DELAY:1` 을 붙이는데 KPI 에는 그 키가 아예 없었다(FE 7종 기대 / 서버 5종).
 *    요약만 보는 관제자에게 **응급 트리아지 지연은 존재하지 않는 사건**이었다.
 */
describe('🔴 보드 flag 와 KPI alerts 는 같은 키 집합이다', () => {
  /**
   * 🔴 **손으로 베끼지 않는다.** 종전 이 자리에는 FE 목록을 옮겨 적은 7종 배열이 있었고,
   *    보드에 `SETTLE_PENDING` 이 추가됐을 때 **테스트는 그대로 통과했다** —
   *    가드가 서버가 아니라 **내가 적어둔 목록**을 검사하고 있었다(운영 실측 19건이 요약에서 사라짐).
   *    이제 서버 소스의 `flags.push('…')` 에서 직접 뽑는다.
   */
  const EXPECTED = (() => {
    const src = readFileSync(
      join(process.cwd(), 'src/modules/journey-console/journey-console.service.ts'),
      'utf8',
    );
    const found = [...src.matchAll(/flags\.push\('([A-Z_]+)'\)/g)].map((m) => m[1]);
    // 스캔이 0을 통과로 읽지 않는다
    expect(found.length).toBeGreaterThanOrEqual(6);
    return [...new Set(found)];
  })();

  function kpiPrisma(triageDelay: number) {
    return {
      waitingQueue: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      admission: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      emergencyVisit: { count: vi.fn().mockResolvedValue(triageDelay) },
      billing: { aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: 0 }), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      bed: { count: vi.fn().mockResolvedValue(0) },
    } as never;
  }

  it('alerts 키가 보드 flag 와 정확히 같다 — 보드에 추가하면 KPI 도 따라온다', async () => {
    const kpi = await new JourneyConsoleService(kpiPrisma(0), ackOf(kpiPrisma(0)), cfg()).getKpi();
    expect(Object.keys(kpi.alerts).sort()).toEqual([...EXPECTED].sort());
  });

  it('트리아지 지연은 KTAS 등급별로 세고 합계를 낸다(등급 혼합 단일 임계 금지)', async () => {
    const kpi = await new JourneyConsoleService(kpiPrisma(1), ackOf(kpiPrisma(1)), cfg()).getKpi();
    // 5개 등급 × 1건 목 → 합계 5, 내역도 함께
    expect(kpi.alerts.TRIAGE_DELAY).toBe(5);
    expect(Object.keys(kpi.triageDelayByKtas)).toEqual(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5']);
  });
});

/**
 * 🔴 W8 Q9 — `checkedInAt ≤ now` 상한은 **전 축 공통**이다.
 *    이 저장소에서 하루 4회 재발한 패턴이라, 한 축이라도 빠지면 화면끼리 다른 수를 말한다.
 */
describe('🔴 미래 접수는 어느 축에서도 "지금 대기 중"이 아니다', () => {
  it('보드 OPD 조회에 미래 접수 상한이 붙는다', async () => {
    const prisma = boardPrisma([]);
    await new JourneyConsoleService(prisma, ackOf(prisma), cfg()).getBoard({ track: 'OPD' }, false);
    const where = (prisma as unknown as { waitingQueue: { findMany: ReturnType<typeof vi.fn> } }).waitingQueue.findMany.mock.calls[0][0].where;
    expect(where.checkedInAt.lte).toBeInstanceOf(Date);
    expect(where.checkedInAt.lte.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('KPI 활성·대기 표본 조회에도 같은 상한이 붙는다', async () => {
    const prisma = {
      waitingQueue: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      admission: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      emergencyVisit: { count: vi.fn().mockResolvedValue(0) },
      billing: { aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: 0 }), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      bed: { count: vi.fn().mockResolvedValue(0) },
    };
    await new JourneyConsoleService(prisma as never, ackOf(prisma as never), cfg()).getKpi();
    // activeOpd count
    expect(prisma.waitingQueue.count.mock.calls[0][0].where.checkedInAt.lte).toBeInstanceOf(Date);
    // waitingNow findMany
    expect(prisma.waitingQueue.findMany.mock.calls[0][0].where.checkedInAt.lte).toBeInstanceOf(Date);
  });
});
