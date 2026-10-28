/**
 * 🔴 (2026-09-14 G12 실측) 환자 포털 시드 계정 EP 가 ADMIN 만 보고 운영 모드를 보지 않았다 — REAL 에서도 알려진 비밀번호 계정 5개 생성 가능.
 * 🔴 그 게이트가 `seed-test-accounts` 하나에만 있었다 — 나머지 시드 3개는 REAL 에서도
 *    이미 있는 계정(고정 전화번호)의 환자에게 여정 이벤트·검진 방문/결과·대기열을 **지우고** 가짜 기록·동의서를 만들었다.
 * 지키는 것: ① REAL 이면 넷 다 거부하고 서비스를 부르지 않는다 ② 대조군 — DEV·REHEARSAL 은 그대로 동작
 */
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PatientAuthController } from '../../src/modules/patient-auth/patient-auth.controller';

const SEEDS = ['seedTestAccounts', 'seedOutpatientJourney', 'seedConsentData', 'seedCheckupJourney'] as const;

function make(mode: 'DEV' | 'REHEARSAL' | 'REAL') {
  const auth = Object.fromEntries(SEEDS.map((m) => [m, vi.fn().mockResolvedValue({ created: 5 })])) as Record<(typeof SEEDS)[number], ReturnType<typeof vi.fn>>;
  const ctrl = new PatientAuthController(auth as any, {} as any, { effective: vi.fn().mockResolvedValue(mode) } as any);
  return { ctrl, auth };
}

describe('시드 환자 EP — 운영 모드 게이트', () => {
  it.each(SEEDS)('① REAL 이면 %s 는 403 이고 서비스를 부르지 않는다', async (m) => {
    const { ctrl, auth } = make('REAL');
    await expect(ctrl[m]()).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth[m]).not.toHaveBeenCalled();
  });

  for (const mode of ['DEV', 'REHEARSAL'] as const) {
    it.each(SEEDS)(`② 대조군 — ${mode} 에서 %s 는 동작한다`, async (m) => {
      const { ctrl, auth } = make(mode);
      await expect(ctrl[m]()).resolves.toEqual({ data: { created: 5 } });
      expect(auth[m]).toHaveBeenCalledTimes(1);
    });
  }
});
