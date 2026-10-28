/**
 * 결정 등록부 화면 — 카테고리(축)별 정리(2026-10-10 사용자 요청 "카테고리 별로 정리정돈").
 *  · 222건을 층으로만 나눠 이유·검토·이행까지 다 펼친 카드로 그려 자기 것을 찾을 수 없었다
 *  · 축 섹션(서버 축 순서) · 한 줄 행(제목·층·상태·개시 전 필수·기록·설명자료) · 펼치면 종전 카드 내용 그대로
 *  · 섹션 안 정렬: 지금 가능 → 선행 대기 → 개발 시드 → 결정됨 · 시드 행은 무엇으로 해 두었는지 보인다
 *  · 🔴 검색·필터로 걸러도 전체 분모를 함께 낸다 · 섹션 머리 수는 전체 항목에서 센다
 *  · 층별 보기를 남긴다(층마다 "할 수 없는 것" 문구)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sortDecisionRows, decisionRowState, matchesDecisionQuery } from '@/app/(main)/admin/decisions/types';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), postForm: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); try { window.localStorage.clear(); } catch { /* 저장소 없음 */ } });

const base = {
  why: '이유 본문', legalReview: ['검토 항목'], approvalPath: 'AUTHORIZED_ROLE', authority: '원무과장', options: [{ value: 'A', label: '선택 A', effect: '효과' }, { value: 'B', label: '선택 B', effect: '효과 B' }],
  statusQuo: '현행', goLive: 'CAN_FOLLOW', owner: '팀', dueBy: 'NONE', currentConfigValue: null, pendingAttachments: [], unlocks: [],
  enactment: { state: 'UNDECIDED', label: '미결', detail: null, actions: [] },
};
const item = (key: string, track: string, layer: string, st: 'READY' | 'BLOCKED' | 'SEEDED' | 'DECIDED', extra: Record<string, unknown> = {}) => ({
  ...base, key, title: `제목 ${key}`, track, layer,
  decided: st === 'DECIDED', seeded: st === 'SEEDED', readyToDecide: st === 'READY',
  blockedBy: st === 'BLOCKED' ? [{ key: 'x', title: '상위', reason: '미결' }] : [],
  record: st === 'SEEDED' || st === 'DECIDED'
    ? { choice: 'B', legalReviewRef: st === 'SEEDED' ? '개발 시드(DEV-SEED)' : '의결 1', authorityClaim: 'x', decidedByUserId: 'u', decidedAt: '2026-10-10T00:00:00Z', applied: true }
    : null,
  ...extra,
});
const ITEMS = [
  item('q.decided', 'QUALITY', 'INTERNAL_COMMITTEE', 'DECIDED'),
  item('q.seeded', 'QUALITY', 'INTERNAL_COMMITTEE', 'SEEDED'),
  item('q.blocked', 'QUALITY', 'INTERNAL_COMMITTEE', 'BLOCKED'),
  item('q.ready', 'QUALITY', 'INTERNAL_COMMITTEE', 'READY', { goLive: 'REQUIRED_BEFORE' }),
  item('b.ready', 'BILLING', 'LICENSE_HOLDER', 'READY'),
  item('b.decided', 'BILLING', 'LICENSE_HOLDER', 'DECIDED'),
];
const payload = {
  items: ITEMS,
  layers: {
    LICENSE_HOLDER: { label: '허가권자 층', scope: '범위', cannot: '허가권자 층이 할 수 없는 것' },
    INTERNAL_COMMITTEE: { label: '위원회 층', scope: '범위', cannot: '위원회 층이 할 수 없는 것' },
    STAFF: { label: '직원 층', scope: '범위', cannot: '직원 층이 할 수 없는 것' },
  },
  tracks: { BILLING: '청구·수가', QUALITY: '의료 질·지표' },
  summary: {
    byLayer: [{ layer: 'LICENSE_HOLDER', total: 2, decided: 1, blocked: 0, readyToDecide: 1 }, { layer: 'INTERNAL_COMMITTEE', total: 4, decided: 1, blocked: 1, readyToDecide: 1 }],
    byTrack: [{ track: 'QUALITY', label: '의료 질·지표', total: 4, decided: 1, readyToDecide: 1 }, { track: 'BILLING', label: '청구·수가', total: 2, decided: 1, readyToDecide: 1 }],
    goLiveRequired: { total: 1, decided: 0 }, seeded: 1,
  },
  measuredAt: '2026-10-10T00:00:00Z', caveat: '',
};

async function mount() {
  get.mockResolvedValue({ data: payload });
  const { default: Page } = await import('@/app/(main)/admin/decisions/page');
  const v = render(<Page />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-decision-section]')).toBeTruthy());
  return v;
}
const rowKeys = (el: Element | null) => [...(el?.querySelectorAll('[data-decision-row]') ?? [])].map((r) => r.getAttribute('data-decision-row'));

describe('정렬·상태 정본', () => {
  it('🔴 지금 가능 → 선행 대기 → 개발 시드 → 결정됨 · 같은 상태면 개시 전 필수 먼저', () => {
    expect(sortDecisionRows(ITEMS.filter((i) => i.track === 'QUALITY') as unknown as Array<{ key: string; decided: boolean; seeded?: boolean; readyToDecide: boolean; blockedBy: Array<{ key: string; title: string; reason: string }>; goLive: 'REQUIRED_BEFORE' | 'CAN_FOLLOW' | 'NOT_RELATED' }>).map((i) => i.key))
      .toEqual(['q.ready', 'q.blocked', 'q.seeded', 'q.decided']);
  });
  it('시드는 지금 가능보다 먼저 시드로 읽힌다(무엇으로 해 두었는지가 사실)', () => {
    expect(decisionRowState({ decided: false, seeded: true, readyToDecide: true, blockedBy: [] })).toBe('SEEDED');
  });
  it('검색은 낱말 모두 · 제목·키·허가권·축 라벨', () => {
    expect(matchesDecisionQuery({ key: 'qi.x', title: '서류 처리 기한', authority: '원무과장' }, '서류 기한')).toBe(true);
    expect(matchesDecisionQuery({ key: 'qi.x', title: '서류 처리 기한', authority: '원무과장' }, '서류 수수료')).toBe(false);
    expect(matchesDecisionQuery({ key: 'qi.x', title: 't', authority: 'a' }, '질', '의료 질·지표')).toBe(true);
  });
});

describe('카테고리별 화면', () => {
  it('🔴 서버 축 순서로 섹션 · 섹션 안 행 정렬 · 섹션 머리 수는 전체에서', async () => {
    const v = await mount();
    const sections = [...v.container.querySelectorAll('[data-decision-section]')].map((s) => s.getAttribute('data-decision-section'));
    expect(sections).toEqual(['QUALITY', 'BILLING']);
    const q = v.container.querySelector('[data-decision-section="QUALITY"]');
    expect(rowKeys(q)).toEqual(['q.ready', 'q.blocked', 'q.seeded', 'q.decided']);
    expect(q!.querySelector('[data-section-decided]')!.textContent).toContain('1/4');
  });

  it('🔴 개발 시드 행은 무엇으로 해 두었는지 보인다 · 개시 전 필수 배지', async () => {
    const v = await mount();
    const seeded = v.container.querySelector('[data-decision-row="q.seeded"] [data-decision-badge="SEEDED"]');
    expect(seeded!.textContent).toContain('선택 B');
    expect(v.container.querySelector('[data-decision-row="q.ready"] [data-decision-golive]')).toBeTruthy();
    expect(v.container.querySelector('[data-decision-row="q.blocked"] [data-decision-golive]')).toBeNull();
  });

  it('🔴 검색해도 전체 분모를 함께 낸다', async () => {
    const v = await mount();
    fireEvent.change(v.container.querySelector('[data-decision-search]')!, { target: { value: 'b.ready' } });
    const shown = v.container.querySelector('[data-decision-shown]')!.textContent!;
    expect(shown).toMatch(/1\s*\/\s*6/);
    expect(rowKeys(v.container)).toEqual(['b.ready']);
    // 🔴 섹션 머리는 거른 뒤에도 전체에서 센다(거른 수로 세면 "남은 일이 줄었다"로 읽힌다)
    fireEvent.change(v.container.querySelector('[data-decision-search]')!, { target: { value: 'q.ready' } });
    expect(v.container.querySelector('[data-decision-section="QUALITY"] [data-section-decided]')!.textContent).toContain('1/4');
    fireEvent.change(v.container.querySelector('[data-decision-search]')!, { target: { value: '없는말' } });
    expect(v.container.querySelector('[data-decision-none]')!.textContent).toContain('6');
  });

  it('행을 펼치면 종전 카드 내용(이유·검토·의사결정 단추) — 접혀 있을 땐 없다', async () => {
    const v = await mount();
    expect(v.container.querySelector('[data-decision-detail="q.ready"]')).toBeNull();
    fireEvent.click(v.container.querySelector('[data-decision-row="q.ready"] button[aria-expanded]')!);
    const d = v.container.querySelector('[data-decision-detail="q.ready"]')!;
    expect(d.textContent).toContain('이유 본문');
    expect(d.textContent).toContain('검토 항목');
    // 2026-10-11 사용자 "기록이 아니라 의사결정이라고 표시" — 단추는 '의사결정'
    expect(d.textContent).toContain('의사결정');
    expect(d.textContent).not.toContain('결정 기록');
  });

  it('섹션을 접을 수 있다 · 기록 단추는 44px', async () => {
    const v = await mount();
    const head = v.container.querySelector('[data-decision-section="BILLING"] > button')!;
    expect(rowKeys(v.container.querySelector('[data-decision-section="BILLING"]'))).toHaveLength(2);
    fireEvent.click(head);
    expect(rowKeys(v.container.querySelector('[data-decision-section="BILLING"]'))).toHaveLength(0);
    expect(v.container.querySelector('[data-decision-record-btn="b.ready"]')).toBeNull();
    expect(v.container.querySelector('[data-decision-record-btn="q.ready"]')!.className).toContain('min-h-[44px]');
  });

  it('층별 보기로 바꾸면 층 섹션과 "할 수 없는 것" 문구 · 카테고리 섹션은 사라진다', async () => {
    const v = await mount();
    fireEvent.click(v.container.querySelector('[data-decision-view="LAYER"]')!);
    expect(v.container.querySelector('[data-decision-section]')).toBeNull();
    // 층 탭 — 기본은 첫 층만(탭 순서 = 층 서열)
    expect([...v.container.querySelectorAll('[data-layer-tab]')].map((t) => t.getAttribute('data-layer-tab'))).toEqual(['LICENSE_HOLDER', 'INTERNAL_COMMITTEE', 'ALL']);
    expect(rowKeys(v.container.querySelector('[data-decision-layer-section="LICENSE_HOLDER"]'))).toEqual(['b.ready', 'b.decided']);
    expect(v.container.querySelector('[data-decision-layer-section="INTERNAL_COMMITTEE"]')).toBeNull();
    // 층 머리 정돈(2026-10-11) — 결정 진행·수치는 전체 분모
    expect(v.container.querySelector('[data-layer-stats="LICENSE_HOLDER"]')!.textContent).toMatch(/결정됨 \d+\/2/);
    fireEvent.click(v.container.querySelector('[data-layer-tab="INTERNAL_COMMITTEE"]')!);
    expect(v.container.querySelector('[data-decision-layer-section="INTERNAL_COMMITTEE"]')!.textContent).toContain('위원회 층이 할 수 없는 것');
  });
});

describe('영역 안 세부 분류(2026-10-12 사용자 "의료법인 기본설정·시스템 설정·행정 설정 … 규제·내부보안규정")', () => {
  const D_ITEMS = [
    item('billing.institutionType', 'BILLING', 'LICENSE_HOLDER', 'READY', { domain: 'FOUNDATION' }),
    item('release.productName', 'PLATFORM', 'INTERNAL_COMMITTEE', 'SEEDED', { domain: 'FOUNDATION' }),
    item('codes.newCodeApproval', 'MASTER', 'INTERNAL_COMMITTEE', 'SEEDED', { domain: 'FOUNDATION' }),
    item('qi.autoMeasure.enable', 'QUALITY', 'INTERNAL_COMMITTEE', 'SEEDED', { domain: 'MEDICAL' }),
    item('safety.kopsTransmit', 'QUALITY', 'LICENSE_HOLDER', 'READY', { domain: 'MEDICAL' }),
    item('auth.staffIdleTimeout', 'SECURITY', 'INTERNAL_COMMITTEE', 'READY', { domain: 'SECURITY' }),
    item('location.retentionDays', 'PRIVACY', 'LICENSE_HOLDER', 'READY', { domain: 'SECURITY' }),
  ];
  async function mountD() {
    get.mockResolvedValue({ data: { ...payload, items: D_ITEMS, tracks: { ...payload.tracks, PLATFORM: '플랫폼·운영', MASTER: '코드·마스터', SECURITY: '보안·키', PRIVACY: '개인정보·처리 경계' } } });
    const { default: Page } = await import('@/app/(main)/admin/decisions/page');
    const v = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-decision-section]')).toBeTruthy());
    return v;
  }
  const sectionsOf = (el: Element | null) => [...(el?.querySelectorAll('[data-decision-section]') ?? [])].map((s) => s.getAttribute('data-decision-section'));

  it('🔴 영역 안 묶음은 세부 분류 — 축이 같아도(품질) 질·규제로 갈린다 · 정본 순서', async () => {
    const v = await mountD();
    fireEvent.click(v.container.querySelector('[data-domain-tab="ALL"]')!);
    expect(sectionsOf(v.container.querySelector('[data-decision-domain="FOUNDATION"]'))).toEqual(['F_CORPORATE', 'F_SYSTEM', 'F_ADMIN']);
    expect(sectionsOf(v.container.querySelector('[data-decision-domain="MEDICAL"]'))).toEqual(['M_REGULATION', 'M_QUALITY']);
    expect(sectionsOf(v.container.querySelector('[data-decision-domain="SECURITY"]'))).toEqual(['S_REGULATION', 'S_INTERNAL']);
    const label = (k: string) => v.container.querySelector(`[data-decision-section="${k}"] [data-section-label]`)!.textContent;
    expect(label('F_CORPORATE')).toBe('의료법인 기본설정');
    expect(label('S_INTERNAL')).toBe('내부보안규정');
    expect(rowKeys(v.container.querySelector('[data-decision-section="M_REGULATION"]'))).toEqual(['safety.kopsTransmit']);
    expect(v.container.querySelector('[data-decision-section="M_QUALITY"] [data-section-decided]')!.textContent).toContain('0/1');
  });
});
