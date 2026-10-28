import { Injectable, Logger } from '@nestjs/common';
import { allowsOutboundSend } from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { publicBaseUrl } from '../../common/util/public-url';
import { safeFetch, EgressBlockedError } from '../../common/util/safe-fetch';

interface CodeRow {
  serial: string;
  activationCode: string;
}

// 검진권 활성화코드 이메일 — 채널분리(시리얼/배분=시스템, 코드=이메일).
// Resend(설정 시) 또는 시뮬레이션(기본·미설정/실패 시 폴백). config: email.provider/email.resendApiKey/email.from

/**
 * 🔴 발송 결과 어휘 정본 — `deliveryChannel` 에 남는 값이자 화면이 읽는 값.
 *
 * 2026-08-20 이전엔 **Resend 4xx/5xx 도, 예외도 `SIMULATION` 으로 접었다.** 그래서
 * 원장(`voucher_allocations.delivery_channel`)에 "모의 발송했다"가 남고, 발급 화면은
 * 그것을 "✅ 발송 · 시뮬레이션 기록"으로 렌더했다 — 딜러는 활성화코드를 못 받았는데
 * 관리자 화면은 성공이라고 말했다. 실패는 실패라고 부른다(FAILED).
 *
 *   SIMULATION = 설정상 모의(email.provider!==RESEND 또는 키 없음) — 이건 사실이다
 *   RESEND     = 실제로 나갔다(유일한 배달 성공)
 *   FAILED     = 상류가 거절했거나 예외 — 나가지 않았다
 *   BLOCKED    = 목적지 검증(SSRF 방어)에 걸렸다 — 나가지 않았다
 */
export const VOUCHER_EMAIL_CHANNEL = {
  SIMULATION: 'SIMULATION',
  RESEND: 'RESEND',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
} as const;

/**
 * 🔴 "실제로 수신자에게 나갔는가" — 이 판정의 정본은 여기 하나다.
 * 호출부·화면이 각자 `channel === 'RESEND'` 를 다시 쓰면 어휘가 늘 때 갈라진다.
 */
export function isVoucherEmailDelivered(channel: string | null | undefined): boolean {
  return channel === VOUCHER_EMAIL_CHANNEL.RESEND;
}

@Injectable()
export class VoucherEmailService {
  private readonly logger = new Logger(VoucherEmailService.name);
  constructor(
    private readonly config: ConfigRuntimeService,
    private readonly hisMode: HisModeService,
  ) {}

  /**
   * 🔴 **리얼 모드가 아니면 설정과 무관하게 나가지 않는다.**
   *
   * 2026-08-26 상호작용 점검 Pre-flight 에서 적발: 이 서비스는 `CrmChannelService` 를 거치지 않고
   * **Resend API 를 직접 호출**하고 있었고, 운영에는 `email.provider=RESEND` 와 실제 키가 설정돼
   * 있었다 — 즉 **리허설 모드에서 검진권·딜러 메일이 진짜로 나가고 있었다.**
   * v4.8.0 에 "발신 차단은 `CrmChannelService.send()` **한 지점뿐**"이라고 적어 둔 그대로였다.
   *
   * 막되 **막았다는 사실을 그대로 전한다** — 호출부는 `SIMULATION` 을 'SENT' 로 기록하지 않는다.
   */
  private async blockedByMode(): Promise<boolean> {
    return !allowsOutboundSend(await this.hisMode.effective());
  }

  async sendActivationCodes(to: string, dealerName: string, codes: CodeRow[]): Promise<{ channel: string; messageId: string }> {
    const provider = String((await this.config.get('email.provider')) ?? 'SIMULATION').toUpperCase();
    const apiKey = (await this.config.get('email.resendApiKey')) as string | undefined;
    const from = ((await this.config.get('email.from')) as string) || 'WERUBYHOSP 검진권 <noreply@example.org>';
    const subject = `[WERUBYHOSP] 검진권 활성화코드 ${codes.length}건 — 포털에서 수령확인하세요`;
    const html = this.buildHtml(dealerName, codes);

    // 🔴 모드 차단이 설정보다 앞선다 — 리허설에서 설정이 켜져 있어도 나가지 않는다
    if (await this.blockedByMode()) {
      this.logger.log(`[VOUCHER-EMAIL-MODE] → ${to}: 리얼 모드가 아니라 발신하지 않음(${codes.length}건)`);
      return { channel: 'SIMULATION', messageId: `mode-blocked-${codes.length}` };
    }
    // 시뮬레이션(기본) — 발송내역만 기록(감사). 실 SMTP는 email.provider=RESEND + resendApiKey 설정 시.
    if (provider !== 'RESEND' || !apiKey) {
      this.logger.log(`[VOUCHER-EMAIL-SIM] → ${to}: ${codes.length}건 활성화코드 (provider=${provider})`);
      return { channel: 'SIMULATION', messageId: `sim-${codes.length}-${codes[0]?.serial ?? 'none'}` };
    }
    try {
      const res = await safeFetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, subject, html }),
        },
        { timeoutMs: 8000 },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        this.logger.error(`Resend 발송 실패 ${res.status}: ${t.slice(0, 200)}. 발송되지 않았습니다.`);
        return { channel: VOUCHER_EMAIL_CHANNEL.FAILED, messageId: `failed-${res.status}` };
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      this.logger.log(`[VOUCHER-EMAIL] Resend → ${to}: ${body.id ?? 'ok'}`);
      return { channel: 'RESEND', messageId: body.id ?? 'resend' };
    } catch (e) {
      // 🔴 차단은 "시뮬레이션 발송"이 아니다 — SIMULATION 으로 접으면 deliveryChannel 에
      //    '모의 발송했다'는 거짓이 남는다. 별도 채널(BLOCKED)로 실패를 실패라고 말한다.
      if (e instanceof EgressBlockedError) {
        this.logger.error(`검진권 활성화코드 메일 송신 차단(SSRF 방어): ${e.message}. 발송되지 않았습니다.`);
        return { channel: 'BLOCKED', messageId: 'blocked' };
      }
      this.logger.error(`Resend 예외: ${(e as Error).message}. 발송되지 않았습니다.`);
      return { channel: VOUCHER_EMAIL_CHANNEL.FAILED, messageId: 'failed-exception' };
    }
  }

  /** 딜러 초기설정 인증코드 — 관리자 등록 시 발송. 딜러가 코드로 비밀번호를 등록. */
  async sendDealerSetupCode(to: string, dealerName: string, code: string): Promise<{ channel: string; messageId: string }> {
    const provider = String((await this.config.get('email.provider')) ?? 'SIMULATION').toUpperCase();
    const apiKey = (await this.config.get('email.resendApiKey')) as string | undefined;
    const from = ((await this.config.get('email.from')) as string) || 'WERUBYHOSP 검진권 <noreply@example.org>';
    const portal = ((await this.config.get('email.dealerPortalUrl')) as string) || `${publicBaseUrl()}/distributor`;
    const subject = '[WERUBYHOSP] 딜러 포털 초기설정 — 인증코드로 비밀번호를 등록하세요';
    const html = `<div style="font-family:sans-serif;max-width:560px">
      <h2>딜러 포털 계정 초기설정</h2>
      <p>${dealerName} 귀하의 딜러 포털 계정이 생성되었습니다. 아래 <b>인증코드</b>로 비밀번호를 등록하세요.</p>
      <div style="font-family:monospace;font-size:24px;font-weight:bold;letter-spacing:3px;padding:12px 16px;background:#f3f4f6;border-radius:8px;display:inline-block">${code}</div>
      <p style="margin-top:12px">포털 <a href="${portal}">${portal}</a> 에서 '초기 설정/비밀번호 등록'을 선택하고, 이메일·인증코드·새 비밀번호를 입력하세요.</p>
      <p style="color:#888;font-size:12px">인증코드는 7일간 유효합니다. 본인이 요청하지 않았다면 무시하세요.</p>
    </div>`;

    // 🔴 모드 차단이 설정보다 앞선다
    if (await this.blockedByMode()) {
      this.logger.log(`[DEALER-SETUP-MODE] → ${to}: 리얼 모드가 아니라 발신하지 않음`);
      return { channel: 'SIMULATION', messageId: `mode-blocked-setup` };
    }
    if (provider !== 'RESEND' || !apiKey) {
      this.logger.log(`[DEALER-SETUP-SIM] → ${to}: code (provider=${provider})`);
      return { channel: 'SIMULATION', messageId: `sim-setup-${to}` };
    }
    try {
      const res = await safeFetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, subject, html }),
        },
        { timeoutMs: 8000 },
      );
      if (!res.ok) { this.logger.error(`Resend setup 실패 ${res.status}. 발송되지 않았습니다.`); return { channel: VOUCHER_EMAIL_CHANNEL.FAILED, messageId: `failed-setup-${res.status}` }; }
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      this.logger.log(`[DEALER-SETUP] Resend → ${to}: ${body.id ?? 'ok'}`);
      return { channel: 'RESEND', messageId: body.id ?? 'resend' };
    } catch (e) {
      if (e instanceof EgressBlockedError) {
        this.logger.error(`딜러 인증코드 메일 송신 차단(SSRF 방어): ${e.message}. 발송되지 않았습니다.`);
        return { channel: 'BLOCKED', messageId: 'blocked' };
      }
      this.logger.error(`Resend setup 예외: ${(e as Error).message}. 발송되지 않았습니다.`);
      return { channel: VOUCHER_EMAIL_CHANNEL.FAILED, messageId: 'failed-setup-exception' };
    }
  }

  private buildHtml(dealerName: string, codes: CodeRow[]): string {
    const rows = codes
      .map(
        (c) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace">${c.serial}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-weight:bold">${c.activationCode}</td></tr>`,
      )
      .join('');
    return `<div style="font-family:sans-serif;max-width:640px">
      <h2>검진권 활성화코드 전달</h2>
      <p>${dealerName} 귀하, 배분된 검진권의 활성화코드를 전달드립니다.</p>
      <p style="color:#b91c1c"><b>딜러 포털에 로그인하여 아래 활성화코드를 입력해 수령확인(활성화)해야 판매가 가능합니다.</b></p>
      <table style="border-collapse:collapse;width:100%;margin-top:12px"><thead><tr><th style="text-align:left;padding:6px 12px;border-bottom:2px solid #333">시리얼</th><th style="text-align:left;padding:6px 12px;border-bottom:2px solid #333">활성화코드</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="color:#888;font-size:12px;margin-top:16px">본 코드는 외부 유출에 주의하세요. 활성화코드는 구매자(외국인 환자)의 검진권 활성화에도 사용됩니다.</p>
    </div>`;
  }
}
