/**
 * 초진 동의 수집 화면(2026-10-02) — 태블릿 · 환자 휴대폰(전자동의) · 종이(출력 → 스캔 등록).
 *  · 🔴 초진 등록에 직원 체크박스가 있었고 서버가 그것을 "환자 서명"으로 기록했다 → 체크박스 제거 · 등록 직후 수집
 *  · 현황은 원장 그대로 — 직원 입력(HIS)은 "서명 증빙 없음"
 *  · 종이: 스캔본 없이는 기록 버튼이 막힌다 · 출력은 인증해서 그 환자 것으로(종전 `/patients/new/...` 를 인증 없이 열던 버튼)
 *  · 휴대폰: URL 은 이 화면 오리진 + 서버 경로(서버가 호스트를 지어내지 않는다)
 *  · 서명 화면: 묶음이면 항목마다 동의·미동의 — 다 고르기 전엔 제출 불가 · 선택을 서버로 보낸다
 * 재주입: 스캔 게이트를 빼면 · 체크박스를 되살리면 · 선택을 안 보내면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
const postForm = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), postForm: (...a: unknown[]) => postForm(...a), getToken: () => 'tok' } }));
vi.mock('@/components/ui/QrImage', () => ({ QrImage: ({ value }: { value: string }) => <img data-qr={value} alt="qr" /> }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const P = '00000000-0000-4000-a000-000000d00001';
const TYPES = ['PRIVACY', 'SENSITIVE', 'UNIQUE_ID', 'THIRD_PARTY', 'TREATMENT', 'HIE', 'MARKETING', 'RESEARCH', 'EMR_VIEW', 'TELEHEALTH'];
const row = (type: string, over: Record<string, unknown> = {}) => ({
  type, label: `라벨-${type}`, required: TYPES.indexOf(type) < 6, law: '법', agreed: false, signedAt: null, signedBy: null, signMethod: null,
  evidenceConsentFormId: null, expired: false, consentId: null, ...over,
});
const status = (scans: number, rows = TYPES.map((t) => row(t))) => ({ consents: rows, requiredComplete: false, openPackage: scans ? { id: 'cf-1', createdAt: '2026-10-02T00:00:00Z', scans } : null });

beforeEach(() => { get.mockReset(); post.mockReset(); postForm.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('수집 부품', () => {
  it('🔴 현황 — 직원 입력(HIS)은 "서명 증빙 없음" · 미수집은 미수집', async () => {
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [] } : { data: status(0, [row('PRIVACY', { agreed: true, signMethod: 'HIS' }), row('SENSITIVE')]) }));
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<RegistrationConsentCollector patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-rc-row="PRIVACY"]')).not.toBeNull());
    expect(container.querySelector('[data-rc-row="PRIVACY"]')!.textContent).toContain('직원 입력(서명 증빙 없음)');
    expect(container.querySelector('[data-rc-row="SENSITIVE"]')!.textContent).toContain('미수집');
    expect(get.mock.calls.map((c) => c[0])).toContain(`/api/v1/patients/${P}/registration-consents/collect`);
  });

  it('태블릿 — 승인 기기가 없으면 그 사실과 다른 방법을 말한다 · 있으면 보내기', async () => {
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [] } : { data: status(0) }));
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const r1 = wrap(<RegistrationConsentCollector patientId={P} />);
    await waitFor(() => expect(r1.container.querySelector('[data-rc-no-device]')).not.toBeNull());
    cleanup();
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [{ id: 'd1', name: '원무 태블릿', location: '1층', status: 'IDLE', online: true }] } : { data: status(0) }));
    post.mockResolvedValue({ data: { consentId: 'cf-1', dispatched: true } });
    const r2 = wrap(<RegistrationConsentCollector patientId={P} />);
    await waitFor(() => expect(r2.container.querySelector('select')).not.toBeNull());
    fireEvent.change(r2.container.querySelector('select')!, { target: { value: 'd1' } });
    fireEvent.click(r2.container.querySelector('[data-rc-send-tablet]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/v1/patients/${P}/registration-consents/collect/tablet`, { deviceId: 'd1' }));
  });

  it('휴대폰 — QR 은 이 화면 오리진 + 서버가 준 경로', async () => {
    get.mockImplementation(async () => ({ data: status(0) }));
    post.mockResolvedValue({ data: { path: '/consent-sign/abc123', expiresAt: '2026-10-02T09:15:00Z' } });
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<RegistrationConsentCollector patientId={P} />);
    fireEvent.click(container.querySelector('[data-rc-method="mobile"]')!);
    fireEvent.click(container.querySelector('[data-rc-issue-link]')!);
    await waitFor(() => expect(container.querySelector('[data-qr]')).not.toBeNull());
    expect(container.querySelector('[data-qr]')!.getAttribute('data-qr')).toBe(`${window.location.origin}/consent-sign/abc123`);
  });

  it('🔴 종이 — 스캔본이 없으면 기록 버튼이 막힌다 · 있으면 모든 항목을 고른 뒤 기록', async () => {
    get.mockImplementation(async () => ({ data: status(0) }));
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const r1 = wrap(<RegistrationConsentCollector patientId={P} />);
    fireEvent.click(r1.container.querySelector('[data-rc-method="paper"]')!);
    // 스캔 수 0 은 조회 전 기본값과 같은 모양 — 항목이 그려진 뒤(조회 완료)를 기다린다
    await waitFor(() => expect(r1.container.querySelectorAll('[data-rc-choice]').length).toBe(TYPES.length));
    expect(r1.container.querySelector('[data-rc-scans]')?.getAttribute('data-rc-scans')).toBe('0');
    // 🔴 다른 이유(미선택·서명자 없음)로 막힌 것을 통과로 읽지 않게 — 항목·서명자를 다 채우고도 막혀야 한다
    for (const t of TYPES) fireEvent.click(r1.container.querySelector(`[data-rc-choice="${t}"]`)!.querySelectorAll('button')[0]);
    fireEvent.change(r1.container.querySelector('input[placeholder]')!, { target: { value: '홍길동' } });
    expect((r1.container.querySelector('[data-rc-save-paper]') as HTMLButtonElement).disabled).toBe(true);
    expect(r1.container.textContent).toContain('스캔본을 먼저 등록해야');
    cleanup();

    get.mockImplementation(async () => ({ data: status(1) }));
    post.mockResolvedValue({ data: { recorded: 10 } });
    const r2 = wrap(<RegistrationConsentCollector patientId={P} />);
    fireEvent.click(r2.container.querySelector('[data-rc-method="paper"]')!);
    await waitFor(() => expect(r2.container.querySelector('[data-rc-scans]')?.getAttribute('data-rc-scans')).toBe('1'));
    for (const t of TYPES) fireEvent.click(r2.container.querySelector(`[data-rc-choice="${t}"]`)!.querySelectorAll('button')[t === 'MARKETING' ? 1 : 0]);
    fireEvent.change(r2.container.querySelector('input[placeholder]')!, { target: { value: '홍길동' } });
    const btn = r2.container.querySelector('[data-rc-save-paper]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe(`/api/v1/patients/${P}/registration-consents/collect/paper`);
    expect(body.choices.MARKETING).toBe(false);
    expect(body.choices.PRIVACY).toBe(true);
  });

  it('🔴 출력 — 인증해서 그 환자 것을 받는다(환자 ID 자리에 new 를 넣던 버튼이 아니다)', async () => {
    get.mockImplementation(async () => ({ data: status(0) }));
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '<html></html>' }));
    vi.stubGlobal('fetch', fetchMock);
    const w = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => w));
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<RegistrationConsentCollector patientId={P} />);
    fireEvent.click(container.querySelector('[data-rc-method="paper"]')!);
    fireEvent.click(container.querySelector('[data-rc-print]')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [u, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(u).toBe(`/api/v1/patients/${P}/registration-consents/print`);
    expect(init.headers.Authorization).toBe('Bearer tok');
    await waitFor(() => expect(w.print).toHaveBeenCalled());
  });
});

describe('서명 화면 — 초진 동의 묶음', () => {
  it('🔴 항목마다 동의·미동의 — 다 고르기 전엔 제출 불가 · 선택을 보낸다', async () => {
    const items = TYPES.map((t, i) => ({ type: t, label: `항목-${t}`, required: i < 6, law: '법', detail: `전문-${t}` }));
    const fetchMock = vi.fn(async (u: string, init?: { body?: string }) => {
      if (!init) return { ok: true, json: async () => ({ data: { session: { signMode: 'MOBILE', signerType: 'PATIENT' }, registrationItems: items, consent: { id: 'cf-1', templateName: '초진 등록 동의서(10종)', type: 'REGISTRATION', patient: { familyName: '홍', givenName: '길동', mrn: 'M1' } } } }) };
      return { ok: true, json: async () => ({ data: { signed: true, registration: { requiredComplete: true, missingRequired: [] } } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('@/components/signature/SignaturePad', async () => {
      const React = await import('react');
      return { SignaturePad: React.forwardRef((p: { onChange: (e: boolean) => void }, ref) => { React.useImperativeHandle(ref, () => ({ toDataURL: () => 'data:image/png;base64,AAA' })); React.useEffect(() => { p.onChange(false); }, []); return <div data-pad />; }) };
    });
    const { ConsentSignView } = await import('@/components/signature/ConsentSignView');
    const { container } = render(<ConsentSignView token="abc" />);
    await waitFor(() => expect(container.querySelector('[data-registration-items]')).not.toBeNull());
    fireEvent.click(screen.getByRole('checkbox'));
    const submit = screen.getByText('선택한 대로 서명 제출') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    for (const t of TYPES) fireEvent.click(container.querySelector(`[data-reg-item="${t}"]`)!.querySelectorAll('[aria-pressed]')[t === 'RESEARCH' ? 1 : 0]);
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(body.choices.RESEARCH).toBe(false);
    expect(body.choices.PRIVACY).toBe(true);
    expect(Object.keys(body.choices)).toHaveLength(10);
    vi.doUnmock('@/components/signature/SignaturePad');
  });
});

describe('초진 등록 화면', () => {
  it('🔴 직원 동의 체크박스가 없다 · 등록 직후 수집 부품으로 간다', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/patients/new/page.tsx'), 'utf8');
    expect(src).not.toMatch(/consentPrivacy/);
    expect(src).not.toMatch(/registration-consents\/print/);
    expect(src).toMatch(/<RegistrationConsentCollector patientId=\{created\.id\} \/>/);
  });
});
