/**
 * 직종별 오더 입력 범위·결과 기록 화면(2026-09-29 사람 요청 — 간호사·물리치료사 등이 각자 권한으로 등록·결과 기록).
 *  1. 유형별 모드 — 본인 권한이면 의사 선택을 띄우지 않고, 불가면 불가라고 말한다(종전: 비의사면 모든 유형에 의사 승인)
 *  2. authorize — 본인 권한은 승인 없이 저장, 불가는 저장 중단
 *  3. 결과 패널 — 범용 유형만 기록 폼 · 검사·영상·약은 전용 화면 안내 · 범위 밖이면 폼 없음 · 정정은 amends
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/upload', () => ({ uploadMultipart: vi.fn(async () => ({})) }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const NURSE_SCOPE = {
  profession: 'NURSE', professionSource: 'ROLE_DEFAULT',
  modes: { MEDICATION: 'DELEGATE', LAB: 'DELEGATE', IMAGING: 'DELEGATE', THERAPY: 'DELEGATE', DIET: 'DELEGATE', ACTIVITY: 'DELEGATE', NURSING: 'SELF' },
  executes: { MEDICATION: true, LAB: false, IMAGING: false, THERAPY: true, DIET: true, ACTIVITY: true, NURSING: true },
};
const INFO = { enabled: false, delegationRequired: true, entryScope: NURSE_SCOPE, prescribers: [{ id: 'doc', name: '이의사' }] } as unknown as import('@/components/prescription/PrescriberDelegate').AuthorizedPrescribers;

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('유형별 입력 모드', () => {
  it('간호 오더는 본인 권한 배너 · 약은 의사 선택 · 모르는 유형은 구 의미로 접는다', async () => {
    const { PrescriberPicker, entryModeFor } = await import('@/components/prescription/PrescriberDelegate');
    const common = { info: INFO, infoState: 'OK' as const, prescriberId: '', onSelect: () => {}, status: 'IDLE' as const };
    const a = render(<PrescriberPicker {...common} orderType="NURSING" />);
    expect(a.container.querySelector('[data-entry-mode="SELF"]')).toBeTruthy();
    a.unmount();
    const b = render(<PrescriberPicker {...common} orderType="MEDICATION" />);
    expect(b.container.querySelector('[data-entry-mode]')).toBeNull();
    expect(b.container.textContent).toContain('이의사');
    expect(entryModeFor({ delegationRequired: true }, 'NURSING')).toBe('DELEGATE'); // 구 서버(표 없음)
  });

  it('authorize — 본인 권한은 승인 요청 없이 통과 · 불가 유형은 저장 중단', async () => {
    get.mockImplementation(async (url: string) => (url.includes('authorized-prescribers') ? { data: { ...INFO, entryScope: { ...NURSE_SCOPE, modes: { ...NURSE_SCOPE.modes, LAB: 'NONE' } } } } : { data: {} }));
    const { usePrescriberDelegate } = await import('@/components/prescription/PrescriberDelegate');
    const { result } = renderHook(() => usePrescriberDelegate('enc'), { wrapper: wrap });
    await vi.waitFor(() => expect(result.current.infoState).toBe('OK'));
    let r: unknown;
    await act(async () => { r = await result.current.authorize({ type: 'NURSING' }); });
    expect(r).toEqual({ fields: {} });
    expect(post).not.toHaveBeenCalled();
    await act(async () => { r = await result.current.authorize({ type: 'LAB' }); });
    expect(r).toBeNull();
  });
});

describe('결과·시행 기록 패널', () => {
  const mount = async (props: { type: string; status?: string; result?: unknown; executes?: Record<string, boolean> }) => {
    get.mockImplementation(async (url: string) => (url.includes('entry-scope/me') ? { data: { ...NURSE_SCOPE, executes: props.executes ?? NURSE_SCOPE.executes } } : { data: {} }));
    const { OrderResultPanel } = await import('@/app/(main)/orders/OrderResultPanel');
    return render(<OrderResultPanel orderId="o1" type={props.type} status={props.status ?? 'IN_PROGRESS'} result={props.result ?? null} />, { wrapper: wrap });
  };

  it('간호 오더 — 기록 폼 · 시행 시각은 ISO 로 · 완료 체크 기본', async () => {
    post.mockResolvedValue({ data: {} });
    const { container } = await mount({ type: 'NURSING' });
    await vi.waitFor(() => expect(container.querySelector('[data-result-form]')).toBeTruthy());
    fireEvent.change(container.querySelector('[data-result-summary]')!, { target: { value: '체위변경 시행' } });
    fireEvent.change(container.querySelector('[data-result-performed]')!, { target: { value: '2026-09-29T09:30' } });
    fireEvent.click(container.querySelector('[data-result-submit]')!);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/v1/orders/o1/result');
    expect(body).toMatchObject({ summary: '체위변경 시행', complete: true, performedAt: new Date('2026-09-29T09:30').toISOString() });
  });

  it('검사 오더 — 전용 화면 안내 · 기록 폼 없음(검사를 완료할 수 있는 직종이어도)', async () => {
    const { container } = await mount({ type: 'LAB', executes: { LAB: true } });
    // 범위 표가 도착한 뒤에 본다(결과지 첨부 버튼 = 기록 가능 판정 완료) — 도착 전에 보면 폼이 없는 게 당연하다
    await vi.waitFor(() => expect(container.querySelector('[data-result-upload]')).toBeTruthy());
    expect(container.querySelector('[data-result-dedicated]')).toBeTruthy();
    expect(container.querySelector('[data-result-form]')).toBeNull();
    expect(container.querySelector('a[href="/lab"]')).toBeTruthy();
  });

  it('범위 밖(치료 결과를 기록할 수 없는 직종) — 폼·첨부 없음, 이유를 말한다', async () => {
    const { container } = await mount({ type: 'THERAPY', executes: { THERAPY: false } });
    await screen.findByText(/시행 직종이 기록합니다/);
    expect(container.querySelector('[data-result-form]')).toBeNull();
    expect(container.querySelector('[data-result-upload]')).toBeNull();
  });

  it('정정 — 원래 기록을 가리켜 덧붙인다(완료 플래그 없음)', async () => {
    post.mockResolvedValue({ data: {} });
    const first = { id: '11111111-1111-4111-8111-111111111111', kind: 'RESULT', summary: '처음', performedAt: null, recordedAt: '2026-09-29T00:00:00Z', recordedBy: 'n' };
    const { container } = await mount({ type: 'NURSING', status: 'COMPLETED', result: { entries: [first], attachments: [] } });
    await vi.waitFor(() => expect(container.querySelector(`[data-amend="${first.id}"]`)).toBeTruthy());
    fireEvent.click(container.querySelector(`[data-amend="${first.id}"]`)!);
    fireEvent.change(container.querySelector('[data-result-summary]')!, { target: { value: '처음(정정)' } });
    fireEvent.click(container.querySelector('[data-result-submit]')!);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ summary: '처음(정정)', amends: first.id });
  });

  it('구 형식(문자열) 결과는 지우지 않고 보인다', async () => {
    const { container } = await mount({ type: 'NURSING', result: '예전 결과 문장' });
    expect(container.textContent).toContain('예전 결과 문장');
  });
});
