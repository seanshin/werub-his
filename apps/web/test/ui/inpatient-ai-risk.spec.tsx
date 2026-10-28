/**
 * 재원 환자 AI 위험 배지.
 *  · 목록이 열려도 부르지 않는다 — 'AI 위험'을 누른 환자만
 *  · 한 환자의 예측은 차례로(앞 요청이 끝난 뒤 다음) — 동시에 보내지 않는다
 *  · 바쁨(429 AI_UPSTREAM_BUSY)은 고장('?')과 다른 표식(⏳) · 자료가 없으면 예측하지 않고 버튼도 없다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';

const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { post: (...a: unknown[]) => post(...a), get: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => { cleanup(); post.mockReset(); });
async function mount(props: Record<string, unknown> = {}) {
  const { AiRiskBadges } = await import('@/components/inpatient/AiRiskBadges');
  return render(<AiRiskBadges admissionId="a1" patientAge={70} patientSex="M" diagnoses={['폐렴']} lengthOfStay={3} medications={['와파린']} {...props} />, { wrapper: wrap });
}

describe('재원 환자 AI 위험', () => {
  it('🔴 열려도 부르지 않는다 — 누른 환자만', async () => {
    const { container } = await mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
    expect(container.querySelector('[data-ai-risk-request="a1"]')).toBeTruthy();
  });

  it('🔴 차례로 — 앞 요청이 끝나기 전에는 다음을 보내지 않는다', async () => {
    let release!: () => void;
    post.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: { risk_level: 'LOW' } }); }))
      .mockResolvedValue({ data: { risk_level: 'HIGH' } });
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-ai-risk-request="a1"]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/api/v1/ai/predict/readmission');
    release();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/api/v1/ai/predict/readmission', '/api/v1/ai/predict/complication', '/api/v1/ai/predict/adverse-drug']);
  });

  it('🔴 바쁨은 ⏳ · 고장은 ? — 다른 표식', async () => {
    post.mockRejectedValueOnce(new ApiError('AI_UPSTREAM_BUSY', 'AI 서버가 동시 처리 한도로 바쁩니다'))
      .mockRejectedValueOnce(new ApiError('AI_UPSTREAM_ERROR', 'x'))
      .mockResolvedValueOnce({ data: { risk_level: 'LOW' } });
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-ai-risk-request="a1"]')!);
    await waitFor(() => expect(container.querySelector('[data-ai-risk="a1"]')).toBeTruthy());
    await waitFor(() => expect(container.querySelectorAll('[data-ai-risk-busy]').length).toBe(1));
    expect(container.querySelector('[data-ai-risk="a1"]')!.textContent).toContain('재⏳');
    expect(container.querySelector('[data-ai-risk="a1"]')!.textContent).toContain('합?');
  });

  it('🔴 재입원 — 입원 id 를 보내 서버가 기록에서 채운다 · 재원일수를 모르면 1로 채우지 않는다', async () => {
    post.mockResolvedValue({ data: { risk_level: 'LOW' } });
    const { container } = await mount({ lengthOfStay: undefined });
    fireEvent.click(container.querySelector('[data-ai-risk-request="a1"]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.admissionId).toBe('a1');
    expect('lengthOfStay' in body).toBe(false);
  });

  it('🔴 재입원 빠진 점수 항목이 있으면 * 표지(0점 처리 — 위험도가 낮게 나올 수 있다) · 없으면 표지 없음', async () => {
    post.mockResolvedValueOnce({ data: { risk_level: 'LOW', inputGaps: ['HB', 'NA', 'ONCOLOGY'] } })
      .mockResolvedValueOnce({ data: { risk_level: 'LOW' } })
      .mockResolvedValueOnce({ data: { risk_level: 'LOW' } });
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-ai-risk-request="a1"]')!);
    await waitFor(() => expect(container.querySelector('[data-ai-risk-gaps="3"]')).toBeTruthy());
    expect(container.querySelectorAll('[data-ai-risk-gaps]').length).toBe(1);
  });

  it('자료가 없으면 예측하지 않고 버튼도 없다(없다는 사실은 –로)', async () => {
    const { container } = await mount({ patientAge: undefined, patientSex: undefined, medications: [] });
    expect(container.querySelector('[data-ai-risk-request="a1"]')).toBeNull();
    expect(container.textContent).toContain('재–');
    expect(post).not.toHaveBeenCalled();
  });
});
