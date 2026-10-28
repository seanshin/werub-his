import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaverseService } from '../../src/modules/metaverse/metaverse.service';

describe('MetaverseService', () => {
  let service: MetaverseService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      spaceNode: { findMany: vi.fn() },
      patientLocation: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn(async () => 0) },
      patient: { findMany: vi.fn() },
      // 현재 위치 정본 판정(2026-10-03) — 재원·응급 진행 중 환자
      admission: { findMany: vi.fn(async () => []) },
      emergencyVisit: { findMany: vi.fn(async () => []) },
    };
    service = new MetaverseService(prisma);
  });

  describe('getStructure', () => {
    it('should group zones by floor', async () => {
      prisma.spaceNode.findMany.mockResolvedValue([
        { id: 'z1', name: '로비', floor: 1, spaceType: 'LOBBY', isActive: true },
        { id: 'z2', name: '접수', floor: 1, spaceType: 'RECEPTION', isActive: true },
        { id: 'z3', name: '내과', floor: 2, spaceType: 'CLINIC', isActive: true },
      ]);

      const result = await service.getStructure();
      expect(result.hospitalName).toBe('Hospital RUN');
      expect(result.totalZones).toBe(3);
      expect(result.floors).toHaveLength(2);
      expect(result.floors[0].zones).toHaveLength(2);
    });

    it('should return empty when no zones', async () => {
      prisma.spaceNode.findMany.mockResolvedValue([]);
      const result = await service.getStructure();
      expect(result.totalZones).toBe(0);
      expect(result.floors).toHaveLength(0);
    });
  });

  describe('getPatientLocations', () => {
    it('should return current patient locations with names', async () => {
      prisma.patientLocation.findMany.mockResolvedValue([
        { id: 'l1', patientId: 'p1', zoneId: 'z1', status: 'WAITING', enteredAt: new Date() },
      ]);
      prisma.patient.findMany.mockResolvedValue([
        { id: 'p1', mrn: '001', familyName: '김', givenName: '환자' },
      ]);
      prisma.spaceNode.findMany.mockResolvedValue([
        { id: 'z1', name: '로비', floor: 1, spaceType: 'LOBBY', department: null },
      ]);

      const { items: result } = await service.getPatientLocations();
      expect(result).toHaveLength(1);
      expect(result[0].patientName).toBe('김환자');
      expect(result[0].zoneName).toBe('로비');
    });

    it('should filter by floor', async () => {
      prisma.patientLocation.findMany.mockResolvedValue([
        { id: 'l1', patientId: 'p1', zoneId: 'z1', status: 'WAITING', enteredAt: new Date() },
        { id: 'l2', patientId: 'p2', zoneId: 'z2', status: 'IN_CONSULTATION', enteredAt: new Date() },
      ]);
      prisma.patient.findMany.mockResolvedValue([
        { id: 'p1', mrn: '001', familyName: '김', givenName: '일' },
        { id: 'p2', mrn: '002', familyName: '이', givenName: '이' },
      ]);
      prisma.spaceNode.findMany.mockResolvedValue([
        { id: 'z1', name: '로비', floor: 1, spaceType: 'LOBBY' },
        { id: 'z2', name: '내과', floor: 2, spaceType: 'CLINIC' },
      ]);

      const { items: result } = await service.getPatientLocations(2);
      expect(result).toHaveLength(1);
      expect(result[0].floor).toBe(2);
    });
  });

  describe('getHeatmap', () => {
    it('should calculate occupancy correctly', async () => {
      // 실제 모양: 열린 위치 행(구역 해상도만 조회) — 출처가 섞여 있다
      const rows = [
        ...Array.from({ length: 7 }, (_, i) => ({ zoneId: 'z1', source: i < 2 ? 'OBSERVED_QR' : 'INFERRED_EVENT' })),
        { zoneId: 'z2', source: 'OBSERVED_STATION' }, { zoneId: 'z2', source: 'SIMULATED' },
        { zoneId: 'z3', source: 'INFERRED_EVENT' },
      ];
      prisma.patientLocation.findMany.mockResolvedValue(rows);
      prisma.spaceNode.findMany.mockResolvedValue([
        { id: 'z1', name: '대기실', floor: 1, spaceType: 'WAITING', capacity: 10 },
        { id: 'z2', name: '진료실', floor: 2, spaceType: 'CLINIC', capacity: 3 },
        { id: 'z3', name: '정원 미설정실', floor: 2, spaceType: 'LAB', capacity: null },
      ]);

      const result = await service.getHeatmap();
      expect(prisma.patientLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ granularity: 'ZONE' }) }));
      expect(result).toHaveLength(3);
      expect(result.find(r => r.zoneId === 'z1')?.observedCount).toBe(2);
      // 🔴 정원 미설정은 산출 불가 — 종전엔 10 을 지어냈다
      const z3 = result.find(r => r.zoneId === 'z3');
      expect(z3).toMatchObject({ capacity: null, occupancy: null, level: 'UNKNOWN', currentCount: 1 });
      // z1: 7/10 = 70% → HIGH
      const z1 = result.find(r => r.zoneId === 'z1');
      expect(z1?.occupancy).toBe(70);
      expect(z1?.level).toBe('HIGH');
      // z2: 2/3 = 67% → MEDIUM
      const z2 = result.find(r => r.zoneId === 'z2');
      expect(z2?.occupancy).toBe(67);
      expect(z2?.level).toBe('MEDIUM');
    });
  });

  describe('getPatientTrail', () => {
    it('should return ordered trail', async () => {
      const t1 = new Date('2026-06-01T09:00:00Z');
      const t2 = new Date('2026-06-01T09:30:00Z');
      prisma.patientLocation.findMany.mockResolvedValue([
        { id: 'l1', zoneId: 'z1', status: 'WAITING', enteredAt: t1, leftAt: t2, duration: 30, eventType: 'CHECKIN' },
        { id: 'l2', zoneId: 'z2', status: 'IN_CONSULTATION', enteredAt: t2, leftAt: null, duration: null, eventType: 'ENCOUNTER' },
      ]);
      prisma.spaceNode.findMany.mockResolvedValue([
        { id: 'z1', name: '접수', floor: 1, spaceType: 'RECEPTION' },
        { id: 'z2', name: '내과', floor: 2, spaceType: 'CLINIC' },
      ]);

      const result = await service.getPatientTrail('p1');
      expect(result).toHaveLength(2);
      expect(result[0].zoneName).toBe('접수');
      expect(result[1].zoneName).toBe('내과');
    });
  });

  describe('getFloorStats', () => {
    it('should aggregate by floor', async () => {
      prisma.patientLocation.groupBy.mockResolvedValue([
        { zoneId: 'z1', _count: { id: 5 } },
        { zoneId: 'z2', _count: { id: 3 } },
      ]);
      prisma.spaceNode.findMany.mockResolvedValue([
        { id: 'z1', floor: 1, spaceType: 'WAITING' },
        { id: 'z2', floor: 1, spaceType: 'CLINIC' },
      ]);

      const result = await service.getFloorStats();
      expect(result).toHaveLength(1);
      expect(result[0].floor).toBe(1);
      expect(result[0].total).toBe(8);
      expect(result[0].byType['WAITING']).toBe(5);
      expect(result[0].byType['CLINIC']).toBe(3);
    });
  });
});
