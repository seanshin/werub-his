import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 (화면 실사용 점검 W8·P16) — **하지 않은 것을 했다고 말하지 못하게 막는다.**
 *
 * 이 배치에서 실제로 나온 형태 네 가지를 재발 차단한다:
 *  ① 발송 제공자가 없는데 'SENT' 로 기록 (온보딩 이메일·문진 SMS·문진 리마인더·CRM 캠페인)
 *  ② 인증 지표에 리터럴 총계·상수 판정 (`total: 59` · `status: 'PASS'`)
 *  ③ 목록 상한으로 항목이 조용히 사라짐 (간호코드 167건 중 67건 실종)
 *  ④ onClick 이 없는 액션 버튼 (시설 관리 「편집」)
 *
 * 정본: modules/crm/crm-channel.service.ts(발송 판정 SENT/SIMULATED/FAILED)
 */

const APPS = path.join(__dirname, '..', '..', '..');
const API_SRC = path.join(APPS, 'api', 'src');
const WEB_SRC = path.join(APPS, 'web', 'src');

/** 주석은 규약을 설명하는 자리다 — 스캔 대상에서 뺀다(설명문이 위반으로 잡히면 가드를 못 쓴다) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('① 발송 제공자가 없으면 SENT 가 아니다', () => {
  /**
   * 🔴 `CrmChannelService.send()` 는 제공자가 없거나 SMTP 미설정이면 `{ success: true, simulated: true }`
   *    를 돌려준다 — **성공이지만 나가지 않았다**. 호출부가 `simulated` 를 보지 않으면 그대로
   *    '발송 완료'가 된다(W6 CRM 리마인더·W8 온보딩 이메일·문진 SMS 가 전부 이 형태였다).
   */
  /**
   * 🔴 2026-08-20 조준 교정 — 종전엔 **이름만 언급해도** 대상이 됐다. 그래서 발송을 하지 않고
   * 상황을 **기술만 하는** 파일(결정 등록부의 설명문)까지 잡혔다. 느슨하게 푼 것이 아니라
   * **실제로 부르는 파일**로 좁힌 것이다 — 보내지 않는 파일은 발송을 오보할 수 없다.
   * 조건: 주입/타입 참조가 아니라 **`.send(` 호출**이 있는 파일.
   */
  /**
   * 🔴 **주석을 코드로 세지 않는다.** 2026-08-26 실측: 다른 축에서 `voucher-email.service.ts` 에
   *    "이 서비스는 `CrmChannelService` 를 거치지 않는다"는 **설명 주석**을 달자 이 가드가 그 파일을
   *    발송 호출부로 세어 실패했다. 이 저장소에서 같은 실수가 네 번째다 —
   *    이번엔 가드 쪽에서 막는다(설명을 못 쓰게 하는 것은 해법이 아니다).
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  const callers = walk(API_SRC).filter((f) => {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    if (!/CrmChannelService/.test(code)) return false;
    if (/crm-channel\.service\.ts$/.test(f) || /crm\.module\.ts$/.test(f)) return false;
    return /\.\s*send\s*\(/.test(code); // 실제 발송 호출이 있는 파일만
  });

  it('CrmChannelService 로 실제 발송하는 파일이 존재한다(가드가 헛돌지 않게)', () => {
    expect(callers.length, '조준을 좁히다가 대상이 0이 되면 가드가 아무것도 지키지 않는다').toBeGreaterThan(3);
  });

  it.each(callers.map((f) => [path.relative(APPS, f), f]))('%s 는 simulated 를 판정에 쓴다', (_rel, file) => {
    const src = fs.readFileSync(file as string, 'utf8');
    expect(src).toMatch(/simulated/);
  });

  /**
   * 🔴 **미구현 자리표시자 바로 뒤의 성공 반환** — 종전 questionnaire-admin.service 의 형태:
   *    `if (smsApiKey) { // TODO: 알리고 연동  return { sent: true } }`
   *    키를 넣는 순간(=운영에 가까워질수록) 한 통도 안 보내고 전건 "발송 완료"가 된다.
   *
   * 알려진 잔여: **없다**.
   *  - patient-auth/services/sms-otp.service.ts 는 2026-08-14 W8 마지막 갈래로 수렴했다
   *    (OTP 발송이 provider 없이도 `{ sent: true }` 였던 것 → `SENT/SIMULATED/FAILED`).
   *    환자 로그인 흐름이 영향권이라 **차단이 아니라 정직**으로 고쳤다 — 아래 ⑥ 참조.
   *  - 새로 등재할 일이 생기면 그건 회귀다. 목록을 늘리기 전에 고칠 수 있는지 먼저 본다.
   */
  const KNOWN_UNFIXED: string[] = [];

  it('발송 서비스가 provider 확인 없이 sent:true 를 반환하지 않는다', () => {
    const offenders: string[] = [];
    for (const f of walk(API_SRC)) {
      const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n');
      const raw = fs.readFileSync(f, 'utf8').split('\n');
      raw.forEach((line, i) => {
        if (!/TODO/.test(line)) return;
        const window = lines.slice(i, i + 12).join('\n'); // 자리표시자와 반환 사이의 몇 줄까지 본다
        if (/return\s*\{[^}]*sent:\s*true/.test(window)) offenders.push(path.relative(APPS, f));
      });
    }
    expect([...new Set(offenders)].sort()).toEqual(KNOWN_UNFIXED);
  });
});

describe('② 인증 지표에 리터럴 총계·상수 판정 금지', () => {
  const file = path.join(API_SRC, 'modules', 'emr-cert', 'emr-cert.service.ts');
  const src = stripComments(fs.readFileSync(file, 'utf8'));

  it('🔴 총계를 숫자로 박지 않는다 (`total: 59`)', () => {
    expect(src).not.toMatch(/\btotal:\s*\d+/);
  });

  it('🔴 지표 판정을 상수로 박지 않는다 (`status: \'PASS\'`)', () => {
    // 판정은 measure() 의 반환값에서만 나온다. 정의 배열에 status 리터럴이 있으면 그 순간 날조다.
    expect(src).not.toMatch(/status:\s*'(PASS|PARTIAL|FAIL)'\s*[,}]/);
  });

  it('측정 불가 지표를 표현할 상태가 정의돼 있다', () => {
    expect(src).toMatch(/NOT_MEASURED/);
  });
});

describe('③ 목록 상한으로 항목이 조용히 사라지지 않는다', () => {
  const file = path.join(API_SRC, 'modules', 'code-master', 'code-master.service.ts');
  const src = fs.readFileSync(file, 'utf8');

  it('간호코드 검색은 총건수를 함께 돌려준다', () => {
    const fn = src.slice(src.indexOf('async searchNursingCodes'));
    expect(fn).toMatch(/nursingCode\.count/);
    expect(fn).toMatch(/hasMore/);
  });

  it('🔴 관리 화면의 분류 필터가 API 가 다루는 코드체계를 모두 덮는다', () => {
    // NOC 12건이 어느 경로로도 도달 불가였던 원인 — 필터 목록에서 빠져 있었다.
    const ctrl = fs.readFileSync(path.join(API_SRC, 'modules', 'code-master', 'code-master.controller.ts'), 'utf8');
    const m = ctrl.match(/간호코드 검색 \(([^)]+)\)/);
    expect(m).toBeTruthy();
    const systems = (m![1]).split('/').map((s) => s.trim()).map((s) => (s === 'NANDA' ? 'NANDA_I' : s));

    const page = fs.readFileSync(path.join(WEB_SRC, 'app', '(main)', 'admin', 'codes', 'page.tsx'), 'utf8');
    const listMatch = page.match(/const NURSING_CATEGORIES\s*=\s*\[([^\]]+)\]/);
    expect(listMatch).toBeTruthy();
    const listed = listMatch![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));

    const missing = systems.filter((s) => !listed.includes(s));
    expect(missing).toEqual([]);
  });
});

describe('⑤ 지정할 수 있는 보드는 TV 가 전부 그린다', () => {
  /**
   * 🔴 `/admin/displays/<id>` 에서 보드로 `waiting` 을 고르면 서버는 저장하고 화면은
   *    "저장했습니다 — 1분 안에 반영합니다"라고 말했는데, 박스 페이지에는 `waiting` 분기가 없어
   *    TV 는 계속 "보드 미지정"을 띄웠다(W8·P16). 저장 가능한 값과 렌더 가능한 값이 어긋나면 안 된다.
   */
  it('DTO 가 허용하는 boardType 은 박스 페이지가 모두 분기한다', () => {
    const dto = fs.readFileSync(path.join(API_SRC, 'modules', 'waiting-queue', 'display-keys.admin.controller.ts'), 'utf8');
    const m = dto.match(/@IsIn\(\[([^\]]+)\]\s*as unknown as string\[\]\)\s*\n?\s*boardType/);
    expect(m, 'boardType @IsIn 목록을 찾지 못했다').toBeTruthy();
    const allowed = m![1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s && s !== 'null');
    expect(allowed.length).toBeGreaterThan(0);

    const boxPage = fs.readFileSync(path.join(WEB_SRC, 'app', 'display', 'box', '[key]', 'page.tsx'), 'utf8');
    const unhandled = allowed.filter((b) => !new RegExp(`boardType === '${b}'`).test(boxPage));
    expect(unhandled, `박스 페이지가 그리지 못하는 보드: ${unhandled.join(', ')}`).toEqual([]);
  });

  it('세팅 화면이 제시하는 보드도 DTO 가 받는다', () => {
    const dto = fs.readFileSync(path.join(API_SRC, 'modules', 'waiting-queue', 'display-keys.admin.controller.ts'), 'utf8');
    const setting = fs.readFileSync(path.join(WEB_SRC, 'app', '(main)', 'admin', 'displays', '[keyId]', 'page.tsx'), 'utf8');
    const offered = [...setting.matchAll(/\{\s*value:\s*'([^']+)'/g)].map((x) => x[1]);
    expect(offered.length).toBeGreaterThan(0);
    const rejected = offered.filter((v) => !dto.includes(`'${v}'`));
    expect(rejected, `저장할 수 없는데 화면이 제시하는 보드: ${rejected.join(', ')}`).toEqual([]);
  });
});

describe('⑥ 환자 OTP — 제공자가 없으면 SENT 가 아니고, 인증번호는 응답에 실리지 않는다', () => {
  /**
   * 🔴 2026-08-14 W8 마지막 갈래. `sms-otp.service.send()` 가 SMS 제공자 없이도 `{ sent: true }` 를
   *    돌려줬다 — 인증번호는 서버 로그에만 찍히고 환자는 "인증번호를 보냈습니다"를 보고 **오지 않는
   *    문자를** 기다렸다. 여기를 fail-closed 로 막으면 환자 로그인 자체가 죽으므로(현 환경 제공자 없음)
   *    **차단이 아니라 정직**으로 고쳤다: OTP 는 계속 발급·검증되고 응답이 SENT/SIMULATED/FAILED 를 싣는다.
   */
  const otpFile = path.join(API_SRC, 'modules', 'patient-auth', 'services', 'sms-otp.service.ts');
  const otpSrc = stripComments(fs.readFileSync(otpFile, 'utf8'));
  const sendBody = otpSrc.slice(otpSrc.indexOf('async send('), otpSrc.indexOf('async verify('));

  it('발송 판정을 정본(CrmChannelService)의 결과에서 끌어온다 — 새 채널 구현을 만들지 않는다', () => {
    expect(otpSrc).toMatch(/CrmChannelService/);
    expect(sendBody).toMatch(/simulated\s*\?\s*'SIMULATED'/);
    expect(sendBody).toMatch(/'FAILED'/);
  });

  it("🔴 제공자 확인 없이 sent:true 를 돌려주지 않는다", () => {
    expect(sendBody).not.toMatch(/sent:\s*true/);
    expect(sendBody).toMatch(/sent:\s*delivery === 'SENT'/);
  });

  it('🔴 인증번호를 응답 본문에 담지 않는다(개발 편의로도 안 된다 — 인증 우회다)', () => {
    const returns = [...sendBody.matchAll(/return\s*\{([\s\S]*?)\n\s*\};/g)].map((m) => m[1]);
    expect(returns.length, 'send() 의 반환 객체를 찾지 못했다').toBeGreaterThan(0);
    for (const r of returns) {
      expect(r, `응답에 인증번호가 실렸다: ${r}`).not.toMatch(/\bcode\b/);
    }
    // 컨트롤러도 서비스 반환을 그대로 싣기만 한다(별도로 code 를 덧붙이지 않는다)
    const ctrl = stripComments(
      fs.readFileSync(path.join(API_SRC, 'modules', 'patient-auth', 'patient-auth.controller.ts'), 'utf8'),
    );
    const sendHandler = ctrl.slice(ctrl.indexOf('async sendSms('), ctrl.indexOf('async verifySms('));
    expect(sendHandler).not.toMatch(/\bcode\b/);
  });

  it('발송이 안 됐다고 인증 흐름을 막지 않는다 — OTP 행은 발송 시도 전에 저장된다', () => {
    // 저장(create) 이 채널 호출보다 앞에 있어야, 미발송이어도 개발·데모 확인 경로로 로그인이 가능하다.
    expect(sendBody.indexOf('smsVerification.create')).toBeGreaterThan(-1);
    expect(sendBody.indexOf('smsVerification.create')).toBeLessThan(sendBody.indexOf('this.channel'));
    // 미발송을 예외로 바꾸지 않는다(예외는 발송 제한·중복 요청에만).
    const afterSend = sendBody.slice(sendBody.indexOf('this.channel'));
    expect(afterSend).not.toMatch(/throw new/);
  });
});

describe('④ 죽은 버튼(onClick 없는 액션) 금지', () => {
  /**
   * 🔴 시설 관리 「편집」 버튼에 onClick 이 없었다 — 편집 모드를 켜면 나타나는데 눌러도 아무 일도
   *    없었다. 화면이 "할 수 있다"고 말하고 실제로는 못 하는 것도 P16 이다.
   *    (전역 스캔은 오탐이 많아 이 배치가 소유한 화면으로 한정한다. 새 화면은 여기에 등재한다.)
   */
  const OWNED_PAGES = [
    'app/(main)/admin/facility/page.tsx',
    'app/(main)/admin/emr-cert/page.tsx',
    'app/(main)/admin/extensions/page.tsx',
    'app/(main)/admin/displays/page.tsx',
    'app/(main)/admin/displays/[keyId]/page.tsx',
    'app/(main)/admin/onboarding/page.tsx',
    'app/(main)/admin/bots/page.tsx',
    'app/display/_boards/LegacyWaitingBoard.tsx',
  ];

  /** `<button ...>` 의 여는 태그 본문만 뽑는다(화살표 `=>` 의 `>` 는 종료로 보지 않는다) */
  function buttonTags(src: string): string[] {
    const tags: string[] = [];
    let i = src.indexOf('<button');
    while (i !== -1) {
      let j = i + 7;
      let depth = 0;
      while (j < src.length) {
        const c = src[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0 && src[j - 1] !== '=') break;
        j++;
      }
      tags.push(src.slice(i, j + 1));
      i = src.indexOf('<button', j);
    }
    return tags;
  }

  it.each(OWNED_PAGES)('%s 의 모든 button 에 동작이 있다', (rel) => {
    const file = path.join(WEB_SRC, rel);
    expect(fs.existsSync(file), `${rel} 없음`).toBe(true);
    const dead = buttonTags(fs.readFileSync(file, 'utf8'))
      .filter((t) => !/onClick|type=["']submit["']|onMouseDown|onPointerDown/.test(t));
    expect(dead, `동작 없는 버튼: ${dead.join(' | ')}`).toEqual([]);
  });
});
