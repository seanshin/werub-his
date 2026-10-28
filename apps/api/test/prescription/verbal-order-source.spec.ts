import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';

/**
 * 구두·전화 처방 기록 가드.
 *
 * 🔴 실측(2026-08-19): `prescriptions.order_source` 는 컬럼도 화면 배지도 있는데
 *    DTO 에 키가 없어 whitelist 가 지우고 있었다 → 운영 1,769건 **전량 `WRITTEN`**.
 *    오기 위험이 가장 높은 경로가 원장에서 통째로 사라져 있었다.
 * 🔴 복창(read-back)은 **기본값을 참으로 두지 않는다** — v4.5.0 에서 위급값 복창이
 *    `readBack ?? true` 라 "복창 누락"이 구조적으로 영원히 0이던 것과 같은 함정이다.
 */
describe('처방 지시 경로 · 복창', () => {
  let service: PrescriptionService;
  let prisma: any;

  const dto = { type: 'MEDICATION', medicationCodeId: 'med-1', dosage: '500mg', frequency: 'TID', duration: 3, quantity: 9 } as any;

  const created = (over: Record<string, unknown> = {}) => ({ id: 'rx-1', type: 'MEDICATION', ...over });

  beforeEach(() => {
    prisma = {
      encounter: { findUnique: vi.fn().mockResolvedValue({ id: 'enc-1', patientId: 'pat-1', doctorId: 'doc-1' }) },
      prescription: { create: vi.fn().mockResolvedValue(created()), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      order: { create: vi.fn().mockResolvedValue({ id: 'ord-1' }), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      medicationAdministration: { deleteMany: vi.fn() },
      medicationCode: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR' }) },
      $transaction: vi.fn((cb: any) => cb(prisma)),
    };
    service = new PrescriptionService(
      prisma,
      { checkInteractions: vi.fn().mockResolvedValue([]) } as any,
      { emit: vi.fn() } as any,
      { create: vi.fn() } as any,
      { get: vi.fn().mockResolvedValue(null) } as any,
      { consume: vi.fn() } as any,
      { requestDelegate: vi.fn() } as any,
      { safeLog: vi.fn() } as any,
      { assertOrderGate: vi.fn().mockResolvedValue(undefined) } as any,
    );
  });

  const savedData = () => prisma.prescription.create.mock.calls[0][0].data;

  it('전화 처방 + 복창 확인 → 경로와 확인 시각·확인자가 남는다', async () => {
    await service.create('enc-1', dto, 'nurse-1', undefined, { orderSource: 'TELEPHONE', readBackConfirmed: true });

    const d = savedData();
    expect(d.orderSource).toBe('TELEPHONE');
    expect(d.readBackConfirmedAt).toBeInstanceOf(Date);
    expect(d.readBackConfirmedBy).toBe('nurse-1');
  });

  it('🔴 구두 처방인데 복창을 확인하지 않았으면 확인으로 적지 않는다(지표의 분모가 살아 있어야 한다)', async () => {
    await service.create('enc-1', dto, 'nurse-1', undefined, { orderSource: 'VERBAL', readBackConfirmed: false });

    const d = savedData();
    expect(d.orderSource).toBe('VERBAL');
    expect(d.readBackConfirmedAt).toBeUndefined();
    expect(d.readBackConfirmedBy).toBeUndefined();
  });

  it('🔴 복창 값을 아예 보내지 않아도 "확인함"이 되지 않는다', async () => {
    await service.create('enc-1', dto, 'nurse-1', undefined, { orderSource: 'VERBAL' });

    expect(savedData().readBackConfirmedAt).toBeUndefined();
  });

  it('서면 처방에서는 복창 개념이 없다 — 참으로 보내도 기록하지 않는다', async () => {
    await service.create('enc-1', dto, 'doc-1', undefined, { orderSource: 'WRITTEN', readBackConfirmed: true });

    const d = savedData();
    expect(d.orderSource).toBe('WRITTEN');
    expect(d.readBackConfirmedAt).toBeUndefined();
  });

  it('경로를 보내지 않으면 스키마 기본값(WRITTEN)에 맡긴다 — 값을 지어내지 않는다', async () => {
    await service.create('enc-1', dto, 'doc-1');

    expect(savedData().orderSource).toBeUndefined();
  });
});
