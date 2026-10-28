/**
 * 결정 화면 — 위원회별 보기·결정권한자(2026-10-11 사용자 "위원회 결정사항들이 연결되어 있지 않나? 결정권한자를 위원회별로 구분해서 정의").
 *  · 위원회 9곳 섹션 = shared 정본 순서 · 위원장·간사·당연직·의결 요건·확인 담당
 *  · 🔴 명부는 임명/시드를 가른다 — 시드 위원장은 "위원장 임명 기록 없음" · 조회 실패는 "확인 불가"(0명 아님)
 *  · 행 배지 = 주관 위원회 · 펼치면 결정권한자 · 상정 창은 주관·합동만 고를 수 있고 주관이 골라져 있다
 *  · 허가권자·직원 층은 위원회를 거치지 않는다고 말한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMMITTEE_CODES, COMMITTEE_AUTHORITIES } from '@hospital-run/shared';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), postForm: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); try { window.localStorage.clear(); } catch { /* 저장소 없음 */ } });

const base = {
  why: '이유', legalReview: [], approvalPath: 'COMMITTEE', authority: '위원회', options: [{ value: 'A', label: '선택 A', effect: '효과' }],
  statusQuo: '현행', goLive: 'CAN_FOLLOW', owner: '팀', dueBy: 'NONE', currentConfigValue: null, pendingAttachments: [], unlocks: [],
  enactment: { state: 'UNDECIDED', label: '미결', detail: null, actions: [] }, decided: false, seeded: false, readyToDecide: true, blockedBy: [], record: null,
  track: 'QUALITY', domain: 'MEDICAL', agenda: null, stage: { stage: 'PREPARE', flags: [] },
};
const ITEMS = [
  { ...base, key: 'q.lead', title: '제목 QPS', layer: 'INTERNAL_COMMITTEE', committee: { lead: 'QPS', joint: ['MRC'] } },
  { ...base, key: 'm.lead', title: '제목 MRC', layer: 'INTERNAL_COMMITTEE', committee: { lead: 'MRC', joint: [] } },
  { ...base, key: 'l.1', title: '허가 항목', layer: 'LICENSE_HOLDER', approvalPath: 'AUTHORIZED_ROLE', committee: null },
];
const AUTH: Record<string, unknown> = {
  QPS: { source: 'DEV_SEED', record: { chair: COMMITTEE_AUTHORITIES.QPS.chair, secretary: COMMITTEE_AUTHORITIES.QPS.secretary, exOfficio: [...COMMITTEE_AUTHORITIES.QPS.exOfficio], votingRule: COMMITTEE_AUTHORITIES.QPS.votingRule, verifier: COMMITTEE_AUTHORITIES.QPS.verifier, basisRef: '개발 시드(DEV-SEED) — 테스트', recordedAt: '2026-10-11' } },
  MRC: { source: 'RECORDED', record: { chair: '원내 지정 위원장', secretary: 'S', exOfficio: ['E'], votingRule: 'V', verifier: 'W', basisRef: '규정 제3호', recordedAt: '2026-10-11' } },
  DTC: null,
};
const roll = (code: string, roster: unknown) => ({ code, name: COMMITTEE_AUTHORITIES[code as 'QPS'].name, lead: 0, joint: 0, decided: 0, seeded: 0, inProcess: 0, roster, authority: code in AUTH ? AUTH[code] : { source: 'NONE', record: null } });
function payload(rosterQps: unknown = { active: 5, manual: 0, seed: 5, chairAppointed: false }, rosterMrc: unknown = { active: 2, manual: 2, seed: 0, chairAppointed: true }) {
  return {
    items: ITEMS,
    layers: { LICENSE_HOLDER: { label: 'L', scope: '', cannot: '' }, INTERNAL_COMMITTEE: { label: 'C', scope: '', cannot: '' }, STAFF: { label: 'S', scope: '', cannot: '' } },
    tracks: { QUALITY: '의료 질·지표' },
    summary: {
      byLayer: [], byTrack: [{ track: 'QUALITY', label: '의료 질·지표', total: 3, decided: 0, readyToDecide: 3 }], goLiveRequired: { total: 0, decided: 0 }, seeded: 0,
      byDomain: [], byStage: [], agendaUnknown: false,
      byCommittee: COMMITTEE_CODES.map((c) => roll(c, c === 'QPS' ? rosterQps : c === 'MRC' ? rosterMrc : null)),
    },
    measuredAt: '2026-10-11T00:00:00Z', caveat: '',
  };
}
async function mount(p = payload()) {
  get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/decisions') return { data: p };
    if (url === '/api/v1/governance/summary') return { data: { data: { committees: COMMITTEE_CODES.map((c, i) => ({ id: `c-${i}`, code: c, name: COMMITTEE_AUTHORITIES[c].name })) } } };
    return { data: { data: [] } };
  });
  const { default: Page } = await import('@/app/(main)/admin/decisions/page');
  const v = render(<Page />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-decision-view="COMMITTEE"]')).toBeTruthy());
  fireEvent.click(v.container.querySelector('[data-decision-view="COMMITTEE"]')!);
  return v;
}
const tab = (c: HTMLElement, k: string) => fireEvent.click(c.querySelector(`[data-committee-tab="${k}"]`)!);

describe('위원회별 보기 — 결정권한자', () => {
  it('탭 = 전체 → 9곳(정본 순서) → 허가권자 → 직원 · 전체 탭은 위원회 한 줄 요약(행을 늘어놓지 않는다) · 요약을 누르면 그 위원회 탭', async () => {
    const { container } = await mount();
    expect([...container.querySelectorAll('[data-committee-tab]')].map((s) => s.getAttribute('data-committee-tab'))).toEqual(['ALL', ...COMMITTEE_CODES, 'LICENSE_HOLDER', 'STAFF']);
    expect([...container.querySelectorAll('[data-committee-overview-row]')].map((s) => s.getAttribute('data-committee-overview-row'))).toEqual([...COMMITTEE_CODES]);
    expect(container.querySelectorAll('[data-decision-row]').length).toBe(0);
    fireEvent.click(container.querySelector('[data-committee-overview-row="QPS"] button')!);
    expect(container.querySelector('[data-committee-tab="QPS"]')!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-committee-section="QPS"]')).toBeTruthy();
  });
  it('🔴 전체 탭에서 검색하면 맞는 행이 그 위원회 아래에', async () => {
    const { container } = await mount();
    fireEvent.change(container.querySelector('[data-decision-search]')!, { target: { value: 'm.lead' } });
    expect([...container.querySelectorAll('[data-committee-overview-row="MRC"] [data-decision-row]')].map((r) => r.getAttribute('data-decision-row'))).toEqual(['m.lead']);
    expect(container.querySelectorAll('[data-committee-overview-row="QPS"] [data-decision-row]').length).toBe(0);
  });
  it('위원회 탭 — 위원장·간사·당연직·의결 요건 · 주관 결정만 · 합동 결정은 접혀 있다', async () => {
    const { container } = await mount();
    tab(container, 'QPS');
    const qps = container.querySelector('[data-committee-authority="QPS"]')!.textContent!;
    expect(qps).toContain(COMMITTEE_AUTHORITIES.QPS.chair);
    expect(qps).toContain(COMMITTEE_AUTHORITIES.QPS.secretary);
    expect(qps).toContain(COMMITTEE_AUTHORITIES.QPS.votingRule);
    const qSec = container.querySelector('[data-committee-section="QPS"]')!;
    expect([...qSec.querySelectorAll('[data-decision-row]')].map((r) => r.getAttribute('data-decision-row'))).toEqual(['q.lead']);
    tab(container, 'MRC');
    const joint = container.querySelector('[data-committee-joint-list="MRC"]')!;
    expect(joint.querySelectorAll('[data-decision-row]').length).toBe(0);
    fireEvent.click(joint.querySelector('button[aria-expanded]')!);
    expect([...joint.querySelectorAll('[data-decision-row]')].map((r) => r.getAttribute('data-decision-row'))).toEqual(['q.lead']);
    expect(container.querySelector('[data-committee-caveat]')!.textContent).toContain('개발 시드로 확정');
  });

  it('🔴 명부 — 시드 위원장은 임명이 아니다 · 조회 실패는 확인 불가 · 대조군: 임명된 위원장은 경고 없음', async () => {
    const { container } = await mount();
    tab(container, 'QPS');
    expect(container.querySelector('[data-committee-roster="QPS"]')!.textContent).toContain('위원장 임명 기록 없음');
    expect(container.querySelector('[data-committee-roster="QPS"]')!.textContent).toContain('시드 5');
    tab(container, 'MRC');
    expect(container.querySelector('[data-committee-roster="MRC"]')!.textContent).not.toContain('위원장 임명 기록 없음');
    tab(container, 'DTC');
    expect(container.querySelector('[data-committee-roster="DTC"]')!.textContent).toContain('확인 불가');
  });

  it('허가권자·직원 층 — 위원회를 거치지 않는다고 말한다 · 탭에서 그 층 결정을 바로 본다', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-committee-non="LICENSE_HOLDER"]')!.textContent).toContain('위원회 의결로 대신할 수 없다');
    tab(container, 'LICENSE_HOLDER');
    expect([...container.querySelectorAll('section[data-committee-non="LICENSE_HOLDER"] [data-decision-row]')].map((r) => r.getAttribute('data-decision-row'))).toEqual(['l.1']);
  });

  it('행 배지 = 주관 위원회(+합동 수) · 펼치면 결정권한자', async () => {
    const { container } = await mount();
    tab(container, 'QPS');
    const row = container.querySelector('[data-decision-row="q.lead"]')!;
    expect(row.querySelector('[data-row-committee="QPS"]')!.textContent).toBe(`${COMMITTEE_AUTHORITIES.QPS.name} +1`);
    fireEvent.click(row.querySelector('button[aria-expanded]')!);
    const blk = container.querySelector('[data-authority-block="q.lead"]')!;
    expect(blk.textContent).toContain(COMMITTEE_AUTHORITIES.QPS.chair);
    expect(blk.querySelector('[data-authority-joint]')!.textContent).toContain('의무기록위원회(MRC)');
  });

  it('🔴 상정 창 — 주관·합동만 고를 수 있고 주관이 골라져 있다', async () => {
    const { container } = await mount();
    tab(container, 'QPS');
    const row = container.querySelector('[data-decision-row="q.lead"]')!;
    fireEvent.click(row.querySelector('button[aria-expanded]')!);
    const btn = [...container.querySelectorAll('[data-decision-detail="q.lead"] button')].find((b) => b.textContent?.includes('위원회 상정'))!;
    fireEvent.click(btn);
    await waitFor(() => expect(document.querySelector('[data-propose-assigned]')).toBeTruthy());
    const findSel = () => [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent?.includes('(QPS)')));
    await waitFor(() => expect(findSel()).toBeTruthy());
    const sel = findSel()!;
    expect(sel.options.length).toBe(3); // 선택 안내 + QPS + MRC
    expect([...sel.options].slice(1).map((o) => o.textContent)).toEqual([`${COMMITTEE_AUTHORITIES.QPS.name} (QPS) · 주관`, `${COMMITTEE_AUTHORITIES.MRC.name} (MRC) · 합동`]);
    expect(sel.value).toBe(`c-${COMMITTEE_CODES.indexOf('QPS')}`);
  });

  it('🔴 결정권한자 기록 출처 — 시드 확정·원내 채택(기록 값을 그린다)·없음·조회 실패를 가른다', async () => {
    const { container } = await mount();
    const src = (c: string) => { tab(container, c); return container.querySelector(`[data-committee-section="${c}"] [data-committee-authority-source]`)!; };
    expect(src('QPS').getAttribute('data-committee-authority-source')).toBe('DEV_SEED');
    expect(src('QPS').textContent).toContain('원내 채택 아님');
    expect(src('MRC').getAttribute('data-committee-authority-source')).toBe('RECORDED');
    expect(container.querySelector('[data-committee-authority="MRC"]')!.textContent).toContain('원내 지정 위원장');
    expect(src('DTC').getAttribute('data-committee-authority-source')).toBe('UNKNOWN');
    expect(src('IC').getAttribute('data-committee-authority-source')).toBe('NONE');
    // 전체 탭 요약도 같은 출처를 말한다(원내 지정 위원장 = 기록 값)
    tab(container, 'ALL');
    expect(container.querySelector('[data-committee-overview-row="MRC"]')!.textContent).toContain('원내 지정 위원장');
  });

  it('정돈(2026-10-11 "위원회별 탭도 같은 스타일로") — 요약 행 = 이름+메타(위원장·간사·출처)+결정 진행 · 카드 = 결정권한자 항목(dt/dd)·진행 · 목록 머리 · 안내는 접힘', async () => {
    const { container } = await mount();
    const ov = container.querySelector('[data-committee-overview-row="QPS"] button')!;
    expect(ov.textContent).toContain(COMMITTEE_AUTHORITIES.QPS.chair);
    expect(ov.textContent).toContain(COMMITTEE_AUTHORITIES.QPS.secretary);
    expect(ov.textContent).toContain('원내 채택 아님');
    expect(ov.textContent).toMatch(/결정됨 0\/1/);
    expect(container.querySelector('[data-committee-caveat]')!.tagName).toBe('DETAILS');
    tab(container, 'QPS');
    const dl = container.querySelector('[data-committee-authority="QPS"]')!;
    expect([...dl.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(expect.arrayContaining(['위원장', '간사(안건 접수·회의 배정)', '확인 담당(⑦)', '당연직 위원', '의결 요건', '명부']));
    expect(container.querySelector('[data-committee-section="QPS"]')!.textContent).toContain('주관 결정');
  });
});
