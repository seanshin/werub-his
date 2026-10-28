/**
 * 처방전 인쇄는 발급된 판을 그린다(2026-10-13 결함 발굴 B2).
 *  · 🔴 종전: 발급 뒤에도 실시간 진료 조회로 그려 지시사항·진단이 발급 해시에 묶이지 않았다
 *  · 발급 응답의 snapshot(서버 해시 대상)으로 약·지시사항·진단을 그린다 · 대조군: 발급 전(초안)은 실시간
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense } from 'react';

const live = vi.hoisted(() => ({ status: 'SIGNED' }));
vi.mock('@/hooks/useEncounters', () => ({
  useEncounter: () => ({ isLoading: false, error: null, data: { data: {
    id: 'e1', status: live.status, patient: { familyName: '홍', givenName: '길동' }, doctor: { familyName: '이', givenName: '의사' },
    diagnoses: [{ diagnosisCode: { code: 'Z99', nameKo: '나중에 바꾼 진단' } }],
    prescriptions: [{ id: 'a', type: 'MEDICATION', status: 'ACTIVE', dispensingType: 'EXTERNAL', medicationCode: { nameKo: '약A' }, dosage: '1T', instructions: '나중에 바꾼 지시' }],
  } } }),
}));
const api = vi.hoisted(() => ({ get: vi.fn(async () => ({ data: [] })), post: vi.fn(), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
vi.mock('@/components/signature/SignedDocumentFooter', () => ({ default: () => null }));

beforeEach(() => { cleanup(); api.post.mockReset(); live.status = 'SIGNED'; });
/** React use() — 이미 끝난 약속(매 렌더 새 약속이면 영원히 멈춘다) */
const PARAMS = Object.assign(Promise.resolve({ encounterId: 'e1' }), { status: 'fulfilled', value: { encounterId: 'e1' } });
const show = async () => {
  const { default: Page } = await import('@/app/(main)/print/prescription/[encounterId]/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Suspense fallback={null}><Page params={PARAMS} /></Suspense></QueryClientProvider>);
};

describe('🔴 처방전 — 발급된 판', () => {
  it('지시사항·진단은 발급 스냅샷의 것 · 실시간 값이 아니다', async () => {
    api.post.mockResolvedValue({ data: { issueNo: 'WRB-PRESCRIPTION-20261013-0001', dateKey: '20261013', seq: 1, issuedAt: '2026-10-13T00:00:00Z', status: 'ORIGINAL', qrUrl: 'u', reused: false, superseded: [], itemCount: 1,
      transmission: { channel: 'x', implemented: false, transmitted: false, transmittedAt: null, reason: 'CHANNEL_NOT_IMPLEMENTED' },
      snapshot: { scope: 'EXTERNAL', diagnoses: [{ code: 'J00', name: '급성 비인두염' }], items: [{ prescriptionId: 'a', code: 'C1', name: '약A', nameEn: null, dosage: '1T', frequency: 'bid', duration: 3, quantity: 6, route: 'ORAL', instructions: '식후 30분', dispensingType: 'EXTERNAL' }] } } });
    const v = await show();
    await waitFor(() => expect(v.container.textContent).toContain('식후 30분'));
    expect(v.container.textContent).toContain('급성 비인두염');
    expect(v.container.textContent).not.toContain('나중에 바꾼 지시');
    expect(v.container.textContent).not.toContain('나중에 바꾼 진단');
  });
  it('대조군 — 초안(발급 안 함)은 실시간으로 그린다', async () => {
    live.status = 'DRAFT';
    const v = await show();
    await waitFor(() => expect(v.container.textContent).toContain('나중에 바꾼 지시'));
    expect(api.post).not.toHaveBeenCalled();
  });
});
