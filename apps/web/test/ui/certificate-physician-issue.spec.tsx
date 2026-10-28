/**
 * 진단서 발급 화면(2026-10-13 결함 발굴 A4).
 *  · 🔴 의사 아니면 발급 버튼 없음(이유를 말한다) · 서명 안 된 진료기록이면 발급 버튼 없음
 *  · 🔴 발병일을 진료일로 채우지 않는다 · 발급 뒤엔 서버가 고쳐 쓴 판(발급 의사·원장 진단)을 그린다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const ENC = (status = 'SIGNED') => ({ data: { id: 'e1', status, createdAt: '2026-10-12T01:00:00Z', signedAt: '2026-10-12T05:00:00Z', doctor: { familyName: '박', givenName: '담당' }, diagnoses: [{ diagnosisCode: { code: 'J00', nameKo: '급성 비인두염' } }] } });
const route = (status = 'SIGNED') => api.get.mockImplementation(async (url: string) => (url.includes('/encounters/') ? ENC(status) : { data: { familyName: '홍', givenName: '길동' } }));
const issueBtn = () => [...document.body.querySelectorAll('button')].find((b) => /발급/.test(b.textContent ?? '') && !/닫기/.test(b.textContent ?? ''));
beforeEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset(); });

describe('🔴 진단서 — 의사·서명된 진료기록만 발급', () => {
  it('간호사 → 발급 버튼 없음 · 이유 표시 · 대조군: 의사면 버튼', async () => {
    route();
    const { CertificateModal } = await import('@/components/document/CertificateModal');
    useAuthStore.setState({ user: { id: 'n', role: 'NURSE' } as never, isAuthenticated: true });
    const v = wrap(<CertificateModal patientId="p1" encounterId="e1" onClose={() => {}} />);
    await waitFor(() => expect(v.container.querySelector('[data-certificate-issue-blocked="ROLE"]')).toBeTruthy());
    expect(issueBtn()).toBeUndefined();
    cleanup();
    useAuthStore.setState({ user: { id: 'd', role: 'DOCTOR' } as never, isAuthenticated: true });
    wrap(<CertificateModal patientId="p1" encounterId="e1" onClose={() => {}} />);
    await waitFor(() => expect(issueBtn()).toBeTruthy());
  });
  it('서명 안 된 진료기록 → 의사여도 발급 버튼 없음', async () => {
    route('DRAFT');
    const { CertificateModal } = await import('@/components/document/CertificateModal');
    useAuthStore.setState({ user: { id: 'd', role: 'DOCTOR' } as never, isAuthenticated: true });
    const v = wrap(<CertificateModal patientId="p1" encounterId="e1" onClose={() => {}} />);
    await waitFor(() => expect(v.container.querySelector('[data-certificate-issue-blocked="UNSIGNED"]')).toBeTruthy());
    expect(issueBtn()).toBeUndefined();
  });
  it('🔴 발병일 미입력은 진료일로 채우지 않고 보낸다 · 발급 뒤엔 서버 판(발급 의사)을 그린다', async () => {
    route();
    api.post.mockResolvedValue({ data: { issueNo: 'WRB-CERTIFICATE-20261013-0001', qrUrl: 'u', issuedAt: '2026-10-13T00:00:00Z', status: 'ORIGINAL', snapshot: { doctor: { name: '김발급', license: '777' }, diagnoses: [{ kcdCode: 'J00', name: '급성 비인두염' }] } } });
    const { CertificateModal } = await import('@/components/document/CertificateModal');
    useAuthStore.setState({ user: { id: 'd', role: 'DOCTOR' } as never, isAuthenticated: true });
    wrap(<CertificateModal patientId="p1" encounterId="e1" onClose={() => {}} />);
    await waitFor(() => expect(issueBtn()).toBeTruthy());
    fireEvent.click(issueBtn()!);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const sent = api.post.mock.calls[0][1].snapshot;
    expect(sent.onsetDate).toBeUndefined();
    await waitFor(() => expect(document.body.textContent).toContain('김발급'));
  });
});
