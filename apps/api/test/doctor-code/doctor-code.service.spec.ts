import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DoctorCodeService } from '../../src/modules/doctor-code/doctor-code.service';

const DOC = 'doc-1'; // 소유자(로그인 의사)

describe('DoctorCodeService', () => {
  let service: DoctorCodeService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      doctorCodeList: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      medicationCode: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      procedureCode: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      departmentCodeCatalog: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      formularyItem: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new DoctorCodeService(mockPrisma);
  });

  describe('getMyCodes', () => {
    it('should return doctor personal code list sorted by pin status and usage', async () => {
      const mockCodes = [
        { id: 'dc-1', doctorId: 'dr-1', codeId: 'med-1', codeType: 'MEDICATION_CODE', isPinned: true, useCount: 50, sortOrder: 1 },
        { id: 'dc-2', doctorId: 'dr-1', codeId: 'med-2', codeType: 'MEDICATION_CODE', isPinned: false, useCount: 30, sortOrder: 2 },
      ];

      const mockMedication = { id: 'med-1', code: 'AMOX-500', nameKo: '아목시실린', nameEn: 'Amoxicillin', dosageForm: 'Tablet', unit: 'mg' };

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue(mockCodes);
      vi.mocked(mockPrisma.medicationCode.findUnique).mockResolvedValue(mockMedication);

      const result = await service.getMyCodes('dr-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].isPinned).toBe(true);
      expect(mockPrisma.doctorCodeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { doctorId: 'dr-1' } })
      );
    });

    it('should filter by category if provided', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([]);

      await service.getMyCodes('dr-1', 'MEDICATION');

      expect(mockPrisma.doctorCodeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'MEDICATION' }) })
      );
    });

    it('should enrich with medication code details', async () => {
      const mockCodes = [{ id: 'dc-1', doctorId: 'dr-1', codeId: 'med-1', codeType: 'MEDICATION_CODE' }];
      const mockMedication = { id: 'med-1', code: 'AMOX', nameKo: '아목시실린' };

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue(mockCodes);
      vi.mocked(mockPrisma.medicationCode.findUnique).mockResolvedValue(mockMedication);

      const result = await service.getMyCodes('dr-1');

      expect(result.data[0].codeDetail).toBeDefined();
      expect(result.data[0].codeDetail.nameKo).toBe('아목시실린');
    });

    it('should enrich with procedure code details', async () => {
      const mockCodes = [{ id: 'dc-1', doctorId: 'dr-1', codeId: 'proc-1', codeType: 'PROCEDURE_CODE' }];
      const mockProcedure = { id: 'proc-1', code: 'LAB-001', nameKo: '혈액검사' };

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue(mockCodes);
      vi.mocked(mockPrisma.procedureCode.findUnique).mockResolvedValue(mockProcedure);

      const result = await service.getMyCodes('dr-1');

      expect(result.data[0].codeDetail.nameKo).toBe('혈액검사');
    });
  });

  describe('addCode', () => {
    it('should create doctor code with defaults', async () => {
      const mockCode = {
        id: 'dc-1',
        doctorId: 'dr-1',
        codeId: 'med-1',
        codeType: 'MEDICATION_CODE',
        category: 'MEDICATION',
        defaultDosage: '500mg',
        defaultFrequency: 'BID',
        isPinned: false,
      };

      vi.mocked(mockPrisma.doctorCodeList.create).mockResolvedValue(mockCode);

      const result = await service.addCode('dr-1', {
        category: 'MEDICATION',
        codeId: 'med-1',
        codeType: 'MEDICATION_CODE',
        defaultDosage: '500mg',
        defaultFrequency: 'BID',
      });

      expect(result.data.id).toBe('dc-1');
      expect(result.data.defaultDosage).toBe('500mg');
    });

    it('should throw ConflictException on duplicate code', async () => {
      vi.mocked(mockPrisma.doctorCodeList.create).mockRejectedValue({ code: 'P2002' });

      await expect(
        service.addCode('dr-1', {
          category: 'MEDICATION',
          codeId: 'med-1',
          codeType: 'MEDICATION_CODE',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('should handle optional fields', async () => {
      const mockCode = { id: 'dc-1', doctorId: 'dr-1', codeId: 'med-1', isPinned: true };

      vi.mocked(mockPrisma.doctorCodeList.create).mockResolvedValue(mockCode);

      const result = await service.addCode('dr-1', {
        category: 'MEDICATION',
        codeId: 'med-1',
        codeType: 'MEDICATION_CODE',
        isPinned: true,
      });

      expect(result.data.isPinned).toBe(true);
    });
  });

  describe('updateCode', () => {
    it('should update code settings', async () => {
      const mockCode = { id: 'dc-1', doctorId: 'dr-1', defaultDosage: '1000mg' };
      const updatedCode = { id: 'dc-1', doctorId: 'dr-1', defaultDosage: '1000mg', isPinned: true };

      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue(mockCode);
      vi.mocked(mockPrisma.doctorCodeList.update).mockResolvedValue(updatedCode);

      const result = await service.updateCode(DOC, 'dc-1', { defaultDosage: '1000mg', isPinned: true });

      expect(result.data.defaultDosage).toBe('1000mg');
      expect(result.data.isPinned).toBe(true);
    });

    it('should throw NotFoundException if code not found', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue(null);

      await expect(service.updateCode(DOC, 'invalid-id', {})).rejects.toThrow(NotFoundException);
    });

    it('should allow partial updates', async () => {
      const mockCode = { id: 'dc-1', doctorId: 'dr-1' };
      const updatedCode = { id: 'dc-1', sortOrder: 5 };

      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue(mockCode);
      vi.mocked(mockPrisma.doctorCodeList.update).mockResolvedValue(updatedCode);

      const result = await service.updateCode(DOC, 'dc-1', { sortOrder: 5 });

      expect(result.data.sortOrder).toBe(5);
    });
  });

  describe('removeCode', () => {
    it('should delete code from personal list', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue({ id: 'dc-1' });
      vi.mocked(mockPrisma.doctorCodeList.delete).mockResolvedValue({ id: 'dc-1' });

      const result = await service.removeCode(DOC, 'dc-1');

      expect(result.data.deleted).toBe(true);
      expect(mockPrisma.doctorCodeList.delete).toHaveBeenCalledWith({ where: { id: 'dc-1' } });
    });

    it('should throw NotFoundException if code not found', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue(null);

      await expect(service.removeCode(DOC, 'invalid-id')).rejects.toThrow(NotFoundException);
    });

    /**
     * 🔴 남의 약속처방을 지울 수 없다(W7 IDOR 봉합).
     * 같은 모듈의 처방 세트는 이미 소유 검증이 있었는데 **코드 쪽만 빠져 있었다** —
     * 보호가 반쪽이면 없는 것과 같다.
     */
    it('🔴 타인 코드는 삭제할 수 없다 — 존재 여부도 알려주지 않는다(404)', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue(null); // 남의 것 → 조회 불가

      await expect(service.removeCode('other-doctor', 'dc-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.doctorCodeList.delete).not.toHaveBeenCalled();
    });

    it('🔴 소유 검증은 doctorId 로 좁혀 조회한다', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue({ id: 'dc-1' });
      vi.mocked(mockPrisma.doctorCodeList.delete).mockResolvedValue({ id: 'dc-1' });

      await service.removeCode(DOC, 'dc-1');

      expect(mockPrisma.doctorCodeList.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'dc-1', doctorId: DOC } }),
      );
    });
  });

  describe('useCode', () => {
    it('should increment useCount', async () => {
      const mockCode = { id: 'dc-1', doctorId: 'dr-1', useCount: 51 };

      vi.mocked(mockPrisma.doctorCodeList.findFirst).mockResolvedValue({ id: 'dc-1' });
      vi.mocked(mockPrisma.doctorCodeList.update).mockResolvedValue(mockCode);

      const result = await service.useCode(DOC, 'dc-1');

      expect(result.data.useCount).toBe(51);
      expect(mockPrisma.doctorCodeList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ useCount: { increment: 1 } }),
        })
      );
    });
  });

  describe('getStats', () => {
    it('should return top medications and labs by usage', async () => {
      const topMeds = [
        { id: 'dc-1', codeId: 'med-1', useCount: 100 },
        { id: 'dc-2', codeId: 'med-2', useCount: 80 },
      ];

      const topLabs = [
        { id: 'dc-3', codeId: 'lab-1', useCount: 50 },
      ];

      vi.mocked(mockPrisma.doctorCodeList.findMany)
        .mockResolvedValueOnce(topMeds)
        .mockResolvedValueOnce(topLabs);

      const result = await service.getStats('dr-1');

      expect(result.data.medications).toHaveLength(2);
      expect(result.data.labs).toHaveLength(1);
    });

    it('should limit results to top 20', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([]);

      await service.getStats('dr-1');

      expect(mockPrisma.doctorCodeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 })
      );
    });
  });

  describe('getCatalog', () => {
    it('should return department code catalog', async () => {
      const mockCatalogItems = [
        {
          id: 'cat-1',
          departmentName: '내과',
          subcategory: '항생제',
          codeId: 'med-1',
          codeType: 'MEDICATION_CODE',
          defaultDosage: '500mg',
        },
      ];

      const mockMedication = { id: 'med-1', code: 'AMOX', nameKo: '아목시실린' };

      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue(mockCatalogItems);
      vi.mocked(mockPrisma.medicationCode.findUnique).mockResolvedValue(mockMedication);

      const result = await service.getCatalog('내과');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].codeDetail).toBeDefined();
    });

    it('should filter by subcategory if provided', async () => {
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue([]);

      await service.getCatalog('내과', '항생제');

      expect(mockPrisma.departmentCodeCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ subcategory: '항생제' }),
        })
      );
    });

    it('should filter by codeType if provided', async () => {
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue([]);

      await service.getCatalog('내과', undefined, 'MEDICATION_CODE');

      expect(mockPrisma.departmentCodeCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ codeType: 'MEDICATION_CODE' }),
        })
      );
    });
  });

  describe('addCatalogItem', () => {
    it('should add item to department catalog', async () => {
      const mockItem = {
        id: 'cat-1',
        departmentName: '내과',
        codeId: 'med-1',
        codeType: 'MEDICATION_CODE',
        defaultDosage: '500mg',
      };

      vi.mocked(mockPrisma.departmentCodeCatalog.create).mockResolvedValue(mockItem);

      const result = await service.addCatalogItem({
        departmentName: '내과',
        codeId: 'med-1',
        codeType: 'MEDICATION_CODE',
        defaultDosage: '500mg',
        createdBy: 'admin-1',
      });

      expect(result.data.departmentName).toBe('내과');
    });

    it('should throw ConflictException on duplicate', async () => {
      vi.mocked(mockPrisma.departmentCodeCatalog.create).mockRejectedValue({ code: 'P2002' });

      await expect(
        service.addCatalogItem({
          departmentName: '내과',
          codeId: 'med-1',
          codeType: 'MEDICATION_CODE',
          createdBy: 'admin-1',
        })
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateCatalogItem', () => {
    it('should update catalog item', async () => {
      const mockItem = { id: 'cat-1', departmentName: '내과' };
      const updatedItem = { id: 'cat-1', departmentName: '내과', guideNote: '주의: 용량 초과 금지' };

      vi.mocked(mockPrisma.departmentCodeCatalog.findUnique).mockResolvedValue(mockItem);
      vi.mocked(mockPrisma.departmentCodeCatalog.update).mockResolvedValue(updatedItem);

      const result = await service.updateCatalogItem('cat-1', { guideNote: '주의: 용량 초과 금지' });

      expect(result.data.guideNote).toBe('주의: 용량 초과 금지');
    });

    it('should throw NotFoundException if item not found', async () => {
      vi.mocked(mockPrisma.departmentCodeCatalog.findUnique).mockResolvedValue(null);

      await expect(service.updateCatalogItem('invalid-id', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeCatalogItem', () => {
    it('should soft delete catalog item by setting isActive to false', async () => {
      const mockItem = { id: 'cat-1', isActive: true };
      const deactivatedItem = { id: 'cat-1', isActive: false };

      vi.mocked(mockPrisma.departmentCodeCatalog.findUnique).mockResolvedValue(mockItem);
      vi.mocked(mockPrisma.departmentCodeCatalog.update).mockResolvedValue(deactivatedItem);

      const result = await service.removeCatalogItem('cat-1');

      expect(result.data.isActive).toBe(false);
    });

    it('should throw NotFoundException if item not found', async () => {
      vi.mocked(mockPrisma.departmentCodeCatalog.update).mockRejectedValue(new Error('Not found'));

      await expect(service.removeCatalogItem('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchCodes', () => {
    it('should search and prioritize codes: my list > catalog > all', async () => {
      const myCode = { id: 'dc-1', codeId: 'med-1', doctorId: 'dr-1', isPinned: true, useCount: 50 };
      const allMeds = [
        { id: 'med-1', code: 'AMOX', nameKo: '아목시실린' },
        { id: 'med-2', code: 'AZIT', nameKo: '아지스로마이신' },
      ];
      const catalogItems = [{ codeId: 'med-2', defaultDosage: '250mg', defaultFrequency: 'OD' }];

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([myCode]);
      vi.mocked(mockPrisma.medicationCode.findMany).mockResolvedValue(allMeds);
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue(catalogItems);

      const result = await service.searchCodes('dr-1', '내과', '아', 'MEDICATION');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].source).toBe('MY_LIST');
      expect(result.data[0].nameKo).toBe('아목시실린');
    });

    it('should include dosage defaults from personal list', async () => {
      const myCode = { codeId: 'med-1', defaultDosage: '500mg', defaultFrequency: 'BID', defaultDuration: 7, defaultRoute: 'PO' };
      const allMeds = [{ id: 'med-1', code: 'AMOX', nameKo: '아목시실린' }];

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([myCode]);
      vi.mocked(mockPrisma.medicationCode.findMany).mockResolvedValue(allMeds);
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue([]);

      const result = await service.searchCodes('dr-1', '내과', '아', 'MEDICATION');

      expect(result.data[0].myDefaults.dosage).toBe('500mg');
      expect(result.data[0].myDefaults.frequency).toBe('BID');
    });

    it('should handle LAB codes', async () => {
      const allLabs = [{ id: 'lab-1', code: 'CBC', nameKo: '혈액검사' }];

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.procedureCode.findMany).mockResolvedValue(allLabs);
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue([]);

      const result = await service.searchCodes('dr-1', '내과', 'CBC', 'LAB');

      expect(result.data[0].nameKo).toBe('혈액검사');
    });

    it('should handle IMAGING codes', async () => {
      const allImaging = [{ id: 'img-1', code: 'CT-001', nameKo: 'CT 검사' }];

      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.procedureCode.findMany).mockResolvedValue(allImaging);
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue([]);

      const result = await service.searchCodes('dr-1', '내과', 'CT', 'IMAGING');

      expect(result.data[0].nameKo).toBe('CT 검사');
    });

    it('should limit results to 30', async () => {
      vi.mocked(mockPrisma.doctorCodeList.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.medicationCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.departmentCodeCatalog.findMany).mockResolvedValue([]);

      await service.searchCodes('dr-1', '내과', '아', 'MEDICATION');

      expect(mockPrisma.medicationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30 })
      );
    });
  });
});
