import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 가드 — 화면 실사용 점검 W8 (2026-08-14)
 *
 * 🔴 원 결함(S3): 진료표 관리 그리드가 `AM`/`PM` 슬롯만 조회했다.
 *    운영 실측 슬롯 232건 중 **175건이 period='ALL'(종일)** 이라
 *    의사 32명 중 25명이 월~일 전부 `-`(진료 없음)로 보였다 — 진료표의 75%가 화면에서 사라졌다.
 *
 *    'ALL' 을 AM 이나 PM 중 하나로 접으면 정보를 잃는다(그 의사는 하루 종일 진료한다).
 *    그래서 종일 슬롯은 '종일' 로 따로 그린다.
 */

const g = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (path: string, params?: unknown) => g(path, params),
    post: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ClinicScheduleAdminPage from '../../src/app/(main)/admin/clinic-schedule/page';

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

// 실데이터를 축약한 표본: 종일(ALL) 의사 1명 + 오전/오후(AM/PM) 의사 1명
const WEEK = [
  {
    doctor: { id: 'd-all', familyName: '김', givenName: '종일' },
    departmentName: '내과',
    roomName: '1번실',
    slots: [
      { id: 's1', dayOfWeek: 1, period: 'ALL', startTime: '09:00', endTime: '18:00' },
      { id: 's2', dayOfWeek: 2, period: 'ALL', startTime: '09:00', endTime: '18:00' },
    ],
  },
  {
    doctor: { id: 'd-ampm', familyName: '박', givenName: '반일' },
    departmentName: '외과',
    roomName: '2번실',
    slots: [{ id: 's3', dayOfWeek: 1, period: 'AM', startTime: '09:00', endTime: '12:30' }],
  },
];

beforeEach(() => {
  g.mockReset();
  g.mockImplementation((path: string) => {
    if (path.includes('/clinic-schedule/week')) return Promise.resolve({ data: WEEK });
    if (path.includes('/clinic-closure')) return Promise.resolve({ data: [] });
    if (path.includes('/users')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

describe('진료표 관리 그리드 — 종일(ALL) 슬롯', () => {
  it("period='ALL' 슬롯이 그리드에서 사라지지 않는다", async () => {
    render(withQuery(<ClinicScheduleAdminPage />));

    await waitFor(() => expect(screen.getByText('김종일')).toBeTruthy());

    // 종일 슬롯 2건이 '종일' 로 표시된다 — '-'(진료 없음)로 접히지 않는다
    const all = await screen.findAllByText('종일');
    // 범례 1 + 슬롯 2
    expect(all.length).toBeGreaterThanOrEqual(3);

    const row = screen.getByText('김종일').closest('tr')!;
    const chips = within(row).getAllByText('종일');
    expect(chips).toHaveLength(2);
    // 🔴 UI 언어 배선 후 칩 텍스트는 `<T>` 가 만든 <span> 이다 — title 은 여전히 버튼에 있다.
    //    단언을 지우지 않고 **버튼까지 올라가 확인한다**(같은 사실을 계속 검사한다).
    expect(chips[0].closest('button')!.getAttribute('title')).toContain('09:00~18:00');
  });

  it('종일 의사의 요일이 진료 없음(-)으로 보이지 않는다', async () => {
    render(withQuery(<ClinicScheduleAdminPage />));
    await waitFor(() => expect(screen.getByText('김종일')).toBeTruthy());

    const row = screen.getByText('김종일').closest('tr')!;
    // 월·화는 종일이므로 그 칸에는 '-' 가 없다(나머지 5일은 미배정이라 '-' 가 정상)
    const dashes = within(row).queryAllByText('-');
    expect(dashes.length).toBe(5 * 2); // 7일 - 종일 2일 = 5일 × (오전/오후)
  });

  it('AM/PM 슬롯 표시는 그대로다(회귀 방지)', async () => {
    render(withQuery(<ClinicScheduleAdminPage />));
    await waitFor(() => expect(screen.getByText('박반일')).toBeTruthy());

    const row = screen.getByText('박반일').closest('tr')!;
    const marks = within(row).getAllByText('O');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('title')).toContain('09:00~12:30');
  });
});
