/**
 * PACU 퇴실 목적지 — 2026-09-30.
 *  · 서버가 준 선택지만 · 고르기 전에는 준비 안 됨(초기값 미선택)
 *  · 입원 중이 아니면 병동 퇴실 불가(입원 수속 안내) · 입원 중이면 귀가 불가(퇴원 절차 안내)
 *  · 🔴 조회 실패는 "선택지 없음"이 아니다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
beforeEach(() => { cleanup(); get.mockReset(); });

const adm = { id: 'adm-1', bedId: 'b1', bed: { id: 'b1', roomNumber: '501', bedNumber: '1', ward: { name: '5병동' } } };
const opts = (o: Record<string, unknown> = {}) => ({ discharged: false, activeAdmission: adm, activeIcuAdmission: null, wardBeds: [{ id: 'b9', roomNumber: '702', bedNumber: '2', ward: { name: '7병동' } }], wardBedsTruncated: false, icuBeds: [{ id: 'i1', unitName: 'MICU', bedNumber: '3' }], icuBedsTruncated: false, ...o });

describe('준비 판정', () => {
  it('병동: 입원이 있고 원 병상 또는 고른 병상 · ICU: 기존 입실 또는 병상+사유 · 귀가: 입원이 없을 때', async () => {
    const { destinationReady } = await import('@/app/(main)/pacu/DestinationPicker');
    const o = opts() as never;
    expect(destinationReady('WARD', { mode: '' }, o)).toBe(false);
    expect(destinationReady('WARD', { mode: 'RETURN' }, o)).toBe(true);
    expect(destinationReady('WARD', { mode: 'MOVE', targetBedId: '' }, o)).toBe(false);
    expect(destinationReady('WARD', { mode: 'RETURN' }, opts({ activeAdmission: null }) as never)).toBe(false);
    expect(destinationReady('ICU', { mode: 'ICU_NEW', icuBedId: 'i1', icuAdmitReason: ' ' }, o)).toBe(false);
    expect(destinationReady('ICU', { mode: 'ICU_NEW', icuBedId: 'i1', icuAdmitReason: '호흡' }, o)).toBe(true);
    expect(destinationReady('HOME', { mode: 'HOME' }, o)).toBe(false);
    expect(destinationReady('HOME', { mode: 'HOME' }, opts({ activeAdmission: null }) as never)).toBe(true);
    expect(destinationReady('WARD', { mode: 'RETURN' }, undefined)).toBe(false);
  });
});

describe('선택지 표시', () => {
  const Harness = async (disposition: string, data: unknown, fail = false) => {
    const { DestinationPicker, useDestinationOptions } = await import('@/app/(main)/pacu/DestinationPicker');
    if (fail) get.mockRejectedValue(new Error('500')); else get.mockResolvedValue({ data });
    const onChange = vi.fn();
    function H() {
      const q = useDestinationOptions('r1', true);
      return <DestinationPicker disposition={disposition} value={{ mode: '' }} onChange={onChange} q={q} role="NURSE" />;
    }
    const r = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><H /></QueryClientProvider>);
    return { ...r, onChange };
  };
  it('병동 — 원 병상을 보이고 고르면 RETURN · 입원이 없으면 입원 수속 안내', async () => {
    const a = await Harness('WARD', opts());
    await vi.waitFor(() => expect(a.container.querySelector('[data-pacu-dest="RETURN"]')).toBeTruthy());
    expect(a.container.textContent).toContain('5병동 501-1');
    fireEvent.click(a.container.querySelector('[data-pacu-dest="RETURN"]')!);
    expect(a.onChange).toHaveBeenCalledWith({ mode: 'RETURN' });
    cleanup();
    const b = await Harness('WARD', opts({ activeAdmission: null }));
    await vi.waitFor(() => expect(b.container.querySelector('[data-pacu-dest-block="NO_ADMISSION"]')).toBeTruthy());
  });
  it('귀가 — 입원 중이면 퇴원 절차 안내(귀가 선택지 없음)', async () => {
    const a = await Harness('HOME', opts());
    await vi.waitFor(() => expect(a.container.querySelector('[data-pacu-dest-block="ADMITTED"]')).toBeTruthy());
    expect(a.container.querySelector('[data-pacu-dest="HOME"]')).toBeNull();
  });
  it('🔴 조회 실패는 선택지 없음이 아니다', async () => {
    const a = await Harness('WARD', null, true);
    await vi.waitFor(() => expect(a.container.textContent).toMatch(/다시|재시도|불러오지/));
    expect(a.container.querySelector('[data-pacu-dest-block]')).toBeNull();
  });
});
