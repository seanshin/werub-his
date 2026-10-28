import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  HIE_GATEWAY,
  HIE_STATUS,
  RETRANSMITTABLE_STATUSES,
  classifyHieTransmission,
  localHieRef,
  hieNotTransmittedLog,
} from '../../src/modules/hie/hie-transmission';

/**
 * 구조 가드 (화면 실사용 점검 W8 잔여배치·P16) — **나가지 않은 것을 나갔다고 적지 못하게 막는다.**
 *
 * `test/architecture/honest-reporting-guard.spec.ts` 와 **같은 판정**을 쓴다(정본은 늘리지 않는다).
 * 저 파일은 "발송 제공자가 없으면 SENT 가 아니다"를 채널(SMS·이메일·포털) 관점에서 막고,
 * 이 파일은 그 규약을 **외부 기관 전송·이벤트 기반 재전송**까지 확장한다.
 *
 * 이 배치에서 실제로 나온 형태 네 가지:
 *  H1 진료정보교류(HIE) — 전송 코드가 없는데 전건 `status:'SENT'` · `sentAt:now`(법정 CDA 반출 대장이 거짓)
 *  H2 예약 알림 — 어댑터가 없는데 config 를 켜면 로그가 '실발송'
 *  H3 접수 동의 포털 요청 — 포털 계정이 없어 아무것도 못 만들고도 '전송되었습니다'
 *  H4 동의서 재전송 — 리스너 결과를 보지 않고 '재전송되었습니다'
 *
 * 정본:
 *  - 외부 기관 보고형: modules/infection-control/external-reporting.ts (LOCAL_RECORDED · sentAt null · 재시도 가능)
 *  - 채널 발송형:     modules/crm/crm-channel.service.ts (success/simulated → SENT/SIMULATED/FAILED)
 */

const API_SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(API_SRC, ...p), 'utf8');

/** 주석은 규약을 설명하는 자리다 — 스캔 대상에서 뺀다(설명문이 위반으로 잡히면 가드를 못 쓴다) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const OWNED = [
  ['modules', 'hie', 'hie.service.ts'],
  ['modules', 'hie', 'hie-transmission.ts'],
  ['modules', 'schedule', 'schedule.service.ts'],
  ['modules', 'registration-consent', 'registration-consent.service.ts'],
  ['modules', 'consent', 'consent.service.ts'],
];

describe('① 전송 코드가 없으면 SENT 를 적지 않는다', () => {
  it('HIE 게이트웨이는 미구현으로 선언돼 있다 (연동이 붙는 날 이 값만 바꾼다)', () => {
    // 이 값이 true 로 바뀌는 순간 아래 가드들의 의미가 달라진다 — 실제 전송 코드와 함께만 바꿀 것.
    expect(HIE_GATEWAY.implemented).toBe(false);
    expect(HIE_GATEWAY.manualFallback.length).toBeGreaterThan(0);
  });

  it('🔴 hie.service 에 SENT 문자열 리터럴이 없다 (상태 어휘는 HIE_STATUS 정본에서만)', () => {
    const src = stripComments(read('modules', 'hie', 'hie.service.ts'));
    expect(src).not.toMatch(/status:\s*'SENT'/);
    expect(src).not.toMatch(/\?\s*'SENT'\s*:/); // 종전 `sendResult.success ? 'SENT' : 'FAILED'`
  });

  it('🔴 SENT 쓰기는 게이트웨이 미구현 조기반환 **뒤에만** 있다', () => {
    const src = stripComments(read('modules', 'hie', 'hie.service.ts'));
    const guardAt = src.indexOf('if (!HIE_GATEWAY.implemented)');
    expect(guardAt, '게이트웨이 미구현 분기를 찾지 못했다').toBeGreaterThan(-1);

    const sentWrite = src.indexOf('status: HIE_STATUS.SENT');
    expect(sentWrite, 'SENT 쓰기를 찾지 못했다(구조가 바뀌었으면 가드도 갱신할 것)').toBeGreaterThan(-1);
    expect(sentWrite).toBeGreaterThan(guardAt);
  });

  it('🔴 게이트웨이 호출부는 미구현 상태에서 조용히 성공하지 않는다', () => {
    const src = stripComments(read('modules', 'hie', 'hie.service.ts'));
    const fn = src.slice(src.indexOf('private async postToGateway'));
    expect(fn).toMatch(/throw new Error/);
  });

  it('소유 파일 어디에도 "전송 완료"를 자인 문구와 함께 적지 않는다', () => {
    // 🔴 종전 반환값: '교류 문서 전송 완료 (게이트웨이 연동 대기)' — 문장 안에서 스스로 미구축을 자백했다.
    for (const p of OWNED) {
      const src = stripComments(read(...p));
      expect(src, `${p.join('/')} 에 자인형 완료 문구가 남아 있다`).not.toMatch(/전송 완료.*연동 대기/);
    }
  });
});

describe('② 나가지 않았으면 sentAt 은 null 이다', () => {
  it('🔴 hie.service 는 sentAt 에 `new Date()` 를 직접 박지 않는다', () => {
    const src = stripComments(read('modules', 'hie', 'hie.service.ts'));
    expect(src).not.toMatch(/sentAt:\s*new Date\(\)/);
  });

  it('미전송 판정에는 도달 시각이 없다', () => {
    const info = classifyHieTransmission({ direction: 'SEND', status: HIE_STATUS.LOCAL_RECORDED });
    expect(info.transmitted).toBe(false);
  });

  it('원내 관리번호는 기관 부여 번호가 아님을 접두어로 드러낸다', () => {
    expect(localHieRef(new Date())).toMatch(/^LOCAL-HIE-/);
    expect(hieNotTransmittedLog(new Date())).toMatch(/^\[미전송\]/);
  });
});

describe('③ 미전송은 재전송 대상에 남는다', () => {
  it('미전송·실패·대기는 모두 재전송 가능', () => {
    for (const s of [HIE_STATUS.PENDING, HIE_STATUS.LOCAL_RECORDED, HIE_STATUS.SEND_FAILED, 'FAILED']) {
      expect(RETRANSMITTABLE_STATUSES).toContain(s);
      expect(classifyHieTransmission({ direction: 'SEND', status: s }).retransmittable).toBe(true);
    }
  });

  it('🔴 근거 없는 과거 SENT 도 재전송 대상이다 (진짜 연동이 붙는 날 영구 누락되면 안 된다)', () => {
    const info = classifyHieTransmission({ direction: 'SEND', status: 'SENT', sentAt: new Date() });
    expect(info.state).toBe('UNVERIFIED');
    expect(info.transmitted).toBe(false);
    expect(info.retransmittable).toBe(true);
  });

  it('저장값을 바꾸지 않고 읽는 쪽에서만 분류한다 — 수신은 도달로 읽는다', () => {
    const rx = classifyHieTransmission({ direction: 'RECEIVE', status: HIE_STATUS.RECEIVED });
    expect(rx.transmitted).toBe(true);
    expect(rx.state).toBe('RECEIVED');
  });
});

describe('④ 받을 곳이 없으면 success:false — 포털 경로 정본 준수', () => {
  /**
   * 🔴 정본은 `CrmChannelService.sendPortal`(NO_PORTAL_ACCOUNT → success:false).
   *    같은 형태가 접수 동의 요청(H3)·동의서 재전송(H4)에 남아 있었다.
   */
  const canonical = read('modules', 'crm', 'crm-channel.service.ts');

  it('정본이 NO_PORTAL_ACCOUNT 를 실패로 판정한다(가드가 헛돌지 않게)', () => {
    expect(canonical).toMatch(/NO_PORTAL_ACCOUNT/);
    expect(canonical).toMatch(/success:\s*false,\s*error:\s*'NO_PORTAL_ACCOUNT'/);
  });

  it.each([
    ['modules/registration-consent/registration-consent.service.ts', ['modules', 'registration-consent', 'registration-consent.service.ts'], 'sendPortalRequest'],
    ['modules/consent/consent.service.ts', ['modules', 'consent', 'consent.service.ts'], 'resendNotification'],
  ])('%s 의 %s 는 수신처가 없으면 실패로 답한다', (_rel, p, fnName) => {
    const src = stripComments(read(...(p as string[])));
    const start = src.indexOf(`async ${fnName}(`);
    expect(start, `${fnName} 을 찾지 못했다`).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }', start));

    expect(body, '포털 계정 존재 확인이 없다').toMatch(/patientAccount\.findFirst/);
    expect(body, 'NO_PORTAL_ACCOUNT 판정이 없다').toMatch(/NO_PORTAL_ACCOUNT/);
    expect(body, 'success:false 경로가 없다').toMatch(/success:\s*false/);
    // 조건 없는 무조건 성공 반환이 남아 있으면 안 된다(첫 return 이 성공이면 그게 종전 형태다)
    const firstReturn = body.indexOf('return {');
    const firstFalse = body.indexOf('success: false');
    expect(firstFalse, 'success:false 가 성공 반환보다 뒤에 있다').toBeLessThan(
      body.indexOf('success: true') === -1 ? Number.MAX_SAFE_INTEGER : body.indexOf('success: true'),
    );
    expect(firstReturn).toBeGreaterThan(-1);
  });

  it('🔴 동의서 재전송은 이벤트만 던지고 끝내지 않는다 — 산출물을 확인한다', () => {
    const src = stripComments(read('modules', 'consent', 'consent.service.ts'));
    const start = src.indexOf('async resendNotification(');
    const body = src.slice(start, src.indexOf('\n  }', start));
    expect(body).toMatch(/emitAsync/);
    expect(body, '리스너가 만들었어야 할 알림을 확인하지 않는다').toMatch(/patientNotification\.findFirst/);
    expect(body).toMatch(/NOTIFICATION_NOT_CREATED/);
  });
});

describe('⑤ 설정을 켜도 로그는 실제 동작과 일치한다 (예약 알림)', () => {
  const src = stripComments(read('modules', 'schedule', 'schedule.service.ts'));

  it('발송 어댑터가 미구현으로 선언돼 있다', () => {
    expect(src).toMatch(/APPOINTMENT_NOTIFY_ADAPTER\s*=\s*\{[\s\S]*?implemented:\s*false/);
  });

  it('🔴 config 만 보고 "실발송" 이라고 적지 않는다', () => {
    const start = src.indexOf('async onAppointmentNotify(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }', start));

    // 종전 형태: `[예약알림${send ? '·실발송(어댑터)' : '·시뮬'}]`
    expect(body, 'config 값으로 실발송 여부를 문자열 보간했다').not.toMatch(/\?\s*'·실발송/);

    const guardAt = body.indexOf('if (!APPOINTMENT_NOTIFY_ADAPTER.implemented)');
    expect(guardAt, '어댑터 미구현 분기가 없다').toBeGreaterThan(-1);
    const sentLog = body.indexOf('실발송');
    if (sentLog > -1) expect(sentLog, "'실발송' 로그가 미구현 분기보다 앞에 있다").toBeGreaterThan(guardAt);
  });

  it('🔴 어댑터가 없는 채로 발송 TODO 뒤에 성공을 적지 않는다', () => {
    const start = src.indexOf('async onAppointmentNotify(');
    const body = src.slice(start, src.indexOf('\n  }', start));
    expect(body).not.toMatch(/TODO/);
  });

  it('이 배치는 config 를 켜지 않는다 — 기본값 OFF 유지', () => {
    // appointment.reminder.send 의 기본값을 코드가 true 로 바꾸지 않았는지 확인
    expect(src).not.toMatch(/appointment\.reminder\.send[^\n]*true\s*\)/);
  });
});
