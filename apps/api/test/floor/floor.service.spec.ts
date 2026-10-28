import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FloorService } from '../../src/modules/floor/floor.service';

describe('FloorService', () => {
  let service: FloorService;
  let p: any;

  beforeEach(() => {
    p = {
      spaceNode: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'sn-1', code: '1f', name: '1층', floor: 1, metadata: {}, updatedAt: new Date() }),
      },
      patientLocation: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    };
    service = new FloorService(p);
  });

  it('getFloorPlans', async () => { await service.getFloorPlans(); expect(p.spaceNode.findMany).toHaveBeenCalled(); });
  it('getFloorPlan', async () => { await service.getFloorPlan('1f'); expect(p.spaceNode.findFirst).toHaveBeenCalled(); });
  it('getZones', async () => { await service.getZones('1f'); expect(p.spaceNode.findFirst).toHaveBeenCalled(); });
});
