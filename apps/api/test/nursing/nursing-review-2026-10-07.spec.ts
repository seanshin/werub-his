/**
 * 간호 검토 보완(2026-10-07) — 간호차트·상하번·간호 질관리.
 *  · 낙상 평가 저장(워크스테이션·안전 화면)이 활성 Morse 재평가 일정을 같은 트랜잭션에서 갱신 · 소아 도구는 건드리지 않음 · 0~125 밖 거부 · 등급은 정본 정책
 *  · 재평가 기록: Braden 6~23·Morse 0~125 밖 거부(종전 0~200 — Braden 99 가 LOW 로 저장)
 *  · 간호진단 제안: 낙상 LOW 는 낙상 진단을 제안하지 않는다(종전 braden≤14 && fallRisk 가 'LOW' 에도 참)
 *  · 담당 배정: 새 주 담당이면 다른 주 담당을 보조로 · 간호사 아닌 계정 거부
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { RiskReassessmentService } from '../../src/modules/risk-reassessment/risk-reassessment.service';
import { matchCarePlanNeeds } from '../../src/modules/nursing/nursing.service';
import { NurseStationService } from '../../src/modules/nurse-station/nurse-station.service';

function safety() {
  const prisma: any = {
    fallRiskAssessment: { create: vi.fn(async ({ data }: any) => ({ id: 'fa1', ...data })) },
    riskReassessmentSchedule: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  prisma.$transaction = vi.fn((ops: unknown[]) => Promise.all(ops));
  const emit = vi.fn();
  return { svc: new PatientSafetyService(prisma, { emit } as any), prisma, emit };
}

describe('낙상 평가 저장 ↔ 재평가 일정', () => {
  it('🔴 평가 원장과 활성 Morse 일정 갱신이 한 트랜잭션 · 등급·다음 기한은 정본 정책', async () => {
    const { svc, prisma } = safety();
    const r: any = await svc.assessFallRisk({ patientId: 'p1', assessorId: 'n1', score: 50, riskLevel: 'LOW', factors: {} });
    expect(r.riskLevel).toBe('HIGH');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const call = prisma.riskReassessmentSchedule.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ patientId: 'p1', isActive: true, assessmentType: 'FALL_RISK', toolName: 'MORSE' });
    expect(call.data).toMatchObject({ lastScore: 50, lastRiskLevel: 'HIGH', lastAssessedBy: 'n1' });
    expect(call.data.nextDueAt.getTime()).toBeGreaterThan(Date.now());
    expect(r.schedulesUpdated).toBe(1);
  });
  it('🔴 Morse 0~125 밖은 거부 — 아무것도 쓰지 않는다', async () => {
    const { svc, prisma } = safety();
    for (const score of [-1, 130, 12.5]) {
      await expect(svc.assessFallRisk({ patientId: 'p1', assessorId: 'n1', score, factors: {} })).rejects.toThrow(BadRequestException);
    }
    expect(prisma.fallRiskAssessment.create).not.toHaveBeenCalled();
  });
  it('Morse 계산 경로도 같은 정본으로 저장한다', async () => {
    const { svc, prisma } = safety();
    await svc.assessMorseFallRisk({ patientId: 'p1', assessorId: 'n1', factors: { historyOfFalling: true, secondaryDiagnosis: true, ambulatoryAid: 'NONE', ivTherapy: false, gait: 'NORMAL', mentalStatus: 'ORIENTED' } });
    expect(prisma.riskReassessmentSchedule.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.fallRiskAssessment.create.mock.calls[0][0].data).toMatchObject({ score: 40, riskLevel: 'MODERATE' });
  });
});

describe('재평가 기록 점수 범위', () => {
  function svc(type: string) {
    const prisma: any = { riskReassessmentSchedule: { findUnique: vi.fn(async () => ({ id: 's1', patientId: 'p1', assessmentType: type })), update: vi.fn() }, fallRiskAssessment: { create: vi.fn() }, user: { findUnique: vi.fn(async () => null) }, clinicalChartResult: { create: vi.fn() } };
    prisma.$transaction = vi.fn((ops: unknown[]) => Promise.all(ops));
    return { s: new RiskReassessmentService(prisma, { emit: vi.fn() } as any), prisma };
  }
  it('🔴 Braden 6~23 밖 · Morse 0~125 밖은 400(불가능한 값이 등급을 만들지 않는다)', async () => {
    await expect(svc('PRESSURE_ULCER').s.recordAssessment('s1', { totalScore: 99, assessedBy: 'n1' } as any)).rejects.toThrow(BadRequestException);
    await expect(svc('PRESSURE_ULCER').s.recordAssessment('s1', { totalScore: 5, assessedBy: 'n1' } as any)).rejects.toThrow(BadRequestException);
    await expect(svc('FALL_RISK').s.recordAssessment('s1', { totalScore: 130, assessedBy: 'n1' } as any)).rejects.toThrow(BadRequestException);
  });
  it('대조군 — 범위 안은 기록된다', async () => {
    const { s, prisma } = svc('PRESSURE_ULCER');
    await s.recordAssessment('s1', { totalScore: 12, assessedBy: 'n1' } as any);
    expect(prisma.riskReassessmentSchedule.update.mock.calls[0][0].data).toMatchObject({ lastScore: 12, lastRiskLevel: 'HIGH' });
  });
});

describe('간호진단 제안', () => {
  const base = { painScore: null, mobility: null, skinIntegrity: null, nutritionStatus: null, consciousness: null, ewsRisk: null, temperature: null, spO2: null };
  it('🔴 낙상 LOW + Braden 14 → 낙상 진단 제안 없음(욕창은 제안)', () => {
    const keys = matchCarePlanNeeds({ ...base, bradenScore: 14, fallRisk: 'LOW' }).map((n) => n.key);
    expect(keys).not.toContain('fall');
    expect(keys).toContain('skin');
  });
  it('대조군 — 낙상 HIGH 는 제안', () => {
    expect(matchCarePlanNeeds({ ...base, bradenScore: null, fallRisk: 'HIGH' }).map((n) => n.key)).toContain('fall');
  });
});

describe('담당 배정 — 주 담당 하나', () => {
  function station(role = 'NURSE') {
    const npa = { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })) };
    const prisma: any = { admission: { findUnique: vi.fn(async () => ({ status: 'ADMITTED' })) }, nursePatientAssignment: npa, user: { findUnique: vi.fn(async () => ({ role })) } };
    prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    return { svc: new NurseStationService(prisma, {} as never, {} as never, { emit: vi.fn() } as never, {} as never), npa };
  }
  it('🔴 새 주 담당이면 같은 입원의 다른 주 담당을 보조로 내린다', async () => {
    const { svc, npa } = station();
    await svc.assignPatient({ nurseId: 'n2', admissionId: 'a1', assignedBy: 'h1' });
    expect(npa.updateMany).toHaveBeenCalledWith({ where: { admissionId: 'a1', releasedAt: null, isPrimary: true, nurseId: { not: 'n2' } }, data: { isPrimary: false } });
  });
  it('보조 배정은 기존 주 담당을 건드리지 않는다', async () => {
    const { svc, npa } = station();
    await svc.assignPatient({ nurseId: 'n2', admissionId: 'a1', assignedBy: 'h1', isPrimary: false });
    expect(npa.updateMany).not.toHaveBeenCalled();
  });
  it('🔴 간호사가 아닌 계정에는 배정하지 않는다', async () => {
    const { svc, npa } = station('DOCTOR');
    await expect(svc.assignPatient({ nurseId: 'd1', admissionId: 'a1', assignedBy: 'h1' })).rejects.toThrow(BadRequestException);
    expect(npa.create).not.toHaveBeenCalled();
  });
});
