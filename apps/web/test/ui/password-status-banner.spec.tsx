import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn() }, ApiError: class extends Error {} }));
let pathname = '/dashboard';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));

import { PasswordStatusBanner } from '../../src/components/auth/PasswordStatusBanner';

/**
 * 비밀번호 변경 필요 배너 — 서버 정본 `GET /auth/password-status` 의 첫 소비처(2026-09-14).
 *
 * 🔴 지키는 것:
 *   ① expired=true(최초 설정 필요 또는 기간 경과) → 배너 + 변경 화면 링크, 일수는 서버 값 그대로
 *   ② expired=false → 아무것도 그리지 않는다(대조군)
 *   ③ 조회 실패 → 배너 없음 + 콘솔 경고(성공으로도 "변경 필요"로도 그리지 않는다)
 *   ④ 강제 아님 — 닫기 가능, 변경 화면에서는 띄우지 않는다
 *   ⑤ 셸 배선 — (main)/layout 이 세로 열(TopBar 아래)에 렌더하고, 변경 화면·nav·화면번호가 실재한다
 */
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('비밀번호 변경 필요 배너', () => {
  beforeEach(() => {
    get.mockReset();
    pathname = '/dashboard';
    try { window.sessionStorage.clear(); } catch { /* noop */ }
  });
  afterEach(() => vi.restoreAllMocks());

  it('🔴 ① expired=true → 배너와 변경 화면 링크 · 일수는 서버 값', async () => {
    get.mockResolvedValue({ data: { expired: true, maxAgeDays: 90 } });
    const { container } = wrap(<PasswordStatusBanner />);
    await screen.findByRole('status');
    expect(container.textContent).toMatch(/90일/);
    expect(container.querySelector('a[href="/settings/password"]')).not.toBeNull();
    expect(get).toHaveBeenCalledWith('/api/v1/auth/password-status');
  });

  it('② 대조군 — expired=false 면 그리지 않는다', async () => {
    get.mockResolvedValue({ data: { expired: false, maxAgeDays: 90 } });
    const { container } = wrap(<PasswordStatusBanner />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('🔴 ③ 조회 실패 → 배너 없음 + 콘솔 경고', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    get.mockRejectedValue(new Error('boom'));
    const { container } = wrap(<PasswordStatusBanner />);
    // 🔴 배너 자신의 경고만 기다린다 — 다른 경고(React·i18n)가 먼저 찍히면 조회가 끝나기 전에 검사가 풀린다(재주입으로 확인)
    await waitFor(() => expect(warn.mock.calls.some((c) => String(c[0]).startsWith('[PasswordStatusBanner]'))).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('④ 닫을 수 있고, 변경 화면에서는 띄우지 않는다', async () => {
    get.mockResolvedValue({ data: { expired: true, maxAgeDays: 90 } });
    const first = wrap(<PasswordStatusBanner />);
    (await screen.findByRole('button')).click();
    await waitFor(() => expect(first.container.textContent).toBe(''));
    first.unmount();

    try { window.sessionStorage.clear(); } catch { /* noop */ }
    pathname = '/settings/password';
    const onPage = wrap(<PasswordStatusBanner />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(onPage.container.textContent).toBe('');
  });

  it('⑤ 셸 배선 — layout 세로 열에 렌더 · 변경 화면·nav·화면번호 실재', () => {
    const SRC = join(process.cwd(), 'src');
    const layout = readFileSync(join(SRC, 'app/(main)/layout.tsx'), 'utf8');
    const i = layout.indexOf('<PasswordStatusBanner />');
    expect(i).toBeGreaterThan(-1);
    // TopBar 뒤 · main 앞 — flex-col 열 안이라 가로로 끼어들지 않는다
    expect(layout.indexOf('<TopBar')).toBeLessThan(i);
    expect(i).toBeLessThan(layout.indexOf('<main', i));
    const page = readFileSync(join(SRC, 'app/(main)/settings/password/page.tsx'), 'utf8');
    expect(page).toContain("'/api/v1/auth/change-password'");
    expect(readFileSync(join(SRC, 'components/layout/Sidebar.tsx'), 'utf8')).toMatch(/href: '\/settings\/password'.*roles: EVERY_ROLE/);
    expect(readFileSync(join(SRC, 'components/layout/screen-codes.frozen.ts'), 'utf8')).toContain("'/settings/password': '2907'");
  });
});
