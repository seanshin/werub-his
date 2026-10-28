/**
 * 통합 상황판 지표 이력(2026-10-02 · 상황판 디자인 F 추세선).
 * 🔴 이력 없이 추세선을 그리면 값을 지어낸다 — 서버가 5분 칸마다 상황판과 같은 집계를 남긴다.
 *  · 섹션 조회 실패 지표는 0 이 아니라 null · 같은 칸은 한 행(skipDuplicates) · 역할이 못 보는 섹션의 지표는 주지 않는다
 *  · 기록 시작 시각을 준다(그 이전은 "없음"이 아니라 "기록 전") · 보존 30일
 * 재주입: 실패 섹션을 0 으로 접으면 · 칸 내림을 빼면 · 역할 필터를 빼면 · 중복 방지를 빼면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TREND_METRICS, bucketOf, snapshotOf, metricsForRole, TREND_RETENTION_DAYS } from '../../src/modules/command-center/command-center-trend';
import { CommandCenterTrendService } from '../../src/modules/command-center/command-center-trend.service';
import { SECTION_ROLES } from '../../src/modules/command-center/command-center.service';

const summary = (over: Partial<Record<string, { ok: boolean; summary?: Record<string, unknown> }>> = {}) => ({
  sections: {
    nursing: { ok: true, summary: { total: 5 } },
    bed: { ok: true, summary: {} },
    emergency: { ok: true, summary: {} },
    diagnostics: { ok: true, summary: { imagingUnread: 4 } },
    receptionBilling: { ok: true, summary: { waiting: 260, outstandingAmount: 7_000_000 } },
    pharmacy: { ok: true, summary: { pending: 6 } },
    ...over,
  },
  kpi: { census: 5, erActive: 2, criticalPending: 1, occupancyNumerator: 5, occupancyDenominator: 57 },
});

describe('지표 정의·칸', () => {
  it('5분 칸으로 내림한다', () => {
    expect(bucketOf(new Date('2026-10-02T05:07:59.999Z')).toISOString()).toBe('2026-10-02T05:05:00.000Z');
    expect(bucketOf(new Date('2026-10-02T05:10:00.000Z')).toISOString()).toBe('2026-10-02T05:10:00.000Z');
  });

  it('🔴 섹션 조회가 실패한 지표는 0 이 아니라 null · 실패 섹션 이름을 남긴다', () => {
    const { values, failedSections } = snapshotOf(summary({ pharmacy: { ok: false }, nursing: { ok: false } }));
    expect(values['pharmacy.pending']).toBeNull();
    expect(values['kpi.census']).toBeNull(); // kpi 에 숫자가 남아 있어도 섹션이 실패면 쓰지 않는다
    expect(failedSections).toEqual(['nursing', 'pharmacy']);
    // 대조군: 성공 섹션은 값 그대로
    expect(values['receptionBilling.waiting']).toBe(260);
    expect(values['kpi.occupancyDenominator']).toBe(57);
  });

  it('지표 키가 하나도 겹치지 않고 화면 키(delta)와 같은 모양이다', () => {
    const keys = TREND_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^(kpi|receptionBilling|pharmacy|diagnostics)\.\w+$/);
  });

  it('🔴 역할이 못 보는 섹션의 지표는 주지 않는다(요약 EP 와 같은 필터)', () => {
    const ph = metricsForRole('PHARMACIST', SECTION_ROLES).map((m) => m.key);
    expect(ph).toEqual(['pharmacy.pending']);
    const lab = metricsForRole('LAB_TECH', SECTION_ROLES).map((m) => m.section);
    expect(new Set(lab)).toEqual(new Set(['diagnostics']));
    expect(metricsForRole('ADMIN', SECTION_ROLES)).toHaveLength(TREND_METRICS.length);
  });
});

describe('기록·조회', () => {
  const make = (prisma: Record<string, unknown>, s = summary()) =>
    new CommandCenterTrendService(prisma as never, { getSummary: vi.fn(async () => s) } as never);

  it('🔴 칸마다 한 행 — skipDuplicates · 역할 필터 없이 전 섹션을 집계한다', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const getSummary = vi.fn(async () => summary());
    const svc = new CommandCenterTrendService({ commandCenterKpiSnapshot: { createMany, deleteMany: vi.fn() } } as never, { getSummary } as never);
    const r = await svc.record(new Date('2026-10-02T05:07:00Z'));
    expect(getSummary).toHaveBeenCalledWith();
    const arg = (createMany.mock.calls[0] as unknown[])[0] as { data: Array<{ bucketAt: Date }>; skipDuplicates: boolean };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0].bucketAt.toISOString()).toBe('2026-10-02T05:05:00.000Z');
    expect(r.recorded).toBe(true);
  });

  it('정시 칸에서만 보존 기간 지난 행을 지운다', async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }));
    const svc = make({ commandCenterKpiSnapshot: { createMany: vi.fn(async () => ({ count: 1 })), deleteMany } });
    await svc.record(new Date('2026-10-02T05:07:00Z'));
    expect(deleteMany).not.toHaveBeenCalled();
    const r = await svc.record(new Date('2026-10-02T06:01:00Z'));
    const cutoff = ((deleteMany.mock.calls[0] as unknown[])[0] as { where: { bucketAt: { lt: Date } } }).where.bucketAt.lt;
    expect(Math.round((new Date('2026-10-02T06:01:00Z').getTime() - cutoff.getTime()) / 86_400_000)).toBe(TREND_RETENTION_DAYS);
    expect(r.purged).toBe(3);
  });

  it('기록 실패는 던지지 않고 recorded=false(그 칸은 추세선에서 끊긴다)', async () => {
    const svc = make({ commandCenterKpiSnapshot: { createMany: vi.fn(async () => { throw new Error('db'); }), deleteMany: vi.fn() } });
    await expect(svc.record(new Date('2026-10-02T05:07:00Z'))).resolves.toMatchObject({ recorded: false });
  });

  it('🔴 조회 — 역할 지표만 · 저장값이 숫자가 아니면 null · 기록 시작 시각', async () => {
    const findMany = vi.fn(async () => [
      { bucketAt: new Date('2026-10-02T05:00:00Z'), values: { 'pharmacy.pending': 6, 'kpi.census': 5 }, failedSections: [] },
      { bucketAt: new Date('2026-10-02T05:05:00Z'), values: { 'pharmacy.pending': null, 'kpi.census': 5 }, failedSections: ['pharmacy'] },
    ]);
    const findFirst = vi.fn(async () => ({ bucketAt: new Date('2026-10-02T04:50:00Z') }));
    const svc = make({ commandCenterKpiSnapshot: { findMany, findFirst } });
    const r = await svc.trend('PHARMACIST', '24');
    expect(r.metrics).toEqual(['pharmacy.pending']);
    expect(r.points.map((p) => p.values)).toEqual([{ 'pharmacy.pending': 6 }, { 'pharmacy.pending': null }]);
    expect(r.recordingSince).toBe('2026-10-02T04:50:00.000Z');
    expect(r.bucketMinutes).toBe(5);
  });

  it('아직 한 번도 기록되지 않았으면 recordingSince=null · 시간 창은 1~168 정수', async () => {
    const svc = make({ commandCenterKpiSnapshot: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) } });
    expect((await svc.trend('ADMIN')).recordingSince).toBeNull();
    await expect(svc.trend('ADMIN', '0')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.trend('ADMIN', '169')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.trend('ADMIN', '2.5')).rejects.toBeInstanceOf(BadRequestException);
  });
});
