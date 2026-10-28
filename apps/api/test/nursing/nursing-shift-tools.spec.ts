import { describe, it, expect, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';

/**
 * 근무조 판단 재료(2026-10-10) — I/O 수지·배설 공백 · 위험 평가 추이.
 * 🔴 기준이 원내에 없으면 판정하지 않는다(null) · 기록이 없으면 공백을 지어내지 않는다 · 재원 기간 안만.
 */
// 2026-10-10 14:00 KST = 05:00Z → 주간(07~15) · 직전 = 야간(전날 23:00 KST)
const NOW = new Date('2026-10-10T05:00:00Z');
const at = (iso: string) => new Date(iso);

function svc(opts: { io?: any[]; fs?: any[]; alertHours?: unknown; ews?: any[]; falls?: any[]; braden?: any[]; schedules?: any[] } = {}) {
  const prisma: any = {
    admission: { findUnique: vi.fn(async () => ({ id: 'a1', patientId: 'p1', admitDate: at('2026-10-01T00:00:00Z'), dischargeDate: null })) },
    intakeOutput: { findMany: vi.fn(async (a: any) => (opts.io ?? []).filter((r) => (!a.where.recordedAt?.gte || r.recordedAt >= a.where.recordedAt.gte) && (!a.where.recordedAt?.lt || r.recordedAt < a.where.recordedAt.lt))) },
    flowSheetEntry: { findMany: vi.fn(async () => opts.fs ?? []) },
    earlyWarningScore: { findMany: vi.fn(async () => opts.ews ?? []), count: vi.fn(async () => (opts.ews ?? []).length) },
    fallRiskAssessment: { findMany: vi.fn(async () => opts.falls ?? []), count: vi.fn(async () => (opts.falls ?? []).length) },
    nursingAssessment: { findMany: vi.fn(async () => opts.braden ?? []), count: vi.fn(async () => (opts.braden ?? []).length) },
    clinicalChartResult: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    riskReassessmentSchedule: { findMany: vi.fn(async () => opts.schedules ?? []) },
  };
  const config = { get: vi.fn(async (k: string) => (k === 'nursing.io.noOutputAlertHours' ? (opts.alertHours ?? null) : null)) };
  return { s: new NursingService(prisma, undefined, config as never), prisma };
}
const io = (iso: string, x: Record<string, unknown>) => ({ id: iso, admissionId: 'a1', recordedAt: at(iso), intakeType: null, intakeAmount: null, intakeDetail: null, outputType: null, outputAmount: null, outputDetail: null, nurse: null, ...x });

describe('I/O 수지', () => {
  it('이번·직전 근무조·24시간 합계 · 수지 · 근무조 이름', async () => {
    const { s } = svc({ io: [
      io('2026-10-10T00:00:00Z', { intakeType: 'ORAL', intakeAmount: 300 }), // 09 KST 주간
      io('2026-10-10T02:00:00Z', { outputType: 'URINE', outputAmount: 200 }), // 11 KST 주간
      io('2026-10-09T16:00:00Z', { intakeType: 'IV', intakeAmount: 500 }), // 01 KST 야간(직전)
    ] });
    const r = await s.getIoBalance('a1', NOW);
    expect(r.shift).toMatchObject({ name: 'DAY', totalIntake: 300, totalOutput: 200, balance: 100 });
    expect(r.previousShift).toMatchObject({ name: 'NIGHT', totalIntake: 500, totalOutput: 0 });
    expect(r.last24h).toMatchObject({ totalIntake: 800, totalOutput: 200 });
  });
  it('🔴 배설 공백 — 기준 미설정이면 판정하지 않는다(null) · 0 mL 기록은 배설로 치지 않고 따로 센다', async () => {
    const { s } = svc({ io: [
      io('2026-10-09T23:00:00Z', { outputType: 'URINE', outputAmount: 150 }),
      io('2026-10-10T03:00:00Z', { outputType: 'URINE', outputAmount: 0 }),
    ] });
    const r = await s.getIoBalance('a1', NOW);
    expect(r.output.lastOutputAt?.toISOString()).toBe('2026-10-09T23:00:00.000Z');
    expect(r.output.hoursSinceLastOutput).toBeCloseTo(6, 5);
    expect(r.output.zeroOutputRecords24h).toBe(1);
    expect(r.output).toMatchObject({ alertHours: null, overdue: null });
  });
  it('기준이 설정되면 넘었는지 · 범위 밖 값은 미설정', async () => {
    const rows = [io('2026-10-09T23:00:00Z', { outputType: 'URINE', outputAmount: 150 })];
    expect((await svc({ io: rows, alertHours: 4 }).s.getIoBalance('a1', NOW)).output.overdue).toBe(true);
    expect((await svc({ io: rows, alertHours: 8 }).s.getIoBalance('a1', NOW)).output.overdue).toBe(false);
    for (const bad of [0, 49, 2.5, 'x']) expect((await svc({ io: rows, alertHours: bad }).s.getIoBalance('a1', NOW)).output.alertHours).toBeNull();
  });
  it('🔴 배설 기록이 하나도 없으면 공백을 지어내지 않는다', async () => {
    const r = await svc({ alertHours: 4 }).s.getIoBalance('a1', NOW);
    expect(r.output).toMatchObject({ lastOutputAt: null, hoursSinceLastOutput: null, overdue: null });
  });
});

describe('위험 평가 추이', () => {
  it('재원 기간으로 조회 · 최신 NEWS2 의 재측정 참고(RCP · 원내 규정 아님) · 잘림', async () => {
    const ews = [{ id: 'e1', recordedAt: at('2026-10-09T00:00:00Z'), totalScore: 5, riskLevel: 'MEDIUM', escalationRequired: true }];
    const { s, prisma } = svc({ ews });
    const r = await s.getRiskHistory('a1');
    expect(prisma.earlyWarningScore.findMany.mock.calls[0][0].where).toMatchObject({ patientId: 'p1', recordedAt: { gte: at('2026-10-01T00:00:00Z') } });
    expect(r.news2.monitoringReference).toMatchObject({ band: 'MEDIUM', minIntervalHours: 1 });
    expect(r.news2.monitoringSource).toContain('원내 규정 아님');
    expect(r.news2.truncated).toBe(false);
  });
  it('🔴 NEWS2 가 없으면 참고도 없다 · 재평가 일정이 없으면 빈 목록(지어내지 않는다)', async () => {
    const r = await svc().s.getRiskHistory('a1');
    expect(r.news2.monitoringReference).toBeNull();
    expect(r.schedules).toEqual([]);
  });
});
