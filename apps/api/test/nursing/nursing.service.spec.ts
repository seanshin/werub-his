import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NursingService, levenshteinCapped, nursingNoteText, buildCarePlanContext, matchCarePlanNeeds, signDraftText } from '../../src/modules/nursing/nursing.service';
import {
  AdmissionNotFoundError, NursingAssessmentExistsError,
  MedAdminNotFoundError, MedAdminNotScheduledError,
} from '../../src/domain/errors/domain-error';

describe('NursingService', () => {
  let service: NursingService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 2026-10-10 초기평가 저장이 Braden 이력 행·재평가 일정과 한 트랜잭션이 됐다 — 대화형 트랜잭션은 같은 목으로 돈다
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
      admission: {
        findUnique: vi.fn(),
      },
      nursingAssessment: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      nursingDiagnosis: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      nursingNote: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      intakeOutput: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      prescription: {
        findUnique: vi.fn(),
      },
      medicationAdministration: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        createMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        // 기본: 유효한 활성 간호 검증자
        findUnique: vi.fn().mockResolvedValue({ id: 'nurse-2', isActive: true, accountStage: 'ACTIVE', role: 'NURSE' }),
      },
      flowSheetEntry: {
        create: vi.fn().mockResolvedValue({ id: 'fs-1' }),
        // I/O 읽기 정본이 플로시트 I/O 칸도 읽는다(2026-10-10) — 기본 없음
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new NursingService(mockPrisma);
  });

  describe('createAssessment', () => {
    it('should create nursing initial assessment', async () => {
      const dto = {
        consciousness: 'Alert',
        mobility: 'Independent',
        painScore: 3,
        painLocation: '좌측 하복부',
        nutritionStatus: 'Adequate',
        skinIntegrity: 'Intact',
        bradenScore: 20,
        allergyConfirmed: true,
      };

      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.nursingAssessment.findFirst.mockResolvedValue(null);
      mockPrisma.nursingAssessment.create.mockResolvedValue({
        id: 'na-1',
        admissionId: 'adm-1',
        nurseId: 'nurse-1',
        ...dto,
        nurse: { id: 'nurse-1', familyName: '박', givenName: '간호사' },
      });

      const result = await service.createAssessment('adm-1', dto as any, 'nurse-1');

      expect(result.id).toBe('na-1');
      expect(result.consciousness).toBe('Alert');
      expect(mockPrisma.nursingAssessment.create).toHaveBeenCalled();
    });

    it('should throw AdmissionNotFoundError if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.createAssessment('adm-1', {} as any, 'nurse-1')).rejects.toThrow(
        AdmissionNotFoundError,
      );
    });

    it('should throw NursingAssessmentExistsError if already exists', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.nursingAssessment.findFirst.mockResolvedValue({ id: 'na-1' });

      await expect(service.createAssessment('adm-1', {} as any, 'nurse-1')).rejects.toThrow(
        NursingAssessmentExistsError,
      );
    });
  });

  describe('getAssessment', () => {
    it('should return nursing assessment with related data', async () => {
      const mockAssessment = {
        id: 'na-1',
        admissionId: 'adm-1',
        consciousness: 'Alert',
        painScore: 3,
        nurse: { id: 'nurse-1', familyName: '박', givenName: '간호사' },
        diagnoses: [],
      };

      mockPrisma.nursingAssessment.findFirst.mockResolvedValue(mockAssessment);

      const result = await service.getAssessment('adm-1');

      expect(result.id).toBe('na-1');
      expect(result.consciousness).toBe('Alert');
      expect(result.nurse.familyName).toBe('박');
    });

    it('should throw NotFoundException if assessment not found', async () => {
      mockPrisma.nursingAssessment.findFirst.mockResolvedValue(null);

      await expect(service.getAssessment('adm-1')).rejects.toThrow('Nursing assessment not found');
    });
  });

  describe('createDiagnosis', () => {
    it('should create nursing diagnosis', async () => {
      const data = {
        nandaCode: '00132',
        nandaName: '급성 통증',
        relatedFactors: '수술 후 상태',
        expectedOutcome: '통증 완화',
      };

      mockPrisma.nursingAssessment.findUnique.mockResolvedValue({ id: 'na-1' });
      mockPrisma.nursingDiagnosis.create.mockResolvedValue({
        id: 'nd-1',
        assessmentId: 'na-1',
        nurseId: 'nurse-1',
        ...data,
        nurse: { id: 'nurse-1', familyName: '박', givenName: '간호사' },
      });

      const result = await service.createDiagnosis('na-1', data, 'nurse-1');

      expect(result.id).toBe('nd-1');
      expect(result.nandaCode).toBe('00132');
      expect(mockPrisma.nursingDiagnosis.create).toHaveBeenCalled();
    });
  });

  describe('getDiagnoses', () => {
    it('should return diagnoses for assessment', async () => {
      const mockDiagnoses = [
        {
          id: 'nd-1',
          nandaCode: '00132',
          nandaName: '급성 통증',
          status: 'ACTIVE',
        },
      ];

      // 🔴 목은 정본이 실제로 부르는 모양을 준다 — getDiagnoses 는 평가 실재를 먼저 확인한다(없으면 404)
      mockPrisma.nursingAssessment.findUnique.mockResolvedValue({ id: 'na-1' });
      mockPrisma.nursingDiagnosis.findMany.mockResolvedValue(mockDiagnoses);

      const result = await service.getDiagnoses('na-1');

      expect(result).toHaveLength(1);
      expect(result[0].nandaCode).toBe('00132');
    });
  });

  describe('resolveDiagnosis', () => {
    it('should resolve diagnosis', async () => {
      mockPrisma.nursingDiagnosis.findUnique.mockResolvedValue({
        id: 'nd-1',
        status: 'ACTIVE',
      });

      mockPrisma.nursingDiagnosis.update.mockResolvedValue({
        id: 'nd-1',
        status: 'RESOLVED',
      });

      const result = await service.resolveDiagnosis('nd-1');

      expect(result.status).toBe('RESOLVED');
      expect(mockPrisma.nursingDiagnosis.update).toHaveBeenCalledWith({
        where: { id: 'nd-1' },
        data: { status: 'RESOLVED' },
        include: expect.any(Object),
      });
    });

    it('should throw error if already resolved', async () => {
      mockPrisma.nursingDiagnosis.findUnique.mockResolvedValue({
        id: 'nd-1',
        status: 'RESOLVED',
      });

      await expect(service.resolveDiagnosis('nd-1')).rejects.toThrow('already resolved');
    });
  });

  describe('createNote', () => {
    it('should create nursing note', async () => {
      const dto = {
        noteType: 'DAR',
        focus: '통증 관리',
        data: '좌측 하복부 통증 호소',
        action: '진통제 투약',
        response: '환자 안정됨',
        shiftType: 'D',
      };

      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.nursingNote.create.mockResolvedValue({
        id: 'nn-1',
        admissionId: 'adm-1',
        nurseId: 'nurse-1',
        ...dto,
        nurse: { id: 'nurse-1', familyName: '박', givenName: '간호사' },
      });

      const result = await service.createNote('adm-1', dto as any, 'nurse-1');

      expect(result.id).toBe('nn-1');
      expect(result.focus).toBe('통증 관리');
    });

    it('should throw AdmissionNotFoundError if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.createNote('adm-1', {} as any, 'nurse-1')).rejects.toThrow(
        AdmissionNotFoundError,
      );
    });

    it('SOAP 필드(S/O/A/P)·priority 영속화 — 종전 유실 버그 복구', async () => {
      const dto = {
        noteType: 'SOAP', shiftType: 'DAY',
        subjective: '통증 호소', objective: 'BP 150/95', assessment: '활력징후 상승', plan: '재측정', priority: 'URGENT',
      };
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.nursingNote.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'nn-2', ...data }));

      await service.createNote('adm-1', dto as any, 'nurse-1');

      const arg = mockPrisma.nursingNote.create.mock.calls[0][0];
      expect(arg.data).toMatchObject({
        subjective: '통증 호소', objective: 'BP 150/95', assessment: '활력징후 상승', plan: '재측정', priority: 'URGENT',
      });
    });
  });

  describe('getNotes', () => {
    it('should return nursing notes with filters', async () => {
      const mockNotes = [
        {
          id: 'nn-1',
          focus: '통증',
          shiftType: 'D',
          recordedAt: new Date(),
        },
      ];

      mockPrisma.nursingNote.findMany.mockResolvedValue(mockNotes);

      const result = await service.getNotes('adm-1', { shiftType: 'DAY' });

      expect(result).toHaveLength(1);
      expect(result[0].shiftType).toBe('D');
    });

    it('should filter by date', async () => {
      mockPrisma.nursingNote.findMany.mockResolvedValue([]);

      await service.getNotes('adm-1', { date: '2026-05-13' });

      expect(mockPrisma.nursingNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            admissionId: 'adm-1',
            recordedAt: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  describe('createIntakeOutput', () => {
    it('should create I/O record', async () => {
      const dto = {
        intakeType: 'Oral',
        intakeAmount: 500,
        intakeDetail: '물',
        outputType: 'Urine',
        outputAmount: 450,
      };

      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.intakeOutput.create.mockResolvedValue({
        id: 'io-1',
        admissionId: 'adm-1',
        nurseId: 'nurse-1',
        ...dto,
        nurse: { id: 'nurse-1', familyName: '박', givenName: '간호사' },
      });

      const result = await service.createIntakeOutput('adm-1', dto as any, 'nurse-1');

      expect(result.id).toBe('io-1');
      expect(result.intakeAmount).toBe(500);
    });
  });

  describe('getIntakeOutputs', () => {
    it('should return I/O records', async () => {
      const mockRecords = [
        {
          id: 'io-1',
          intakeAmount: 500,
          outputAmount: 450,
          recordedAt: new Date(),
        },
      ];

      mockPrisma.intakeOutput.findMany.mockResolvedValue(mockRecords);

      const result = await service.getIntakeOutputs('adm-1');

      expect(result).toHaveLength(1);
      expect(result[0].intakeAmount).toBe(500);
    });
  });

  describe('getIntakeOutputSummary', () => {
    it('should calculate I/O summary with hourly breakdown', async () => {
      const mockRecords = [
        { recordedAt: new Date('2026-05-13T08:00:00'), intakeAmount: 500, outputAmount: 0 },
        { recordedAt: new Date('2026-05-13T14:00:00'), intakeAmount: 300, outputAmount: 450 },
      ];

      mockPrisma.intakeOutput.findMany.mockResolvedValue(mockRecords);

      const result = await service.getIntakeOutputSummary('adm-1', '2026-05-13');

      expect(result.totalIntake).toBe(800);
      expect(result.totalOutput).toBe(450);
      expect(result.balance).toBe(350);
      expect(result.byHour).toHaveLength(24);
    });
  });

  describe('getMedicationSchedule', () => {
    it('should return medication schedule for patient', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ patientId: 'pat-1' });
      mockPrisma.medicationAdministration.findMany.mockResolvedValue([
        {
          id: 'ma-1',
          prescriptionId: 'rx-1',
          scheduledAt: new Date('2026-05-13T08:00:00'),
          status: 'SCHEDULED',
          dose: '500mg',
          route: 'PO',
        },
      ]);

      const result = await service.getMedicationSchedule('adm-1');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('SCHEDULED');
    });

    it('should filter by date', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ patientId: 'pat-1' });
      mockPrisma.medicationAdministration.findMany.mockResolvedValue([]);

      await service.getMedicationSchedule('adm-1', '2026-05-13');

      expect(mockPrisma.medicationAdministration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scheduledAt: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  describe('generateSchedule', () => {
    it('should generate medication schedule from prescription', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        type: 'MEDICATION',
        status: 'ACTIVE', // 2026-09-30 비활성 처방엔 예정을 만들지 않는다
        frequency: '1일 3회',
        duration: 3,
        route: 'PO',
        dosage: '500mg',
        encounter: { patientId: 'pat-1' },
      });

      mockPrisma.medicationAdministration.createMany.mockResolvedValue({ count: 9 });
      mockPrisma.medicationAdministration.findMany.mockResolvedValue([
        { id: 'ma-1', scheduledAt: new Date('2026-05-13T08:00:00'), status: 'SCHEDULED' },
      ]);

      const result = await service.generateSchedule('rx-1');

      expect(mockPrisma.medicationAdministration.createMany).toHaveBeenCalled();
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse frequency correctly (1일 3회)', async () => {
      // This is a private method, so we test through generateSchedule behavior
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        type: 'MEDICATION',
        status: 'ACTIVE', // 2026-09-30 비활성 처방엔 예정을 만들지 않는다
        frequency: '1일 3회',
        duration: 1,
        route: 'PO',
        dosage: '500mg',
        encounter: { patientId: 'pat-1' },
      });

      mockPrisma.medicationAdministration.createMany.mockResolvedValue({ count: 3 });
      mockPrisma.medicationAdministration.findMany.mockResolvedValue([]);

      await service.generateSchedule('rx-1');

      // Should create 3 schedules (1 day, 3 times per day)
      expect(mockPrisma.medicationAdministration.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
        }),
      );
    });

    it('should not generate schedule for non-medication prescription', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        type: 'TEST_ORDER',
      });

      const result = await service.generateSchedule('rx-1');

      expect(result).toEqual([]);
      expect(mockPrisma.medicationAdministration.createMany).not.toHaveBeenCalled();
    });
  });

  describe('administerMed', () => {
    it('should administer medication', async () => {
      const data = {
        dose: '500mg',
        route: 'PO',
        verifiedBy: 'pharmacist-1',
        notes: '정상적으로 복용함',
      };

      mockPrisma.medicationAdministration.findUnique
        .mockResolvedValueOnce({ id: 'ma-1', status: 'SCHEDULED' }) // 사전 검증
        .mockResolvedValueOnce({ id: 'ma-1', status: 'ADMINISTERED', administeredAt: new Date(), ...data, nurseId: 'nurse-1' }); // 원자 전이 후 반환
      mockPrisma.medicationAdministration.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.administerMed('ma-1', data, 'nurse-1');

      expect(result.status).toBe('ADMINISTERED');
      expect(mockPrisma.medicationAdministration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ma-1', status: 'SCHEDULED' } }),
      );
    });

    it('should throw error if medication not found', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue(null);

      await expect(
        service.administerMed('ma-1', { dose: '500mg', route: 'PO' }, 'nurse-1'),
      ).rejects.toThrow(MedAdminNotFoundError);
    });

    it('should throw error if not in SCHEDULED status', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({
        id: 'ma-1',
        status: 'HELD',
      });

      await expect(
        service.administerMed('ma-1', { dose: '500mg', route: 'PO' }, 'nurse-1'),
      ).rejects.toThrow(MedAdminNotScheduledError);
    });

    it('should BLOCK high-alert med without independent double-check when gate=BLOCK', async () => {
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn(async (k: string) => (k === 'nursing.highAlertDoubleCheck' ? 'BLOCK' : null)) } as any);
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({
        id: 'ma-1', status: 'SCHEDULED',
        prescription: { medicationCode: { highAlertFlag: true, nameKo: '헤파린' } },
      });
      // verifiedBy 없음 → 차단
      await expect(svc.administerMed('ma-1', { dose: '5000U', route: 'IV' }, 'nurse-1'))
        .rejects.toMatchObject({ response: { code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' } });
      // verifiedBy === nurseId(동일인) → 차단
      await expect(svc.administerMed('ma-1', { dose: '5000U', route: 'IV', verifiedBy: 'nurse-1' }, 'nurse-1'))
        .rejects.toMatchObject({ response: { code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' } });
    });

    it('should allow high-alert med with independent verifier (BLOCK)', async () => {
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn(async (k: string) => (k === 'nursing.highAlertDoubleCheck' ? 'BLOCK' : null)) } as any);
      mockPrisma.medicationAdministration.findUnique
        .mockResolvedValueOnce({ id: 'ma-1', status: 'SCHEDULED', prescription: { status: 'ACTIVE', medicationCode: { highAlertFlag: true, nameKo: '헤파린' } } })
        .mockResolvedValueOnce({ id: 'ma-1', status: 'ADMINISTERED' });
      // 유효한 활성 간호 검증자(nurse-2)
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'nurse-2', isActive: true, accountStage: 'ACTIVE', role: 'NURSE' });
      const res = await svc.administerMed('ma-1', { dose: '5000U', route: 'IV', verifiedBy: 'nurse-2' }, 'nurse-1');
      expect(res.status).toBe('ADMINISTERED');
    });

    it('[P1] BLOCK — verifiedBy가 비활성/타역할이면 차단(자가서명 우회 방지)', async () => {
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn(async (k: string) => (k === 'nursing.highAlertDoubleCheck' ? 'BLOCK' : null)) } as any);
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({
        id: 'ma-1', status: 'SCHEDULED',
        prescription: { status: 'ACTIVE', medicationCode: { highAlertFlag: true, nameKo: '헤파린' } },
      });
      // 존재하나 비활성 계정 → 무효
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'nurse-9', isActive: false, accountStage: 'ACTIVE', role: 'NURSE' });
      await expect(svc.administerMed('ma-1', { dose: '5000U', route: 'IV', verifiedBy: 'nurse-9' }, 'nurse-1'))
        .rejects.toMatchObject({ response: { code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' } });
      // 타 역할(의사) → 무효
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'doc-1', isActive: true, accountStage: 'ACTIVE', role: 'DOCTOR' });
      await expect(svc.administerMed('ma-1', { dose: '5000U', route: 'IV', verifiedBy: 'doc-1' }, 'nurse-1'))
        .rejects.toMatchObject({ response: { code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' } });
    });

    it('[P1] 중단/취소된 처방(비ACTIVE)에는 투약 차단', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({
        id: 'ma-1', status: 'SCHEDULED',
        prescription: { status: 'CANCELLED', medicationCode: { highAlertFlag: false } },
      });
      await expect(service.administerMed('ma-1', { dose: '500mg', route: 'PO' }, 'nurse-1'))
        .rejects.toMatchObject({ response: { code: 'PRESCRIPTION_NOT_ACTIVE' } });
    });

    it('should WARN (default) but still administer high-alert med without verifier', async () => {
      // config 미주입 → 기본 WARN
      mockPrisma.medicationAdministration.findUnique
        .mockResolvedValueOnce({ id: 'ma-1', status: 'SCHEDULED', prescription: { status: 'ACTIVE', medicationCode: { highAlertFlag: true, nameKo: '인슐린' } } })
        .mockResolvedValueOnce({ id: 'ma-1', status: 'ADMINISTERED' });
      const res: any = await service.administerMed('ma-1', { dose: '10U', route: 'SC' }, 'nurse-1');
      expect(res.status).toBe('ADMINISTERED');
      expect(res.warnings?.length).toBeGreaterThan(0);
      // WARN 우회 감사표식 + verifiedBy null 저장
      expect(mockPrisma.medicationAdministration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ verifiedBy: null, notes: expect.stringContaining('IPSG3-DOUBLECHECK-BYPASS') }) }),
      );
    });
  });

  describe('addFlowSheetEntry (EWS 자동 산출)', () => {
    // 🔴 2026-08-19: 종전 이 표본에는 `supplementalO2` 가 없었고, 서비스는 그것을 `false` 로 접어
    //    EWS 를 산출했다 — 산소 투여 중인 환자의 법정기록이 2점 낮게 남는 경로였다.
    //    NEWS2 는 7요소가 전부 관측된 경우에만 산출된다.
    const fullVitals = { respiratoryRate: 22, spo2: 93, systolicBp: 95, heartRate: 115, temperature: 38.5, consciousness: 'ALERT', supplementalO2: false };

    it('should auto-calculate EWS when all NEWS2 vitals present', async () => {
      const mockSafety = { calculateAndSaveEws: vi.fn().mockResolvedValue({ ews: { id: 'ews-1' } }) };
      const svc = new NursingService(mockPrisma, undefined, undefined, mockSafety as any);
      mockPrisma.admission.findUnique.mockResolvedValue({ patientId: 'pat-1' });

      const res = await svc.addFlowSheetEntry('adm-1', 'nurse-1', fullVitals);

      expect(res).toEqual({ id: 'fs-1' });
      expect(mockSafety.calculateAndSaveEws).toHaveBeenCalledWith('pat-1', 'nurse-1', expect.objectContaining({
        respiratoryRate: 22, spO2: 93, systolicBp: 95, heartRate: 115, temperature: 38.5, consciousness: 'ALERT',
      }));
    });

    it('🔴 보충산소가 관측되지 않으면 EWS 를 산출하지 않는다 — false 로 접으면 2점이 사라진다', async () => {
      const mockSafety = { calculateAndSaveEws: vi.fn() };
      const svc = new NursingService(mockPrisma, undefined, undefined, mockSafety as any);
      const { supplementalO2, ...noO2 } = fullVitals; void supplementalO2;

      await svc.addFlowSheetEntry('adm-1', 'nurse-1', noO2);

      expect(mockSafety.calculateAndSaveEws).not.toHaveBeenCalled();
    });

    it('🔴 어휘 밖 의식 값이면 산출하지 않는다(구 AVPU "VERBAL" 은 정본이 접어 산출한다)', async () => {
      const mockSafety = { calculateAndSaveEws: vi.fn().mockResolvedValue({}) };
      const svc = new NursingService(mockPrisma, undefined, undefined, mockSafety as any);
      mockPrisma.admission.findUnique.mockResolvedValue({ patientId: 'pat-1' });

      await svc.addFlowSheetEntry('adm-1', 'nurse-1', { ...fullVitals, consciousness: '기면' });
      expect(mockSafety.calculateAndSaveEws).not.toHaveBeenCalled();

      await svc.addFlowSheetEntry('adm-1', 'nurse-1', { ...fullVitals, consciousness: 'VERBAL' });
      expect(mockSafety.calculateAndSaveEws).toHaveBeenCalledWith('pat-1', 'nurse-1',
        expect.objectContaining({ consciousness: 'VOICE' }));
    });

    it('should NOT calculate EWS when a required vital is missing', async () => {
      const mockSafety = { calculateAndSaveEws: vi.fn() };
      const svc = new NursingService(mockPrisma, undefined, undefined, mockSafety as any);
      const { spo2, ...missing } = fullVitals; void spo2;

      await svc.addFlowSheetEntry('adm-1', 'nurse-1', missing);

      expect(mockSafety.calculateAndSaveEws).not.toHaveBeenCalled();
    });

    it('should not throw if EWS calc fails (non-blocking)', async () => {
      const mockSafety = { calculateAndSaveEws: vi.fn().mockRejectedValue(new Error('boom')) };
      const svc = new NursingService(mockPrisma, undefined, undefined, mockSafety as any);
      mockPrisma.admission.findUnique.mockResolvedValue({ patientId: 'pat-1' });

      const res = await svc.addFlowSheetEntry('adm-1', 'nurse-1', fullVitals);
      expect(res).toEqual({ id: 'fs-1' }); // 바이탈 저장은 성공, EWS 실패는 비차단
    });
  });

  describe('refuseMed', () => {
    it('should mark medication REFUSED with reason', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({ id: 'ma-1', status: 'SCHEDULED' });
      mockPrisma.medicationAdministration.update.mockResolvedValue({ id: 'ma-1', status: 'REFUSED', holdReason: '환자 거부' });
      const res = await service.refuseMed('ma-1', '환자 거부', 'nurse-1');
      expect(res.status).toBe('REFUSED');
      expect(mockPrisma.medicationAdministration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REFUSED', holdReason: '환자 거부' }) }),
      );
    });

    it('should throw if not SCHEDULED', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({ id: 'ma-1', status: 'ADMINISTERED' });
      await expect(service.refuseMed('ma-1', 'x', 'nurse-1')).rejects.toThrow(MedAdminNotScheduledError);
    });
  });

  describe('holdMed', () => {
    it('should hold medication with reason', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({
        id: 'ma-1',
        status: 'SCHEDULED',
      });

      mockPrisma.medicationAdministration.update.mockResolvedValue({
        id: 'ma-1',
        status: 'HELD',
        holdReason: '환자 거절',
        nurseId: 'nurse-1',
      });

      const result = await service.holdMed('ma-1', '환자 거절', 'nurse-1');

      expect(result.status).toBe('HELD');
      expect(result.holdReason).toBe('환자 거절');
    });

    it('should throw error if not in SCHEDULED status', async () => {
      mockPrisma.medicationAdministration.findUnique.mockResolvedValue({
        id: 'ma-1',
        status: 'ADMINISTERED',
      });

      await expect(service.holdMed('ma-1', '사유', 'nurse-1')).rejects.toThrow(
        MedAdminNotScheduledError,
      );
    });
  });

  // 간호기록 AI 보조 P0 — 게이트 + F-4 품질검사
  describe('isAiAssistEnabled (게이트)', () => {
    it('config 미설정 → false(기본 OFF)', async () => {
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(undefined) } as any);
      expect(await svc.isAiAssistEnabled()).toBe(false);
    });
    it('config true/"true" → true', async () => {
      const svc1 = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(true) } as any);
      const svc2 = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue('true') } as any);
      expect(await svc1.isAiAssistEnabled()).toBe(true);
      expect(await svc2.isAiAssistEnabled()).toBe(true);
    });
  });

  describe('evaluateNursingNoteRules (룰기반·순수)', () => {
    it('SOAP O/A 누락 → WARNING 2건', () => {
      const issues = service.evaluateNursingNoteRules({ noteType: 'SOAP', subjective: '호소' });
      expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['MISSING_O', 'MISSING_A']));
      expect(issues.every((i) => i.level === 'WARNING')).toBe(true);
    });
    it('DAR 완전 기재 → 이슈 없음', () => {
      const issues = service.evaluateNursingNoteRules({ noteType: 'DAR', data: 'd', action: 'a', response: 'r' });
      expect(issues).toHaveLength(0);
    });
    it('통증 기록·재평가 미기재 → PAIN_NO_REASSESS(INFO)', () => {
      const issues = service.evaluateNursingNoteRules({ noteType: 'NARRATIVE', content: '통증 NRS 7 호소' });
      expect(issues.find((i) => i.code === 'PAIN_NO_REASSESS')).toBeTruthy();
    });
    it('통증+재평가 기재 → PAIN 이슈 없음', () => {
      const issues = service.evaluateNursingNoteRules({ noteType: 'NARRATIVE', content: '통증 NRS 7, 1시간 후 재평가 예정' });
      expect(issues.find((i) => i.code === 'PAIN_NO_REASSESS')).toBeFalsy();
    });
    it('낙상 위험·예방중재 미기재 → FALL_NO_INTERVENTION', () => {
      const issues = service.evaluateNursingNoteRules({ noteType: 'NARRATIVE', content: 'Morse 55 낙상 고위험' });
      expect(issues.find((i) => i.code === 'FALL_NO_INTERVENTION')).toBeTruthy();
    });
    it('CRITICAL·계획/중재 미기재 → CRITICAL_NO_PLAN(WARNING)', () => {
      const issues = service.evaluateNursingNoteRules({ noteType: 'SOAP', objective: 'o', assessment: 'a', priority: 'CRITICAL' });
      expect(issues.find((i) => i.code === 'CRITICAL_NO_PLAN')).toBeTruthy();
    });
  });

  describe('nursingNoteQa (게이트 + 점수)', () => {
    it('게이트 OFF → {enabled:false}(조기 반환·DB 미조회)', async () => {
      const findUnique = vi.fn();
      const findFirst = vi.fn();
      const svc = new NursingService({ ...mockPrisma, nursingNote: { ...mockPrisma.nursingNote, findUnique, findFirst } } as any, undefined, { get: vi.fn().mockResolvedValue(false) } as any);
      const r = await svc.nursingNoteQa('adm-1', 'nn-1');
      expect(r).toEqual({ enabled: false });
      expect(findUnique).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
    });
    it('게이트 ON → score/grade/issues 반환', async () => {
      mockPrisma.nursingNote = { ...mockPrisma.nursingNote, findFirst: vi.fn().mockResolvedValue({ noteType: 'SOAP', subjective: '호소' }) };
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(true) } as any);
      const r = await svc.nursingNoteQa('adm-1', 'nn-1');
      expect(r.enabled).toBe(true);
      expect(r.score).toBe(70); // O·A 누락 WARNING 2 × -15
      expect(r.grade).toBe('C');
    });
    it('nursingNoteQaContent: 게이트 OFF=disabled / ON=콘텐츠 직접 채점(DB 미조회)', async () => {
      const off = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(false) } as any);
      expect(await off.nursingNoteQaContent({ noteType: 'SOAP' })).toEqual({ enabled: false });
      const on = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(true) } as any);
      const r = await on.nursingNoteQaContent({ noteType: 'SOAP', objective: 'o', assessment: 'a' });
      expect(r).toMatchObject({ enabled: true, grade: 'A', score: 100 });
    });
  });

  // ── F-1 근거기반 초안(P1) ──
  describe('levenshteinCapped / nursingNoteText', () => {
    it('동일=0, 빈문자열=상대길이, kitten↔sitting=3', () => {
      expect(levenshteinCapped('abc', 'abc')).toBe(0);
      expect(levenshteinCapped('', 'abc')).toBe(3);
      expect(levenshteinCapped('kitten', 'sitting')).toBe(3);
    });
    it('nursingNoteText 본문 필드만 합침', () => {
      expect(nursingNoteText({ objective: 'O', plan: 'P' })).toBe('O \n P');
    });
  });

  describe('mapDraftByNoteType', () => {
    it('SOAP → S/O/A/P', () => {
      expect(service.mapDraftByNoteType('SOAP', { objective: 'O', assessment: 'A', plan: 'P' }))
        .toEqual({ subjective: null, objective: 'O', assessment: 'A', plan: 'P' });
    });
    it('DAR → data(객관+판단)/action(계획)', () => {
      expect(service.mapDraftByNoteType('DAR', { objective: 'O', assessment: 'A', plan: 'P' }))
        .toEqual({ focus: null, data: 'O\nA', action: 'P', response: null });
    });
  });

  describe('generateNursingDraft (게이트 + 근거 + FALLBACK)', () => {
    const gatedPrisma = () => ({
      ...mockPrisma,
      admission: { findUnique: vi.fn().mockResolvedValue({ id: 'adm-1', patientId: 'pat-1' }) },
      earlyWarningScore: { findFirst: vi.fn().mockResolvedValue({ id: 'ews-1', recordedAt: new Date('2026-06-29T05:00:00Z'), respiratoryRate: 20, spO2: 95, systolicBp: 150, heartRate: 92, temperature: 37.8, consciousness: 'ALERT', totalScore: 5, riskLevel: 'MEDIUM' }) },
      fallRiskAssessment: { findFirst: vi.fn().mockResolvedValue({ id: 'fr-1', score: 55, riskLevel: 'HIGH', assessedAt: new Date('2026-06-29T04:00:00Z') }) },
      medicationAdministration: { ...mockPrisma.medicationAdministration, findMany: vi.fn().mockResolvedValue([]) },
    });

    it('게이트 OFF → BadRequest(AI_ASSIST_DISABLED)', async () => {
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(false) } as any);
      await expect(svc.generateNursingDraft('adm-1', 'SOAP')).rejects.toThrow();
    });

    it('medicalAi 부재 → FALLBACK(객관 결정적·A는 근거요약·환각 0)', async () => {
      const svc = new NursingService(gatedPrisma() as any, undefined, { get: vi.fn().mockResolvedValue(true) } as any);
      const r = await svc.generateNursingDraft('adm-1', 'SOAP');
      expect(r.source).toBe('FALLBACK');
      expect(r.draft.objective).toContain('NEWS2 5(MEDIUM)');
      expect(r.draft.assessment).toContain('낙상 위험 HIGH');
      expect(r.draft.plan).toBeNull(); // AI 없으면 계획 비움(생성 금지)
      expect(r.citations.map((c) => c.source)).toEqual(expect.arrayContaining(['EarlyWarningScore', 'FallRiskAssessment']));
      expect(r.provenance.aiSourceSnapshot.draftText).toBeTruthy();
    });

    it('medicalAi 있으면 A/P AI 초안·source=AI', async () => {
      const medicalAi = { autoSoap: vi.fn().mockResolvedValue({ assessment: '활력 상승', plan: '4시간 재측정', confidence: 0.7 }) };
      const svc = new NursingService(gatedPrisma() as any, medicalAi as any, { get: vi.fn().mockResolvedValue(true) } as any);
      const r = await svc.generateNursingDraft('adm-1', 'SOAP');
      expect(r.source).toBe('AI');
      expect(r.draft.plan).toBe('4시간 재측정');
      expect(r.confidence).toBe(0.7);
    });
  });

  describe('createNote/signNote — AI 프로비넌스·수정량', () => {
    it('aiProvenance 동봉 시 aiAssisted=true·snapshot 영속화', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.nursingNote = { ...mockPrisma.nursingNote, create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'nn-3', ...data })) };
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn() } as any);
      const dto = { noteType: 'SOAP', shiftType: 'DAY', objective: 'O', assessment: 'A', draft: true, aiProvenance: { aiModel: 'weru-b', aiPromptVersion: 'nursing-soap-v1', aiSourceSnapshot: { draftText: 'O \n A', sig: signDraftText('O \n A') } } };
      await svc.createNote('adm-1', dto as any, 'nurse-1');
      const arg = mockPrisma.nursingNote.create.mock.calls.at(-1)[0];
      expect(arg.data).toMatchObject({ aiAssisted: true, aiModel: 'weru-b', aiPromptVersion: 'nursing-soap-v1' });
    });

    it('signNote: AI 보조 노트 서명 시 aiEditDistance 계산', async () => {
      const note = { id: 'nn-4', status: 'DRAFT', nurseId: 'nurse-1', aiAssisted: true, aiEditDistance: null, aiSourceSnapshot: { draftText: 'O \n A' }, objective: 'O', assessment: 'A2' };
      mockPrisma.nursingNote = { ...mockPrisma.nursingNote, findFirst: vi.fn().mockResolvedValue(note), update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...note, ...data })) };
      const svc = new NursingService(mockPrisma, undefined, { get: vi.fn() } as any);
      await svc.signNote('adm-1', 'nn-4', 'nurse-1');
      const arg = mockPrisma.nursingNote.update.mock.calls.at(-1)[0];
      expect(arg.data.status).toBe('SIGNED');
      expect(typeof arg.data.aiEditDistance).toBe('number');
    });
  });

  // ── F-2 간호과정 제안(P2·규칙기반) ──
  describe('matchCarePlanNeeds (순수·결정적)', () => {
    it('통증 NRS 7 → pain need(고신뢰)', () => {
      const needs = matchCarePlanNeeds(buildCarePlanContext({ painScore: 7 } as any, null, null));
      const pain = needs.find((n) => n.key === 'pain');
      expect(pain).toBeTruthy();
      expect(pain!.confidence).toBeGreaterThanOrEqual(0.9);
      expect(pain!.nandaKw).toContain('통증');
    });
    it('낙상 HIGH + Braden 12 → fall·skin need', () => {
      const needs = matchCarePlanNeeds(buildCarePlanContext({ bradenScore: 12 } as any, null, { riskLevel: 'HIGH' }));
      expect(needs.map((n) => n.key)).toEqual(expect.arrayContaining(['fall', 'skin']));
    });
    it('정상 데이터 → need 없음', () => {
      const needs = matchCarePlanNeeds(buildCarePlanContext({ painScore: 0, mobility: '독립', skinIntegrity: 'Intact', bradenScore: 20, nutritionStatus: 'Adequate', consciousness: 'ALERT' } as any, { riskLevel: 'LOW', spO2: 98, temperature: 36.5 }, { riskLevel: 'LOW' }));
      expect(needs).toHaveLength(0);
    });
    it('EWS HIGH/저SpO2 → 가스교환 need', () => {
      const needs = matchCarePlanNeeds(buildCarePlanContext(null, { riskLevel: 'HIGH', spO2: 89 }, null));
      expect(needs.find((n) => n.key === 'gas')).toBeTruthy();
    });
  });

  describe('suggestCarePlan (게이트 + 마스터 매칭)', () => {
    const gated = (enabled: boolean) => {
      const p = {
        ...mockPrisma,
        admission: { findUnique: vi.fn().mockResolvedValue({ id: 'adm-1', patientId: 'pat-1' }) },
        nursingAssessment: { ...mockPrisma.nursingAssessment, findFirst: vi.fn().mockResolvedValue({ painScore: 7 }) },
        earlyWarningScore: { findFirst: vi.fn().mockResolvedValue(null) },
        fallRiskAssessment: { findFirst: vi.fn().mockResolvedValue(null) },
        nursingCode: { findMany: vi.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.codeSystem === 'NANDA_I'
            ? [{ code: '00132', nameKo: '급성 통증', domain: '안위' }]
            : where.codeSystem === 'NIC'
              ? [{ code: '1400', nameKo: '통증 관리', domain: '통증' }]
              : [{ code: '2102', nameKo: '통증 수준', domain: '안위' }])) },
      };
      return new NursingService(p as any, undefined, { get: vi.fn().mockResolvedValue(enabled) } as any);
    };

    it('게이트 OFF → BadRequest', async () => {
      await expect(gated(false).suggestCarePlan('adm-1')).rejects.toThrow();
    });
    it('게이트 ON → 통증 평가 → NANDA(급성 통증)+NIC(통증 관리) 매칭(코드는 마스터에서만)', async () => {
      const r = await gated(true).suggestCarePlan('adm-1');
      expect(r.enabled).toBe(true);
      expect(r.source).toBe('RULE');
      expect(r.diagnoses[0]).toMatchObject({ nandaCode: '00132', nandaName: '급성 통증' });
      expect(r.diagnoses[0].interventions[0]).toMatchObject({ nicCode: '1400' });
      expect(r.diagnoses[0].outcomes[0]).toMatchObject({ nocCode: '2102', name: '통증 수준' }); // NOC 시드 후 매칭
      expect(r.diagnoses[0].confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  /**
   * 🔴 W8-R3(2026-08-14) — 간호결과(NOC) 정합.
   * 종전 주석은 "NOC 미시드 → outcomes 비움"이라고 적혀 있었으나 운영 DB 실측은 NOC 12건이었다
   * (nursing_codes GROUP BY code_system: NANDA_I 58 · NIC 50 · NOC 12 · ICF 13 · MedDRA 34).
   * 코드는 이미 NOC 를 매칭하고 있었고 틀린 것은 주석뿐 — 그 전제가 화면 설명까지 오도했다.
   * 아래는 **운영 마스터 실측 12행**을 그대로 넣고 needs 규칙표(nocKw)와의 연결을 고정한다.
   * 연결 근거는 임의 매핑이 아니라 NANDA·NIC 과 동일한 마스터 키워드 대조 하나다.
   */
  describe('간호결과(NOC) 매칭 — 운영 마스터 실측 12행 고정', () => {
    const NOC_MASTER = [
      { code: '0200', nameKo: '보행', domain: '기능' },
      { code: '0208', nameKo: '기동성', domain: '기능' },
      { code: '0402', nameKo: '호흡상태: 가스교환', domain: '생리' },
      { code: '0415', nameKo: '호흡상태: 환기', domain: '생리' },
      { code: '0800', nameKo: '체온조절', domain: '생리' },
      { code: '0912', nameKo: '신경학적 상태: 의식', domain: '생리' },
      { code: '1004', nameKo: '영양상태', domain: '생리' },
      { code: '1101', nameKo: '조직 통합성: 피부 및 점막', domain: '생리' },
      { code: '1605', nameKo: '통증 자가통제', domain: '안위' },
      { code: '1909', nameKo: '낙상 발생', domain: '안전' },
      { code: '1912', nameKo: '낙상예방 행위', domain: '안전' },
      { code: '2102', nameKo: '통증 수준', domain: '안위' },
    ];
    const nocFor = (nocKw: string) =>
      NOC_MASTER.filter((c) => new RegExp(nocKw).test(c.nameKo) || new RegExp(nocKw).test(c.domain)).map((c) => c.code);

    // need key → 실측 마스터에서 실제로 걸리는 NOC 코드(위원회가 아니라 마스터가 정한다)
    it.each([
      ['pain', '통증', ['1605', '2102']],
      ['fall', '낙상', ['1909', '1912']],
      ['skin', '피부|조직', ['1101']],
      ['mobility', '기동|보행', ['0200', '0208']],
      ['nutrition', '영양', ['1004']],
      ['gas', '호흡|가스교환', ['0402', '0415']],
      ['temp', '체온', ['0800']],
      ['consciousness', '의식|신경', ['0912']],
    ])('need=%s(nocKw=%s) 는 마스터의 실재 코드에 걸린다 — 비어 있지 않다', (_key, kw, expected) => {
      expect(nocFor(kw)).toEqual(expected);
    });

    it('규칙표의 모든 need 가 NOC 앵커를 가진다(하나라도 0이면 화면이 "결과 없음"으로 보인다)', () => {
      const allNeeds = matchCarePlanNeeds({
        painScore: 8, mobility: '침상안정', skinIntegrity: '발적', bradenScore: 11,
        nutritionStatus: '불량', consciousness: '혼동', fallRisk: 'HIGH', ewsRisk: 'HIGH',
        temperature: 38.5, spO2: 88,
      } as any);
      expect(allNeeds.length).toBeGreaterThanOrEqual(8);
      for (const n of allNeeds) expect(nocFor(n.nocKw).length).toBeGreaterThan(0);
    });

    it('마스터에 대응 NOC 가 없으면 지어내지 않고 빈 목록으로 둔다(임상 매핑 날조 금지)', async () => {
      const p = {
        ...mockPrisma,
        admission: { findUnique: vi.fn().mockResolvedValue({ id: 'adm-1', patientId: 'pat-1' }) },
        nursingAssessment: { ...mockPrisma.nursingAssessment, findFirst: vi.fn().mockResolvedValue({ painScore: 7 }) },
        earlyWarningScore: { findFirst: vi.fn().mockResolvedValue(null) },
        fallRiskAssessment: { findFirst: vi.fn().mockResolvedValue(null) },
        nursingCode: { findMany: vi.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.codeSystem === 'NANDA_I'
            ? [{ code: '00132', nameKo: '급성 통증', domain: '안위' }]
            : where.codeSystem === 'NIC'
              ? [{ code: '1400', nameKo: '통증 관리', domain: '통증' }]
              : [{ code: '0800', nameKo: '체온조절', domain: '생리' }])) }, // 통증과 무관한 NOC 만 존재
      };
      const r = await new NursingService(p as any, undefined, { get: vi.fn().mockResolvedValue(true) } as any).suggestCarePlan('adm-1');
      expect(r.diagnoses[0].nandaCode).toBe('00132');
      expect(r.diagnoses[0].outcomes).toEqual([]); // 억지로 '체온조절'을 붙이지 않는다
    });
  });

  // ── 리뷰 보완 수정(회귀 방지) ──
  describe('review fixes', () => {
    it('#1 getCarePlan: assessments 배열(진단 포함) 반환', async () => {
      const p = { ...mockPrisma, nursingAssessment: { ...mockPrisma.nursingAssessment, findMany: vi.fn().mockResolvedValue([{ id: 'as-1', assessedAt: new Date(), diagnoses: [{ id: 'dx-1', status: 'ACTIVE', interventions: [], outcomes: [] }] }]) } };
      const svc = new NursingService(p as any);
      const r = await svc.getCarePlan('adm-1');
      expect(Array.isArray(r.assessments)).toBe(true);
      expect(r.assessments[0]).toMatchObject({ id: 'as-1' });
      expect(r.assessments[0].diagnoses).toHaveLength(1);
    });

    it('#8 amendNote: SIGNED 아닌 기록 정정 거부', async () => {
      mockPrisma.nursingNote = { ...mockPrisma.nursingNote, findUnique: vi.fn().mockResolvedValue({ id: 'nn-1', status: 'DRAFT' }) };
      const svc = new NursingService(mockPrisma);
      await expect(svc.amendNote('adm-1', 'nn-1', { noteType: 'SOAP', shiftType: 'DAY' } as any, 'nurse-1')).rejects.toThrow();
    });

    it('#3 createNote: 즉시 서명(draft 미지정)+aiProvenance → aiEditDistance 계산', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.nursingNote = { ...mockPrisma.nursingNote, create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'nn-x', ...data })) };
      const svc = new NursingService(mockPrisma);
      await svc.createNote('adm-1', { noteType: 'SOAP', shiftType: 'DAY', objective: 'O', assessment: 'A2', aiProvenance: { aiModel: 'm', aiSourceSnapshot: { draftText: 'O \n A', sig: signDraftText('O \n A') } } } as any, 'nurse-1');
      const arg = mockPrisma.nursingNote.create.mock.calls.at(-1)[0];
      expect(arg.data.aiAssisted).toBe(true);
      expect(typeof arg.data.aiEditDistance).toBe('number'); // A→A2 수정 반영
    });

    it('#6 mapDraftByNoteType SBAR → data/action/response 매핑', () => {
      const svc = new NursingService(mockPrisma);
      expect(svc.mapDraftByNoteType('SBAR', { objective: 'B', assessment: 'A', plan: 'R' }))
        .toEqual({ focus: null, data: 'B', action: 'A', response: 'R' });
    });

    it('#5 무결성: 변조된 aiProvenance(서명 불일치) → 거부', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      const svc = new NursingService(mockPrisma);
      await expect(svc.createNote('adm-1', { noteType: 'SOAP', shiftType: 'DAY', objective: 'X', aiProvenance: { aiSourceSnapshot: { draftText: '위조본', sig: 'bad' } } } as any, 'nurse-1')).rejects.toThrow();
    });

    it('병동 게이트: wards 미설정=전역 / 설정 시 해당 병동만', async () => {
      const off = new NursingService(mockPrisma, undefined, { get: vi.fn().mockResolvedValue(false) } as any);
      expect(await off.isAiAssistEnabledForAdmission('adm-1')).toBe(false); // 전역 OFF
      const global = new NursingService(mockPrisma, undefined, { get: vi.fn().mockImplementation((k: string) => k === 'nursing.aiAssist.enabled' ? true : undefined) } as any);
      expect(await global.isAiAssistEnabledForAdmission('adm-1')).toBe(true); // wards 미설정=전역
      const p = { ...mockPrisma, admission: { findUnique: vi.fn().mockResolvedValue({ bed: { ward: { name: '3층 내과병동' } } }) } };
      const scoped = new NursingService(p as any, undefined, { get: vi.fn().mockImplementation((k: string) => k === 'nursing.aiAssist.enabled' ? true : ['3층 내과병동']) } as any);
      expect(await scoped.isAiAssistEnabledForAdmission('adm-1')).toBe(true); // 병동 일치
      const p2 = { ...mockPrisma, admission: { findUnique: vi.fn().mockResolvedValue({ bed: { ward: { name: '5층 외과병동' } } }) } };
      const scoped2 = new NursingService(p2 as any, undefined, { get: vi.fn().mockImplementation((k: string) => k === 'nursing.aiAssist.enabled' ? true : ['3층 내과병동']) } as any);
      expect(await scoped2.isAiAssistEnabledForAdmission('adm-1')).toBe(false); // 병동 불일치
    });
  });

  // ── 타블렛 환자식별 QR 해석(P0) ──
  describe('resolvePatientByCode', () => {
    it('MRN → 활성 입원·환자·병상 반환', async () => {
      const p = {
        ...mockPrisma,
        patient: { findFirst: vi.fn().mockResolvedValue({ id: 'pat-1', mrn: 'P2026-1', familyName: '김', givenName: '환자' }) },
        admission: { findFirst: vi.fn().mockResolvedValue({ id: 'adm-1', bed: { roomNumber: '501', bedNumber: 'A', ward: { name: '3층 내과병동' } } }) },
      };
      const svc = new NursingService(p as any);
      const r = await svc.resolvePatientByCode('P2026-1');
      expect(r).toMatchObject({ admissionId: 'adm-1', name: '김환자', mrn: 'P2026-1', ward: '3층 내과병동', bed: '501-A' });
      expect(p.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { mrn: 'P2026-1' } }));
    });
    it('빈 코드 → BadRequest', async () => {
      await expect(new NursingService(mockPrisma).resolvePatientByCode('  ')).rejects.toThrow();
    });
    it('미존재 → NotFound', async () => {
      const p = { ...mockPrisma, patient: { findFirst: vi.fn().mockResolvedValue(null) } };
      await expect(new NursingService(p as any).resolvePatientByCode('UNKNOWN')).rejects.toThrow();
    });
    it('uuid 코드 → id 또는 mrn 으로 조회', async () => {
      const p = { ...mockPrisma, patient: { findFirst: vi.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', mrn: 'M', familyName: '이', givenName: '미숙' }) }, admission: { findFirst: vi.fn().mockResolvedValue(null) } };
      const r = await new NursingService(p as any).resolvePatientByCode('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      expect(p.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ id: expect.any(String) }, { mrn: expect.any(String) }] } }));
      expect(r.admissionId).toBeNull(); // 입원 없으면 null(외래)
    });
  });

  // ── F-3 교대 인수인계 SBAR(P3) ──
  describe('generateHandoffSbar (게이트 + 결정적 SBAR)', () => {
    const svc = (enabled: boolean) => {
      // 서비스는 재원일수를 Math.ceil((now - admitDate)/day)로 산출한다.
      // 정확히 3일 전으로 잡으면 now 재조회 시점의 수 ms 지연이 ceil을 4로 밀어 부하 상황에서 flaky.
      // 71시간(3일-1시간) 전으로 두면 지연과 무관하게 항상 ceil → 3일로 결정적.
      const admitDate = new Date(Date.now() - (3 * 86400000 - 3600000));
      const p = {
        ...mockPrisma,
        admission: { findUnique: vi.fn().mockResolvedValue({ id: 'adm-1', patientId: 'pat-1', admitDate, admitReason: '폐렴', patient: { familyName: '김', givenName: '환자', dateOfBirth: new Date('1960-01-01'), gender: 'MALE' }, bed: { roomNumber: '501', bedNumber: 'A', ward: { name: '내과병동' } } }) },
        earlyWarningScore: { findFirst: vi.fn().mockResolvedValue({ recordedAt: new Date('2026-06-29T05:00:00Z'), systolicBp: 150, heartRate: 92, spO2: 95, temperature: 37.8, consciousness: 'ALERT', totalScore: 5, riskLevel: 'MEDIUM' }) },
        fallRiskAssessment: { findFirst: vi.fn().mockResolvedValue({ score: 55, riskLevel: 'HIGH' }) },
        nursingAssessment: { ...mockPrisma.nursingAssessment, findMany: vi.fn().mockResolvedValue([{ diagnoses: [{ nandaName: '급성 통증' }] }]) },
        nursingNote: { ...mockPrisma.nursingNote, count: vi.fn().mockResolvedValue(2) },
        medicationAdministration: { ...mockPrisma.medicationAdministration, findMany: vi.fn().mockResolvedValue([{ prescription: { medicationCode: { nameKo: '세프트리악손' } } }]), count: vi.fn().mockResolvedValue(13) },
      };
      return new NursingService(p as any, undefined, { get: vi.fn().mockResolvedValue(enabled) } as any);
    };

    it('게이트 OFF → BadRequest', async () => {
      await expect(svc(false).generateHandoffSbar('adm-1')).rejects.toThrow();
    });
    it('게이트 ON → SBAR 4섹션 + 인계 항목(결정적·근거기반)', async () => {
      const r = await svc(true).generateHandoffSbar('adm-1');
      expect(r.enabled).toBe(true);
      expect(r.source).toBe('DATA');
      expect(r.sbar.situation).toContain('내과병동');
      expect(r.sbar.situation).toContain('재원 3일');
      expect(r.sbar.background).toContain('급성 통증');
      expect(r.sbar.assessment).toContain('NEWS2 5(MEDIUM)');
      expect(r.sbar.recommendation).toContain('미서명 간호기록 2건');
      expect(r.sbar.recommendation).toContain('세프트리악손');
      // 🔴 (2026-10-07) 이름은 10건까지(받은 1건) · 건수는 전체(13) — 잘린 수를 전체로 말하지 않는다 · 본 범위를 밝힌다
      expect(r.sbar.recommendation).toContain('투약 지연 13건');
      expect(r.sbar.recommendation).toContain('외 12건');
      expect(r.sbar.recommendation).toContain('위급값·격리·금식·수술 일정은 간호 스테이션 보드에서 확인');
      expect(r.sbar.recommendation).not.toContain('특이 인계사항 없음');
      expect(r.items).toMatchObject({ unsignedNotes: 2, overdueMeds: 13, activeDiagnoses: 1 });
    });
  });
});

describe('BCMA bedside 스캔 게이트 (R2-3 1단계)', () => {
  let service: any;
  let mockPrisma: any;
  const marBase = {
    id: 'mar-1', status: 'SCHEDULED', patientId: 'p-1',
    patient: { mrn: 'P2026-0001' },
    prescription: { status: 'ACTIVE', medicationCode: { highAlertFlag: false, nameKo: '아모크라정', barcode: '8806421001234', code: '642100120' } },
  };

  const build = (cfgValue: string | null) => {
    mockPrisma = {
      medicationAdministration: {
        findUnique: vi.fn().mockResolvedValue(marBase),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    return new NursingService(
      mockPrisma as any, undefined,
      { get: vi.fn(async (k: string) => (k === 'nursing.bcma.enforce' ? cfgValue : null)) } as any,
    );
  };

  it('환자 밴드 불일치 → 항상 BLOCK (BCMA_PATIENT_MISMATCH)', async () => {
    service = build(null);
    await expect(service.administerMed('mar-1', { dose: '1T', route: 'PO', patientBandScan: 'P2026-9999', medScan: '8806421001234' }, 'n-1'))
      .rejects.toMatchObject({ response: { code: 'BCMA_PATIENT_MISMATCH' } });
  });

  it('약품 불일치 → 항상 BLOCK (BCMA_MED_MISMATCH)', async () => {
    service = build(null);
    await expect(service.administerMed('mar-1', { dose: '1T', route: 'PO', patientBandScan: 'p2026-0001', medScan: 'WRONG' }, 'n-1'))
      .rejects.toMatchObject({ response: { code: 'BCMA_MED_MISMATCH' } });
  });

  it('EDI 코드 스캔도 약품 일치로 인정(바코드 미등록 약품 폴백)', async () => {
    service = build(null);
    const r = await service.administerMed('mar-1', { dose: '1T', route: 'PO', patientBandScan: 'P2026-0001', medScan: '642100120' }, 'n-1');
    expect(mockPrisma.medicationAdministration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ADMINISTERED', patientBandScan: 'P2026-0001', medScan: '642100120', bcmaScanAt: expect.any(Date) }),
    }));
    expect(r.warnings).toBeUndefined();
  });

  it('enforce BLOCK: 미스캔 투약 차단 (BCMA_SCAN_REQUIRED)', async () => {
    service = build('BLOCK');
    await expect(service.administerMed('mar-1', { dose: '1T', route: 'PO' }, 'n-1'))
      .rejects.toMatchObject({ response: { code: 'BCMA_SCAN_REQUIRED' } });
  });

  it('enforce WARN: 미스캔 허용 + 경고·BCMA-BYPASS 마커, verifiedBy는 불변', async () => {
    service = build('WARN');
    const r = await service.administerMed('mar-1', { dose: '1T', route: 'PO', verifiedBy: 'n-2' }, 'n-1');
    expect(r.warnings?.[0]).toContain('BCMA');
    const call = mockPrisma.medicationAdministration.updateMany.mock.calls[0][0];
    expect(call.data.notes).toContain('[BCMA-BYPASS');
    expect(call.data.verifiedBy).toBe('n-2'); // 고위험 아님 — IPSG3 bypass와 독립
  });

  it('기본 OFF: 미스캔 투약 그대로 허용(하위호환)', async () => {
    service = build(null);
    const r = await service.administerMed('mar-1', { dose: '1T', route: 'PO' }, 'n-1');
    expect(r.warnings).toBeUndefined();
    expect(mockPrisma.medicationAdministration.updateMany).toHaveBeenCalled();
  });
});
