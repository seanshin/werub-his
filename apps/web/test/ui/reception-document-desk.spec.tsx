/**
 * 원무 창구 서류 접수(2026-10-10 사용자 결정 — 접수·대기 목록만).
 *  · 🔴 원무 계정이면 의무기록 처리 화면을 그리지 않고 상세·리포트 EP 를 부르지 않는다
 *  · 쓰기 폼은 미선택 시작 — 환자·서류·신청 자격을 고르기 전엔 접수 불가
 *  · 대기 목록이 잘리면 잘렸다고 말한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/components/ui/PatientSelector', () => ({ default: ({ onChange }: { onChange: (id: string) => void }) => <button type="button" data-pick-patient onClick={() => onChange('p1')}>pick</button> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/workstation/documents', useSearchParams: () => new URLSearchParams() }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => {
  cleanup(); get.mockReset(); post.mockReset();
  get.mockImplementation(async () => ({ data: { items: [{ id: 'r1', type: 'DIAGNOSIS_CERT', status: 'REQUESTED', copies: 1, createdAt: '2026-10-10T00:00:00Z', slaDueAt: null, patient: { mrn: 'M1', name: '김가' } }], stats: { REQUESTED: 101 }, total: 101, truncated: true } }));
  post.mockResolvedValue({ data: {
    id: 'new', type: 'DIAGNOSIS_CERT', copies: 1, fee: 20000, deliveryMethod: 'VISIT', deliveryDestination: null, slaDueAt: '2026-10-13T00:00:00Z',
    createdAt: '2026-10-10T01:00:00Z', legalBasis: 'SELF', proxyVerifyStatus: 'NONE', patient: { mrn: 'M1', name: '김가' }, receipt: { number: 'ABCD1234', feeIsEstimate: true },
  } });
});

async function mount(role: string) {
  useAuthStore.setState({ user: { id: 'u1', role, familyName: '박', givenName: '원무' } as never, isAuthenticated: true });
  const { default: Page } = await import('@/app/(main)/workstation/documents/page');
  return render(<Page />, { wrapper: wrap });
}

describe('원무 창구', () => {
  it('🔴 원무면 접수·대기 목록만 — 큐 외 EP 를 부르지 않는다 · 잘림 고지', async () => {
    const { container } = await mount('RECEPTIONIST');
    expect(container.querySelector('[data-reception-doc-desk]')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('[data-reception-doc-row="r1"]')).not.toBeNull());
    expect(container.querySelector('[data-reception-doc-truncated]')).not.toBeNull();
    const urls = get.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/staff/document-requests'));
    // 대기 목록(?status=)만 — 상세(/:id)·초안·리포트·발급 대장은 부르지 않는다
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('/api/v1/staff/document-requests?status='))).toBe(true);
  });
  it('🔴 미선택 시작 — 환자·서류·신청 자격을 다 골라야 접수', async () => {
    const { container } = await mount('RECEPTIONIST');
    const btn = () => container.querySelector('[data-reception-doc-submit]') as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-pick-patient]')!);
    fireEvent.change(container.querySelector('[data-reception-doc-type]')!, { target: { value: 'DIAGNOSIS_CERT' } });
    expect(btn().disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-reception-doc-basis]')!, { target: { value: 'SELF' } });
    // 수령 방법도 골라야(2026-10-10) — 종전엔 말없이 '방문'으로 들어갔다
    expect(btn().disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-reception-doc-delivery]')!, { target: { value: 'VISIT' } });
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/staff/document-requests', expect.objectContaining({ patientId: 'p1', type: 'DIAGNOSIS_CERT', legalBasis: 'SELF', copies: 1, deliveryMethod: 'VISIT' })));
  });
  it('대조군 — 간호사는 종전 처리 화면', async () => {
    const { container } = await mount('NURSE');
    expect(container.querySelector('[data-reception-doc-desk]')).toBeNull();
  });
});

describe('창구 접수 확장(2026-10-10)', () => {
  it('🔴 우편은 주소·팩스는 번호가 있어야 접수 · 남은 칸을 말한다', async () => {
    const { intakeBlockers } = await import('@/app/(main)/workstation/documents/ReceptionDocumentDesk');
    const f = { patientId: 'p1', type: 'OPINION', legalBasis: 'SELF', deliveryMethod: 'MAIL', destination: '', copies: '1' };
    expect(intakeBlockers(f)).toEqual(['우편 주소']);
    expect(intakeBlockers({ ...f, deliveryMethod: 'FAX', destination: '팩스' })).toEqual(['팩스 번호']);
    expect(intakeBlockers({ ...f, deliveryMethod: 'FAX', destination: '02-000-1001' })).toEqual([]);
    expect(intakeBlockers({ ...f, copies: '11' })).toEqual(['우편 주소', '부수(1~10)']);
    expect(intakeBlockers({ patientId: '', type: '', legalBasis: '', deliveryMethod: '', destination: '', copies: '1' })).toEqual(['대상 환자', '서류 종류', '신청 자격', '수령 방법']);
  });
  it('대리 신청이면 대면 확인 칸 · 확인 안 하면 그렇게 남는다고 말하고 그대로 보낸다', async () => {
    const { container } = await mount('RECEPTIONIST');
    fireEvent.click(container.querySelector('[data-pick-patient]')!);
    fireEvent.change(container.querySelector('[data-reception-doc-type]')!, { target: { value: 'DIAGNOSIS_CERT' } });
    expect(container.querySelector('[data-reception-doc-identity]')).toBeNull();
    fireEvent.change(container.querySelector('[data-reception-doc-basis]')!, { target: { value: 'DELEGATED' } });
    expect(container.querySelector('[data-reception-doc-identity]')).not.toBeNull();
    expect(container.querySelector('[data-reception-doc-identity-pending]')).not.toBeNull();
    fireEvent.change(container.querySelector('[data-reception-doc-delivery]')!, { target: { value: 'VISIT' } });
    fireEvent.click(container.querySelector('[data-reception-doc-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/staff/document-requests', expect.objectContaining({ legalBasis: 'DELEGATED', identityChecked: false })));
  });
  it('접수하면 접수증(접수번호·견적 고지)과 인쇄 버튼', async () => {
    const { container } = await mount('RECEPTIONIST');
    fireEvent.click(container.querySelector('[data-pick-patient]')!);
    fireEvent.change(container.querySelector('[data-reception-doc-type]')!, { target: { value: 'DIAGNOSIS_CERT' } });
    fireEvent.change(container.querySelector('[data-reception-doc-basis]')!, { target: { value: 'SELF' } });
    fireEvent.change(container.querySelector('[data-reception-doc-delivery]')!, { target: { value: 'VISIT' } });
    fireEvent.click(container.querySelector('[data-reception-doc-submit]')!);
    await waitFor(() => expect(container.querySelector('[data-reception-doc-receipt="ABCD1234"]')).not.toBeNull());
    expect(container.querySelector('[data-reception-doc-print]')).not.toBeNull();
    expect(container.textContent).toContain('수수료는 견적입니다');
  });
  it('대기 목록 찾기는 서버 q 로', async () => {
    const { container } = await mount('RECEPTIONIST');
    fireEvent.change(container.querySelector('[data-reception-doc-search]')!, { target: { value: 'M1' } });
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('q=M1'))).toBe(true));
  });
});

describe('처리 단계·대장 CSV·포털 단계', () => {
  it('🔴 단계는 원장 사실로 — 서명 없는 증명서는 작성 단계 · 반려는 멈춘 자리', async () => {
    const { issuanceStages } = await import('@/app/(main)/workstation/documents/issuance-stages');
    const st = (x: Parameters<typeof issuanceStages>[0]) => issuanceStages(x).stages.map((s) => s.state);
    expect(st({ status: 'IN_REVIEW', artifacts: [{ signedAt: null }], isCertificate: true })).toEqual(['DONE', 'CURRENT', 'TODO', 'TODO']);
    expect(st({ status: 'IN_REVIEW', artifacts: [{}], isCertificate: false })).toEqual(['DONE', 'DONE', 'CURRENT', 'TODO']);
    expect(st({ status: 'READY', issuedDocumentId: 'D-1', artifacts: [{}], isCertificate: false })).toEqual(['DONE', 'DONE', 'DONE', 'CURRENT']);
    expect(st({ status: 'REJECTED', artifacts: [], isCertificate: true })).toEqual(['DONE', 'STOPPED', 'TODO', 'TODO']);
    expect(issuanceStages({ status: 'REJECTED', isCertificate: true }).rejected).toBe(true);
  });
  it('🔴 CSV 는 수식 주입을 막고 쉼표·따옴표를 감싼다 · BOM', async () => {
    const { toCsv, csvCell } = await import('@/app/(main)/workstation/documents/issuance-stages');
    expect(csvCell('=HYPERLINK(1)')).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv(['x'], [[1]]).startsWith('﻿x\r\n1')).toBe(true);
  });
  it('포털 단계 표 — 상태가 정본 상태 어휘(DOC_ISSUANCE_STATUS_LABEL) 안에 있다', async () => {
    const { PORTAL_DOC_STEPS } = await import('@/app/portal/_services/ServicesTab');
    const { DOC_ISSUANCE_STATUS_LABEL } = await import('@hospital-run/shared');
    for (const [, inStates] of PORTAL_DOC_STEPS) for (const s of inStates) expect(Object.keys(DOC_ISSUANCE_STATUS_LABEL)).toContain(s);
  });
});
