/**
 * 병동 간 전동 요청 · 수락 화면 — 2026-09-30.
 *  1. 요청 창: 현재 병동은 선택지에서 뺀다 · 받는 병동·사유 필수 · 원하는 병상은 선택
 *  2. 목록: 수락은 병상을 골라야 · 비어 있지 않은 병상은 고를 수 없다 · 거절은 사유 필수 · 조회 실패 ≠ 없음
 *  3. 입원 화면: 즉시 이동은 '병상 이동', 병동 간은 '전동 요청'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
let role = 'NURSE';
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role } }) }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); role = 'NURSE'; });

const wards = [
  { id: 'w1', name: '5병동', floor: 5, type: 'GENERAL', isActive: true, beds: [{ id: 'b1', roomNumber: '501', bedNumber: '1', status: 'OCCUPIED' }] },
  { id: 'w2', name: '7병동', floor: 7, type: 'GENERAL', isActive: true, beds: [{ id: 'b9', roomNumber: '702', bedNumber: '2', status: 'AVAILABLE' }, { id: 'b8', roomNumber: '702', bedNumber: '1', status: 'RESERVED' }] },
  { id: 'we', name: '응급', floor: 1, type: 'EMERGENCY', isActive: true, beds: [] },
];
const item = (over: Record<string, unknown> = {}) => ({ id: 't1', status: 'REQUESTED', reason: '전과', requestedAt: '2026-09-30T01:00:00Z', decidedAt: null, decisionNote: null, admissionId: 'a1', targetWardId: 'w2', requestedById: 'u9', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '환자' }, fromBed: { id: 'b1', roomNumber: '501', bedNumber: '1', ward: { id: 'w1', name: '5병동' } }, targetWard: { id: 'w2', name: '7병동' }, targetBed: null, acceptedBed: null, requestedByName: '이간호', decidedByName: null, ...over });

describe('요청 창', () => {
  it('현재 병동·응급 구역은 선택지에 없다 · 병동·사유를 채워야 보낸다', async () => {
    get.mockResolvedValue({ data: wards });
    post.mockResolvedValue({ data: {} });
    const { BedTransferRequestDialog } = await import('@/components/inpatient/BedTransferRequestDialog');
    const { container } = render(<BedTransferRequestDialog admissionId="a1" currentWardId="w1" patientName="김환자" onClose={() => {}} />, { wrapper: wrap });
    await vi.waitFor(() => expect(container.querySelectorAll('[data-bt-ward] option').length).toBe(2));
    expect(container.querySelector('[data-bt-ward] option[value="w1"]')).toBeNull();
    expect(container.querySelector('[data-bt-ward] option[value="we"]')).toBeNull();
    const btn = container.querySelector('[data-bt-submit]') as HTMLButtonElement;
    fireEvent.change(container.querySelector('[data-bt-ward]')!, { target: { value: 'w2' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-bt-reason]')!, { target: { value: '내과 전과' } });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/bed-transfers', { admissionId: 'a1', targetWardId: 'w2', reason: '내과 전과' }));
  });
});

describe('목록', () => {
  const mount = async () => {
    const { default: Page } = await import('@/app/(main)/bed-transfers/page');
    return render(<Page />, { wrapper: wrap });
  };
  it('수락 — 병상을 골라야 확인 · 비어 있지 않은 병상은 고를 수 없다', async () => {
    get.mockImplementation(async (url: string) => (url.includes('/beds/wards') ? { data: wards } : { data: [item()] }));
    post.mockResolvedValue({ data: {} });
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-bt-accept]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-bt-accept]')!);
    const ok = container.querySelector('[data-bt-confirm]') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await vi.waitFor(() => expect(container.querySelector('[data-bt-accept-bed] option[value="b8"]')).toBeTruthy());
    expect((container.querySelector('[data-bt-accept-bed] option[value="b8"]') as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-bt-accept-bed]')!, { target: { value: 'b9' } });
    fireEvent.click(ok);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/bed-transfers/t1/accept', { bedId: 'b9' }));
  });
  it('거절 — 사유가 비면 확인 불가 · 의사는 수락·거절 버튼이 없다(서버 권한과 같게)', async () => {
    get.mockImplementation(async (url: string) => (url.includes('/beds/wards') ? { data: wards } : { data: [item()] }));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-bt-reject]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-bt-reject]')!);
    expect((container.querySelector('[data-bt-confirm]') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    role = 'DOCTOR';
    const d = await mount();
    await vi.waitFor(() => expect(d.container.querySelector('[data-bt-row="REQUESTED"]')).toBeTruthy());
    expect(d.container.querySelector('[data-bt-accept]')).toBeNull();
  });
  it('🔴 조회 실패는 "요청 없음"이 아니다', async () => {
    get.mockImplementation(async (url: string) => { if (url.includes('/beds/wards')) return { data: wards }; throw new Error('500'); });
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/));
    expect(container.textContent).not.toContain('수락을 기다리는 전동 요청이 없습니다');
  });
});

describe('입원 화면', () => {
  it("즉시 이동은 '병상 이동', 병동 간은 '전동 요청'(창을 연다)", () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/inpatient/page.tsx'), 'utf8');
    expect(src).toContain('<T k="병상 이동" />');
    expect(src).toMatch(/onClick=\{\(\) => setTransferReq\(a\)\}/);
    expect(src).toMatch(/<BedTransferRequestDialog/);
  });
});
