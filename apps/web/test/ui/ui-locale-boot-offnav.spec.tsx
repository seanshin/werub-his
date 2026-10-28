import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

/**
 * 🔴 **UI 언어 부팅이 `(main)` 에서만 돌았다** (2026-09-11 §12 잔여 · staffdash 갈래 실측).
 *
 * `useHydrateUiLocale()`·`useHydrateReviewOverlay()` 를 부르는 곳이 `(main)/layout.tsx` 하나뿐이라,
 * `/staff/*` 로 바로 들어오면 저장된 언어를 읽지 않고 ko 에 머물렀다 — `/staff` 10화면을 배선해도
 * 새 탭·새로고침에서는 번역이 **보이지 않는다**. 세션 만료를 `(main)` 만 듣던 것과 같은 모양이다.
 *
 * 지키는 사실:
 *  ① 🔴 **정본에서 파생** — 직원 인증 그룹(= `SessionExpiryWatcher` 를 붙인 `(main)` 밖 레이아웃)은 전부 `UiLocaleBoot` 를 붙인다.
 *     수기 목록이면 새 그룹이 통째로 시야 밖이 된다.
 *  ② 로그인 전에는 **서버를 부르지 않는다** — 로컬 캐시만 적용(401 → 세션 만료 알림 → 로그인 화면 재이동이 입력 중에 일어난다).
 *  ③ 대조군 — 로그인되면 개인 설정·검수 오버레이를 부른다(막는 가드가 아니다).
 */
const APP = path.join(__dirname, '../../src/app');
const layoutsWithWatcher = () =>
  fs.readdirSync(APP, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '(main)')
    .map((d) => path.join(APP, d.name, 'layout.tsx'))
    .filter((p) => fs.existsSync(p) && /<SessionExpiryWatcher\b/.test(fs.readFileSync(p, 'utf8')));

describe('① (main) 밖 직원 인증 그룹은 UI 언어를 부팅한다', () => {
  it('대조군 — 대상 그룹이 실제로 있다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(layoutsWithWatcher().length).toBeGreaterThanOrEqual(4);
  });

  it('🔴 전부 <UiLocaleBoot /> 를 렌더한다(import 만으로는 아무 일도 하지 않는다)', () => {
    const missing = layoutsWithWatcher().filter((p) => !/<UiLocaleBoot\s*\/>/.test(fs.readFileSync(p, 'utf8')));
    expect(missing.map((p) => path.relative(APP, p))).toEqual([]);
  });

  it('(main) 은 훅을 직접 부른다(부팅 경로가 둘이 되어도 같은 훅이다)', () => {
    const main = fs.readFileSync(path.join(APP, '(main)/layout.tsx'), 'utf8');
    expect(main).toMatch(/useHydrateUiLocale\(\s*\)/);
    expect(main).toMatch(/useHydrateReviewOverlay\(\s*\)/);
  });
});

const get = vi.fn();
vi.mock('../../src/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));
const { UiLocaleBoot } = await import('../../src/components/i18n/UiLocaleBoot');
const { useAuthStore } = await import('../../src/stores/auth-store');
const { useUiLocaleStore } = await import('../../src/stores/ui-locale-store');

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((p: string) => Promise.resolve(p.includes('ui-preferences') ? { data: { uiLocale: null } } : { data: null }));
  useUiLocaleStore.setState({ locale: 'ko' });
  useAuthStore.setState({ user: null } as never);
  localStorage.setItem('ui.locale', 'en'); // 정본 키 — src/stores/ui-locale-store.ts KEY
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('② / ③ 로그인 상태에 따라 서버 호출을 가른다', () => {
  it('🔴 로그인 전 — 로컬 캐시(en)는 적용하고 서버는 0회', async () => {
    render(<UiLocaleBoot />);
    await act(async () => { await Promise.resolve(); });
    expect(get, '로그인 전에 서버를 불렀다 — 401 이 세션 만료 알림으로 번진다').not.toHaveBeenCalled();
    expect(useUiLocaleStore.getState().locale, '로컬 캐시 언어가 적용되지 않았다 — 부팅이 헛돈다').toBe('en');
  });

  it('대조군 — 로그인되면 개인 설정과 검수 오버레이를 부른다', async () => {
    useAuthStore.setState({ user: { id: 'u1', role: 'NURSE' } } as never);
    useUiLocaleStore.setState({ locale: 'en' });
    render(<UiLocaleBoot />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const paths = get.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes('/users/me/ui-preferences'))).toBe(true);
    expect(paths.some((p) => p.includes('/i18n/overrides'))).toBe(true);
  });
});
