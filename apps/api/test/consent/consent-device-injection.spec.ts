import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentDeviceService } from '../../src/modules/consent/consent-device.service';

/**
 * 2026-07 입력 검증 전수검토 회귀 — Prisma 필터 연산자 주입 이중 방어.
 * 1차 방어는 DTO(@IsString), 2차는 서비스에서 where 값을 문자열로 고정하는 것.
 * 객체가 그대로 where 에 들어가면 `{ not: 'x' }` 같은 필터로 해석돼
 * 인증코드를 모르고도 임의의 ACTIVE 페어링 코드를 소비·자동 승인시킬 수 있다.
 */
describe('ConsentDeviceService — 페어링 코드 연산자 주입 방어', () => {
  let prisma: any;
  let service: ConsentDeviceService;

  beforeEach(() => {
    // 🔴 (2026-09-17 L1) 정본이 코드 소비↔기기 등록을 `$transaction` 으로 묶는다 — 목도 같은 모양으로
    prisma = {
      consentSigningDevice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      devicePairingCode: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.$transaction = vi.fn(async (cb: any) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb)));
    service = new ConsentDeviceService(prisma, { emitWorkstation: vi.fn() } as any);
  });

  it('code 가 객체여도 where 에는 문자열만 전달된다', async () => {
    await expect(
      service.enroll({ deviceUid: 'dev-1', name: '태블릿', code: { not: '__x__' } as any }),
    ).rejects.toThrow(); // 문자열화되어 매칭 실패 → 인증코드 오류

    const where = prisma.devicePairingCode.updateMany.mock.calls[0][0].where;
    expect(typeof where.code).toBe('string');
    expect(where.code).not.toEqual({ not: '__x__' });
  });

  it('정상 코드는 그대로 조회된다', async () => {
    prisma.devicePairingCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.consentSigningDevice.create.mockResolvedValue({
      id: 'd1', approvalStatus: 'APPROVED', status: 'IDLE', name: '태블릿',
    });

    const r = await service.enroll({ deviceUid: 'dev-2', name: '태블릿', code: 'ABC123' });

    expect(prisma.devicePairingCode.updateMany.mock.calls[0][0].where.code).toBe('ABC123');
    expect(r.approvalStatus).toBe('APPROVED');
  });
});
