import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingListener } from '../../src/modules/billing/billing.listener';

describe('BillingListener — encounter.signed', () => {
  let listener: BillingListener;
  let mockBilling: any;
  let mockPrisma: any;
  let mockEmitter: any;
  let mockConfig: any;
  let mockJourney: any;

  const payload = { encounterId: 'e-1', patientId: 'p-1' };

  beforeEach(() => {
    mockBilling = {
      createFromEncounter: vi.fn(),
      recalcFromEncounter: vi.fn(),
    };
    mockPrisma = {
      waitingQueue: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
      patientJourneyEvent: { create: vi.fn().mockResolvedValue({ id: 'je-1' }) },
    };
    mockEmitter = { emit: vi.fn() };
    mockConfig = { get: vi.fn().mockResolvedValue(undefined) };
    // 여정은 정본 발행기(JourneyService.emit)로 남긴다(2026-10-01 여정 P0-6 — 종전 prisma 직접 쓰기)
    mockJourney = { emit: vi.fn() };
    listener = new BillingListener(mockBilling, mockPrisma, mockEmitter, mockConfig, mockJourney);
  });

  it('정상: 청구 생성 1회', async () => {
    mockBilling.createFromEncounter.mockResolvedValue({ id: 'b-1' });
    await listener.handleEncounterSigned(payload);
    expect(mockBilling.createFromEncounter).toHaveBeenCalledWith('e-1');
    expect(mockBilling.recalcFromEncounter).not.toHaveBeenCalled();
  });

  describe('🔴 3회 실패 — 로그만 남기고 끝내지 않는다', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockBilling.createFromEncounter.mockRejectedValue(new Error('procedure code AA157 not found'));
    });
    afterEach(() => vi.useRealTimers());

    async function runWithRetries() {
      const p = listener.handleEncounterSigned(payload);
      await vi.runAllTimersAsync();
      await p;
    }

    it('실패가 원장(저니)에 남는다 — 같은 리스너가 환자를 수납 대기로 넘기기 때문이다', async () => {
      await runWithRetries();
      expect(mockBilling.createFromEncounter).toHaveBeenCalledTimes(3);
      expect(mockJourney.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'BILLING_CREATE_FAILED', refId: 'e-1', patientId: 'p-1', severity: 'CRITICAL',
        }),
      );
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        'billing.create_failed',
        expect.objectContaining({ encounterId: 'e-1', patientId: 'p-1' }),
      );
    });

    it('실패 사유를 사람이 읽을 수 있게 남긴다(무엇을 고쳐야 하는지)', async () => {
      await runWithRetries();
      const arg = mockJourney.emit.mock.calls.at(-1)[0];
      expect(arg.description).toContain('AA157');
    });
  });

  it('대조군 — 성공하면 실패라고 말하지 않는다', async () => {
    mockBilling.createFromEncounter.mockResolvedValue({ id: 'b-1' });
    await listener.handleEncounterSigned(payload);
    const kinds = mockJourney.emit.mock.calls.map((c: any) => c[0].eventType);
    expect(kinds).not.toContain('BILLING_CREATE_FAILED');
    expect(mockEmitter.emit).not.toHaveBeenCalledWith('billing.create_failed', expect.anything());
  });

  it('기존재 + autoRecalc OFF(기본): 재계산 안 함·수동검토 이벤트 + 저니 영속화', async () => {
    mockBilling.createFromEncounter.mockRejectedValue(new Error('Billing already exists for this encounter'));
    await listener.handleEncounterSigned(payload);
    expect(mockBilling.recalcFromEncounter).not.toHaveBeenCalled();
    expect(mockEmitter.emit).toHaveBeenCalledWith('billing.amend_review_needed', payload);
    // 검토 큐 조회용 저니 이벤트 기록
    expect(mockJourney.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'BILLING_AMEND_REVIEW', refId: 'e-1', patientId: 'p-1' }),
    );
  });

  it('기존재 + autoRecalc ON + 재계산 성공: 수동검토 이벤트 미발행', async () => {
    mockConfig.get.mockResolvedValue(true);
    mockBilling.createFromEncounter.mockRejectedValue(new Error('Billing already exists for this encounter'));
    mockBilling.recalcFromEncounter.mockResolvedValue({ status: 'recalculated', addedLines: 2 });
    await listener.handleEncounterSigned(payload);
    expect(mockBilling.recalcFromEncounter).toHaveBeenCalledWith('e-1');
    expect(mockEmitter.emit).not.toHaveBeenCalledWith('billing.amend_review_needed', expect.anything());
  });

  it('기존재 + autoRecalc ON + 재계산 미적용(skip): 수동검토 이벤트로 폴백', async () => {
    mockConfig.get.mockResolvedValue('true');
    mockBilling.createFromEncounter.mockRejectedValue(new Error('Billing already exists for this encounter'));
    mockBilling.recalcFromEncounter.mockResolvedValue({ status: 'skipped', reason: 'PAID' });
    await listener.handleEncounterSigned(payload);
    expect(mockBilling.recalcFromEncounter).toHaveBeenCalledWith('e-1');
    expect(mockEmitter.emit).toHaveBeenCalledWith('billing.amend_review_needed', payload);
  });

  it('기존재 + autoRecalc ON + 재계산 throw: 수동검토 이벤트로 폴백(크래시 없음)', async () => {
    mockConfig.get.mockResolvedValue(true);
    mockBilling.createFromEncounter.mockRejectedValue(new Error('Billing already exists for this encounter'));
    mockBilling.recalcFromEncounter.mockRejectedValue(new Error('boom'));
    await listener.handleEncounterSigned(payload);
    expect(mockEmitter.emit).toHaveBeenCalledWith('billing.amend_review_needed', payload);
  });
});
