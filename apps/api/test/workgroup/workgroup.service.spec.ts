import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkgroupService } from '../../src/modules/workgroup/workgroup.service';

describe('WorkgroupService', () => {
  let service: WorkgroupService;
  let p: any;

  beforeEach(() => {
    p = {
      user: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '의사', department: '내과' }), findFirst: vi.fn().mockResolvedValue({ id: 'u-1' }) },
      appointment: { findMany: vi.fn().mockResolvedValue([]) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]) },
      ward: { findFirst: vi.fn().mockResolvedValue(null) },
      bed: { findMany: vi.fn().mockResolvedValue([]) },
      waitingQueue: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'wq-1' }) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
      claim: { findMany: vi.fn().mockResolvedValue([]) },
      dutyEntry: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), deleteMany: vi.fn() },
      clinicalHandoff: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'ch-1' }) },
      patient: { findFirst: vi.fn().mockResolvedValue({ id: 'p-1' }) },
      fallRiskAssessment: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      nursingAssessment: { findFirst: vi.fn().mockResolvedValue(null) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
      systemConfig: { create: vi.fn().mockResolvedValue({ id: 'sc-1' }) },
      safetyIncident: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      staff: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new WorkgroupService(p, {
      autoGenerate: vi.fn().mockResolvedValue({ month: '2026-07', department: '전체', constraints: {}, totalDays: 31, generated: 93, staffCount: 5, summary: [{ staffId: 'u-1', staffName: '김간호', role: 'nurse', department: '내과', totalShifts: 10, dayShifts: 4, eveningShifts: 3, nightShifts: 3 }] }),
      requestSwap: vi.fn().mockResolvedValue({ data: { id: 'swap-1', requesterName: '김간호', targetName: '이간호' }, message: 'ok' }),
    } as any);
  });

  it('getDoctorSchedule', async () => { await service.getDoctorSchedule('doc-1'); expect(p.appointment.findMany).toHaveBeenCalled(); });
  it('getSurgerySchedule', async () => { await service.getSurgerySchedule(); expect(p.surgery.findMany).toHaveBeenCalled(); });
  it('getReceptionStatus', async () => { const r = await service.getReceptionStatus(); expect(r).toBeDefined(); });
  it('submitHandoff', async () => { await service.submitHandoff({ wardId: 'w-1', shift: 'day', handoffTime: new Date().toISOString(), fromNurseId: 'n-1', toNurseId: 'n-2', patients: [] }); });
  it('getHandoffHistory', async () => { await service.getHandoffHistory(); expect(p.clinicalHandoff.findMany).toHaveBeenCalled(); });

  // ── 모델 이원화 통합(2026-07-22) — 당직 EP는 정본 DutyEntry 기반·응답 형태 불변 ──
  it('getDutySchedule — DutyEntry 기반 조회·구 응답 형태(shifts[].staff[]) 유지', async () => {
    p.dutyEntry.findMany.mockResolvedValue([
      { id: 'de-1', staffId: 'u-1', staffName: '김간호', role: 'nurse', department: '내과', date: new Date(Date.UTC(2026, 6, 15)), shift: 'NIGHT' },
    ]);
    const r: any = await service.getDutySchedule('2026-07');
    expect(p.dutyEntry.findMany).toHaveBeenCalled();
    expect(r.schedules[0].shifts[0]).toEqual({ shift: 'night', staff: [{ id: 'u-1', name: '김간호', role: 'nurse', department: '내과' }] });
  });

  it('autoAssignDuty — 강한 편성 엔진 위임·요약 응답 형태 유지', async () => {
    const r: any = await service.autoAssignDuty('2026-07');
    expect(r.totalAssignments).toBe(93);
    expect(r.summary[0]).toEqual(expect.objectContaining({ name: '김간호', totalShifts: 10 }));
    expect(p.dutyEntry.deleteMany).not.toHaveBeenCalled(); // 직접 조작 없음 — 위임만
  });

  it('requestDutySwap — 정본 DutySwapRequest 위임(SystemConfig 임시구현 제거)', async () => {
    const r: any = await service.requestDutySwap({ requesterId: 'u-1', targetId: 'u-2', originalDate: '2026-07-15', originalShift: 'NIGHT', swapDate: '2026-07-16', swapShift: 'DAY', reason: 't' });
    expect(r).toEqual({ requestId: 'swap-1', status: 'pending_approval', requester: '김간호', target: '이간호' });
    expect(p.systemConfig.create).not.toHaveBeenCalled();
  });
});
