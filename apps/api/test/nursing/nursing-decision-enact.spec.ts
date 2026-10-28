import { describe, it, expect, vi } from 'vitest';
import { BRADEN_INITIAL_TOOL_VERSION } from '@hospital-run/shared';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { RiskReassessmentService } from '../../src/modules/risk-reassessment/risk-reassessment.service';
import { scheduleFromInitialScore, REASSESSMENT_INTERVAL_HOURS } from '../../src/modules/risk-reassessment/risk-reassessment.policy';

/**
 * 간호 결정 두 가지의 동작(2026-10-10) — 결정 화면에서 고른 값이 실제로 먹는지.
 *  ① `nursing.reassessment.autoScheduleOnAdmission` — 켜지면 간호초기평가 저장 때 점수로 재평가 일정을 연다
 *     (입원 순간은 점수가 없다 · 점수가 처음 생기는 지점 = 초기평가 저장) · 열린 같은 유형이 있으면 만들지 않는다 · 꺼지면 현행
 *  ② `nursing.initialAssessment.bradenInput` — SUBSCORES 면 6항목·총점은 합·하위 항목은 Braden 이력 원장에 같은 트랜잭션으로 ·
 *     총점만 보내면 거부 · TOTAL(현행)은 총점 칸 그대로
 */
const AT = '2026-10-05T01:00:00.000Z';
const FULL = { sensory: 3, moisture: 2, activity: 2, mobility: 2, nutrition: 2, friction: 1 }; // 12 → HIGH

function build(cfg: Record<string, unknown>, opts: { open?: string[]; fallScore?: number | null } = {}) {
  const created = { assessment: [] as any[], chart: [] as any[], schedule: [] as any[] };
  const prisma: any = {
    admission: { findUnique: vi.fn(async () => ({ id: 'a1', patientId: 'p1' })) },
    nursingAssessment: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (a: any) => { created.assessment.push(a.data); return { id: 'na1', ...a.data }; }),
    },
    fallRiskAssessment: { findUnique: vi.fn(async () => (opts.fallScore === undefined ? { score: 50, patientId: 'p1' } : opts.fallScore === null ? null : { score: opts.fallScore, patientId: 'p1' })) },
    user: { findUnique: vi.fn(async () => ({ familyName: '김', givenName: '간호' })) },
    clinicalChartResult: { create: vi.fn(async (a: any) => { created.chart.push(a.data); return a.data; }) },
    riskReassessmentSchedule: {
      findMany: vi.fn(async () => (opts.open ?? []).map((assessmentType) => ({ assessmentType }))),
      create: vi.fn(async (a: any) => { created.schedule.push(a.data); return a.data; }),
    },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  const config = { get: vi.fn(async (k: string) => (k in cfg ? cfg[k] : null)) };
  return { s: new NursingService(prisma, undefined, config as never), prisma, created };
}
const base = { consciousness: 'Alert', mobility: '독립보행', painScore: 2, nutritionStatus: '양호', skinIntegrity: '정상', fallRiskAssessmentId: '00000000-0000-4000-8000-000000000001', assessedAt: AT };
const ON = { 'nursing.reassessment.autoScheduleOnAdmission': true };
const SUB = { 'nursing.initialAssessment.bradenInput': 'SUBSCORES' };

describe('① 초기평가 저장 때 재평가 일정 자동 생성', () => {
  it('🔴 켜짐 — 점수로 등급·주기를 정해 평가 시각부터 연다(낙상 Morse 50 HIGH · 욕창 Braden 12 HIGH)', async () => {
    const { s, created } = build(ON);
    const r: any = await s.createAssessment('a1', { ...base, bradenScore: 12 } as never, 'n1');
    expect(r.autoSchedules).toEqual({ enabled: true, created: ['FALL_RISK', 'PRESSURE_ULCER'], skipped: [] });
    const fall = created.schedule.find((x) => x.assessmentType === 'FALL_RISK');
    expect(fall).toMatchObject({ admissionId: 'a1', lastScore: 50, lastRiskLevel: 'HIGH', intervalHours: REASSESSMENT_INTERVAL_HOURS.FALL_RISK.HIGH, lastAssessedBy: 'n1', toolName: 'MORSE' });
    expect(fall.nextDueAt.toISOString()).toBe(new Date(Date.parse(AT) + REASSESSMENT_INTERVAL_HOURS.FALL_RISK.HIGH * 3_600_000).toISOString());
    expect(created.schedule.find((x) => x.assessmentType === 'PRESSURE_ULCER')).toMatchObject({ lastScore: 12, lastRiskLevel: 'HIGH', intervalHours: REASSESSMENT_INTERVAL_HOURS.PRESSURE_ULCER.HIGH, toolName: 'BRADEN' });
  });

  it('멱등 — 열린 같은 유형 일정이 있으면 만들지 않는다 · 점수가 없으면 만들지 않는다(이유를 돌려준다)', async () => {
    const { s, created } = build(ON, { open: ['FALL_RISK'] });
    const r: any = await s.createAssessment('a1', { ...base } as never, 'n1'); // Braden 없음
    expect(created.schedule).toEqual([]);
    expect(r.autoSchedules.skipped).toEqual([{ type: 'FALL_RISK', reason: 'EXISTS' }, { type: 'PRESSURE_ULCER', reason: 'NO_SCORE' }]);
  });

  it('대조군 — 꺼짐(현행)이면 일정도 낙상 조회도 없다 · 설정 미주입도 꺼짐으로 접는다', async () => {
    const { s, prisma, created } = build({});
    const r: any = await s.createAssessment('a1', { ...base, bradenScore: 12 } as never, 'n1');
    expect(r.autoSchedules).toEqual({ enabled: false, created: [], skipped: [] });
    expect(created.schedule).toEqual([]);
    expect(prisma.riskReassessmentSchedule.findMany).not.toHaveBeenCalled();
  });

  it('범위 밖 점수로는 등급·주기를 지어내지 않는다', () => {
    expect(scheduleFromInitialScore('PRESSURE_ULCER', 30, new Date(AT))).toBeNull();
    expect(scheduleFromInitialScore('FALL_RISK', null, new Date(AT))).toBeNull();
    expect(scheduleFromInitialScore('FALL_RISK', 20, new Date(AT))).toMatchObject({ lastRiskLevel: 'LOW', intervalHours: REASSESSMENT_INTERVAL_HOURS.FALL_RISK.LOW });
  });
});

describe('② 초기평가 Braden 입력 방식', () => {
  it('🔴 SUBSCORES — 총점은 합 · 하위 항목은 Braden 이력 원장에(초기평가와 묶음 · 평가 시각) · 한 트랜잭션', async () => {
    const { s, prisma, created } = build(SUB);
    await s.createAssessment('a1', { ...base, bradenSubscores: FULL } as never, 'n1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(created.assessment[0].bradenScore).toBe(12);
    expect(created.chart[0]).toMatchObject({ chartId: 'BRADEN', resultValue: 12, resultLevel: 'HIGH', usedToolVersion: BRADEN_INITIAL_TOOL_VERSION, performedBy: 'n1', performedByName: '김간호', inputs: { scores: FULL, nursingAssessmentId: 'na1' } });
    expect(created.chart[0].performedAt.toISOString()).toBe(AT);
  });

  it('🔴 SUBSCORES 인데 총점만 → 400 · 5항목만 → 400 · 합과 총점이 다르면 400 · 저장 0', async () => {
    const { s, created } = build(SUB);
    await expect(s.createAssessment('a1', { ...base, bradenScore: 14 } as never, 'n1')).rejects.toMatchObject({ response: { code: 'BRADEN_SUBSCORES_REQUIRED' } });
    const { friction: _f, ...five } = FULL;
    await expect(s.createAssessment('a1', { ...base, bradenSubscores: five } as never, 'n1')).rejects.toMatchObject({ response: { code: 'BRADEN_INCOMPLETE' } });
    await expect(s.createAssessment('a1', { ...base, bradenSubscores: FULL, bradenScore: 15 } as never, 'n1')).rejects.toMatchObject({ response: { code: 'BRADEN_SUM_MISMATCH' } });
    await expect(s.createAssessment('a1', { ...base, bradenSubscores: { ...FULL, friction: 4 } } as never, 'n1')).rejects.toMatchObject({ response: { code: 'BRADEN_SUBSCORE_RANGE' } });
    expect(created.assessment).toEqual([]);
    expect(created.chart).toEqual([]);
  });

  it('대조군 — TOTAL(현행)은 총점 칸 그대로 · 이력 원장 행 없음 · Braden 없이도 저장', async () => {
    const { s, created } = build({});
    await s.createAssessment('a1', { ...base, bradenScore: 14 } as never, 'n1');
    await s.createAssessment('a1', { ...base } as never, 'n1');
    expect(created.assessment.map((a) => a.bradenScore)).toEqual([14, undefined]);
    expect(created.chart).toEqual([]);
  });
});

describe('위험 추이 — 초기평가 하위 항목은 초기평가 행에 붙는다(두 줄이 아니다)', () => {
  it('묶인 원장 행은 따로 세우지 않고 전체 수에서도 뺀다', async () => {
    const prisma: any = {
      admission: { findUnique: vi.fn(async () => ({ id: 'a1', patientId: 'p1', admitDate: new Date('2026-10-01T00:00:00Z'), dischargeDate: null })) },
      earlyWarningScore: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      fallRiskAssessment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      nursingAssessment: { findMany: vi.fn(async () => [{ id: 'na1', assessedAt: new Date(AT), bradenScore: 12, nurseId: 'n1', nurse: { familyName: '김', givenName: '간호' } }]), count: vi.fn(async () => 1) },
      clinicalChartResult: {
        findMany: vi.fn(async () => [{ id: 'c1', performedAt: new Date(AT), inputs: { scores: FULL, nursingAssessmentId: 'na1' }, resultValue: 12, performedBy: 'n1', performedByName: '김간호', usedToolVersion: BRADEN_INITIAL_TOOL_VERSION }]),
        count: vi.fn(async () => 1),
      },
      riskReassessmentSchedule: { findMany: vi.fn(async () => []) },
    };
    const b = (await new NursingService(prisma, undefined, { get: vi.fn(async () => null) } as never).getRiskHistory('a1')).braden;
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ id: 'na1', source: 'NURSING_ASSESSMENT', total: 12, subscores: FULL, checks: [] });
    expect(b.total).toBe(1);
  });
});

describe('재평가 관리 통계 — 자동 일정 결정 상태', () => {
  const statsPrisma = () => ({
    riskReassessmentSchedule: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
  });
  it('설정 그대로 켜짐/꺼짐 · 미주입이면 null(모름 — 꺼짐이 아니다)', async () => {
    const on = new RiskReassessmentService(statsPrisma() as never, { emit: vi.fn() } as never, { get: vi.fn(async (k: string) => k === 'nursing.reassessment.autoScheduleOnAdmission') } as never);
    expect((await on.getStats()).policy).toEqual({ onAssessment: true, onAdmission: false });
    const unknown = new RiskReassessmentService(statsPrisma() as never, { emit: vi.fn() } as never);
    expect((await unknown.getStats()).policy).toEqual({ onAssessment: null, onAdmission: null });
  });
});
