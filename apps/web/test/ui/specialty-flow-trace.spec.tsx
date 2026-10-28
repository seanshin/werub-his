/**
 * 전문진료 흐름 추적 보완(2026-10-10).
 *  · 신경외과 — 동공·근력·DTR·Babinski 미평가 시작(종전 정상값으로 시작) · 동공 크기는 숫자로
 *  · 분만 진행 — 잰 값 없으면 저장 불가 · 측정 시각을 보낸다(비우면 저장 시각이라고 말한다)
 *  · 방사선 — 화면에서 만든 계획이 나아갈 길(승인·분할 생성·보류/해제·완료·취소) · 되돌릴 수 없는 것은 두 번 · 의사만
 *  · 호스피스 — 퇴원·사망은 구분과 시각을 고른 뒤에만 · 사망은 두 번
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); patch.mockReset(); post.mockResolvedValue({ data: {} }); patch.mockResolvedValue({ data: {} }); });

describe('신경외과 — 신경학적 소견 미평가 시작', () => {
  const mount = async () => {
    const { NeurosurgeryEncounterLayout } = await import('@/app/(main)/patients/[id]/encounter/new/components/NeurosurgeryEncounterLayout');
    return render(<NeurosurgeryEncounterLayout patientId="p1" encounterId="e1" onStartEncounter={() => {}} patient={{}} onSaveDraft={() => {}} onSignAndBill={() => {}} isSaving={false} isSigning={false} />, { wrapper: wrap });
  };
  const save = (c: HTMLElement) => fireEvent.click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('검사 기록 저장'))!);
  it('🔴 고르지 않고 저장하면 동공·근력·반사·Babinski 를 보내지 않는다(종전 3mm·반응+·근력 5·2+·음성)', async () => {
    const r = await mount();
    expect((r.container.querySelector('[data-pupil-size="L"]') as HTMLSelectElement).value).toBe('');
    expect((r.container.querySelector('[data-pupil-reactive="L"]') as HTMLSelectElement).value).toBe('');
    expect(r.container.querySelector('[data-babinski="left"]')!.textContent).toBe('—');
    save(r.container);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    for (const k of ['pupilLeft', 'pupilRight', 'motorExam', 'reflexes', 'babinski']) expect(k in body).toBe(false);
  });
  it('고른 것만 — 동공 크기는 숫자 · 평가한 분절만 · Babinski 는 미평가→음성→양성', async () => {
    const r = await mount();
    fireEvent.change(r.container.querySelector('[data-pupil-size="L"]')!, { target: { value: '4' } });
    fireEvent.change(r.container.querySelector('[data-pupil-reactive="R"]')!, { target: { value: '-' } });
    fireEvent.click(r.container.querySelector('[data-babinski="right"]')!);
    fireEvent.click(r.container.querySelector('[data-babinski="right"]')!);
    save(r.container);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.pupilLeft).toEqual({ size: 4 });
    expect(body.pupilRight).toEqual({ reactive: false });
    expect(body.babinski).toEqual({ left: null, right: '+' });
    expect('motorExam' in body).toBe(false);
  });
});

describe('분만 진행 기록', () => {
  it('🔴 잰 값이 없으면 저장 불가 · 측정 시각을 함께 보낸다', async () => {
    const { ProgressForm } = await import('@/app/(main)/obgyn/DeliveryBoard');
    const onSubmit = vi.fn(async (_b: unknown) => ({}));
    const r = render(<ProgressForm onSubmit={onSubmit} />, { wrapper: wrap });
    const btn = r.container.querySelector('[data-labor-progress-submit]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(r.container.textContent).toContain('측정 시각을 비우면 저장한 시각으로 기록됩니다');
    const inputs = r.container.querySelectorAll('input:not([type="datetime-local"])');
    fireEvent.change(inputs[0], { target: { value: '6' } });
    fireEvent.change(r.container.querySelector('[data-labor-progress-time]')!, { target: { value: '2026-10-10T08:30' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({ cervicalDilation: 6, recordedAt: new Date('2026-10-10T08:30').toISOString() });
  });
});

describe('방사선 계획 진행', () => {
  const mount = async (plan: Record<string, unknown>, role = 'DOCTOR') => {
    useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });
    const { PlanActions } = await import('@/app/(main)/radiation/radiation-plan-actions');
    return render(<PlanActions plan={plan} />, { wrapper: wrap });
  };
  it('🔴 계획 상태별 다음 단계 — 계획: 승인 · 승인: 분할 생성 · 의사가 아니면 버튼 없음', async () => {
    let r = await mount({ id: 'rp1', status: 'PLANNED' });
    expect(r.container.querySelector('[data-rt-action="approve"]')).not.toBeNull();
    fireEvent.click(r.container.querySelector('[data-rt-action="approve"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/radiation/plans/rp1/approve', {}));
    cleanup();
    r = await mount({ id: 'rp1', status: 'APPROVED', planApprovedAt: '2026-10-01' });
    fireEvent.click(r.container.querySelector('[data-rt-action="generate"]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/radiation/plans/rp1/fractions/generate', {}));
    cleanup();
    r = await mount({ id: 'rp1', status: 'PLANNED' }, 'NURSE');
    expect(r.container.querySelector('[data-rt-plan-actions]')).toBeNull();
  });
  it('🔴 완료·취소는 두 번 눌러야 · 보류 해제는 보류 전 단계로', async () => {
    let r = await mount({ id: 'rp1', status: 'IN_TREATMENT', planApprovedAt: 'x', fractions: [{}] });
    fireEvent.click(r.container.querySelector('[data-rt-action="complete"]')!);
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(r.container.querySelector('[data-rt-action="complete"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/radiation/plans/rp1/status', { status: 'COMPLETED' }));
    cleanup(); patch.mockClear();
    r = await mount({ id: 'rp1', status: 'ON_HOLD', planApprovedAt: 'x', fractions: [] });
    fireEvent.click(r.container.querySelector('[data-rt-action="resume"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/radiation/plans/rp1/status', { status: 'APPROVED' }));
    const { resumeTarget } = await import('@/app/(main)/radiation/radiation-plan-actions');
    expect(resumeTarget({})).toBe('PLANNED');
    expect(resumeTarget({ planApprovedAt: 'x', fractions: [{}] })).toBe('IN_TREATMENT');
  });
});

describe('호스피스 종결', () => {
  it('🔴 구분·시각을 고르기 전엔 저장 불가 · 사망은 두 번', async () => {
    const { HospiceEndForm } = await import('@/app/(main)/hospice/HospiceEndForm');
    const onSubmit = vi.fn();
    const r = render(<HospiceEndForm busy={false} onSubmit={onSubmit} />, { wrapper: wrap });
    const btn = r.container.querySelector('[data-hospice-end-submit]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(r.container.querySelector('[data-hospice-end-kind]')!, { target: { value: 'DECEASED' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(r.container.querySelector('[data-hospice-end-at]')!, { target: { value: '2026-10-10T04:10' } });
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledWith({ status: 'DECEASED', occurredAt: new Date('2026-10-10T04:10').toISOString() });
  });
});
