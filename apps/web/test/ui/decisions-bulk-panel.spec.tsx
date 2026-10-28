/**
 * 위원회 중요결정 일괄 의사결정 화면(2026-10-11 사용자 "관련된 위원회 중요결정사항에 대해서 일괄 변경").
 *  · 후보 = 이 위원회가 정할 수 있는 결정(주관·합동 · 위원회 층 · 건별 판단 제외)
 *  · 🔴 미선택으로 시작 — 선택지·회의 일시·참석자를 채워 두지 않는다 · 시드 선택 채우기는 사람이 누르는 단추(빈 칸만)
 *  · 위원회 경로 항목이 있으면 회의 일시 + 정족수 이상 참석자 · 권한자 항목이 있으면 권한 근거
 *  · 보낸 값 = 사람이 고른 그대로 · 결과는 항목마다(실패를 성공으로 말하지 않는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const d = (key: string, extra: Record<string, unknown>) => ({
  key, title: `제목 ${key}`, layer: 'INTERNAL_COMMITTEE', approvalPath: 'COMMITTEE', mechanism: 'COMMITTEE_RECORD',
  options: [{ value: 'A', label: '가안', effect: '' }, { value: 'B', label: '나안', effect: '' }], record: null, seeded: false,
  committee: { lead: 'MRC', joint: [] }, ...extra,
});
const ITEMS = [
  d('c1', { record: { choice: 'B' }, seeded: true }),
  d('c2', { record: { choice: 'B' }, seeded: true }), // 🔴 기록이 있어야 "채우기가 사람이 고른 값을 덮지 않는다"를 겨눈다(재주입으로 적발)
  d('role1', { approvalPath: 'AUTHORIZED_ROLE', mechanism: 'AUTO_APPLY' }),
  d('joint1', { committee: { lead: 'QPS', joint: ['MRC'] } }),
  d('other', { committee: { lead: 'QPS', joint: [] } }),
  d('lic', { layer: 'LICENSE_HOLDER', committee: null }),
  d('ev', { mechanism: 'PER_EVENT' }),
];
const ROSTER = [{ userId: 'u1', role: 'CHAIR', source: 'SEED', user: { familyName: '김', givenName: '위원장' } }, { userId: 'u2', role: 'MEMBER', user: { familyName: '이', givenName: '위원' } }];

async function mount(roster = ROSTER, quorum = 2) {
  get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/governance/summary') return { data: { committees: [{ id: 'c-mrc', code: 'MRC', quorum }] } };
    if (url === '/api/v1/gld/committees/c-mrc') return { data: { quorum, members: roster } };
    return { data: {} };
  });
  const { BulkDecisionPanel } = await import('@/app/(main)/admin/decisions/bulk-decision');
  const v = render(<BulkDecisionPanel code="MRC" items={ITEMS as never} onClose={() => {}} />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-bulk-list]')).toBeTruthy());
  return v;
}
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLInputElement;

describe('일괄 의사결정', () => {
  it('🔴 후보 = 이 위원회 주관·합동 · 위원회 층 · 건별 제외 · 미선택으로 시작(보내기 잠김)', async () => {
    const { container } = await mount();
    expect([...container.querySelectorAll('[data-bulk-candidate]')].map((e) => e.getAttribute('data-bulk-candidate'))).toEqual(['c1', 'c2', 'role1', 'joint1']);
    expect([...container.querySelectorAll('[data-bulk-check]')].every((e) => !(e as HTMLInputElement).checked)).toBe(true);
    expect(q(container, '[data-bulk-submit]').disabled).toBe(true);
  });
  it('🔴 고르면 선택지는 비어서 시작 · "지금 기록된 선택으로 채우기"는 빈 칸만(사람이 누를 때만)', async () => {
    const { container } = await mount();
    fireEvent.click(q(container, '[data-bulk-check="c1"]'));
    fireEvent.click(q(container, '[data-bulk-check="c2"]'));
    expect(q(container, '[data-bulk-choice="c1"]').value).toBe('');
    fireEvent.change(q(container, '[data-bulk-choice="c2"]'), { target: { value: 'A' } });
    fireEvent.click(q(container, '[data-bulk-fill]'));
    expect(q(container, '[data-bulk-choice="c1"]').value).toBe('B'); // 시드 선택으로 채움
    expect(q(container, '[data-bulk-choice="c2"]').value).toBe('A'); // 고른 것은 그대로
  });
  it('🔴 위원회 항목 — 회의 일시·정족수 이상 참석자 전엔 잠김 · 보낸 값은 사람이 고른 그대로 · 즉시 반영은 기본 꺼짐', async () => {
    post.mockResolvedValue({ data: { committeeCode: 'MRC', meetingId: 'm1', total: 1, succeeded: 1, failed: 0, results: [{ key: 'c2', choice: 'A', ok: true, path: 'COMMITTEE', decisionNo: 'GOV-2026-009', registryWritten: true }] } });
    const { container } = await mount();
    fireEvent.click(q(container, '[data-bulk-check="c2"]'));
    fireEvent.change(q(container, '[data-bulk-choice="c2"]'), { target: { value: 'A' } });
    fireEvent.change(q(container, '[data-bulk-basis]'), { target: { value: 'MRC 2026-3차' } });
    expect(q(container, '[data-bulk-submit]').disabled).toBe(true);
    expect(container.querySelector('[data-bulk-missing]')!.textContent).toContain('참석자');
    fireEvent.change(q(container, '[data-bulk-heldat]'), { target: { value: '2026-10-10T14:00' } });
    await waitFor(() => expect(container.querySelector('[data-bulk-attendee="u1"]')).toBeTruthy());
    fireEvent.click(q(container, '[data-bulk-attendee="u1"]'));
    expect(q(container, '[data-bulk-submit]').disabled).toBe(true); // 1 < 정족수 2
    fireEvent.click(q(container, '[data-bulk-attendee="u2"]'));
    expect(q(container, '[data-bulk-submit]').disabled).toBe(false);
    fireEvent.click(q(container, '[data-bulk-submit]'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, any>];
    expect(url).toBe('/api/v1/admin/decisions/bulk');
    expect(body).toMatchObject({ committeeCode: 'MRC', items: [{ key: 'c2', choice: 'A' }], basisRef: 'MRC 2026-3차', enactNow: false, meeting: { attendeeUserIds: ['u1', 'u2'] } });
    expect(body.meeting.heldAt).toBe(new Date('2026-10-10T14:00').toISOString());
    await waitFor(() => expect(container.querySelector('[data-bulk-row="c2"]')!.textContent).toContain('GOV-2026-009'));
  });
  it('권한자 항목만이면 회의를 묻지 않고 권한 근거를 묻는다', async () => {
    const { container } = await mount();
    fireEvent.click(q(container, '[data-bulk-check="role1"]'));
    fireEvent.change(q(container, '[data-bulk-choice="role1"]'), { target: { value: 'B' } });
    fireEvent.change(q(container, '[data-bulk-basis]'), { target: { value: '간호부 결재 12' } });
    expect(container.querySelector('[data-bulk-meeting]')).toBeNull();
    expect(q(container, '[data-bulk-submit]').disabled).toBe(true);
    fireEvent.change(q(container, '[data-bulk-authority]'), { target: { value: '간호부장' } });
    expect(q(container, '[data-bulk-submit]').disabled).toBe(false);
  });
  it('🔴 결과는 항목마다 — 실패는 실패로(사유) · 요약에 실패 수', async () => {
    post.mockResolvedValue({ data: { committeeCode: 'MRC', meetingId: null, total: 2, succeeded: 1, failed: 1, results: [
      { key: 'role1', choice: 'B', ok: true, path: 'ROLE' }, { key: 'c2', choice: 'A', ok: false, path: 'COMMITTEE', error: { code: 'QUORUM_ROSTER_NOT_MET', message: '명부 위원이 정족수에 못 미칩니다' } },
    ] } });
    const { container } = await mount();
    fireEvent.click(q(container, '[data-bulk-check="role1"]'));
    fireEvent.change(q(container, '[data-bulk-choice="role1"]'), { target: { value: 'B' } });
    fireEvent.change(q(container, '[data-bulk-basis]'), { target: { value: '근거 문서 1' } });
    fireEvent.change(q(container, '[data-bulk-authority]'), { target: { value: '간호부장' } });
    fireEvent.click(q(container, '[data-bulk-submit]'));
    await waitFor(() => expect(container.querySelector('[data-bulk-result]')).toBeTruthy());
    expect(container.querySelector('[data-bulk-row="c2"]')!.getAttribute('data-bulk-ok')).toBe('false');
    expect(container.querySelector('[data-bulk-row="c2"]')!.textContent).toContain('명부 위원이');
    expect(container.querySelector('[data-bulk-summary]')!.textContent).toContain('1');
  });
  it('🔴 명부가 비면 의결할 수 없다고 말한다', async () => {
    const { container } = await mount([], 2);
    fireEvent.click(q(container, '[data-bulk-check="c2"]'));
    await waitFor(() => expect(container.querySelector('[data-bulk-roster-empty]')).toBeTruthy());
  });
});
