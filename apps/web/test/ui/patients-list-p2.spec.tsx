/**
 * 🔴 환자 목록 P2(2026-10-20 · `patients-list-refinement-2026-10.plan.md` A8·A10·R12·R16·R17).
 *  - 병합 창이 "모든 진료기록 이관"이라 말했다(실제 190 모델 중 6개) · 비교 없이 confirm() 하나 · 중복 그룹에서 다시 검색
 *  - 태그 필터가 화면 고정 9종(운영에 해당 환자 0명)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ui/PatientSelector', () => ({ default: ({ value }: { value: string }) => <input data-selector readOnly value={value} /> }));
vi.mock('@/hooks/useWideScreen', () => ({ useWideScreen: () => false, splitIntoColumns: <T,>(rows: T[]) => [rows] }));
vi.mock('@/stores/auth-store', () => {
  const user = { id: 'u', role: 'ADMIN', department: '' };
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user });
  return { useAuthStore };
});

import { MergePatientsModal } from '@/app/(main)/patients/components/MergePatientsModal';
import { mergeSuggestion } from '@/app/(main)/patients/components/DuplicateReviewModal';
import { ApiError } from '@/lib/api-client';

const side = (id: string, over: Record<string, unknown> = {}) => ({ id, mrn: `M-${id}`, familyName: '김', givenName: '가', dateOfBirth: '1980-01-01', gender: 'MALE', insuranceType: 'NHI', createdAt: '2026-01-01T00:00:00Z', ...over });
type Row = { model: string; policy?: string; count: number; safetyLabel: string | null };
const preview = (unmoved: Row[], uncounted: string[] = [], blocking: Row[] = []) => ({
  source: side('src', { gender: 'FEMALE' }), target: side('tgt'),
  records: {
    moved: [{ model: 'Encounter', policy: 'MOVE', count: 3, safetyLabel: null }, { model: 'Allergy', policy: 'MOVE', count: 2, safetyLabel: '알레르기' }],
    unmoved: unmoved.map((r) => ({ policy: 'STAY', ...r })), blocking: blocking.map((r) => ({ policy: 'BLOCK', ...r })), uncounted,
    movedTotal: 5, unmovedTotal: unmoved.reduce((s, r) => s + r.count, 0),
  },
  reversible: false,
});
let previewBody: unknown = preview([]);
function route(url: string) {
  if (url === '/api/v1/patients/merge-preview') return Promise.resolve({ data: previewBody });
  return Promise.resolve({ data: {} });
}
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); get.mockImplementation(route); post.mockResolvedValue({ data: {} }); previewBody = preview([]); });

describe('🔴 병합 창 — 비교 → 확인 → 기록', () => {
  it('"모든 진료기록 이관"이라 말하지 않는다 · 옮겨지는 범위와 되돌리기 없음을 말한다', async () => {
    const { container } = mount(<MergePatientsModal onClose={() => {}} initial={{ sourceId: 'src', targetId: 'tgt' }} />);
    expect(container.textContent).not.toMatch(/모든 진료기록/);
    expect(container.querySelector('[data-merge-scope-note]')!.textContent).toMatch(/되돌리는 기능은 없습니다/);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-compare]')).toBeTruthy());
    // 다른 칸은 강조(성별) · 같은 칸은 아님(보험)
    expect(container.querySelector('[data-merge-row="성별"]')!.getAttribute('data-differs')).toBe('1');
    expect(container.querySelector('[data-merge-row="보험"]')!.getAttribute('data-differs')).toBeNull();
  });

  it('🔴 남는 기록이 있으면 안전 기록을 이름으로 먼저 · 확인 칸은 비어서 시작 · 확인 전 실행 불가 · 확인 사실을 보낸다', async () => {
    previewBody = preview([{ model: 'PatientBloodTyping', policy: 'UNIQUE', count: 1, safetyLabel: '혈액형' }, { model: 'PatientJourneyEvent', count: 1, safetyLabel: null }]);
    const close = vi.fn();
    const { container } = mount(<MergePatientsModal onClose={close} initial={{ sourceId: 'src', targetId: 'tgt' }} />);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-ack]')).toBeTruthy());
    expect(container.querySelector('[data-merge-unmoved-model="PatientBloodTyping"]')!.textContent).toMatch(/혈액형/);
    // 남는 이유를 말한다(대상에 같은 기록 · 원장)
    expect(container.querySelector('[data-merge-stay-reason="UNIQUE"]')).toBeTruthy();
    expect(container.querySelector('[data-merge-stay-reason="STAY"]')).toBeTruthy();
    // 알레르기는 옮겨진다(종전엔 남았다)
    expect(container.querySelector('[data-merge-moved-model="Allergy"]')!.textContent).toMatch(/알레르기/);
    const ack = container.querySelector('[data-merge-ack] input') as HTMLInputElement;
    expect(ack.checked).toBe(false);
    const submit = container.querySelector('[data-merge-submit]') as HTMLButtonElement;
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: '중복 등록' } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(ack);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ sourceId: 'src', targetId: 'tgt', reason: '중복 등록', acknowledgeUnmoved: true });
  });

  it('🔴 실패는 창을 닫지 않고 서버 이유를 그 자리에서', async () => {
    post.mockRejectedValueOnce(new ApiError('MERGE_PATIENT_INACTIVE', '대상 환자가 이미 병합되었거나 비활성인 기록입니다'));
    const close = vi.fn();
    const { container } = mount(<MergePatientsModal onClose={close} initial={{ sourceId: 'src', targetId: 'tgt' }} />);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-compare]')).toBeTruthy());
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'x' } });
    fireEvent.click(container.querySelector('[data-merge-submit]')!);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-submit-error]')?.textContent).toMatch(/이미 병합/));
    expect(close).not.toHaveBeenCalled();
  });

  it('🔴 활성 법적 보존명령이면 막는다 — 확인·사유가 있어도 실행 불가', async () => {
    previewBody = preview([], [], [{ model: 'LegalHold', count: 1, safetyLabel: '법적 보존명령' }]);
    const { container } = mount(<MergePatientsModal onClose={() => {}} initial={{ sourceId: 'src', targetId: 'tgt' }} />);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-blocked]')).toBeTruthy());
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'x' } });
    expect((container.querySelector('[data-merge-submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('세지 못한 기록 종류가 있으면 0 이라 말하지 않고 확인을 요구한다', async () => {
    previewBody = preview([], ['Vaccination']);
    const { container } = mount(<MergePatientsModal onClose={() => {}} initial={{ sourceId: 'src', targetId: 'tgt' }} />);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-uncounted]')).toBeTruthy());
    expect(container.querySelector('[data-merge-ack]')).toBeTruthy();
  });

  it('대조군: 남는 기록이 없으면 확인 칸 없이 실행 · 확인 값을 보내지 않는다', async () => {
    const { container } = mount(<MergePatientsModal onClose={() => {}} initial={{ sourceId: 'src', targetId: 'tgt' }} />);
    await vi.waitFor(() => expect(container.querySelector('[data-merge-compare]')).toBeTruthy());
    expect(container.querySelector('[data-merge-ack]')).toBeNull();
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'x' } });
    fireEvent.click(container.querySelector('[data-merge-submit]')!);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].acknowledgeUnmoved).toBeUndefined();
  });

  it('중복 그룹 제안 — 먼저 등록된 기록을 남기고 나중 기록을 합친다', () => {
    expect(mergeSuggestion([{ id: 'b', createdAt: '2026-05-01' }, { id: 'a', createdAt: '2026-01-01' }])).toEqual({ targetId: 'a', sourceId: 'b' });
    expect(mergeSuggestion([{ id: 'a', createdAt: '2026-01-01' }])).toBeNull();
  });

  it('🔴 구조 가드 — confirm() 없음 · 확인 없는 병합 훅 회수', () => {
    const modal = readFileSync(resolve(__dirname, '../../src/app/(main)/patients/components/MergePatientsModal.tsx'), 'utf8');
    const code = modal.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\bconfirm\(/);
    const hooks = readFileSync(resolve(__dirname, '../../src/hooks/usePatients.ts'), 'utf8');
    expect(hooks).not.toMatch(/export function useMergePatients/);
  });
});

describe('🔴 태그 필터 — 실제 데이터의 태그', () => {
  const pageRoute = (tags: unknown) => (url: string) => {
    if (url === '/api/v1/patients/list-capabilities') return Promise.resolve({ data: { scope: 'ALL', contact: 'FULL', contactReason: null, identity: true, phoneSearch: true, canRegister: true, canImport: true, canMerge: true, canExport: true, canReviewDuplicates: true, canViewQuality: true, narrowing: null } });
    if (url === '/api/v1/patients/filter-options') return Promise.resolve({ data: { foreignerTotal: 0, nationalities: [], languages: [], ...(tags as object) } });
    if (url === '/api/v1/patients') return Promise.resolve({ data: [], pagination: { total: 0, hasMore: false } });
    if (url === '/api/v1/patients/onsite-summary') return Promise.resolve({ data: { total: 0, states: [] } });
    return Promise.resolve({ data: {} });
  };
  async function mountPage() {
    const { default: Page } = await import('@/app/(main)/patients/page');
    const r = mount(<Page />);
    fireEvent.click(await vi.waitFor(() => { const b = r.container.querySelector('[data-filter-toggle]'); if (!b) throw new Error('no toggle'); return b; }));
    return r;
  }

  it('서버가 준 태그로 칩 · 건수 · 잘렸으면 잘렸다고 · 고정 9종(감염주의) 없음', async () => {
    get.mockImplementation(pageRoute({ tags: [{ tag: '정형외과', count: 100 }, { tag: '내과', count: 100 }], tagKinds: 40 }));
    const { container } = await mountPage();
    await vi.waitFor(() => expect(container.querySelector('[data-tag-chips]')?.textContent).toMatch(/정형외과\s*100/));
    expect(container.querySelector('[data-tag-chips]')!.textContent).not.toMatch(/감염주의/);
    expect(container.querySelector('[data-tags-truncated]')?.textContent).toMatch(/40/);
  });

  it('태그가 하나도 없으면 없다고', async () => {
    get.mockImplementation(pageRoute({ tags: [], tagKinds: 0 }));
    const { container } = await mountPage();
    await vi.waitFor(() => expect(container.querySelector('[data-tags-none]')).toBeTruthy());
    expect(screen.queryByText('감염주의')).toBeNull();
  });
});
