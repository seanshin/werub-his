import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DisplayBoxController } from '../../src/modules/waiting-queue/display-box.controller';

/**
 * TV 박스(설치 단말) 구성 조회 공개 표면 계약 — `/api/v1/displays/box/:key` (무인증·D9).
 *
 * 단말엔 `/display/box/<key>` 한 줄만 걸리므로 이 EP 는 로그인 없이 열린다.
 * 계약: (1) **PHI 0** — 보드 구성(name·boardType·config)만 나가고 환자 데이터가 절대 없다.
 *       (2) 비활성·미등록 키는 **401**(폐기 단말 차단, fail-closed).
 *       (3) 유효 키는 lastUsedAt 을 갱신(공개 보드 생존 신호).
 */

const ACTIVE_KEY = {
  id: 'k1', key: 'BOX-abc', name: '외래 3층 대기실 TV', boardType: 'CLINIC_QUEUE',
  config: { departments: ['순환기내과', '소화기내과'], voice: true }, isActive: true,
};

function makeCtrl(box: unknown) {
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    displayApiKey: {
      findUnique: vi.fn().mockResolvedValue(box),
      update,
    },
  };
  return { ctrl: new DisplayBoxController(prisma as never), update, prisma };
}

describe('DisplayBoxController.getBox (공개 박스 구성)', () => {
  it('유효 키 — 보드 구성만 반환(name·boardType·config), PHI 0', async () => {
    const { ctrl } = makeCtrl(ACTIVE_KEY);
    const res = await ctrl.getBox('BOX-abc');
    expect(Object.keys(res.data).sort()).toEqual(['boardType', 'config', 'name'].sort());
    expect(res.data.boardType).toBe('CLINIC_QUEUE');
    // 키 원문·환자 데이터가 응답에 섞이지 않는다
    for (const banned of ['key', 'patient', 'mrn', 'patientName']) {
      expect(res.data).not.toHaveProperty(banned);
    }
  });

  it('유효 키 — lastUsedAt 을 갱신한다(공개 보드 생존 신호)', async () => {
    const { ctrl, update } = makeCtrl(ACTIVE_KEY);
    await ctrl.getBox('BOX-abc');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'k1' },
      data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
    }));
  });

  it('🔴 비활성 키 — 401(폐기 단말 차단·fail-closed)', async () => {
    const { ctrl, update } = makeCtrl({ ...ACTIVE_KEY, isActive: false });
    await expect(ctrl.getBox('BOX-abc')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled(); // 죽은 키는 생존 신호도 안 남긴다
  });

  it('🔴 미등록 키 — 401(존재 오라클 없음)', async () => {
    const { ctrl } = makeCtrl(null);
    await expect(ctrl.getBox('NOPE')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('config 없는 키 — 빈 객체로 안전 반환', async () => {
    const { ctrl } = makeCtrl({ ...ACTIVE_KEY, config: null });
    const res = await ctrl.getBox('BOX-abc');
    expect(res.data.config).toEqual({});
  });
});
