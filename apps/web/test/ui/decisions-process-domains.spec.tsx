/**
 * 결정 화면 — 위원회 결정 과정·영역(2026-10-10 사용자 요청 "위원회의 의사결정과정에 대한 순서와 기본 설정, 의료, 운영, 행정 등의 카테고리가 더 구분").
 *  · 단계 띠 ①~⑦(위원회 층 수 · ⑦ 확인은 사람 확인 — 세지 않음) · 단계를 누르면 그 단계만
 *  · 영역 순서 = 기본 설정 → 의료 → 운영 → 행정 → 정보보호 · 영역 머리는 전체 분모 · 그 안에 축 섹션
 *  · 행 단계 배지(연결 안건 위원회·상태) · 🔴 안건 조회 실패는 '안건 확인 불가'(없음으로 그리지 않음)
 *  · 펼치면 과정 진행(지난 ✓·지금 ●·다음 할 일)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), postForm: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); try { window.localStorage.clear(); } catch { /* 저장소 없음 */ } });

const base = {
  why: '이유', legalReview: [], approvalPath: 'COMMITTEE', authority: '위원회', options: [{ value: 'A', label: '선택 A', effect: '효과' }],
  statusQuo: '현행', goLive: 'CAN_FOLLOW', owner: '팀', dueBy: 'NONE', currentConfigValue: null, pendingAttachments: [], unlocks: [],
  enactment: { state: 'UNDECIDED', label: '미결', detail: null, actions: [] }, decided: false, seeded: false, readyToDecide: true, blockedBy: [], record: null,
};
const it_ = (key: string, track: string, domain: string, stage: string, extra: Record<string, unknown> = {}) => ({
  ...base, key, title: `제목 ${key}`, track, layer: 'INTERNAL_COMMITTEE', domain, agenda: null, stage: { stage, flags: [] }, committee: { lead: 'QPS', joint: [] }, ...extra,
});

function payloadOf(items: unknown[], extraSummary: Record<string, unknown> = {}) {
  return {
    items,
    layers: { LICENSE_HOLDER: { label: 'L', scope: '', cannot: '' }, INTERNAL_COMMITTEE: { label: 'C', scope: '', cannot: '' }, STAFF: { label: 'S', scope: '', cannot: '' } },
    tracks: { QUALITY: '의료 질·지표', BILLING: '청구·수가', GOVERNANCE: '거버넌스·의결' },
    summary: {
      byLayer: [], byTrack: [{ track: 'GOVERNANCE', label: '거버넌스·의결', total: 1, decided: 0, readyToDecide: 1 }, { track: 'QUALITY', label: '의료 질·지표', total: 2, decided: 0, readyToDecide: 1 }, { track: 'BILLING', label: '청구·수가', total: 1, decided: 0, readyToDecide: 1 }],
      goLiveRequired: { total: 0, decided: 0 }, seeded: 0,
      byDomain: [
        { domain: 'FOUNDATION', label: '기본 설정', description: '기본 설명', total: 1, decided: 0, seeded: 0, readyToDecide: 1, blocked: 0 },
        { domain: 'MEDICAL', label: '의료', description: '의료 설명', total: 1, decided: 0, seeded: 0, readyToDecide: 1, blocked: 0 },
        { domain: 'OPERATIONS', label: '운영', description: '운영 설명', total: 0, decided: 0, seeded: 0, readyToDecide: 0, blocked: 0 },
        { domain: 'ADMIN', label: '행정', description: '행정 설명', total: 2, decided: 0, seeded: 0, readyToDecide: 1, blocked: 0 },
        { domain: 'SECURITY', label: '정보보호·보안', description: '보안 설명', total: 0, decided: 0, seeded: 0, readyToDecide: 0, blocked: 0 },
      ],
      byStage: [
        { stage: 'PREPARE', count: 2 }, { stage: 'SUBMITTED', count: 1 }, { stage: 'DELIBERATION', count: 1 }, { stage: 'RESOLVED', count: 0 },
        { stage: 'RECORDED', count: 0 }, { stage: 'ENACTED', count: 0 }, { stage: 'VERIFIED', count: null },
      ],
      agendaUnknown: false,
      ...extraSummary,
    },
    measuredAt: '2026-10-10T00:00:00Z', caveat: '',
  };
}
const ITEMS = [
  it_('g.1', 'GOVERNANCE', 'FOUNDATION', 'PREPARE'),
  it_('q.med', 'QUALITY', 'MEDICAL', 'SUBMITTED', { agenda: { id: 'a1', status: 'SUBMITTED', meetingId: null, committee: { code: 'QPS', name: 'QI 위원회' }, updatedAt: '2026-10-10' } }),
  it_('q.admin', 'QUALITY', 'ADMIN', 'DELIBERATION'), // 같은 축이 행정으로 옮겨진 결정(예외 키)
  it_('b.1', 'BILLING', 'ADMIN', 'PREPARE'),
];

async function mount(p = payloadOf(ITEMS)) {
  get.mockResolvedValue({ data: p });
  const { default: Page } = await import('@/app/(main)/admin/decisions/page');
  const v = render(<Page />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-decision-domain]')).toBeTruthy());
  return v;
}
/** 탭 구조(2026-10-11) — 단계 띠는 위원회별 탭의 도구 · 카테고리는 영역 탭(기본 = 첫 영역) */
const toCommittee = (c: HTMLElement) => fireEvent.click(c.querySelector('[data-decision-view="COMMITTEE"]')!);
const toAllDomains = (c: HTMLElement) => fireEvent.click(c.querySelector('[data-domain-tab="ALL"]')!);
const rows = (el: ParentNode) => [...el.querySelectorAll('[data-decision-row]')].map((r) => r.getAttribute('data-decision-row'));

describe('위원회 결정 과정 띠', () => {
  it('①~⑦ 순서 · 단계별 수 · ⑦ 은 세지 않는다 · 🔴 띠는 위원회별 탭에만(카테고리 탭엔 없다)', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-stage-strip]')).toBeNull();
    toCommittee(container);
    const chips = [...container.querySelectorAll('[data-stage-chip]')].map((c) => c.getAttribute('data-stage-chip'));
    expect(chips).toEqual(['PREPARE', 'SUBMITTED', 'DELIBERATION', 'RESOLVED', 'RECORDED', 'ENACTED', 'VERIFIED']);
    expect(container.querySelector('[data-stage-count="PREPARE"]')!.textContent).toContain('2');
    expect(container.querySelector('[data-stage-count="VERIFIED"]')!.textContent).toContain('사람 확인');
    expect((container.querySelector('[data-stage-chip="VERIFIED"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('단계를 누르면 그 단계 결정만(전체 탭에서 위원회 아래) · 다시 누르면 해제 · 🔴 다른 보기로 가면 단계 거르기가 풀린다', async () => {
    const { container } = await mount();
    toCommittee(container);
    fireEvent.click(container.querySelector('[data-stage-chip="SUBMITTED"]')!);
    expect(container.querySelector('[data-committee-tab="ALL"]')!.getAttribute('aria-selected')).toBe('true');
    expect(rows(container)).toEqual(['q.med']);
    fireEvent.click(container.querySelector('[data-decision-view="CATEGORY"]')!);
    toAllDomains(container);
    expect(rows(container).sort()).toEqual(['b.1', 'g.1', 'q.admin', 'q.med']); // 보이지 않는 거르기가 남지 않는다
    toCommittee(container);
    expect(container.querySelector('[data-stage-chip="SUBMITTED"]')!.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(container.querySelector('[data-stage-chip="SUBMITTED"]')!);
    fireEvent.click(container.querySelector('[data-stage-chip="SUBMITTED"]')!); // 다시 누르면 해제
    expect(container.querySelector('[data-stage-chip="SUBMITTED"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(rows(container)).toEqual([]); // 전체 탭은 거르지 않으면 위원회 요약만(행을 늘어놓지 않는다)
  });
  it('🔴 안건 조회 실패 — 띠에 고지 · 행에 안건 확인 불가', async () => {
    const failed = ITEMS.map((i) => ({ ...i, agenda: 'UNKNOWN', stage: { stage: 'PREPARE', flags: ['AGENDA_UNKNOWN'] } }));
    const { container } = await mount(payloadOf(failed, { agendaUnknown: true }));
    toAllDomains(container);
    expect(container.querySelectorAll('[data-row-agenda-unknown]').length).toBe(4);
    toCommittee(container);
    expect(container.querySelector('[data-stage-agenda-unknown]')).toBeTruthy();
  });
  it('대조군 — 안건 정상이면 고지 없음 · 연결 안건은 위원회·상태로', async () => {
    const { container } = await mount();
    toAllDomains(container);
    toCommittee(container);
    expect(container.querySelector('[data-stage-agenda-unknown]')).toBeNull();
    fireEvent.click(container.querySelector('[data-decision-view="CATEGORY"]')!);
    const med = container.querySelector('[data-decision-row="q.med"] [data-row-stage]')!;
    expect(med.getAttribute('data-row-stage')).toBe('SUBMITTED');
    expect(med.textContent).toContain('②');
    expect(med.textContent).toContain('QI 위원회');
  });
});

describe('영역', () => {
  it('🔴 영역 탭 순서 = 기본 설정 → 의료 → 행정(빈 영역은 탭 없음) → 전체 · 기본은 첫 영역만 · 기본 설정부터 안내', async () => {
    const { container } = await mount();
    expect([...container.querySelectorAll('[data-domain-tab]')].map((d) => d.getAttribute('data-domain-tab'))).toEqual(['FOUNDATION', 'MEDICAL', 'ADMIN', 'ALL']);
    expect([...container.querySelectorAll('[data-decision-domain]')].map((d) => d.getAttribute('data-decision-domain'))).toEqual(['FOUNDATION']);
    expect(container.querySelector('[data-domain-order-guide]')).toBeTruthy();
    toAllDomains(container);
    expect([...container.querySelectorAll('[data-decision-domain]')].map((d) => d.getAttribute('data-decision-domain'))).toEqual(['FOUNDATION', 'MEDICAL', 'ADMIN']);
  });
  it('🔴 탭 수는 전체 분모 · 거르면 "표시/전체" · 거른 결과가 없는 탭은 흐리게', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-domain-tab="ADMIN"]')!.textContent).toContain('2');
    fireEvent.change(container.querySelector('[data-decision-search]')!, { target: { value: 'b.1' } });
    expect(container.querySelector('[data-domain-tab="ADMIN"]')!.textContent).toContain('1/2');
    expect(container.querySelector('[data-domain-tab="MEDICAL"]')!.className).toContain('text-gray-400');
  });
  it('고른 탭은 기억한다(다시 열어도 그 탭)', async () => {
    const first = await mount();
    fireEvent.click(first.container.querySelector('[data-domain-tab="ADMIN"]')!);
    expect(JSON.parse(window.localStorage.getItem('admin.decisions.tabs')!)).toEqual({ CATEGORY: 'ADMIN' });
    cleanup();
    const again = await mount();
    expect([...again.container.querySelectorAll('[data-decision-domain]')].map((d) => d.getAttribute('data-decision-domain'))).toEqual(['ADMIN']);
  });
  it('같은 축이라도 영역이 다르면 그 영역 안에 — 행정 영역에 품질 축 결정(예외 키)', async () => {
    const { container } = await mount();
    toAllDomains(container);
    const admin = container.querySelector('[data-decision-domain="ADMIN"]')!;
    expect(rows(admin).sort()).toEqual(['b.1', 'q.admin']);
    expect(rows(container.querySelector('[data-decision-domain="MEDICAL"]')!)).toEqual(['q.med']);
  });
  it('펼치면 과정 진행 — 지난 단계 ✓ · 지금 ● · 다음 할 일', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-domain-tab="ADMIN"]')!);
    const row = container.querySelector('[data-decision-row="q.admin"]')!;
    fireEvent.click(row.querySelector('button[aria-expanded]')!);
    const blk = container.querySelector('[data-process-block="q.admin"]')!;
    expect(blk.querySelector('[data-process-step="PREPARE"]')!.getAttribute('data-process-mark')).toBe('✓');
    expect(blk.querySelector('[data-process-step="DELIBERATION"]')!.getAttribute('data-process-mark')).toBe('●');
    expect(blk.querySelector('[data-process-step="RESOLVED"]')!.getAttribute('data-process-mark')).toBe('○');
    expect(blk.querySelector('[data-process-next]')).toBeTruthy();
  });
});
