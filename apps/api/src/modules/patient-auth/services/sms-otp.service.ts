import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CrmChannelService } from '../../crm/crm-channel.service';
import { maskPhone } from '../../patient/patient-field-mask';
import { readSmsHeader } from '../../config/hospital-facts';

/**
 * 발송 판정 3분류 — 정본은 `modules/crm/crm-channel.service.ts` 의 `SendResult`.
 * W6(CRM 리마인더)·W8(해외환자·온보딩·문진·봇)이 전부 이 판정으로 수렴했고, OTP 가 마지막 갈래다.
 */
export type OtpDelivery = 'SENT' | 'SIMULATED' | 'FAILED';

export interface OtpSendResult {
  /** 🔴 **실제로 문자가 나간 경우에만** true. 종전엔 제공자 유무와 무관하게 늘 true 였다. */
  sent: boolean;
  delivery: OtpDelivery;
  /** 화면이 그대로 말할 수 있는 사실 문장(서버가 사실을 실어 보낸다) */
  message: string;
  /** 인증번호 유효시간 — 화면 카운트다운용. **인증번호 자체는 절대 담지 않는다.** */
  expiresInSeconds: number;
}

@Injectable()
export class SmsOtpService {
  private readonly logger = new Logger(SmsOtpService.name);
  private readonly OTP_TTL_MINUTES = 3;
  private readonly MAX_ATTEMPTS = 5;
  private readonly MAX_DAILY_SENDS = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly channel: CrmChannelService,
  ) {}

  /**
   * OTP 발송.
   *
   * 🔴 2026-08-14 W8(P16) — 종전 구현은 SMS 제공자가 **없어도** `{ sent: true }` 를 돌려줬다.
   *    인증번호는 서버 로그에만 찍혔고, 환자는 "인증번호를 보냈습니다"를 보고 **오지 않는 문자를**
   *    기다렸다. `SMS_API_KEY` 가 있으면 주석 `// TODO: 알리고 API 연동` 만 두고 역시 `sent: true` —
   *    키를 넣는 순간(=운영에 가까워질수록) 한 통도 안 보내고 전건 "발송 완료"가 되는 구조였다.
   *
   * 🔴 다만 여기서 fail-closed 로 막으면 **환자가 아예 로그인하지 못한다**(현 환경엔 SMS 제공자가 없다).
   *    → 차단이 아니라 **정직**이 답이다: OTP 는 계속 발급·검증되고(로그인 흐름 유지),
   *      "나갔는지 / 흉내만 냈는지 / 실패했는지"를 응답에 그대로 실어 화면이 사실을 말하게 한다.
   *
   * 🔴 인증번호는 **응답 본문에 절대 담지 않는다**(개발 편의로도 안 된다 — 그건 인증 우회다).
   *    미발송일 때만 서버 로그에 남긴다(종전부터 이것이 개발·데모의 유일한 확인 경로였다).
   */
  async send(phone: string, purpose: string, ipAddress?: string): Promise<OtpSendResult> {
    // 일일 발송 제한 확인
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const dailyCount = await this.prisma.smsVerification.count({
      where: { phone, purpose, createdAt: { gte: todayStart } },
    });
    if (dailyCount >= this.MAX_DAILY_SENDS) {
      throw new BadRequestException('일일 인증 발송 횟수를 초과했습니다. 내일 다시 시도해주세요.');
    }

    // 최근 1분 내 발송 확인 (중복 방지)
    const recentSend = await this.prisma.smsVerification.findFirst({
      where: { phone, purpose, createdAt: { gte: new Date(Date.now() - 60000) } },
    });
    if (recentSend) {
      throw new BadRequestException('1분 후에 다시 요청해주세요.');
    }

    // 🔴 SMS 머리말은 정본 기관명(DB 행만) — 종전엔 '[Hospital RUN]' 상수였다. 미설정이면 머리말 없이 보낸다(지어내지 않는다).
    //    인증번호 행을 만들기 **전에** 읽는다(조회 실패가 전파될 때 쓰이지 않을 인증번호가 남지 않게).
    const header = await readSmsHeader(this.prisma);

    // OTP 생성
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + this.OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.smsVerification.create({
      data: { phone, code, purpose, expiresAt, ipAddress },
    });

    // 발송 판정은 정본(CrmChannelService)에 맡긴다 — 새 채널 구현을 만들지 않는다.
    // SMS 제공자는 아직 등록돼 있지 않으므로 현재 결과는 SIMULATED(=나가지 않음)이다.
    const body = `${header}인증번호 ${code} (${this.OTP_TTL_MINUTES}분 이내 입력)`;
    const r = await this.channel
      .send('SMS', phone, '인증번호 안내', body)
      .catch(() => ({ success: false, simulated: false }));
    const delivery: OtpDelivery = !r.success ? 'FAILED' : r.simulated ? 'SIMULATED' : 'SENT';

    if (delivery !== 'SENT') {
      // 🔴 "SMS sent" 라고 적지 않는다 — 나가지 않았다. 전화번호는 마스킹(PHI 로그 노출 규약).
      //    인증번호는 미발송일 때만 남긴다: 이것을 지우면 제공자가 붙기 전까지 로그인이 불가능해진다.
      this.logger.warn(
        `[OTP-${delivery}] ${maskPhone(phone)} / ${purpose} — 문자가 실제로 발송되지 않았습니다. 개발·데모용 인증번호: ${code}`,
      );
    } else {
      this.logger.log(`[OTP-SENT] ${maskPhone(phone)} / ${purpose}`);
    }

    return {
      sent: delivery === 'SENT',
      delivery,
      message:
        delivery === 'SENT' ? '인증번호를 문자로 발송했습니다.'
        : delivery === 'SIMULATED' ? '문자 발송 경로가 없어 인증번호가 실제로 발송되지 않았습니다. 관리자에게 문의하세요.'
        : '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      expiresInSeconds: this.OTP_TTL_MINUTES * 60,
    };
  }

  /** OTP 검증 */
  async verify(phone: string, code: string, purpose: string): Promise<boolean> {
    const otp = await this.prisma.smsVerification.findFirst({
      where: { phone, purpose, verified: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('인증번호를 먼저 요청해주세요.');
    if (otp.expiresAt < new Date()) throw new BadRequestException('인증번호가 만료되었습니다. 다시 요청해주세요.');
    if (otp.attempts >= this.MAX_ATTEMPTS) throw new BadRequestException('인증 시도 횟수를 초과했습니다. 새 인증번호를 요청해주세요.');

    // 시도 횟수 증가
    await this.prisma.smsVerification.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });

    if (otp.code !== code) {
      throw new BadRequestException(`인증번호가 일치하지 않습니다. (${this.MAX_ATTEMPTS - otp.attempts - 1}회 남음)`);
    }

    // 인증 성공
    await this.prisma.smsVerification.update({
      where: { id: otp.id },
      data: { verified: true },
    });

    return true;
  }

  /** 만료된 OTP 정리 (cron용) */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.smsVerification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
