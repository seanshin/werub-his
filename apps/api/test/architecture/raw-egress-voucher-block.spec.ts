import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';

/**
 * G3 행동 가드 — 코드 상수 목적지(`https://api.resend.com`)의 차단이
 * "시뮬레이션 발송"으로 기록되지 않는다.
 *
 * 목적지가 코드 상수라 URL 을 주입해 막을 수 없다 → **DNS 리바인딩 상황을 그대로 재현**한다
 * (api.resend.com 이 사설 IP 로 해석되는 경우). `dns/promises` 모킹이 파일 전역이라
 * 이 시나리오만 별도 스펙으로 격리한다.
 *
 * 재주입 검증(실행함): voucher-email 의 `EgressBlockedError` 분기를 지워 SIMULATION 폴백으로
 * 되돌리면 이 스펙이 실패한다(channel 이 'SIMULATION' 이 되어 원장에 '모의 발송했다'는 거짓이 남는다).
 */
vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]),
}));

import { VoucherEmailService } from '../../src/modules/voucher/voucher-email.service';

describe('G3 행동 가드 — 검진권 메일(코드 상수 목적지)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '나가면 안 되는 messageId' }),
      text: async () => 'ok',
    } as never);
    errSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    errSpy.mockRestore();
  });

  /**
   * 🔴 이 가드는 **목적지 차단(egress)** 을 본다 — 모드 차단이 먼저 걸리면 그것을 보지 못한다.
   *    그래서 모드는 REAL 로 고정한다(모드 차단 자체는 `voucher-email-honesty` 가 따로 본다).
   */
  const realMode = () => ({ effective: async () => 'REAL' }) as never;
  const cfg = () => ({
    get: vi.fn(async (k: string) =>
      k === 'email.provider'
        ? 'RESEND'
        : k === 'email.resendApiKey'
          ? 'key'
          : k === 'email.from'
            ? 'a@b.c'
            : null,
    ),
  });
  const blocked = () => errSpy.mock.calls.map((c) => String(c[0])).join('\n');

  it('활성화코드 — 차단은 RESEND 도 SIMULATION 도 아니다(BLOCKED)', async () => {
    const svc = new VoucherEmailService(cfg() as never, realMode());
    const sent = await svc.sendActivationCodes('d@e.f', '딜러', [{ serial: 'S1', activationCode: 'A1' }]);
    // 🔴 'SIMULATION' 이면 voucher_allocations.deliveryChannel 에 '모의 발송했다'는 거짓이 남는다.
    expect(sent.channel).toBe('BLOCKED');
    expect(fetchSpy).not.toHaveBeenCalled(); // 활성화코드가 한 글자도 나가지 않았다
    expect(blocked()).toMatch(/차단/);
  });

  it('딜러 초기설정 인증코드 — 동일(BLOCKED)', async () => {
    const svc = new VoucherEmailService(cfg() as never, realMode());
    const sent = await svc.sendDealerSetupCode('d@e.f', '딜러', '123456');
    expect(sent.channel).toBe('BLOCKED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
