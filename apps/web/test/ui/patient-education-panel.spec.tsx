/**
 * 환자 교육 기록 화면 — 2026-09-30.
 *  1. 쓰기 폼 초기값은 미선택(주제·대상·이해도) · 필수(주제·대상·내용)를 다 채워야 저장 · 이해도는 고른 경우에만 보낸다
 *  2. 이해도 미기록은 "이해도 미기록"으로 보인다(이해함으로 그리지 않는다)
 *  3. 🔴 조회 실패는 "교육 기록 없음"이 아니다 · 한 출처 실패는 그 출처를 밝힌다
 *  4. 무효 처리 버튼은 기록한 사람에게만
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const rec = (over: Record<string, unknown> = {}) => ({ id: 'r1', topic: 'FALL_PREVENTION', content: '난간 사용', learner: 'GUARDIAN', learnerNote: '딸', methods: ['VERBAL'], understanding: null, barriers: null, followUpNeeded: null, educatedAt: '2026-09-30T04:00:00Z', educatorId: 'u1', educatorName: '김간호', voidedAt: null, voidReason: null, voidedByName: null, ...over });
const resp = (records: unknown[] = [], extra: Record<string, unknown> = {}) => ({ data: { records, related: [], relatedCapPerSource: 50, sourceErrors: [], ...extra } });
const mount = async () => {
  const { PatientEducationPanel } = await import('@/components/patient-education/PatientEducationPanel');
  return render(<PatientEducationPanel patientId="p1" />, { wrapper: wrap });
};

describe('쓰기 폼', () => {
  it('초기값 미선택 · 필수를 채워야 저장 · 이해도는 고르지 않으면 보내지 않는다', async () => {
    get.mockResolvedValue(resp());
    post.mockResolvedValue({ data: { id: 'n' } });
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-education-new]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-education-new]')!);
    expect((container.querySelector('[data-education-topic]') as HTMLSelectElement).value).toBe('');
    expect(container.querySelector('[data-education-learner].bg-indigo-600')).toBeNull();
    expect(container.querySelector('[data-education-understanding].bg-indigo-600')).toBeNull();
    const btn = container.querySelector('[data-education-submit]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-education-topic]')!, { target: { value: 'MEDICATION' } });
    fireEvent.click(container.querySelector('[data-education-learner="PATIENT"]')!);
    expect(btn.disabled).toBe(true); // 내용 없음
    fireEvent.change(container.querySelector('[data-education-content]')!, { target: { value: '와파린 출혈 징후' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/v1/patients/p1/education');
    expect(body).toMatchObject({ topic: 'MEDICATION', learner: 'PATIENT', content: '와파린 출혈 징후' });
    expect(body).not.toHaveProperty('understanding');
    expect(typeof body.educatedAt).toBe('string');
  });
  it('쓰기 권한 없는 역할(의무기록)에는 기록 버튼이 없다', async () => {
    role = 'MEDICAL_RECORDS';
    get.mockResolvedValue(resp([rec()]));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-education-row="r1"]')).toBeTruthy());
    expect(container.querySelector('[data-education-new]')).toBeNull();
    expect(container.querySelector('[data-education-void]')).toBeNull();
  });
});

describe('목록', () => {
  it('이해도 미기록은 그렇게 보인다 · 기록한 사람에게만 무효 처리 버튼', async () => {
    get.mockResolvedValue(resp([rec(), rec({ id: 'r2', educatorId: 'u9', understanding: 'UNDERSTOOD' })]));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-education-row="r1"]')).toBeTruthy());
    expect(container.querySelector('[data-education-row="r1"] [data-education-understood="NONE"]')?.textContent).toContain('이해도 미기록');
    expect(container.querySelector('[data-education-row="r2"] [data-education-understood="UNDERSTOOD"]')).toBeTruthy();
    expect(container.querySelector('[data-education-row="r1"] [data-education-void]')).toBeTruthy();
    expect(container.querySelector('[data-education-row="r2"] [data-education-void]')).toBeNull();
  });
  it('🔴 조회 실패는 "교육 기록 없음"이 아니다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/));
    expect(container.querySelector('[data-education-empty]')).toBeNull();
  });
  it('한 출처가 실패하면 그 출처를 밝힌다 · 다른 기록의 교육은 출처와 함께', async () => {
    get.mockResolvedValue(resp([], { related: [{ source: 'PHARMACY_COUNSEL', id: 'd1', at: '2026-09-20T00:00:00Z', byName: '박약사', label: 'DISCHARGE', content: '복약 설명' }], sourceErrors: [{ source: 'NURSING_NOTE', message: 'x' }] }));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-education-related="PHARMACY_COUNSEL"]')).toBeTruthy());
    expect(container.querySelector('[data-education-source-error]')?.textContent).toContain('간호기록(교육)');
  });
});
