/**
 * 환자 목록 P4(2026-10-20 · `patients-list-refinement-2026-10.plan.md` B6~B9).
 *  - B6 오래된 작성 중 기록 칩 — 서버가 준 수·기준 일수만 · 의사는 할 일함으로 · 🔴 칸이 없으면(권한 밖) 그리지 않는다 · 0 은 침묵
 *  - B7 열 고르기·밀도 — 🔴 저장소가 깨졌거나 막혀도 기본 열 · 필수 열은 숨길 수 없다 · 권한 밖 열은 고를 수도 없다
 *  - B8 키보드 — `/` 검색 · ↓ Enter 차트 · 🔴 입력 중엔 가로채지 않는다
 *  - B9 선택 행 — 라벨 인쇄(원장 미등재 · QR 에 PHI 없음) · CSV 는 반출 권한만 · 고른 id 만 보낸다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaleDraftChip, readListPrefs, patientLabelsQrPayload } from '@/app/(main)/patients/components/ListTools';

const get = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/patients', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useWideScreen', () => ({ useWideScreen: () => false, splitIntoColumns: <T,>(rows: T[]) => [rows] }));
const printSpy = vi.fn();
vi.mock('@/components/print/PrintGuard', () => ({ sanctionedPrint: (...a: unknown[]) => printSpy(...a) }));
let role = 'DOCTOR';
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role, department: '' } }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user: { role } });
  return { useAuthStore };
});

const CAP = { scope: 'ALL', contact: 'MASKED', contactReason: 'RBAC', identity: false, phoneSearch: false, canRegister: false, canImport: false, canMerge: false, canExport: false, canReviewDuplicates: false, canViewQuality: false, narrowing: null, allergyStatus: true, myScope: true, staleDraftDays: 7 };
let cap: Record<string, unknown> = { ...CAP, staleDrafts: 'MINE' };
const rows = [
  { id: 'a', mrn: 'MA', familyName: '김', givenName: '가', dateOfBirth: '1980-01-01', gender: 'MALE', insuranceType: 'NHI', tags: ['내과'], encounterCounts: { signed: 1, drafts: 2 }, staleDrafts: { count: 2, oldestAt: '2026-10-01T00:00:00Z' } },
  { id: 'b', mrn: 'MB', familyName: '이', givenName: '나', dateOfBirth: null, gender: 'FEMALE', insuranceType: 'NHI', tags: [], encounterCounts: { signed: 0, drafts: 0 }, staleDrafts: { count: 0, oldestAt: null } },
];
function route(url: string) {
  if (url === '/api/v1/patients/list-capabilities') return Promise.resolve({ data: cap });
  if (url === '/api/v1/patients') return Promise.resolve({ data: rows, pagination: { total: 2, hasMore: false } });
  if (url === '/api/v1/patients/export') return Promise.resolve({ data: { data: [rows[0]], count: 1, truncated: false, max: 5000 } });
  return Promise.resolve({ data: {} });
}
async function mountPage() {
  const { default: Page } = await import('@/app/(main)/patients/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const ready = async (c: HTMLElement) => vi.waitFor(() => expect(c.querySelector('[data-row-index="1"]')).toBeTruthy());

beforeEach(() => {
  vi.restoreAllMocks(); // 🔴 먼저 — 뒤에 두면 아래 목 구현까지 지운다
  cleanup(); get.mockReset(); get.mockImplementation(route); push.mockReset(); printSpy.mockReset();
  role = 'DOCTOR'; cap = { ...CAP, staleDrafts: 'MINE' };
  try { window.localStorage.clear(); } catch { /* */ }
});

describe('B6 오래된 작성 중 기록 칩', () => {
  it('의사 — 서버 기준 일수·수 · 할 일함 링크 · 카드에서는 링크 아님', () => {
    const { container, rerender } = render(<StaleDraftChip stale={{ count: 3, oldestAt: null }} mode="MINE" days={7} />);
    const a = container.querySelector('a[data-stale-drafts="MINE"]')!;
    expect(a.getAttribute('href')).toBe('/doctor-inbox');
    expect(a.textContent).toMatch(/7.*3/);
    rerender(<StaleDraftChip stale={{ count: 3, oldestAt: null }} mode="MINE" days={7} asLink={false} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-stale-drafts="MINE"]')).toBeTruthy();
  });
  it('관리자 — 수만(링크 없음)', () => {
    const { container } = render(<StaleDraftChip stale={{ count: 1, oldestAt: null }} mode="ALL" days={7} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-stale-drafts="ALL"]')).toBeTruthy();
  });
  it('🔴 칸이 없으면(권한 밖)·범위가 없으면·0 이면 그리지 않는다', () => {
    for (const el of [<StaleDraftChip key="1" stale={undefined} mode="MINE" days={7} />, <StaleDraftChip key="2" stale={{ count: 2, oldestAt: null }} mode={null} days={7} />, <StaleDraftChip key="3" stale={{ count: 0, oldestAt: null }} mode="ALL" days={7} />]) {
      const { container } = render(el);
      expect(container.innerHTML).toBe('');
      cleanup();
    }
  });
  it('목록 — 의사 행에 칩(0 인 행은 없음) · 권한 밖 역할은 없음', async () => {
    const { container } = await mountPage();
    await ready(container);
    expect(container.querySelector('[data-row-index="0"] [data-stale-drafts="MINE"]')).toBeTruthy();
    expect(container.querySelector('[data-row-index="1"] [data-stale-drafts]')).toBeNull();
    cleanup();
    role = 'NURSE'; cap = { ...CAP, staleDrafts: null, myScope: false };
    const r2 = await mountPage();
    await ready(r2.container);
    expect(r2.container.querySelector('[data-stale-drafts]')).toBeNull();
  });
});

describe('B7 열 고르기·밀도', () => {
  it('🔴 저장된 값이 깨졌거나 모르는 열이면 기본값(모르는 키를 지어내지 않는다)', () => {
    expect(readListPrefs('{not json')).toEqual({ hidden: [], density: 'comfortable' });
    expect(readListPrefs(JSON.stringify({ hidden: ['tags', 'mrn', 'x'], density: 'weird' }))).toEqual({ hidden: ['tags'], density: 'comfortable' });
    expect(readListPrefs(null)).toEqual({ hidden: [], density: 'comfortable' });
  });

  it('열을 끄면 머리·칸이 사라지고 저장된다 · 필수 열은 고르는 목록에 없다 · 권한 밖 연락처 열도 없다', async () => {
    const { container } = await mountPage();
    await ready(container);
    expect(screen.getByText('태그')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-column-picker]')!);
    const menu = container.querySelector('[data-column-menu]')!;
    expect(menu.querySelector('[data-column-toggle="phone"]')).toBeNull(); // 연락처 MASKED → 열 없음
    expect(menu.querySelector('[data-column-toggle="mrn"]')).toBeNull();
    fireEvent.click(menu.querySelector('[data-column-toggle="tags"]')!);
    expect(container.querySelector('thead')!.textContent).not.toMatch(/태그/);
    expect(JSON.parse(window.localStorage.getItem('his.patients.listPrefs.v1')!).hidden).toEqual(['tags']);
    fireEvent.click(menu.querySelector('[data-density="compact"]')!);
    expect(container.querySelector('[data-row-index="0"] td:nth-child(2)')!.className).toMatch(/py-1\.5/);
  });

  it('🔴 저장소가 막혀도(읽기·쓰기 예외) 기본 열로 그리고 고를 수 있다', async () => {
    // 사파리 비공개 창·막힌 사이트 데이터 — 접근 자체가 예외(spyOn(Storage.prototype) 는 jsdom 저장소에 닿지 않았다)
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    try {
      const { container } = await mountPage();
      await ready(container);
      expect(container.querySelector('thead')!.textContent).toMatch(/태그/);
      fireEvent.click(container.querySelector('[data-column-picker]')!);
      fireEvent.click(container.querySelector('[data-column-toggle="tags"]')!);
      expect(container.querySelector('thead')!.textContent).not.toMatch(/태그/);
    } finally {
      Object.defineProperty(window, 'localStorage', orig);
    }
  });
});

describe('B8 키보드', () => {
  it('`/` 검색 칸 · ↓↓ Enter 는 두 번째 환자 차트 · ↑ 위로', async () => {
    const { container } = await mountPage();
    await ready(container);
    fireEvent.keyDown(window, { key: '/' });
    const input = container.querySelector('input[aria-keyshortcuts="/"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(container.querySelector('[data-row-index="1"]')!.getAttribute('data-row-active')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/patients/b');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(container.querySelector('[data-row-index="0"]')!.getAttribute('data-row-active')).toBe('true');
  });

  it('🔴 입력 칸에 있을 때는 가로채지 않는다(검색어 속 Enter·화살표)', async () => {
    const { container } = await mountPage();
    await ready(container);
    const input = container.querySelector('input[aria-keyshortcuts="/"]') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector('[data-row-active]')).toBeNull();
  });
});

describe('B9 선택 행 일괄', () => {
  it('고르면 일괄 띠 · 라벨 인쇄본(원장 미등재) · 반출 권한 없으면 CSV 없음', async () => {
    const { container } = await mountPage();
    await ready(container);
    expect(container.querySelector('[data-bulk-bar]')).toBeNull();
    fireEvent.click(container.querySelector('[data-select-row="a"]')!);
    expect(container.querySelector('[data-bulk-bar]')!.textContent).toMatch(/1/);
    expect(container.querySelector('[data-bulk-export]')).toBeNull();
    const doc = document.querySelector('[data-print-doc="PATIENT_LABELS"]')!;
    expect(doc.querySelector('[data-print-label="a"]')).toBeTruthy();
    expect(doc.querySelector('[data-print-unissued="PENDING_D2"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-bulk-labels]')!);
    expect(printSpy).toHaveBeenCalledWith('PATIENT_LABELS');
    fireEvent.click(container.querySelector('[data-bulk-clear]')!);
    expect(container.querySelector('[data-bulk-bar]')).toBeNull();
    expect(document.querySelector('[data-print-doc="PATIENT_LABELS"]')).toBeNull();
  });

  it('🔴 라벨 QR 에 PHI 없음 · 생년월일 모르면 지어내지 않는다', async () => {
    const q = JSON.stringify(patientLabelsQrPayload({ at: '2026-10-20T00:00:00Z', count: 2 }));
    expect(q).not.toMatch(/김|MA|1980/);
    const { container } = await mountPage();
    await ready(container);
    fireEvent.click(container.querySelector('[data-select-page]')!);
    const label = document.querySelector('[data-print-label="b"]')!;
    expect(label.textContent).toMatch(/생년월일 미상/);
    expect(label.textContent).not.toMatch(/만 \d+세/);
  });

  it('반출 권한 — 고른 환자 CSV 는 id 만 보낸다(필터와 섞지 않음)', async () => {
    role = 'ADMIN'; cap = { ...CAP, canExport: true, staleDrafts: 'ALL', myScope: false };
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { container } = await mountPage();
    await ready(container);
    fireEvent.click(container.querySelector('[data-select-row="a"]')!);
    fireEvent.click(container.querySelector('[data-select-row="b"]')!);
    fireEvent.click(container.querySelector('[data-bulk-export]')!);
    await vi.waitFor(() => expect(get.mock.calls.some((c) => c[0] === '/api/v1/patients/export')).toBe(true));
    const params = get.mock.calls.find((c) => c[0] === '/api/v1/patients/export')![1];
    expect(params).toEqual({ ids: 'a,b' });
  });
});
