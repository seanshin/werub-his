import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreOrderService } from '../../src/modules/pre-order/pre-order.service';

/**
 * 🔴 (2026-09-15 T2) 사전오더 승인 시점 DUR 재검증 **실패** ≠ "경고 없음".
 *   종전: `.catch(() => [])` → 처방에 `durChecked: true`·경고 없음 · 응답도 같은 모양 · 감사 없음.
 *   막을지는 사람 결정(`policy.clinical.gateOverrideAuthority`)이라 막지 않는다 — 대신 결과·처방·감사에 FAILED 를 남긴다.
 *   대조군: 재검증이 성공하면(경고 0) CHECKED · durChecked true · 감사 추가 기록 없음.
 */
describe('사전오더 승인 — DUR 재검증 실패는 FAILED 로 남는다', () => {
  let mockPrisma: any;
  let mockDur: any;
  let audit: { safeLog: ReturnType<typeof vi.fn> };
  let service: PreOrderService;

  beforeEach(() => {
    mockPrisma = {
      preOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'po-1', status: 'PENDING', type: 'MEDICATION', medicationCodeId: 'mc-1', patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE',
        }),
        update: vi.fn().mockResolvedValue({ id: 'po-1', status: 'APPROVED' }),
      },
      prescription: { create: vi.fn().mockResolvedValue({ id: 'rx-1' }) },
      order: { create: vi.fn().mockResolvedValue({ id: 'ord-1' }) },
    };
    // 승인 경로는 처방·오더·사전처방 갱신을 한 트랜잭션에서 쓴다(F3) — 정본의 실제 호출 모양으로 준다
    mockPrisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    mockDur = { checkInteractions: vi.fn() };
    audit = { safeLog: vi.fn().mockResolvedValue(undefined) };
    service = new PreOrderService(mockPrisma, mockDur, { emit: vi.fn() } as any, undefined, undefined, undefined, audit as any);
  });

  it('🔴 재검증 예외 → 승인은 진행 · durCheck FAILED · 처방 durChecked=false · 감사 PreOrderDurRecheck', async () => {
    mockDur.checkInteractions.mockRejectedValue(new Error('DUR 조회 실패'));

    const res = await service.approve('po-1', 'doc-2', 'enc-1');

    expect(mockPrisma.prescription.create).toHaveBeenCalledTimes(1);
    expect(res.data.durCheck).toEqual({ status: 'FAILED', reason: 'DUR 조회 실패' });
    expect(mockPrisma.prescription.create.mock.calls[0][0].data.durChecked).toBe(false);
    expect(audit.safeLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'doc-2', resourceType: 'PreOrderDurRecheck', resourceId: 'po-1',
      changes: expect.objectContaining({ durCheck: { old: null, new: 'FAILED' } }),
    }));
  });

  it('대조군 — 재검증 성공(경고 0) 이면 CHECKED · durChecked=true · 감사 추가 없음', async () => {
    mockDur.checkInteractions.mockResolvedValue([]);

    const res = await service.approve('po-1', 'doc-2', 'enc-1');

    expect(res.data.durCheck).toEqual({ status: 'CHECKED', reason: null });
    expect(mockPrisma.prescription.create.mock.calls[0][0].data.durChecked).toBe(true);
    expect(audit.safeLog).not.toHaveBeenCalled();
  });

  it('대조군 — 약물이 아니면 NOT_APPLICABLE(재검증 호출 없음·실패로 말하지 않음)', async () => {
    mockPrisma.preOrder.findUnique.mockResolvedValue({
      id: 'po-2', status: 'PENDING', type: 'LAB', procedureCodeId: 'pc-1', patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE',
    });

    const res = await service.approve('po-2', 'doc-2', 'enc-1');

    expect(mockDur.checkInteractions).not.toHaveBeenCalled();
    expect(res.data.durCheck.status).toBe('NOT_APPLICABLE');
    expect(audit.safeLog).not.toHaveBeenCalled();
  });
});
