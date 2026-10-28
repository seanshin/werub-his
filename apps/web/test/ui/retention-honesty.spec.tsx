import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

/**
 * 🔴 T10(A1) — `/admin/retention` 이 **세지 않은 것을 0 으로, 미확정을 "대기"로** 말하지 않는다 (2026-09-13).
 *
 *  ① 정책 목록: `lastCandidates=null`(핸들러 없음) 은 "후보 0건"이 아니라 "세지 않음(핸들러 없음)".
 *     종전엔 서버가 미지원에도 0 을 저장해 운영 5행 전부 "후보 0건"이었다.
 *  ② 법무 미확정은 "파기 불가"로 눈에 띄게 — 배너가 미확정 수와 분모를 함께 말한다.
 *  ③ DRY-RUN 은 두 기산점을 병기하고, 환자 귀속이 없는 기록은 "해당 없음"(0 이 아니다).
 *  ④ 법정 종류: 미매핑은 "세지 않음(미매핑)", 원문을 대조하지 못한 출처는 그 사실을 표시한다.
 */

const policies = [
  { id: 'p1', resourceType: 'MEDICAL_RECORD', retentionDays: 3650, legalMinDays: 3650, action: 'ANONYMIZE', legalConfirmed: false, enabled: true, lastRunAt: '2026-09-13T01:00:00Z', lastCandidates: 12 },
  { id: 'p2', resourceType: 'NEW_KIND', retentionDays: 30, legalMinDays: 0, action: 'REPORT_ONLY', legalConfirmed: false, enabled: true, lastRunAt: '2026-09-13T01:00:00Z', lastCandidates: null },
  { id: 'p3', resourceType: 'PRE_BOARD_ACCOUNT', retentionDays: 30, legalMinDays: 0, action: 'SOFT_DELETE', legalConfirmed: true, enabled: true, lastRunAt: null, lastCandidates: null },
];
const report = {
  dryRun: true, generatedAt: '2026-09-13T01:00:00Z',
  policies: [
    { resourceType: 'MEDICAL_RECORD', action: 'ANONYMIZE', retentionDays: 3650, legalMinDays: 3650, legalConfirmed: false, cutoff: '2016-09-13T00:00:00Z', candidates: 12, candidatesByLastEncounterAt: 3, oldestAt: '2015-01-01T00:00:00Z', supported: true, wouldPurge: false },
    { resourceType: 'AUDIT_LOG', action: 'REPORT_ONLY', retentionDays: 1095, legalMinDays: 365, legalConfirmed: false, cutoff: '2023-09-13T00:00:00Z', candidates: 5, candidatesByLastEncounterAt: null, oldestAt: '2020-01-01T00:00:00Z', supported: true, wouldPurge: false },
    { resourceType: 'NEW_KIND', action: 'REPORT_ONLY', retentionDays: 30, legalMinDays: 0, legalConfirmed: false, cutoff: '2026-08-14T00:00:00Z', candidates: null, candidatesByLastEncounterAt: null, oldestAt: null, supported: false, wouldPurge: false },
  ],
};
const legalKinds = (country: string) => ({
  country, generatedAt: '2026-09-13T01:00:00Z', periodsConfirmed: false,
  kinds: country === 'AE'
    ? [{ key: 'HEALTH_DATA', country: 'AE', legalName: 'Health data (health information and records)', mapping: 'UNMAPPED', sources: [], note: '법이 기록 종류를 나누지 않고 보건 데이터 전반을 대상으로 한다(2차 출처) — 특정 모델 하나로 매핑하지 않는다', source: { label: 'UAE Federal Law No. 2 of 2019', url: 'https://example.org/ae', sourceVerified: false }, counted: false, total: null, oldestCreatedAt: null, oldestLastEncounterAt: null }]
    : [{ key: 'NURSING_RECORD', country: 'KR', legalName: '간호기록부', mapping: 'MAPPED', sources: ['NURSING_NOTE', 'UNIVERSAL_NURSING_NOTE'], note: '입원 간호기록(nursing_notes)과 범용 간호기록(universal_nursing_notes)의 합', source: { label: '의료법 시행규칙 제15조', url: 'https://example.org/kr', sourceVerified: false }, counted: true, total: 8, oldestCreatedAt: '2020-06-01T00:00:00Z', oldestLastEncounterAt: '2023-01-01T00:00:00Z' }],
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (p: string) => {
      if (p.includes('/retention/policies')) return Promise.resolve({ data: policies });
      if (p.includes('/retention/approvals')) return Promise.resolve({ data: [] });
      if (p.includes('/retention/report')) return Promise.resolve({ data: report });
      if (p.includes('/retention/legal-kinds')) return Promise.resolve({ data: legalKinds(p.includes('country=AE') ? 'AE' : 'KR') });
      return Promise.resolve({ data: null });
    },
    post: async () => ({ data: {} }),
    put: async () => ({ data: {} }),
    getToken: () => 't',
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const wrap = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const load = async () => (await import('../../src/app/(main)/admin/retention/page')).default;

beforeEach(() => { document.body.innerHTML = ''; });

describe('/admin/retention — 세지 않은 것·미확정을 사실대로 말한다', () => {
  it('① 🔴 정책 목록: lastCandidates=null 은 "후보 0건"이 아니라 "세지 않음"', async () => {
    const Page = await load();
    wrap(<Page />);
    const row = (await screen.findByText('NEW_KIND')).closest('tr')!;
    expect(row.textContent).toContain('세지 않음(핸들러 없음)');
    expect(row.textContent).not.toMatch(/후보\s*0\s*건/);
    const mr = screen.getByText('MEDICAL_RECORD').closest('tr')!;
    expect(mr.textContent).toMatch(/후보\s*12\s*건/);
  });

  it('② 법무 미확정은 "파기 불가"로, 배너가 미확정 수와 분모를 함께 말한다', async () => {
    const Page = await load();
    wrap(<Page />);
    const banner = await screen.findByTestId('retention-unconfirmed-banner');
    expect(banner.textContent).toContain('법무 미확정 정책 2 / 전체 3');
    expect(screen.getByText('MEDICAL_RECORD').closest('tr')!.textContent).toContain('법무 미확정 — 파기 불가');
    expect(screen.getByText('PRE_BOARD_ACCOUNT').closest('tr')!.textContent).toContain('확정');
  });

  it('③ DRY-RUN 은 두 기산점을 병기하고, 환자 귀속이 없으면 "해당 없음"·미지원은 "세지 않음"', async () => {
    const Page = await load();
    wrap(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /DRY-RUN 실행/ }));
    await waitFor(() => expect(screen.getByText('후보(마지막 진료일 기준)')).toBeTruthy());
    const table = screen.getByText('후보(마지막 진료일 기준)').closest('table')!;
    const mr = within(table).getByText('MEDICAL_RECORD').closest('tr')!;
    expect(mr.textContent).toMatch(/12건/);
    expect(mr.textContent).toMatch(/3건/);
    const audit = within(table).getByText('AUDIT_LOG').closest('tr')!;
    expect(audit.textContent).toContain('해당 없음');
    const nk = within(table).getByText('NEW_KIND').closest('tr')!;
    expect(nk.textContent).not.toMatch(/\b0건/);
    expect(nk.textContent).toContain('세지 않음(핸들러 없음)');
  });

  it('④ 법정 종류: 매핑된 종류는 보유량·두 최고령, 미매핑은 "세지 않음(미매핑)", 원문 미대조를 표시한다', async () => {
    const Page = await load();
    wrap(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /한국 보유 현황/ }));
    const kr = await screen.findByTestId('retention-legal-kinds');
    expect(kr.textContent).toContain('간호기록부');
    expect(kr.textContent).toMatch(/8건/);
    expect(kr.textContent).toContain('원문 미대조(2차 출처)');
    expect(kr.textContent, '기간 값을 그리지 않는다').toContain('보존 기간 값은 이 목록에 없습니다');

    fireEvent.click(screen.getByRole('button', { name: /UAE 보유 현황/ }));
    await waitFor(() => expect(screen.getByTestId('retention-legal-kinds').textContent).toContain('Health data'));
    const ae = screen.getByTestId('retention-legal-kinds');
    expect(ae.textContent).toContain('세지 않음(미매핑)');
    expect(ae.textContent).not.toMatch(/\b0건/);
  });
});
