import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandCenterService } from '../../src/modules/command-center/command-center.service';

describe('CommandCenterService', () => {
  let service: CommandCenterService;
  let boards: Record<string, { getBoard?: ReturnType<typeof vi.fn>; getStationBoard?: ReturnType<typeof vi.fn> }>;

  const summaryOf = (o: Record<string, unknown>) => ({ summary: o });

  beforeEach(() => {
    boards = {
      nursing: { getStationBoard: vi.fn().mockResolvedValue(summaryOf({ total: 12, medsOverdue: 2, unsignedNotes: 1, highRisk: 3 })) },
      emergency: { getBoard: vi.fn().mockResolvedValue(summaryOf({ active: 5, boarding: 1, longStay: 0, pendingTriage: 2 })) },
      bed: { getBoard: vi.fn().mockResolvedValue(summaryOf({ occupancyRate: 92, available: 4, admitToday: 3, dischargeToday: 2 })) },
      pharmacy: { getBoard: vi.fn().mockResolvedValue(summaryOf({ pending: 7, verifyWait: 2, dispensedToday: 30, lowStockCount: 1 })) },
      receptionBilling: { getBoard: vi.fn().mockResolvedValue(summaryOf({ waiting: 9, eligUnchecked: 3, docPending: 1, outstandingCount: 5 })) },
      diagnostics: { getBoard: vi.fn().mockResolvedValue(summaryOf({ criticalPending: 1, labPending: 8, imagingUnread: 2, criticalOverdue: 1 })) },
      safetyQuality: { getBoard: vi.fn().mockResolvedValue(summaryOf({ incidentsOpen: 2, incidents30d: 4, qiRate: 88, infectionsActive: 0 })) },
    };
    service = new CommandCenterService(
      boards.nursing as never, boards.emergency as never, boards.bed as never,
      boards.pharmacy as never, boards.receptionBilling as never,
      boards.diagnostics as never, boards.safetyQuality as never,
    );
  });

  it('should aggregate all sections for ADMIN with KPI rollup', async () => {
    const r = await service.getSummary('ADMIN');
    expect(Object.keys(r.sections)).toHaveLength(7);
    expect(r.kpi.census).toBe(12);
    expect(r.kpi.erActive).toBe(5);
    expect(r.kpi.criticalPending).toBe(1);
    expect(r.kpi.bedAlert).toBe(1); // 92% >= 90 임계
    // 2+1 + 2+1 + 1(bed) + 2+1 + 3 + 1+1 + 2 = 17
    expect(r.kpi.alertsTotal).toBe(17);
  });

  it('should filter sections by role (NURSE는 pharmacy 미포함 — 개별 EP 게이팅과 동일)', async () => {
    const r = await service.getSummary('NURSE');
    expect(r.sections.pharmacy).toBeUndefined();
    expect(r.sections.nursing?.ok).toBe(true);
    expect(boards.pharmacy.getBoard).not.toHaveBeenCalled();
  });

  it('should tolerate partial failure (한 보드 장애가 전체를 죽이지 않음)', async () => {
    boards.emergency.getBoard!.mockRejectedValue(new Error('er down'));
    const r = await service.getSummary('ADMIN');
    expect(r.sections.emergency).toEqual({ ok: false, error: 'er down' });
    expect(r.sections.nursing?.ok).toBe(true);
    // 🔴 실패 섹션은 0 이 아니라 null — '응급 재실 0명'과 '응급 보드가 죽음'은 다른 사실이다
    expect(r.kpi.erActive).toBeNull();
    // 합계는 남은 것으로 계속 내되, 빠진 섹션을 밝힌다(부분 집계)
    expect(r.kpi.alertsUnavailable).toContain('emergency');
  });

  it('전 섹션 정상이면 alertsUnavailable 은 빈 배열 — 성공을 실패로 말하지 않는다', async () => {
    const r = await service.getSummary('ADMIN');
    expect(r.kpi.alertsUnavailable).toEqual([]);
    expect(r.kpi.census).not.toBeNull();
  });

  it('권한으로 제외된 섹션은 조회 실패가 아니다 — 부분 집계로 경보하지 않는다', async () => {
    const r = await service.getSummary('PHARMACIST');
    expect(r.kpi.alertsUnavailable).toEqual([]);
  });

  it('should not raise bedAlert below threshold', async () => {
    boards.bed.getBoard!.mockResolvedValue(summaryOf({ occupancyRate: 75, available: 20, admitToday: 1, dischargeToday: 1 }));
    const r = await service.getSummary('ADMIN');
    expect(r.kpi.bedAlert).toBe(0);
  });
});
