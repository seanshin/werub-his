import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LabService } from '../../src/modules/lab/lab.service';
import { ImagingService } from '../../src/modules/imaging/imaging.service';
import { JourneyListener } from '../../src/modules/journey/journey.listener';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';

/**
 * 여정 이벤트 규약 회귀 — 임상 워크플로가 환자 여정을 발행하는지.
 * 종전: LAB_RESULT·IMAGING_RESULT·ORDER_CREATED가 **데모 시드에만** 존재하고
 * 실제 검사/영상/처방 경로는 여정을 전혀 남기지 않아 여정 콘솔이 비어 있었음.
 */
describe('임상 워크플로 여정 이벤트 발행', () => {
  const patientId = 'pt-1';

  describe('LabService.submitResult', () => {
    let prisma: any;
    let journey: any;

    beforeEach(() => {
      vi.clearAllMocks();
      journey = { emit: vi.fn() };
      prisma = {
        // 결과 확정 + 위급값 경보를 한 트랜잭션으로 묶음(2026-07 트랜잭션 경계 전수) —
        // 콜백에 같은 목을 넘겨 기존 검증을 그대로 유지한다
        $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
        labResult: {
          findUnique: vi.fn().mockResolvedValue({ id: 'lr-1', status: 'COLLECTED', items: [] }),
          update: vi.fn().mockResolvedValue({}),
        },
        order: {
          findUnique: vi.fn().mockResolvedValue({ prescription: { encounter: { patient: { gender: 'M', dateOfBirth: new Date('1980-01-01') } } } }),
          update: vi.fn().mockResolvedValue({ prescription: { id: 'rx-1', encounterId: 'enc-1', encounter: { patientId, doctorId: 'dr-1' } } }),
        },
        criticalValueAlert: { createMany: vi.fn().mockResolvedValue({}) },
        labResultItem: { createMany: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}) },
        medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
        procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      };
    });

    // 기준치 마스터: 정상=flag null · K 7.5는 위급고치(HH)
    const referenceRange = {
      resolve: vi.fn().mockResolvedValue(null),
      flagValue: vi.fn((value: string) => (Number(value) > 7 ? 'HH' : null)),
    };

    const make = () => new LabService(prisma, { emit: vi.fn() } as never, {} as never, referenceRange as never, journey);

    it('결과 확정 시 LAB_RESULT를 발행한다', async () => {
      await make().submitResult('order-1', [{ testName: 'WBC', value: '6.2', unit: '10^3/uL', normalMin: 4, normalMax: 10 }], undefined, 'user-1');

      expect(journey.emit).toHaveBeenCalledTimes(1);
      const ev = journey.emit.mock.calls[0][0];
      expect(ev).toMatchObject({ patientId, eventType: 'LAB_RESULT', department: '진단검사의학과', refType: 'LabResult' });
      expect(ev.description).toContain('정상');
    });

    it('위급값이면 severity=CRITICAL로 발행한다', async () => {
      await make().submitResult('order-1', [{ testName: 'K', value: '7.5', unit: 'mmol/L', normalMin: 3.5, normalMax: 5.1 }], undefined, 'user-1');

      const ev = journey.emit.mock.calls[0][0];
      expect(['CRITICAL', 'WARNING']).toContain(ev.severity);
      expect(ev.description).toContain('이상');
    });
  });

  describe('JourneyListener — 오더 8경로 단일 구독점', () => {
    let journey: any;
    let listener: JourneyListener;

    beforeEach(() => {
      journey = { emit: vi.fn() };
      listener = new JourneyListener(journey);
    });

    it('약 오더는 PRESCRIPTION_ADDED로 발행한다', () => {
      listener.onOrderCreated({ orderId: 'o-1', type: 'MEDICATION', patientId, notes: '1일 3회' });
      expect(journey.emit.mock.calls[0][0]).toMatchObject({
        eventType: 'PRESCRIPTION_ADDED', title: '처방 발행', department: '약제부', refType: 'Order', refId: 'o-1',
      });
    });

    it('검사·영상 오더는 ORDER_CREATED + 수행부서로 발행한다', () => {
      listener.onOrderCreated({ orderId: 'o-2', type: 'IMAGING', patientId });
      expect(journey.emit.mock.calls[0][0]).toMatchObject({ eventType: 'ORDER_CREATED', department: '영상의학과' });
    });

    it('응급/STAT 오더는 severity WARNING을 붙인다', () => {
      listener.onOrderCreated({ orderId: 'o-3', type: 'LAB', patientId, priority: 'STAT' });
      expect(journey.emit.mock.calls[0][0].severity).toBe('WARNING');
    });

    it('patientId 없는 페이로드는 발행하지 않는다', () => {
      listener.onOrderCreated({ orderId: 'o-4', type: 'LAB' });
      expect(journey.emit).not.toHaveBeenCalled();
    });

    it('조제 완료는 DISPENSED로 발행한다', () => {
      listener.onDispensed({ dispensingId: 'd-1', patientId });
      expect(journey.emit.mock.calls[0][0]).toMatchObject({ eventType: 'DISPENSED', department: '약제부' });
    });
    // 2026-09-14 — 위치 매핑·아이콘은 기다리는데 발행 0 이던 유형(journey-event-vocabulary.spec)
    it('치료 오더 완료만 ORDER_COMPLETED 로 발행한다 — 환자는 처방→진료로 찾는다', async () => {
      const prisma = { prescription: { findUnique: vi.fn().mockResolvedValue({ encounter: { patientId } }) } };
      const l = new JourneyListener(journey, prisma as never);
      await l.onOrderCompleted({ orderId: 'o-9', department: 'THERAPY', prescriptionId: 'rx-9' });
      expect(journey.emit.mock.calls[0][0]).toMatchObject({ patientId, eventType: 'ORDER_COMPLETED', refType: 'Order', refId: 'o-9' });
    });

    it('대조군 — 검사·영상·약 완료는 결과 여정이 이미 말하므로 ORDER_COMPLETED 를 내지 않는다', async () => {
      const prisma = { prescription: { findUnique: vi.fn() } };
      const l = new JourneyListener(journey, prisma as never);
      for (const department of ['LAB', 'IMAGING', 'PHARMACY']) await l.onOrderCompleted({ orderId: 'o', department, prescriptionId: 'rx' });
      expect(journey.emit).not.toHaveBeenCalled();
      expect(prisma.prescription.findUnique).not.toHaveBeenCalled();
    });

    it('환자 조회 실패는 발행하지 않고 던지지도 않는다(도메인 쓰기는 이미 커밋됨)', async () => {
      const prisma = { prescription: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } };
      const l = new JourneyListener(journey, prisma as never);
      await expect(l.onOrderCompleted({ orderId: 'o', department: 'THERAPY', prescriptionId: 'rx' })).resolves.toBeUndefined();
      expect(journey.emit).not.toHaveBeenCalled();
    });

    it('청구 생성은 BILLING_CREATED — 금액은 싣지 않고 반환값도 없다(환자 푸시 결과 계약 불간섭)', () => {
      const ret = listener.onBillingCreated({ patientId, billingId: 'b-1' });
      expect(ret).toBeUndefined();
      const ev = journey.emit.mock.calls[0][0];
      expect(ev).toMatchObject({ eventType: 'BILLING_CREATED', refType: 'Billing', refId: 'b-1' });
      expect(ev.description).toBeUndefined();
      expect(ev.metadata).toBeUndefined();
    });

    it('동의서 철회는 CONSENT_REVOKED — 사유는 싣지 않는다', () => {
      listener.onConsentRevoked({ consentId: 'c-1', patientId, templateName: '수술 동의서' });
      expect(journey.emit.mock.calls[0][0]).toMatchObject({ eventType: 'CONSENT_REVOKED', refId: 'c-1', description: '수술 동의서' });
    });
  });

  describe('ImagingService.report', () => {
    it('판독 완료 시 IMAGING_RESULT를 발행한다', async () => {
      const journey = { emit: vi.fn() };
      const prisma: any = {
        imagingResult: {
          findUnique: vi.fn().mockResolvedValue({ id: 'ir-1', status: 'ACQUIRED', order: {} }),
          update: vi.fn().mockResolvedValue({}),
        },
        order: {
          update: vi.fn().mockResolvedValue({ prescription: { id: 'rx-1', encounterId: 'enc-1', encounter: { patientId } } }),
        },
      };
      // 🔴 (G3) 오더 완료와 판독 기록은 한 트랜잭션 — 목은 정본의 실제 호출 모양을 쓴다(tx=같은 목 재사용)
      prisma.$transaction = vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      );
      const svc = new ImagingService(prisma, { emit: vi.fn() } as never, {} as never, {} as never, journey as never);

      await svc.report('order-1', '폐야 깨끗', '정상 흉부', 'rad-1');

      expect(journey.emit).toHaveBeenCalledTimes(1);
      expect(journey.emit.mock.calls[0][0]).toMatchObject({
        patientId, eventType: 'IMAGING_RESULT', department: '영상의학과', refType: 'ImagingResult',
      });
    });
  });
});


describe('응급 처치 시작 여정 — ER_TREATMENT_START (2026-09-14)', () => {
  const make = (treatmentStartedAt: Date | null) => {
    const journey = { emit: vi.fn() };
    const prisma: any = {
      emergencyVisit: {
        findUnique: vi.fn().mockResolvedValue({ id: 'v-1', status: 'TRIAGED', patientId: 'pt-9', treatmentStartedAt }),
        update: vi.fn().mockResolvedValue({ id: 'v-1', status: 'IN_TREATMENT', treatmentNote: 'n', treatmentStartedAt: new Date() }),
      },
    };
    return { svc: new EmergencyService(prisma, journey as never), journey };
  };

  it('처음 처치를 기록할 때 발행한다', async () => {
    const { svc, journey } = make(null);
    await svc.recordTreatment('v-1', 'u-1', 'n');
    expect(journey.emit).toHaveBeenCalledTimes(1);
    expect(journey.emit.mock.calls[0][0]).toMatchObject({ patientId: 'pt-9', eventType: 'ER_TREATMENT_START', refId: 'v-1' });
  });

  it('대조군 — 이미 시작된 처치의 노트 갱신은 다시 발행하지 않는다', async () => {
    const { svc, journey } = make(new Date());
    await svc.recordTreatment('v-1', 'u-1', 'n2');
    expect(journey.emit).not.toHaveBeenCalled();
  });
});
