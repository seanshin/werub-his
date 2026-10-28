import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientScheduleService } from '../../src/modules/patient-schedule/patient-schedule.service';

describe('PatientScheduleService', () => {
  let service: PatientScheduleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      appointment: { findMany: vi.fn().mockResolvedValue([]) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
      preOrder: { findMany: vi.fn().mockResolvedValue([]) },
      pathwayAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      patientScheduleItem: { findMany: vi.fn().mockResolvedValue([]) }, // PLAN 소스(P2)
    };
    service = new PatientScheduleService(mockPrisma);
  });

  it('should merge sources and sort by time', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([
      { id: 'a1', scheduledAt: new Date('2026-07-20T10:00:00Z'), status: 'SCHEDULED', type: 'FOLLOW_UP', duration: 30, doctor: { familyName: '김', givenName: '의사', department: '내과' } },
    ]);
    mockPrisma.surgery.findMany.mockResolvedValue([
      { id: 's1', scheduledAt: new Date('2026-07-18T09:00:00Z'), procedureName: '충수절제술', status: 'SCHEDULED' },
    ]);

    const result = await service.getSchedule('pat-1', {});

    expect(result.items).toHaveLength(2);
    expect(result.items[0].source).toBe('SURGERY'); // 시간순 — 수술이 먼저
    expect(result.items[1].title).toContain('김의사');
    expect(result.counts).toEqual({ SURGERY: 1, APPOINTMENT: 1 });
  });

  it('should aggregate MAR per day (건수·시행·예정)', async () => {
    mockPrisma.medicationAdministration.findMany.mockResolvedValue([
      { scheduledAt: new Date('2026-07-15T08:00:00Z'), status: 'ADMINISTERED' },
      { scheduledAt: new Date('2026-07-15T13:00:00Z'), status: 'SCHEDULED' },
      { scheduledAt: new Date('2026-07-15T18:00:00Z'), status: 'SCHEDULED' },
      { scheduledAt: new Date('2026-07-16T08:00:00Z'), status: 'SCHEDULED' },
    ]);

    const result = await service.getSchedule('pat-1', { sources: ['MEDICATION'] });

    expect(result.items).toHaveLength(2); // 2일로 집계
    expect(result.items[0].title).toBe('투약 3건 · 시행 1 · 예정 2');
    expect(result.items[1].title).toBe('투약 1건 · 예정 1');
  });

  it('should expand pathway milestones from startDate + day offset and mark outcomes', async () => {
    mockPrisma.pathwayAssignment.findMany.mockResolvedValue([
      {
        startDate: new Date('2026-07-14T00:00:00Z'),
        outcomes: [{ milestoneId: 'm1' }],
        pathway: {
          name: '슬관절치환 경로',
          milestones: [
            { id: 'm1', day: 0, title: '수술 전 평가', category: 'ASSESSMENT' },
            { id: 'm2', day: 2, title: '보행 훈련', category: 'REHAB' },
          ],
        },
      },
    ]);

    const result = await service.getSchedule('pat-1', {
      sources: ['PATHWAY'],
      from: new Date('2026-07-13'),
      to: new Date('2026-07-20'),
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].status).toBe('COMPLETED'); // outcome 존재
    expect(result.items[1].status).toBe('PLANNED');
    expect(result.items[1].title).toBe('[슬관절치환 경로] 보행 훈련');
  });

  it('should respect sources filter (미지정 소스는 조회하지 않음)', async () => {
    await service.getSchedule('pat-1', { sources: ['APPOINTMENT'] });
    expect(mockPrisma.appointment.findMany).toHaveBeenCalled();
    expect(mockPrisma.surgery.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.medicationAdministration.findMany).not.toHaveBeenCalled();
  });
});

describe('PatientScheduleService.getPortalSchedule (P3 포털 노출)', () => {
  let service: PatientScheduleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      appointment: { findMany: vi.fn().mockResolvedValue([]) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
      preOrder: { findMany: vi.fn().mockResolvedValue([]) },
      pathwayAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      patientScheduleItem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new PatientScheduleService(mockPrisma);
  });

  it('should hide internal plan item types (NURSING/ASSESSMENT) and keep patient-visible ones', async () => {
    mockPrisma.patientScheduleItem.findMany.mockResolvedValue([
      { id: 'i1', plannedAt: new Date('2026-07-20T00:00:00Z'), itemType: 'LAB', title: 'HbA1c 검사', status: 'PLANNED', refType: null, refId: null, schedule: { name: '당뇨 관리' } },
      { id: 'i2', plannedAt: new Date('2026-07-20T00:00:00Z'), itemType: 'NURSING', title: '욕창 사정', status: 'PLANNED', refType: null, refId: null, schedule: { name: '당뇨 관리' } },
      { id: 'i3', plannedAt: new Date('2026-07-21T00:00:00Z'), itemType: 'ASSESSMENT', title: '낙상 위험 평가', status: 'PLANNED', refType: null, refId: null, schedule: { name: '당뇨 관리' } },
      { id: 'i4', plannedAt: new Date('2026-07-22T00:00:00Z'), itemType: 'EDUCATION', title: '식이 교육', status: 'PLANNED', refType: null, refId: null, schedule: { name: '당뇨 관리' } },
    ]);

    const result = await service.getPortalSchedule('pat-1', {});

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i: any) => i.title)).toEqual(['[당뇨 관리] HbA1c 검사', '[당뇨 관리] 식이 교육']);
  });

  it('should show only LAB/IMAGING pre-orders and dedupe ones already linked in plan', async () => {
    mockPrisma.preOrder.findMany.mockResolvedValue([
      { id: 'p1', type: 'LAB', status: 'PENDING', scheduledDate: new Date('2026-07-20T00:00:00Z'), scheduledTime: null, medicationCode: null, procedureCode: { nameKo: 'HbA1c' } },
      { id: 'p2', type: 'MEDICATION', status: 'PENDING', scheduledDate: new Date('2026-07-20T00:00:00Z'), scheduledTime: null, medicationCode: { nameKo: '메트포르민' }, procedureCode: null },
      { id: 'p3', type: 'IMAGING', status: 'APPROVED', scheduledDate: new Date('2026-07-21T00:00:00Z'), scheduledTime: null, medicationCode: null, procedureCode: { nameKo: '흉부 X-ray' } },
    ]);
    mockPrisma.patientScheduleItem.findMany.mockResolvedValue([
      // p1은 치료계획 LINKED로 이미 표기 → PRE_ORDER 쪽은 중복 제거
      { id: 'i1', plannedAt: new Date('2026-07-20T00:00:00Z'), itemType: 'LAB', title: 'HbA1c 검사', status: 'LINKED', refType: 'PreOrder', refId: 'p1', schedule: { name: '당뇨 관리' } },
    ]);

    const result = await service.getPortalSchedule('pat-1', {});

    const preOrders = result.items.filter((i: any) => i.source === 'PRE_ORDER');
    expect(preOrders).toHaveLength(1); // p2(약)는 비노출·p1은 dedupe → p3만
    expect(preOrders[0].title).toContain('흉부 X-ray');
    expect(result.items.filter((i: any) => i.source === 'PLAN')).toHaveLength(1);
  });

  it('should strip internal keys (detail/refId) from portal items', async () => {
    mockPrisma.patientScheduleItem.findMany.mockResolvedValue([
      { id: 'i1', plannedAt: new Date('2026-07-20T00:00:00Z'), itemType: 'LAB', title: 'HbA1c 검사', status: 'PLANNED', refType: null, refId: null, schedule: { name: '당뇨 관리' } },
    ]);

    const result = await service.getPortalSchedule('pat-1', {});

    expect(result.items[0]).toEqual({
      at: expect.any(Date), source: 'PLAN', title: '[당뇨 관리] HbA1c 검사', status: 'PLANNED',
    });
    expect((result.items[0] as any).detail).toBeUndefined();
    expect((result.items[0] as any).refId).toBeUndefined();
  });
});

describe('PatientScheduleService.getPortalSchedule — 취소 비노출', () => {
  it('should hide CANCELLED/NO_SHOW items from portal', async () => {
    const mockPrisma: any = {
      appointment: { findMany: vi.fn().mockResolvedValue([
        { id: 'a1', scheduledAt: new Date('2026-07-20T10:00:00Z'), status: 'CANCELLED', type: 'FOLLOW_UP', duration: 30, doctor: { familyName: '김', givenName: '의사', department: '내과' } },
        { id: 'a2', scheduledAt: new Date('2026-07-21T10:00:00Z'), status: 'SCHEDULED', type: 'FOLLOW_UP', duration: 30, doctor: { familyName: '김', givenName: '의사', department: '내과' } },
      ]) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
      preOrder: { findMany: vi.fn().mockResolvedValue([]) },
      pathwayAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      patientScheduleItem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new PatientScheduleService(mockPrisma);
    const result = await svc.getPortalSchedule('pat-1', {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('SCHEDULED');
  });
});
