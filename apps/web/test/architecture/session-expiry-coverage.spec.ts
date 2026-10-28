import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 세션 만료 처리 커버리지 — `(main)` 밖 인증 화면도 만료를 듣는가.
 *
 * 🔴 2026-09-02 실측: `api-client` 의 `notifySessionExpired()` 는 **일부러 라우팅하지 않고**
 *    `auth:session-expired` 이벤트만 쏜다("이 화면을 떠나도 되는가"는 화면이 판단). 그런데
 *    그 이벤트를 듣는 곳이 `(main)/layout.tsx` **하나뿐**이었다.
 *    `(main)` 밖 인증 화면(태블릿 11 · 직원 포털 8 · 기록 새 창 3)은 세션이 끝나도 아무 일도
 *    일어나지 않는다 — 토큰은 이미 지워져 모든 조회가 401 인데 화면은 "불러오는 중…"·빈 목록으로
 *    남고 **로그인으로 가는 길이 없다**. `/tablet/nursing` 은 PWA `start_url` 이라 더 나쁘다.
 *
 * 이 가드는 "인증 화면이면 만료를 듣는다"를 그룹 단위로 강제한다.
 * 공개·토큰 화면(동의 서명·문진·설문·전광판 등)은 로그인 세션이 없으므로 대상이 아니다.
 */
const APP = path.join(process.cwd(), 'src', 'app');
const WATCHER = 'SessionExpiryWatcher';

/** 로그인 세션(staff JWT)으로 도는 `(main)` 밖 라우트 그룹 */
const AUTHED_OFFNAV_GROUPS = ['tablet', 'staff', 'record-detail', 'record-timeline'];

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

/**
 * 🔴 **import 문이 JSX 사용 검사를 대신 통과한다**(CLAUDE.md §3 · 이 가드를 쓰면서 실제로 겪었다).
 *    태블릿 레이아웃에서 `<SessionExpiryWatcher />` 만 지우고 import 를 남겼더니 가드가 **통과했다**.
 *    그래서 import 줄과 주석을 걷어낸 뒤 **JSX 사용**(`<SessionExpiryWatcher`)만 센다.
 */
const mountsWatcher = (src: string) =>
  src
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .includes(`<${WATCHER}`);

describe('세션 만료를 듣는 화면 — (main) 밖도 포함', () => {
  it('대조군: 만료 통지가 라우팅하지 않고 이벤트만 쏜다(전제가 바뀌면 이 가드의 의미가 바뀐다)', () => {
    const api = read(path.join(process.cwd(), 'src', 'lib', 'api-client.ts'));
    expect(api).toContain('SESSION_EXPIRED_EVENT');
    expect(api).toContain('notifySessionExpired');
    expect(api, 'api-client 가 직접 라우팅하면 이 가드는 필요 없다 — 규약이 바뀌었으니 다시 판단하라')
      .not.toMatch(/notifySessionExpired[\s\S]{0,400}?(router\.(push|replace)|location\.href\s*=)/);
  });

  it('(main) 도 공용 감시자를 쓴다 — 같은 처리를 두 곳에 적으면 갈라진다', () => {
    const main = read(path.join(APP, '(main)', 'layout.tsx'));
    expect(mountsWatcher(main), '(main) 이 감시자를 렌더하지 않는다').toBe(true);
    expect(main, '만료 처리 사본이 남아 있다').not.toContain('SESSION_EXPIRED_EVENT');
  });

  it.each(AUTHED_OFFNAV_GROUPS)('%s 그룹 레이아웃이 만료를 듣는다', (g) => {
    const layout = read(path.join(APP, g, 'layout.tsx'));
    expect(layout, `${g}/layout.tsx 가 없다 — 인증 화면인데 만료를 들을 자리가 없다`).not.toBe('');
    expect(mountsWatcher(layout), `${g}/layout.tsx 가 감시자를 렌더하지 않는다(import 만 있는 것은 통과가 아니다)`).toBe(true);
  });

  it('감시자가 실제로 이벤트를 듣고 로그인으로 보낸다(빈 컴포넌트가 통과하지 않게)', () => {
    const src = read(path.join(process.cwd(), 'src', 'components', 'auth', 'SessionExpiryWatcher.tsx'));
    expect(src).toContain('SESSION_EXPIRED_EVENT');
    expect(src).toContain('addEventListener');
    expect(src).toContain('clearSession');
    expect(src, '돌아올 곳(next)을 들고 가야 한다').toContain('next=');
  });
});
