/**
 * 로그인 좌측 안내 — 간략히(기본)/상세 보기 탭(2026-10-06).
 *  · 처음엔 간략히(숫자·영역 이름·안전 항목 이름·로그인 두 줄) · 상세는 종전 전체(첫 화면 표·인증 기준)
 *  · 고른 보기는 이 브라우저에 기억 · 저장소를 못 써도 화면은 바뀐다
 * 재주입: 기본값을 상세로 바꾸거나, 기억을 지우거나, 상세에서 첫 화면 표를 빼면 실패한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/dev-test-accounts', () => ({ TestAccountPanel: () => null }));
vi.mock('@/lib/his-mode', () => ({ BuildModeBanner: () => null }));

beforeEach(() => { cleanup(); try { window.localStorage.clear(); } catch { /* */ } });

async function mount() {
  const { default: P } = await import('@/app/(auth)/login/page');
  return render(<P />);
}

describe('로그인 좌측 안내 보기', () => {
  it('🔴 처음엔 간략히 — 규모 숫자·업무 영역 이름은 보이고, 첫 화면 표·인증 기준은 없다', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-login-brief]')).toBeTruthy();
    expect(container.querySelector('[data-login-detail]')).toBeNull();
    expect(container.querySelector('[data-login-home-guide]')).toBeNull();
    // 숫자를 테스트에 박지 않는다(릴리즈마다 깨진다) — 화면 정본(SCALE)의 API 값이 간략히 보기에 보이는지
    const apiValue = /value: '([\d,]+)', label: 'API'/.exec(readFileSync(join(__dirname, '../../src/app/(auth)/login/page.tsx'), 'utf8'))![1];
    expect(container.textContent).toContain(apiValue);
    expect(container.textContent).toContain('원무·청구');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('간략히 보기');
  });

  it('🔴 상세 보기를 누르면 종전 전체(첫 화면 표·인증 기준) · 고른 보기를 기억한다', async () => {
    const { container, getByText } = await mount();
    fireEvent.click(getByText('상세 보기'));
    expect(container.querySelector('[data-login-detail]')).toBeTruthy();
    expect(container.querySelector('[data-login-home-guide]')).toBeTruthy();
    expect(container.textContent).toContain('인증 기준 · 표준 · 연동');
    expect(window.localStorage.getItem('login.infoView')).toBe('detail');
    cleanup();
    const again = await mount();
    await waitFor(() => expect(again.container.querySelector('[data-login-detail]')).toBeTruthy());
  });

  it('간략히의 "상세 보기 →" 링크도 상세로 바꾼다 · 다시 간략히로 돌아간다', async () => {
    const { container, getByText } = await mount();
    fireEvent.click(getByText(/상세 보기 →/));
    expect(container.querySelector('[data-login-detail]')).toBeTruthy();
    fireEvent.click(getByText('간략히 보기'));
    expect(container.querySelector('[data-login-brief]')).toBeTruthy();
    expect(window.localStorage.getItem('login.infoView')).toBe('brief');
  });
});
