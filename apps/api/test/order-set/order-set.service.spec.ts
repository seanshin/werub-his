import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderSetService } from '../../src/modules/order-set/order-set.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('OrderSetService', () => {
  let service: OrderSetService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      orderSet: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]), // 계보 조회 기본값(2026-10-21 P2)
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // 조건부 상태 쓰기(2026-10-21 P2)
        findUniqueOrThrow: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      orderSetUsage: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemsModified: 0 }, _count: 0 }),
      },
      $transaction: vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      favoriteOrder: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
      medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
      procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      orderSetDiagnosis: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new OrderSetService(mockPrisma);
  });

  // ── create ──

  describe('create', () => {
    it('should create order set with userId', async () => {
      mockPrisma.orderSet.create.mockResolvedValue({ id: 'os-1', name: '내과 기본', createdBy: 'u-1' });
      const result = await service.create({ name: '내과 기본', category: 'OUTPATIENT', items: [{ code: 'M001' }] }, 'u-1');
      expect(result.createdBy).toBe('u-1');
    });

    it('should auto-generate code when not provided', async () => {
      mockPrisma.orderSet.count.mockResolvedValue(5);
      mockPrisma.orderSet.create.mockResolvedValue({ id: 'os-1', code: 'CP-DS-006' });
      await service.create({ name: 'Test', category: 'DISEASE', items: [] }, 'u-1');
      expect(mockPrisma.orderSet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'CP-DS-006', status: 'DRAFT' }) }),
      );
    });

    it('should use provided code when given', async () => {
      mockPrisma.orderSet.create.mockResolvedValue({ id: 'os-1', code: 'MY-CODE' });
      await service.create({ name: 'Test', category: 'DISEASE', code: 'MY-CODE', items: [] }, 'u-1');
      expect(mockPrisma.orderSet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'MY-CODE' }) }),
      );
    });

    it('should generate correct prefix for SURGERY_PRE', async () => {
      mockPrisma.orderSet.count.mockResolvedValue(0);
      mockPrisma.orderSet.create.mockResolvedValue({ id: 'os-1' });
      await service.create({ name: 'Test', category: 'SURGERY_PRE', items: [] }, 'u-1');
      expect(mockPrisma.orderSet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'CP-SP-001' }) }),
      );
    });
  });

  // ── findAll ──

  describe('findAll', () => {
    it('should filter by category', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      await service.findAll({ category: 'OUTPATIENT' });
      expect(mockPrisma.orderSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true, category: 'OUTPATIENT' }) }),
      );
    });

    it('should filter by department and status', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      await service.findAll({ department: '내과', status: 'ACTIVE' });
      expect(mockPrisma.orderSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ department: '내과', status: 'ACTIVE' }) }),
      );
    });

    it('should return empty when no filters match', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      const result = await service.findAll({});
      expect(result).toEqual([]);
    });
  });

  // ── findById ──

  describe('findById', () => {
    it('should return order set when found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', name: 'Test' });
      const result = await service.findById('os-1');
      expect(result.id).toBe('os-1');
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue(null);
      await expect(service.findById('os-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ──

  describe('update', () => {
    it('should update order set', async () => {
      // 초안은 제자리 수정 — 상태를 DB 가 대조하는 조건부 쓰기 뒤 다시 읽는다(2026-10-21 P2)
      mockPrisma.orderSet.findUnique
        .mockResolvedValueOnce({ id: 'os-1', status: 'DRAFT' })
        .mockResolvedValueOnce({ id: 'os-1', status: 'DRAFT', name: 'Updated' });
      const result = await service.update('os-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
      expect(mockPrisma.orderSet.updateMany).toHaveBeenCalledWith({ where: { id: 'os-1', status: 'DRAFT' }, data: { name: 'Updated' } });
    });

    it('should throw if order set not found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue(null);
      await expect(service.update('os-x', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ──

  describe('remove', () => {
    it('should soft-delete by setting isActive=false', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1' });
      mockPrisma.orderSet.update.mockResolvedValue({ id: 'os-1', isActive: false });
      const result = await service.remove('os-1');
      expect(result.isActive).toBe(false);
    });
  });

  // ── recommend ──

  describe('recommend', () => {
    it('should return matching order sets for diagnosis codes', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([{ id: 'os-1', diagnosisCode: 'J18' }]);
      const result = await service.recommend(['J18', 'J20']);
      expect(result).toHaveLength(1);
    });

    it('should return empty for no codes', async () => {
      const result = await service.recommend([]);
      expect(result).toEqual([]);
    });
  });

  // ── cloneOrderSet ──

  describe('cloneOrderSet', () => {
    it('should clone with incremented version', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({
        id: 'os-1', name: 'CP 폐렴', version: 1, code: 'CP-DS-001',
        department: '내과', category: 'DISEASE', diagnosisCode: 'J18',
        description: null, applicableTo: null, evidenceLevel: null,
        guidelineRef: null, items: [{ drug: 'AMX' }], isShared: false, parentId: null,
      });
      mockPrisma.orderSet.create.mockResolvedValue({ id: 'os-2', version: 2, name: 'CP 폐렴 (v2)' });
      const result = await service.cloneOrderSet('os-1', 'u-1');
      expect(result.version).toBe(2);
      expect(mockPrisma.orderSet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2, status: 'DRAFT', parentId: 'os-1' }) }),
      );
    });

    it('should use existing parentId if available', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({
        id: 'os-2', name: 'CP (v2)', version: 2, code: 'CP-DS-001',
        department: null, category: 'DISEASE', diagnosisCode: null,
        description: null, applicableTo: null, evidenceLevel: null,
        guidelineRef: null, items: [], isShared: false, parentId: 'os-root',
      });
      mockPrisma.orderSet.create.mockResolvedValue({ id: 'os-3', parentId: 'os-root' });
      await service.cloneOrderSet('os-2', 'u-1');
      expect(mockPrisma.orderSet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ parentId: 'os-root' }) }),
      );
    });

    it('should throw if source not found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue(null);
      await expect(service.cloneOrderSet('os-x', 'u-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── changeStatus ──

  describe('changeStatus', () => {
    it('should transition DRAFT to PENDING_APPROVAL', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', status: 'DRAFT' });
      mockPrisma.orderSet.findUniqueOrThrow.mockResolvedValue({ id: 'os-1', status: 'PENDING_APPROVAL' });
      const result = await service.changeStatus('os-1', 'PENDING_APPROVAL');
      expect(mockPrisma.orderSet.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'os-1', status: 'DRAFT' } }));
      expect(result.status).toBe('PENDING_APPROVAL');
    });

    it('should set approvedBy when transitioning to APPROVED', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', status: 'PENDING_APPROVAL' });
      mockPrisma.orderSet.findUniqueOrThrow.mockResolvedValue({ id: 'os-1', status: 'APPROVED', approvedBy: 'admin-1' });
      await service.changeStatus('os-1', 'APPROVED', 'admin-1');
      expect(mockPrisma.orderSet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approvedBy: 'admin-1', approvedAt: expect.any(Date) }) }),
      );
    });

    it('should throw for invalid status value', async () => {
      await expect(service.changeStatus('os-1', 'INVALID_STATUS')).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid transition', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', status: 'DEPRECATED' });
      await expect(service.changeStatus('os-1', 'ACTIVE')).rejects.toThrow(BadRequestException);
    });

    it('[P0] should block ACTIVE promotion when unresolved items exist (유령 처방 방지)', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({
        id: 'os-1', status: 'APPROVED',
        items: [
          { type: 'MEDICATION', name: '아모크라정' },                    // 미해석
          { type: 'LAB', name: 'CBC', procedureCodeId: 'pc-1' },        // 해석됨
        ],
      });
      await expect(service.changeStatus('os-1', 'ACTIVE')).rejects.toThrow(/미해석 항목 1건/);
      expect(mockPrisma.orderSet.update).not.toHaveBeenCalled();
      expect(mockPrisma.orderSet.updateMany).not.toHaveBeenCalled();
    });

    it('[P0] should allow ACTIVE when all code-required items resolved (ORDER/DOCUMENT는 면제)', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({
        id: 'os-1', status: 'APPROVED',
        items: [
          { type: 'MEDICATION', name: '아모크라정', medicationCodeId: 'mc-1' },
          { type: 'ORDER', name: '산소 2L' },
          { type: 'DOCUMENT', name: '진단서', certType: 'DIAGNOSIS_CERT' },
        ],
      });
      mockPrisma.orderSet.findUniqueOrThrow.mockResolvedValue({ id: 'os-1', status: 'ACTIVE' });
      const result = await service.changeStatus('os-1', 'ACTIVE');
      expect(result.status).toBe('ACTIVE');
    });
  });

  // ── recommend v2 (P2 추천 엔진) ──

  describe('recommend v2', () => {
    const os = (id: string, over: Record<string, unknown> = {}) => ({
      id, name: `set-${id}`, useCount: 0, ageGroup: null, diagnosisCode: null, ...over,
    });

    it('should weight primary diagnosis higher than secondary (주상병 ×1.5)', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([
          { diagnosisCode: 'I10', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: os('primary-set') },
          { diagnosisCode: 'E78.5', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: os('secondary-set') },
        ])
        .mockResolvedValueOnce([]); // PREFIX 없음

      const result = await service.recommend(['I10', 'E78.5'], 'I10');

      expect(result[0].id).toBe('primary-set'); // 주상병 매칭이 상위
      expect(result[0].matchScore).toBeGreaterThan(result[1].matchScore);
    });

    it('should match by prefix (E11 매핑 ← E11.9 진단) and mark matchedBy=PREFIX', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { diagnosisCode: 'E11', matchType: 'PREFIX', role: 'ANY', weight: 100, orderSet: os('dm-set') },
        ]);

      const result = await service.recommend(['E11.9']);

      expect(result).toHaveLength(1);
      expect(result[0].matchedBy).toBe('PREFIX');
      expect(result[0].matchedCode).toBe('E11.9');
    });

    it('should honor PRIMARY_ONLY role (부상병 매칭이면 제외)', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([
          { diagnosisCode: 'J18.9', matchType: 'EXACT', role: 'PRIMARY_ONLY', weight: 100, orderSet: os('pneumonia-cp') },
        ])
        .mockResolvedValueOnce([]);

      const asSecondary = await service.recommend(['I10', 'J18.9'], 'I10'); // J18.9는 부상병
      expect(asSecondary.some(r => r.id === 'pneumonia-cp')).toBe(false);

      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([
          { diagnosisCode: 'J18.9', matchType: 'EXACT', role: 'PRIMARY_ONLY', weight: 100, orderSet: os('pneumonia-cp') },
        ])
        .mockResolvedValueOnce([]);
      const asPrimary = await service.recommend(['J18.9'], 'J18.9');
      expect(asPrimary.some(r => r.id === 'pneumonia-cp')).toBe(true);
    });

    it('should include legacy single diagnosisCode sets (하위호환)', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([os('legacy-set', { diagnosisCode: 'I10' })]);
      mockPrisma.orderSetDiagnosis.findMany.mockResolvedValue([]);

      const result = await service.recommend(['I10']);
      expect(result.some(r => r.id === 'legacy-set')).toBe(true);
      expect(result[0].matchedBy).toBe('LEGACY_EXACT');
    });

    it('should exclude age-inappropriate sets when age given (소아 세트 vs 성인 환자)', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([
          { diagnosisCode: 'J06.9', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: os('peds-set', { ageGroup: 'PEDIATRIC' }) },
          { diagnosisCode: 'J06.9', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: os('adult-set', { ageGroup: 'ADULT' }) },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.recommend(['J06.9'], undefined, 45);
      expect(result.map(r => r.id)).toEqual(['adult-set']);
    });

    it('should boost by useCount and dedupe same set to best score', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([os('dup-set', { diagnosisCode: 'I10', useCount: 100 })]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([
          { diagnosisCode: 'I10', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: os('dup-set', { useCount: 100 }) },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.recommend(['I10']);
      expect(result).toHaveLength(1); // 중복 제거
      expect(result[0].matchScore).toBeGreaterThan(120); // useCount 부스팅 반영
    });
  });

  // ── replaceDiagnoses (진단 매핑 교체) ──

  describe('replaceDiagnoses', () => {
    it('should replace mappings with normalization and dedupe', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1' });
      mockPrisma.orderSetDiagnosis.findMany.mockResolvedValue([]);

      await service.replaceDiagnoses('os-1', [
        { diagnosisCode: ' I10 ', matchType: 'PREFIX', role: 'PRIMARY_ONLY', weight: 5000 },
        { diagnosisCode: 'I10', matchType: 'EXACT' }, // 중복 — 제거
        { diagnosisCode: '', matchType: 'EXACT' },    // 빈값 — 제거
      ]);

      expect(mockPrisma.orderSetDiagnosis.deleteMany).toHaveBeenCalledWith({ where: { orderSetId: 'os-1' } });
      expect(mockPrisma.orderSetDiagnosis.createMany).toHaveBeenCalledWith({
        data: [{ orderSetId: 'os-1', diagnosisCode: 'I10', matchType: 'PREFIX', role: 'PRIMARY_ONLY', weight: 1000 }],
      });
    });
  });

  // ── resolveItems (P0 해석 콘솔) ──

  describe('resolveItems', () => {
    it('should return candidates for unresolved items only', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({
        id: 'os-1', name: '폐렴 세트',
        items: [
          { type: 'MEDICATION', name: '아모크라정 375mg' },
          { type: 'LAB', name: 'CBC', procedureCodeId: 'pc-1' }, // 해석됨 — 제외
          { type: 'IMAGING', name: '흉부 X-ray' },
        ],
      });
      mockPrisma.medicationCode.findMany.mockResolvedValue([
        { id: 'mc-1', code: 'M001', nameKo: '아모크라정 375mg', dosageForm: '정', unitPrice: 500 },
      ]);
      mockPrisma.procedureCode.findMany.mockResolvedValue([
        { id: 'pc-9', code: 'G0001', nameKo: '흉부 X-ray 정면', unitPrice: 12000 },
      ]);

      const result = await service.resolveItems('os-1');

      expect(result.unresolvedCount).toBe(2);
      expect(result.items[0].candidates[0]).toEqual(expect.objectContaining({ id: 'mc-1', codeField: 'medicationCodeId' }));
      expect(result.items[1].candidates[0]).toEqual(expect.objectContaining({ id: 'pc-9', codeField: 'procedureCodeId' }));
    });

    it('should retry with base name when full name has no match ("아모크라정 375mg"→"아모크라정")', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({
        id: 'os-1', name: 'S', items: [{ type: 'MEDICATION', name: '아모크라정 375mg' }],
      });
      mockPrisma.medicationCode.findMany
        .mockResolvedValueOnce([]) // 전체명 실패
        .mockResolvedValueOnce([{ id: 'mc-2', code: 'M002', nameKo: '아모크라정' }]);

      const result = await service.resolveItems('os-1');

      expect(mockPrisma.medicationCode.findMany).toHaveBeenCalledTimes(2);
      expect(result.items[0].candidates[0].id).toBe('mc-2');
    });
  });

  // ── deprecateOrderSet ──

  describe('deprecateOrderSet', () => {
    it('should deprecate an active order set', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', status: 'ACTIVE' });
      mockPrisma.orderSet.update.mockResolvedValue({ id: 'os-1', status: 'DEPRECATED' });
      const result = await service.deprecateOrderSet('os-1');
      expect(result.status).toBe('DEPRECATED');
    });

    it('should throw if already deprecated', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', status: 'DEPRECATED' });
      await expect(service.deprecateOrderSet('os-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw if not found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue(null);
      await expect(service.deprecateOrderSet('os-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── searchOrderSets ──

  describe('searchOrderSets', () => {
    it('should search by name/code/diagnosisCode', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([{ id: 'os-1', name: 'AMX 처방' }]);
      const result = await service.searchOrderSets('AMX');
      expect(result).toHaveLength(1);
      expect(mockPrisma.orderSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            OR: expect.arrayContaining([
              expect.objectContaining({ name: { contains: 'AMX', mode: 'insensitive' } }),
            ]),
          }),
        }),
      );
    });

    it('should return empty for no matches', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      const result = await service.searchOrderSets('nonexistent');
      expect(result).toEqual([]);
    });
  });

  // ── recordUsage ──

  describe('recordUsage', () => {
    it('should record usage and increment useCount', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1' });
      const usageRecord = { id: 'u-1', orderSetId: 'os-1', encounterId: 'enc-1', patientId: 'p-1', usedBy: 'doc-1', itemsApplied: 5, itemsModified: 1 };
      mockPrisma.orderSetUsage.create.mockResolvedValue(usageRecord);
      mockPrisma.orderSet.update.mockResolvedValue({ id: 'os-1', useCount: 1 });
      mockPrisma.$transaction.mockResolvedValue([usageRecord, { id: 'os-1', useCount: 1 }]);

      const result = await service.recordUsage('os-1', { encounterId: 'enc-1', patientId: 'p-1', itemsApplied: 5, itemsModified: 1 }, 'doc-1');
      expect(result).toEqual(usageRecord);
    });

    it('should throw if order set not found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue(null);
      await expect(
        service.recordUsage('os-x', { encounterId: 'enc-1', patientId: 'p-1', itemsApplied: 0, itemsModified: 0 }, 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getUsageStats ──

  describe('getUsageStats', () => {
    it('should return usage statistics', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([
        { id: 'os-1', name: 'Top', code: 'CP-01', department: '내과', useCount: 10, category: 'DISEASE' },
      ]);
      mockPrisma.orderSet.groupBy.mockResolvedValue([
        { department: '내과', _sum: { useCount: 10 } },
      ]);
      mockPrisma.orderSetUsage.count
        .mockResolvedValueOnce(20)   // totalUsages
        .mockResolvedValueOnce(5);   // modifiedUsages

      const result = await service.getUsageStats();
      expect(result.topUsed).toHaveLength(1);
      expect(result.totalUsages).toBe(20);
      expect(result.modificationRate).toBe(25); // 5/20 * 100
      expect(result.byDepartment[0].department).toBe('내과');
    });

    /**
     * 🔴 (2026-09-17 L4) 종전 이 테스트는 **결함을 계약으로 못박고 있었다** — "사용 0 회면 수정률 0%".
     *    0% 는 "아무도 손대지 않은 좋은 세트"로 읽힌다. 표본이 없으면 산출 불가(null)다.
     */
    it('사용 0 회면 modificationRate 는 null(0% 가 아니다)', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSet.groupBy.mockResolvedValue([]);
      mockPrisma.orderSetUsage.count.mockResolvedValue(0);

      const result = await service.getUsageStats();
      expect(result.modificationRate).toBeNull();
      expect(result.totalUsages).toBe(0); // 분모를 함께 낸다
    });
  });

  // ── getHistory ──

  describe('getHistory', () => {
    it('should return version history', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-1', parentId: null });
      mockPrisma.orderSet.findMany.mockResolvedValue([
        { id: 'os-1', version: 1 },
        { id: 'os-2', version: 2 },
      ]);
      const result = await service.getHistory('os-1');
      expect(result).toHaveLength(2);
    });

    it('should use parentId as root when available', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue({ id: 'os-2', parentId: 'os-root' });
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      await service.getHistory('os-2');
      expect(mockPrisma.orderSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ id: 'os-root' }, { parentId: 'os-root' }] },
        }),
      );
    });

    it('should throw if order set not found', async () => {
      mockPrisma.orderSet.findUnique.mockResolvedValue(null);
      await expect(service.getHistory('os-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Favorites ──

  describe('favorites', () => {
    it('should create favorite', async () => {
      mockPrisma.favoriteOrder.create.mockResolvedValue({ id: 'f-1', userId: 'u-1' });
      const result = await service.createFavorite({ name: '내 처방', items: [] }, 'u-1');
      expect(result.userId).toBe('u-1');
    });

    it('should get favorites for user', async () => {
      mockPrisma.favoriteOrder.findMany.mockResolvedValue([{ id: 'f-1' }, { id: 'f-2' }]);
      const result = await service.getFavorites('u-1');
      expect(result).toHaveLength(2);
    });

    it('should increment useCount on use', async () => {
      mockPrisma.favoriteOrder.findUnique.mockResolvedValue({ id: 'f-1', items: [] });
      mockPrisma.favoriteOrder.update.mockResolvedValue({});
      await service.useFavorite('f-1');
      expect(mockPrisma.favoriteOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { useCount: { increment: 1 } } }),
      );
    });

    it('should throw on use non-existent favorite', async () => {
      mockPrisma.favoriteOrder.findUnique.mockResolvedValue(null);
      await expect(service.useFavorite('f-x')).rejects.toThrow(NotFoundException);
    });

    it('should delete favorite', async () => {
      mockPrisma.favoriteOrder.delete.mockResolvedValue({ id: 'f-1' });
      const result = await service.removeFavorite('f-1');
      expect(result.id).toBe('f-1');
    });
  });

  /**
   * 🔴 금기 대조 (2026-09-03 재검증 회수) — 관리 화면은 금기를 `{note}` 로만 저장해
   *    {type,value} 를 기대하는 자동 대조가 **한 건도 평가되지 않은 채** 항상 통과했다.
   *    note 를 코드가 해석하는 척하지 않는다 — contraUnevaluated 로 드러내고 원장에 남긴다.
   */
  describe('recommend — 금기 대조 정직성', () => {
    const PATIENT = '11111111-2222-4333-8444-555566667777';
    const setWith = (contra: unknown[]) => ({
      id: 'cs-1', name: '금기세트', useCount: 0, ageGroup: null, diagnosisCode: null, contraindications: contra,
    });

    it('🔴 note 뿐인 금기는 자동 제외하지 못한다 — contraUnevaluated 로 말하고 드리프트 원장에 남긴다', async () => {
      const drift = { record: vi.fn() };
      const svc = new OrderSetService(mockPrisma, drift as never);
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([{ diagnosisCode: 'I10', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: setWith([{ note: '임산부 금기' }]) }])
        .mockResolvedValueOnce([]);
      const result = await svc.recommend(['I10'], undefined, undefined, PATIENT);
      expect(result).toHaveLength(1);
      expect(result[0].contraUnevaluated, '평가 못 한 금기를 "대조 통과"처럼 보이게 하면 안 된다').toBe(true);
      expect(drift.record).toHaveBeenCalledTimes(1);
      expect((drift.record.mock.calls[0][0] as { consumer: string }).consumer).toBe('order-set.isContraindicated');
    });

    it('ALLERGY형 금기는 활성 알레르기와 대조해 실제로 제외한다(대조군 — 기능 자체는 산다)', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([{ allergen: '페니실린' }]);
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([{ diagnosisCode: 'I10', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: setWith([{ type: 'ALLERGY', value: '페니실린' }]) }])
        .mockResolvedValueOnce([]);
      const result = await service.recommend(['I10'], undefined, undefined, PATIENT);
      expect(result, '평가 가능한 금기가 매칭되면 세트를 제외해야 한다').toHaveLength(0);
    });

    it('type/value 금기가 매칭되지 않으면 통과하고 contraUnevaluated 는 false(과잉 경고 금지)', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([]);
      mockPrisma.orderSetDiagnosis.findMany
        .mockResolvedValueOnce([{ diagnosisCode: 'I10', matchType: 'EXACT', role: 'ANY', weight: 100, orderSet: setWith([{ type: 'DIAGNOSIS', value: 'N18' }]) }])
        .mockResolvedValueOnce([]);
      const result = await service.recommend(['I10'], undefined, undefined, PATIENT);
      expect(result).toHaveLength(1);
      expect(result[0].contraUnevaluated).toBe(false);
    });
  });
});
