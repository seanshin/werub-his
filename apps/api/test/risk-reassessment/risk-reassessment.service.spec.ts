import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RiskReassessmentService } from '../../src/modules/risk-reassessment/risk-reassessment.service';
import {
  REASSESSMENT_INTERVAL_HOURS,
  deriveRiskLevel,
  intervalHoursFor,
} from '../../src/modules/risk-reassessment/risk-reassessment.policy';

describe('RiskReassessmentService', () => {
  let service: RiskReassessmentService;
  let p: any;
  const mockSched = { id: 'rs-1', patientId: 'p-1', assessmentType: 'FALL_RISK', toolName: 'MORSE', intervalHours: 8, isActive: true, nextDueAt: new Date(), lastScore: null, lastRiskLevel: null };

  beforeEach(() => {
    p = {
      riskReassessmentSchedule: {
        findMany: vi.fn().mockResolvedValue([mockSched]),
        findUnique: vi.fn().mockResolvedValue(mockSched),
        create: vi.fn().mockResolvedValue(mockSched),
        update: vi.fn().mockResolvedValue(mockSched),
        count: vi.fn().mockResolvedValue(5),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      fallRiskAssessment: { create: vi.fn().mockResolvedValue({ id: 'fa-1' }) },
      // 2026-10-10 욕창 재평가는 Braden 이력 행(임상 도구 결과 원장)을 함께 남긴다
      user: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '간호' }) },
      clinicalChartResult: { create: vi.fn().mockResolvedValue({ id: 'cc-1' }) },
      $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    };
    service = new RiskReassessmentService(p, { emit: vi.fn() } as any);
  });

  it('createSchedule', async () => { const r = await service.createSchedule({ patientId: 'p-1', assessmentType: 'FALL_RISK', intervalHours: 8 } as any); expect(r.id).toBe('rs-1'); });
  it('getSchedules', async () => { await service.getSchedules({}); expect(p.riskReassessmentSchedule.findMany).toHaveBeenCalled(); });
  it('getScheduleById', async () => { await service.getScheduleById('rs-1'); });
  it('getScheduleById — 없음', async () => { p.riskReassessmentSchedule.findUnique.mockResolvedValue(null); await expect(service.getScheduleById('x')).rejects.toThrow(NotFoundException); });
  it('deactivate', async () => { await service.deactivate('rs-1'); expect(p.riskReassessmentSchedule.update).toHaveBeenCalled(); });
  it('getOverdue', async () => { await service.getOverdue(); expect(p.riskReassessmentSchedule.findMany).toHaveBeenCalled(); });
  it('getStats', async () => { const r = await service.getStats(); expect(r).toBeDefined(); });

  /* ────────────────────────────────────────────────────────────────
   * 가드 — 아래 스펙은 2026-08 W8 실결함의 재발을 막는다. 완화 금지.
   * ──────────────────────────────────────────────────────────────── */

  describe('가드 ② 점수 필드 계약(totalScore)', () => {
    // 🔴 원 결함: FE 는 totalScore 를 보내는데 서버는 score 를 읽어 undefined 가 흘렀다.
    it('totalScore 로 점수를 받는다 (구 필드명 score 는 계약이 아니다)', async () => {
      await service.recordAssessment('rs-1', { totalScore: 55, assessedBy: 'n-1' } as any);
      expect(p.riskReassessmentSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastScore: 55 }) }),
      );
    });

    it('점수가 없으면 400 으로 거부한다 — 조용히 LOW 로 기록하지 않는다', async () => {
      await expect(service.recordAssessment('rs-1', { assessedBy: 'n-1' } as any)).rejects.toThrow(BadRequestException);
      expect(p.riskReassessmentSchedule.update).not.toHaveBeenCalled();
      expect(p.fallRiskAssessment.create).not.toHaveBeenCalled();
    });

    it('구 필드명(score)만 보내면 저장되지 않는다', async () => {
      await expect(service.recordAssessment('rs-1', { score: 60, assessedBy: 'n-1' } as any)).rejects.toThrow(BadRequestException);
    });

    it('항목별 점수(scores)는 factors 로 보존된다 — 빈 배열로 버리지 않는다', async () => {
      const scores = { fallHistory: 25, gait: 20 };
      await service.recordAssessment('rs-1', { totalScore: 45, scores, assessedBy: 'n-1' } as any);
      expect(p.fallRiskAssessment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ factors: scores }) }),
      );
    });
  });

  describe('가드 ③ riskLevel 이 임계값으로 실제 산출된다 (전건 LOW 재발 차단)', () => {
    it.each([
      [10, 'LOW'],
      [24, 'LOW'],
      [25, 'MODERATE'],
      [44, 'MODERATE'],
      [45, 'HIGH'],
      [90, 'HIGH'],
    ])('Morse %i점 → %s', async (score, level) => {
      await service.recordAssessment('rs-1', { totalScore: score, assessedBy: 'n-1' } as any);
      expect(p.riskReassessmentSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRiskLevel: level }) }),
      );
    });

    it('제출된 riskLevel 은 신뢰하지 않는다 — 서버 산출이 이긴다', async () => {
      await service.recordAssessment('rs-1', { totalScore: 90, riskLevel: 'LOW', assessedBy: 'n-1' } as any);
      expect(p.riskReassessmentSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRiskLevel: 'HIGH' }) }),
      );
    });

    it.each([
      [9, 'HIGH'],
      [12, 'HIGH'],
      [13, 'MODERATE'],
      [14, 'MODERATE'],
      [15, 'LOW'],
      [23, 'LOW'],
    ])('Braden %i점 → %s (욕창도 서버가 재산정한다)', async (score, level) => {
      p.riskReassessmentSchedule.findUnique.mockResolvedValue({ ...mockSched, assessmentType: 'PRESSURE_ULCER', toolName: 'BRADEN', intervalHours: 24 });
      await service.recordAssessment('rs-1', { totalScore: score, assessedBy: 'n-1' } as any);
      expect(p.riskReassessmentSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRiskLevel: level }) }),
      );
    });

    it('욕창 평가는 fall_risk_assessments 에 기록하지 않는다 (Braden 점수 오염 금지)', async () => {
      p.riskReassessmentSchedule.findUnique.mockResolvedValue({ ...mockSched, assessmentType: 'PRESSURE_ULCER', toolName: 'BRADEN', intervalHours: 24 });
      await service.recordAssessment('rs-1', { totalScore: 10, assessedBy: 'n-1' } as any);
      expect(p.fallRiskAssessment.create).not.toHaveBeenCalled();
    });
  });

  describe('가드 ④ 재평가 주기 정본이 하나', () => {
    it('정본 표에서 주기를 가져온다 — 서비스가 숫자를 새로 만들지 않는다', async () => {
      await service.recordAssessment('rs-1', { totalScore: 90, assessedBy: 'n-1' } as any);
      expect(p.riskReassessmentSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ intervalHours: REASSESSMENT_INTERVAL_HOURS.FALL_RISK.HIGH }) }),
      );
    });

    it('욕창 고위험은 24h 고정이 아니다 — 재산정된다', async () => {
      p.riskReassessmentSchedule.findUnique.mockResolvedValue({ ...mockSched, assessmentType: 'PRESSURE_ULCER', toolName: 'BRADEN', intervalHours: 24 });
      await service.recordAssessment('rs-1', { totalScore: 9, assessedBy: 'n-1' } as any);
      const arg = p.riskReassessmentSchedule.update.mock.calls[0][0];
      expect(arg.data.intervalHours).toBe(REASSESSMENT_INTERVAL_HOURS.PRESSURE_ULCER.HIGH);
      expect(arg.data.intervalHours).toBeLessThan(24);
    });

    it('주기는 위험도가 높을수록 짧다 (두 유형 모두)', () => {
      for (const t of ['FALL_RISK', 'PRESSURE_ULCER'] as const) {
        expect(intervalHoursFor(t, 'HIGH')).toBeLessThan(intervalHoursFor(t, 'MODERATE'));
        expect(intervalHoursFor(t, 'MODERATE')).toBeLessThan(intervalHoursFor(t, 'LOW'));
      }
    });

    it('deriveRiskLevel 은 Braden 을 역방향으로 다룬다(점수 낮을수록 고위험)', () => {
      expect(deriveRiskLevel('PRESSURE_ULCER', 6)).toBe('HIGH');
      expect(deriveRiskLevel('PRESSURE_ULCER', 23)).toBe('LOW');
      expect(deriveRiskLevel('FALL_RISK', 0)).toBe('LOW');
      expect(deriveRiskLevel('FALL_RISK', 125)).toBe('HIGH');
    });
  });

  describe('가드 ① 표본 0 이 "지연 없음"으로 보이지 않는다', () => {
    it('활성 스케줄 0 이면 hasSample=false 를 내려준다', async () => {
      p.riskReassessmentSchedule.count.mockResolvedValue(0);
      const r = await service.getStats();
      expect(r.hasSample).toBe(false);
      expect(r.activeSchedules).toBe(0);
      expect(r.overdueCount).toBe(0); // 숫자는 0 이지만 hasSample 로 '산출 불가'임을 화면에 알린다
    });

    it('활성 스케줄이 있으면 hasSample=true', async () => {
      p.riskReassessmentSchedule.count.mockResolvedValue(3);
      expect((await service.getStats()).hasSample).toBe(true);
    });

    it('riskDistribution 을 서버가 집계해 내려준다 (FE 폴백이 전건 0 을 만들던 것)', async () => {
      p.riskReassessmentSchedule.count.mockResolvedValue(4);
      p.riskReassessmentSchedule.groupBy
        .mockResolvedValueOnce([{ assessmentType: 'FALL_RISK', _count: { id: 3 } }])
        .mockResolvedValueOnce([{ lastRiskLevel: 'HIGH', _count: { id: 2 } }]);
      const r = await service.getStats();
      expect(r.byType.FALL_RISK).toBe(3);
      expect(r.riskDistribution.HIGH).toBe(2);
      expect(r.neverAssessed).toBe(2);
    });
  });

  describe('지연 목록 계약 (FE 가 읽는 이름)', () => {
    it('id 와 서버 계산 overdueMinutes 를 포함한다 — scheduleId undefined 로 400 나던 것', async () => {
      const due = new Date(Date.now() - 90 * 60 * 1000);
      p.riskReassessmentSchedule.findMany.mockResolvedValue([{ ...mockSched, nextDueAt: due, patient: null }]);
      const [row] = await service.getOverdue();
      expect(row.id).toBe('rs-1');
      expect(row.overdueMinutes).toBeGreaterThanOrEqual(89);
      expect(row).toHaveProperty('lastRiskLevel');
    });
  });

  describe('autoCreateOnAdmission — 멱등', () => {
    it('이미 활성 스케줄이 있으면 중복 생성하지 않는다', async () => {
      p.riskReassessmentSchedule.findMany.mockResolvedValue([{ assessmentType: 'FALL_RISK' }, { assessmentType: 'PRESSURE_ULCER' }]);
      const r = await service.autoCreateOnAdmission('p-1', 'a-1');
      expect(r).toEqual([]);
      expect(p.riskReassessmentSchedule.create).not.toHaveBeenCalled();
    });

    it('없는 유형만 생성한다', async () => {
      p.riskReassessmentSchedule.findMany.mockResolvedValue([{ assessmentType: 'FALL_RISK' }]);
      await service.autoCreateOnAdmission('p-1', 'a-1');
      expect(p.riskReassessmentSchedule.create).toHaveBeenCalledTimes(1);
      expect(p.riskReassessmentSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assessmentType: 'PRESSURE_ULCER', toolName: 'BRADEN' }) }),
      );
    });
  });
});
