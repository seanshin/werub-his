/**
 * 🔴 대외 발신 관제 — 2026-08-20 신설.
 *
 * 배경: 대외 전송 채널이 **7파일에 흩어져** 선언돼 있어 어느 것이 실제로 나가는지 한눈에
 * 볼 수 없었다. 그 결과 "전송했다"는 기록이 코드 곳곳에서 따로 생겼다.
 *
 * 🔴 이 관제는 **판정하지 않는다** — 각 모듈의 채널 상수를 그대로 옮긴다.
 * 값을 여기서 다시 적으면 정본이 둘이 되어 갈라진다(재주입: 등록부에 `implemented: true` 를
 * 하드코딩하면 아래 "선언과 일치" 테스트가 실패한다).
 */
import { describe, it, expect, vi } from 'vitest';
import { OUTBOUND_CHANNELS } from '../../src/modules/outbound-channel/outbound-channel.registry';
import { OutboundChannelService } from '../../src/modules/outbound-channel/outbound-channel.service';
import { HIRA_CHANNEL } from '../../src/modules/hira-edi/hira-transmission';
import { KCDC_CHANNEL, KONIS_CHANNEL } from '../../src/modules/infection-control/external-reporting';
import { NIMS_CHANNEL } from '../../src/modules/controlled-substance/nims-reporting';

describe('등록부 — 채널 선언이 정본이고 관제는 옮기기만 한다', () => {
  it('🔴 기관 채널의 implemented 는 각 모듈 상수와 일치한다(여기서 다시 적지 않는다)', () => {
    const byKey = Object.fromEntries(OUTBOUND_CHANNELS.map((c) => [c.key, c]));
    for (const src of [HIRA_CHANNEL, KCDC_CHANNEL, KONIS_CHANNEL, NIMS_CHANNEL]) {
      expect(byKey[src.key], `${src.key} 가 등록부에 없다`).toBeTruthy();
      expect(byKey[src.key].implemented).toBe(src.implemented);
      expect(byKey[src.key].name).toBe(src.name);
      expect(byKey[src.key].manualFallback).toBe(src.manualFallback);
    }
  });

  it('모든 채널이 근거 위치를 밝힌다 — 사람이 따라가 확인할 수 있어야 한다', () => {
    for (const c of OUTBOUND_CHANNELS) expect(c.source, `${c.key} 에 source 가 없다`).toBeTruthy();
  });

  it('🔴 SMS 는 제공자가 등록돼 있지 않다는 사실을 그대로 말한다', () => {
    const sms = OUTBOUND_CHANNELS.find((c) => c.key === 'SMS');
    expect(sms?.implemented).toBe(false);
    expect(sms?.manualFallback).toContain('로그');
  });
});

describe('effective 판정 — 3상태(발신됨·안 나감·판정 불가)', () => {
  const svc = (get: (k: string) => unknown) =>
    new OutboundChannelService({ get: vi.fn(async (k: string) => get(k)) } as never);

  it('미구현이면 설정과 무관하게 발신되지 않는다', async () => {
    const { channels } = await svc(() => true).list();
    const hira = channels.find((c) => c.key === 'HIRA')!;
    expect(hira.effective).toBe(false);
    expect(hira.blockedBy).toBe('NOT_IMPLEMENTED');
  });

  it('필요한 설정이 모두 채워지면 발신됨', async () => {
    const { channels } = await svc((k) => (k === 'email.provider' ? 'RESEND' : 're_live_key_xxxxx')).list();
    expect(channels.find((c) => c.key === 'EMAIL_RESEND')!.effective).toBe(true);
  });

  it('🔴 provider 만 켜져 있고 키가 비면 발신되지 않는다 — 하나만 보면 관제가 거짓말한다', async () => {
    const { channels } = await svc((k) => (k === 'email.provider' ? 'RESEND' : '')).list();
    const e = channels.find((c) => c.key === 'EMAIL_RESEND')!;
    expect(e.effective).toBe(false);
    expect(e.missingConfig).toContain('email.resendApiKey');
  });

  it('🔴 설정이 SIMULATION 이면 꺼진 것으로 읽는다 — "모의"는 발신이 아니다', async () => {
    const { channels } = await svc(() => 'SIMULATION').list();
    const e = channels.find((c) => c.key === 'EMAIL_RESEND')!;
    expect(e.effective).toBe(false);
    expect(e.blockedBy).toBe('DISABLED_BY_CONFIG');
  });

  it('🔴 SMTP 는 host 를 채워도 나가지 않는다 — nodemailer 미설치(구현 O 가 아니다)', async () => {
    // 🔴 2026-09-02: 종전 이 테스트는 host 만 있으면 `effective: true` 를 기대했다.
    //    그러나 발송 코드는 `await import('nodemailer')` 이고 그 패키지는 선언도 설치도 없다 —
    //    관제가 '발신 가능'이라 말하는 동안 한 통도 나가지 않았다. 구현 선언을 사실에 맞췄다.
    const withHost = await svc(() => ({ host: 'smtp.example.com' })).list();
    const w = withHost.channels.find((c) => c.key === 'EMAIL_SMTP')!;
    expect(w.effective).toBe(false);
    expect(w.blockedBy).toBe('NOT_IMPLEMENTED');
    const noHost = await svc(() => ({ port: 587 })).list();
    const e = noHost.channels.find((c) => c.key === 'EMAIL_SMTP')!;
    expect(e.effective).toBe(false);
    expect(e.missingConfig).toContain('smtp.config.host');
  });

  it('🔴 설정을 읽지 못하면 "꺼짐"이 아니라 판정 불가다', async () => {
    const { channels } = await svc(() => { throw new Error('config down'); }).list();
    const e = channels.find((c) => c.key === 'EMAIL_RESEND')!;
    expect(e.enabled).toBeNull();
    expect(e.effective).toBeNull();
    expect(e.blockedBy).toBeNull();
  });

  it('발신 건수를 지어내지 않고, 담지 않은 이유를 밝힌다', async () => {
    const r = await svc(() => true).list();
    expect(r.caveat).toContain('발신 건수');
    expect(Object.keys(r.channels[0])).not.toContain('sentCount');
  });
});

/**
 * 🔴 기관 연동은 **별도 메뉴로 관리한다** (2026-08-20 사람 결정).
 *
 * 기관 전송은 법정 의무이고 대외 계약·인증서가 선행하며, **실 서비스 개시 전까지 구현되어 있으면 된다**
 * — 지금 미구현은 결함이 아니라 예정된 상태다. 그래서 메시지 채널·환자 푸시와 한 화면에 섞지 않는다.
 *
 * 재주입: `list()` 를 다시 전체 목록으로 되돌리면(=기관 전송이 발신 관제에 섞이면) 실패한다.
 */
describe('기관 연동 분리 — 발신 관제에 섞이지 않는다', () => {
  const svc = () => new OutboundChannelService({ get: vi.fn(async () => null) } as never);

  it('🔴 발신 관제에는 기관 전송이 나오지 않는다', async () => {
    const { channels } = await svc().list('NON_AGENCY');
    expect(channels.some((c) => c.family === 'AGENCY'), '기관 전송이 발신 관제에 섞였다').toBe(false);
    expect(channels.some((c) => c.key === 'EMAIL_RESEND')).toBe(true);
  });

  it('기관 연동 목록은 기관 전송만 낸다', async () => {
    const { channels } = await svc().listAgency();
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.every((c) => c.family === 'AGENCY')).toBe(true);
  });

  it('🔴 담당·개시 추적은 Go-Live 등록부와 연결한다 — 여기서 다시 적지 않는다', async () => {
    const { channels } = await svc().listAgency();
    const hira = channels.find((c) => c.key === 'HIRA')!;
    expect(hira.goLive, 'HIRA 가 Go-Live 등록부에 연결되지 않았다').toBeTruthy();
    expect(hira.goLive!.key).toBe('integ.hiraSubmit');
    expect(hira.goLive!.owner).toBeTruthy();
  });

  it('🔴 등재되지 않은 채널은 "추적 중"이라 지어내지 않는다(null)', async () => {
    const { channels } = await svc().listAgency();
    // 등재 여부는 사실 그대로 — 전부 등재됐으면 전부 non-null, 아니면 null 이 그대로 보인다
    for (const c of channels) {
      expect(c.goLive === null || typeof c.goLive?.key === 'string').toBe(true);
    }
  });

  it('미구현이 현재 결함이 아님을 문구가 말한다 — 실 서비스 개시 전 완료 대상', async () => {
    const r = await svc().listAgency();
    expect(r.caveat).toContain('개시 전');
    expect(r.caveat).toContain('수기');
  });
});

describe('외부 전송 경로(T10-4) — 관제 응답은 shared 정본을 옮기기만 한다', () => {
  it('🔴 routes·summary 는 shared EGRESS_ROUTES·egressSummary() 와 같고 판정은 없다', async () => {
    const { EGRESS_ROUTES, egressSummary } = await import('@hospital-run/shared');
    const r = new OutboundChannelService().egressInventory();
    expect(r.routes).toBe(EGRESS_ROUTES);
    expect(r.summary).toEqual(egressSummary());
    expect(r.summary.verdict).toBeNull();
    expect(r.summary.unknown).toBeGreaterThan(0);
    expect(r.verdictNote).toContain('판정하지 않았습니다');
  });
});
