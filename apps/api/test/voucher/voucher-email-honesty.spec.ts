/**
 * 🔴 검진권 발송 정직성 가드 — 2026-08-20.
 *
 * 운영 실측을 그대로 재주입한다:
 *   · Resend 가 4xx/5xx 를 줘도, 예외가 나도 `channel:'SIMULATION'` 으로 접혔다
 *     → 원장 `voucher_allocations.delivery_channel` 에 "모의 발송했다"가 남았다
 *   · 그 결과와 무관하게 `emailedAt = new Date()` 를 찍었다
 *     → 나가지 않은 메일에 "이 시각에 보냈다"는 시각이 박혔다
 *   · 딜러 등록은 `codeSent: true` 를 **상수로** 돌려줬다
 *
 * 재주입 방법(이 파일이 실패해야 가드다):
 *   ① voucher-email 의 FAILED 분기를 `'SIMULATION'` 으로 되돌린다
 *   ② voucher-trade 의 `emailedAt: delivered ? new Date() : null` 을 `new Date()` 로 되돌린다
 *   ③ distributor 의 `codeSent: isVoucherEmailDelivered(...)` 를 `true` 로 되돌린다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoucherEmailService, isVoucherEmailDelivered, VOUCHER_EMAIL_CHANNEL } from '../../src/modules/voucher/voucher-email.service';
import { EgressBlockedError } from '../../src/common/util/safe-fetch';

/**
 * 🔴 모드 스텁 — 이 서비스는 **리얼 모드가 아니면 아무것도 보내지 않는다**(2026-08-26 봉합).
 *    아래 제공자 어휘 테스트들은 **리얼 모드에서만** 의미가 있으므로 REAL 로 고정한다.
 *    (종전엔 인자를 하나만 넘기고도 통과했다 — 목에 없는 것은 부르지 않았기 때문이다.)
 */
const modeOf = (mode: string) => ({ effective: async () => mode }) as never;

const cfg = (provider: string, key?: string) => ({
  get: vi.fn(async (k: string) => (k === 'email.provider' ? provider : k === 'email.resendApiKey' ? key : undefined)),
});
const CODES = [{ serial: 'V-1', activationCode: 'AAAA-BBBB' }];

describe('발송 채널 어휘 — 실패를 "시뮬레이션"이라 부르지 않는다', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('🔴 Resend 가 422 를 주면 FAILED — SIMULATION 이 아니다(원장에 모의발송이 남던 것)', async () => {
    const svc = new VoucherEmailService(cfg('RESEND', 'k') as never, modeOf('REAL'));
    vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({ ok: false, status: 422, text: async () => 'bad', json: async () => ({}) } as never);
    const r = await svc.sendActivationCodes('d@x.example', '딜러', CODES);
    expect(r.channel).toBe('FAILED');
    expect(isVoucherEmailDelivered(r.channel)).toBe(false);
  });

  it('🔴 예외(네트워크)도 FAILED', async () => {
    const svc = new VoucherEmailService(cfg('RESEND', 'k') as never, modeOf('REAL'));
    vi.spyOn(globalThis, 'fetch' as never).mockRejectedValue(new Error('ECONNRESET'));
    const r = await svc.sendActivationCodes('d@x.example', '딜러', CODES);
    expect(r.channel).toBe('FAILED');
  });

  it('목적지 차단은 BLOCKED — 실패와도 구분한다', async () => {
    const svc = new VoucherEmailService(cfg('RESEND', 'k') as never, modeOf('REAL'));
    vi.spyOn(globalThis, 'fetch' as never).mockRejectedValue(new EgressBlockedError('사설 대역'));
    const r = await svc.sendActivationCodes('d@x.example', '딜러', CODES);
    expect(r.channel).toBe('BLOCKED');
    expect(isVoucherEmailDelivered(r.channel)).toBe(false);
  });

  it('설정상 모의만 SIMULATION — 이건 거짓이 아니다', async () => {
    const svc = new VoucherEmailService(cfg('SIMULATION') as never, modeOf('REAL'));
    const r = await svc.sendActivationCodes('d@x.example', '딜러', CODES);
    expect(r.channel).toBe('SIMULATION');
    expect(isVoucherEmailDelivered(r.channel)).toBe(false);
  });

  it('실제 발송만 배달로 센다 — 배달 판정 정본은 하나', () => {
    expect(isVoucherEmailDelivered(VOUCHER_EMAIL_CHANNEL.RESEND)).toBe(true);
    for (const c of ['SIMULATION', 'FAILED', 'BLOCKED', 'PENDING', null, undefined, '']) {
      expect(isVoucherEmailDelivered(c as string)).toBe(false);
    }
  });

  it('딜러 초기설정 코드도 같은 어휘를 쓴다', async () => {
    const svc = new VoucherEmailService(cfg('RESEND', 'k') as never, modeOf('REAL'));
    vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({ ok: false, status: 500, text: async () => '', json: async () => ({}) } as never);
    const r = await svc.sendDealerSetupCode('d@x.example', '딜러', '123456');
    expect(r.channel).toBe('FAILED');
  });
});

/**
 * 🔴 상호작용 점검 Pre-flight(2026-08-26)에서 적발한 것.
 *    이 서비스는 `CrmChannelService` 를 거치지 않고 **Resend API 를 직접** 호출했고,
 *    운영에는 `email.provider=RESEND` 와 실제 키가 설정돼 있었다 —
 *    **리허설 모드에서 검진권·딜러 메일이 진짜로 나가고 있었다.**
 */
describe('🔴 리얼 모드가 아니면 설정과 무관하게 나가지 않는다', () => {
  it('검진권 활성화코드 — REHEARSAL 이면 발신하지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const svc = new VoucherEmailService(cfg('RESEND', 'k') as never, modeOf('REHEARSAL'));
    const r = await svc.sendActivationCodes('a@b.c', '딜러', [{ serial: 'S1', activationCode: 'C1' }]);
    expect(r.channel).toBe('SIMULATION');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('딜러 초기설정 코드 — DEV 여도 발신하지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const svc = new VoucherEmailService(cfg('RESEND', 'k') as never, modeOf('DEV'));
    const r = await svc.sendDealerSetupCode('a@b.c', '딜러', '123456');
    expect(r.channel).toBe('SIMULATION');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('대조군 — REAL 이면 막지 않는다(무조건 차단이면 가드가 헛돈다)', async () => {
    const svc = new VoucherEmailService(cfg('SIMULATION', '') as never, modeOf('REAL'));
    const r = await svc.sendActivationCodes('a@b.c', '딜러', [{ serial: 'S1', activationCode: 'C1' }]);
    // 설정이 SIMULATION 이라 모의로 가되, **모드 차단이 아니라 설정** 때문이다
    expect(r.messageId).not.toMatch(/^mode-blocked/);
  });
});
