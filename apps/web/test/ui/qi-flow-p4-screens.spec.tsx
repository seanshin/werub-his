/**
 * QI 흐름 남은 몫 화면(2026-10-09) — 입원 화면 삽입 기구 원장 · 병동 층 · 원장 기구일수 안내.
 *  · 권한 밖(원무 등)은 원장을 부르지 않는다 · 쓰기 폼은 미선택으로 시작 · 무효는 사유 5자 전 잠김
 *  · 병동 층은 "분석용 · 판정은 병원 전체"로 따로 그린다
 *  · 기구일수 원천이 DEVICE_LEDGER 면 "결정 전 닫힘"이 아니라 원장에서 센다고 말한다
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { get, role } = vi.hoisted(() => ({ get: vi.fn(), role: { v: 'NURSE' } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (p: string) => get(p), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: role.v } }) }));

import { DeviceLinePanel } from '../../src/app/(main)/inpatient/[admissionId]/DeviceLinePanel';
import QiFlowPanel from '../../src/app/(main)/quality/QiFlowPanel';
import QiFlowOps from '../../src/app/(main)/quality/QiFlowOps';

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
beforeEach(() => { get.mockReset(); role.v = 'NURSE'; });

describe('삽입 기구 원장 패널', () => {
  it('🔴 권한 밖 역할은 원장을 부르지 않는다(패널도 없다)', () => {
    role.v = 'RECEPTIONIST';
    const { container } = render(wrap(<DeviceLinePanel admissionId="a1" patientId="p1" />));
    expect(get).not.toHaveBeenCalled();
    expect(container.querySelector('[data-device-lines]')).toBeNull();
  });
  it('🔴 쓰기 폼은 미선택·빈 시각으로 시작하고 저장이 잠겨 있다', async () => {
    get.mockResolvedValue({ data: [] });
    const { container } = render(wrap(<DeviceLinePanel admissionId="a1" patientId="p1" />));
    await waitFor(() => expect(container.querySelector('[data-device-lines-empty]')).not.toBeNull());
    const sel = container.querySelector('[data-device-line-form] select') as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect((container.querySelector('[data-device-line-save]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('유지 중인 기구만 제거 버튼 · 무효는 사유 5자 전 잠김', async () => {
    get.mockResolvedValue({ data: [
      { id: 'l1', deviceType: 'CENTRAL_LINE', site: null, insertedAt: '2026-10-01T01:00:00Z', removedAt: null, note: null, voidedAt: null },
      { id: 'l2', deviceType: 'URINARY_CATHETER', site: null, insertedAt: '2026-09-20T01:00:00Z', removedAt: '2026-09-25T01:00:00Z', note: null, voidedAt: null },
    ] });
    const { container, getAllByText } = render(wrap(<DeviceLinePanel admissionId="a1" patientId="p1" />));
    await waitFor(() => expect(container.querySelector('[data-device-line="l1"]')).not.toBeNull());
    expect(container.querySelector('[data-device-line-remove="l1"]')).not.toBeNull();
    expect(container.querySelector('[data-device-line-remove="l2"]')).toBeNull();
    fireEvent.click(getAllByText('무효')[0]);
    const btn = getAllByText('무효 처리')[0].closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('병동 층·원장 기구일수', () => {
  it('🔴 병동 층은 분석용으로 따로 그린다', async () => {
    role.v = 'ADMIN';
    get.mockResolvedValue({ data: {
      indicator: { id: 'i', name: '낙상발생률', supplierKey: 'FALL_RATE', unit: '‰', valueScale: 1000 }, period: '2026-09',
      supply: { available: true, supplierKey: 'FALL_RATE', numerator: 3, denominator: 300, evidence: {} }, ledger: [],
      strata: [{ id: 's1', wardKey: 'w1', wardName: '3층 내과병동', source: 'AUTO', numerator: 2, denominator: 200, value: 10 }],
    } });
    const { container } = render(wrap(<QiFlowPanel indicator={{ id: 'i', name: '낙상발생률', unit: '‰' } as never} />));
    fireEvent.click(container.querySelector('[data-qi-flow-tab="preview"]')!);
    await waitFor(() => expect(container.querySelector('[data-qi-stratum="w1"]')).not.toBeNull());
    expect(container.querySelector('[data-qi-strata]')!.textContent).toContain('판정은 병원 전체');
  });
  it('🔴 원천이 DEVICE_LEDGER 면 "결정 전 닫힘"이라 말하지 않는다', async () => {
    role.v = 'ADMIN';
    get.mockResolvedValue({ data: { period: '2026-09', source: 'DEVICE_LEDGER', accepting: false, wards: [], rows: [] } });
    const { container } = render(wrap(<QiFlowOps />));
    fireEvent.click(container.querySelector('[data-qi-ops-tab="device"]')!);
    await waitFor(() => expect(container.querySelector('[data-qi-device-days-ledger]')).not.toBeNull());
    expect(container.querySelector('[data-qi-device-days-closed]')).toBeNull();
  });
});
