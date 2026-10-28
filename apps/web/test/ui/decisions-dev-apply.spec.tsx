/**
 * 개발 반영 추적 화면(2026-10-12 기획 `decision-print-remaining` P2-4).
 *  · 행 칩 — 🔴 반영 대기 ≠ 반영됨(색·글자) · 미결은 그리지 않는다(시드는 이행이 아니다) · 확인 불가는 말한다
 *  · 의사결정 작업대 — 코드가 이미 다른 선택대로 돌면 "이미 구현된 동작을 되돌려야 합니다"를 그 자리에서
 *  · 결정 문서 반영 기록 — 관리자만 · 실결정 있을 때만 · 반영 확인은 릴리즈 버전 형식 · 근거 필수
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(async () => ({ data: {} })), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const setRole = (role: string) => useAuthStore.setState({ user: { id: 'u', role } as never, isAuthenticated: true });
beforeEach(() => { cleanup(); api.post.mockClear(); setRole('ADMIN'); });

const item = (over: Record<string, unknown> = {}) => ({
  key: 'journey.outpatientEnd', title: 't', decided: true, seeded: false, record: { choice: 'BILLING_PAID', decidedAt: '2026-10-12T00:00:00Z' },
  options: [{ value: 'BILLING_PAID', label: '수납 완료', effect: 'e' }, { value: 'VISIT_CLOSED', label: '진료 종료', effect: 'e' }],
  devApply: { status: 'PENDING_DEV', version: null, since: '2026-10-12T00:00:00Z', implementedChoice: 'BILLING_PAID' },
  ...over,
}) as never;

describe('이행 칩', () => {
  it('🔴 반영 대기와 반영됨은 다른 칩 · 반영됨은 버전 · 미결은 그리지 않음 · 확인 불가는 말한다', async () => {
    const { DevApplyChip } = await import('@/app/(main)/admin/decisions/engine-parts');
    const a = render(<DevApplyChip dev={{ status: 'PENDING_DEV', version: null, since: null, implementedChoice: null }} />);
    const pending = a.container.querySelector('[data-row-devapply="PENDING_DEV"]')!;
    expect(pending.textContent).toContain('반영 대기');
    cleanup();
    const b = render(<DevApplyChip dev={{ status: 'ENACTED', version: 'v4.75.0', since: null, implementedChoice: null }} />);
    const enacted = b.container.querySelector('[data-row-devapply="ENACTED"]')!;
    expect(enacted.textContent).toContain('v4.75.0');
    expect(enacted.className).not.toBe(pending.className);
    cleanup();
    expect(render(<DevApplyChip dev={{ status: 'UNDECIDED', version: null, since: null, implementedChoice: null }} />).container.textContent).toBe('');
    cleanup();
    expect(render(<DevApplyChip dev={{ status: null, version: null, since: null, implementedChoice: null }} />).container.textContent).toContain('확인 불가');
  });
});

describe('의사결정 작업대 — 구현된 선택과 다르면', () => {
  it('🔴 다른 선택 → 되돌려야 한다 · 같은 선택 → 이미 그대로 동작 · 구현 선택 없으면 침묵', async () => {
    const { ImplementedChoiceNotice } = await import('@/app/(main)/admin/decisions/engine-parts');
    expect(render(<ImplementedChoiceNotice item={item()} choice="VISIT_CLOSED" />).container.querySelector('[data-implemented-notice="DIFF"]')!.textContent).toContain('되돌려야');
    cleanup();
    expect(render(<ImplementedChoiceNotice item={item()} choice="BILLING_PAID" />).container.querySelector('[data-implemented-notice="SAME"]')).toBeTruthy();
    cleanup();
    expect(render(<ImplementedChoiceNotice item={item({ devApply: { status: 'PENDING_DEV', version: null, since: null, implementedChoice: null } })} choice="VISIT_CLOSED" />).container.textContent).toBe('');
  });
});

describe('결정 문서 — 반영 기록', () => {
  it('관리자·실결정 → 기록 창 · 🔴 반영 확인은 버전 형식이 맞아야 저장 · 보낸 값 그대로', async () => {
    const { DevApplyPanel } = await import('@/app/(main)/admin/decisions/engine-parts');
    const v = render(<DevApplyPanel item={item()} />);
    const save = v.container.querySelector('button[data-devapply-save]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(v.container.querySelector('select')!, { target: { value: 'DEV_ENACTED' } });
    const [ver, note] = [...v.container.querySelectorAll('input')] as HTMLInputElement[];
    fireEvent.change(note, { target: { value: '커밋 abc' } });
    fireEvent.change(ver, { target: { value: '4.75' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(ver, { target: { value: 'v4.75.0' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/admin/decisions/journey.outpatientEnd/dev-enactment', { kind: 'DEV_ENACTED', note: '커밋 abc', version: 'v4.75.0' }));
    expect(v.container.textContent).toContain('판정표');
  });
  it('대조군 — 관리자 아니면 기록 창 없음 · 실결정 없으면 이행 없음을 말한다', async () => {
    const { DevApplyPanel } = await import('@/app/(main)/admin/decisions/engine-parts');
    setRole('EXECUTIVE');
    const a = render(<DevApplyPanel item={item()} />);
    expect(a.container.querySelector('button[data-devapply-save]')).toBeNull();
    expect(a.container.textContent).toContain('관리자가 남깁니다');
    cleanup(); setRole('ADMIN');
    const b = render(<DevApplyPanel item={item({ decided: false, seeded: true, devApply: { status: 'UNDECIDED', version: null, since: null, implementedChoice: 'BILLING_PAID' } })} />);
    expect(b.container.querySelector('button[data-devapply-save]')).toBeNull();
    expect(b.container.textContent).toContain('개발 시드는 결정이 아닙니다');
  });
});
