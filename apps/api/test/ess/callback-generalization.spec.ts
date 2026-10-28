import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

/** 반려 자동취소 정책(2026-07-22) — 외부(W.Sign) 콜백의 leave 외 refModule을 docType 레지스트리 훅으로 일반화 */
describe('leaveCallback 레지스트리 일반화', () => {
  let service: EssService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      eApprovalRelay: {
        findFirst: vi.fn().mockResolvedValue({ id: 'relay-1', docType: 'HR_DUTY_SWAP', status: 'PENDING' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leaveRequest: { findUnique: vi.fn() },
      dutySwapRequest: { findUnique: vi.fn() },
    };
    service = new EssService(mockPrisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, { get: vi.fn(async () => null) } as any);
    (service as any).audit = vi.fn();
  });

  it('leave 외 refModule(duty.swap_requests) 반려 → relay docType으로 도메인 훅 위임 + relay 종결', async () => {
    const confirmSpy = vi.spyOn(service as any, 'confirmDutySwap').mockResolvedValue({ status: 'REJECTED' });
    const r: any = await service.leaveCallback({
      ref: { source_module: 'duty.swap_requests', source_ref: 'swap-1' },
      status: 'REJECTED', approver: '이간호', approvalId: 'ap-9',
    });
    expect(r.ok).toBe(true);
    expect(r.docType).toBe('HR_DUTY_SWAP');
    expect(confirmSpy).toHaveBeenCalledWith('swap-1', 'REJECTED');
    expect(mockPrisma.eApprovalRelay.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', callbackDelivered: true }) }),
    );
  });

  it('이미 종결된 relay면 멱등(도메인 훅 미호출)', async () => {
    mockPrisma.eApprovalRelay.findFirst.mockResolvedValue({ id: 'relay-1', docType: 'HR_DUTY_SWAP', status: 'REJECTED' });
    const confirmSpy = vi.spyOn(service as any, 'confirmDutySwap');
    const r: any = await service.leaveCallback({
      ref: { source_module: 'duty.swap_requests', source_ref: 'swap-1' }, status: 'REJECTED',
    });
    expect(r.idempotent).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('relay 없는 refModule → NotFound(휴가 오인 처리 금지)', async () => {
    mockPrisma.eApprovalRelay.findFirst.mockResolvedValue(null);
    await expect(service.leaveCallback({
      ref: { source_module: 'consent.consent_forms', source_ref: 'cf-1' }, status: 'REJECTED',
    })).rejects.toThrow(/찾을 수 없습니다/);
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });
});
