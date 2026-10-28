import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BurnAssessmentService } from '../../src/modules/burn-assessment/burn-assessment.service';

describe('BurnAssessmentService', () => {
  let service: BurnAssessmentService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      burnAssessment: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
    };
    service = new BurnAssessmentService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.burnAssessment.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { assessedAt: new Date('2026-05-20') } }]);
      mockPrisma.burnAssessment.findMany = vi.fn().mockResolvedValue([{ patientId: 'p-1', tbsa: 12 }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.burnAssessment.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { assessedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') }); expect((r.items[0] as any).lastTbsa).toBe(12);
    });
  });

  /* ───── getAssessments ───── */

  describe('getAssessments', () => {
    it('should return assessments for a patient', async () => {
      const data = [{ id: 'a-1', tbsa: 25, mechanism: 'FLAME' }];
      mockPrisma.burnAssessment.findMany.mockResolvedValue(data);
      const result = await service.getAssessments('p-1');
      expect(result).toEqual(data);
      expect(mockPrisma.burnAssessment.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { assessor: { select: { familyName: true, givenName: true } } },
        orderBy: { assessedAt: 'desc' },
      });
    });

    it('should return empty array for patient with no assessments', async () => {
      mockPrisma.burnAssessment.findMany.mockResolvedValue([]);
      const result = await service.getAssessments('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createAssessment ───── */

  describe('createAssessment', () => {
    it('should create a burn assessment', async () => {
      const input = {
        patientId: 'p-1', tbsa: 25,
        regions: [
          { region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' },
          { region: 'BACK', percentage: 16, depth: 'THIRD_DEGREE' },
        ],
        mechanism: 'FLAME', assessedBy: 'doc-1',
      };
      mockPrisma.burnAssessment.create.mockResolvedValue({ id: 'a-new', ...input });
      const result = await service.createAssessment(input);
      expect(result.id).toBe('a-new');
    });

    it('[P1] should derive tbsa server-side from regions (ignore/cross-check client tbsa)', async () => {
      const input = {
        patientId: 'p-1',
        regions: [
          { region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' },
          { region: 'BACK', percentage: 16, depth: 'THIRD_DEGREE' },
        ],
        assessedBy: 'doc-1',
      };
      mockPrisma.burnAssessment.create.mockResolvedValue({ id: 'a-derived' });
      await service.createAssessment(input);
      const callArg = mockPrisma.burnAssessment.create.mock.calls[0][0];
      expect(callArg.data.tbsa).toBe(25);
    });

    it('[P1] should reject when client tbsa deviates from region sum', async () => {
      const input = {
        patientId: 'p-1', tbsa: 80,
        regions: [{ region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' }],
        assessedBy: 'doc-1',
      };
      await expect(service.createAssessment(input)).rejects.toMatchObject({
        response: { code: 'BURN_TBSA_MISMATCH' },
      });
    });

    it('should default isChild to false', async () => {
      const input = {
        patientId: 'p-1', tbsa: 10,
        regions: [{ region: 'HAND', percentage: 10, depth: 'FIRST_DEGREE' }],
        assessedBy: 'doc-1',
      };
      mockPrisma.burnAssessment.create.mockResolvedValue({ id: 'a-adult' });
      await service.createAssessment(input);
      const callArg = mockPrisma.burnAssessment.create.mock.calls[0][0];
      expect(callArg.data.isChild).toBe(false);
    });

    it('should set isChild when provided', async () => {
      const input = {
        patientId: 'p-1', tbsa: 15,
        regions: [{ region: 'HEAD', percentage: 15, depth: 'SECOND_DEGREE' }],
        isChild: true, assessedBy: 'doc-1',
      };
      mockPrisma.burnAssessment.create.mockResolvedValue({ id: 'a-child' });
      await service.createAssessment(input);
      const callArg = mockPrisma.burnAssessment.create.mock.calls[0][0];
      expect(callArg.data.isChild).toBe(true);
    });

    it('should include patient in response', async () => {
      const input = {
        patientId: 'p-1', tbsa: 5,
        regions: [{ region: 'FOOT', percentage: 5, depth: 'FIRST_DEGREE' }],
        assessedBy: 'doc-1',
      };
      mockPrisma.burnAssessment.create.mockResolvedValue({ id: 'a-inc' });
      await service.createAssessment(input);
      expect(mockPrisma.burnAssessment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });

    it('should pass notes to data', async () => {
      const input = {
        patientId: 'p-1', tbsa: 20,
        regions: [{ region: 'BACK', percentage: 20, depth: 'SECOND_DEGREE' }],
        notes: 'Hot water scald', assessedBy: 'doc-1',
      };
      mockPrisma.burnAssessment.create.mockResolvedValue({ id: 'a-notes' });
      await service.createAssessment(input);
      const callArg = mockPrisma.burnAssessment.create.mock.calls[0][0];
      expect(callArg.data.notes).toBe('Hot water scald');
    });
  });

  /* ───── calculateTbsa ───── */

  describe('calculateTbsa', () => {
    it('should sum region percentages', () => {
      const regions = [
        { region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' },
        { region: 'RIGHT_ARM', percentage: 9, depth: 'SECOND_DEGREE' },
        { region: 'TRUNK', percentage: 18, depth: 'THIRD_DEGREE' },
      ];
      const result = service.calculateTbsa(regions, false);
      expect(result.tbsa).toBe(36);
    });

    it('should group by depth', () => {
      const regions = [
        { region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' },
        { region: 'RIGHT_ARM', percentage: 9, depth: 'SECOND_DEGREE' },
        { region: 'TRUNK', percentage: 18, depth: 'THIRD_DEGREE' },
      ];
      const result = service.calculateTbsa(regions, false);
      expect(result.byDepth['SECOND_DEGREE']).toBe(18);
      expect(result.byDepth['THIRD_DEGREE']).toBe(18);
    });

    it('[P1] should reject negative or >100 region percentage', () => {
      expect(() => service.calculateTbsa([{ region: 'TRUNK', percentage: -5, depth: 'X' }], false))
        .toThrowError();
      expect(() => service.calculateTbsa([{ region: 'TRUNK', percentage: 150, depth: 'X' }], false))
        .toThrowError();
    });

    it('[P1] should reject region exceeding adult Rule-of-Nines max (CHEST 16% > 9%)', () => {
      expect(() => service.calculateTbsa([{ region: 'CHEST', percentage: 16, depth: 'X' }], false))
        .toThrowError();
    });

    it('[P1] should honor pediatric max (HEAD 18% ok for child, 16% over adult 9%)', () => {
      // child: HEAD max 18 → 18 ok
      expect(service.calculateTbsa([{ region: 'HEAD', percentage: 18, depth: 'X' }], true).tbsa).toBe(18);
      // adult: HEAD max 9 → 16 rejected
      expect(() => service.calculateTbsa([{ region: 'HEAD', percentage: 16, depth: 'X' }], false))
        .toThrowError();
    });

    it('[P1] should reject total TBSA over 100%', () => {
      const regions = Array.from({ length: 12 }, (_, i) => ({ region: `X${i}`, percentage: 9, depth: 'X' }));
      expect(() => service.calculateTbsa(regions, false)).toThrowError();
    });

    it('[P2] 같은 부위 다중 항목의 합이 캡 초과면 차단(항목별 우회 방지)', () => {
      // 각 항목은 9%(성인 HEAD 캡 9 이내)지만 합 18% → 해부학적 최대 초과
      expect(() => service.calculateTbsa([
        { region: 'HEAD', percentage: 9, depth: 'X' },
        { region: 'HEAD', percentage: 9, depth: 'X' },
      ], false)).toThrowError();
    });

    it('[P2] 케이스 불일치(head)도 정규화되어 캡 적용', () => {
      expect(() => service.calculateTbsa([{ region: 'head', percentage: 16, depth: 'X' }], false)).toThrowError();
    });

    it('should handle single region', () => {
      const regions = [{ region: 'HEAD', percentage: 9, depth: 'FIRST_DEGREE' }];
      const result = service.calculateTbsa(regions, false);
      expect(result.tbsa).toBe(9);
      expect(result.byDepth['FIRST_DEGREE']).toBe(9);
    });

    it('should handle empty regions', () => {
      const result = service.calculateTbsa([], false);
      expect(result.tbsa).toBe(0);
      expect(result.byDepth).toEqual({});
    });

    it('should round to 2 decimal places', () => {
      const regions = [
        { region: 'HAND', percentage: 2.333, depth: 'FIRST_DEGREE' },
        { region: 'FOOT', percentage: 1.667, depth: 'FIRST_DEGREE' },
      ];
      const result = service.calculateTbsa(regions, false);
      expect(result.tbsa).toBe(4);
      expect(result.byDepth['FIRST_DEGREE']).toBe(4);
    });

    it('should accept isChild parameter', () => {
      const regions = [{ region: 'HEAD', percentage: 18, depth: 'SECOND_DEGREE' }];
      const result = service.calculateTbsa(regions, true);
      expect(result.tbsa).toBe(18);
    });

    it('should handle UNSPECIFIED depth for empty depth string', () => {
      const regions = [{ region: 'TRUNK', percentage: 10, depth: '' }];
      const result = service.calculateTbsa(regions, false);
      expect(result.byDepth['UNSPECIFIED']).toBe(10);
    });

    it('should handle multiple depths correctly', () => {
      const regions = [
        { region: 'CHEST', percentage: 9, depth: 'FIRST_DEGREE' },
        { region: 'ABDOMEN', percentage: 9, depth: 'SECOND_DEGREE' },
        { region: 'BACK', percentage: 18, depth: 'THIRD_DEGREE' },
      ];
      const result = service.calculateTbsa(regions, false);
      expect(result.tbsa).toBe(36);
      expect(Object.keys(result.byDepth)).toHaveLength(3);
    });
  });

  describe('calculateParkland', () => {
    beforeEach(() => {
      mockPrisma.preVisitVitals = { findFirst: vi.fn().mockResolvedValue(null) };
    });

    it('should compute 4mL×kg×TBSA split 8h/16h', async () => {
      const r = await service.calculateParkland({ weightKg: 70, tbsa: 30 });
      expect(r.totalMl24h).toBe(8400);
      expect(r.first8hMl).toBe(4200);
      expect(r.next16hMl).toBe(4200);
      expect(r.resuscitationIndicated).toBe(true); // 성인 TBSA≥15
      expect(r.urineOutputTargetMlHr).toBe(35); // 0.5×70
    });

    it('should auto-resolve weight from latest PreVisitVitals', async () => {
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue({ weight: 60, measuredAt: new Date() });
      const r = await service.calculateParkland({ patientId: 'p-1', tbsa: 20 });
      expect(r.weightKg).toBe(60);
      expect(r.weightSource).toBe('PRE_VISIT_VITALS');
      expect(r.totalMl24h).toBe(4800);
    });

    it('should throw when weight unavailable', async () => {
      await expect(service.calculateParkland({ patientId: 'p-1', tbsa: 20 })).rejects.toThrow();
    });

    it('should compress remaining first-phase volume on delayed arrival', async () => {
      const r = await service.calculateParkland({ weightKg: 70, tbsa: 30, hoursSinceBurn: 4 });
      expect(r.remainingFirstPhaseMl).toBe(2100); // 절반 소진 가정
      expect(r.firstPhaseRateMlHr).toBe(Math.round(2100 / 4));
    });

    it('should use pediatric thresholds (적응 TBSA≥10·소변량 1.0mL/kg/h)', async () => {
      const r = await service.calculateParkland({ weightKg: 20, tbsa: 12, isChild: true });
      expect(r.resuscitationIndicated).toBe(true);
      expect(r.urineOutputTargetMlHr).toBe(20);
    });
  });
});
