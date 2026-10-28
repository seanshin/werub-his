/**
 * 의무기록 사본 화면 정직화(2026-10-13 결함 발굴 B6).
 *  · 🔴 "PDF 생성"은 결과를 버렸다 → 미리보기 새 창 · 발급 아님 고지 · 실패는 말한다 · 간호기록(생성기 없음 404) 선택지 없음
 *  · 🔴 "발급 등록"은 문서 없이 "발급 완료!" → 이력 수기 기록 · "문서는 발급되지 않았습니다" · 정본 화면 링크
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ fetch: vi.fn(), post: vi.fn(async () => ({ data: {} })), get: vi.fn(), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
beforeEach(() => { cleanup(); api.fetch.mockReset(); vi.restoreAllMocks(); });

describe('🔴 의무기록 사본 화면', () => {
  it('미리보기 — 결과를 새 창으로 연다 · 발급 아님 고지 · 간호기록 선택지 없음', async () => {
    api.fetch.mockResolvedValue('<html>사본</html>');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    const { default: Page } = await import('@/app/(main)/medical-records/copy/page');
    const v = wrap(<Page />);
    expect(v.container.querySelector('[data-copy-preview-note]')!.textContent).toContain('발급 아님');
    const sel = v.container.querySelector('select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).not.toContain('nursing_note');
    fireEvent.change(v.container.querySelector('input[placeholder="Encounter/Admission UUID"]')!, { target: { value: 'e1' } });
    fireEvent.click(v.container.querySelector('[data-copy-preview]')!);
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:x', '_blank', 'noopener'));
  });
  it('미리보기 실패는 말한다', async () => {
    api.fetch.mockRejectedValue(new Error('서명된 진료기록만 사본으로 만들 수 있습니다'));
    const { default: Page } = await import('@/app/(main)/medical-records/copy/page');
    const v = wrap(<Page />);
    fireEvent.change(v.container.querySelector('input[placeholder="Encounter/Admission UUID"]')!, { target: { value: 'e1' } });
    fireEvent.click(v.container.querySelector('[data-copy-preview]')!);
    await waitFor(() => expect(v.container.querySelector('[data-copy-preview-error]')).toBeTruthy());
  });
  it('이력 기록 폼은 발급이라 말하지 않는다 · 정본 화면 링크', async () => {
    const { default: Page } = await import('@/app/(main)/medical-records/copy/page');
    const v = wrap(<Page />);
    expect(v.container.textContent).toContain('문서 발급 아님');
    expect(v.container.textContent).not.toContain('발급 완료!');
    expect(v.container.querySelector('a[href="/workstation/documents"]')).toBeTruthy();
  });
});
