import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AllergyService } from '../../src/modules/allergy/allergy.service';
import { AllergyNotFoundError } from '../../src/domain/errors/domain-error';

describe('AllergyService', () => {
  let service: AllergyService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      allergy: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null), // lastAllergyChange(stale 판정)
        update: vi.fn(),
        count: vi.fn(),
      },
      allergyAssessment: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      medicationCode: {
        findUnique: vi.fn(),
      },
    };
    // assess()는 $transaction 내에서 count+create — 콜백에 동일 mock 전달
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));

    service = new AllergyService(mockPrisma);
  });

  describe('create', () => {
    it('should create allergy for patient', async () => {
      const dto = {
        type: 'DRUG',
        allergen: '페니실린',
        allergenCode: 'PCN',
        reaction: '발진',
        severity: 'HIGH',
        onsetDate: '2025-01-15',
        reportedBy: 'patient',
        notes: 'Known allergy',
      };

      mockPrisma.allergy.create.mockResolvedValue({
        id: 'allergy-1',
        patientId: 'patient-1',
        ...dto,
        onsetDate: new Date(dto.onsetDate),
        recordedBy: 'user-1',
        isActive: true,
        createdAt: new Date(),
        recorder: { id: 'user-1', familyName: '이', givenName: '의사' },
      });

      const result = await service.create('patient-1', dto, 'user-1');

      expect(result.id).toBe('allergy-1');
      expect(result.type).toBe('DRUG');
      expect(result.allergen).toBe('페니실린');
      expect(result.severity).toBe('HIGH');
      expect(mockPrisma.allergy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            type: 'DRUG',
            allergen: '페니실린',
            recordedBy: 'user-1',
          }),
        })
      );
    });

    it('should create food allergy', async () => {
      const dto = {
        type: 'FOOD',
        allergen: '땅콩',
        reaction: '호흡곤란, 부종',
        severity: 'CRITICAL',
        onsetDate: '2020-06-10',
        reportedBy: 'family',
        notes: 'Anaphylaxis risk',
      };

      mockPrisma.allergy.create.mockResolvedValue({
        id: 'allergy-2',
        patientId: 'patient-1',
        ...dto,
        onsetDate: new Date(dto.onsetDate),
        recordedBy: 'user-1',
        isActive: true,
      });

      const result = await service.create('patient-1', dto, 'user-1');

      expect(result.type).toBe('FOOD');
      expect(result.allergen).toBe('땅콩');
      expect(result.severity).toBe('CRITICAL');
    });

    it('should create allergy without onset date', async () => {
      const dto = {
        type: 'ENVIRONMENTAL',
        allergen: '꽃가루',
        reaction: '알레르기성 비염',
        severity: 'MILD',
        reportedBy: 'patient',
      };

      mockPrisma.allergy.create.mockResolvedValue({
        id: 'allergy-3',
        patientId: 'patient-1',
        ...dto,
        onsetDate: null,
        recordedBy: 'user-1',
        isActive: true,
      });

      const result = await service.create('patient-1', dto, 'user-1');

      expect(result.allergen).toBe('꽃가루');
      expect(result.onsetDate).toBeNull();
    });

    it('should include recorder information', async () => {
      const dto = {
        type: 'DRUG',
        allergen: '아스피린',
        reaction: '소화 장애',
        severity: 'LOW',
        reportedBy: 'patient',
      };

      mockPrisma.allergy.create.mockResolvedValue({
        id: 'allergy-4',
        patientId: 'patient-1',
        ...dto,
        recordedBy: 'user-1',
        isActive: true,
        recorder: { id: 'user-1', familyName: '김', givenName: '간호사' },
      });

      const result = await service.create('patient-1', dto, 'user-1');

      expect(result.recorder).toBeDefined();
      expect(result.recorder.familyName).toBe('김');
    });
  });

  describe('findByPatient', () => {
    it('should return all allergies for patient', async () => {
      const mockAllergies = [
        {
          id: 'allergy-1',
          patientId: 'patient-1',
          type: 'DRUG',
          allergen: '페니실린',
          severity: 'HIGH',
          isActive: true,
          recorder: { id: 'user-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'allergy-2',
          patientId: 'patient-1',
          type: 'FOOD',
          allergen: '땅콩',
          severity: 'CRITICAL',
          isActive: true,
          recorder: { id: 'user-1', familyName: '이', givenName: '의사' },
        },
      ];

      mockPrisma.allergy.findMany.mockResolvedValue(mockAllergies);

      const result = await service.findByPatient('patient-1');

      expect(result).toHaveLength(2);
      expect(result[0].allergen).toBe('페니실린');
      expect(mockPrisma.allergy.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: expect.any(Array),
        include: expect.any(Object),
      });
    });

    it('should filter by isActive true', async () => {
      const mockAllergies = [
        {
          id: 'allergy-1',
          patientId: 'patient-1',
          type: 'DRUG',
          allergen: '페니실린',
          isActive: true,
        },
      ];

      mockPrisma.allergy.findMany.mockResolvedValue(mockAllergies);

      const result = await service.findByPatient('patient-1', true);

      expect(result).toHaveLength(1);
      expect(result[0].isActive).toBe(true);
      expect(mockPrisma.allergy.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1', isActive: true },
        orderBy: expect.any(Array),
        include: expect.any(Object),
      });
    });

    it('should filter by isActive false', async () => {
      const mockAllergies = [
        {
          id: 'allergy-2',
          patientId: 'patient-1',
          type: 'FOOD',
          allergen: '딸기',
          isActive: false,
        },
      ];

      mockPrisma.allergy.findMany.mockResolvedValue(mockAllergies);

      const result = await service.findByPatient('patient-1', false);

      expect(result[0].isActive).toBe(false);
      expect(mockPrisma.allergy.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1', isActive: false },
        orderBy: expect.any(Array),
        include: expect.any(Object),
      });
    });

    it('should return empty array when no allergies', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([]);

      const result = await service.findByPatient('patient-999');

      expect(result).toEqual([]);
    });

    it('should order by isActive desc, severity desc, createdAt desc', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([]);

      await service.findByPatient('patient-1');

      expect(mockPrisma.allergy.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: [{ isActive: 'desc' }, { severity: 'desc' }, { createdAt: 'desc' }],
        include: expect.any(Object),
      });
    });
  });

  describe('findById', () => {
    it('should return allergy by id', async () => {
      const mockAllergy = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        severity: 'HIGH',
        isActive: true,
        recorder: { id: 'user-1', familyName: '이', givenName: '의사' },
      };

      mockPrisma.allergy.findFirst.mockResolvedValue(mockAllergy);

      const result = await service.findById('patient-1', 'allergy-1');

      expect(result.id).toBe('allergy-1');
      expect(result.allergen).toBe('페니실린');
      expect(mockPrisma.allergy.findFirst).toHaveBeenCalledWith({
        where: { id: 'allergy-1', patientId: 'patient-1' },
        include: expect.any(Object),
      });
    });

    it('should throw AllergyNotFoundError when not found', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue(null);

      await expect(service.findById('patient-1', 'invalid-id')).rejects.toThrow(AllergyNotFoundError);
    });

    it('should include recorder details', async () => {
      const mockAllergy = {
        id: 'allergy-2',
        patientId: 'patient-1',
        type: 'FOOD',
        allergen: '땅콩',
        recorder: { id: 'user-1', familyName: '김', givenName: '간호사' },
      };

      mockPrisma.allergy.findFirst.mockResolvedValue(mockAllergy);

      const result = await service.findById('patient-1', 'allergy-2');

      expect(result.recorder).toBeDefined();
      expect(result.recorder.familyName).toBe('김');
    });
  });

  describe('update', () => {
    it('should update allergy', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
      });

      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        severity: 'CRITICAL',
        notes: 'Updated notes',
        isActive: true,
      });

      const result = await service.update('patient-1', 'allergy-1', {
        severity: 'CRITICAL',
        notes: 'Updated notes',
      });

      expect(result.severity).toBe('CRITICAL');
      expect(result.notes).toBe('Updated notes');
      expect(mockPrisma.allergy.update).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        data: expect.objectContaining({
          severity: 'CRITICAL',
          notes: 'Updated notes',
        }),
        include: expect.any(Object),
      });
    });

    it('should update allergen', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        allergen: '암피실린',
      });

      const result = await service.update('patient-1', 'allergy-1', { allergen: '암피실린' });

      expect(result.allergen).toBe('암피실린');
    });

    it('should update isActive status', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        isActive: false,
      });

      const result = await service.update('patient-1', 'allergy-1', { isActive: false });

      expect(result.isActive).toBe(false);
    });

    it('should throw AllergyNotFoundError if not found', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue(null);

      await expect(service.update('patient-1', 'invalid-id', { severity: 'HIGH' })).rejects.toThrow(
        AllergyNotFoundError
      );
    });

    it('should update onsetDate', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        onsetDate: new Date('2024-01-01'),
      });

      const result = await service.update('patient-1', 'allergy-1', { onsetDate: '2024-01-01' });

      expect(result.onsetDate).toBeDefined();
    });
  });

  describe('verify', () => {
    it('should verify allergy as CONFIRMED', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        verificationStatus: 'CONFIRMED',
        isActive: true,
      });

      const result = await service.verify('patient-1', 'allergy-1', {
        verificationStatus: 'CONFIRMED',
        notes: 'Confirmed by patient',
      });

      expect(result.verificationStatus).toBe('CONFIRMED');
      expect(result.isActive).toBe(true);
    });

    it('should deactivate when REFUTED', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        verificationStatus: 'REFUTED',
        isActive: false,
      });

      const result = await service.verify('patient-1', 'allergy-1', {
        verificationStatus: 'REFUTED',
        notes: 'Denied by patient',
      });

      expect(result.verificationStatus).toBe('REFUTED');
      expect(result.isActive).toBe(false);
      expect(mockPrisma.allergy.update).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        data: expect.objectContaining({
          verificationStatus: 'REFUTED',
          isActive: false,
        }),
        include: expect.any(Object),
      });
    });

    it('should deactivate when ENTERED_IN_ERROR', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        verificationStatus: 'ENTERED_IN_ERROR',
        isActive: false,
      });

      const result = await service.verify('patient-1', 'allergy-1', {
        verificationStatus: 'ENTERED_IN_ERROR',
        notes: 'Data entry error',
      });

      expect(result.verificationStatus).toBe('ENTERED_IN_ERROR');
      expect(result.isActive).toBe(false);
    });

    it('should update notes without changing status', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue({ id: 'allergy-1' });
      mockPrisma.allergy.update.mockResolvedValue({
        id: 'allergy-1',
        verificationStatus: 'CONFIRMED',
        notes: 'Additional notes',
        isActive: true,
      });

      const result = await service.verify('patient-1', 'allergy-1', {
        verificationStatus: 'CONFIRMED',
        notes: 'Additional notes',
      });

      expect(result.notes).toBe('Additional notes');
    });

    it('should throw AllergyNotFoundError if not found', async () => {
      mockPrisma.allergy.findFirst.mockResolvedValue(null);

      await expect(
        service.verify('patient-1', 'invalid-id', { verificationStatus: 'CONFIRMED' })
      ).rejects.toThrow(AllergyNotFoundError);
    });
  });

  describe('assess (NKA 문진)', () => {
    it('should record NO_KNOWN_ALLERGIES when no active allergies', async () => {
      mockPrisma.allergy.count.mockResolvedValue(0);
      mockPrisma.allergyAssessment.create.mockResolvedValue({
        id: 'asmt-1', patientId: 'patient-1', result: 'NO_KNOWN_ALLERGIES', assessedBy: 'user-1',
      });
      const result = await service.assess('patient-1', { result: 'NO_KNOWN_ALLERGIES' } as any, 'user-1');
      expect(result.result).toBe('NO_KNOWN_ALLERGIES');
      expect(mockPrisma.allergyAssessment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ patientId: 'patient-1', result: 'NO_KNOWN_ALLERGIES', assessedBy: 'user-1' }) }),
      );
    });

    it('[safety] should REJECT NKA when active allergies exist (모순 차단)', async () => {
      mockPrisma.allergy.count.mockResolvedValue(2);
      await expect(service.assess('patient-1', { result: 'NO_KNOWN_ALLERGIES' } as any, 'user-1')).rejects.toThrow();
      expect(mockPrisma.allergyAssessment.create).not.toHaveBeenCalled();
    });

    it('should allow UNABLE_TO_ASSESS without checking allergies', async () => {
      mockPrisma.allergyAssessment.create.mockResolvedValue({ id: 'asmt-2', result: 'UNABLE_TO_ASSESS' });
      const result = await service.assess('patient-1', { result: 'UNABLE_TO_ASSESS', note: '의식저하' } as any, 'user-1');
      expect(result.result).toBe('UNABLE_TO_ASSESS');
      expect(mockPrisma.allergy.count).not.toHaveBeenCalled();
    });
  });

  describe('getStatus (3-상태 도출)', () => {
    it('should return HAS_ALLERGIES when active allergies exist (문진 무관)', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([{ id: 'a-1', allergen: '페니실린', isActive: true }]);
      mockPrisma.allergyAssessment.findFirst.mockResolvedValue(null);
      const result = await service.getStatus('patient-1');
      expect(result.status).toBe('HAS_ALLERGIES');
      expect(result.allergies).toHaveLength(1);
    });

    it('should return NOT_ASSESSED when no allergies and no assessment (미문진≠무알레르기)', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([]);
      mockPrisma.allergyAssessment.findFirst.mockResolvedValue(null);
      const result = await service.getStatus('patient-1');
      expect(result.status).toBe('NOT_ASSESSED');
    });

    it('should return NO_KNOWN_ALLERGIES only when explicitly assessed', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([]);
      mockPrisma.allergyAssessment.findFirst.mockResolvedValue({ id: 'asmt-1', result: 'NO_KNOWN_ALLERGIES', assessedAt: new Date(), assessor: { id: 'user-1', familyName: '이', givenName: '의사' } });
      const result = await service.getStatus('patient-1');
      expect(result.status).toBe('NO_KNOWN_ALLERGIES');
      expect(result.assessedBy).toBeDefined();
    });

    it('[safety] stale HAS_ALLERGIES assessment with 0 active allergies → NOT_ASSESSED (재문진)', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([]);
      mockPrisma.allergyAssessment.findFirst.mockResolvedValue({ id: 'asmt-old', result: 'HAS_ALLERGIES', assessedAt: new Date() });
      const result = await service.getStatus('patient-1');
      expect(result.status).toBe('NOT_ASSESSED'); // 절대 NKA로 오표시하지 않음
    });
  });

  describe('checkDrugAllergy', () => {
    it('should return warning for matching drug allergy', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        ingredient: 'penicillin',
        nameKo: '페니실린정',
      });

      mockPrisma.allergy.findMany.mockResolvedValue([
        {
          id: 'allergy-1',
          patientId: 'patient-1',
          type: 'DRUG',
          allergen: 'penicillin',
          allergenCode: 'PCN',
          severity: 'HIGH',
          isActive: true,
        },
      ]);

      const result = await service.checkDrugAllergy('patient-1', 'med-1');

      expect(result).toHaveLength(1);
      expect(result[0].severity).toBe('ERROR');
      expect(result[0].type).toBe('ALLERGY');
      expect(result[0].message).toContain('페니실린정');
    });

    it('should not return warning for non-drug allergies', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        ingredient: 'ibuprofen',
        nameKo: '이부프로펜',
      });

      mockPrisma.allergy.findMany.mockResolvedValue([
        {
          id: 'allergy-1',
          allergen: '땅콩',
          type: 'FOOD',
          isActive: true,
        },
      ]);

      const result = await service.checkDrugAllergy('patient-1', 'med-1');

      expect(result).toEqual([]);
    });

    it('should return empty array for inactive allergies', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        ingredient: 'penicillin',
        nameKo: '페니실린정',
      });

      mockPrisma.allergy.findMany.mockResolvedValue([]);

      const result = await service.checkDrugAllergy('patient-1', 'med-1');

      expect(result).toEqual([]);
    });

    it('should handle missing medication', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue(null);

      const result = await service.checkDrugAllergy('patient-1', 'invalid-med');

      expect(result).toEqual([]);
    });

    it('should match by allergenCode (against ingredientCode, not name)', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        ingredient: 'PCN',
        ingredientCode: 'PCN',
        nameKo: '페니실린',
      });

      mockPrisma.allergy.findMany.mockResolvedValue([
        {
          id: 'allergy-1',
          type: 'DRUG',
          allergen: 'penicillin',
          allergenCode: 'PCN',
          isActive: true,
        },
      ]);

      const result = await service.checkDrugAllergy('patient-1', 'med-1');

      expect(result).toHaveLength(1);
    });

    it('should match by ingredient substring', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        ingredient: 'penicillin V',
        nameKo: '비-페니실린',
      });

      mockPrisma.allergy.findMany.mockResolvedValue([
        {
          id: 'allergy-1',
          type: 'DRUG',
          allergen: 'penicillin',
          allergenCode: null,
          isActive: true,
        },
      ]);

      const result = await service.checkDrugAllergy('patient-1', 'med-1');

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('[P2] should NOT fire for every allergy when medication ingredient is empty', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1', ingredient: null, ingredientCode: null, nameKo: '수액',
      });
      mockPrisma.allergy.findMany.mockResolvedValue([
        { id: 'a-1', type: 'DRUG', allergen: 'penicillin', allergenCode: null, isActive: true },
      ]);
      const result = await service.checkDrugAllergy('patient-1', 'med-1');
      expect(result).toHaveLength(0); // 빈 성분이 includes('')로 전 약물 오발동하지 않음
    });

    it('[P1] should NOT code-match allergenCode against ingredient name (only ingredientCode)', async () => {
      // 성분명(ingredient)만 코드와 같고 ingredientCode는 다름 → 코드매칭 불가·명칭도 불일치 → 무경고
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1', ingredient: 'PCN', ingredientCode: 'OTHER', nameKo: '무관약',
      });
      mockPrisma.allergy.findMany.mockResolvedValue([
        { id: 'a-1', type: 'DRUG', allergen: 'ZZZ', allergenCode: 'PCN', isActive: true },
      ]);
      const result = await service.checkDrugAllergy('patient-1', 'med-1');
      expect(result).toHaveLength(0);
    });
  });
});
