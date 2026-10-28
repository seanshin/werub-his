/**
 * 인쇄 루트 — 공용 PrintLayout(진단서 등)·QI 보고서 인쇄(2026-10-12 사용자 "나머지 인쇄 화면도 같은 방식으로 정돈").
 *  · 🔴 종전엔 화면을 그대로 찍어 빈 종이(공용 문서 CSS 가 인쇄 루트 없이 body 직계를 숨겼다)
 *  · 양식은 그대로 인쇄 루트(body > .doc-print-root)에 한 번 더 · 전역 @page 를 덮어쓰지 않는다
 *  · QI 보고서: 서버가 보존한 sha256 그대로 · 표 · 서명란 · QR 에 보고서 id·기간·상태만
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove()); });
const root = () => document.body.querySelector(':scope > .doc-print-root');

describe('공용 PrintLayout', () => {
  it('🔴 양식을 인쇄 루트에 그린다 · 화면 사본도 남는다 · 전역 @page 없음', async () => {
    const { default: PrintLayout } = await import('@/components/print/PrintLayout');
    const v = render(<PrintLayout title="진 단 서" docNumber="DOC-DX"><p data-x>본문</p></PrintLayout>);
    await waitFor(() => expect(root()).not.toBeNull());
    expect(root()!.querySelector('[data-print-doc="DOC-DX"]')!.textContent).toContain('진 단 서');
    expect(root()!.querySelector('[data-x]')).toBeTruthy();
    expect(v.container.querySelector('[data-x]')).toBeTruthy();
    const src = readFileSync(join(__dirname, '../../src/components/print/PrintLayout.tsx'), 'utf8');
    expect(src).not.toMatch(/@page\s*\{/);
    // 🔴 (2026-10-12 기획 P1) 발급 원장에 오르지 않는 양식 — 대조할 곳 없는 QR 을 싣지 않고 "원장 미등재"를 쪽마다 적는다 · 문서 번호·쪽은 그대로
    await waitFor(() => expect(root()!.querySelector('style[data-print-page-qr]')?.getAttribute('data-print-page-qr')).toBe('none'));
    const css = root()!.querySelector('style[data-print-page-qr]')!.textContent!;
    expect(css).toContain('DOC-DX · ');
    expect(css).toContain('원장 미등재');
    expect(css).not.toContain('url(data:');
    expect(css).not.toContain('sha256');
  });
});

describe('QI 보고서 인쇄', () => {
  it('🔴 인쇄 루트 · 보존 sha256 · 지표 표 · 서명란 · QR 에 id·기간·상태만', async () => {
    get.mockResolvedValue({ data: {
      id: 'r1', period: '2026-09', title: '9월 QI 보고서', status: 'SUBMITTED', createdAt: '2026-10-01T00:00:00Z', submittedAt: null, agendaId: null, sha256: 'a'.repeat(64),
      body: { sections: { indicatorDashboard: [{ indicatorId: 'i1', name: '낙상률', category: 'SAFETY', current: null, target: 1, unit: '‰', achieved: null, latestAvailablePeriod: null }] } },
    } });
    const { default: Page } = await import('@/app/(main)/print/qi-report/[id]/page');
    const params = Object.assign(Promise.resolve({ id: 'r1' }), { status: 'fulfilled', value: { id: 'r1' } });
    render(<Suspense fallback={null}><Page params={params} /></Suspense>, { wrapper: wrap });
    await waitFor(() => expect(root()?.querySelector('[data-print-doc="qi-report:r1"]')).toBeTruthy());
    const d = root()!.querySelector('[data-print-doc="qi-report:r1"]')!;
    expect(d.querySelector('[data-print-doc-hash]')!.textContent).toContain('a'.repeat(64));
    expect(d.querySelector('[data-qi-print-row="i1"]')!.textContent).toContain('미측정');
    expect(d.querySelector('[data-print-signoff]')).toBeTruthy();
    // 🔴 공용 PrintDoc — 쪽마다 QR(여백 상자) · 보존 해시 앞 16자 · 쪽 n / N
    await waitFor(() => expect(root()!.querySelector('style[data-print-page-qr]')?.getAttribute('data-print-page-qr')).toBe('ready'));
    const css = root()!.querySelector('style[data-print-page-qr]')!.textContent!;
    expect(css).toContain(`HIS-QI-REPORT v1 · sha256 ${'a'.repeat(16)}`);
    expect(css).toMatch(/@bottom-right \{ content: url\(data:image\/png;base64,/);
  });
});
