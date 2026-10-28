import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ClinicalPathwayService,
  computePathwayProgress,
  gateMilestoneIds,
} from '../../src/modules/clinical-pathway/clinical-pathway.service';

/**
 * 진행률·완료 **정본 산식 가드**(화면 실사용 점검 W7 ⑩⑪).
 *
 * 🔴 종전 결함
 *   - 목록 진행률 = `_count.outcomes`(상태 무관) → 6개 마일스톤을 전부 '건너뜀'으로 기록해도
 *     진행률 100% · 초록 막대가 떴다.
 *   - 자동 완료 판정 = 필수 마일스톤이 전부 DONE 일 때만 → **완료 정본이 두 벌**(P12).
 *   - 상세 EP 는 totalMilestones/completedMilestones 를 아예 주지 않아 화면 진행률이 항상 0% 였다.
 *
 * 이 스펙은 "목록 = 상세 = 자동 완료판정"이 같은 산식임을 고정한다.
 */
describe('임상경로 진행률 정본 가드', () => {
  const milestones = [
    { id: 'ms-1', isRequired: true },
    { id: 'ms-2', isRequired: true },
    { id: 'ms-3', isRequired: false },
    { id: 'ms-4', isRequired: true },
  ];

  describe('computePathwayProgress', () => {
    it('건너뜀·지연·이탈은 완료로 세지 않는다 (DONE 만 분자)', () => {
      // outcome 은 4건 기록됐지만 DONE 은 1건뿐인 상황
      const p = computePathwayProgress(milestones, new Set(['ms-1']));
      expect(p.completedMilestones).toBe(1);
      expect(p.requiredMilestones).toBe(3);
      expect(p.progressRate).toBe(33);
    });

    it('전부 건너뜀이면 진행률은 0% 다 (종전엔 100% 였다)', () => {
      const p = computePathwayProgress(milestones, new Set());
      expect(p.progressRate).toBe(0);
    });

    it('진행률 100% 는 자동 완료판정과 정확히 같은 순간이다', () => {
      const done = new Set(gateMilestoneIds(milestones));
      const p = computePathwayProgress(milestones, done);
      expect(p.progressRate).toBe(100);
      expect(p.completedMilestones).toBe(gateMilestoneIds(milestones).length);
    });

    it('필수 마일스톤이 없으면 전체가 게이트가 된다', () => {
      const optional = [
        { id: 'a', isRequired: false },
        { id: 'b', isRequired: false },
      ];
      expect(gateMilestoneIds(optional)).toEqual(['a', 'b']);
      expect(computePathwayProgress(optional, new Set(['a'])).progressRate).toBe(50);
    });

    it('마일스톤이 하나도 없으면 0% 가 아니라 null(산출 불가)', () => {
      const p = computePathwayProgress([], new Set());
      expect(p.progressRate).toBeNull();
      expect(p.requiredMilestones).toBe(0);
    });
  });

  describe('목록 EP 와 상세 EP 가 같은 값을 낸다', () => {
    let service: ClinicalPathwayService;
    let mockPrisma: any;

    const assignment = {
      id: 'asgn-1',
      pathwayId: 'pw-1',
      patientId: 'pat-1',
      encounterId: 'enc-1',
      startDate: new Date('2026-05-01'),
      status: 'ACTIVE',
      deviations: 1,
    };

    beforeEach(() => {
      mockPrisma = {
        pathwayAssignment: { findMany: vi.fn(), findUnique: vi.fn() },
        pathwayMilestone: { findMany: vi.fn() },
        milestoneOutcome: { findMany: vi.fn() },
      };
      service = new ClinicalPathwayService(mockPrisma);
    });

    /** 마일스톤 4개(필수 3) 중 ms-1 만 DONE, 나머지는 건너뜀/이탈로 기록된 상황 */
    const outcomes = [
      { milestoneId: 'ms-1', status: 'DONE' },
      { milestoneId: 'ms-2', status: 'SKIPPED' },
      { milestoneId: 'ms-3', status: 'DELAYED' },
      { milestoneId: 'ms-4', status: 'DEVIATED' },
    ];

    it('getAssignments — 기록 4건이어도 진행률은 33% (DONE 1 / 필수 3)', async () => {
      mockPrisma.pathwayAssignment.findMany.mockResolvedValue([
        { ...assignment, pathway: { name: 'CP', code: 'C1', totalDays: 7, department: '내과' }, patient: { id: 'pat-1' } },
      ]);
      mockPrisma.pathwayMilestone.findMany.mockResolvedValue(
        milestones.map((m) => ({ ...m, pathwayId: 'pw-1' })),
      );
      mockPrisma.milestoneOutcome.findMany.mockResolvedValue([
        { assignmentId: 'asgn-1', milestoneId: 'ms-1' },
      ]);

      const [row] = await service.getAssignments();

      expect(row.progressRate).toBe(33);
      expect(row.completedMilestones).toBe(1);
      expect(row.requiredMilestones).toBe(3);
      expect(row.totalMilestones).toBe(4);
      // 서버는 DONE 만 조회한다 — 상태 무관 카운트로 되돌아가면 이 단언이 깨진다
      expect(mockPrisma.milestoneOutcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'DONE' }) }),
      );
    });

    it('getAssignment(상세) — 목록과 같은 33% 를 준다 (종전엔 필드 부재로 항상 0%)', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue({
        ...assignment,
        pathway: { id: 'pw-1', name: 'CP', milestones },
        patient: { id: 'pat-1' },
        outcomes,
      });

      const detail = await service.getAssignment('asgn-1');

      expect(detail.progressRate).toBe(33);
      expect(detail.completedMilestones).toBe(1);
      expect(detail.requiredMilestones).toBe(3);
    });

    it('배정이 없으면 빈 배열 — 폴백 행을 만들지 않는다', async () => {
      mockPrisma.pathwayAssignment.findMany.mockResolvedValue([]);
      expect(await service.getAssignments()).toEqual([]);
      expect(mockPrisma.pathwayMilestone.findMany).not.toHaveBeenCalled();
    });

    it("deviated=true 는 상태가 아니라 deviations>0 으로 거른다 (배정 상태 'DEVIATED' 는 쓰이지 않는다)", async () => {
      mockPrisma.pathwayAssignment.findMany.mockResolvedValue([]);

      await service.getAssignments(undefined, undefined, true);

      expect(mockPrisma.pathwayAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deviations: { gt: 0 } } }),
      );
    });
  });
});
