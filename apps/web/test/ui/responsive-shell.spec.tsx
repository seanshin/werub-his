/**
 * 좁은 화면 자동 축소 — 사이드바 아이콘 줄(rail)·상단 도구 접기(2026-09-29 사람 요청).
 *
 * 🔴 종전: 화면 폭이 줄어도 사이드바는 256px 그대로였고, 상단 칩(리허설·화면 언어·의료코드)이
 *    글자 단위로 세로 줄바꿈되어 읽을 수 없었다(스크린샷 실측).
 * 지키는 것:
 *  1. 접힘 규칙 — 자동은 폭을 따르고, 사용자가 고른 것은 기억하되 자동과 같으면 'auto' 로 돌린다. 서랍은 늘 펼친다.
 *  2. 접힌 사이드바는 **메뉴를 잃지 않는다** — 도메인 아이콘을 누르면 같은 섹션 목록이 뜬다.
 *  3. 좁은 상단은 **도구를 잃지 않는다** — 접은 도구는 ⚙ 안에 모두 있다.
 *  4. 🔴 2차(같은 날): 폭 구간(xl·2xl)으로 접었더니 확대·사이드바·언어에 따라 또 세로로 쪼개졌다 →
 *     **실제로 재서** 들어맞는 첫 단계까지만 접는다(topbar-density.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { isRailCollapsed, nextSidebarMode, parseSidebarMode } from '@/components/layout/sidebar-mode';
import { isCramped, TOPBAR_MIN_SEARCH_PX } from '@/components/layout/topbar-density';

const user = { id: 'u1', role: 'ADMIN', familyName: '김', givenName: '관리', department: '' };
const authState = { user, isAuthenticated: true, isLoading: false, logout: async () => {}, loadProfile: async () => {} };
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState);
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => authState;
  return { useAuthStore };
});
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/command-center', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/components/layout/ErpLauncher', () => ({ ErpLauncher: () => null }));
vi.mock('@/components/layout/EduLauncher', () => ({ EduLauncher: () => null }));
vi.mock('@/components/layout/ManualLink', () => ({ ManualLink: () => null }));
vi.mock('@/components/layout/ScreenJump', () => ({ ScreenJump: () => <i data-tool="jump" /> }));
vi.mock('@/components/layout/WorkstationBadge', () => ({ WorkstationBadge: () => null }));
vi.mock('@/components/layout/TermLangToggle', () => ({ TermLangToggle: () => <i data-tool="term" /> }));
vi.mock('@/components/layout/UiLocaleSelect', () => ({ UiLocaleSelect: () => <i data-tool="locale" /> }));
vi.mock('@/components/ui/NotificationPanel', () => ({ NotificationBell: () => null, NotificationPanel: () => null }));
vi.mock('@/lib/his-mode', () => ({ HisModeChip: () => null }));

beforeEach(() => cleanup());

describe('접힘 규칙(sidebar-mode)', () => {
  it('자동은 폭을 따른다 · 서랍으로 열면 늘 펼친다', () => {
    expect(isRailCollapsed('auto', true, false)).toBe(true);
    expect(isRailCollapsed('auto', false, false)).toBe(false);
    expect(isRailCollapsed('rail', false, false)).toBe(true);
    expect(isRailCollapsed('full', true, false)).toBe(false);
    expect(isRailCollapsed('rail', true, true)).toBe(false);
  });
  it('누른 결과가 자동과 같으면 auto 로 돌린다(창 폭을 다시 따라가게)', () => {
    expect(nextSidebarMode(true, false)).toBe('auto');  // 넓은 화면에서 펼침 = 자동
    expect(nextSidebarMode(false, true)).toBe('auto');  // 좁은 화면에서 접음 = 자동
    expect(nextSidebarMode(true, true)).toBe('full');   // 좁은데 펼침 → 기억
    expect(nextSidebarMode(false, false)).toBe('rail'); // 넓은데 접음 → 기억
  });
  it('저장값이 이상하면 auto', () => {
    expect(parseSidebarMode('rail')).toBe('rail');
    expect(parseSidebarMode('x')).toBe('auto');
    expect(parseSidebarMode(null)).toBe('auto');
  });
});

describe('접힌 사이드바는 메뉴를 잃지 않는다', () => {
  it('도메인 아이콘 → 같은 섹션 목록이 뜬다 · Esc 로 닫힌다 · 펼치기 버튼', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar');
    const onToggle = vi.fn();
    const { container } = render(<Sidebar collapsed onToggleCollapse={onToggle} />);
    expect(container.querySelector('[data-sidebar-rail]')).not.toBeNull();
    const domains = container.querySelectorAll('[data-rail-domain]');
    expect(domains.length).toBeGreaterThan(3);
    // 펼친 사이드바(기준)와 같은 도메인 수
    const full = render(<Sidebar />);
    const fullDomainCount = full.container.querySelectorAll('aside nav > div.mb-1\\.5').length;
    expect(domains.length).toBe(fullDomainCount);
    full.unmount();

    const first = domains[0] as HTMLElement;
    fireEvent.click(first);
    // 펼침 메뉴는 body 포털 — 사이드바 상자 안에 있지 않다(조상의 쌓임 맥락에 갇히지 않게 · 2026-10-01)
    const fly = document.body.querySelector(`[data-rail-flyout="${first.dataset.railDomain}"]`);
    expect(fly).not.toBeNull();
    expect(container.contains(fly), '사이드바 안에 그려지면 본문 카드 아래에 깔릴 수 있다').toBe(false);
    expect(fly!.parentElement).toBe(document.body);
    expect(fly!.querySelectorAll('a[href]').length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.querySelector('[data-rail-flyout]')).toBeNull();

    fireEvent.click(container.querySelector('[data-sidebar-toggle="expand"]')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('펼친 사이드바에는 접기 버튼이 있다', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar');
    const { container } = render(<Sidebar onToggleCollapse={() => {}} />);
    expect(container.querySelector('[data-sidebar-rail]')).toBeNull();
    expect(container.querySelector('[data-sidebar-toggle="collapse"]')).not.toBeNull();
  });
});

/**
 * jsdom 은 배치를 계산하지 않는다 → 헤더의 scrollWidth/clientWidth 를 밀도에 따라 돌려주는 가짜 배치를 건다.
 * `need` = 이 밀도 이상이어야 들어맞는다(그 미만이면 넘친다).
 */
function fakeLayout(need: number) {
  const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) {
    if (this.tagName !== 'HEADER') return 0;
    return Number(this.dataset.topbarDensity ?? 0) < need ? 1400 : 800;
  } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.tagName === 'HEADER' ? 800 : 0; } });
  return () => {
    if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
    if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
  };
}

describe('상단 바는 실제 남은 자리로 접는다(폭 구간이 아니라)', () => {
  it('넘침 판정 — 넘치거나, 보이는 검색칸이 최소 폭보다 좁으면', () => {
    expect(isCramped({ headerScroll: 900, headerClient: 800, searchVisible: true, searchWidth: 400 })).toBe(true);
    expect(isCramped({ headerScroll: 800, headerClient: 800, searchVisible: true, searchWidth: TOPBAR_MIN_SEARCH_PX - 1 })).toBe(true);
    expect(isCramped({ headerScroll: 800, headerClient: 800, searchVisible: true, searchWidth: TOPBAR_MIN_SEARCH_PX })).toBe(false);
    // 검색칸이 안 보이는 폭(휴대폰)에서 폭 0 을 "모자람"으로 읽지 않는다
    expect(isCramped({ headerScroll: 800, headerClient: 800, searchVisible: false, searchWidth: 0 })).toBe(false);
  });

  it.each([0, 1, 2, 3])('들어맞는 첫 단계(%i)에서 멈춘다 — 필요한 만큼만 접는다', async (need) => {
    const restore = fakeLayout(need);
    try {
      const { TopBar } = await import('@/components/layout/TopBar');
      const { container } = render(<TopBar onMenuClick={() => {}} />);
      const header = container.querySelector('header')!;
      expect(header.dataset.topbarDensity).toBe(String(need));
      // 칩 설명 글자는 0 단계에서만
      expect(!!container.querySelector('[data-topbar-inline]')).toBe(need < 2);
      expect(!!container.querySelector('[data-topbar-tools]')).toBe(need >= 2);
    } finally { restore(); }
  });

  it('펼친 도구와 ⚙ 안의 도구가 같은 벌이다(하나만 접고 잊지 않게)', async () => {
    const { TopBar } = await import('@/components/layout/TopBar');
    let restore = fakeLayout(0);
    const wide = render(<TopBar onMenuClick={() => {}} />);
    const inline = [...wide.container.querySelectorAll('[data-topbar-inline] [data-tool]')].map((e) => (e as HTMLElement).dataset.tool).sort();
    wide.unmount(); restore();
    expect(inline).toEqual(['jump', 'locale', 'term']);

    restore = fakeLayout(3);
    try {
      const { container } = render(<TopBar onMenuClick={() => {}} />);
      const box = container.querySelector('[data-topbar-tools]')!;
      expect(box.querySelectorAll('[data-tool]').length).toBe(0);
      fireEvent.click(box.querySelector('button')!);
      const folded = [...box.querySelectorAll('[data-tool]')].map((e) => (e as HTMLElement).dataset.tool).sort();
      expect(folded).toEqual(inline);
    } finally { restore(); }
  });

  it('칩이 더는 폭 구간(2xl·xl)으로 글자를 숨기지 않는다 — 밀도가 정한다', () => {
    for (const f of ['src/lib/his-mode.tsx', 'src/components/layout/UiLocaleSelect.tsx', 'src/components/layout/TermLangToggle.tsx', 'src/components/layout/WorkstationBadge.tsx', 'src/components/layout/TopBar.tsx']) {
      const src = readFileSync(join(__dirname, '../..', f), 'utf8');
      expect(src, f).not.toMatch(/\b(?:2xl|xl):(?:inline|flex|block|hidden)\b/);
    }
  });
});

describe('🔴 좌측 메뉴는 본문 위에 그린다(2026-10-01 스크린샷 — 펼침 메뉴가 상황판 카드 아래에 깔림)', () => {
  it('넓은 화면의 사이드바 상자는 이동 값을 남기지 않는다(Tailwind v4 translate 는 0 이어도 쌓임 맥락을 만든다)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/layout.tsx'), 'utf8');
    const i = src.indexOf('data-sidebar-shell');
    expect(i).toBeGreaterThan(0);
    const shell = src.slice(i, src.indexOf('>', src.indexOf('`}', i)));
    expect(shell).toMatch(/lg:translate-none/);
    expect(shell).toMatch(/lg:transform-none/);
    expect(shell, 'lg 에서 translate-x 값을 다시 주면 쌓임 맥락이 되살아난다').not.toMatch(/lg:-?translate-x-/);
  });
});
