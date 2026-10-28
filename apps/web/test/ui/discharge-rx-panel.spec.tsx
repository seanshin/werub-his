/**
 * 퇴원약 오더화 화면 — 2026-09-30.
 *  1. 퇴원약 처방 패널 — 입원 약에서 옮기면 용량·횟수만 참고로 옮기고 일수·총량·조제 구분은 비워 둔다 · 다 정해야 보낸다
 *  2. 조회 실패는 "퇴원약 없음"이 아니다
 *  3. 퇴원약 표시 정본 — 문자열·객체 두 모양 · 워크스테이션이 객체를 React 자식으로 그리지 않는다(종전 화면 사망)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const inpatient = { id: 'in1', status: 'ACTIVE', dosage: '500mg', frequency: 'bid', duration: 10, quantity: 20, route: 'PO', dispensingType: 'INTERNAL', medicationCode: { id: 'm1', code: 'C1', nameKo: '세파클러' }, orders: [] };
const list = (items: unknown[] = []) => ({ data: { admissionStatus: 'ADMITTED', encounterId: 'e1', items, inpatientActive: [inpatient], inpatientTruncated: false } });

describe('퇴원약 처방 패널', () => {
  const mount = async (canWrite = true) => {
    const { DischargeRxPanel } = await import('@/components/prescription/DischargeRxPanel');
    return render(<DischargeRxPanel admissionId="a1" canWrite={canWrite} />, { wrapper: wrap });
  };
  it('입원 약에서 옮기면 용량·횟수만 채우고 일수·총량·조제 구분은 비운다 · 다 정해야 보낸다 · 입력값으로 퇴원약 EP', async () => {
    get.mockResolvedValue(list());
    post.mockResolvedValue({ data: { id: 'n' }, durWarnings: [] });
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-discharge-rx-from="in1"]')).toBeTruthy());
    expect(container.querySelector('[data-discharge-rx-empty]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-discharge-rx-from="in1"]')!);
    const days = container.querySelector('[data-discharge-rx-days]') as HTMLInputElement;
    expect(days.value).toBe(''); // 입원 약의 10일을 복사하지 않는다
    expect((container.querySelector('[data-discharge-rx-quantity]') as HTMLInputElement).value).toBe('');
    const btn = container.querySelector('[data-discharge-rx-submit]') as HTMLButtonElement;
    fireEvent.change(days, { target: { value: '7' } });
    fireEvent.change(container.querySelector('[data-discharge-rx-quantity]')!, { target: { value: '14' } });
    expect(btn.disabled).toBe(true); // 조제 구분 미선택
    fireEvent.click(container.querySelector('[data-discharge-rx-dispense="EXTERNAL"]')!);
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/admissions/a1/discharge-prescriptions', {
      type: 'MEDICATION', medicationCodeId: 'm1', dosage: '500mg', frequency: 'bid', route: 'PO', duration: 7, quantity: 14, dispensingType: 'EXTERNAL',
    }));
  });
  it('🔴 조회 실패면 "퇴원약 없음"을 말하지 않는다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/));
    expect(container.querySelector('[data-discharge-rx-empty]')).toBeNull();
  });
  it('퇴원약 행 — 처방·오더 상태 · 쓰기 권한이 없으면 옮기기·중단이 없다', async () => {
    get.mockResolvedValue(list([{ ...inpatient, id: 'd1', medicationCode: { id: 'm2', code: 'C2', nameKo: '아목시실린' }, orders: [{ id: 'o', status: 'ORDERED' }] }]));
    const { container } = await mount(false);
    await vi.waitFor(() => expect(container.querySelector('[data-discharge-rx-row="ACTIVE"]')).toBeTruthy());
    expect(container.textContent).toContain('아목시실린');
    expect(container.querySelector('[data-discharge-rx-from]')).toBeNull();
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('중단');
  });
});

describe('퇴원약 표시 정본', () => {
  it('문자열·객체 두 모양을 읽는다', async () => {
    const { dischargeMedLabel, dischargeMedName, asDischargeMedList } = await import('@/lib/discharge-med');
    const days = (n: number) => `${n}d`;
    expect(dischargeMedLabel('아스피린 100mg', days)).toBe('아스피린 100mg');
    expect(dischargeMedLabel({ name: '세파클러', dosage: '500mg', frequency: 'bid', duration: 7 }, days)).toBe('세파클러 · 500mg · bid · 7d');
    expect(dischargeMedName({ drugName: 'X' })).toBe('X');
    expect(asDischargeMedList(null)).toEqual([]);
    expect(asDischargeMedList([{ name: 'a' }, 'b', null])).toHaveLength(2);
  });
  it('🔴 두 퇴원 화면이 퇴원약을 원시값으로 그리거나 join 하지 않는다', () => {
    const ws = readFileSync(join(process.cwd(), 'src/app/(main)/workstation/discharge/page.tsx'), 'utf8');
    const ds = readFileSync(join(process.cwd(), 'src/app/(main)/inpatient/[admissionId]/discharge-summary/page.tsx'), 'utf8');
    // 주석이 아니라 JSX 자식으로 쓰인 자리만 본다(주석은 이 결함을 설명하느라 `{med}` 를 적는다)
    expect(ws).not.toMatch(/>\s*\{med\}\s*</);
    expect(ws).not.toMatch(/dischargeMedications\??\.(join|slice|map)\(/);
    expect(ds).not.toMatch(/dischargeMedications\??\.(join|slice|map)\(/);
    expect(ws).toContain('<DischargeRxPanel');
    expect(ds).toContain('<DischargeRxPanel');
  });
});
