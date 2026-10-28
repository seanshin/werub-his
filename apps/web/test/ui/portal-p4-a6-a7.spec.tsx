/**
 * 환자 포털 세련화 P4(2026-10-22 · 기획 `patient-portal-refinement-2026-10.plan.md` A6·A7·A1 잔여).
 *  · A6: 🔴 조회 실패를 "없음"으로 말하지 않는다 — 포털의 모든 useQuery 가 실패를 다룬다(면제는 사유와 함께) ·
 *        `.catch(() => 빈 값)` 으로 실패를 접지 않는다 · 치료 일정 실패 = 실패 안내(빈 일정 문구 없음)
 *  · A7: 🔴 큰 글자 모드에서 포털이 쓰는 고정 px 글자 크기가 전부 함께 커진다(종전 11px·9px 누락 → 크기 역전) ·
 *        아이콘만 있는 버튼에 이름이 있다
 *  · A1 잔여: 로그인 만료 임박 안내 — 능력표 expiresAt 정본 · 모르면·지났으면·멀면 침묵
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(async (_url: string): Promise<unknown> => ({ data: [] })), post: vi.fn(), getToken: () => 'tok-abcdefghijklmnopqrstuvwxyz', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const wrap = (el: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);
beforeEach(() => { cleanup(); api.get.mockReset(); });

const PORTAL = resolve(process.cwd(), 'src/app/portal');
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}
const FILES = walk(PORTAL).map((f) => ({ rel: relative(PORTAL, f), src: readFileSync(f, 'utf8') }));
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

/**
 * 실패를 다루지 않아도 되는 쿼리 — 사유 필수.
 * 키 = `파일:queryKey 첫 원소`.
 */
const QUERY_FAILURE_EXEMPT: Record<string, string> = {
  'page.tsx:portal-waiting-fullscreen':
    '전체화면 대기 버튼 — 같은 대기 현황(portal-waiting)을 홈·진료 탭이 실패와 함께 말한다. 떠 있는 버튼에 실패를 또 띄우면 같은 실패를 두 번 말한다',
};

describe('🔴 A6 — 포털 쿼리는 실패를 다룬다', () => {
  const queries: { key: string; handled: boolean }[] = [];
  for (const { rel, src } of FILES) {
    const code = stripComments(src);
    for (const m of code.matchAll(/const\s+(\{[^}]*\}|\w+)\s*=\s*useQuery\(\{([\s\S]{0,400}?)queryKey:\s*\['([^']+)'/g)) {
      const lhs = m[1];
      const handled = lhs.startsWith('{') ? /\bisError\b/.test(lhs) : new RegExp(`\\b${lhs}\\.(isError|error|status)\\b`).test(code);
      queries.push({ key: `${rel}:${m[3]}`, handled });
    }
  }
  it('대조군 — 스캐너가 포털 쿼리를 실제로 읽는다', () => {
    expect(queries.length).toBeGreaterThan(40);
  });
  it('🔴 실패를 다루지 않는 쿼리 = 면제 목록뿐(사유 필수)', () => {
    const unhandled = queries.filter((q) => !q.handled).map((q) => q.key).sort();
    expect(unhandled).toEqual(Object.keys(QUERY_FAILURE_EXEMPT).sort());
  });
  it('면제 목록에 죽은 항목이 없다', () => {
    const all = new Set(queries.map((q) => q.key));
    expect(Object.keys(QUERY_FAILURE_EXEMPT).filter((k) => !all.has(k))).toEqual([]);
  });
  it('🔴 조회를 `.catch(() => 빈 값)` 으로 접지 않는다(상담 대화 조회가 그랬다)', () => {
    const hits = FILES.flatMap(({ rel, src }) =>
      [...stripComments(src).matchAll(/apiClient\.get[^;]*?\.catch\(\(\)\s*=>\s*(\(\{\s*data:\s*\[\]|\[\]|\{\}|null|\{\s*\})/g)].map(() => rel));
    expect(hits).toEqual([]);
  });
});

describe('🔴 A6 — 실패는 "없음"이 아니다(렌더)', () => {
  it('치료 일정 조회 실패 → 실패 안내 · "예정된 치료 일정이 없습니다" 없음', async () => {
    api.get.mockRejectedValue(new Error('서버 오류'));
    const { default: TreatmentScheduleSegment } = await import('@/app/portal/_care/TreatmentScheduleSegment');
    const v = wrap(<TreatmentScheduleSegment />);
    await waitFor(() => expect(v.container.textContent).toContain('서버 오류'));
    expect(v.container.textContent).not.toContain('예정된 치료 일정이 없습니다');
  });
  it('대조군 — 성공·빈 일정이면 빈 일정 문구', async () => {
    api.get.mockResolvedValue({ data: { items: [] } });
    const { default: TreatmentScheduleSegment } = await import('@/app/portal/_care/TreatmentScheduleSegment');
    const v = wrap(<TreatmentScheduleSegment />);
    await waitFor(() => expect(v.container.textContent).toContain('예정된 치료 일정이 없습니다'));
  });
});

describe('🔴 A7 — 큰 글자 모드가 포털의 고정 px 글자를 전부 키운다', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
  const used = [...new Set(FILES.flatMap(({ src }) => [...src.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]))))].sort((a, b) => a - b);
  const remOf = (mode: 'lg' | 'xl', px: number) => {
    const m = css.match(new RegExp(`\\.portal-font-${mode} \\.text-\\\\\\[${px}px\\\\\\] \\{ font-size: ([0-9.]+)rem; \\}`));
    return m ? Number(m[1]) : null;
  };
  it('대조군 — 포털이 고정 px 글자를 쓴다', () => {
    expect(used.length).toBeGreaterThan(0);
  });
  it('🔴 쓰는 크기마다 두 모드 규칙이 있다', () => {
    const missing = used.flatMap((px) => (['lg', 'xl'] as const).filter((mode) => remOf(mode, px) == null).map((mode) => `${mode}:${px}px`));
    expect(missing).toEqual([]);
  });
  it('🔴 크기 순서가 뒤집히지 않는다(작은 px 가 큰 px 보다 커지지 않는다)', () => {
    for (const mode of ['lg', 'xl'] as const) {
      const rems = used.map((px) => remOf(mode, px)!);
      expect(rems, mode).toEqual([...rems].sort((a, b) => a - b));
    }
  });
});

describe('A7 — 아이콘만 있는 버튼에 이름이 있다', () => {
  it('svg·✕·× 만 담은 버튼은 aria-label·title·sr-only 이름을 가진다', () => {
    const bad: string[] = [];
    for (const { rel, src } of FILES) {
      for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, body] = m;
        if (/aria-label|title=/.test(attrs) || /sr-only/.test(body)) continue;
        const rest = body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<Icon[^>]*\/>/g, '').replace(/\s+/g, '');
        if (rest === '' || ['&times;', '×', '✕'].includes(rest)) bad.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('A1 잔여 — 로그인 만료 임박 안내', () => {
  it('남은 분 — 5분 안만 · 모르면·형식 오류·지났으면 null · 1분 미만은 1분', async () => {
    const { minutesUntilExpiry, SESSION_EXPIRY_NOTICE_MINUTES } = await import('@/app/portal/_auth/SessionExpiryNotice');
    const now = Date.parse('2026-10-22T03:00:00Z');
    expect(minutesUntilExpiry(null, now)).toBeNull();
    expect(minutesUntilExpiry('x', now)).toBeNull();
    expect(minutesUntilExpiry('2026-10-22T02:59:00Z', now)).toBeNull();
    expect(minutesUntilExpiry('2026-10-22T03:00:20Z', now)).toBe(1);
    expect(minutesUntilExpiry('2026-10-22T03:04:30Z', now)).toBe(5);
    expect(minutesUntilExpiry(`2026-10-22T03:${String(SESSION_EXPIRY_NOTICE_MINUTES + 1).padStart(2, '0')}:00Z`, now)).toBeNull();
  });
  async function mount(expiresAt: string | null) {
    api.get.mockResolvedValue({ data: { kind: 'ACCOUNT', features: {}, expiresAt, services: { inpatientLife: false }, onboarding: { scope: 'ACCOUNT', completedAt: null } } });
    const { SessionExpiryNotice } = await import('@/app/portal/_auth/SessionExpiryNotice');
    let v!: ReturnType<typeof render>;
    await act(async () => { v = wrap(<SessionExpiryNotice />); });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/portal/session'));
    return v;
  }
  it('곧 끝나면 남은 분과 함께 말한다', async () => {
    const v = await mount(new Date(Date.now() + 3 * 60_000).toISOString());
    await waitFor(() => expect(v.container.querySelector('[data-portal-session-expiring]')).not.toBeNull());
    expect(v.container.textContent).toContain('로그인이 곧 끝납니다');
  });
  it('🔴 멀거나 모르면 침묵(거짓 경보 없음)', async () => {
    const far = await mount(new Date(Date.now() + 40 * 60_000).toISOString());
    await act(async () => {});
    expect(far.container.querySelector('[data-portal-session-expiring]')).toBeNull();
    cleanup();
    const unknown = await mount(null);
    await act(async () => {});
    expect(unknown.container.querySelector('[data-portal-session-expiring]')).toBeNull();
  });
  it('구조 가드 — 포털 본 화면이 안내를 그린다', () => {
    expect(readFileSync(join(PORTAL, 'page.tsx'), 'utf8')).toMatch(/<SessionExpiryNotice \/>/);
  });
});
