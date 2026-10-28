import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { NursingNoteService } from '../../src/modules/nursing-note/nursing-note.service';

/**
 * 🔴 이 스펙은 종전에 `contextType:'INPATIENT'` 을 표본으로 써서, **정본 우회 자체를 정상 동작으로
 *    고정**하고 있었다. 입원 간호기록의 정본은 `NursingNote` 다 — 표본을 정본 경계 안(EMERGENCY)으로 옮긴다.
 *    경계 자체의 가드는 `nursing-note-canon.guard.spec.ts`.
 */
describe('NursingNoteService', () => {
  let service: NursingNoteService;
  let mockPrisma: any;

  const mockNote = {
    id: 'nn-1', patientId: 'p-1', nurseId: 'n-1', contextType: 'EMERGENCY',
    situation: '체온 38.5도', assessment: '감염 의심',
    background: null, recommendation: null, content: null,
  };

  beforeEach(() => {
    mockPrisma = {
      universalNursingNote: {
        create: vi.fn().mockResolvedValue(mockNote),
        findMany: vi.fn().mockResolvedValue([mockNote]),
        findUnique: vi.fn().mockResolvedValue(mockNote),
        update: vi.fn().mockResolvedValue({ ...mockNote, situation: '체온 정상화' }),
        groupBy: vi.fn().mockResolvedValue([{ contextType: 'EMERGENCY', _count: { id: 10 } }]),
      },
      // 간호기록 정본은 둘로 갈린다 — 통계는 입원 정본(NursingNote)도 센다
      nursingNote: { count: vi.fn().mockResolvedValue(0) },
    };
    service = new NursingNoteService(mockPrisma);
  });

  describe('create', () => {
    it('간호기록 생성 (SBAR)', async () => {
      const result = await service.create({
        patientId: 'p-1', contextType: 'EMERGENCY', contextId: 'ev-1',
        situation: '체온 38.5도', background: '수술 후 2일차',
        assessment: '감염 의심', recommendation: '혈액배양 검사',
      } as any, 'n-1');
      expect(result.situation).toBe('체온 38.5도');
      expect(mockPrisma.universalNursingNote.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ nurseId: 'n-1', recordedAt: expect.any(Date) }),
      }));
    });
  });

  describe('findAll', () => {
    it('필터링 조회', async () => {
      await service.findAll({ contextType: 'EMERGENCY', patientId: 'p-1' });
      expect(mockPrisma.universalNursingNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { contextType: 'EMERGENCY', patientId: 'p-1' },
      }));
    });
  });

  describe('findById', () => {
    it('단건 조회', async () => {
      const result = await service.findById('nn-1');
      expect(result.id).toBe('nn-1');
    });

    it('존재하지 않으면 NotFoundException', async () => {
      mockPrisma.universalNursingNote.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('부분 수정', async () => {
      await service.update('nn-1', { situation: '체온 정상화' } as any);
      expect(mockPrisma.universalNursingNote.update).toHaveBeenCalled();
    });
  });

  describe('findByContext', () => {
    it('컨텍스트별 조회', async () => {
      await service.findByContext('EMERGENCY', 'ev-1');
      expect(mockPrisma.universalNursingNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { contextType: 'EMERGENCY', contextId: 'ev-1' },
      }));
    });
  });

  describe('getStats', () => {
    it('오늘 통계', async () => {
      const result = await service.getStats();
      expect(result[0].contextType).toBe('EMERGENCY');
      expect(result[0].count).toBe(10);
    });

    it('간호사별 통계', async () => {
      await service.getStats('n-1');
      expect(mockPrisma.universalNursingNote.groupBy).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ nurseId: 'n-1' }),
      }));
    });
  });
});
