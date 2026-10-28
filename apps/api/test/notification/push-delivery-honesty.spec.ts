import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 환자 푸시 도달 정직성 (2026-08-28 · 발굴 5회차).
 *
 * 🔴 **인앱 알림 기록과 단말 푸시는 다른 층이다.** FCM 자격이 없거나 발송이 실패해도
 *    인앱 알림 행은 만들어진다 — 그것을 "보냈다"로 말하면 접수 데스크가 환자 폰이
 *    울린 줄 알고 기다린다.
 *
 * 🔴 **정본은 이미 있었다** — `PatientPushGateService.deliver()` 가
 *    `pushChannel: ATTEMPTED|UNAVAILABLE` 로 같은 사실을 말한다.
 *    도착 확인 호출만 그 정본을 우회해 언제나 `sent: true` 를 냈다.
 */
const api = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const web = (p: string) => readFileSync(join(process.cwd(), '../web/src', p), 'utf8');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 도착 확인 호출이 "폰에 갔다"고 단정하지 않는다', () => {
  const SVC = strip(api('modules/schedule/schedule.service.ts'));

  it('FCM 자격 유무를 응답에 싣는다', () => {
    // 🔴 **반환문을 겨눈다.** 파일 전체에서 `pushChannel` 을 찾으면 변수 선언과 로그 문자열이
    //    검사를 대신 통과한다 — 실제로 반환문에서 지웠는데 통과했다(재주입이 잡았다).
    expect(SVC, '응답에 pushChannel 이 없으면 화면이 알 길이 없다')
      .toMatch(/return \{[^}]*notificationId: pn\.id[^}]*pushChannel[^}]*\}/);
    expect(SVC).toMatch(/this\.fcmPush\?\.isEnabled/);
    expect(SVC).toMatch(/'UNAVAILABLE'/);
  });

  it('🔴 정본과 같은 어휘를 쓴다 — 같은 사실에 말이 둘이면 갈라진다', () => {
    const CANON = strip(api('modules/notification/patient-push-gate.service.ts'));
    for (const word of ["'ATTEMPTED'", "'UNAVAILABLE'"]) {
      expect(CANON, `정본에 ${word} 가 있어야 대조가 성립한다`).toContain(word);
      expect(SVC, `도착 확인이 정본 어휘 ${word} 를 쓴다`).toContain(word);
    }
  });

  it('🔴 화면이 단정하지 않는다 — 자격이 없으면 그 사실을 말한다', () => {
    for (const f of ['app/(main)/reception/components/AppointmentTab.tsx',
                     'app/(main)/reception/components/ReceptionSideRail.tsx']) {
      const src = web(f);
      expect(src, `${f}: pushChannel 을 읽지 않는다`).toMatch(/pushChannel/);
      expect(src, `${f}: 단말 푸시 미설정을 말하지 않는다`).toMatch(/단말 푸시는 설정되어 있지 않습니다/);
      // 🔴 재발 방지: 조건 없이 "보냈습니다"로 끝나는 단정이 남아 있으면 안 된다
      expect(src, `${f}: 무조건 "보냈습니다" 단정이 남아 있다`)
        .not.toMatch(/toast\.success\('환자앱으로 도착 확인 문의를 보냈습니다\.'\)/);
    }
  });
});

describe('🔴 조회할 수 없는 식별자를 만들지 않는다', () => {
  const CH = strip(api('modules/crm/crm-channel.service.ts'));

  it('포털 발송이 실제 알림 행 id 를 돌려준다', () => {
    expect(CH).toMatch(/messageId: pn\.id/);
    // 🔴 이 저장소가 두 번 잡은 형태 — `<접두어>-<Date.now()>`
    expect(CH, 'portal-<타임스탬프> 가 되살아났다').not.toMatch(/`portal-\$\{Date\.now\(\)\}`/);
  });

  it('시뮬레이션 채널은 여전히 simulated 를 밝힌다(대조군 — 정직한 스텁까지 지우면 안 된다)', () => {
    expect(CH).toMatch(/simulated: true/);
  });
});
