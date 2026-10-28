import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

/** 약국 조제 DUR 게이트 3상(pharmacy.durGate.enforce OFF|WARN|BLOCK·구 true/false 호환) + GateViolationLog */
describe('Pharmacy DUR gate modes (pharmacy.durGate.enforce)', () => {
  let service: PharmacyService;
  let mockPrisma: any;
  let mockConfig: any;

  const orderWithWarnings = {
    id: 'ord-1', status: 'ORDERED',
    prescription: {
      id: 'rx-1', medicationCodeId: 'm-1', quantity: 1,
      durWarnings: [{ type: 'INTERACTION', severity: 'ERROR', message: '병용금기' }],
      durOverridden: false,
      medicationCode: { aspRestrictedLevel: null },
      encounter: { patientId: 'p-1' },
    },
  };

  beforeEach(() => {
    mockPrisma = {
      order: { findUnique: vi.fn().mockResolvedValue(orderWithWarnings), update: vi.fn().mockResolvedValue({}) },
      prescription: { update: vi.fn().mockResolvedValue({}) },
      admission: { count: vi.fn().mockResolvedValue(0) },
      dispensing: { create: vi.fn().mockResolvedValue({ id: 'disp-1' }) },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
    };
    // 오더 상태와 조제 기록은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    mockPrisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    mockConfig = { get: vi.fn().mockResolvedValue(null) };
    service = new PharmacyService(mockPrisma, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, mockConfig);
  });

  const setGate = (value: string | null) =>
    mockConfig.get.mockImplementation(async (k: string) => (k === 'pharmacy.durGate.enforce' ? value : null));

  it('기본(미설정)=OFF — 미해결 경고라도 조제 진행·기록 없음', async () => {
    const r = await service.startDispensing('ord-1', 'ph-1');
    expect(r.id).toBe('disp-1');
    expect(mockPrisma.gateViolationLog.create).not.toHaveBeenCalled();
  });

  it('BLOCK — 미해결 경고 조제 차단 + 위반 BLOCK 영속', async () => {
    setGate('BLOCK');
    await expect(service.startDispensing('ord-1', 'ph-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gateKey: 'pharmacy.durGate.enforce', severity: 'BLOCK', refId: 'rx-1' }) }),
    );
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("구 'true' 값 — BLOCK 호환", async () => {
    setGate('true');
    await expect(service.startDispensing('ord-1', 'ph-1')).rejects.toThrow(ConflictException);
  });

  it('WARN — 조제 진행 + 위반 WARN 영속', async () => {
    setGate('WARN');
    const r = await service.startDispensing('ord-1', 'ph-1');
    expect(r.id).toBe('disp-1');
    expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ severity: 'WARN' }) }),
    );
  });

  it('BLOCK + 오버라이드 사유 — durOverridden 기록 후 진행 + OVERRIDE 영속', async () => {
    setGate('BLOCK');
    const r = await service.startDispensing('ord-1', 'ph-1', undefined, '주치의 확인 완료');
    expect(r.id).toBe('disp-1');
    expect(mockPrisma.prescription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durOverridden: true, durOverrideBy: 'ph-1' }) }),
    );
    expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ severity: 'OVERRIDE' }) }),
    );
  });
});
