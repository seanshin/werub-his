import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DoctorCodeController } from '../../src/modules/doctor-code/doctor-code.controller';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('DoctorCodeController', () => {
  let controller: DoctorCodeController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getMyCodes: vi.fn(),
      addCode: vi.fn(),
      updateCode: vi.fn(),
      removeCode: vi.fn(),
      useCode: vi.fn(),
      getStats: vi.fn(),
      getCatalog: vi.fn(),
      addCatalogItem: vi.fn(),
      updateCatalogItem: vi.fn(),
      removeCatalogItem: vi.fn(),
      searchCodes: vi.fn(),
    };

    controller = new DoctorCodeController(mockService);
  });

  describe('Personal Code List', () => {
    it('should get my codes', async () => {
      const mockCodes = [
        {
          id: 'code-1',
          doctorId: 'doctor-1',
          codeId: 'med-001',
          codeType: 'MEDICATION_CODE',
          category: 'MEDICATION',
          displayName: '아스피린',
          isPinned: true,
          useCount: 10,
          codeDetail: { code: 'A001', nameKo: '아스피린' },
        },
      ];

      vi.mocked(mockService.getMyCodes).mockResolvedValue({ data: mockCodes });

      const result = await controller.getMyCodes('doctor-1');

      expect(result.data.data[0].displayName).toBe('아스피린');
      expect(mockService.getMyCodes).toHaveBeenCalledWith('doctor-1', undefined);
    });

    it('should get my codes with category filter', async () => {
      const mockCodes = [
        {
          id: 'code-1',
          doctorId: 'doctor-1',
          category: 'LAB',
          codeId: 'proc-001',
          codeType: 'PROCEDURE_CODE',
        },
      ];

      vi.mocked(mockService.getMyCodes).mockResolvedValue({ data: mockCodes });

      const result = await controller.getMyCodes('doctor-1', 'LAB');

      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0].category).toBe('LAB');
      expect(mockService.getMyCodes).toHaveBeenCalledWith('doctor-1', 'LAB');
    });

    it('should add code', async () => {
      const mockCode = {
        id: 'code-1',
        doctorId: 'doctor-1',
        codeId: 'med-001',
        codeType: 'MEDICATION_CODE',
        category: 'MEDICATION',
        displayName: '아스피린',
      };

      vi.mocked(mockService.addCode).mockResolvedValue({ data: mockCode });

      const dto = {
        codeId: 'med-001',
        codeType: 'MEDICATION_CODE',
        category: 'MEDICATION',
        defaultDosage: '500mg',
      };

      const result = await controller.addCode(dto, 'doctor-1');

      expect(result.data.displayName).toBe('아스피린');
      expect(mockService.addCode).toHaveBeenCalledWith('doctor-1', dto);
    });

    it('should throw ConflictException when adding duplicate code', async () => {
      const dto = {
        codeId: 'med-001',
        codeType: 'MEDICATION_CODE',
        category: 'MEDICATION',
      };

      vi.mocked(mockService.addCode).mockRejectedValue(
        new ConflictException('이미 등록된 코드입니다.'),
      );

      await expect(controller.addCode(dto, 'doctor-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should update code', async () => {
      const mockUpdated = {
        id: 'code-1',
        defaultDosage: '1000mg',
        isPinned: true,
      };

      vi.mocked(mockService.updateCode).mockResolvedValue({ data: mockUpdated });

      const dto = { defaultDosage: '1000mg', isPinned: true };

      const result = await controller.updateCode('doc-1', 'code-1', dto);

      expect(result.data.defaultDosage).toBe('1000mg');
      expect(result.data.isPinned).toBe(true);
    });

    it('should remove code', async () => {
      vi.mocked(mockService.removeCode).mockResolvedValue({
        data: { deleted: true },
      });

      const result = await controller.removeCode('doc-1', 'code-1');

      expect(result.data.data.deleted).toBe(true);
      expect(mockService.removeCode).toHaveBeenCalledWith('doc-1', 'code-1');
    });

    it('should throw NotFoundException when removing non-existent code', async () => {
      vi.mocked(mockService.removeCode).mockRejectedValue(
        new NotFoundException('코드를 찾을 수 없습니다.'),
      );

      await expect(controller.removeCode('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should use code and increment count', async () => {
      const mockUpdated = {
        id: 'code-1',
        useCount: 11,
      };

      vi.mocked(mockService.useCode).mockResolvedValue({ data: mockUpdated });

      const result = await controller.useCode('doc-1', 'code-1');

      expect(result.data.data.useCount).toBe(11);
      expect(mockService.useCode).toHaveBeenCalledWith('doc-1', 'code-1');
    });

    it('should get my stats', async () => {
      const mockStats = {
        medications: [
          {
            id: 'code-1',
            codeId: 'med-001',
            displayName: '아스피린',
            useCount: 50,
          },
        ],
        labs: [
          {
            id: 'code-2',
            codeId: 'proc-001',
            displayName: '혈액검사',
            useCount: 30,
          },
        ],
      };

      vi.mocked(mockService.getStats).mockResolvedValue({
        data: mockStats,
      });

      const result = await controller.getStats('doctor-1');

      expect(result.data.data.medications).toHaveLength(1);
      expect(result.data.data.labs).toHaveLength(1);
      expect(result.data.data.medications[0].useCount).toBe(50);
      expect(mockService.getStats).toHaveBeenCalledWith('doctor-1');
    });
  });

  describe('Department Catalog', () => {
    it('should get catalog codes for department', async () => {
      const mockCatalog = [
        {
          id: 'cat-1',
          departmentName: '내과',
          codeId: 'med-001',
          codeType: 'MEDICATION_CODE',
          defaultDosage: '500mg',
          codeDetail: { code: 'A001', nameKo: '아스피린' },
        },
      ];

      vi.mocked(mockService.getCatalog).mockResolvedValue({
        data: mockCatalog,
      });

      const result = await controller.getCatalog('내과');

      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0].departmentName).toBe('내과');
      expect(mockService.getCatalog).toHaveBeenCalledWith('내과', undefined, undefined);
    });

    it('should get catalog codes with subcategory filter', async () => {
      const mockCatalog = [
        {
          id: 'cat-1',
          departmentName: '내과',
          subcategory: '소화기',
          codeId: 'med-001',
        },
      ];

      vi.mocked(mockService.getCatalog).mockResolvedValue({
        data: mockCatalog,
      });

      const result = await controller.getCatalog('내과', '소화기');

      expect(result.data.data[0].subcategory).toBe('소화기');
      expect(mockService.getCatalog).toHaveBeenCalledWith('내과', '소화기', undefined);
    });

    it('should get catalog codes with codeType filter', async () => {
      const mockCatalog = [
        {
          id: 'cat-1',
          departmentName: '내과',
          codeType: 'MEDICATION_CODE',
          codeId: 'med-001',
        },
      ];

      vi.mocked(mockService.getCatalog).mockResolvedValue({
        data: mockCatalog,
      });

      const result = await controller.getCatalog('내과', undefined, 'MEDICATION_CODE');

      expect(result.data.data[0].codeType).toBe('MEDICATION_CODE');
      expect(mockService.getCatalog).toHaveBeenCalledWith('내과', undefined, 'MEDICATION_CODE');
    });

    it('should add catalog item', async () => {
      const mockItem = {
        id: 'cat-1',
        departmentName: '내과',
        codeId: 'med-001',
        codeType: 'MEDICATION_CODE',
        defaultDosage: '500mg',
        createdBy: 'doctor-1',
      };

      vi.mocked(mockService.addCatalogItem).mockResolvedValue({
        data: mockItem,
      });

      const dto = {
        departmentName: '내과',
        codeId: 'med-001',
        codeType: 'MEDICATION_CODE',
        defaultDosage: '500mg',
      };

      const result = await controller.addCatalogItem(dto, 'doctor-1');

      expect(result.data.departmentName).toBe('내과');
      expect(mockService.addCatalogItem).toHaveBeenCalledWith({
        ...dto,
        createdBy: 'doctor-1',
      });
    });

    it('should throw ConflictException when adding duplicate catalog item', async () => {
      const dto = {
        departmentName: '내과',
        codeId: 'med-001',
        codeType: 'MEDICATION_CODE',
      };

      vi.mocked(mockService.addCatalogItem).mockRejectedValue(
        new ConflictException('이미 등록된 코드입니다.'),
      );

      await expect(
        controller.addCatalogItem(dto, 'doctor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should update catalog item', async () => {
      const mockUpdated = {
        id: 'cat-1',
        defaultDosage: '1000mg',
        guideNote: '식사 30분 후 복용',
      };

      vi.mocked(mockService.updateCatalogItem).mockResolvedValue({
        data: mockUpdated,
      });

      const dto = {
        defaultDosage: '1000mg',
        guideNote: '식사 30분 후 복용',
      };

      const result = await controller.updateCatalogItem('cat-1', dto);

      expect(result.data.guideNote).toBe('식사 30분 후 복용');
    });

    it('should remove catalog item (soft delete)', async () => {
      const mockUpdated = {
        id: 'cat-1',
        isActive: false,
      };

      vi.mocked(mockService.removeCatalogItem).mockResolvedValue({
        data: mockUpdated,
      });

      const result = await controller.removeCatalogItem('cat-1');

      expect(result.data.data.isActive).toBe(false);
      expect(mockService.removeCatalogItem).toHaveBeenCalledWith('cat-1');
    });

    it('should throw NotFoundException when removing non-existent catalog item', async () => {
      vi.mocked(mockService.removeCatalogItem).mockRejectedValue(
        new NotFoundException('카탈로그 항목을 찾을 수 없습니다.'),
      );

      await expect(
        controller.removeCatalogItem('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Code Search', () => {
    it('should search medication codes', async () => {
      const mockResults = [
        {
          id: 'med-001',
          code: 'A001',
          nameKo: '아스피린',
          source: 'MY_LIST',
          myDefaults: { dosage: '500mg', frequency: '3회' },
          sortPriority: 0,
        },
        {
          id: 'med-002',
          code: 'A002',
          nameKo: '아세트아미노펜',
          source: 'DEPT_CATALOG',
          deptGuide: { defaultDosage: '500mg' },
          sortPriority: 2,
        },
      ];

      vi.mocked(mockService.searchCodes).mockResolvedValue({
        data: mockResults,
      });

      const result = await controller.searchCodes(
        'doctor-1',
        '내과',
        '아스',
        'MEDICATION',
      );

      expect(result.data.data).toHaveLength(2);
      expect(result.data.data[0].source).toBe('MY_LIST');
      expect(result.data.data[1].source).toBe('DEPT_CATALOG');
      expect(mockService.searchCodes).toHaveBeenCalledWith(
        'doctor-1',
        '내과',
        '아스',
        'MEDICATION',
      );
    });

    it('should search lab procedure codes', async () => {
      const mockResults = [
        {
          id: 'proc-001',
          code: 'L001',
          nameKo: '혈액검사',
          source: 'MY_LIST',
          sortPriority: 0,
        },
      ];

      vi.mocked(mockService.searchCodes).mockResolvedValue({
        data: mockResults,
      });

      const result = await controller.searchCodes(
        'doctor-1',
        '내과',
        '혈',
        'LAB',
      );

      expect(result.data.data[0].nameKo).toBe('혈액검사');
      expect(mockService.searchCodes).toHaveBeenCalledWith(
        'doctor-1',
        '내과',
        '혈',
        'LAB',
      );
    });

    it('should search imaging codes', async () => {
      const mockResults = [
        {
          id: 'proc-002',
          code: 'I001',
          nameKo: 'X-ray',
          category: '영상',
          source: 'DEPT_CATALOG',
          sortPriority: 2,
        },
      ];

      vi.mocked(mockService.searchCodes).mockResolvedValue({
        data: mockResults,
      });

      const result = await controller.searchCodes(
        'doctor-1',
        '내과',
        'X',
        'IMAGING',
      );

      expect(result.data.data[0].category).toBe('영상');
      expect(mockService.searchCodes).toHaveBeenCalledWith(
        'doctor-1',
        '내과',
        'X',
        'IMAGING',
      );
    });

    it('should include source priority in search results', async () => {
      const mockResults = [
        {
          id: 'med-001',
          nameKo: '아스피린',
          source: 'MY_LIST',
          sortPriority: 0,
          myDefaults: { dosage: '500mg' },
        },
        {
          id: 'med-002',
          nameKo: '아세트아미노펜',
          source: 'DEPT_CATALOG',
          sortPriority: 2,
          deptGuide: { guideNote: '고열시 투여' },
        },
        {
          id: 'med-003',
          nameKo: '이부프로펜',
          source: 'ALL',
          sortPriority: 3,
        },
      ];

      vi.mocked(mockService.searchCodes).mockResolvedValue({
        data: mockResults,
      });

      const result = await controller.searchCodes(
        'doctor-1',
        '내과',
        '아',
        'MEDICATION',
      );

      // Verify priority order: MY_LIST (0) < DEPT_CATALOG (2) < ALL (3)
      expect(result.data.data[0].sortPriority).toBeLessThan(
        result.data.data[1].sortPriority,
      );
      expect(result.data.data[1].sortPriority).toBeLessThan(
        result.data.data[2].sortPriority,
      );
    });

    it('should return empty array if no codes match', async () => {
      vi.mocked(mockService.searchCodes).mockResolvedValue({
        data: [],
      });

      const result = await controller.searchCodes(
        'doctor-1',
        '내과',
        'nonexistent',
        'MEDICATION',
      );

      expect(result.data.data).toHaveLength(0);
    });
  });

  describe('Authorization', () => {
    it('should require DOCTOR role for getMyCodes', async () => {
      // @Roles(UserRole.DOCTOR) is applied
      vi.mocked(mockService.getMyCodes).mockResolvedValue({ data: [] });
      const result = await controller.getMyCodes('doctor-1');
      expect(result).toBeDefined();
    });

    it('should require DOCTOR role for addCode', async () => {
      // @Roles(UserRole.DOCTOR) is applied
      vi.mocked(mockService.addCode).mockResolvedValue({ data: {} });
      const result = await controller.addCode({} as any, 'doctor-1');
      expect(result).toBeDefined();
    });

    it('should allow DOCTOR and ADMIN for addCatalogItem', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      vi.mocked(mockService.addCatalogItem).mockResolvedValue({ data: {} });
      const result = await controller.addCatalogItem({} as any, 'doctor-1');
      expect(result).toBeDefined();
    });

    it('should require ADMIN role for removeCatalogItem', async () => {
      // @Roles(UserRole.ADMIN) is applied
      vi.mocked(mockService.removeCatalogItem).mockResolvedValue({
        data: { isActive: false },
      });
      const result = await controller.removeCatalogItem('cat-1');
      expect(result).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap getMyCodes response in data', async () => {
      const mockCodes = [{ id: 'code-1' }];
      vi.mocked(mockService.getMyCodes).mockResolvedValue({ data: mockCodes });

      const result = await controller.getMyCodes('doctor-1');

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('data');
    });

    it('should include data property in addCode response', async () => {
      vi.mocked(mockService.addCode).mockResolvedValue({
        data: { id: 'code-1' },
      });

      const result = await controller.addCode({} as any, 'doctor-1');

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('code-1');
    });
  });
});
