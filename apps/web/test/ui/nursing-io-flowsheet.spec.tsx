/**
 * 입원 I/O·플로시트 입력(2026-10-10).
 *  · 🔴 한 행에 섭취·배설이 함께 있으면(운영 80건) I/O 화면이 섭취만 그리고 배설을 버렸다
 *  · 🔴 I/O 유형이 '경구'·'소변'으로 미리 골라져 있었다 — 미선택 시작 · 유형 없이는 저장 불가
 *  · 플로시트 칸에서 온 I/O 행은 출처를 밝힌다
 *  · 플로시트 폼 — 측정 시각은 고른 경우에만 보낸다 · 빈 칸은 보내지 않는다 · 아무 값도 없으면 저장 불가
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Suspense } from 'react';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { hasAnyFlowsheetValue, toFlowsheetBody } from '@/lib/flowsheet-form';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/inpatient/a1/nursing/io', useSearchParams: () => new URLSearchParams(), useParams: () => ({ admissionId: 'a1' }) }));

// 🔴 Promise 는 한 번만 만든다 — 렌더마다 새 Promise 면 use() 가 매번 다시 멈춘다
// React 의 use() 가 이미 풀린 값으로 읽도록 상태를 붙여 둔다(첫 렌더에서 멈추지 않게)
const PARAMS = Object.assign(Promise.resolve({ admissionId: 'a1' }), { status: 'fulfilled', value: { admissionId: 'a1' } });
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => {
  cleanup(); get.mockReset(); post.mockReset();
  useAuthStore.setState({ user: { id: 'n1', role: 'NURSE', familyName: '김', givenName: '간호' } as never, isAuthenticated: true });
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/intake-outputs/summary')) return { data: { totalIntake: 800, totalOutput: 200, balance: 600, byHour: [] } };
    if (url.endsWith('/intake-outputs')) return { data: [
      { id: 'io1', ledger: 'IO', recordedAt: '2026-10-10T01:00:00Z', intakeType: 'ORAL', intakeAmount: 300, outputType: 'URINE', outputAmount: 200, nurse: null },
      { id: 'fs:f1:intakeIv', ledger: 'FLOWSHEET', recordedAt: '2026-10-10T03:00:00Z', intakeType: 'IV', intakeAmount: 500, outputType: null, outputAmount: null, nurse: null },
    ] };
    return { data: null };
  });
});

describe('I/O 화면', () => {
  // 첫 import(컴파일)가 느려 테스트 시간에 들어가지 않게 미리 불러 둔다
  let Page: React.ComponentType<{ params: Promise<{ admissionId: string }> }>;
  beforeAll(async () => { Page = (await import('@/app/(main)/inpatient/[admissionId]/nursing/io/page')).default; }, 30_000);
  it('🔴 한 행의 섭취·배설을 둘 다 그린다 · 플로시트 출처 표시', async () => {
    const { container } = render(<Suspense fallback={null}><Page params={PARAMS} /></Suspense>, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-io-row="io1"]')).not.toBeNull(), { timeout: 5000 });
    const row = container.querySelector('[data-io-row="io1"]')!.textContent!;
    expect(row).toContain('300');
    expect(row).toContain('200'); // 종전엔 배설이 사라졌다
    expect(container.querySelector('[data-io-row="fs:f1:intakeIv"]')!.getAttribute('data-io-ledger')).toBe('FLOWSHEET');
    expect(container.querySelector('[data-io-row="io1"]')!.getAttribute('data-io-ledger')).toBe('IO');
  });
  it('🔴 유형 미선택 시작 — 양만 넣어선 저장할 수 없다', async () => {
    const { container, getAllByText } = render(<Suspense fallback={null}><Page params={PARAMS} /></Suspense>, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-io-row="io1"]')).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(getAllByText('+ 섭취')[0]);
    const form = container.querySelector('[data-io-save]')!.closest('div.bg-white')!;
    const select = form.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.change(form.querySelector('input[type="number"]')!, { target: { value: '150' } });
    expect((container.querySelector('[data-io-save]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'ORAL' } });
    expect((container.querySelector('[data-io-save]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('플로시트 폼 본문', () => {
  it('측정 시각은 고른 경우에만 ISO 로 · 빈 칸은 보내지 않는다 · 측정한 0 은 보낸다', () => {
    expect(toFlowsheetBody({ heartRate: 80, spo2: undefined, painScore: 0, notes: '' })).toEqual({ heartRate: 80, painScore: 0 });
    const b = toFlowsheetBody({ heartRate: 80, recordedAtLocal: '2026-10-10T09:30', supplementalO2: false });
    expect(typeof b.recordedAt).toBe('string');
    expect(b.supplementalO2).toBe(false); // 관측한 '아니오'는 보낸다
    expect('recordedAtLocal' in b).toBe(false);
  });
  it('🔴 메모·시각만으로는 저장할 값이 없다', () => {
    expect(hasAnyFlowsheetValue({ notes: '메모', recordedAtLocal: '2026-10-10T09:30' })).toBe(false);
    expect(hasAnyFlowsheetValue({ outputUrine: 0 })).toBe(true);
  });
});
