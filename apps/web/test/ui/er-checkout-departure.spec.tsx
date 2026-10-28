/**
 * 응급 퇴실 확인 — 퇴실 시각(2026-10-03 사람 결정 D9 `emergency.departureTimeSource` = DEPARTED_AT_FIELD).
 *  🔴 종전: `confirm()` 한 번 → 상태만 COMPLETED(시각 없음 · 응급 체류 산출 불가)
 *  · 비우면 지금(서버 처리 시각) · 실제 퇴실 시각을 넣으면 그 시각(서버가 직원 입력으로 표식) · 도착 이전은 막는다
 *  · 여정 지표: 외래 평균 체류(접수 → 수납 완료 · D8) 타일 · 뺀 수 각주
 * 재주입: 확인창·시각 전달·도착 이전 차단·외래 체류 타일을 되돌리면 실패한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
afterEach(() => cleanup());

const visit = { id: 'v1', arrivalAt: '2026-10-03T00:00:00Z' } as never;

describe('응급 퇴실 확인창', () => {
  it('🔴 비우면 시각 없이(서버가 지금으로) · 넣으면 그 시각을 ISO 로 넘긴다', async () => {
    const { CheckoutDialog } = await import('@/app/(main)/emergency/components/BedBoard');
    const onConfirm = vi.fn();
    const r = render(<CheckoutDialog visit={visit} name="홍길동" pending={false} onClose={() => {}} onConfirm={onConfirm} />);
    expect(r.container.textContent).toContain('비우면 지금 시각으로 기록합니다');
    fireEvent.click(r.container.querySelector('[data-er-checkout-confirm]')!);
    expect(onConfirm).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(r.container.querySelector('[data-er-departed-at]')!, { target: { value: '2026-10-03T11:30' } });
    expect(r.container.textContent).toContain('입력한 시각으로 기록합니다');
    fireEvent.click(r.container.querySelector('[data-er-checkout-confirm]')!);
    expect(onConfirm).toHaveBeenLastCalledWith(new Date('2026-10-03T11:30').toISOString());
  });

  it('🔴 도착보다 앞선 시각은 막는다(서버도 거부)', async () => {
    const { CheckoutDialog } = await import('@/app/(main)/emergency/components/BedBoard');
    const onConfirm = vi.fn();
    const r = render(<CheckoutDialog visit={visit} name="홍길동" pending={false} onClose={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(r.container.querySelector('[data-er-departed-at]')!, { target: { value: '2026-10-02T08:00' } });
    expect(r.container.querySelector('[data-er-departed-invalid]')).not.toBeNull();
    expect((r.container.querySelector('[data-er-checkout-confirm]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 베드 보드의 퇴실 버튼은 확인창을 연다(confirm() 한 번으로 시각 없이 종결하지 않는다) · 시각을 본문에 싣는다', () => {
    const s = readFileSync(join(process.cwd(), 'src/app/(main)/emergency/components/BedBoard.tsx'), 'utf8');
    expect(s).toMatch(/<button onClick=\{\(\) => setCheckoutTarget\(v\)\} data-er-checkout=/);
    expect(s).toMatch(/p\.departedAt \? \{ departedAt: p\.departedAt \} : \{\}/);
    expect(s).not.toMatch(/퇴실 처리할까요\?\\n\\n/);
  });
});

describe('여정 지표 — 외래 체류(D8)', () => {
  it('🔴 외래 평균 체류 타일 · 모집단(접수 → 수납 완료) · 수납 전 뺀 수 각주 · 근거 필드는 타일로 그리지 않는다', async () => {
    get.mockImplementation(async (url: string) => (url.includes('metrics') ? { data: {
      avgOutpatientWaitMinutes: 12, outpatientWaitSampleN: 3,
      avgOutpatientStayMinutes: 75, outpatientStaySampleN: 2, outpatientStayExcluded: 4,
      avgErStayHours: 3.5, erStayUnavailableReason: null, erVisitSampleN: 2, erStayExcluded: 1,
      avgLengthOfStayDays: null, admissionSampleN: 0, readmissionRate30Days: null, dischargeSampleN: 0,
    } } : { data: [] }));
    const { default: Page } = await import('@/app/(main)/journey/page');
    const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
    await waitFor(() => expect(container.textContent).toContain('외래 평균 체류'));
    expect(container.textContent).toContain('접수 → 수납 완료');
    expect(container.textContent).toContain('수납 전·미수 4건 제외');
    expect(container.textContent).toContain('도착 → 퇴실 시각');
    expect(container.textContent).toContain('진행 중이거나 퇴실 시각이 없는 1건 제외');
    expect(container.textContent).not.toContain('outpatientStayExcluded');
  });
});
