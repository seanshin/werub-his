import { KIDS_CHANNEL } from '../pharmacy/kids-reporting';
import { KCDC_CHANNEL, KONIS_CHANNEL } from '../infection-control/external-reporting';
import { HIRA_CHANNEL } from '../hira-edi/hira-transmission';
import { HIE_GATEWAY } from '../hie/hie-transmission';
import { KCCR_CHANNEL } from '../cancer-registry/kccr-reporting';
import { NIMS_CHANNEL } from '../controlled-substance/nims-reporting';
import { EPRESCRIPTION_CHANNEL } from '../prescription-issue/external-rx-transmission';

/**
 * 🔴 대외 발신 채널 등록부 — **관제용 목록이지 새 정본이 아니다.**
 *
 * 기관 전송 채널은 각 모듈이 `{ key, name, implemented, manualFallback }` 로 **이미 선언**하고 있고
 * 그 선언이 정본이다. 여기서는 **그 상수를 그대로 import 해서 모은다** — 값을 다시 적지 않는다
 * (정본이 둘이면 갈라진다). 새로 적는 것은 "이 채널이 어떤 설정 키를 보는가"뿐이다.
 *
 * 왜 필요한가(2026-08-20 실측): 대외로 나가는 통로가 **7파일에 흩어져** 있고,
 * 그중 어느 것이 실제로 나가는지 한눈에 보는 화면이 없었다. 그래서
 * "보고했다/전송했다"는 기록이 코드 곳곳에서 따로 생겼다.
 */
export type ChannelFamily = 'AGENCY' | 'MESSAGE' | 'PATIENT_PUSH';

/** 설정 키 하나(필요하면 그 안의 필드까지) — 발송 코드가 보는 것과 같은 단위로 적는다 */
export interface RequiredConfig {
  key: string;
  /** 값이 객체일 때 반드시 채워져 있어야 하는 필드(예: `smtp.config` 의 `host`) */
  field?: string;
}

export interface OutboundChannelDef {
  key: string;
  name: string;
  family: ChannelFamily;
  /**
   * 실제 전송 구현 여부. `null` = **코드에서 판정할 수 없다**(추측하지 않는다).
   * 🔴 `false` 면 어떤 코드도 '전송 완료'를 적을 수 없다는 뜻이다.
   */
  implemented: boolean | null;
  /** 운영이 켜고 끄는 SystemConfig 키. `null` = 설정이 없다(코드 고정) */
  configKey: string | null;
  /**
   * 🔴 이 채널이 **실제로 나가려면 모두 채워져 있어야 하는** 설정 키들.
   * 발송 코드의 조건을 그대로 옮긴다 — 하나만 보고 "켜졌다"고 말하면 관제가 거짓말한다
   * (실측: `email.provider='RESEND'` 여도 `email.resendApiKey` 가 비면 코드는 시뮬레이션한다).
   */
  requires: RequiredConfig[];
  /** 미구현·미발송 동안 사람이 대신 해야 하는 일 */
  manualFallback: string | null;
  /** 이 채널을 판정한 근거 위치(사람이 따라가 확인할 수 있게) */
  source: string;
}

const agency = (c: { key: string; name: string; implemented: boolean; manualFallback: string }, source: string): OutboundChannelDef => ({
  key: c.key, name: c.name, family: 'AGENCY',
  implemented: c.implemented, configKey: null, requires: [], manualFallback: c.manualFallback, source,
});

export const OUTBOUND_CHANNELS: OutboundChannelDef[] = [
  // ── 기관 전송(법정 보고·청구) — 선언 상수를 그대로 가져온다 ──
  agency(KCDC_CHANNEL, 'infection-control/external-reporting.ts'),
  agency(KONIS_CHANNEL, 'infection-control/external-reporting.ts'),
  agency(HIRA_CHANNEL, 'hira-edi/hira-transmission.ts'),
  agency(HIE_GATEWAY, 'hie/hie-transmission.ts'),
  agency(KCCR_CHANNEL, 'cancer-registry/kccr-reporting.ts'),
  agency(NIMS_CHANNEL, 'controlled-substance/nims-reporting.ts'),
  agency(KIDS_CHANNEL, 'pharmacy/kids-reporting.ts'),
  // 2026-09-30 — 약국 전송은 구현되지 않았다(전달 서비스·법률 검토는 사람 결정 `rx.external.transmission`)
  agency(EPRESCRIPTION_CHANNEL, 'prescription-issue/external-rx-transmission.ts'),

  // ── 메시지 채널 — 정본은 `CrmChannelService.providers` 다 ──
  {
    // 🔴 이메일 경로는 **둘이고 조건이 다르다.** 하나로 뭉치면 관제가 거짓말한다.
    //    ① CRM 범용(Nodemailer) — `smtp.config.host` 가 있어야 나간다
    key: 'EMAIL_SMTP', name: '이메일 — CRM 범용(Nodemailer/SMTP)', family: 'MESSAGE',
    // 🔴 **구현됨이 아니다**(2026-09-02 실측). 발송 코드는 `await import('nodemailer')` 인데
    //    `nodemailer` 가 apps/api/package.json 에 없고 node_modules 에도 없다 → 항상 catch 로 떨어져
    //    `simulated: true` 를 낸다. 그런데 관제는 이걸 '구현 O'로 그렸고, smtp.config.host 만 채우면
    //    '발신 가능'으로 보였다. **설정을 채워도 한 통도 나가지 않는다.**
    //    (대외 발신 3조건 = 구현 + 설정 + 승인 — 여기서 '구현'이 거짓이었다)
    implemented: false, configKey: 'smtp.config', requires: [{ key: 'smtp.config', field: 'host' }],
    manualFallback: 'nodemailer 미설치 — smtp.config 를 채워도 발송되지 않고 시뮬레이션 로그만 남습니다(의존성 도입은 사람 판단)',
    source: 'crm/crm-channel.service.ts sendEmail()',
  },
  {
    //    ② 검진권·딜러 인증코드(Resend) — `email.provider==='RESEND'` **그리고** 키가 있어야 나간다
    key: 'EMAIL_RESEND', name: '이메일 — 검진권·딜러 인증코드(Resend)', family: 'MESSAGE',
    implemented: true, configKey: 'email.provider', requires: [{ key: 'email.provider' }, { key: 'email.resendApiKey' }],
    manualFallback: 'provider=RESEND 와 API 키가 모두 설정돼야 발송됩니다(둘 중 하나만이면 모의 기록)',
    source: 'voucher/voucher-email.service.ts',
  },
  {
    // 🔴 `CrmChannelService.providers` 에 'SMS' 가 **등록돼 있지 않다** — `send('SMS',…)` 는
    //    `simulated:true` 로 돌아온다. 환자 로그인 OTP 가 이 경로를 쓴다.
    key: 'SMS', name: '문자(SMS) — 제공자 미등록', family: 'MESSAGE',
    // 🔴 `implemented: false` 는 **코드에 SMS 제공자가 없다**는 뜻이다.
    //    그래서 `requires` 를 채워 넣어도 켜지지 않는다 — 설정이 아니라 구현이 없는 것이다.
    //    설정 화면은 그 사실을 말하고, 계약·발신번호를 **기록만** 한다.
    implemented: false, configKey: 'sms.provider',
    requires: [{ key: 'sms.provider' }, { key: 'sms.senderNumber' }],
    manualFallback: '제공자가 붙기 전까지 인증번호는 서버 로그에만 남습니다(운영 배포 전 필수)',
    source: 'crm/crm-channel.service.ts (providers 에 SMS 없음)',
  },
  {
    key: 'WHATSAPP', name: 'WhatsApp(스텁)', family: 'MESSAGE',
    implemented: false, configKey: null, requires: [],
    manualFallback: 'WhatsApp Business API 미연동 — 기록만 남습니다',
    source: 'crm/crm-channel.service.ts',
  },
  {
    key: 'WECHAT', name: 'WeChat(스텁)', family: 'MESSAGE',
    implemented: false, configKey: null, requires: [],
    manualFallback: 'WeChat Official Account 미연동 — 기록만 남습니다',
    source: 'crm/crm-channel.service.ts',
  },
  {
    key: 'PORTAL', name: '환자 포털 인앱 기록', family: 'MESSAGE',
    implemented: true, configKey: null, requires: [], manualFallback: null,
    source: 'crm/crm-channel.service.ts',
  },
];

/** 계열 라벨 — 화면이 로컬로 다시 적지 않게 */
export const CHANNEL_FAMILY_LABEL: Record<ChannelFamily, string> = {
  AGENCY: '기관 전송(법정 보고·청구)',
  MESSAGE: '메시지 채널',
  PATIENT_PUSH: '환자 앱 푸시',
};
