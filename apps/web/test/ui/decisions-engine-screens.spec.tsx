/**
 * 결정 엔진 화면(2026-10-11 사용자 "엔진 형태로 세팅 후에 변경 · 전후 관계 영향 · 보호·설정 영향 · 이미 결정된 과정도 로그 · 문서로 정리").
 *  · 행 배지: 재검토 필요(선행이 바뀜) · 설정이 결정과 다름 — 대조군: 둘 다 없으면 배지 없음
 *  · 펼침: 재검토 근거 없으면 확인 불가 · 확인 → review-confirm · 🔴 이력 조회 실패는 "필요 없음"이 아니라 확인 불가
 *  · 기록 창: 고르면 영향 미리보기(설정 현재→바뀔 값·후행 재검토)
 *  · 결정 이력 탭: 종류 배지·선행 변경·설정 직접 변경·더 보기(커서)·종류 거르기
 *  · 결정 대장: 실결정 없음을 말한다 · 시드는 따로 · 실결정은 경과와 함께 · 이력 실패 고지
 */
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), postForm: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/components/print/PrintGuard', () => ({ sanctionedPrint: vi.fn() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); try { window.localStorage.clear(); } catch { /* 저장소 없음 */ } });

const base = {
  mechanism: 'CONFIRM_ONLY', settings: [],
  why: '이유', legalReview: [], approvalPath: 'AUTHORIZED_ROLE', authority: '원장', statusQuo: '현행', goLive: 'CAN_FOLLOW', owner: '팀', dueBy: 'NONE',
  currentConfigValue: null, pendingAttachments: [], unlocks: [], blockedBy: [], readyToDecide: false, track: 'NOTIFY', domain: 'OPERATIONS',
  agenda: null, stage: { stage: 'RECORDED', flags: [] }, committee: null, logCount: 2,
  enactment: { state: 'ENACTED', label: '결정·반영됨', detail: null, actions: [] },
};
const rec = (choice: string, at = '2026-10-01T00:00:00.000Z') => ({ choice, legalReviewRef: '운영위 3호', authorityClaim: '진료부장', decidedByUserId: 'u', decidedAt: at, applied: true });
const ITEMS = [
  { ...base, key: 'up', title: '선행 결정', layer: 'LICENSE_HOLDER', options: [{ value: 'NOT_REVIEWED', label: '미확인', effect: 'e' }, { value: 'CLEARED', label: '확인함', effect: 'e' }],
    decided: true, seeded: false, record: rec('CLEARED', '2026-10-05T00:00:00.000Z'), needsReview: [], governedConfig: [] },
  { ...base, key: 'down', title: '후행 결정', layer: 'INTERNAL_COMMITTEE', options: [{ value: 'OFF', label: '끔', effect: 'e' }, { value: 'ON', label: '켬', effect: 'e' }],
    decided: true, seeded: false, record: rec('ON'), needsReview: ['up'], governedConfig: [{ key: 'notification.patientPush.enabled', decided: true, current: false, matches: false }],
    mechanism: 'AUTO_APPLY',
    settings: [{ key: 'notification.patientPush.enabled', role: 'SETS', description: '환자 앱 알림 마스터', category: 'general', registered: true, current: false, source: 'db', defaultValue: false,
      allowed: [true, false], options: [{ value: 'OFF', label: '끔', sets: true, setValue: false }, { value: 'ON', label: '켬', sets: true, setValue: true }],
      decidedValue: true, decidedSets: true, matchesDecision: false, currentOption: 'OFF', updatedAt: '2026-10-11T03:00:00Z', updatedByName: '관리자' }] },
  { ...base, key: 'calm', title: '조용한 **강조** 결정', layer: 'INTERNAL_COMMITTEE', options: [{ value: 'A', label: '가', effect: 'e' }],
    decided: true, seeded: false, record: rec('A'), needsReview: [], governedConfig: [{ key: 'x.y', decided: 1, current: 1, matches: true }],
    mechanism: 'COMMITTEE_APPLY',
    settings: [{ key: 'x.y', role: 'SETS', description: null, category: null, registered: true, current: 1, source: 'default', defaultValue: 1, allowed: { int: [1, 9] },
      options: [{ value: 'A', label: '가', sets: true, setValue: 1 }], decidedValue: 1, decidedSets: true, matchesDecision: true, currentOption: 'A', updatedAt: null, updatedByName: null }] },
  { ...base, key: 'unk', title: '확인 불가 결정', layer: 'INTERNAL_COMMITTEE', options: [{ value: 'A', label: '가', effect: 'e' }],
    decided: true, seeded: false, record: rec('A'), needsReview: null, governedConfig: [], logCount: null, mechanism: 'COMMITTEE_RECORD', settings: null },
  { ...base, key: 'sd', title: '시드 결정', layer: 'INTERNAL_COMMITTEE', options: [{ value: 'A', label: '가', effect: 'e' }],
    decided: false, seeded: true, record: { ...rec('A'), legalReviewRef: '개발 시드(DEV-SEED)' }, needsReview: [], governedConfig: [], stage: { stage: 'PREPARE', flags: ['SEEDED'] } },
];
const payload = (items: unknown[] = ITEMS) => ({
  items, layers: { LICENSE_HOLDER: { label: 'L', scope: '', cannot: '' }, INTERNAL_COMMITTEE: { label: 'C', scope: '', cannot: '' }, STAFF: { label: 'S', scope: '', cannot: '' } },
  tracks: { NOTIFY: '알림·대외 발신' },
  summary: { byLayer: [], byTrack: [], goLiveRequired: { total: 0, decided: 0 }, seeded: 1, byDomain: [], byStage: [], agendaUnknown: false, byCommittee: [],
    byMechanism: [{ mechanism: 'AUTO_APPLY', total: 1, decided: 1, seeded: 0 }, { mechanism: 'COMMITTEE_APPLY', total: 1, decided: 1, seeded: 0 }, { mechanism: 'COMMITTEE_RECORD', total: 1, decided: 1, seeded: 0 }, { mechanism: 'CONFIRM_ONLY', total: 2, decided: 1, seeded: 1 }],
    engine: { protectionMode: 'WARN', reviewNeeded: 1, configDrift: 1, logTotal: 7 } },
  measuredAt: '2026-10-11T00:00:00Z', caveat: '고지',
});
const LOG = [
  { id: 'l3', decisionKey: 'down', kind: 'CONFIG_OVERRIDE', choice: null, prevChoice: null, basisRef: null, authorityClaim: null, actorUserId: 'u', sourceKey: 'notification.patientPush.enabled', committeeDecisionId: null, detail: { prev: true, value: false, decidedValue: true, matchesDecision: false }, occurredAt: '2026-10-11T03:00:00Z', title: '후행 결정' },
  { id: 'l2', decisionKey: 'down', kind: 'UPSTREAM_CHANGED', choice: 'ON', prevChoice: null, basisRef: null, authorityClaim: null, actorUserId: null, sourceKey: 'up', committeeDecisionId: null, detail: { upstreamPrev: 'NOT_REVIEWED', upstreamNext: 'CLEARED', upstreamNegative: false }, occurredAt: '2026-10-05T00:00:00Z', title: '후행 결정' },
  { id: 'l1', decisionKey: 'down', kind: 'RECORDED', choice: 'ON', prevChoice: 'OFF', basisRef: '운영위 3호', authorityClaim: '진료부장', actorUserId: 'u', sourceKey: null, committeeDecisionId: null, detail: {}, occurredAt: '2026-10-01T00:00:00Z', title: '후행 결정' },
];

function routes(opts: { logFail?: boolean; nextCursor?: string | null } = {}) {
  get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/decisions') return { data: payload() };
    if (url.startsWith('/api/v1/admin/decisions/log')) {
      if (opts.logFail) throw new Error('down');
      if (url.includes('cursor=')) return { data: { items: [{ ...LOG[2], id: 'l0', occurredAt: '2026-09-30T00:00:00Z' }], total: 4, nextCursor: null } };
      const kind = /kind=(\w+)/.exec(url)?.[1];
      const items = kind ? LOG.filter((l) => l.kind === kind) : LOG;
      return { data: { items, total: kind ? items.length : 4, nextCursor: kind ? null : (opts.nextCursor === undefined ? 'c1' : opts.nextCursor) } };
    }
    if (/\/admin\/decisions\/[^/]+\/impact/.test(url)) return { data: { configChanges: [{ key: 'notification.patientPush.enabled', current: false, next: true, changes: true }], appliesNow: true, approvalPath: 'AUTHORIZED_ROLE', protectedKeys: ['notification.patientPush.enabled'], protectionMode: 'WARN', downstream: [{ key: 'down', title: '후행 결정', decided: true, choice: 'ON', effect: 'REVIEW', loseBasis: true }], upstream: [] } };
    if (/\/admin\/decisions\/[^/]+\/log$/.test(url)) return { data: [...LOG].reverse() };
    return { data: { data: [] } };
  });
}
async function mountPage() {
  routes();
  const { default: Page } = await import('@/app/(main)/admin/decisions/page');
  const v = render(<Page />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-decision-view="LAYER"]')).toBeTruthy());
  fireEvent.click(v.container.querySelector('[data-decision-view="LAYER"]')!);
  fireEvent.click(v.container.querySelector('[data-layer-tab="ALL"]')!);
  return v;
}
const row = (c: HTMLElement, k: string) => c.querySelector(`[data-decision-row="${k}"]`)!;
const expand = (c: HTMLElement, k: string) => fireEvent.click(row(c, k).querySelector('button[aria-expanded]')!);

describe('결정 목록 — 엔진 신호', () => {
  it('🔴 행 배지 — 재검토 필요·설정이 결정과 다름 · 대조군: 없으면 배지 없음 · 요약 띠', async () => {
    const { container } = await mountPage();
    expect(row(container, 'down').querySelector('[data-row-review]')).toBeTruthy();
    expect(row(container, 'down').querySelector('[data-row-drift]')).toBeTruthy();
    expect(row(container, 'calm').querySelector('[data-row-review]')).toBeNull();
    expect(row(container, 'calm').querySelector('[data-row-drift]')).toBeNull();
    expect(container.querySelector('[data-engine-review]')!.textContent).toBe('1');
    expect(container.querySelector('[data-engine-summary]')!.textContent).toContain('WARN');
  });
  it('🔴 재검토 — 선행 결정과 지금 선택 · 근거 없으면 버튼 잠김 · 확인 → review-confirm(선택은 그대로)', async () => {
    post.mockResolvedValue({ data: {} });
    const { container } = await mountPage();
    expand(container, 'down');
    const panel = container.querySelector('[data-review-panel="down"]')!;
    expect(panel.textContent).toContain('선행 결정');
    expect(panel.textContent).toContain('확인함');
    const btn = container.querySelector('[data-review-confirm="down"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-review-note="down"]')!, { target: { value: '동의 범위 동일 확인' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/admin/decisions/down/review-confirm', { note: '동의 범위 동일 확인' }));
  });
  it('🔴 이력 조회 실패면 "재검토 필요 여부 확인 불가"(필요 없음으로 접지 않는다) · 결정이 정한 설정 일치/다름', async () => {
    const { container } = await mountPage();
    expand(container, 'unk');
    expect(container.querySelector('[data-engine-block="unk"] [data-review-unknown]')).toBeTruthy();
    expect(container.querySelector('[data-engine-block="unk"] [data-settings-unknown]')).toBeTruthy(); // 🔴 설정 조회 실패 ≠ 바꾸는 설정 없음
    expand(container, 'down');
    expect(container.querySelector('[data-setting="notification.patientPush.enabled"] [data-setting-decided]')!.getAttribute('data-setting-decided')).toBe('false');
    expand(container, 'calm');
    expect(container.querySelector('[data-setting="x.y"] [data-setting-decided]')!.getAttribute('data-setting-decided')).toBe('true');
    expect(container.querySelector('[data-engine-block="calm"] [data-review-unknown]')).toBeNull();
  });
  it('🔴 기록 창 — 고르면 영향 미리보기(설정 현재→바뀔 값 · 후행 근거 상실) · 고르기 전엔 부르지 않는다', async () => {
    const { container } = await mountPage();
    fireEvent.click(container.querySelector('[data-decision-record-btn="up"]')!);
    const radios = [...document.querySelectorAll('input[name="decision-choice"]')] as HTMLInputElement[];
    // 기존 기록(CLEARED)이 골라진 채 열린다 — 바꿔 고르면 영향이 다시 계산된다
    fireEvent.click(radios[0]);
    await waitFor(() => expect(document.querySelector('[data-impact]')).toBeTruthy());
    expect(get.mock.calls.some((c) => String(c[0]).includes('/admin/decisions/up/impact?choice=NOT_REVIEWED'))).toBe(true);
    expect(document.querySelector('[data-impact-config="notification.patientPush.enabled"]')!.textContent).toContain('true');
    expect(document.querySelector('[data-impact-downstream="down"]')!.getAttribute('data-impact-effect')).toBe('REVIEW');
    expect(document.querySelector('[data-impact-downstream="down"]')!.textContent).toContain('근거를 잃는다');
  });
});

describe('행 표현(2026-10-11 사용자 "표현이 좀 더 세련되고 깔끔하게")', () => {
  it('🔴 제목의 **강조**는 굵게 그린다(별표가 보이지 않는다) · 메타 한 줄 = 층·결정 방식·주관 위원회·단계 · 상태는 하나', async () => {
    const { container } = await mountPage();
    const r = row(container, 'calm');
    expect(r.textContent).not.toContain('**');
    expect(r.querySelector('b')!.textContent).toBe('강조');
    const meta = row(container, 'down').querySelector('[data-row-meta]')!;
    expect(meta.querySelector('[data-decision-layer]')).toBeTruthy();
    expect(meta.querySelector('[data-row-mechanism="AUTO_APPLY"]')!.textContent).toContain('⚙');
    expect(meta.querySelector('[data-row-stage]')).toBeTruthy();
    expect(row(container, 'down').querySelectorAll('[data-decision-badge]').length).toBe(1);
  });
});

describe('결정 방식·설정 상세', () => {
  it('🔴 행 배지 = 결정 방식(자동 반영은 ⚙) · 방식 칩/선택으로 거르기(전체 분모)', async () => {
    const { container } = await mountPage();
    expect(row(container, 'down').querySelector('[data-row-mechanism="AUTO_APPLY"]')!.textContent).toContain('⚙');
    expect(row(container, 'unk').querySelector('[data-row-mechanism="COMMITTEE_RECORD"]')!.textContent).not.toContain('⚙');
    fireEvent.click(container.querySelector('[data-mechanism-chip="COMMITTEE_APPLY"]')!);
    expect([...container.querySelectorAll('[data-decision-row]')].map((r) => r.getAttribute('data-decision-row'))).toEqual(['calm']);
    expect(container.querySelector('[data-decision-shown]')!.textContent).toContain('/ 5');
    fireEvent.change(container.querySelector('[data-decision-mechanism]')!, { target: { value: 'ALL' } });
    expect(container.querySelectorAll('[data-decision-row]').length).toBe(5);
  });
  it('🔴 펼치면 결정 방식 설명(누가·정하면) + 설정 상세 — 설명·현재 값(출처)·기본값·허용 값·선택지별 값·지금 값 ●·기록된 선택 ✓·마지막 변경', async () => {
    const { container } = await mountPage();
    expand(container, 'down');
    expect(container.querySelector('[data-mechanism-explain="AUTO_APPLY"]')!.textContent).toContain('결정 엔진이 바로 바꾼다');
    const st = container.querySelector('[data-setting="notification.patientPush.enabled"]')!;
    expect(st.getAttribute('data-setting-role')).toBe('SETS');
    expect(st.textContent).toContain('환자 앱 알림 마스터');
    expect(st.querySelector('[data-setting-current]')!.textContent).toContain('저장된 값');
    expect(st.querySelector('[data-setting-allowed]')!.textContent).toBe('true · false');
    expect(st.querySelector('[data-setting-option="OFF"] [data-setting-now]')).toBeTruthy();
    expect(st.querySelector('[data-setting-option="ON"] [data-setting-recorded]')).toBeTruthy();
    expect(st.querySelector('[data-setting-option="ON"] [data-setting-now]')).toBeNull();
    expect(st.textContent).toContain('관리자');
    expand(container, 'calm');
    expect(container.querySelector('[data-setting="x.y"] [data-setting-allowed]')!.textContent).toContain('1~9');
    expect(container.querySelector('[data-setting="x.y"]')!.textContent).toContain('저장된 적 없음');
  });
  it('대조군 — 바꾸는 설정이 없으면 없다고 말한다(조회 실패 문구가 아니다)', async () => {
    const { container } = await mountPage();
    expand(container, 'up');
    expect(container.querySelector('[data-engine-block="up"] [data-settings-none]')).toBeTruthy();
    expect(container.querySelector('[data-engine-block="up"] [data-settings-unknown]')).toBeNull();
  });
});

describe('의사결정 작업대 — 설명자료·과정·선택지·입력이 한눈에(2026-10-11)', () => {
  const openFor = async (k: string) => {
    const v = await mountPage();
    fireEvent.click(v.container.querySelector(`[data-decision-record-btn="${k}"]`)!);
    return { v, dlg: document.querySelector('[data-decide-dialog]')! };
  };
  it('🔴 머리(제목·층·방식·지금 상태) · 과정 띠(지금 단계) · 3열(핵심 설명 · 선택지 비교 · 의사결정 입력) · 문서 링크', async () => {
    const { dlg } = await openFor('down');
    expect(dlg.querySelector('[data-decide-header]')!.textContent).toContain('후행 결정');
    expect(dlg.querySelector('[data-decide-badges] [data-row-mechanism="AUTO_APPLY"]')).toBeTruthy();
    expect(dlg.querySelector('[data-decide-state]')!.getAttribute('data-decide-state')).toBe('DECIDED');
    expect(dlg.querySelector('[data-decide-step-state="NOW"]')!.getAttribute('data-decide-step')).toBe('RECORDED');
    const summary = dlg.querySelector('[data-decide-briefing]')!;
    expect(summary.querySelector('[data-decide-card="status"]')!.textContent).toContain('현행');
    // 2026-10-11 사용자 "지금 무슨 일이 일어나고 있는가 → 현재 상황/의사결정 이전"
    expect(summary.querySelector('[data-decide-card="status"]')!.textContent).toContain('현재 상황(의사결정 이전)');
    expect(dlg.textContent).not.toContain('지금 무슨 일이 일어나고 있는가');
    expect(summary.querySelector('[data-decide-card="why"]')!.textContent).toContain('이유');
    expect(dlg.querySelectorAll('[data-decide-options] input[name="decision-choice"]').length).toBe(2);
    expect(dlg.querySelector('[data-decide-form]')).toBeTruthy();
    expect(dlg.querySelector('[data-decide-briefing-link]')!.getAttribute('href')).toBe('/admin/decisions/down');
  });
  it('🔴 선택지 카드 = 고르는 곳 · 각 선택이 정하는 설정 값 · 지금 값 ● · 현재 결정 표시 · 고르면 입력 칸에 반영', async () => {
    const { dlg } = await openFor('down');
    const off = dlg.querySelector('[data-decide-option="OFF"]')!;
    expect(off.querySelector('[data-decide-option-sets="notification.patientPush.enabled"]')!.textContent).toContain('false');
    expect(off.textContent).toContain('지금 값');
    expect(dlg.querySelector('[data-decide-option="ON"] [data-decide-option-recorded]')!.textContent).toContain('현재 결정');
    fireEvent.click(off.querySelector('input')!);
    expect(dlg.querySelector('[data-decide-chosen]')!.textContent).toContain('끔');
  });
  it('🔴 늘 보이는 바닥 단추 — 빠진 입력을 차례로 말하고 다 채우면 의사결정 · 경과(이력)도 같은 창', async () => {
    const { dlg } = await openFor('down');
    const submit = dlg.querySelector('[data-decide-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(dlg.querySelector('[data-decide-missing]')!.textContent).toContain('법적 검토 근거'); // 선택지는 기존 결정으로 골라져 있다
    const inputs = dlg.querySelectorAll('[data-decide-form] input:not([type])');
    fireEvent.change(inputs[0], { target: { value: '운영위 3호' } });
    fireEvent.change(inputs[1], { target: { value: '진료부장' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(dlg.querySelector('[data-decide-more="log"] summary')!);
    await waitFor(() => expect(dlg.querySelector('[data-timeline="down"]')).toBeTruthy());
  });
  it('🔴 허가권자 결정 — 근거 문서가 없으면 다른 칸을 다 채워도 잠김(안내: 근거 문서를 첨부하세요)', async () => {
    const { dlg } = await openFor('up');
    const inputs = dlg.querySelectorAll('[data-decide-form] input:not([type])');
    fireEvent.change(inputs[0], { target: { value: '법무 회신 3호' } });
    fireEvent.change(inputs[1], { target: { value: '원장' } });
    expect(dlg.querySelector('[data-decide-missing]')!.textContent).toContain('근거 문서');
    expect((dlg.querySelector('[data-decide-submit]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('과정 띠 — 선행 결정 충족/대기 · 위원회 결정은 ①~⑦과 다음 할 일', async () => {
    const { dlg } = await openFor('unk');
    expect(dlg.querySelectorAll('[data-decide-step]').length).toBe(7);
    expect(dlg.querySelector('[data-decide-next]')).toBeTruthy();
  });
});

describe('결정 이력 탭', () => {
  async function toLog(opts: Parameters<typeof routes>[0] = {}) {
    routes(opts);
    const { default: Page } = await import('@/app/(main)/admin/decisions/page');
    const v = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-decision-view="LOG"]')).toBeTruthy());
    fireEvent.click(v.container.querySelector('[data-decision-view="LOG"]')!);
    await waitFor(() => expect(v.container.querySelector('[data-log-entry]')).toBeTruthy());
    return v;
  }
  it('종류 배지 · 무엇에서 무엇으로 · 선행 변경 · 설정 직접 변경(결정과 다름) · 탭 수 = 이력 총수', async () => {
    const { container } = await toLog();
    expect(container.querySelector('[data-decision-view="LOG"]')!.textContent).toContain('7');
    expect(container.querySelector('[data-log-entry="l1"] [data-log-choice]')!.textContent).toContain('끔 → 켬');
    expect(container.querySelector('[data-log-entry="l2"] [data-log-upstream]')!.textContent).toContain('선행 결정');
    expect(container.querySelector('[data-log-entry="l3"] [data-log-config]')!.textContent).toContain('결정과 다름');
    expect(container.querySelector('[data-register-link]')!.getAttribute('href')).toBe('/admin/decisions/register');
  });
  it('정돈(2026-10-11) — 머리(제목·총수·결정 대장 단추) · 날짜별 묶음(최신 날부터) · 종류는 색 점+글자', async () => {
    const { container } = await toLog();
    const view = container.querySelector('[data-log-view]')!;
    expect(view.textContent).toContain('결정 이력');
    const days = [...view.querySelectorAll('[data-log-day]')].map((d) => d.getAttribute('data-log-day'));
    expect(days.length).toBe(3); // 10-11 · 10-05 · 10-01 — 사건 날짜마다 한 머리
    expect(view.querySelector(`[data-log-day="${days[0]}"] [data-log-entry="l3"]`)).toBeTruthy();
    expect(view.querySelector('[data-log-entry="l1"]')!.textContent).toContain('의사결정');
  });
  it('🔴 자르면 "더 보기"(커서로 다음 쪽) · 표시/전체 · 종류 거르기', async () => {
    const { container } = await toLog();
    expect(container.querySelector('[data-log-shown]')!.textContent).toContain('3 / 4');
    fireEvent.click(container.querySelector('[data-log-more]')!);
    await waitFor(() => expect(container.querySelector('[data-log-entry="l0"]')).toBeTruthy());
    expect(get.mock.calls.some((c) => String(c[0]).includes('cursor=c1'))).toBe(true);
    expect(container.querySelector('[data-log-more]')).toBeNull();
    fireEvent.click(container.querySelector('[data-log-filter="UPSTREAM_CHANGED"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-log-entry]').length).toBe(1));
    expect(get.mock.calls.some((c) => String(c[0]).includes('kind=UPSTREAM_CHANGED'))).toBe(true);
  });
  it('🔴 이력 조회 실패는 오류로(빈 이력으로 그리지 않는다)', async () => {
    routes({ logFail: true });
    const { default: Page } = await import('@/app/(main)/admin/decisions/page');
    const v = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-decision-view="LOG"]')).toBeTruthy());
    fireEvent.click(v.container.querySelector('[data-decision-view="LOG"]')!);
    // 🔴 오류 부품이 실제로 떴는지 본다(종전 정규식은 화면의 다른 문구에 먼저 맞아 로딩 중에 통과했다 — 재주입으로 적발)
    const logView = () => v.container.querySelector('[data-log-view]')!;
    await waitFor(() => expect(logView().querySelector('.bg-red-50, .text-red-600')).toBeTruthy());
    expect(logView().querySelector('[data-log-empty]')).toBeNull();
    expect(logView().querySelector('[data-log-entry]')).toBeNull();
  });
});

describe('결정 문서 · 결정 대장', () => {
  it('결정 문서 — 현재 효력(설정 결정과 다름·재검토) + 결정 경과 이력', async () => {
    routes();
    const { default: Doc } = await import('@/app/(main)/admin/decisions/[key]/page');
    // React use() 는 이미 풀린 thenable(status·value)을 동기로 읽는다(테스트 환경에서 Suspense 가 깨어나지 않는 것을 피한다)
    const params = Object.assign(Promise.resolve({ key: 'down' }), { status: 'fulfilled', value: { key: 'down' } });
    const v = render(<Suspense fallback={null}><Doc params={params} /></Suspense>, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-timeline="down"]')).toBeTruthy());
    expect(v.container.querySelector('[data-doc-review]')!.textContent).toContain('선행 결정');
    expect(v.container.textContent).toContain('현재 상황(의사결정 이전)');
    expect(v.container.textContent).not.toContain('지금 무슨 일이 일어나고 있는가');
    expect(v.container.querySelector('[data-doc-config]')!.textContent).toContain('결정과 다름');
    expect([...v.container.querySelectorAll('[data-timeline="down"] [data-log-entry]')].map((e) => e.getAttribute('data-log-kind'))).toEqual(['RECORDED', 'UPSTREAM_CHANGED', 'CONFIG_OVERRIDE']);
    // 2026-10-12 사용자 "세부적인 부분에서도 충분하게 화면 여백을 사용할것" — 폭 전체 · 본문 | 내역·설정·경과 2열 · 영역 › 세부 분류
    expect(v.container.querySelector('[data-doc-page]')!.className).not.toMatch(/max-w-|mx-auto/);
    expect(v.container.querySelector('[data-doc-layout]')!.className).toMatch(/(^|\s)xl:grid-cols-/); // 2xl: 만으로는 넓은 화면 대부분이 1열
    const aside = v.container.querySelector('[data-doc-aside]')!;
    expect(aside.querySelector('[data-doc-config]')).toBeTruthy();
    expect(aside.querySelector('[data-timeline="down"]')).toBeTruthy();
    expect(v.container.querySelector('[data-doc-main]')!.textContent).toContain('현재 상황(의사결정 이전)');
    expect(v.container.querySelector('[data-doc-category]')!.textContent).toContain('운영 › 환자환경');
  });
  it('🔴 결정 대장 — 실결정은 효력+경과 · 시드는 따로(실결정 아님) · 미결은 제목만', async () => {
    routes({ nextCursor: null });
    // 미결 1건을 더한다(공용 ITEMS 는 전부 결정·시드라 미결 묶음을 겨누지 못한다)
    const OPEN_ITEM = { ...ITEMS[4], key: 'op', title: '미결 결정', decided: false, seeded: false, record: null, stage: null };
    const base0 = get.getMockImplementation()!;
    get.mockImplementation(async (url: string) => url === '/api/v1/admin/decisions' ? { data: payload([...ITEMS, OPEN_ITEM]) } : base0(url));
    const { default: Reg } = await import('@/app/(main)/admin/decisions/register/page');
    const v = render(<Reg />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-register-entry="down"]')).toBeTruthy());
    expect(v.container.querySelector('[data-register-real]')!.textContent).toBe('4');
    expect(v.container.querySelector('[data-register-seeded]')!.textContent).toBe('1');
    expect(v.container.querySelector('[data-register-seed-row="sd"]')).toBeTruthy();
    expect(v.container.querySelector('[data-register-entry="sd"]')).toBeNull();
    const kinds = [...v.container.querySelectorAll('[data-register-entry="down"] [data-log-entry]')].map((e) => e.getAttribute('data-log-kind'));
    expect(kinds).toEqual(['RECORDED', 'UPSTREAM_CHANGED', 'CONFIG_OVERRIDE']); // 오래된 것부터
    // 2026-10-12 정돈 — 미결은 영역별로 묶되 제목만(설명자료 링크) · 실결정·시드는 미결에 섞이지 않는다
    const openRows = [...v.container.querySelectorAll('[data-register-open-row]')];
    const openKeys = openRows.map((e) => e.getAttribute('data-register-open-row'));
    expect(openKeys).not.toContain('down');
    expect(openKeys).not.toContain('sd');
    expect(openKeys).toEqual(['op']);
    for (const r of openRows) expect(r.querySelector('a')!.getAttribute('href')).toBe(`/admin/decisions/${encodeURIComponent(r.getAttribute('data-register-open-row')!)}`);
    expect(v.container.querySelector('[data-register-entry="down"] a[href="/admin/decisions/down"]')).toBeTruthy();
    // 2026-10-12 영역 안 세부 분류 — 실결정·미결 모두 세부 분류 머리 아래
    expect(v.container.querySelector('[data-register-section="REAL"] [data-register-sub="O_PATIENT_ENV"]')!.textContent).toContain('환자환경');
    expect(v.container.querySelector('[data-register-section="OPEN"] [data-register-sub="O_PATIENT_ENV"]')).toBeTruthy();
  });
  it('🔴 결정 대장 — 화면 폭을 다 쓰고 표 칸 너비를 고정한다(칸이 좁아 글자가 한 자씩 세로로 꺾였다 2026-10-12)', async () => {
    routes({ nextCursor: null });
    const { default: Reg } = await import('@/app/(main)/admin/decisions/register/page');
    const v = render(<Reg />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-register-page]')).toBeTruthy());
    const page = v.container.querySelector('[data-register-page]')!;
    expect(page.className).not.toMatch(/max-w-|mx-auto/);
    expect(page.className).toContain('break-keep');
    const table = v.container.querySelector('[data-register-seed-table]')!;
    expect(table.className).toContain('table-fixed');
    expect(table.querySelectorAll('colgroup col').length).toBe(5);
    expect(table.closest('.grid')).toBeNull(); // 영역 표를 나란히 두 줄로 놓지 않는다
  });
  it('🔴 결정 대장 — 실결정이 없으면 그렇다고 말한다 · 이력 실패 고지', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/admin/decisions') return { data: payload(ITEMS.filter((i) => i.key === 'sd')) };
      throw new Error('down');
    });
    const { default: Reg } = await import('@/app/(main)/admin/decisions/register/page');
    const v = render(<Reg />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-register-real-none]')).toBeTruthy());
    await waitFor(() => expect(v.container.querySelector('[data-register-log-error]')).toBeTruthy());
  });
});
