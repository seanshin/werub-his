/**
 * 요양기관 종별 · 건보 외래 본인부담률(종별) 화면(2026-10-20 · 사용자 지시 "UI 화면으로 기능 구현").
 *  · 종별: 결정 기록 경로 그대로(근거·권한 필수) · 🔴 미선택으로 시작 · 그 밖 종별은 고를 수 없다 · 미설정을 미설정이라 말한다
 *  · 본인부담률: 🔴 율을 미리 채우지 않는다 · 네 종별이 다 맞아야 저장 · 단일 율로 되돌리기 = null 저장
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
const render = (el: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);

const DECISION = {
  key: 'billing.institutionType', title: '종별', decided: false, seeded: false, currentConfigValue: null, record: null,
  options: [
    { value: 'UNSET', label: '아직 확인하지 않았다', effect: 'x', enact: null },
    { value: 'CLINIC', label: '의원', effect: '진찰료 AA154', enact: { key: 'billing.institution.grade', newValue: 'CLINIC' } },
    { value: 'HOSPITAL', label: '병원', effect: '진찰료 AA155', enact: { key: 'billing.institution.grade', newValue: 'HOSPITAL' } },
    { value: 'GENERAL', label: '종합병원', effect: '진찰료 AA156', enact: { key: 'billing.institution.grade', newValue: 'GENERAL' } },
    { value: 'TERTIARY', label: '상급종합병원', effect: '진찰료 AA157', enact: { key: 'billing.institution.grade', newValue: 'TERTIARY' } },
    { value: 'OTHER', label: '그 밖', effect: 'y', enact: null },
  ],
};
beforeEach(() => {
  cleanup(); api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  api.get.mockImplementation(async (url: string) => (url === '/api/v1/admin/decisions' ? { data: [DECISION] } : { data: [] }));
});

describe('🔴 요양기관 종별 패널', () => {
  it('미설정을 미설정이라 말한다 · 미선택 시작 · 그 밖 종별 없음 · 근거·권한 없으면 저장 잠김 · 결정 기록 EP 로 보낸다', async () => {
    api.post.mockResolvedValue({ data: { applied: true } });
    const { InstitutionGradePanel } = await import('@/app/(main)/admin/billing-calc/institution-settings');
    const v = render(<InstitutionGradePanel />);
    await waitFor(() => expect(v.container.querySelector('[data-grade-current]')).not.toBeNull());
    expect(v.container.querySelector('[data-grade-current]')!.textContent).toContain('미설정');
    expect(v.container.querySelector('[data-grade-decision]')!.textContent).toContain('기록 없음');
    const radios = [...v.container.querySelectorAll('input[name="institution-grade"]')] as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['UNSET', 'CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY']);
    expect(radios.some((r) => r.checked)).toBe(false);
    const save = v.container.querySelector('[data-grade-save]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(radios.find((r) => r.value === 'GENERAL')!);
    expect(save.disabled).toBe(true); // 근거 전
    fireEvent.change(v.container.querySelector('[data-grade-legal]')!, { target: { value: '개설허가 제2026-01호' } });
    fireEvent.change(v.container.querySelector('[data-grade-authority]')!, { target: { value: '원장' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/admin/decisions/billing.institutionType/record', { choice: 'GENERAL', legalReviewRef: '개설허가 제2026-01호', authorityClaim: '원장' }));
    await waitFor(() => expect(v.container.querySelector('[data-grade-result]')!.textContent).toContain('반영'));
  });
  it('실패는 실패로 말한다 · 개발 시드 기록은 실결정이라 하지 않는다', async () => {
    api.get.mockImplementation(async () => ({ data: [{ ...DECISION, decided: true, seeded: true, currentConfigValue: 'CLINIC', record: { choice: 'CLINIC', legalReviewRef: '개발 시드(DEV-SEED)', authorityClaim: 'x', decidedAt: '2026-10-10T00:00:00Z' } }] }));
    api.post.mockRejectedValue(new Error('근거가 부족합니다'));
    const { InstitutionGradePanel } = await import('@/app/(main)/admin/billing-calc/institution-settings');
    const v = render(<InstitutionGradePanel />);
    await waitFor(() => expect(v.container.querySelector('[data-grade-decision]')!.textContent).toContain('개발 시드'));
    expect(v.container.querySelector('[data-grade-current]')!.textContent).toContain('의원');
    fireEvent.click(v.container.querySelector('input[value="HOSPITAL"]')!);
    fireEvent.change(v.container.querySelector('[data-grade-legal]')!, { target: { value: '문서 1234' } });
    fireEvent.change(v.container.querySelector('[data-grade-authority]')!, { target: { value: '원장' } });
    fireEvent.click(v.container.querySelector('[data-grade-save]')!);
    await waitFor(() => expect(v.container.querySelector('[data-grade-result]')!.className).toContain('rose'));
  });
});

describe('🔴 건보 외래 본인부담률 패널', () => {
  it('지금 단일 율을 말한다 · 종별 차등을 고르면 빈 칸 시작(율을 지어내지 않는다) · 네 칸이 다 맞아야 저장 · 객체로 저장', async () => {
    api.put.mockResolvedValue({ data: {} });
    const onSaved = vi.fn();
    const { NhiOutpatientRatePanel } = await import('@/app/(main)/admin/billing-calc/institution-settings');
    const v = render(<NhiOutpatientRatePanel configs={[{ key: 'billing.copay.nhi.outpatient', value: 30 }, { key: 'billing.copay.nhi.outpatient.byGrade', value: null }]} onSaved={onSaved} />);
    expect(v.container.querySelector('[data-nhi-rate-current]')!.textContent).toContain('단일 율 30%');
    const save = v.container.querySelector('[data-nhi-rate-save]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(v.container.querySelector('[data-nhi-mode-grade]')!);
    const inputs = [...v.container.querySelectorAll('[data-nhi-rate]')] as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['', '', '', '']);
    for (const [i, val] of ['30', '40', '50'].entries()) fireEvent.change(inputs[i], { target: { value: val } });
    expect(save.disabled).toBe(true);
    fireEvent.change(inputs[3], { target: { value: '101' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(inputs[3], { target: { value: '60' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/v1/config/billing.copay.nhi.outpatient.byGrade', { value: { CLINIC: 30, HOSPITAL: 40, GENERAL: 50, TERTIARY: 60 } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
  it('차등이 저장돼 있으면 그대로 보이고 · 단일 율로 되돌리면 null 저장 · 대조군 이미 단일이면 되돌릴 것이 없어 저장 잠김', async () => {
    api.put.mockResolvedValue({ data: {} });
    const { NhiOutpatientRatePanel } = await import('@/app/(main)/admin/billing-calc/institution-settings');
    const v = render(<NhiOutpatientRatePanel configs={[{ key: 'billing.copay.nhi.outpatient', value: 30 }, { key: 'billing.copay.nhi.outpatient.byGrade', value: { CLINIC: 30, HOSPITAL: 40, GENERAL: 50, TERTIARY: 60 } }]} onSaved={() => {}} />);
    expect(v.container.querySelector('[data-nhi-rate-current]')!.textContent).toMatch(/병원 40%/);
    fireEvent.click(v.container.querySelector('[data-nhi-mode-single]')!);
    fireEvent.click(v.container.querySelector('[data-nhi-rate-save]')!);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/v1/config/billing.copay.nhi.outpatient.byGrade', { value: null }));
    cleanup();
    const w = render(<NhiOutpatientRatePanel configs={[{ key: 'billing.copay.nhi.outpatient', value: 30 }]} onSaved={() => {}} />);
    fireEvent.click(w.container.querySelector('[data-nhi-mode-single]')!);
    expect((w.container.querySelector('[data-nhi-rate-save]') as HTMLButtonElement).disabled).toBe(true);
  });
});
