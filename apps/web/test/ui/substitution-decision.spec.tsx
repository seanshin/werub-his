/**
 * 대체조제 판정 화면 — 2026-09-30.
 *  1. 거부는 사유를 적어야 확정된다(빈 사유로 보내지 않는다) · 승인 메모는 선택
 *  2. 최근 판정: 책임 처방의 / 관리자·대리 / 판정자 기록 없음(기능 도입 전)을 구분해 말한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: vi.fn(), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); patch.mockReset(); });

describe('판정 버튼', () => {
  const mount = async () => {
    const { SubstitutionDecision } = await import('@/components/pharmacy/SubstitutionDecision');
    return render(<SubstitutionDecision id="g1" />, { wrapper: wrap });
  };
  it('거부 — 사유가 비면 확정 불가 · 사유와 함께 보낸다', async () => {
    patch.mockResolvedValue({ data: {} });
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-sub-reject]')!);
    const ok = container.querySelector('[data-sub-confirm]') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-sub-note]')!, { target: { value: '원처방 유지' } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/pharmacy/substitution/g1/reject', { note: '원처방 유지' }));
  });
  it('승인 — 메모 없이 확정할 수 있다(빈 본문)', async () => {
    patch.mockResolvedValue({ data: {} });
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-sub-approve]')!);
    const ok = container.querySelector('[data-sub-confirm]') as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/pharmacy/substitution/g1/approve', {}));
  });
});

describe('두 화면이 같은 판정 부품을 쓴다', () => {
  it('의사 회신 화면·약제 관리 화면 모두 SubstitutionDecision — 사유 없는 직접 PATCH 가 남지 않았다', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), 'src/app/(main)', p), 'utf8');
    for (const p of ['pharmacist-replies/page.tsx', 'pharmacy/admin/page.tsx']) {
      const src = read(p);
      expect(src, p).toMatch(/<SubstitutionDecision id=\{s\.id\}/);
      expect(src, p).not.toMatch(/substitution\/\$\{id\}\/(approve|reject)`\)/);
    }
    const admin = read('pharmacy/admin/page.tsx');
    expect(admin).toMatch(/data-sub-decider=\{s\.decidedBy \? \(s\.decidedBy\.isPrescriber \? 'PRESCRIBER' : 'PROXY'\) : 'UNKNOWN'\}/);
    expect(admin).toContain('판정자 기록 없음(기능 도입 전 판정)');
  });
});

describe('판정 결과 알림 링크', () => {
  it('약사가 받는 판정 결과는 약제 관리로 · 의사가 받는 승인 요청은 종전대로 의사 화면으로', async () => {
    const { hrefForNotification } = await import('@/stores/notification-store');
    expect(hrefForNotification('GENERIC_SUBSTITUTION', 'x', 'SUBSTITUTION_DECIDED')).toBe('/pharmacy/admin');
    expect(hrefForNotification('GENERIC_SUBSTITUTION', 'x', 'SUBSTITUTION_REQUEST')).toBe('/doctor-inbox?tab=pharmacist');
  });
});
