import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DoctorsService } from '../../src/modules/doctors/doctors.service';

describe('DoctorsService', () => {
  let service: DoctorsService;
  let p: any;

  beforeEach(() => {
    p = {
      chargeOfCare: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'doc-1', familyName: '김', givenName: '의사', department: '내과', specialty: '일반내과' }) },
      flowSheetEntry: { findMany: vi.fn().mockResolvedValue([]) },
      round: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'r-1' }) },
      // 확인은 결과가 있는(COMPLETED) 오더만 — findUnique 는 서비스가 select 하는 실제 필드 모양
      order: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'o-1', status: 'COMPLETED', cancelledAt: null, acknowledgedAt: null, acknowledgedBy: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      nursingNote: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      prescription: { groupBy: vi.fn().mockResolvedValue([]) },
      encounter: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new DoctorsService(p);
  });

  it('getMyCensus', async () => { await service.getMyCensus('doc-1'); expect(p.chargeOfCare.findMany).toHaveBeenCalled(); });
  it('getMyRoundsToday', async () => { await service.getMyRoundsToday('doc-1'); expect(p.chargeOfCare.findMany).toHaveBeenCalled(); });
  it('acknowledgeOrder', async () => { await service.acknowledgeOrder('o-1', 'doc-1'); expect(p.order.updateMany).toHaveBeenCalled(); });
});
