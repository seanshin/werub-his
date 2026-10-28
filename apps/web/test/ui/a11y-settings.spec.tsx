import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 가드 — 접근성 설정 표면(`ui.a11y.*` · 임상 UX 규약 §4.6 "색만으로 말하지 않는다", 기획서 §10 P3 선행분)
 *
 * 이번 작업의 계약은 **"키와 배선은 만들되 기본값은 현행 유지"** 다.
 * 현장 공지 없이 임상 화면을 바꾸지 않기 위해, 기본값에서 화면은 픽셀 단위로 지금과 같아야 한다.
 *
 * 각 항목은 **결함을 재주입하면 실패한다** —
 *   1. 기본값이 1.0 / NORMAL / false 가 아니게 되면 실패(개발자가 기본값을 바꾸는 것을 막는다).
 *   2. 기본값인데 root 에 속성을 붙이면 실패(`data-text-scale="1"` 도 변경이다).
 *   3. 범위 밖 값(0.2·5)·미지 문자열('ULTRA')·문자열 'true' 를 채택하면 실패.
 *   4. `statusShape` 가 켜졌는데 배지가 색 외 기호를 안 내면 실패 / 꺼졌는데 기호를 내도 실패.
 *   5. globals.css 가 그 속성을 소비하는 규칙을 잃으면 실패(키만 있고 화면이 안 바뀌는 상태 방지).
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (path: string, params?: unknown) => get(path, params),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    setToken: vi.fn(), getToken: vi.fn(),
  },
}));

import { parseUiSettings, a11yRootAttrs, applyA11yRoot, a11y, UI_DEFAULTS, useUiSettings } from '../../src/lib/ui-settings';
import { AdaptiveBadge } from '../../src/components/ui/display';
import { A11yRoot } from '../../src/components/layout/A11yRoot';

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    {ui}
  </QueryClientProvider>
);

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: [] });
  document.documentElement.removeAttribute('data-text-scale');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.style.removeProperty('--app-text-scale');
});
afterEach(() => {
  document.documentElement.removeAttribute('data-text-scale');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.style.removeProperty('--app-text-scale');
});

describe('기본값 = 현행 유지 (변화 없음)', () => {
  it('설정이 없으면 배율 1 · NORMAL · 기호 OFF', () => {
    const s = parseUiSettings([]);
    expect(s.textScale).toBe(1);
    expect(s.contrast).toBe('NORMAL');
    expect(s.statusShape).toBe(false);
    // 카탈로그 기본값 자체가 no-op 이어야 한다
    expect(UI_DEFAULTS.textScale).toBe(1);
    expect(UI_DEFAULTS.contrast).toBe('NORMAL');
    expect(UI_DEFAULTS.statusShape).toBe(false);
  });

  it('응답이 아예 없어도(미로딩·조회 실패) 기본값', () => {
    const s = parseUiSettings(undefined);
    expect([s.textScale, s.contrast, s.statusShape]).toEqual([1, 'NORMAL', false]);
  });

  it('기본값에서 root 에 붙는 속성이 하나도 없다 — 현행과 픽셀 단위로 동일', () => {
    const attrs = a11yRootAttrs(parseUiSettings([]));
    expect(attrs).toEqual({ textScale: null, contrast: null, statusShape: false });

    const el = document.createElement('div');
    el.setAttribute('data-text-scale', '1.4'); // 이전 값이 남아 있어도
    el.setAttribute('data-contrast', 'HIGH');
    applyA11yRoot(el, parseUiSettings([]));
    expect(el.hasAttribute('data-text-scale')).toBe(false);
    expect(el.hasAttribute('data-contrast')).toBe(false);
    expect(el.style.getPropertyValue('--app-text-scale')).toBe('');
  });

  it('A11yRoot 를 마운트해도 기본값이면 document root 가 그대로다', async () => {
    render(withQuery(<A11yRoot />));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(document.documentElement.hasAttribute('data-text-scale')).toBe(false);
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });
});

describe('모르는 값은 기본값으로 떨어뜨린다', () => {
  it.each([0.2, 5, 0, -1, Number.NaN])('배율 %s 는 미채택', (v) => {
    expect(parseUiSettings([{ key: 'ui.a11y.textScale', value: v }]).textScale).toBe(1);
  });

  it.each(['', 'big', null, {}, []])('비수치 배율(%s)도 미채택', (v) => {
    expect(parseUiSettings([{ key: 'ui.a11y.textScale', value: v }]).textScale).toBe(1);
  });

  it.each(['ULTRA', 'high', '', 1, null])('대비 %s 는 미채택(NORMAL 유지)', (v) => {
    expect(parseUiSettings([{ key: 'ui.a11y.contrast', value: v }]).contrast).toBe('NORMAL');
  });

  it.each(['true', 1, 'on', {}])('statusShape 의 boolean 아닌 값(%s)은 켜지지 않는다', (v) => {
    expect(parseUiSettings([{ key: 'ui.a11y.statusShape', value: v }]).statusShape).toBe(false);
  });

  it('범위 안 값은 채택하고 root 에 반영한다', () => {
    const s = parseUiSettings([
      { key: 'ui.a11y.textScale', value: 1.25 },
      { key: 'ui.a11y.contrast', value: 'HIGH' },
      { key: 'ui.a11y.statusShape', value: true },
    ]);
    expect([s.textScale, s.contrast, s.statusShape]).toEqual([1.25, 'HIGH', true]);
    const el = document.createElement('div');
    applyA11yRoot(el, s);
    expect(el.getAttribute('data-text-scale')).toBe('1.25');
    expect(el.getAttribute('data-contrast')).toBe('HIGH');
    expect(el.style.getPropertyValue('--app-text-scale')).toBe('1.25');
  });

  it('문자열로 저장된 배율도 관대하게 받는다(경계 0.9·1.6 포함)', () => {
    expect(parseUiSettings([{ key: 'ui.a11y.textScale', value: '1.4' }]).textScale).toBe(1.4);
    expect(parseUiSettings([{ key: 'ui.a11y.textScale', value: 0.9 }]).textScale).toBe(0.9);
    expect(parseUiSettings([{ key: 'ui.a11y.textScale', value: 1.6 }]).textScale).toBe(1.6);
    expect(parseUiSettings([{ key: 'ui.a11y.textScale', value: 1.61 }]).textScale).toBe(1);
  });
});

describe('statusShape — 색 외 보조 채널(§4.6)', () => {
  it('꺼져 있으면(기본) 배지는 현행 그대로 — 기호가 없다', async () => {
    const { container } = render(withQuery(<AdaptiveBadge icon={<i />} label="격리" shape="danger" />));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector('[data-status-shape]')).toBeNull();
    expect(container.textContent).not.toContain('■');
  });

  it('켜지면 색 외에 기호를 함께 낸다', async () => {
    get.mockResolvedValue({ data: [{ key: 'ui.a11y.statusShape', value: true }] });
    const { container } = render(withQuery(<AdaptiveBadge icon={<i />} label="격리" shape="danger" />));
    await waitFor(() => expect(container.querySelector('[data-status-shape="danger"]')).not.toBeNull());
    expect(container.textContent).toContain('■');
  });

  it('shape 를 주지 않은 배지는 켜져도 그대로 — 색에서 의미를 지어내지 않는다', async () => {
    get.mockResolvedValue({ data: [{ key: 'ui.a11y.statusShape', value: true }] });
    const { container } = render(withQuery(<AdaptiveBadge icon={<i />} label="보험" tone="bg-red-50 text-red-700" />));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector('[data-status-shape]')).toBeNull();
  });
});

describe('a11y() 스냅샷 접근자 — 정본은 하나', () => {
  it('훅이 읽은 값을 훅 밖에서도 같은 값으로 준다', async () => {
    get.mockResolvedValue({ data: [{ key: 'ui.a11y.contrast', value: 'HIGH' }] });
    function Probe() { useUiSettings(); return null; }
    render(withQuery(<Probe />));
    await waitFor(() => expect(a11y().contrast).toBe('HIGH'));
    expect(a11y().textScale).toBe(1);
  });
});

describe('globals.css 가 그 속성을 실제로 소비한다', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf-8');

  it('배율·대비 규칙이 존재한다(키만 있고 화면이 안 바뀌는 상태 방지)', () => {
    expect(css).toContain('[data-text-scale] body');
    expect(css).toContain('var(--app-text-scale, 1)');
    expect(css).toContain('[data-contrast="HIGH"] .text-gray-400');
    expect(css).toContain('[data-contrast="HIGH"] .text-gray-500');
  });

  it('root(html) 자신의 font-size 는 건드리지 않는다 — rem 기반 여백·폭까지 커지면 레이아웃이 무너진다', () => {
    expect(css).not.toMatch(/\[data-text-scale\]\s*\{[^}]*font-size/);
    expect(css).not.toMatch(/html\[data-text-scale\]\s*\{[^}]*font-size/);
  });

  it('대비 강화가 순수 흑백 극단으로 가지 않는다(§4.6 야간 조도)', () => {
    const block = css.slice(css.indexOf('[data-contrast="HIGH"]'));
    const rules = block.slice(0, block.indexOf('/* ──', 1));
    expect(rules).not.toMatch(/#000\b|#000000|\bblack\b/i);
  });
});
