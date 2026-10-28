/**
 * 결정 인쇄본 발급 후 인쇄 · 진위확인 화면(2026-10-12 기획 `decision-print-remaining` P0).
 *  · 🔴 종전 QR·sha256 은 브라우저가 계산하고 어디에도 남지 않았다 → 인쇄 = 서버 발급 → QR = 진위확인 주소(확인 코드)
 *  · 🔴 발급 실패·화면 해시 ≠ 서버 해시면 인쇄하지 않는다 · 미발급 미리보기는 워터마크·QR 없음
 *  · 진위확인: 확인 코드 불일치는 "기록 없음"과 다른 사유 · 직원 대조 3상태(🔴 비교 불가 ≠ 일치) · 종류 라벨 정본
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), getToken: vi.fn(() => 'x' as string | null) }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
const printed = vi.hoisted(() => vi.fn());
vi.mock('@/components/print/PrintGuard', () => ({ sanctionedPrint: printed }));
const qrSpy = vi.hoisted(() => ({ values: [] as string[] }));
vi.mock('@/components/ui/QrImage', async (orig) => {
  const m = await orig<{ qrDataUrl: (v: string, w?: number, mg?: number) => Promise<string | null> }>();
  return { ...m, qrDataUrl: (v: string, w?: number, mg?: number) => { qrSpy.values.push(v); return m.qrDataUrl(v, w, mg); } };
});
vi.mock('next/navigation', () => ({ useParams: () => ({ issueNo: 'WRB-DECISION_REGISTER-20261012-0001' }), usePathname: () => '/' }));

beforeEach(() => {
  cleanup(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove());
  printed.mockReset(); api.get.mockReset(); api.post.mockReset(); api.getToken.mockReturnValue('x'); qrSpy.values.length = 0;
});

const base = {
  mechanism: 'CONFIRM_ONLY', settings: [], why: '이유', legalReview: [], approvalPath: 'AUTHORIZED_ROLE', authority: '원장', statusQuo: '현행', goLive: 'CAN_FOLLOW',
  owner: '팀', dueBy: 'NONE', currentConfigValue: null, pendingAttachments: [], unlocks: [], blockedBy: [], readyToDecide: false, agenda: null, stage: null, committee: null,
  enactment: { state: 'UNDECIDED', label: '미결', detail: null, actions: [] }, needsReview: [], governedConfig: [],
  options: [{ value: 'OFF', label: '끔', effect: '끈다' }, { value: 'ON', label: '켬', effect: '켠다' }],
};
const ITEMS = [
  { ...base, key: 'policy.patientPush.enable', title: '알림', layer: 'INTERNAL_COMMITTEE', track: 'NOTIFY', domain: 'OPERATIONS', decided: true, seeded: false, record: { choice: 'ON', decidedAt: '2026-10-01T00:00:00.000Z' } },
  { ...base, key: 'auth.staffIdleTimeout', title: '유휴 만료', layer: 'INTERNAL_COMMITTEE', track: 'SECURITY', domain: 'SECURITY', decided: false, seeded: false, record: null },
] as never[];
const LINES = ['policy.patientPush.enable|REAL|ON|2026-10-01T00:00:00.000Z', 'auth.staffIdleTimeout|OPEN||'];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const NO = 'WRB-DECISION_REGISTER-20261012-0001';
const URL_ = `https://his.example/verify/document/${NO}?v=ABCDEFGHJK`;
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const root = () => document.body.querySelector(':scope > .doc-print-root')!;

async function harness() {
  const { DecisionRegisterPrint, registerLines } = await import('@/app/(main)/admin/decisions/print-sheet');
  const { usePrintIssue } = await import('@/components/print/usePrintIssue');
  function H() {
    const pr = usePrintIssue('DECISION_REGISTER', {}, registerLines(ITEMS), () => {});
    return <><button onClick={() => void pr.start()}>go</button>{pr.bar}<DecisionRegisterPrint items={ITEMS} measuredAt="2026-10-12T00:00:00.000Z" {...pr.state} /></>;
  }
  render(<H />);
  fireEvent.click(screen.getByText('go'));
}

describe('발급 후 인쇄', () => {
  it('화면 줄 = shared 정본(서버와 같은 함수)', async () => {
    const { registerLines } = await import('@/app/(main)/admin/decisions/print-sheet');
    expect(registerLines(ITEMS)).toEqual(LINES);
  });
  it('🔴 발급 성공 → 본문은 종류뿐 · QR = 진위확인 주소 · 쪽 글자 = 발급번호 · 감사 detail 에 발급번호 · 그 뒤 인쇄', async () => {
    api.post.mockResolvedValue({ data: { issueNo: NO, hash: sha(LINES.join('\n')), verifyUrl: URL_, issuedAt: '2026-10-12T01:00:00Z', lines: 2 } });
    await harness();
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/print-issue', { kind: 'DECISION_REGISTER' });
    expect(printed.mock.calls[0][0]).toBe(`issue:${NO} type:DECISION_REGISTER sha:${sha(LINES.join('\n')).slice(0, 16)}`);
    expect(qrSpy.values).toContain(URL_);
    const css = root().querySelector('style[data-print-page-qr]')!;
    expect(css.getAttribute('data-print-page-qr')).toBe('ready');
    expect(css.textContent).toContain(`${NO} · sha256 ${sha(LINES.join('\n')).slice(0, 16)}`);
    expect(root().querySelector('[data-print-issue-no]')!.textContent).toContain(NO);
  });
  it('🔴 화면 해시 ≠ 서버 해시(원장이 그 사이 바뀜) → 인쇄하지 않는다 · 새로 불러오기', async () => {
    api.post.mockResolvedValue({ data: { issueNo: NO, hash: 'f'.repeat(64), verifyUrl: URL_, issuedAt: 'x', lines: 2 } });
    await harness();
    await waitFor(() => expect(screen.getByText('새로 불러오기')).toBeTruthy());
    expect(printed).not.toHaveBeenCalled();
    expect(root().querySelector('[data-print-issue-no]')).toBeNull();
  });
  it('🔴 발급 실패 → 인쇄하지 않는다 · 미발급 미리보기는 QR 없음·워터마크·감사 unissued', async () => {
    api.post.mockRejectedValue(new Error('boom'));
    await harness();
    await waitFor(() => expect(document.querySelector('[data-print-unissued]')).toBeTruthy());
    expect(printed).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('button[data-print-unissued]')!);
    await waitFor(() => expect(printed).toHaveBeenCalledWith('unissued:DECISION_REGISTER'));
    const css = root().querySelector('style[data-print-page-qr]')!;
    expect(css.getAttribute('data-print-page-qr')).toBe('none');
    expect(css.textContent).not.toContain('url(data:');
    expect(root().querySelector('p[data-print-unissued]')!.textContent).toContain('미발급');
  });
  it('권한 밖(403) — 발급 권한이 없다고 말한다(실패를 다른 사유로 말하지 않는다)', async () => {
    const { ApiError } = await import('@/lib/api-client');
    api.post.mockRejectedValue(new ApiError('ERR_FORBIDDEN', 'Insufficient permissions'));
    await harness();
    await waitFor(() => expect(document.body.textContent).toContain('발급 권한이 없습니다'));
    expect(printed).not.toHaveBeenCalled();
  });
  it('구조 — 결정 대장·의사결정서 화면은 직접 인쇄하지 않고 발급 훅을 지난다', () => {
    for (const f of ['register/page.tsx', '[key]/page.tsx']) {
      const src = readFileSync(join(__dirname, '../../src/app/(main)/admin/decisions', f), 'utf8');
      expect(src, f).toContain('usePrintIssue(');
      expect(src, f).not.toContain('sanctionedPrint');
    }
  });
});

describe('진위확인 화면', () => {
  const mockFetch = (data: unknown) => { globalThis.fetch = vi.fn(async () => ({ json: async () => ({ data }) })) as never; };
  const page = async () => { const { default: P } = await import('@/app/verify/document/[issueNo]/page'); render(<P />); };

  it('🔴 QR 주소의 확인 코드를 함께 보낸다 · 확인 코드 불일치는 "기록 없음"과 다른 사유', async () => {
    window.history.pushState({}, '', `/verify/document/${NO}?v=ABCDEFGHJK`);
    mockFetch({ valid: false, issueNo: NO, reason: 'CHECK_CODE', message: '확인 코드 불일치' });
    await page();
    await waitFor(() => expect(document.querySelector('[data-verify-reason="CHECK_CODE"]')).toBeTruthy());
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(`/api/v1/documents/verify/${NO}?v=ABCDEFGHJK`);
    expect(document.body.textContent).toContain('확인 코드가 맞지 않습니다');
    expect(document.body.textContent).not.toContain('발급 기록을 찾을 수 없습니다');
  });
  it('종류 라벨 정본 — 결정 대장 · 로그인 없으면 대조 EP 를 부르지 않는다', async () => {
    api.getToken.mockReturnValue(null);
    mockFetch({ valid: true, issueNo: NO, documentType: 'DECISION_REGISTER', issuedAt: '2026-10-12T01:00:00Z', status: 'ORIGINAL', hospital: '가상병원' });
    await page();
    await waitFor(() => expect(document.querySelector('[data-verify-compare="NONE"]')).toBeTruthy());
    expect(document.body.textContent).toContain('결정 대장');
    expect(api.get).not.toHaveBeenCalled();
  });
  it('🔴 대조 실패 → 비교 불가(일치로 접지 않는다)', async () => {
    mockFetch({ valid: true, issueNo: NO, documentType: 'DECISION_REGISTER', issuedAt: '2026-10-12T01:00:00Z', status: 'ORIGINAL' });
    api.get.mockRejectedValue({ code: 'ERR_INTERNAL' });
    await page();
    await waitFor(() => expect(document.querySelector('[data-verify-compare="UNAVAILABLE"]')).toBeTruthy());
    expect(document.body.textContent).not.toContain('일치합니다');
  });
  it('직원 대조 — 이 판 이후 N건 바뀜(결정 줄·근무 줄 · 이전 → 지금) · 그 판은 무효가 아니라고 말한다', async () => {
    mockFetch({ valid: true, issueNo: NO, documentType: 'DECISION_REGISTER', issuedAt: '2026-10-12T01:00:00Z', status: 'ORIGINAL' });
    api.get.mockResolvedValue({ data: { issuedBy: '김관리', hash: 'a'.repeat(64), hashIntact: true, measuredAt: '2026-10-12T01:00:00Z', lines: 2,
      compare: { state: 'CHANGED', changed: [{ key: 'auth.staffIdleTimeout', before: 'auth.staffIdleTimeout|OPEN||', after: 'auth.staffIdleTimeout|REAL|ON|t' }, { key: 'S:e1', before: 'S:e1|2026-10-01|DAY|김간호', after: null }] } } });
    await page();
    await waitFor(() => expect(document.querySelector('[data-verify-compare="CHANGED"]')).toBeTruthy());
    expect(document.body.textContent).toContain('이 판 이후 2건 바뀜');
    expect(document.body.textContent).toContain('미결 → 실결정 · ON');
    expect(document.body.textContent).toContain('2026-10-01 · DAY · 김간호 → 없음');
    expect(api.get).toHaveBeenCalledWith(`/api/v1/print-issue/${NO}/compare`);
    expect(document.body.textContent).toContain('발급 시점의 진본');
  });
  it('대조군 — 기존 종류(진단서)는 대조하지 않고 라벨 정본 · 모르는 종류는 코드와 함께 말한다', async () => {
    mockFetch({ valid: true, issueNo: 'WRB-DEATH_CERT-20261012-0001', documentType: 'DEATH_CERT', issuedAt: '2026-10-12T01:00:00Z', status: 'ORIGINAL' });
    await page();
    await waitFor(() => expect(document.body.textContent).toContain('사망진단서'));
    expect(document.querySelector('[data-verify-compare]')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    cleanup();
    mockFetch({ valid: true, issueNo: 'x', documentType: 'FOO_DOC', issuedAt: '2026-10-12T01:00:00Z', status: 'ORIGINAL' });
    await page();
    await waitFor(() => expect(document.body.textContent).toContain('FOO_DOC (등록되지 않은 종류)'));
  });
});
