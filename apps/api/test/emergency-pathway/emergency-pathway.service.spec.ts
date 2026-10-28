import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EmergencyPathwayService } from '../../src/modules/emergency-pathway/emergency-pathway.service';

describe('EmergencyPathwayService', () => {
  let service: EmergencyPathwayService;
  let mockPrisma: any;
  let events: { emit: ReturnType<typeof vi.fn> };
  let journey: { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = {
      emergencyGoldenPathway: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'gp-1' }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'gp-1', ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      patient: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));
    events = { emit: vi.fn() };
    journey = { emit: vi.fn() };
    service = new EmergencyPathwayService(mockPrisma, events as any, journey as any);
  });

  describe('activate', () => {
    it('활성화 시 통지·여정 이벤트 발행', async () => {
      await service.activate({ patientId: 'p-1', pathwayType: 'STEMI' }, 'doc-1');
      expect(events.emit).toHaveBeenCalledWith('goldenpathway.activated', expect.objectContaining({ patientId: 'p-1', pathwayType: 'STEMI' }));
      expect(journey.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'GOLDEN_PATHWAY_ACTIVATED' }));
    });

    it('유효하지 않은 프로토콜 거부', async () => {
      await expect(service.activate({ patientId: 'p-1', pathwayType: 'XXX' }, 'doc-1')).rejects.toThrow(BadRequestException);
    });

    it('이미 활성 프로토콜이면 거부', async () => {
      mockPrisma.emergencyGoldenPathway.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.activate({ patientId: 'p-1', pathwayType: 'STEMI' }, 'doc-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeMilestone', () => {
    it('[P2] 미정의 마일스톤 키 거부', async () => {
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({ id: 'gp-1', status: 'ACTIVE', milestones: [{ key: 'ekg', label: 'x', targetMin: 10, doneAt: null, doneBy: null }] });
      await expect(service.completeMilestone('gp-1', 'nope', 'u-1')).rejects.toMatchObject({ response: { code: 'MILESTONE_UNKNOWN' } });
    });

    it('정의된 키는 doneAt 기록', async () => {
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({ id: 'gp-1', status: 'ACTIVE', milestones: [{ key: 'ekg', label: 'x', targetMin: 10, doneAt: null, doneBy: null }] });
      await service.completeMilestone('gp-1', 'ekg', 'u-1');
      const arg = mockPrisma.emergencyGoldenPathway.update.mock.calls[0][0];
      expect(arg.data.milestones[0].doneAt).toBeTruthy();
    });
  });

  describe('complete', () => {
    it('[P2] 비활성 프로토콜 완료 거부', async () => {
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({ id: 'gp-1', status: 'CANCELLED' });
      await expect(service.complete('gp-1')).rejects.toThrow(BadRequestException);
    });

    it('[P2] 핵심지표는 primary 마일스톤 doneAt 기준(벽시계 아님)', async () => {
      const activatedAt = new Date('2026-07-01T00:00:00Z');
      const balloonAt = new Date('2026-07-01T00:40:00Z'); // 40분 후 재관류
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({
        id: 'gp-1', status: 'ACTIVE', pathwayType: 'STEMI', activatedAt,
        milestones: [{ key: 'balloon', label: 'PCI', targetMin: 90, doneAt: balloonAt.toISOString(), doneBy: 'd' }],
      });
      await service.complete('gp-1');
      expect(mockPrisma.emergencyGoldenPathway.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'gp-1', status: 'ACTIVE' }, data: expect.objectContaining({ primaryMetricMinutes: 40 }) }),
      );
    });

    it('[P1] primary 마일스톤 미완료 시 지표=null(now() 폴백 가짜수치 금지)', async () => {
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({
        id: 'gp-1', status: 'ACTIVE', pathwayType: 'STEMI', activatedAt: new Date('2026-07-01T00:00:00Z'),
        milestones: [{ key: 'balloon', label: 'PCI', targetMin: 90, doneAt: null, doneBy: null }],
      });
      await service.complete('gp-1');
      expect(mockPrisma.emergencyGoldenPathway.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ primaryMetricMinutes: null }) }),
      );
    });

    it('[P2] 동시 종료(원자 전이 count=0) 충돌 차단', async () => {
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({ id: 'gp-1', status: 'ACTIVE', pathwayType: 'STEMI', activatedAt: new Date(), milestones: [] });
      mockPrisma.emergencyGoldenPathway.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.complete('gp-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('[P2] 비활성 프로토콜 취소 거부', async () => {
      mockPrisma.emergencyGoldenPathway.findUnique.mockResolvedValue({ id: 'gp-1', status: 'COMPLETED' });
      await expect(service.cancel('gp-1')).rejects.toThrow(BadRequestException);
    });
  });
});
