import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TreatmentTemplateService } from '../../src/modules/treatment-template/treatment-template.service';

describe('TreatmentTemplateService', () => {
  let service: TreatmentTemplateService;
  let mockPrisma: any;
  let mockPreOrder: any;

  beforeEach(() => {
    mockPrisma = {
      patient: { findUnique: vi.fn().mockResolvedValue({ id: 'pat-1' }) },
      patientTreatmentSchedule: { create: vi.fn().mockResolvedValue({ id: 'sched-1' }) },
      patientScheduleItem: { create: vi.fn().mockResolvedValue({ id: 'psi-1' }) },
      treatmentScheduleTemplate: {
        create: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // 조건부 상태 쓰기(2026-10-21 P2)
        findUniqueOrThrow: vi.fn(),
      },
      treatmentTemplateItem: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      treatmentTemplateDiagnosis: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      // 🔴 정본은 배열형과 콜백형을 둘 다 쓴다(K1: 일정 일괄이동은 콜백형) — 목이 배열만 받으면
      //    콜백이 `Promise.all(fn)` 으로 터져 **가드가 결함이 아닌 이유로** 실패한다.
      $transaction: vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
    };
    mockPreOrder = { create: vi.fn().mockResolvedValue({ data: { id: 'po-1' } }) };
    service = new TreatmentTemplateService(mockPrisma, mockPreOrder);
  });

  const tpl = (over: Record<string, unknown> = {}) => ({
    id: 'tpl-1', name: 'T', status: 'APPROVED', totalDays: 28, items: [], diagnoses: [], ...over,
  });

  describe('create — 항목 정규화', () => {
    it('should clamp dayOffset to [0, totalDays] and drop invalid items', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl());
      await service.create({
        name: '당뇨 12주',
        totalDays: 84,
        items: [
          { dayOffset: -3, itemType: 'VISIT', title: '재진' },       // 0으로 클램프
          { dayOffset: 999, itemType: 'LAB', title: 'HbA1c', refCodeId: 'pc-1' }, // 84로 클램프
          { dayOffset: 7, itemType: 'INVALID', title: 'x' },        // 유형 불량 — 제거
          { dayOffset: 7, itemType: 'VISIT', title: '  ' },         // 제목 없음 — 제거
        ],
      });
      const rows = mockPrisma.treatmentTemplateItem.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows[0].dayOffset).toBe(0);
      expect(rows[1].dayOffset).toBe(84);
    });
  });

  describe('changeStatus — ACTIVE 승격 게이트', () => {
    it('should block ACTIVE with unresolved coded items (유령 방지)', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl({
        items: [
          { itemType: 'LAB', title: 'HbA1c', refCodeId: null },   // 미해석
          { itemType: 'VISIT', title: '재진', refCodeId: null },  // 면제
        ],
      }));
      await expect(service.changeStatus('tpl-1', 'ACTIVE')).rejects.toThrow(/미해석 항목 1건/);
      expect(mockPrisma.treatmentScheduleTemplate.update).not.toHaveBeenCalled();
    });

    it('should block ACTIVE with no items', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl({ items: [] }));
      await expect(service.changeStatus('tpl-1', 'ACTIVE')).rejects.toThrow(/항목이 없는/);
    });

    it('should allow ACTIVE when all coded items resolved', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl({
        items: [
          { itemType: 'LAB', title: 'HbA1c', refCodeId: 'pc-1' },
          { itemType: 'EDUCATION', title: '식이 교육', refCodeId: null },
        ],
      }));
      mockPrisma.treatmentScheduleTemplate.findUniqueOrThrow.mockResolvedValue(tpl({ status: 'ACTIVE' }));
      const result = await service.changeStatus('tpl-1', 'ACTIVE');
      expect(result.status).toBe('ACTIVE');
    });

    it('should reject invalid transition', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl({ status: 'DEPRECATED' }));
      await expect(service.changeStatus('tpl-1', 'ACTIVE')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recommend — 약속처방 v2와 동일 규칙', () => {
    it('should weight primary and honor PRIMARY_ONLY/prefix', async () => {
      const template = (id: string) => ({ id, name: `t-${id}`, items: [] });
      mockPrisma.treatmentTemplateDiagnosis.findMany
        .mockResolvedValueOnce([
          { diagnosisCode: 'E11.9', matchType: 'EXACT', role: 'ANY', weight: 100, template: template('exact-tpl') },
          { diagnosisCode: 'I10', matchType: 'EXACT', role: 'PRIMARY_ONLY', weight: 100, template: template('primary-only-tpl') },
        ])
        .mockResolvedValueOnce([
          { diagnosisCode: 'E1', matchType: 'PREFIX', role: 'ANY', weight: 80, template: template('prefix-tpl') },
        ]);

      // E11.9 주상병 · I10 부상병 — PRIMARY_ONLY(I10)는 제외되어야 함
      const result = await service.recommend(['E11.9', 'I10'], 'E11.9');

      const ids = result.map(r => r.id);
      expect(ids).toContain('exact-tpl');
      expect(ids).toContain('prefix-tpl');
      expect(ids).not.toContain('primary-only-tpl');
      expect(result[0].id).toBe('exact-tpl'); // 주상병+EXACT 가중이 최상위
    });
  });

  describe('apply — P2 전개', () => {
    const activeTpl = () => tpl({
      status: 'ACTIVE', totalDays: 84,
      items: [
        { id: 'it-lab', dayOffset: 14, itemType: 'LAB', title: 'HbA1c', refCodeId: 'pc-1', isDefault: true, timeOfDay: null, repeatEvery: null, repeatCount: null, notes: null },
        { id: 'it-visit', dayOffset: 14, itemType: 'VISIT', title: '재진', refCodeId: null, isDefault: true, timeOfDay: '09:00', repeatEvery: 28, repeatCount: 3, notes: null },
        { id: 'it-edu', dayOffset: 0, itemType: 'EDUCATION', title: '교육', refCodeId: null, isDefault: false, timeOfDay: null, repeatEvery: null, repeatCount: null, notes: null },
      ],
    });

    it('should expand default items with repeats and link LAB to PreOrder draft', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(activeTpl());

      const result = await service.apply('tpl-1', { patientId: 'pat-1', anchorDate: '2026-07-15' }, 'doc-1');

      // 기본형만: LAB 1회 + VISIT 3회(반복) = 4건, 교육(isDefault=false)은 제외
      expect(result.itemsCreated).toBe(4);
      expect(result.linkedPreOrders).toBe(1); // LAB → PreOrder 초안
      expect(result.plannedOnly).toBe(3);     // VISIT 3회 — PLANNED
      expect(mockPreOrder.create).toHaveBeenCalledWith(expect.objectContaining({
        patientId: 'pat-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1',
        scheduledDate: '2026-07-28', // anchor(7/15)-KST 기준 +14일 — UTC slice 후 wall-clock 검증은 근사
      }));
      // VISIT 반복 전개: D+14, D+42, D+70
      const planned = mockPrisma.patientScheduleItem.create.mock.calls
        .map((c: any[]) => c[0].data).filter((d: any) => d.itemType === 'VISIT');
      expect(planned).toHaveLength(3);
    });

    it('should reject non-ACTIVE template', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl({ status: 'DRAFT', items: [{ id: 'x', dayOffset: 0, itemType: 'VISIT', title: 't', isDefault: true }] }));
      await expect(service.apply('tpl-1', { patientId: 'pat-1', anchorDate: '2026-07-15' }, 'doc-1'))
        .rejects.toThrow(/ACTIVE/);
    });

    it('should honor selectedItemIds (선택 항목만 전개)', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(activeTpl());
      const result = await service.apply('tpl-1', {
        patientId: 'pat-1', anchorDate: '2026-07-15', selectedItemIds: ['it-edu'],
      }, 'doc-1');
      expect(result.itemsCreated).toBe(1);
      expect(result.linkedPreOrders).toBe(0);
    });

    it('should fall back to PLANNED when PreOrder creation fails (비차단)', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(activeTpl());
      mockPreOrder.create.mockRejectedValue(new Error('boom'));
      const result = await service.apply('tpl-1', { patientId: 'pat-1', anchorDate: '2026-07-15', selectedItemIds: ['it-lab'] }, 'doc-1');
      expect(result.itemsCreated).toBe(1);
      expect(result.linkedPreOrders).toBe(0);
      expect(result.plannedOnly).toBe(1);
    });
  });

  describe('updateScheduleItem — P3 변경관리', () => {
    const baseItem = (over: Record<string, unknown> = {}) => ({
      id: 'psi-1', scheduleId: 'sched-1', plannedAt: new Date('2026-07-20T09:00:00Z'),
      itemType: 'VISIT', title: '재진', status: 'PLANNED', refType: null, refId: null, notes: null, ...over,
    });

    beforeEach(() => {
      mockPrisma.patientScheduleItem.findUnique = vi.fn();
      mockPrisma.patientScheduleItem.findMany = vi.fn().mockResolvedValue([]);
      mockPrisma.patientScheduleItem.update = vi.fn().mockResolvedValue({ id: 'psi-1' });
      mockPrisma.preOrder = {
        findUnique: vi.fn().mockResolvedValue({ status: 'PENDING' }),
        update: vi.fn().mockResolvedValue({}),
      };
    });

    it('should require reason for date change', async () => {
      mockPrisma.patientScheduleItem.findUnique.mockResolvedValue(baseItem());
      await expect(service.updateScheduleItem('psi-1', { plannedAt: '2026-07-27T09:00:00Z' }))
        .rejects.toThrow(/사유/);
    });

    it('should move item and sync linked pending PreOrder date', async () => {
      mockPrisma.patientScheduleItem.findUnique.mockResolvedValue(baseItem({ refType: 'PreOrder', refId: 'po-1' }));
      await service.updateScheduleItem('psi-1', { plannedAt: '2026-07-27T09:00:00Z', reason: '환자 요청' });
      expect(mockPrisma.preOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'po-1' }, data: expect.objectContaining({ scheduledDate: expect.any(Date) }) }),
      );
      expect(mockPrisma.patientScheduleItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedAt: expect.any(Date), notes: expect.stringContaining('[변경]') }) }),
      );
    });

    it('should NOT touch approved PreOrder (승인 이후는 도메인 SoT)', async () => {
      mockPrisma.patientScheduleItem.findUnique.mockResolvedValue(baseItem({ refType: 'PreOrder', refId: 'po-1' }));
      mockPrisma.preOrder.findUnique.mockResolvedValue({ status: 'APPROVED' });
      await service.updateScheduleItem('psi-1', { plannedAt: '2026-07-27T09:00:00Z', reason: 'r' });
      expect(mockPrisma.preOrder.update).not.toHaveBeenCalled();
    });

    it('should shift following items by same delta when requested', async () => {
      mockPrisma.patientScheduleItem.findUnique.mockResolvedValue(baseItem());
      mockPrisma.patientScheduleItem.findMany.mockResolvedValue([
        baseItem({ id: 'psi-2', plannedAt: new Date('2026-07-25T09:00:00Z') }),
        baseItem({ id: 'psi-3', plannedAt: new Date('2026-08-01T09:00:00Z') }),
      ]);
      const result = await service.updateScheduleItem('psi-1', {
        plannedAt: '2026-07-27T09:00:00Z', reason: '지연', shiftFollowing: true,
      });
      expect((result as { shiftedFollowing?: number }).shiftedFollowing).toBe(2);
      // psi-2: 7/25 + 7일 = 8/1
      const call2 = mockPrisma.patientScheduleItem.update.mock.calls.find((c: any[]) => c[0].where.id === 'psi-2');
      expect(call2[0].data.plannedAt.toISOString()).toContain('2026-08-01');
    });

    it('should cancel item and cascade-cancel pending PreOrder', async () => {
      mockPrisma.patientScheduleItem.findUnique.mockResolvedValue(baseItem({ refType: 'PreOrder', refId: 'po-1' }));
      await service.updateScheduleItem('psi-1', { cancel: true, reason: '치료 중단' });
      expect(mockPrisma.preOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
      expect(mockPrisma.patientScheduleItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
    });
  });

  describe('expandOccurrences', () => {
    it('should cap repeats at totalDays', () => {
      expect(service.expandOccurrences({ dayOffset: 14, repeatEvery: 28, repeatCount: 5 }, 84))
        .toEqual([14, 42, 70]); // 98, 126은 84 초과로 제외
    });
    it('should return single occurrence without repeat', () => {
      expect(service.expandOccurrences({ dayOffset: 7 }, 84)).toEqual([7]);
    });
  });

  describe('replaceDiagnoses', () => {
    it('should normalize and dedupe', async () => {
      mockPrisma.treatmentScheduleTemplate.findUnique.mockResolvedValue(tpl());
      await service.replaceDiagnoses('tpl-1', [
        { diagnosisCode: ' E11 ', matchType: 'PREFIX', role: 'PRIMARY_ONLY', weight: 9999 },
        { diagnosisCode: 'E11' },
        { diagnosisCode: '' },
      ]);
      expect(mockPrisma.treatmentTemplateDiagnosis.createMany).toHaveBeenCalledWith({
        data: [{ templateId: 'tpl-1', diagnosisCode: 'E11', matchType: 'PREFIX', role: 'PRIMARY_ONLY', weight: 1000 }],
      });
    });
  });
});
