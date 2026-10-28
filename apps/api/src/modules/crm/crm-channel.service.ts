import { Injectable, Logger } from '@nestjs/common';
import { allowsOutboundSend } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HisModeService } from '../../common/his-mode/his-mode.service';

/** 채널 발송 결과 */
interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** 🔴 실제로 나가지 않고 기록만 한 경우 true — 호출부는 이것을 'SENT' 로 기록하면 안 된다 */
  simulated?: boolean;
}

/** 채널 제공자 인터페이스 */
interface ChannelProvider {
  send(to: string, subject: string, content: string): Promise<SendResult>;
}

/**
 * CRM 채널 서비스 — 멀티채널 발송 추상화
 *
 * SMS:      SmsOtpService (기존) → 실제 발송
 * Push:     FcmPushService (기존) → 실제 발송
 * Email:    Nodemailer SMTP → 실제 발송 (SMTP 설정 시)
 * WhatsApp: Stub (향후 WhatsApp Business API 연동)
 * WeChat:   Stub (향후 WeChat Official Account API 연동)
 * Portal:   PatientNotification DB 기록
 */
@Injectable()
export class CrmChannelService {
  private readonly logger = new Logger(CrmChannelService.name);
  private readonly providers = new Map<string, ChannelProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hisMode: HisModeService,
  ) {
    // 이메일 채널 (Nodemailer)
    this.providers.set('EMAIL', {
      send: async (to, subject, content) => this.sendEmail(to, subject, content),
    });

    // WhatsApp 채널 (Stub — 향후 WhatsApp Business API)
    this.providers.set('WHATSAPP', {
      send: async (to, _subject, content) => this.sendWhatsApp(to, content),
    });

    // WeChat 채널 (Stub — 향후 WeChat Official Account)
    this.providers.set('WECHAT', {
      send: async (to, _subject, content) => this.sendWeChat(to, content),
    });

    // Portal 채널 (DB 기록)
    this.providers.set('PORTAL', {
      send: async (to, subject, content) => this.sendPortal(to, subject, content),
    });
  }

  /**
   * 채널별 발송.
   *
   * 🔴 **리얼 모드가 아니면 설정과 무관하게 나가지 않는다.** 리허설 중 실제 문자·메일이
   *    환자에게 도달하는 사고를 막는 것이 이 분기의 전부다. 막되 **막았다는 사실을 그대로 전한다**
   *    (`simulated:true`) — 호출부는 이미 그것을 'SENT' 로 기록하지 않는 규약이다.
   *    (반대로 리얼이라고 발신이 켜졌다는 뜻은 아니다 — 채널별 3조건은 그대로 적용된다.)
   */
  async send(channel: string, to: string, subject: string, content: string): Promise<SendResult> {
    const mode = await this.hisMode.effective();
    if (!allowsOutboundSend(mode)) {
      this.logger.debug(`[${channel}] ${mode} 모드 — 대외 발신 차단(기록만): ${subject}`);
      return { success: true, simulated: true, messageId: `mode-${mode.toLowerCase()}-${Date.now()}` };
    }

    const provider = this.providers.get(channel);
    if (!provider) {
      // 🔴 SMS·PUSH 제공자가 붙어 있지 않다. 종전엔 `success: true` 를 돌려줘 호출부가 'SENT' 로
      //    기록했고, 화면은 "발송 완료"라고 말했다 — 아무것도 나가지 않았는데(2026-08-13 W6).
      //    나가지 않았다는 사실을 그대로 전한다.
      this.logger.debug(`[${channel}] 미구현 채널 — 기록만: ${to} / ${subject}`);
      return { success: true, simulated: true, messageId: `log-${Date.now()}` };
    }

    try {
      return await provider.send(to, subject, content);
    } catch (err) {
      this.logger.error(`[${channel}] 발송 실패: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  /** 해외환자 언어 → 채널 매핑 */
  getChannelForLanguage(lang: string): string {
    switch (lang) {
      case 'zh': return 'WECHAT';  // 중국어 → WeChat
      default: return 'WHATSAPP';  // 기타 → WhatsApp
    }
  }

  // ── 이메일 채널 ──

  private async sendEmail(to: string, subject: string, htmlContent: string): Promise<SendResult> {
    // SMTP 설정 확인
    // 🔴 (2026-09-14) 종전 `.catch(() => null)` — 설정 **조회 실패**가 "SMTP 미설정"으로 번역돼
    //    `success: true, simulated: true` 를 돌려줬다(실패를 시뮬레이션 성공으로 말함). 조회 실패는 실패다.
    let config: { value: unknown } | null;
    try {
      config = await this.prisma.systemConfig.findUnique({ where: { key: 'smtp.config' } });
    } catch (err) {
      this.logger.error(`[EMAIL] smtp.config lookup failed: ${(err as Error).message}`);
      return { success: false, error: 'SMTP_CONFIG_LOOKUP_FAILED' };
    }

    const smtpConfig = config?.value as Record<string, unknown> | null;
    if (!smtpConfig || !smtpConfig.host) {
      // SMTP 미설정 → 시뮬레이션 모드 (로그만) — 나가지 않았음을 호출부에 알린다
      this.logger.log(`[EMAIL-SIM] → ${to}: ${subject}`);
      return { success: true, simulated: true, messageId: `email-sim-${Date.now()}` };
    }

    // Nodemailer 동적 import (설치된 경우만)
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — nodemailer is optional dependency
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host as string,
        port: (smtpConfig.port as number) || 587,
        secure: (smtpConfig.port as number) === 465,
        auth: smtpConfig.user ? {
          user: smtpConfig.user as string,
          pass: smtpConfig.pass as string,
        } : undefined,
      });

      const info = await transporter.sendMail({
        from: (smtpConfig.from as string) || 'noreply@hospital.example.org',
        to,
        subject,
        html: htmlContent,
      });

      this.logger.log(`[EMAIL] → ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      /**
       * 🔴 **'설치 안 됨'과 '발송 실패'는 다른 사실이다**(2026-09-02).
       *    이 catch 는 둘을 하나로 접어, SMTP 인증 실패·호스트 불달도 `simulated: true`
       *    (= "시도하지 않았다")로 보고했다. 실패를 없음으로 번역하는 코드다.
       */
      const msg = err instanceof Error ? err.message : String(err);
      const moduleMissing = /Cannot find module|Failed to resolve|ERR_MODULE_NOT_FOUND/i.test(msg);
      if (moduleMissing) {
        this.logger.log(`[EMAIL-SIM] → ${to}: ${subject} (nodemailer 미설치 — 발송하지 않음)`);
        return { success: true, simulated: true, messageId: `email-sim-${Date.now()}` };
      }
      this.logger.warn(`[EMAIL-FAIL] → ${to}: ${subject} — ${msg}`);
      return { success: false, simulated: false, error: msg };
    }
  }

  // ── WhatsApp 채널 (Stub) ──

  private async sendWhatsApp(to: string, content: string): Promise<SendResult> {
    // TODO: WhatsApp Business API 연동 (https://developers.facebook.com/docs/whatsapp)
    // 🔴 스텁이 `simulated` 없이 `success:true` 를 돌려줬다(2026-08-14 W8). 제공자가 Map 에
    //    등록돼 있어 `send()` 의 '제공자 없음' 분기도 타지 않았고, 호출부는 이걸 그대로
    //    'SENT' 로 적었다 — 해외환자 사후관리 전건이 **실발송 0인데 '발송 완료'**.
    //    나가지 않았다는 사실을 그대로 전한다(W6 EMAIL/미구현 채널과 같은 규약).
    this.logger.log(`[WHATSAPP-SIM] → ${to}: ${content.slice(0, 50)}...`);
    return { success: true, simulated: true, messageId: `wa-sim-${Date.now()}` };
  }

  // ── WeChat 채널 (Stub) ──

  private async sendWeChat(to: string, content: string): Promise<SendResult> {
    // TODO: WeChat Official Account API 연동
    // 🔴 WhatsApp 과 동일 — 스텁이 `simulated` 없이 성공을 반환하던 것(2026-08-14 W8).
    this.logger.log(`[WECHAT-SIM] → ${to}: ${content.slice(0, 50)}...`);
    return { success: true, simulated: true, messageId: `wc-sim-${Date.now()}` };
  }

  // ── Portal 채널 (DB 기록) ──

  private async sendPortal(patientId: string, subject: string, content: string): Promise<SendResult> {
    // PatientNotification에 직접 기록
    // 🔴 종전: 포털 계정이 없어 아무것도 기록하지 못해도, 예외가 나도 `success:true` 였다(fail-open).
    //    포털은 '기록되면 도달'인 채널이므로 **기록 실패는 실패다**(2026-08-14 W8).
    try {
      const account = await this.prisma.patientAccount.findFirst({
        where: { patientId },
      });
      if (!account) {
        return { success: false, error: 'NO_PORTAL_ACCOUNT' }; // 받을 곳이 없다 — 발송이 아니다
      }
      const pn = await this.prisma.patientNotification.create({
        data: {
          accountId: account.id,
          type: 'MARKETING',
          title: subject,
          body: content,
        },
      });
      // 🔴 종전엔 `portal-<타임스탬프>` 였다 — **조회할 수 없는 식별자**다(이 저장소가 이미
      //    두 번 잡은 `<접두어>-<Date.now()>` 형태). 실제로 만들어진 행 id 를 돌려준다.
      return { success: true, messageId: pn.id };
    } catch (err) {
      this.logger.error(`[PORTAL] 기록 실패: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  // ── HTML 이메일 템플릿 ──

  renderEmailTemplate(subject: string, body: string, hospitalName = '위루비병원'): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#2563eb;color:#fff;padding:24px;border-radius:16px 16px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">${hospitalName}</h1>
  </div>
  <div style="background:#fff;padding:32px;border-radius:0 0 16px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
    <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b">${subject}</h2>
    <div style="font-size:14px;line-height:1.8;color:#475569">${body}</div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:11px;color:#94a3b8;text-align:center">본 메일은 마케팅 수신 동의에 따라 발송되었습니다.<br>수신 거부: 환자 포털 > 알림 설정</p>
  </div>
</div>
</body>
</html>`;
  }
}
