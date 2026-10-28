/**
 * 결정 선행 몫의 운영 경로 화면(2026-10-09)
 *  · 퇴원요약 POA — 필수 여부를 말한다 · 선택은 비어서 시작 · 서명본은 읽기만 · 서명 실패를 말한다
 *  · KOPS — 직접 보고 기록은 "사람이 적은 번호"로 · 전담인력만 기록 폼
 *  · 측정 입력 — 외부 통보 결과는 문서·번호 없이 저장 불가
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { get, role } = vi.hoisted(() => ({ get: vi.fn(), role: { v: 'DOCTOR' } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (p: string) => get(p), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: role.v } }) }));

import { DiagnosisPoaPanel } from '../../src/app/(main)/inpatient/[admissionId]/discharge-summary/DiagnosisPoaPanel';

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
beforeEach(() => { get.mockReset(); role.v = 'DOCTOR'; });

describe('퇴원요약 POA', () => {
  const data = (required: boolean) => ({ data: { required, items: [{ code: 'I21.9', name: '급성 심근경색', poa: 'Y' }, { code: 'L89.1', name: '욕창', poa: null }], missing: ['L89.1'] } });
  it('🔴 필수 아님이면 그렇게 말하고, 빈 진단의 선택은 비어서 시작', async () => {
    get.mockResolvedValue(data(false));
    const { container } = render(wrap(<DiagnosisPoaPanel admissionId="a1" readOnly={false} />));
    await waitFor(() => expect(container.querySelector('[data-discharge-poa]')).not.toBeNull());
    expect(container.querySelector('[data-discharge-poa]')!.getAttribute('data-required')).toBe('no');
    expect((container.querySelector('[data-poa-select="L89.1"]') as HTMLSelectElement).value).toBe('');
    expect((container.querySelector('[data-poa-select="I21.9"]') as HTMLSelectElement).value).toBe('Y');
  });
  it('서명본은 읽기만 · 미기록은 미기록으로', async () => {
    get.mockResolvedValue(data(true));
    const { container } = render(wrap(<DiagnosisPoaPanel admissionId="a1" readOnly />));
    await waitFor(() => expect(container.querySelector('[data-poa-item="L89.1"]')).not.toBeNull());
    expect(container.querySelector('[data-poa-select]')).toBeNull();
    expect(container.querySelector('[data-poa-item="L89.1"]')!.textContent).toContain('미기록');
  });
  it('🔴 권한 밖(원무)은 부르지 않는다', () => {
    role.v = 'RECEPTIONIST';
    render(wrap(<DiagnosisPoaPanel admissionId="a1" readOnly={false} />));
    expect(get).not.toHaveBeenCalled();
  });
  it('🔴 서명 실패를 말한다(종전엔 처리가 없었다)', () => {
    expect(src('app/(main)/inpatient/[admissionId]/discharge-summary/page.tsx')).toMatch(/discharge-summary\/sign[\s\S]{0,300}onError/);
  });
});

describe('KOPS 직접 보고·외부 결과 입력', () => {
  it('🔴 KOPS 기록은 사람이 적은 번호라고 말하고, 송신 미구축 표식은 그대로', () => {
    const s = src('app/(main)/safety/page.tsx');
    expect(s).toContain('data-kops-status="MANUAL_REPORTED"');
    expect(s).toContain('data-kops-status="LOCAL_RECORDED"');
    expect(s).toContain('기관 접수는 시스템이 확인하지 않습니다');
    expect(s).toContain("if (!canReview) return Promise.reject");
  });
  it('🔴 외부 통보 결과는 문서·번호 없이 저장 불가', () => {
    const s = src('app/(main)/quality/MeasurementPanel.tsx');
    expect(s).toContain("(source === 'EXTERNAL' && externalRef.trim().length < 3)");
    expect(s).toContain("...(source === 'EXTERNAL' ? { source: 'EXTERNAL', externalRef: externalRef.trim() } : {})");
  });
});
