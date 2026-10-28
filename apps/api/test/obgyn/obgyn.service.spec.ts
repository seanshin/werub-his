import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObGynService } from '../../src/modules/obgyn/obgyn.service';

describe('ObGynService', () => {
  let service: ObGynService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      obGynExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'del-1', ...data })),
      },
      newbornRecord: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'nb-1' }),
      },
      laborProgressRecord: {
        create: vi.fn().mockResolvedValue({ id: 'lp-1' }),
      },
      patient: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));
    service = new ObGynService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.obGynExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.obGynExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return all exams for a patient without filter', async () => {
      const exams = [{ id: 'e-1', examType: 'PRENATAL' }];
      mockPrisma.obGynExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      expect(result).toEqual(exams);
      expect(mockPrisma.obGynExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
        take: 200,
      });
    });

    it('should filter by examType when provided', async () => {
      mockPrisma.obGynExam.findMany.mockResolvedValue([]);
      await service.getExams('p-1', 'PRENATAL');
      expect(mockPrisma.obGynExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1', examType: 'PRENATAL' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
        take: 200,
      });
    });

    it('should not include examType filter when undefined', async () => {
      mockPrisma.obGynExam.findMany.mockResolvedValue([]);
      await service.getExams('p-1', undefined);
      const callArg = mockPrisma.obGynExam.findMany.mock.calls[0][0];
      expect(callArg.where).toEqual({ patientId: 'p-1' });
    });

    it('should filter by GYNECOLOGY examType', async () => {
      mockPrisma.obGynExam.findMany.mockResolvedValue([{ id: 'e-2', examType: 'GYNECOLOGY' }]);
      const result = await service.getExams('p-1', 'GYNECOLOGY');
      expect(mockPrisma.obGynExam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 'p-1', examType: 'GYNECOLOGY' } }),
      );
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create a prenatal exam', async () => {
      const input = {
        patientId: 'p-1', examType: 'PRENATAL' as const,
        gestationalAge: '28W', gravida: 1, para: 0,
        fetalHeartRate: 140, examinedBy: 'doc-1',
      };
      const created = { id: 'e-new', ...input };
      mockPrisma.obGynExam.create.mockResolvedValue(created);
      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
    });

    it('should create a gynecology exam with pap smear', async () => {
      const input = {
        patientId: 'p-2', examType: 'GYNECOLOGY' as const,
        papSmear: 'NORMAL', hpvTest: 'NEGATIVE',
        examinedBy: 'doc-1',
      };
      mockPrisma.obGynExam.create.mockResolvedValue({ id: 'e-gyn', ...input });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-gyn');
    });

    it('should convert edd string to Date', async () => {
      const input = {
        patientId: 'p-1', examType: 'PRENATAL' as const,
        edd: '2026-12-25', examinedBy: 'doc-1',
      };
      mockPrisma.obGynExam.create.mockResolvedValue({ id: 'e-edd' });
      await service.createExam(input);
      const callArg = mockPrisma.obGynExam.create.mock.calls[0][0];
      expect(callArg.data.edd).toBeInstanceOf(Date);
    });

    it('should handle undefined edd gracefully', async () => {
      const input = { patientId: 'p-1', examType: 'LABOR' as const, examinedBy: 'doc-1' };
      mockPrisma.obGynExam.create.mockResolvedValue({ id: 'e-no-edd' });
      await service.createExam(input);
      const callArg = mockPrisma.obGynExam.create.mock.calls[0][0];
      expect(callArg.data.edd).toBeUndefined();
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', examType: 'POSTPARTUM' as const, examinedBy: 'doc-1' };
      mockPrisma.obGynExam.create.mockResolvedValue({ id: 'e-pp' });
      await service.createExam(input);
      expect(mockPrisma.obGynExam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });
  });

  /* ───── getToday ───── */

  describe('getToday', () => {
    it('🔴 오늘 예약(Appointment)을 조회한다 — 종전 `return []` 스텁은 영구 공집합이었다(W4)', async () => {
      const result = await service.getToday();
      expect(mockPrisma.appointment.findMany).toHaveBeenCalled();
      const where = mockPrisma.appointment.findMany.mock.calls[0][0].where;
      expect(where.doctor?.department?.in, '전문과↔진료과 매핑이 빠지면 남의 과 예약이 섞인다').toBeTruthy();
      expect(where.scheduledAt, "'오늘'은 상·하한을 모두 갖는다").toBeTruthy();
      expect(result).toEqual([]);
    });
  });

  /* ───── getStats ───── */

  describe('getStats', () => {
    it('should return stats with total count', async () => {
      mockPrisma.obGynExam.count.mockResolvedValue(25);
      const result = await service.getStats();
      expect(result.totalExams).toBe(25);
      expect(result.deliveredThisMonth).toBe(0);
    });

    it('should return zero total when no exams', async () => {
      mockPrisma.obGynExam.count.mockResolvedValue(0);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });
  });

  /* ───── 분만 상태전이·폐쇄 가드 ───── */

  describe('delivery safety', () => {
    it('[P2] 역행 전이 거부 (DELIVERED→IN_LABOR)', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'DELIVERED', deliveryType: 'VAGINAL', deliveredAt: new Date() });
      await expect(service.updateDelivery('del-1', { status: 'IN_LABOR' }, 'u-1'))
        .rejects.toMatchObject({ response: { code: 'DELIVERY_INVALID_TRANSITION' } });
    });

    it('[P2] DELIVERED 전이에 분만유형·시각 필수', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'IN_LABOR', deliveryType: null, deliveredAt: null });
      await expect(service.updateDelivery('del-1', { status: 'DELIVERED' }, 'u-1'))
        .rejects.toMatchObject({ response: { code: 'DELIVERY_INCOMPLETE' } });
    });

    it('IN_LABOR→DELIVERED 정상(분만유형·시각 제공)', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'IN_LABOR', deliveredBy: null });
      const res = await service.updateDelivery('del-1', { status: 'DELIVERED', deliveryType: 'CESAREAN', deliveredAt: '2026-07-01T00:00:00Z' }, 'u-1');
      expect(res.status).toBe('DELIVERED');
    });

    it('[P2] 종료(CLOSED) 분만은 필드 변조도 차단(상태 불변경 PATCH)', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'CLOSED', deliveryType: 'VAGINAL', deliveredAt: new Date() });
      await expect(service.updateDelivery('del-1', { bloodLossMl: 9999 } as any, 'u-1'))
        .rejects.toMatchObject({ response: { code: 'DELIVERY_CLOSED' } });
      expect(mockPrisma.deliveryRecord.update).not.toHaveBeenCalled();
    });

    it('[P2] 종료(CLOSED) 분만에 신생아 추가 거부', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'CLOSED' });
      await expect(service.addNewborn('del-1', { sex: 'M' }))
        .rejects.toMatchObject({ response: { code: 'DELIVERY_CLOSED' } });
    });

    it('[P2] 진통중 아님(POSTPARTUM)에 분만진행 추가 거부', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'POSTPARTUM' });
      await expect(service.addLaborProgress('del-1', { cervicalDilation: 5 }, 'u-1'))
        .rejects.toMatchObject({ response: { code: 'DELIVERY_NOT_IN_LABOR' } });
    });

    it('다태아 출생순번 자동 부여(기존 1명 → 2번째)', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'DELIVERED', patientId: 'mom-1', deliveredAt: new Date() });
      mockPrisma.newbornRecord.count.mockResolvedValue(1); // 이미 1명 등록됨
      mockPrisma.newbornRecord.create.mockResolvedValue({ id: 'nb-2' });
      await service.addNewborn('del-1', { sex: 'F' });
      const arg = mockPrisma.newbornRecord.create.mock.calls[0][0];
      expect(arg.data.birthOrder).toBe(2);
    });

    it('출생순번 명시 시 그대로 사용', async () => {
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'DELIVERED', patientId: 'mom-1', deliveredAt: new Date() });
      mockPrisma.newbornRecord.count.mockResolvedValue(0);
      mockPrisma.newbornRecord.create.mockResolvedValue({ id: 'nb-3' });
      await service.addNewborn('del-1', { sex: 'M', birthOrder: 3, idBandNo: 'BAND-3' });
      const arg = mockPrisma.newbornRecord.create.mock.calls[0][0];
      expect(arg.data.birthOrder).toBe(3);
      expect(arg.data.idBandNo).toBe('BAND-3');
    });

    it('저Apgar(5분<7)·NICU 시 신생아 위중 통지·여정 이벤트', async () => {
      const events = { emit: vi.fn() };
      const journey = { emit: vi.fn() };
      const svc = new ObGynService(mockPrisma, events as any, journey as any);
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'DELIVERED', patientId: 'mom-1', deliveredAt: new Date() });
      mockPrisma.newbornRecord.create.mockResolvedValue({ id: 'nb-1' });
      await svc.addNewborn('del-1', { sex: 'M', apgar5: 5 });
      expect(events.emit).toHaveBeenCalledWith('newborn.critical', expect.objectContaining({ motherPatientId: 'mom-1' }));
      expect(journey.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'NEWBORN_CRITICAL' }));
    });

    it('정상 Apgar·비NICU면 위중 이벤트 미발행', async () => {
      const events = { emit: vi.fn() };
      const svc = new ObGynService(mockPrisma, events as any, { emit: vi.fn() } as any);
      mockPrisma.deliveryRecord.findUnique.mockResolvedValue({ id: 'del-1', status: 'DELIVERED', patientId: 'mom-1', deliveredAt: new Date() });
      mockPrisma.newbornRecord.create.mockResolvedValue({ id: 'nb-2' });
      await svc.addNewborn('del-1', { sex: 'F', apgar5: 9, nicuAdmission: false });
      expect(events.emit).not.toHaveBeenCalled();
    });
  });
});
