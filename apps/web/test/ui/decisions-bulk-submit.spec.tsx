/**
 * 위원회 안건 일괄 상정 화면(2026-10-21 사용자 "안건 상정까지 기능 구현").
 *  · 후보 = 이 위원회 주관·합동 · 위원회 층 · 건별 판단·권한자 기록 제외
 *  · 🔴 이미 실결정·안건 진행 중·안건 확인 불가는 이유와 함께 보이되 고를 수 없다
 *  · 🔴 미선택으로 시작 — 결정도 회의 방식도 고르기 전엔 잠김 · 보낸 값 = 사람이 고른 그대로
 *  · 새 회의는 참석자 없이(회의 때 사람이) · 결과는 항목마다 · 단건 상정 단추는 열린 안건이면 진행 상태로
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const d = (key: string, extra: Record<string, unknown>) => ({
  key, title: `제목 ${key}`, layer: 'INTERNAL_COMMITTEE', approvalPath: 'CODE_CHANGE', mechanism: 'DEV_APPLY', decided: false,
  options: [{ value: 'A', label: '가안', effect: '' }], record: null, seeded: true, agenda: null,
  committee: { lead: 'MRC', joint: [] }, ...extra,
});
const AG = (status: string) => ({ id: `ag-${status}`, status, meetingId: null, committee: { code: 'MRC', name: '의무기록위원회' }, updatedAt: '2026-10-20T00:00:00Z' });
const ITEMS = [
  d('s1', {}),
  d('s2', { agenda: AG('RESOLVED'), decided: false }), // 지난 안건 의결됐지만 실결정 없음 → 다시 올릴 수 있다
  d('done', { decided: true, seeded: false }),
  d('open', { agenda: AG('SCHEDULED') }),
  d('unk', { agenda: 'UNKNOWN' }),
  d('role1', { approvalPath: 'AUTHORIZED_ROLE', mechanism: 'AUTO_APPLY' }),
  d('joint1', { committee: { lead: 'OPS', joint: ['MRC'] } }),
  d('other', { committee: { lead: 'OPS', joint: [] } }),
  d('ev', { mechanism: 'PER_EVENT' }),
];
const MEETINGS = [
  { id: 'm1', title: 'MRC 11월', scheduledAt: '2026-11-05T00:00:00Z', status: 'SCHEDULED', minutesSignedAt: null },
  { id: 'm-sealed', title: '봉인됨', scheduledAt: '2026-10-01T00:00:00Z', status: 'SCHEDULED', minutesSignedAt: '2026-10-02T00:00:00Z' },
];

async function mount() {
  get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/governance/summary') return { data: { committees: [{ id: 'c-mrc', code: 'MRC' }] } };
    if (url === '/api/v1/gld/meetings') return { data: MEETINGS };
    return { data: {} };
  });
  const { BulkSubmitPanel } = await import('@/app/(main)/admin/decisions/bulk-submit');
  const v = render(<BulkSubmitPanel code="MRC" items={ITEMS as never} onClose={() => {}} />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-bulk-submit-list]')).toBeTruthy());
  return v;
}
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLInputElement;

describe('일괄 상정', () => {
  it('🔴 후보 = 주관·합동 · 위원회 층 · 건별·권한자 제외 · 미선택으로 시작(잠김)', async () => {
    const { container } = await mount();
    expect([...container.querySelectorAll('[data-bulk-submit-candidate]')].map((e) => e.getAttribute('data-bulk-submit-candidate'))).toEqual(['s1', 's2', 'done', 'open', 'unk', 'joint1']);
    expect([...container.querySelectorAll('[data-bulk-submit-check]')].every((e) => !(e as HTMLInputElement).checked)).toBe(true);
    expect([...container.querySelectorAll('[data-bulk-submit-mode]')].every((e) => !(e as HTMLInputElement).checked)).toBe(true);
    expect(q(container, '[data-bulk-submit-go]').disabled).toBe(true);
  });

  it('🔴 이미 실결정·안건 진행 중·확인 불가는 이유와 함께 고를 수 없다 · "모두 고르기"도 넣지 않는다', async () => {
    const { container } = await mount();
    for (const k of ['done', 'open', 'unk']) {
      expect(q(container, `[data-bulk-submit-check="${k}"]`).disabled, k).toBe(true);
      expect(container.querySelector(`[data-bulk-submit-blocked="${k}"]`), k).toBeTruthy();
    }
    expect(container.querySelector('[data-bulk-submit-blocked="open"]')!.textContent).toMatch(/진행 중.*의무기록위원회/);
    fireEvent.click(q(container, '[data-bulk-submit-all]'));
    expect([...container.querySelectorAll('[data-bulk-submit-check]')].filter((e) => (e as HTMLInputElement).checked).map((e) => e.getAttribute('data-bulk-submit-check'))).toEqual(['s1', 's2', 'joint1']);
  });

  it('예정 회의 — 고르기 전엔 잠김 · 봉인 회의는 목록에 없음 · 보낸 값 그대로 · 결과 항목마다', async () => {
    post.mockResolvedValue({ data: { committeeCode: 'MRC', meetingId: 'm1', total: 2, succeeded: 1, failed: 1, results: [{ key: 's1', ok: true, status: 'SCHEDULED' }, { key: 'joint1', ok: false, error: { code: 'DECISION_AGENDA_OPEN', message: '이미 올라가 있음' } }] } });
    const { container } = await mount();
    fireEvent.click(q(container, '[data-bulk-submit-check="s1"]'));
    fireEvent.click(q(container, '[data-bulk-submit-check="joint1"]'));
    expect(q(container, '[data-bulk-submit-go]').disabled).toBe(true); // 회의 방식 미선택
    fireEvent.click(q(container, '[data-bulk-submit-mode="EXISTING"]'));
    await waitFor(() => expect(container.querySelector('[data-bulk-submit-meeting-select]')).toBeTruthy());
    const opts = [...container.querySelectorAll('[data-bulk-submit-meeting-select] option')].map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(['', 'm1']);
    expect(q(container, '[data-bulk-submit-go]').disabled).toBe(true); // 회의 미선택
    fireEvent.change(container.querySelector('[data-bulk-submit-meeting-select]')!, { target: { value: 'm1' } });
    fireEvent.click(q(container, '[data-bulk-submit-go]'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toEqual(['/api/v1/admin/decisions/bulk-submit', { committeeCode: 'MRC', keys: ['s1', 'joint1'], meetingId: 'm1' }]);
    await waitFor(() => expect(container.querySelector('[data-bulk-submit-result]')).toBeTruthy());
    expect(container.querySelector('[data-bulk-submit-row="s1"]')!.getAttribute('data-bulk-submit-ok')).toBe('true');
    expect(container.querySelector('[data-bulk-submit-row="joint1"]')!.textContent).toMatch(/이미 올라가 있음/);
  });

  it('🔴 새 회의 — 일시 필수 · 참석자를 보내지 않는다 · 접수만은 회의 값 없이', async () => {
    post.mockResolvedValue({ data: { committeeCode: 'MRC', meetingId: 'm-new', total: 1, succeeded: 1, failed: 0, results: [{ key: 's1', ok: true, status: 'SCHEDULED' }] } });
    const { container } = await mount();
    fireEvent.click(q(container, '[data-bulk-submit-check="s1"]'));
    fireEvent.click(q(container, '[data-bulk-submit-mode="NEW"]'));
    expect(q(container, '[data-bulk-submit-go]').disabled).toBe(true);
    fireEvent.change(q(container, '[data-bulk-submit-at]'), { target: { value: '2026-11-05T09:00' } });
    fireEvent.click(q(container, '[data-bulk-submit-go]'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ committeeCode: 'MRC', keys: ['s1'] });
    expect(typeof body.scheduledAt).toBe('string');
    expect('attendeeUserIds' in body || 'attendees' in body || 'meetingId' in body).toBe(false);

    cleanup(); post.mockClear();
    const v2 = await mount();
    fireEvent.click(q(v2.container, '[data-bulk-submit-check="s1"]'));
    fireEvent.click(q(v2.container, '[data-bulk-submit-mode="NONE"]'));
    fireEvent.click(q(v2.container, '[data-bulk-submit-go]'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ committeeCode: 'MRC', keys: ['s1'] });
  });

  it('단건 상정 자리 — 열린 안건이면 진행 상태(단추 대신) · 끝난 안건이면 그리지 않는다', async () => {
    const { OpenAgendaNote } = await import('@/app/(main)/admin/decisions/bulk-submit');
    get.mockResolvedValue({ data: {} });
    const v = render(<OpenAgendaNote d={ITEMS[3] as never} />, { wrapper: wrap });
    expect(v.container.querySelector('[data-open-agenda="SCHEDULED"]')).toBeTruthy();
    cleanup();
    expect(render(<OpenAgendaNote d={ITEMS[1] as never} />, { wrapper: wrap }).container.innerHTML).toBe('');
  });
});
