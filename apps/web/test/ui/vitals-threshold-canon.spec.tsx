/**
 * 화면 활력 이상 표시 = 임계 정본(shared + 환자안전위 개정) — 2026-10-01 전수 수렴.
 *  · 플로시트: 종전 자기 숫자(SBP>160·HR>120)·혈압 칸 문자열이라 어떤 혈압도 이상 표시 안 됨 → 정본 판정·혈압도 판정
 *  · 개정 임계를 받으면 그 기준으로 칠한다 · 기준 조회 실패는 "코드 기본값으로 표시"라고 밝힌다(판정은 계속)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VITALS_THRESHOLDS } from '@hospital-run/shared';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ admissionId: 'a1' }), useRouter: () => ({ push: vi.fn() }), usePathname: () => '/x', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/nursing/NurseOnlyGuard', () => ({ NurseOnlyGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const grid = (e: Record<string, unknown>) => ({ data: { grid: [{ hour: '08:00', entry: e }], totals: {} } });

beforeEach(() => { cleanup(); get.mockReset(); });

async function mountFlowsheet(thr: unknown) {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/vitals-thresholds')) { if (thr instanceof Error) throw thr; return { data: thr }; }
    return grid({ systolicBp: 150, diastolicBp: 85, heartRate: 105, temperature: 36.8, spo2: 97, painScore: 2 });
  });
  const { default: Page } = await import('@/app/(main)/inpatient/[admissionId]/nursing/flowsheet/page');
  return render(<Page />, { wrapper: wrap });
}
// 2026-10-07 플로시트 칸은 활력 표시 부품(VitalRowCells) — 값 칸의 바깥 span 이 이상 색을 갖는다(글자 '주의'는 sr-only 로 붙는다)
const cell = (c: HTMLElement, text: string) => [...c.querySelectorAll<HTMLElement>('[data-vital]')].find((s) => s.querySelector('bdi')?.textContent === text)!;

describe('플로시트 — 정본 판정', () => {
  it('🔴 혈압도 판정한다(종전 문자열이라 늘 정상) · 주의 역치는 주황', async () => {
    const { container } = await mountFlowsheet({ thresholds: VITALS_THRESHOLDS, source: 'DEFAULT', droppedKeys: [], invertedKeys: [] });
    await waitFor(() => expect(container.textContent).toContain('150/85'));
    expect(cell(container, '150/85').className).toContain('text-amber-700');
    expect(cell(container, '105').className).toContain('text-amber-700');
    expect(cell(container, '97').className).not.toMatch(/amber|red/);
    await waitFor(() => expect(container.textContent).toContain('이상 표시 기준: 코드 기본값(원내 개정 없음)'));
  });
  it('🔴 환자안전위 개정 임계를 따른다(HR 주의 110 으로 올리면 105 는 정상)', async () => {
    const T = JSON.parse(JSON.stringify(VITALS_THRESHOLDS)); T.heartRate.warnHigh = 110;
    const { container } = await mountFlowsheet({ thresholds: T, source: 'CONFIGURED', droppedKeys: [], invertedKeys: [] });
    await waitFor(() => expect(container.textContent).toContain('환자안전위 개정 반영'));
    expect(cell(container, '105').className).not.toMatch(/amber|red/);
  });
  it('기준 조회 실패 — 코드 기본값으로 판정은 계속하고 그 사실을 말한다', async () => {
    const { container } = await mountFlowsheet(new Error('403'));
    await waitFor(() => expect(container.textContent).toContain('이상 표시 기준을 확인하지 못했습니다'));
    expect(cell(container, '105').className).toContain('text-amber-700');
  });
});
