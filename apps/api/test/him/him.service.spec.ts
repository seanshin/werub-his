import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HimService } from '../../src/modules/him/him.service';

describe('HIM 미비기록 (R3-2)', () => {
  let service: HimService;
  let mockPrisma: any;
  let mockNoti: any;

  const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

  beforeEach(() => {
    mockPrisma = {
      admission: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'adm-1', dischargeDate: daysAgo(10), attendingDoctorId: null,
          patient: { mrn: 'P1', familyName: '김', givenName: '환자' },
          dischargeSummaryDoc: null,
          chargeOfCare: [{ doctorId: 'dr-1', doctor: { familyName: '이', givenName: '의사' } }],
        }]),
      },
      // 🔴 encounter.findMany 는 **두 번** 불린다: ①DRAFT 미서명 ②서명했는데 상병 없음.
      //    한 번만 목하면 두 블록이 같은 행을 집어 집계가 뒤틀린다.
      encounter: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{
            id: 'enc-1', createdAt: daysAgo(5), doctorId: 'dr-1',
            patient: { mrn: 'P2', familyName: '박', givenName: '외래' },
            doctor: { familyName: '이', givenName: '의사', role: 'DOCTOR', isActive: true },
          }])
          .mockResolvedValueOnce([{
            id: 'enc-dx', createdAt: daysAgo(20), signedAt: daysAgo(9), doctorId: 'dr-2',
            patient: { mrn: 'P4', familyName: '정', givenName: '서명' },
            doctor: { familyName: '한', givenName: '의사' },
          }]),
      },
      nursingNote: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'note-1', recordedAt: daysAgo(0), nurseId: 'n-1',
          nurse: { familyName: '윤', givenName: '간호' },
          admission: { patient: { mrn: 'P3', familyName: '최', givenName: '재원' } },
        }]),
      },
    };
    mockNoti = { create: vi.fn().mockResolvedValue({}), pushNotification: vi.fn().mockResolvedValue({}) };
    service = new HimService(mockPrisma, { get: vi.fn().mockResolvedValue(null) } as any, mockNoti);
  });

  it('3종 미비 집계 + 기한 초과 계산(퇴원요약 10일 경과·기한 7일 → overdue 3)', async () => {
    const r = await service.getDeficiencies();
    expect(r.counts.total).toBe(4);
    expect(r.counts.byType).toEqual({ DISCHARGE_SUMMARY: 1, UNSIGNED_ENCOUNTER: 1, UNSIGNED_NURSING_NOTE: 1, MISSING_DIAGNOSIS: 1 });
    const summary = r.items.find((i) => i.type === 'DISCHARGE_SUMMARY')!;
    expect(summary.overdueDays).toBe(3);
    expect(summary.responsibleId).toBe('dr-1'); // ChargeOfCare 폴백
    expect(summary.detail).toBe('퇴원요약 미작성');
  });

  it('overdue 필터 — 기한 내(당일 간호기록)는 제외', async () => {
    const r = await service.getDeficiencies(true);
    expect(r.items.find((i) => i.type === 'UNSIGNED_NURSING_NOTE')).toBeUndefined();
    expect(r.counts.total).toBe(3); // 요약(+3)·진료기록(+2)·상병미입력(서명 9일 전-기한3=+6)
  });

  it('DRAFT 요약은 미서명으로 표기', async () => {
    mockPrisma.admission.findMany.mockResolvedValue([{
      id: 'adm-2', dischargeDate: daysAgo(8), attendingDoctorId: 'dr-9',
      patient: { mrn: 'P1', familyName: '김', givenName: '환자' },
      dischargeSummaryDoc: { status: 'DRAFT' },
      chargeOfCare: [],
    }]);
    const r = await service.getDeficiencies();
    const summary = r.items.find((i) => i.type === 'DISCHARGE_SUMMARY')!;
    expect(summary.detail).toBe('퇴원요약 미서명(DRAFT)');
    expect(summary.responsibleId).toBe('dr-9'); // attendingDoctorId 우선
  });

  it('remind — 기한 초과 책임자별 1건 묶음 알림', async () => {
    const r = await service.remind();
    expect(r.notified).toBe(2); // dr-1(요약+진료기록) · dr-2(상병 미입력) → 책임자별 1회
    expect(mockNoti.create).toHaveBeenCalledTimes(2);
    expect(mockNoti.create).toHaveBeenCalledWith('dr-1', expect.objectContaining({
      type: 'HIM_DEFICIENCY',
      title: expect.stringContaining('2건'),
    }));
  });

  it('🔴 서명은 끝났는데 상병이 없는 건을 담당의에게 보여준다 — 청구 삭감 위험', async () => {
    const r = await service.getDeficiencies();
    const dx = r.items.find((i) => i.type === 'MISSING_DIAGNOSIS')!;
    expect(dx).toBeTruthy();
    expect(dx.refId).toBe('enc-dx');
    expect(dx.responsibleId).toBe('dr-2'); // 서명한 담당의가 채워야 한다
    expect(dx.detail).toContain('상병');
    expect(dx.overdueDays).toBe(6); // 기한은 **서명 시점**부터(9일 전 서명·기한 3)
  });

  it('config 기한 오버라이드', async () => {
    service = new HimService(mockPrisma, { get: vi.fn(async (k: string) => (k === 'him.summaryDueDays' ? 14 : null)) } as any, mockNoti);
    const r = await service.getDeficiencies();
    const summary = r.items.find((i) => i.type === 'DISCHARGE_SUMMARY')!;
    expect(summary.overdueDays).toBe(-4); // 10일 경과·기한 14 → 미초과
  });
});
