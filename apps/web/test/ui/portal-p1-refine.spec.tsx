/**
 * 환자 포털 세련화 P1(2026-10-19 · 기획 patient-portal-refinement-2026-10 §4 A2·A3·A5).
 *  · A2 🔴 예약 상태가 영문 코드(`CHECKED_IN`) · 지난 예약이 "예약 내역" 맨 위 · 기초검사 카드 이름 없는 "NORMAL"(서버 testName ↔ 화면 name · P11)
 *       · 판정 단어 "이상"·"위험"·"높음"·"🔴 위험" 혼재
 *  · A3 검사결과 = 최근 검사 기준 밖 요약 → 날짜별 접힘(최신만 펼침)
 *  · A5 떠 있는 버튼 둘(왼쪽 상담실·오른쪽 AI) → 도움 버튼 하나
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(async (_url: string): Promise<unknown> => ({ data: [] })), post: vi.fn(), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
beforeEach(() => cleanup());

describe('A2 — 판정 단어 정본', () => {
  it('flag → 판정(위급을 높음으로 격하하지 않음 · 방향 모름은 이상) · 검진·기초검사 · 모르는 값은 판정 미상', async () => {
    const { labFlagJudgment, findingJudgment, conclusionJudgment } = await import('@/app/portal/_shared/judgment');
    expect(['H', 'L', 'HH', 'LL', 'A', 'AA', 'N', null].map(labFlagJudgment)).toEqual(['HIGH', 'LOW', 'CRITICAL_HIGH', 'CRITICAL_LOW', 'ABNORMAL', 'CRITICAL', 'NORMAL', null]);
    expect(['NORMAL', 'ABNORMAL', 'CRITICAL', 'X', undefined].map(findingJudgment)).toEqual(['NORMAL', 'ABNORMAL', 'CRITICAL', 'UNKNOWN', 'UNKNOWN']);
    expect(['NORMAL', 'BORDERLINE', 'ABNORMAL', 'Normal sinus', null].map(conclusionJudgment)).toEqual(['NORMAL', 'BORDERLINE', 'ABNORMAL', 'UNKNOWN', 'UNKNOWN']);
  });
  it('🔴 건강 탭에 지역 판정 단어("위험")·지역 flag 라벨 함수가 남지 않는다', () => {
    const s = src('src/app/portal/_health/HealthTab.tsx');
    expect(s).not.toMatch(/function flagLabel/);
    expect(s).not.toMatch(/'위험'|>위험</);
  });
});

describe('🔴 A2 — 기초검사 카드(서버 testName·testType·findings)', () => {
  it('서버 계약 → 화면 모양 · 없는 값은 null', async () => {
    const { toDiagnosticTest } = await import('@/app/portal/_helpers');
    expect(toDiagnosticTest({ id: 'd1', testType: 'EEG', testName: '뇌파검사', performedAt: '2026-06-02T01:00:00Z', conclusion: 'NORMAL', findings: 'Normal sinus rhythm', release: 'REVIEWED', reviewedAt: '2026-06-02T03:00:00Z' }))
      .toEqual({ id: 'd1', type: 'EEG', name: '뇌파검사', performedAt: '2026-06-02T01:00:00Z', conclusion: 'NORMAL', findings: 'Normal sinus rhythm', release: 'REVIEWED', reviewedAt: '2026-06-02T03:00:00Z' }); // 공개 상태(2026-10-20 B8)
    expect(toDiagnosticTest({ id: 'd2', testType: 'PFT', testName: '', performedAt: '2026-06-01', conclusion: null, findings: null })).toMatchObject({ name: null, conclusion: null });
  });
  it('렌더 — 검사명·결론 단어(코드 아님) · 날짜별 묶음 최신만 펼침 · 최근 검사 기준 밖 요약', async () => {
    const { default: HealthTab } = await import('@/app/portal/_health/HealthTab');
    const data = {
      labResults: [
        { id: 'l1', orderName: '일반 혈액', orderedAt: '2026-05-28T01:00:00Z', items: [{ name: 'LDL', value: '162', unit: 'mg/dL', flag: 'H' }, { name: 'Hb', value: '14', unit: 'g/dL', flag: 'N' }] },
        { id: 'l2', orderName: '이전 검사', orderedAt: '2025-03-23T01:00:00Z', items: [{ name: 'ALT', value: '47', unit: 'IU/L', flag: 'HH' }] },
      ],
      diagnosticTests: [{ id: 'd1', type: 'EEG', name: '뇌파검사', performedAt: '2026-05-28T03:00:00Z', conclusion: 'NORMAL', findings: null }, { id: 'd2', type: 'PFT', name: null, performedAt: '2026-05-28T03:00:00Z', conclusion: 'BORDERLINE', findings: null }],
      allergies: [], medications: [], appointments: [], encounters: [], billings: [], questionnaires: [],
    };
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><HealthTab patient={{ id: 'p1' } as never} data={data as never} /></QueryClientProvider>);
    });
    const days = [...v.container.querySelectorAll('details[data-portal-result-day]')] as HTMLDetailsElement[];
    expect(days.map((d) => d.dataset.portalResultDay)).toEqual(['2026-05-28', '2025-03-23']);
    expect(days.map((d) => d.open)).toEqual([true, false]);
    const diag = [...v.container.querySelectorAll('[data-portal-diagnostic]')].map((e) => e.textContent);
    expect(diag[0]).toContain('뇌파검사'); expect(diag[0]).toContain('정상'); expect(diag[0]).not.toContain('NORMAL');
    expect(diag[1]).toContain('폐기능'); expect(diag[1]).toContain('경계'); // 이름이 비면 정본 종류 라벨
    const sum = v.container.querySelector('[data-portal-latest-abnormal]')!.textContent!;
    expect(sum).toContain('LDL'); expect(sum).toContain('높음'); expect(sum).not.toContain('ALT'); // 최근 날짜만
    expect(days[1].querySelector('[data-judgment="CRITICAL_HIGH"]')).not.toBeNull(); // 위급을 높음으로 격하하지 않는다
  });
});

describe('A2 — 예약 다가오는/지난', () => {
  it('끝난 상태·오늘 이전은 지난 예약(최신 먼저) · 다가오는 것은 이른 순', async () => {
    const { splitAppointments } = await import('@/app/portal/_care/CareTab');
    const now = new Date('2026-10-19T03:00:00Z'); // KST 12시
    const r = splitAppointments([
      { id: 'a', scheduledAt: '2026-08-10T01:00:00Z', status: 'CHECKED_IN' },
      { id: 'b', scheduledAt: '2026-10-25T01:00:00Z', status: 'SCHEDULED' },
      { id: 'c', scheduledAt: '2026-10-20T01:00:00Z', status: 'CANCELLED' },
      { id: 'd', scheduledAt: '2026-10-19T00:30:00Z', status: 'CONFIRMED' }, // 오늘 아침(KST 09:30) — 오늘은 다가오는 쪽
      { id: 'e', scheduledAt: '2026-10-21T01:00:00Z', status: 'SCHEDULED' },
    ], now);
    expect(r.upcoming.map((a) => a.id)).toEqual(['d', 'e', 'b']);
    expect(r.past.map((a) => a.id)).toEqual(['c', 'a']);
  });
});

describe('A5 — 도움 버튼 하나', () => {
  it('상담실은 자기 여는 버튼이 없고 신호로 열린다 · 포털 도움 버튼이 상담실·AI 를 메뉴로', () => {
    const consult = src('src/app/portal/_consult/ConsultChat.tsx');
    expect(consult).not.toMatch(/aria-label=\{tAttr\('상담실 열기'\)\}/);
    expect(consult).toMatch(/window\.addEventListener\(PORTAL_OPEN_CONSULT/);
    const page = src('src/app/portal/page.tsx');
    expect(page).toMatch(/data-portal-help-launcher/);
    expect(page).toMatch(/window\.dispatchEvent\(new Event\(PORTAL_OPEN_CONSULT\)\)/);
    expect((page.match(/className="fixed bottom-(?!0 )/g) ?? []).length).toBe(2); // 도움 버튼 + 메뉴(하단 탭 bottom-0 제외)
  });
});

describe('🔴 R5 — 활력 숫자에 측정 날짜·출처', () => {
  it('외래 진료 전 측정 · 날짜 · BMI 는 수치 정본 자릿수 · 측정 기록 없으면 출처 줄 없음', async () => {
    const { default: HealthTab } = await import('@/app/portal/_health/HealthTab');
    const data = { labResults: [], diagnosticTests: [], allergies: [], medications: [], appointments: [], encounters: [], billings: [], questionnaires: [] };
    const mount = async (vitals: unknown) => {
      cleanup();
      api.get.mockImplementation(async (url: string) => (url === '/api/v1/portal/health-dashboard' ? { data: { vitals, activeRx: [], allergies: [] } } : { data: [] }));
      let v!: ReturnType<typeof render>;
      await act(async () => { v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><HealthTab patient={{ id: 'p1' } as never} data={data as never} /></QueryClientProvider>); });
      return v;
    };
    const v = await mount({ systolicBp: 190, diastolicBp: 115, weight: 70, height: 175, measuredAt: '2026-05-28T01:00:00Z' });
    await vi.waitFor(() => expect(v.container.querySelector('[data-portal-vitals-source]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-vitals-source]')!.textContent).toMatch(/외래 진료 전 측정.*2026/);
    expect(v.container.textContent).toContain('22.9');
    const none = await mount(null);
    await vi.waitFor(() => expect(none.container.textContent).toContain('활성 처방'));
    expect(none.container.querySelector('[data-portal-vitals-source]')).toBeNull();
  });
});
