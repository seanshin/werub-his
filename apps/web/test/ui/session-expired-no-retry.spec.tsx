import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { QueryErrorFallback } from '../../src/components/ui/QueryErrorFallback';
import { ApiError } from '../../src/lib/api-client';
import { isSessionExpired } from '../../src/lib/error-utils';

/**
 * 세션 만료에 **재시도를 권하지 않는다** (2026-08-28 사람 신고).
 *
 * 🔴 신고 원문: *"시간이 한참 지나면, 재시도는 의미가 없으니, 의미가 없는 시간에는 로그아웃이
 *    맞거나, 다른 화면으로 전환되어야 함."*
 *
 * 실측된 경로: `api-client` 가 401 에서 refresh 를 한 번 시도하고, 그것마저 실패하면
 * 세션은 **확정적으로 끝난다.** 그런데 종전에는 오류만 던지고 인증 상태를 그대로 뒀다 —
 * 레이아웃의 로그인 리다이렉트가 발동하지 않았고, 화면에는 "재시도" 버튼만 남았다.
 * **눌러도 같은 401 로 돌아오는 버튼**이다(할 수 있는 일처럼 보이지만 아무것도 하지 못한다).
 *
 * 재주입: 만료 분기를 지워 다시 "재시도"를 그리게 하거나, 세션 정리·통지를 없애면 실패한다.
 */
const expired = new ApiError('UNAUTHORIZED', '세션이 만료되었습니다. 다시 로그인해주세요.');
const network = new ApiError('NETWORK_ERROR', '서버와 연결할 수 없습니다.');

describe('세션 만료 판정', () => {
  it('🔴 UNAUTHORIZED 만 세션 만료다 — 다른 오류를 만료로 말하지 않는다', () => {
    expect(isSessionExpired(expired)).toBe(true);
    expect(isSessionExpired(network)).toBe(false);
    expect(isSessionExpired(new Error('boom'))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});

describe('오류 폴백 — 될 수 없는 행동을 권하지 않는다', () => {
  const noop = () => {};

  it('🔴 세션 만료면 "재시도"가 없고 "다시 로그인"이 있다 (compact)', () => {
    const { container } = render(<QueryErrorFallback error={expired} onRetry={noop} size="compact" />);
    const t = container.textContent ?? '';
    expect(t).not.toContain('재시도');
    expect(t).toContain('다시 로그인');
    // 링크여야 한다 — 눌러서 실제로 이동한다
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('🔴 세션 만료면 "잠시 후 다시 시도"라고 말하지 않는다 (full)', () => {
    const { container } = render(<QueryErrorFallback error={expired} onRetry={noop} />);
    const t = container.textContent ?? '';
    // 기다려도 돌아오지 않는다 — 그렇게 말하면 거짓말이다
    expect(t).not.toContain('잠시 후 다시 시도');
    expect(t).toContain('로그인 화면으로 이동합니다');
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('🔴 대조군 — 만료가 아닌 오류에는 재시도가 그대로 있다', () => {
    const c1 = render(<QueryErrorFallback error={network} onRetry={noop} size="compact" />).container;
    expect(c1.textContent).toContain('재시도');
    expect(c1.querySelector('a[href="/login"]')).toBeNull();

    const c2 = render(<QueryErrorFallback error={network} onRetry={noop} />).container;
    expect(c2.textContent).toContain('다시 시도');
    expect(c2.querySelector('button')).not.toBeNull();
  });

  it('onRetry 가 없으면 아무 버튼도 만들지 않는다', () => {
    const { container } = render(<QueryErrorFallback error={network} />);
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('세션이 끝나면 화면이 전환된다', () => {
  const API = fs.readFileSync(path.join(__dirname, '../../src/lib/api-client.ts'), 'utf-8');
  const LAYOUT = fs.readFileSync(path.join(__dirname, '../../src/app/(main)/layout.tsx'), 'utf-8');
  // 🔴 2026-09-02: 만료 처리가 `(main)` 에만 있어 태블릿·직원 포털·기록 새 창은 반응하지 않았다.
  //    공용 `SessionExpiryWatcher` 로 뽑았으므로 **동작은 그 파일에서** 검사하고,
  //    레이아웃은 "그것을 렌더하는가"만 본다(사본을 만들지 않는다).
  const WATCHER = fs.readFileSync(path.join(__dirname, '../../src/components/auth/SessionExpiryWatcher.tsx'), 'utf-8');
  const STORE = fs.readFileSync(path.join(__dirname, '../../src/stores/auth-store.ts'), 'utf-8');
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('🔴 refresh 실패 시 세션 만료를 통지한다 — 오류만 던지지 않는다', () => {
    const c = code(API);
    expect(c).toContain('notifySessionExpired()');
    // 통지 위치가 UNAUTHORIZED throw 앞이어야 한다
    expect(c.indexOf('notifySessionExpired()')).toBeLessThan(c.indexOf("throw new ApiError('UNAUTHORIZED'"));
  });

  it('🔴 통지는 한 번만 — 화면 하나에 쿼리가 여러 개라 401 이 동시에 터진다', () => {
    const c = code(API);
    expect(c).toMatch(/if \(sessionExpiredNotified\) return;/);
    expect(c).toMatch(/sessionExpiredNotified = true;/);
  });

  it('🔴 감시자가 통지를 받아 정리하고 로그인으로 보낸다 — 돌아올 경로를 들고', () => {
    const c = code(WATCHER);
    expect(c).toContain('SESSION_EXPIRED_EVENT');
    expect(c).toContain('addEventListener');
    expect(c).toContain('clearSession()');
    expect(c).toMatch(/next=\$\{encodeURIComponent\(here\)\}/);
  });

  it('🔴 (main) 레이아웃이 그 감시자를 실제로 렌더한다 — import 만 있는 것은 통과가 아니다', () => {
    const jsx = code(LAYOUT).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
    expect(jsx).toContain('<SessionExpiryWatcher');
  });

  it('🔴 만료 정리는 서버를 부르지 않는다 — 이미 만료된 토큰으로 부르면 또 401 이다', () => {
    const c = code(STORE);
    const i = c.indexOf('clearSession:');
    const j = c.indexOf('logout:', i);
    expect(i).toBeGreaterThan(-1);
    expect(c.slice(i, j > i ? j : undefined)).not.toContain('/api/v1/auth/logout');
    // 대조군 — 사용자가 스스로 나가는 logout 은 서버를 부른다
    expect(c.slice(c.indexOf('logout:'))).toContain('/api/v1/auth/logout');
  });
});
