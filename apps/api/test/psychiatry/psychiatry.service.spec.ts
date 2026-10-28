import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PsychiatryService } from '../../src/modules/psychiatry/psychiatry.service';

describe('PsychiatryService', () => {
  let service: PsychiatryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      psychExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
    };
    // 🔴 (H4) 격리 관찰 기록과 자동 해제가 한 트랜잭션이 됐다 — 목은 정본의 실제 호출 모양을 쓴다
    //    (아래 연장 테스트가 쓰는 배열형 $transaction 도 같은 목이 처리한다)
    mockPrisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );
    service = new PsychiatryService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.psychExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.psychExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return exams for a patient', async () => {
      const exams = [{ id: 'e-1', mood: 'depressed', phq9: 15 }];
      mockPrisma.psychExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      expect(result).toEqual(exams);
      expect(mockPrisma.psychExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should return empty array for no exams', async () => {
      mockPrisma.psychExam.findMany.mockResolvedValue([]);
      const result = await service.getExams('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create a psychiatric exam with MSE fields', async () => {
      const input = {
        patientId: 'p-1', mood: 'anxious', affect: 'constricted',
        appearance: 'well-groomed', phq9: 12, gad7: 15,
        examinedBy: 'doc-1',
      };
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-new', ...input });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
    });

    it('should create exam with suicide risk assessment (structured safetyPlan JSON)', async () => {
      const input = {
        patientId: 'p-1', suicideRisk: 'HIGH',
        safetyPlan: { steps: ['call 1393'] },
        examinedBy: 'doc-1',
      };
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-risk' });
      await service.createExam(input);
      const callArg = mockPrisma.psychExam.create.mock.calls[0][0];
      expect(callArg.data.suicideRisk).toBe('HIGH');
      expect(callArg.data.safetyPlan).toEqual({ steps: ['call 1393'] });
    });

    it('[P1] should emit psych.suicide.high on HIGH suicide risk', async () => {
      const emit = vi.fn();
      const svc = new PsychiatryService(mockPrisma, { emit } as any);
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-h' });
      await svc.createExam({ patientId: 'p-1', suicideRisk: 'HIGH', examinedBy: 'doc-1' });
      expect(emit).toHaveBeenCalledWith('psych.suicide.high', expect.objectContaining({ patientId: 'p-1' }));
    });

    it('[P1] should NOT emit when suicide risk is not HIGH', async () => {
      const emit = vi.fn();
      const svc = new PsychiatryService(mockPrisma, { emit } as any);
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-l' });
      await svc.createExam({ patientId: 'p-1', suicideRisk: 'LOW', examinedBy: 'doc-1' });
      expect(emit).not.toHaveBeenCalled();
    });

    it('[P0] PHQ-9 문항9 양성(≥1)이면 suicideRisk 미HIGH여도 에스컬레이션', async () => {
      const emit = vi.fn();
      const svc = new PsychiatryService(mockPrisma, { emit } as any);
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-i9' });
      // 임상의가 자살위험 체크 누락(LOW)했지만 문항9=3(거의 매일 자살 사고)
      await svc.createExam({ patientId: 'p-1', suicideRisk: 'LOW', phq9: 12, phq9Item9: 3, examinedBy: 'doc-1' });
      expect(emit).toHaveBeenCalledWith('psych.suicide.high', expect.objectContaining({ patientId: 'p-1', trigger: 'PHQ9_ITEM9', phq9Item9: 3 }));
    });

    it('[P0] PHQ-9 문항9=0이면 에스컬레이션 안 함', async () => {
      const emit = vi.fn();
      const svc = new PsychiatryService(mockPrisma, { emit } as any);
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-i0' });
      await svc.createExam({ patientId: 'p-1', suicideRisk: 'LOW', phq9: 6, phq9Item9: 0, examinedBy: 'doc-1' });
      expect(emit).not.toHaveBeenCalled();
    });

    it('phq9Item9 값 저장(감사보존)', async () => {
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-store' });
      await service.createExam({ patientId: 'p-1', phq9Item9: 2, examinedBy: 'doc-1' });
      expect(mockPrisma.psychExam.create.mock.calls[0][0].data.phq9Item9).toBe(2);
    });

    it('should create exam with MMSE score', async () => {
      const input = { patientId: 'p-1', mmse: 22, examinedBy: 'doc-1' };
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-mmse' });
      await service.createExam(input);
      const callArg = mockPrisma.psychExam.create.mock.calls[0][0];
      expect(callArg.data.mmse).toBe(22);
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', examinedBy: 'doc-1' };
      mockPrisma.psychExam.create.mockResolvedValue({ id: 'e-inc' });
      await service.createExam(input);
      expect(mockPrisma.psychExam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });
  });

  /* ───── getScoreTrend ───── */

  describe('getScoreTrend', () => {
    it('should return mapped score trend data', async () => {
      const exams = [
        { examinedAt: new Date('2026-01-01'), phq9: 20, gad7: 18, mmse: 24 },
        { examinedAt: new Date('2026-03-01'), phq9: 15, gad7: 12, mmse: 26 },
      ];
      mockPrisma.psychExam.findMany.mockResolvedValue(exams);
      const result = await service.getScoreTrend('p-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: exams[0].examinedAt, phq9: 20, gad7: 18, mmse: 24 });
      expect(result[1]).toEqual({ date: exams[1].examinedAt, phq9: 15, gad7: 12, mmse: 26 });
    });

    it('should return empty array when no exams', async () => {
      mockPrisma.psychExam.findMany.mockResolvedValue([]);
      const result = await service.getScoreTrend('p-1');
      expect(result).toEqual([]);
    });

    it('should call findMany with asc order', async () => {
      mockPrisma.psychExam.findMany.mockResolvedValue([]);
      await service.getScoreTrend('p-1');
      expect(mockPrisma.psychExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        select: { examinedAt: true, phq9: true, gad7: true, mmse: true },
        orderBy: { examinedAt: 'asc' },
      });
    });

    it('should handle null scores', async () => {
      mockPrisma.psychExam.findMany.mockResolvedValue([
        { examinedAt: new Date(), phq9: null, gad7: 10, mmse: null },
      ]);
      const result = await service.getScoreTrend('p-1');
      expect(result[0].phq9).toBeNull();
      expect(result[0].mmse).toBeNull();
    });
  });

  /* ───── getToday ───── */

  describe('getToday', () => {
    it('🔴 오늘 예약(Appointment)을 조회한다 — 종전 `return []` 스텁은 영구 공집합이었다(W4)', async () => {
      const result = await service.getToday();
      expect(mockPrisma.appointment.findMany).toHaveBeenCalled();
      const where = mockPrisma.appointment.findMany.mock.calls[0][0].where;
      expect(where.doctor?.department?.in, '전문과↔진료과 매핑이 빠지면 남의 과 예약이 섞인다').toBeTruthy();
      expect(where.scheduledAt, "'오늘'은 상·하한을 모두 갖는다").toBeTruthy();
      expect(result).toEqual([]);
    });
  });

  /* ───── getStats ───── */

  describe('getStats', () => {
    it('should return stats', async () => {
      mockPrisma.psychExam.count.mockResolvedValue(30);
      const result = await service.getStats();
      expect(result).toMatchObject({ totalExams: 30 });
      // 오늘 값은 리터럴 0 이 아니라 실제 집계에서 온다(표본이 없으면 0 이 사실이다)
      expect(mockPrisma.appointment.groupBy).toHaveBeenCalled();
    });

    it('should return zero when empty', async () => {
      mockPrisma.psychExam.count.mockResolvedValue(0);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });
  });

  /* ───── §75 격리·강박 ───── */

  describe('seclusion (§75)', () => {
    let mockConfig: any;
    let svc: PsychiatryService;

    const psychiatrist = { role: 'DOCTOR', department: '정신건강의학과', name: '김정신' };
    const internist = { role: 'DOCTOR', department: '내과', name: '이내과' };

    beforeEach(() => {
      mockPrisma.user = { findUnique: vi.fn().mockResolvedValue(psychiatrist) };
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.psychSeclusionOrder = {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'so-1', ...data })),
        update: vi.fn().mockResolvedValue({}),
      };
      mockPrisma.psychSeclusionMonitoring = { create: vi.fn().mockResolvedValue({ id: 'mon-1' }) };
      mockPrisma.psychSeclusionExtension = { create: vi.fn() };
      // 🔴 (H4) 배열형만 처리하던 목 — 격리 관찰↔해제가 콜백형 트랜잭션이 되면서 "function is not iterable" 로 터졌다.
      //    목은 정본이 실제로 부르는 두 형태를 모두 처리한다.
      mockPrisma.$transaction = vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      );
      mockConfig = { get: vi.fn().mockResolvedValue(undefined) };
      svc = new PsychiatryService(mockPrisma, undefined, mockConfig);
    });

    it('should set legal max 12h for SECLUSION and 4h for RESTRAINT', async () => {
      const s = await svc.createSeclusion({ patientId: 'p-1', type: 'SECLUSION', reason: '자해 시도', riskType: 'SELF_HARM' }, 'u-1');
      const r = await svc.createSeclusion({ patientId: 'p-2', type: 'RESTRAINT', reason: '타해 위험', riskType: 'HARM_OTHERS' }, 'u-1');
      const hours = (o: any) => Math.round((o.legalMaxUntil.getTime() - o.startedAt.getTime()) / 3600000);
      expect(hours(s)).toBe(12);
      expect(hours(r)).toBe(4);
      expect(s.psychiatristVerified).toBe(true);
    });

    it('should BLOCK non-psychiatrist order when gate=BLOCK', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'psychiatry.seclusionEnforce' ? 'BLOCK' : undefined));
      mockPrisma.user.findUnique.mockResolvedValue(internist);

      await expect(
        svc.createSeclusion({ patientId: 'p-1', type: 'SECLUSION', reason: '사유', riskType: 'BOTH' }, 'u-2'),
      ).rejects.toThrow();
      expect(mockPrisma.psychSeclusionOrder.create).not.toHaveBeenCalled();
    });

    it('should allow but mark unverified in WARN mode (default)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(internist);
      const s = await svc.createSeclusion({ patientId: 'p-1', type: 'RESTRAINT', reason: '사유', riskType: 'BOTH' }, 'u-2');
      expect(s.psychiatristVerified).toBe(false);
    });

    it('should reject duplicate active order of same type', async () => {
      mockPrisma.psychSeclusionOrder.findFirst.mockResolvedValue({ id: 'so-exist' });
      await expect(
        svc.createSeclusion({ patientId: 'p-1', type: 'SECLUSION', reason: '사유', riskType: 'BOTH' }, 'u-1'),
      ).rejects.toThrow();
    });

    it('should auto-release when monitoring continued=false', async () => {
      mockPrisma.psychSeclusionOrder.findUnique.mockResolvedValue({ id: 'so-1', status: 'ACTIVE', patientId: 'p-1' });
      await svc.recordSeclusionMonitoring('so-1', { observation: '안정', continued: false }, 'n-1');
      expect(mockPrisma.psychSeclusionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RELEASED' }) }),
      );
    });

    it('should extend legalMaxUntil by legal unit with extension audit', async () => {
      const legalMaxUntil = new Date(Date.now() + 3600_000);
      mockPrisma.psychSeclusionOrder.findUnique.mockResolvedValue({ id: 'so-1', status: 'ACTIVE', type: 'RESTRAINT', legalMaxUntil });
      await svc.extendSeclusion('so-1', { reason: '대면진찰 — 지속 위험' }, 'u-1');
      expect(mockPrisma.psychSeclusionExtension.create).toHaveBeenCalled();
      const newMax = mockPrisma.psychSeclusionExtension.create.mock.calls[0][0].data.newMaxUntil;
      expect(Math.round((newMax.getTime() - legalMaxUntil.getTime()) / 3600000)).toBe(4);
    });
  });

  /* ───── ECT ───── */

  describe('ECT', () => {
    let mockConfig: any;
    let svc: PsychiatryService;

    beforeEach(() => {
      mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR', department: '정신건강의학과', name: '김정신' }) };
      mockPrisma.consentForm = { findUnique: vi.fn() };
      mockPrisma.ectSession = {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ect-1', ...data })),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      };
      mockConfig = { get: vi.fn().mockResolvedValue(undefined) };
      svc = new PsychiatryService(mockPrisma, undefined, mockConfig);
    });

    it('should BLOCK ECT without signed consent (default gate)', async () => {
      await expect(svc.createEct({ patientId: 'p-1' }, 'u-1')).rejects.toThrow();
    });

    it('should reject consent of another patient', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({ patientId: 'p-OTHER', signedAt: new Date(), isValid: true });
      await expect(svc.createEct({ patientId: 'p-1', consentFormId: 'c-1' }, 'u-1')).rejects.toThrow();
    });

    it('should create ECT with valid signed consent', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({ patientId: 'p-1', signedAt: new Date(), isValid: true });
      const ect = await svc.createEct({ patientId: 'p-1', consentFormId: 'c-1' }, 'u-1');
      expect(ect.patientId).toBe('p-1');
      expect(mockPrisma.ectSession.create).toHaveBeenCalled();
    });
  });
});
