/**
 * 외국인 환자 등록 정돈(2026-09-29 "디자인 세련되게") — 모양을 고치다 드러난 사실 결함을 못박는다.
 *  1. 🔴 등록 실패 사유가 늘 '등록 실패'였다 — `err.response.data.message` 를 읽었는데 apiClient 의 ApiError 에는 response 가 없다
 *  2. 🔴 등록 목록 조회 실패가 "등록된 외국인 환자가 없습니다"로 그려졌다
 *  3. 등록 버튼이 비활성인 이유(빠진 필수 항목)를 말하지 않았다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '@/lib/api-client';

const get = vi.fn();
const post = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), del: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => '/patients/register/foreign', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }));
vi.mock('@/hooks/use-admin-write', () => ({ useAdminWrite: () => true, useHasRole: () => true }));

function route(url: string) {
  if (url.startsWith('/api/v1/patients/foreign/list')) return Promise.resolve({ data: [] });
  return Promise.resolve({ data: [] });
}
async function mount() {
  const { default: Page } = await import('@/app/(main)/patients/register/foreign/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const typeInto = (placeholder: string, value: string) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); toastError.mockReset(); get.mockImplementation(route); });

describe('외국인 환자 등록', () => {
  it('빠진 필수 항목을 말하고, 채우면 사라진다', async () => {
    const { container } = await mount();
    const box = () => container.querySelector('[data-missing-fields]');
    expect(box()?.textContent).toMatch(/성.*이름.*생년월일/);
    typeInto('Kim', 'Smith'); typeInto('Minjun', 'John');
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
    expect(box()).toBeNull();
  });

  it('🔴 등록 실패는 서버 사유를 그대로 말한다(늘 "등록 실패"가 아니다)', async () => {
    post.mockRejectedValue(new ApiError('CONFLICT', '같은 여권번호로 등록된 환자가 있습니다'));
    const { container } = await mount();
    typeInto('Kim', 'Smith'); typeInto('Minjun', 'John');
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: /외국인 환자 등록/ }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toContain('같은 여권번호로 등록된 환자가 있습니다');
  });

  it('🔴 등록 목록 조회 실패는 "없음"이 아니다', async () => {
    get.mockImplementation((url: string) => (url.startsWith('/api/v1/patients/foreign/list') ? Promise.reject(new Error('500')) : route(url)));
    const { container } = await mount();
    fireEvent.click(screen.getByText('등록 목록'));
    expect((await screen.findAllByText(/다시 시도|재시도/, {}, { timeout: 3000 })).length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('등록된 외국인 환자가 없습니다');
  });

  it('환자 유형 카드는 하나만 선택된다', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-patient-type="FOREIGN_RESIDENT"]')!);
    const checked = [...container.querySelectorAll('[data-patient-type][aria-checked="true"]')].map((e) => (e as HTMLElement).dataset.patientType);
    expect(checked).toEqual(['FOREIGN_RESIDENT']);
  });
});

describe('구조 — apiClient 오류에서 없는 필드(response.data.message)를 읽지 않는다', () => {
  const SRC = join(__dirname, '../../src');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(p)) out.push(p); }
    return out;
  };
  it('ApiError 에는 response 가 없다 — 그 경로로 읽으면 서버 사유가 늘 일반 문구로 덮인다(0 곳)', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(300); // 스캔이 실제로 돌았다
    const hits = files.filter((f) => /response\?*\.data\?*\.message/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});
