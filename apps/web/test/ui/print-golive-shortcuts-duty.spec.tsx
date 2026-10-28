/**
 * 인쇄본 — 개시 브리핑·단축키·당직표(2026-10-12 사용자 "나머지 인쇄 화면도 같은 방식으로 정돈").
 *  · 🔴 종전엔 세 화면 모두 인쇄하면 빈 종이(공용 문서 CSS 가 인쇄 루트 없이 body 직계를 숨겼다)
 *  · 인쇄 전용 문서를 body 직하 `.doc-print-root` 에 · 칸은 짧은 사람 글자 · 행별 기계 코드 없음(사용자 결정)
 *  · 확인이 필요한 행은 ☐·서명 칸 + 서명란 · 단축키는 서명란 없음 · 당직표는 가로 A4
 *  · 🔴 못 읽은 것을 빈 것으로 찍지 않는다(결정 등록부 실패·당직표 불러오는 중)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: vi.fn(), getToken: () => 'x' } }));
beforeEach(() => { cleanup(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove()); });
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const root = () => document.body.querySelector(':scope > .doc-print-root');
const HEX8 = /\b[0-9a-f]{8}\b/;
const rowsHaveNoHex = (r: Element) => [...r.querySelectorAll('[data-print-row]')].forEach((x) => expect(x.textContent).not.toMatch(HEX8));

const ROLLUP = {
  readiness: { computable: true, pct: 50, total: 4, ready: 2, verifiedReady: 1, selfReportedReady: 1, basis: '' },
  blockingTotal: 3, blockingReady: 1, overdueCount: 1, canGoLive: false,
  items: [
    { key: 'gl.cert', title: '전자서명 인증서', area: 'a', areaLabel: 'a', type: 'EXTERNAL', owner: '정보팀', status: 'TODO', isBlocking: true, overdue: true },
    { key: 'gl.gate', title: '안전 게이트', area: 'a', areaLabel: 'a', type: 'CONFIG_GATE', owner: null, status: 'TODO', isBlocking: true },
    { key: 'gl.done', title: '끝난 것', area: 'a', areaLabel: 'a', type: 'MANUAL', owner: '원무', status: 'DONE', isBlocking: true },
  ],
};
const DEC = (key: string, decided: boolean, seeded: boolean) => ({ key, title: `결정 ${key}`, goLive: 'REQUIRED_BEFORE', decided, seeded, authority: '원장', record: null, blockedBy: [] });

describe('개시 브리핑 인쇄본', () => {
  it('🔴 인쇄 루트 · 준비도 두 근거 · 막는 항목·외부·필수 결정 표 · ☐ 확인 · 서명란 · 행별 코드 없음', async () => {
    const { GoLivePrint } = await import('@/components/print/GoLivePrint');
    render(<GoLivePrint rollup={ROLLUP as never} decisions={[DEC('d.real', true, false), DEC('d.seed', false, true), DEC('d.open', false, false)] as never} decError={false} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc="GOLIVE"]')).toBeTruthy());
    const r = root()!;
    expect(r.querySelector('[data-print-readiness]')!.textContent).toContain('1 / 4');
    expect([...r.querySelectorAll('[data-print-blocking] [data-print-row]')].map((x) => x.getAttribute('data-print-row'))).toEqual(['gl.gate', 'gl.cert']);
    expect(r.querySelector('[data-print-external] [data-print-row="gl.cert"]')).toBeTruthy();
    expect([...r.querySelectorAll('[data-print-decisions] [data-print-row]')].map((x) => x.getAttribute('data-print-state'))).toEqual(['REAL', 'SEED', 'OPEN']);
    for (const x of r.querySelectorAll('[data-print-blocking] [data-print-row], [data-print-decisions] [data-print-row]')) expect(x.querySelector('[data-print-check]')!.textContent).toContain('☐');
    expect(r.querySelector('[data-print-signoff]')).toBeTruthy();
    rowsHaveNoHex(r);
  });
  it('🔴 결정 등록부 조회 실패는 "없음"이 아니라 실패로 찍는다', async () => {
    const { GoLivePrint } = await import('@/components/print/GoLivePrint');
    render(<GoLivePrint rollup={ROLLUP as never} decisions={undefined} decError />);
    await waitFor(() => expect(root()?.querySelector('[data-print-dec-error]')).toBeTruthy());
    expect(root()!.querySelector('[data-print-decisions]')).toBeNull();
  });
});

describe('단축키 인쇄본', () => {
  it('한 표 · 섹션 그룹 행 · 서명란 없음', async () => {
    const { ShortcutsPrint } = await import('@/components/print/ShortcutsPrint');
    render(<ShortcutsPrint globalKeys={[['g', '화면번호 입력칸 포커스(지정 가능)']]} actionKeys={[['⌘ Enter', '확정/저장(접수·수납 등)']]} role="NURSE" who="간호부 홍길동"
      grouped={[['진료', [{ code: '1001', href: '/a', label: '외래', section: '진료', roles: [] }, { code: '1002', href: '/b', label: '입원', section: '진료', roles: [] }]], ['간호', [{ code: '1101', href: '/c', label: '간호 스테이션', section: '간호', roles: [] }]]]} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc="SHORTCUTS"]')).toBeTruthy());
    const r = root()!;
    expect(r.querySelectorAll('[data-print-screens]').length).toBe(1);
    expect([...r.querySelectorAll('[data-print-screens] [data-print-group]')].map((x) => x.getAttribute('data-print-group'))).toEqual(['진료', '간호']);
    expect(r.querySelectorAll('[data-print-screens] [data-print-row]').length).toBe(3);
    expect(r.querySelector('[data-print-keys="GLOBAL"] [data-print-row="g"]')).toBeTruthy();
    expect(r.querySelector('[data-print-signoff]')).toBeNull();
    rowsHaveNoHex(r);
  });
});

describe('당직표 인쇄본', () => {
  const DAYS = [
    { date: '2026-10-02', dayOfWeek: '금', shifts: [{ id: 's3', shift: 'NIGHT', staffName: '박간호' }], leaves: [], understaffed: [{ shift: 'DAY', required: 2, actual: 1 }] },
    { date: '2026-10-01', dayOfWeek: '목', shifts: [{ id: 's1', shift: 'DAY', staffName: '김간호' }, { id: 's2', shift: 'DAY', staffName: '이간호' }], leaves: [{ userId: 'u', name: '최간호', type: 'ANNUAL' }], understaffed: [{ shift: 'NIGHT', required: 1, actual: 1 }] },
  ];
  it('🔴 가로 A4 · 날짜순 · 근무별 이름 · 휴가 · 미달만 짧게 · ☐ · 서명란', async () => {
    const { DutyRosterPrint } = await import('@/components/print/DutyRosterPrint');
    render(<DutyRosterPrint month="2026-10" department="간호부" days={DAYS} loading={false} leaveLabel={{ ANNUAL: '연차' }} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc="DUTY"]')).toBeTruthy());
    const r = root()!;
    expect(r.querySelector('[data-print-doc="DUTY"]')!.className).toContain('dps-land');
    expect([...r.querySelectorAll('[data-print-roster] [data-print-row]')].map((x) => x.getAttribute('data-print-row'))).toEqual(['2026-10-01', '2026-10-02']);
    const d1 = r.querySelector('[data-print-row="2026-10-01"]')!;
    expect(d1.querySelector('[data-print-shift="DAY"]')!.textContent).toBe('김간호, 이간호');
    expect(d1.textContent).toContain('최간호(연차)');
    expect(d1.querySelector('[data-print-under]')!.textContent).toBe('—'); // 충족(1/1)은 미달 아님
    expect(r.querySelector('[data-print-row="2026-10-02"] [data-print-under]')!.textContent).toBe('D 1/2');
    expect(d1.querySelector('[data-print-check]')!.textContent).toContain('☐');
    expect(r.querySelector('[data-print-signoff]')).toBeTruthy();
    rowsHaveNoHex(r);
  });
  it('🔴 불러오는 중이면 빈 표가 아니라 그렇게 찍는다', async () => {
    const { DutyRosterPrint } = await import('@/components/print/DutyRosterPrint');
    render(<DutyRosterPrint month="2026-10" department="전체" days={[]} loading leaveLabel={{}} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-loading]')).toBeTruthy());
    expect(root()!.querySelector('[data-print-roster]')).toBeNull();
    expect(root()!.querySelector('[data-print-empty]')).toBeNull();
  });
});

describe('화면 배선', () => {
  it('세 화면이 인쇄본을 그린다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = (p: string) => readFileSync(join(__dirname, '../../src', p), 'utf8');
    expect(src('components/golive/GoLiveBriefing.tsx')).toMatch(/<GoLivePrint rollup=\{rollup\}/);
    expect(src('app/(main)/settings/shortcuts/page.tsx')).toMatch(/<ShortcutsPrint /);
    expect(src('app/(main)/admin/duty-schedule/page.tsx')).toMatch(/<DutyRosterPrint month=\{monthStr\}/);
  });
});
