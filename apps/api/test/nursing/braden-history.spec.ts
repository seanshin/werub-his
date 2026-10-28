import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { bradenRiskLevel, BRADEN_REASSESSMENT_TOOL_VERSION } from '@hospital-run/shared';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { RiskReassessmentService } from '../../src/modules/risk-reassessment/risk-reassessment.service';
import { deriveRiskLevel } from '../../src/modules/risk-reassessment/risk-reassessment.policy';
import { ClinicalChartResultService } from '../../src/modules/clinical-chart-result/clinical-chart-result.service';
import { CreateNursingAssessmentDto } from '../../src/modules/nursing/dto/create-nursing-assessment.dto';

/**
 * 간호 위험 평가 이력 — Braden(2026-10-10).
 * 🔴 욕창 재평가는 일정의 '마지막 점수'만 덮어써 이력이 없었고 하위 항목은 버려졌다 · 워크스테이션 Braden 은 "저장 위치 없음" ·
 *    임상 도구는 일부 항목만 고른 부분 합도 저장했다 · 재평가 폼은 전 항목 최고점(23 = 저위험)으로 열렸다(웹 스펙).
 *    → 전용 표 없이 임상 도구 결과 원장(chartId BRADEN)을 이력 원장으로 · 위험 추이가 초기평가와 합쳐 읽는다.
 */
const at = (iso: string) => new Date(iso);
const FULL = { sensory: 3, moisture: 2, activity: 2, mobility: 3, nutrition: 2, friction: 2 }; // 14

function nursing(opts: { initial?: any[]; tool?: any[]; toolTotal?: number; initialTotal?: number } = {}) {
  const prisma: any = {
    admission: { findUnique: vi.fn(async () => ({ id: 'a1', patientId: 'p1', admitDate: at('2026-10-01T00:00:00Z'), dischargeDate: at('2026-10-09T00:00:00Z') })) },
    earlyWarningScore: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    fallRiskAssessment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    nursingAssessment: { findMany: vi.fn(async () => opts.initial ?? []), count: vi.fn(async () => opts.initialTotal ?? (opts.initial ?? []).length) },
    clinicalChartResult: { findMany: vi.fn(async () => opts.tool ?? []), count: vi.fn(async () => opts.toolTotal ?? (opts.tool ?? []).length) },
    riskReassessmentSchedule: { findMany: vi.fn(async () => []) },
  };
  return { s: new NursingService(prisma, undefined, { get: vi.fn(async () => null) } as never), prisma };
}

describe('위험 추이 — Braden 이력', () => {
  it('🔴 재원 기간 안 · 이 환자의 BRADEN 행만 조회', async () => {
    const { s, prisma } = nursing();
    await s.getRiskHistory('a1');
    expect(prisma.clinicalChartResult.findMany.mock.calls[0][0].where).toEqual({ patientId: 'p1', chartId: 'BRADEN', performedAt: { gte: at('2026-10-01T00:00:00Z'), lte: at('2026-10-09T00:00:00Z') } });
    expect(prisma.nursingAssessment.findMany.mock.calls[0][0].where).toEqual({ admissionId: 'a1', bradenScore: { not: null } });
  });

  it('두 원장을 최근 순으로 · 출처·평가자·하위 항목 · 초기평가는 총점만(점검 아님)', async () => {
    const { s } = nursing({
      initial: [{ id: 'na1', assessedAt: at('2026-10-02T00:00:00Z'), bradenScore: 16, nurseId: 'n1', nurse: { familyName: '김', givenName: '하나' } }],
      tool: [
        { id: 'c1', performedAt: at('2026-10-04T00:00:00Z'), inputs: { scores: { ...FULL, sensoryPerception: undefined } }, resultValue: 14, performedBy: 'n2', performedByName: '이둘', usedToolVersion: BRADEN_REASSESSMENT_TOOL_VERSION },
        { id: 'c2', performedAt: at('2026-10-03T00:00:00Z'), inputs: { idx: { sensory: 2, moisture: 1, activity: 1, mobility: 2, nutrition: 1, friction: 1 } }, resultValue: '14', performedBy: 'n3', performedByName: '박셋', usedToolVersion: 'clinical-charts-v1' },
      ],
    });
    const b = (await s.getRiskHistory('a1')).braden;
    expect(b.items.map((i) => [i.id, i.source])).toEqual([['c1', 'REASSESSMENT'], ['c2', 'CHART_TOOL'], ['na1', 'NURSING_ASSESSMENT']]);
    expect(b.items[0]).toMatchObject({ total: 14, subscores: FULL, riskLevel: 'MODERATE', checks: [], assessor: { id: 'n2', name: '이둘' } });
    expect(b.items[1]).toMatchObject({ total: 14, subscores: FULL, checks: [] });
    expect(b.items[2]).toMatchObject({ total: 16, subscores: null, riskLevel: 'LOW', checks: [], assessor: { id: 'n1', name: '김하나' } });
    expect(b).toMatchObject({ total: 3, truncated: false, needsReview: 0 });
  });

  it('🔴 범위 밖 총점 · 하위 항목 누락 · 합 불일치는 "확인 필요"(기록을 고치지 않는다 · 범위 밖은 등급 없음)', async () => {
    const { s } = nursing({
      initial: [{ id: 'na-bad', assessedAt: at('2026-10-02T00:00:00Z'), bradenScore: 40, nurseId: 'n1', nurse: null }],
      tool: [
        { id: 'partial', performedAt: at('2026-10-05T00:00:00Z'), inputs: { scores: null, scheduleId: 's1' }, resultValue: 12, performedBy: 'n2', performedByName: '', usedToolVersion: BRADEN_REASSESSMENT_TOOL_VERSION },
        { id: 'mismatch', performedAt: at('2026-10-06T00:00:00Z'), inputs: { scores: FULL }, resultValue: 18, performedBy: 'n2', performedByName: '이둘', usedToolVersion: 'clinical-charts-v1' },
      ],
    });
    const b = (await s.getRiskHistory('a1')).braden;
    const by = Object.fromEntries(b.items.map((i) => [i.id, i]));
    expect(by['na-bad']).toMatchObject({ total: 40, riskLevel: null, checks: ['OUT_OF_RANGE'], assessor: { name: null } });
    expect(by.partial).toMatchObject({ total: 12, riskLevel: 'HIGH', checks: ['INCOMPLETE'], assessor: { name: null } });
    expect(by.mismatch).toMatchObject({ total: 18, checks: ['SUM_MISMATCH'] });
    expect(b.needsReview).toBe(3);
  });

  it('잘림 — 받은 수 < 전체 수면 truncated', async () => {
    const { s } = nursing({ tool: [], toolTotal: 60 });
    expect((await s.getRiskHistory('a1')).braden).toMatchObject({ total: 60, truncated: true });
  });
});

function reassess(type: 'PRESSURE_ULCER' | 'FALL_RISK') {
  const prisma: any = {
    riskReassessmentSchedule: { findUnique: vi.fn(async () => ({ id: 's1', patientId: 'p1', assessmentType: type })), update: vi.fn(async () => ({ id: 's1' })) },
    fallRiskAssessment: { create: vi.fn(async () => ({ id: 'f1' })) },
    user: { findUnique: vi.fn(async () => ({ familyName: '김', givenName: '하나' })) },
    clinicalChartResult: { create: vi.fn(async (a: any) => ({ id: 'c1', ...a.data })) },
  };
  prisma.$transaction = vi.fn((ops: unknown[]) => Promise.all(ops));
  return { s: new RiskReassessmentService(prisma, { emit: vi.fn() } as never), prisma };
}

describe('욕창 재평가 → Braden 이력 행', () => {
  it('🔴 같은 트랜잭션에 하위 항목·평가자·출처 표식으로 남긴다', async () => {
    const { s, prisma } = reassess('PRESSURE_ULCER');
    await s.recordAssessment('s1', { totalScore: 14, scores: FULL, assessedBy: 'n1' } as never);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    expect(prisma.clinicalChartResult.create.mock.calls[0][0].data).toMatchObject({
      patientId: 'p1', chartId: 'BRADEN', resultValue: 14, resultLevel: 'MODERATE', performedBy: 'n1', performedByName: '김하나',
      usedToolVersion: BRADEN_REASSESSMENT_TOOL_VERSION, inputs: { scores: FULL, scheduleId: 's1' },
    });
    expect(prisma.fallRiskAssessment.create).not.toHaveBeenCalled();
  });
  it('🔴 하위 항목 합 ≠ 총점 · 항목 범위 밖은 400(아무것도 쓰지 않는다)', async () => {
    const { s, prisma } = reassess('PRESSURE_ULCER');
    await expect(s.recordAssessment('s1', { totalScore: 18, scores: FULL, assessedBy: 'n1' } as never)).rejects.toThrow(BadRequestException);
    await expect(s.recordAssessment('s1', { totalScore: 14, scores: { ...FULL, friction: 4 }, assessedBy: 'n1' } as never)).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('대조군 — 낙상 재평가는 Braden 행을 만들지 않는다 · 총점만 보낸 욕창도 기록된다', async () => {
    const f = reassess('FALL_RISK');
    await f.s.recordAssessment('s1', { totalScore: 50, assessedBy: 'n1' } as never);
    expect(f.prisma.clinicalChartResult.create).not.toHaveBeenCalled();
    const p = reassess('PRESSURE_ULCER');
    await p.s.recordAssessment('s1', { totalScore: 12, assessedBy: 'n1' } as never);
    expect(p.prisma.clinicalChartResult.create.mock.calls[0][0].data.inputs).toEqual({ scores: null, scheduleId: 's1' });
  });
  it('등급 경계 — 서버 정책 = shared 정본(6~23 전 구간)', () => {
    for (let t = 6; t <= 23; t++) expect(deriveRiskLevel('PRESSURE_ULCER', t)).toBe(bradenRiskLevel(t));
  });
});

describe('임상 도구 결과 — BRADEN 저장 규칙', () => {
  const svc = () => {
    const prisma: any = { clinicalChartResult: { create: vi.fn(async (a: any) => a.data), deleteMany: vi.fn() } };
    return { s: new ClinicalChartResultService(prisma), prisma };
  };
  const base = { patientId: '00000000-0000-4000-8000-000000000001', chartId: 'BRADEN', chartName: 'Braden', archetype: 'scoring' };
  const user = { id: 'n1', familyName: '김', givenName: '하나' };
  it('🔴 일부 항목만 고른 부분 합은 400 · 보낸 총점이 항목 합과 다르면 400', async () => {
    const { s, prisma } = svc();
    await expect(s.create({ ...base, inputs: { idx: { sensory: 2, moisture: 1 } }, resultValue: 5 } as never, user)).rejects.toMatchObject({ response: { code: 'BRADEN_INCOMPLETE' } });
    await expect(s.create({ ...base, inputs: { scores: FULL }, resultValue: 20 } as never, user)).rejects.toMatchObject({ response: { code: 'BRADEN_SUM_MISMATCH' } });
    expect(prisma.clinicalChartResult.create).not.toHaveBeenCalled();
  });
  it('6항목 다 있으면 총점 = 항목 합(서버) · 다른 도구는 그대로(대조군)', async () => {
    const { s } = svc();
    expect(await s.create({ ...base, inputs: { idx: { sensory: 2, moisture: 1, activity: 1, mobility: 2, nutrition: 1, friction: 1 } } } as never, user)).toMatchObject({ resultValue: 14 });
    expect(await s.create({ ...base, chartId: 'MORSE', inputs: { idx: {} }, resultValue: 3 } as never, user)).toMatchObject({ resultValue: 3 });
  });
});

describe('간호 초기평가 Braden 범위', () => {
  const errs = (bradenScore: unknown) => validateSync(plainToInstance(CreateNursingAssessmentDto, { consciousness: 'ALERT', mobility: 'x', painScore: 0, nutritionStatus: 'x', skinIntegrity: 'x', bradenScore })).filter((e) => e.property === 'bradenScore');
  it('🔴 6 미만·23 초과는 거부 · 범위 안·미기재는 통과', () => {
    expect(errs(5)).toHaveLength(1);
    expect(errs(24)).toHaveLength(1);
    expect(errs(6)).toHaveLength(0);
    expect(errs(undefined)).toHaveLength(0);
  });
});

describe('입원 요약 욕창 위험 등급 — shared 정본(2026-10-10)', () => {
  it('🔴 등급을 자기 경계로 계산하지 않는다 · 6~23 밖은 null', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '../../src/modules/admission/admission.service.ts'), 'utf8');
    expect(src).toContain('pressureUlcerRisk: bradenRiskLevel(na?.bradenScore)');
    expect(src).not.toMatch(/bradenScore\s*<=\s*12/);
    const { bradenRiskLevel } = await import('@hospital-run/shared');
    expect([bradenRiskLevel(30), bradenRiskLevel(12), bradenRiskLevel(null)]).toEqual([null, 'HIGH', null]);
  });
});
