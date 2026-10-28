import { describe, it, expect, vi } from 'vitest';
import { ConsentDeviceService } from '../../src/modules/consent/consent-device.service';

/**
 * 동의 서명 태블릿 secret 게이트 계약 — `/api/v1/consent-device/:deviceUid*` (무인증·고정 링크).
 *
 * 태블릿은 로그인 없이 열리므로 `deviceSecret` 이 유일한 문턱이다.
 * currentToken(대기 중 동의서 서명 토큰)은 **secret 일치 기기에게만** 나가야 한다(IDOR C-3).
 * 🔴 종전 secretOk 는 deviceSecret 이 null 인 기기를 secret 없이 통과시켰다 — fail-closed 로 고정.
 */

const BASE = {
  deviceUid: 'dev-1', deviceSecret: 'S3CRET', name: '외래 태블릿',
  approvalStatus: 'APPROVED', status: 'DISPATCHED', currentToken: 'TOK-xyz', isActive: true,
};

function makeSvc(device: unknown) {
  const prisma = {
    consentSigningDevice: { findUnique: vi.fn().mockResolvedValue(device) },
  };
  return new ConsentDeviceService(prisma as never, { emitWorkstation: vi.fn() } as never);
}

describe('ConsentDeviceService.getDeviceState — currentToken secret 게이트', () => {
  it('secret 일치 — currentToken 을 내려준다', async () => {
    const res = await makeSvc(BASE).getDeviceState('dev-1', 'S3CRET');
    expect(res.currentToken).toBe('TOK-xyz');
  });

  it('🔴 secret 불일치 — currentToken 은 null(다른 기기가 훔쳐볼 수 없다)', async () => {
    const res = await makeSvc(BASE).getDeviceState('dev-1', 'WRONG');
    expect(res.currentToken).toBeNull();
    expect(res.registered).toBe(true); // 등록 상태는 확인용으로 반환
  });

  it('🔴 secret 미제출 — currentToken 은 null', async () => {
    const res = await makeSvc(BASE).getDeviceState('dev-1', undefined);
    expect(res.currentToken).toBeNull();
  });

  it('🔴 deviceSecret 이 null 인 기기 — fail-closed(secret 없이 통과 금지)', async () => {
    const res = await makeSvc({ ...BASE, deviceSecret: null }).getDeviceState('dev-1', undefined);
    expect(res.currentToken).toBeNull();
  });

  it('미등록 기기 — registered:false', async () => {
    const res = await makeSvc(null).getDeviceState('nope');
    expect(res).toEqual({ registered: false });
  });
});

describe('ConsentDeviceService.authorizeStream — SSE 구독 secret 게이트', () => {
  it('secret 일치 — 구독 허용', async () => {
    expect(await makeSvc({ deviceSecret: 'S3CRET' }).authorizeStream('dev-1', 'S3CRET')).toBe(true);
  });
  it('🔴 secret 불일치 — 거부', async () => {
    expect(await makeSvc({ deviceSecret: 'S3CRET' }).authorizeStream('dev-1', 'WRONG')).toBe(false);
  });
  it('🔴 deviceSecret null 기기 — fail-closed 거부', async () => {
    expect(await makeSvc({ deviceSecret: null }).authorizeStream('dev-1', 'anything')).toBe(false);
  });
});
