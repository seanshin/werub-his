import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SentinelJudgmentService } from '../../src/sentinel/sentinel-judgment.service';
import { SentinelReadService } from '../../src/sentinel/sentinel-read.service';
import { RecordJudgmentDto } from '../../src/sentinel/sentinel-judgment.dto';

/**
 * 판정 원장 가드 — 이 축의 존재 이유는 **옛 판정이 새 위반을 조용히 덮지 못하게** 하는 것이다.
 * 🔴 목은 정본의 실제 반환 모양(sentinel_findings 행)을 쓴다 — 내가 가정한 모양을 테스트하면 헛돈다.
 */

const finding = (over: Partial<{
  axis: string; checkKey: string; severity: string; value: number;
  unobservable: boolean; resolvedAt: Date | null; firstSeenAt: Date; label: string;
}> = {}) => ({
  id: 'f-1', axis: 'DATA', checkKey: 'integrity.60', severity: 'RED', label: '미래 시각의 대기열 기록',
  value: 4, prevValue: 4, firstSeenAt: new Date('2026-09-02T16:54:33+09:00'),
  lastSeenAt: new Date(), resolvedAt: null, drillDown: null, unobservable: false,
  detail: null, notifyPending: false, notifiedAt: null,
  ...over,
});

const judgmentRow = (over: Partial<{
  axis: string; checkKey: string; verdict: string; valueAtJudgment: number;
  judgedAt: Date; judgedBy: string | null; source: string; basis: string;
}> = {}) => ({
  id: 'j-1', axis: 'DATA', checkKey: 'integrity.60', verdict: 'SEED_ARTIFACT',
  valueAtJudgment: 4, basis: 'demoDateRoll 롤포워드 아티팩트 실측', source: 'SCREEN',
  judgedBy: 'u-1', judgedAt: new Date('2026-09-04T10:00:00+09:00'),
  ...over,
});

function makePrisma() {
  return {
    sentinelFinding: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    sentinelJudgment: { create: vi.fn(async (a: { data: unknown }) => ({ id: 'new', ...(a.data as object) })), findMany: vi.fn().mockResolvedValue([]) },
    sentinelRun: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('판정 기록 — record()', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: SentinelJudgmentService;
  beforeEach(() => {
    prisma = makePrisma();
    svc = new SentinelJudgmentService(prisma as never);
  });

  it('🔴 판정 시점 건수는 발견 행에서 스냅샷한다 — 클라이언트가 준 값이 아니다', async () => {
    prisma.sentinelFinding.findUnique.mockResolvedValue(finding({ value: 7 }));
    await svc.record({ axis: 'DATA', checkKey: 'integrity.60', verdict: 'SEED_ARTIFACT', basis: '실측 근거를 여기 적는다', userId: 'u-1' });
    const arg = prisma.sentinelJudgment.create.mock.calls[0][0] as { data: { valueAtJudgment: number; source: string; judgedBy: string } };
    expect(arg.data.valueAtJudgment).toBe(7);
    expect(arg.data.source).toBe('SCREEN');
    expect(arg.data.judgedBy).toBe('u-1');
  });

  it('🔴 존재하지 않는 발견에 판정을 받지 않는다 — 지어낸 checkKey 가 커버리지를 오염시킨다', async () => {
    prisma.sentinelFinding.findUnique.mockResolvedValue(null);
    await expect(
      svc.record({ axis: 'DATA', checkKey: 'integrity.999', verdict: 'SEED_ARTIFACT', basis: '근거 근거 근거 근거', userId: 'u-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.sentinelJudgment.create).not.toHaveBeenCalled();
  });
});

describe('판정 신선도 — judgmentView()', () => {
  const view = (f: Partial<Parameters<typeof finding>[0]>, j: ReturnType<typeof judgmentRow> | null) =>
    SentinelJudgmentService.judgmentView(finding(f), j ? { ...j, judgedByName: null } : null);

  it('🔴 판정 이후 값이 늘면 staleIncreased — 옛 판정이 새 행을 덮지 못한다', () => {
    const v = view({ value: 9 }, judgmentRow({ valueAtJudgment: 4 }));
    expect(v?.staleIncreased).toBe(true);
    expect(v?.increasedBy).toBe(5);
  });

  it('값이 같거나 줄었으면 판정은 유효하다 — 성공을 실패로 말하지 않는다(대조군)', () => {
    expect(view({ value: 4 }, judgmentRow({ valueAtJudgment: 4 }))?.staleIncreased).toBe(false);
    expect(view({ value: 2 }, judgmentRow({ valueAtJudgment: 4 }))?.staleIncreased).toBe(false);
  });

  it('🔴 관측 불가 항목은 값 비교를 하지 않는다 — 믿을 수 없는 값으로 신선도를 재지 않는다', () => {
    const v = view({ value: 99, unobservable: true }, judgmentRow({ valueAtJudgment: 4 }));
    expect(v?.staleIncreased).toBe(false);
    expect(v?.increasedBy).toBeNull();
  });

  it('판정이 없으면 null — 빈 판정을 지어내지 않는다', () => {
    expect(view({}, null)).toBeNull();
  });
});

describe('적색 커버리지 — redCoverage()', () => {
  it('🔴 미판정/판정됨/재판정 필요/관측 불가를 가르고, 체류일은 사실로 낸다', async () => {
    const prisma = makePrisma();
    const now = Date.now();
    prisma.sentinelFinding.findMany.mockResolvedValue([
      finding({ checkKey: 'integrity.60', value: 4, firstSeenAt: new Date(now - 3 * 86_400_000) }), // 미판정
      finding({ checkKey: 'integrity.09', value: 83 }),                                              // 판정됨
      finding({ checkKey: 'integrity.13', value: 120 }),                                             // 판정 이후 증가
      finding({ checkKey: 'integrity.49', value: 2, unobservable: true }),                           // 관측 불가
    ]);
    prisma.sentinelJudgment.findMany.mockResolvedValue([
      judgmentRow({ checkKey: 'integrity.09', valueAtJudgment: 83 }),
      judgmentRow({ checkKey: 'integrity.13', valueAtJudgment: 109 }),
      judgmentRow({ checkKey: 'integrity.49', valueAtJudgment: 2 }),
    ]);
    const svc = new SentinelJudgmentService(prisma as never);
    const cov = await svc.redCoverage();
    expect(cov.openRed).toBe(4);
    expect(cov.unjudged).toBe(1);
    expect(cov.judged).toBe(1);
    expect(cov.staleIncreased).toBe(1);
    expect(cov.unobservable).toBe(1);
    const unjudged = cov.items.find((i) => i.state === 'UNJUDGED');
    expect(unjudged?.checkKey).toBe('integrity.60');
    expect(unjudged?.dwellDays).toBe(3);
  });

  it('🔴 재판정하면 최신 판정이 이긴다(append-only·최신 우선)', async () => {
    const prisma = makePrisma();
    prisma.sentinelFinding.findMany.mockResolvedValue([finding({ checkKey: 'integrity.60', value: 4 })]);
    // findMany 는 judgedAt desc 정렬로 온다 — 최신(REAL_DEFECT)이 먼저
    prisma.sentinelJudgment.findMany.mockResolvedValue([
      judgmentRow({ checkKey: 'integrity.60', verdict: 'REAL_DEFECT', valueAtJudgment: 4, judgedAt: new Date('2026-09-04') }),
      judgmentRow({ checkKey: 'integrity.60', verdict: 'SEED_ARTIFACT', valueAtJudgment: 4, judgedAt: new Date('2026-09-03') }),
    ]);
    const svc = new SentinelJudgmentService(prisma as never);
    const cov = await svc.redCoverage();
    expect(cov.items[0].verdict).toBe('REAL_DEFECT');
  });
});

describe('운영 대시보드 — dashboard()', () => {
  it('🔴 표본 없으면 산출하지 않는다 — 소요시간·해결 중앙값이 null 이다', async () => {
    const prisma = makePrisma();
    const svc = new SentinelReadService(prisma as never);
    const d = await svc.dashboard();
    expect(d.resolution.sampleN).toBe(0);
    expect(d.resolution.medianDays).toBeNull();
    for (const a of d.sweep24h) {
      expect(a.durationMsP50).toBeNull();
      expect(a.durationMsMax).toBeNull();
    }
  });

  it('표본이 있으면 중앙값을 낸다(대조군) — 실패 런을 성공으로 세지 않는다', async () => {
    const prisma = makePrisma();
    prisma.sentinelRun.findMany.mockResolvedValue([
      { axis: 'DATA', startedAt: new Date(), ok: true, attempted: 5, succeeded: 5, failed: 0, error: null, durationMs: 100 },
      { axis: 'DATA', startedAt: new Date(), ok: false, attempted: 5, succeeded: 3, failed: 2, error: 'x', durationMs: 300 },
    ]);
    prisma.sentinelFinding.findMany.mockResolvedValue([
      { firstSeenAt: new Date('2026-09-01T00:00:00Z'), resolvedAt: new Date('2026-09-03T00:00:00Z') },
    ]);
    const svc = new SentinelReadService(prisma as never);
    const d = await svc.dashboard();
    const data = d.sweep24h.find((a) => a.axis === 'DATA')!;
    expect(data.runs).toBe(2);
    expect(data.ok).toBe(1);
    expect(data.failedRuns).toBe(1);
    expect(data.durationMsP50).toBe(100);
    expect(data.durationMsMax).toBe(300);
    expect(d.resolution.medianDays).toBe(2);
    expect(d.resolution.bornResolvedN).toBe(0);
  });

  /**
   * 🔴 운영 실측(2026-09-04): 해결 53건 중 47건이 첫 스윕에서 0으로 태어나며 생성과 동시에
   *    해결로 적힌 행(같은 초·now() 마이크로초 역전으로 음수까지)이었다 — 이를 섞으면
   *    중앙값이 -0.1일 같은 거짓을 낸다. 열렸다가 해결된 발견만 표본이다.
   */
  it('🔴 생성과 동시에 해결된 행(born-resolved)은 표본에서 제외하되 수를 밝힌다', async () => {
    const prisma = makePrisma();
    prisma.sentinelFinding.findMany.mockResolvedValue([
      // born-resolved: 같은 순간(마이크로초 역전 포함) — 표본 아님
      { firstSeenAt: new Date('2026-09-02T16:54:33.500Z'), resolvedAt: new Date('2026-09-02T16:54:33.499Z') },
      { firstSeenAt: new Date('2026-09-02T16:54:33.000Z'), resolvedAt: new Date('2026-09-02T16:54:33.000Z') },
      // 진짜 해결: 하루 뒤
      { firstSeenAt: new Date('2026-09-01T00:00:00Z'), resolvedAt: new Date('2026-09-02T00:00:00Z') },
    ]);
    const svc = new SentinelReadService(prisma as never);
    const d = await svc.dashboard();
    expect(d.resolution.sampleN).toBe(1);
    expect(d.resolution.bornResolvedN).toBe(2);
    expect(d.resolution.medianDays).toBe(1);
    // 대조군의 대조군 — 전부 born-resolved 면 중앙값은 0 이 아니라 산출 불가다
    prisma.sentinelFinding.findMany.mockResolvedValue([
      { firstSeenAt: new Date('2026-09-02T16:54:33.000Z'), resolvedAt: new Date('2026-09-02T16:54:33.000Z') },
    ]);
    const d2 = await svc.dashboard();
    expect(d2.resolution.sampleN).toBe(0);
    expect(d2.resolution.medianDays).toBeNull();
  });
});

describe('DTO — class 선언이고 검증이 실제로 문다', () => {
  const make = (over: Record<string, unknown> = {}) =>
    plainToInstance(RecordJudgmentDto, {
      axis: 'DATA', checkKey: 'integrity.60', verdict: 'SEED_ARTIFACT',
      basis: 'demoDateRoll 롤포워드 아티팩트 실측 — 4건 전부 시드 UUID', ...over,
    });

  it('정상 바디는 통과한다(대조군)', () => {
    expect(validateSync(make())).toHaveLength(0);
  });

  it('🔴 지어낸 verdict·빈 근거·이상 checkKey 를 400 으로 문다', () => {
    expect(validateSync(make({ verdict: 'WHATEVER' })).length).toBeGreaterThan(0);
    expect(validateSync(make({ basis: '짧다' })).length).toBeGreaterThan(0);
    expect(validateSync(make({ axis: 'NOPE' })).length).toBeGreaterThan(0);
    expect(validateSync(make({ checkKey: 'a b; drop' })).length).toBeGreaterThan(0);
  });
});
