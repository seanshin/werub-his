import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DeviceEnrollService } from '../../src/modules/auth/device-enroll/device-enroll.service';

/**
 * 직원 디바이스 자가등록 공개 표면 계약 — `/api/v1/staff-devices/enroll/:sessionId/*` (미인증·QR).
 *
 * 인증번호(code)가 유일한 문턱이다(FR-32). code 불일치는 시도 카운트로 제한하고,
 * MAX_ATTEMPTS(5) 초과 시 세션을 폐기한다(무차별 대입 차단). 만료 세션은 fail-closed.
 */

function makeSvc(session: unknown) {
  const store: Record<string, string | null> = { 'enroll:s1': session === undefined ? null : JSON.stringify(session) };
  const redis = {
    get: vi.fn((k: string) => Promise.resolve(store[k] ?? null)),
    set: vi.fn((k: string, v: string) => { store[k] = v; return Promise.resolve(); }),
    del: vi.fn((k: string) => { store[k] = null; return Promise.resolve(); }),
  };
  const svc = new DeviceEnrollService(
    {} as never, redis as never, { get: () => undefined } as never, {} as never, {} as never,
  );
  return { svc, redis };
}

const PENDING = { status: 'PENDING', code: '123456', attempts: 0, staffUserId: 'u1', deviceName: '태블릿' };

describe('DeviceEnrollService.claim (인증번호 게이트)', () => {
  it('🔴 잘못된 code — 차단하고 시도 카운트 증가', async () => {
    const { svc, redis } = makeSvc(PENDING);
    await expect(svc.claim('s1', '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(redis.set).toHaveBeenCalled(); // attempts 증가분 저장
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('🔴 MAX_ATTEMPTS(5) 도달 — 세션 폐기(무차별 대입 차단)', async () => {
    const { svc, redis } = makeSvc({ ...PENDING, attempts: 4 });
    await expect(svc.claim('s1', '000000')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENROLL_LOCKED' }),
    });
    expect(redis.del).toHaveBeenCalledWith('enroll:s1');
  });

  it('🔴 만료/없는 세션 — fail-closed(ENROLL_EXPIRED)', async () => {
    const { svc } = makeSvc(undefined);
    await expect(svc.claim('s1', '123456')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENROLL_EXPIRED' }),
    });
  });

  it('이미 진행/완료 세션 — 재claim 차단', async () => {
    const { svc } = makeSvc({ ...PENDING, status: 'VERIFYING' });
    await expect(svc.claim('s1', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DeviceEnrollService.register (상태·code 이중 게이트)', () => {
  it('🔴 VERIFYING 아닌 상태 — 차단', async () => {
    const { svc } = makeSvc({ ...PENDING, status: 'PENDING' });
    await expect(svc.register('s1', '123456', {} as never, '기기')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 code 불일치 — 차단(패스키 검증 이전에)', async () => {
    const { svc } = makeSvc({ ...PENDING, status: 'VERIFYING' });
    await expect(svc.register('s1', '999999', {} as never, '기기')).rejects.toBeInstanceOf(BadRequestException);
  });
});
