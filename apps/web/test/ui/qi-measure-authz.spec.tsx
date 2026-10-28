import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 가드 — QI 측정 **입력 권한**과 **정정이 값을 조용히 바꾸지 않는가** (2026-08-18).
 *
 * 🔴 원 결함 ①: 입력·정정·무효화가 전부 ADMIN 단독이라, 감염관리·환자안전 지표를 실제로 산출하는
 *    간호(감염관리실·환자안전 전담인력)가 자기 지표를 넣을 수 없었다. 운영 계정 102개 중 ADMIN 은 2개.
 * 🔴 원 결함 ②: 정정 폼은 현재 분자/분모를 프리필하는데, 운영 측정 300건 중 **273건(91%)** 은 저장된
 *    값이 그 분자/분모에서 나온 값이 아니다(시드가 값을 먼저 정하고 분모를 ×100 가정으로 역산).
 *    그래서 **아무것도 고치지 않고 [정정 저장] 을 누르기만 해도** 낙상률이 0.79 → 7.95(10배)로 바뀌었다.
 *
 * 각 항목은 결함을 재주입하면 실패한다.
 */

const { get, post, patchFn, toastSuccess, toastError, role } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patchFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  role: { current: 'ADMIN' as string },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (path: string, params?: unknown) => get(path, params),
    post: (path: string, body?: unknown) => post(path, body),
    patch: (path: string, body?: unknown) => patchFn(path, body),
    del: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: role.current } }),
}));

import QualityPage from '../../src/app/(main)/quality/page';

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

const FALL = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '낙상 발생률',
  category: '환자안전',
  formula: '(낙상 발생 건수 / 재원일수) × 1000',
  unit: '건/1000 재원일수',
  direction: 'LOWER_IS_BETTER',
  directionSource: 'REGISTRY',
  directionConflict: false,
  registeredDirection: null,
  registeredUnit: null,
  registeredValueScale: null,
  valueScale: 1000,
  valueScaleKnown: true,
  valueScaleSource: 'FORMULA',
  targetValue: 1.5,
  latestValue: 0.79,
  latestPeriod: '2026-07',
  meetTarget: true,
  undeterminedReason: null,
  achievementPercent: 100,
};

/** 🔴 운영 실제 행 — 값 0.79 인데 68/8550×1000 = 7.95 다(시드가 ×100 가정으로 분모를 역산했다). */
const SEEDED_ROW = {
  id: 'm-seed',
  period: '2026-07',
  numerator: 68,
  denominator: 8550,
  value: 0.79,
  unit: '건/1000 재원일수',
  direction: 'LOWER_IS_BETTER',
  valueScale: 1000,
  valueScaleKnown: true,
  valueScaleSource: 'FORMULA',
  target: 1.5,
  meetTarget: true,
  storedMeetTarget: true,
  storedDiverges: false,
  valueDerived: false,
  ratioValue: 7.95,
  undetermined: false,
  undeterminedReason: null,
  measuredAt: '2026-08-01T00:10:00.000Z',
};

beforeEach(() => {
  role.current = 'ADMIN';
  get.mockReset();
  post.mockReset();
  patchFn.mockReset();
  get.mockImplementation((path: string) => {
    if (path.includes('/quality/dashboard')) return Promise.resolve({ data: [FALL] });
    if (path.includes(`/quality/measurements/${FALL.id}`)) return Promise.resolve({ data: [SEEDED_ROW] });
    return Promise.resolve({ data: [] });
  });
});

async function openPanel() {
  render(withQuery(<QualityPage />));
  const hits = await screen.findAllByText('낙상 발생률');
  const row = hits.find((el) => el.closest('td'))!.closest('tr') as HTMLTableRowElement;
  fireEvent.click(within(row).getByRole('button', { name: '측정' }));
  return screen.findByTestId(`qi-panel-${FALL.id}`);
}

describe('QI 측정 입력 권한 — 화면', () => {
  it('🔴 간호(NURSE)가 측정값을 입력할 수 있다 — 지표를 만드는 사람이 못 넣던 것', async () => {
    role.current = 'NURSE';
    const panel = await openPanel();
    expect(within(panel).getByTestId('qi-measure-submit')).toBeTruthy();
    expect(within(panel).getByLabelText('분자')).toBeTruthy();
  });

  it('🔴 간호에게는 **무효화 버튼이 없다** — 입력자가 자기 입력을 집계에서 지울 수 없다', async () => {
    role.current = 'NURSE';
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getByText('2026-07')).toBeTruthy());
    expect(within(panel).getAllByRole('button', { name: '정정' }).length).toBeGreaterThan(0);
    expect(within(panel).queryByRole('button', { name: '무효화' })).toBeNull();
  });

  it('관리자는 무효화까지 할 수 있다(직무 분리의 다른 쪽)', async () => {
    role.current = 'ADMIN';
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getByText('2026-07')).toBeTruthy());
    expect(within(panel).getAllByRole('button', { name: '무효화' }).length).toBeGreaterThan(0);
  });

  it('🔴 입력 권한만 있는 간호에게 없는 버튼([정의])을 가리키지 않는다', async () => {
    role.current = 'NURSE';
    get.mockImplementation((path: string) => {
      if (path.includes('/quality/dashboard')) {
        return Promise.resolve({ data: [{ ...FALL, direction: null, directionSource: null, meetTarget: null }] });
      }
      if (path.includes(`/quality/measurements/${FALL.id}`)) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    const panel = await openPanel();
    expect(panel.textContent).toContain('지표 정의 권한(관리자)');
    expect(panel.textContent).not.toContain('같은 행의 [정의] 버튼에서 방향을 등재하면');
  });

  it('권한 없는 역할(DOCTOR)은 입력 폼 대신 무엇이 필요한지 듣는다 — 이력은 본다', async () => {
    role.current = 'DOCTOR';
    const panel = await openPanel();
    expect(within(panel).queryByTestId('qi-measure-submit')).toBeNull();
    expect(panel.textContent).toContain('qi:measure:write');
    await waitFor(() => expect(within(panel).getByText('2026-07')).toBeTruthy());
  });
});

describe('정정은 고친 것만 바꾼다 — 화면', () => {
  it('🔴 값이 분자/분모에서 나온 것이 아니면 표가 그 사실을 말한다(P12)', async () => {
    const panel = await openPanel();
    const marker = await within(panel).findByTestId('qi-value-not-derived');
    expect(marker.textContent).toContain('분자/분모 산출값 아님');
    expect(marker.textContent).toContain('7.95'); // 정정하면 값이 여기로 옮겨간다
  });

  it('🔴 프리필 그대로 누르는 정정은 막힌다 — 손대지 않은 값이 10배가 되던 경로', async () => {
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getByText('2026-07')).toBeTruthy());
    fireEvent.click(within(panel).getAllByRole('button', { name: '정정' })[0]);
    const form = await within(panel).findByTestId('qi-correct-form');
    expect(within(form).getByTestId('qi-correct-unchanged')).toBeTruthy();
    expect((within(form).getByTestId('qi-correct-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(patchFn).not.toHaveBeenCalled();
  });

  it('실제로 고치면 값이 어떻게 바뀌는지 **누르기 전에** 보여준다', async () => {
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getByText('2026-07')).toBeTruthy());
    fireEvent.click(within(panel).getAllByRole('button', { name: '정정' })[0]);
    const form = await within(panel).findByTestId('qi-correct-form');
    fireEvent.change(within(form).getAllByPlaceholderText('분자')[0], { target: { value: '12' } });
    const preview = within(form).getByTestId('qi-correct-preview');
    expect(preview.textContent).toContain('0.79');
    expect(preview.textContent).toContain('1.4');
    expect((within(form).getByTestId('qi-correct-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});
