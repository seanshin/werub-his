/**
 * 의료진 관점 여정 · 임상 시계열 분석 화면(2026-10-01).
 *  · 진료 관점: 질관리 점검은 수·분모·중앙값(표본 수) · 표본 0 은 "표본 없음" · 오더 단계 줄(시각 없으면 —) · 미확인 표식 · 실패≠없음
 *  · 분석: 같은 항목 카드에 처음→최근·변화·범위 안(분모)·범위 이동 · 판정 어휘(호전·악화) 없음 · 처방 전후 비교는 "관련성 판단 아님"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients/p1', useSearchParams: () => new URLSearchParams() }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

const S = (value: number | null, n: number) => ({ value, n });
const LENS = {
  period: { from: '2026-07-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
  orders: [
    { id: 'o1', department: 'LAB', name: 'CBC', status: 'COMPLETED', priority: 'STAT',
      stages: [{ key: 'ORDERED', at: '2026-09-30T00:00:00Z' }, { key: 'RECEIVED', at: '2026-09-30T00:30:00Z' }, { key: 'COLLECTED', at: '2026-09-30T00:30:00Z' }, { key: 'RESULTED', at: '2026-09-30T02:00:00Z' }, { key: 'VERIFIED', at: null }, { key: 'ACKNOWLEDGED', at: null }],
      orderToResultMin: 120, resultToAckMin: null, critical: true, abnormal: true, unacknowledged: true, waitingSinceMin: null, collectedSameAsReceived: true },
    { id: 'o2', department: 'IMAGING', name: 'CT ABDOMEN', status: 'ORDERED', priority: 'ROUTINE',
      stages: [{ key: 'ORDERED', at: '2026-09-30T00:00:00Z' }, { key: 'RECEIVED', at: null }, { key: 'ACQUIRED', at: null }, { key: 'REPORTED', at: null }, { key: 'ACKNOWLEDGED', at: null }],
      orderToResultMin: null, resultToAckMin: null, critical: false, abnormal: false, unacknowledged: false, waitingSinceMin: 300, collectedSameAsReceived: false },
  ],
  prescriptions: [{
    id: 'p1', type: 'MEDICATION', name: '아토르바스타틴', status: 'ACTIVE', priority: 'ROUTINE', createdAt: '2026-09-29T00:00:00Z', dosage: '10mg', frequency: '1일 1회',
    dosing: { state: 'DOSING', endsAt: null }, orderSource: 'VERBAL', verbal: { readBackAt: '2026-09-29T00:01:00Z', cosignedAt: null },
    dur: { checked: true, overridden: true, warnings: 2 }, discontinuedAt: null, discontinueReason: null, renewedFromId: null, dischargeMed: false,
    mar: { total: 4, administered: 2, held: 0, refused: 0, missed: 0, pastDueUnrecorded: 1, delayMedianMin: S(-10, 2) },
  }],
  criticals: [{ id: 'c1', testName: 'K', value: '6.8', unit: 'mmol/L', status: 'PENDING', notifiedAt: '2026-09-30T02:00:00Z', acknowledgedAt: null, actedAt: null, escalatedAt: null, closedAt: null, toAckMin: null }],
  truncated: { orders: false, prescriptions: false, criticals: false },
  quality: {
    resultAck: { numerator: 0, denominator: 1 }, resultToAckMin: S(null, 0), orderToResultMin: { LAB: S(120, 1), IMAGING: S(null, 0) },
    awaitingReceipt: { n: 1, oldestMin: 300 }, critical: { total: 1, unacknowledged: 1, toAckMin: S(null, 0) },
    verbal: { total: 1, uncosigned: 1 }, dur: { medications: 1, checked: 1, overridden: 1 },
    mar: { scheduledPast: 3, recorded: 2, pastDueUnrecorded: 1, delayMin: S(-10, 2) }, discontinued: 0, renewed: 0,
  },
};

describe('진료 관점 여정', () => {
  it('🔴 질관리 점검은 수·분모·표본 — 표본 0 은 "표본 없음" · 단계 줄 · 미확인·접수 대기·위급 표식', async () => {
    get.mockResolvedValue({ data: LENS });
    const { ClinicalLensView } = await import('@/components/journey/clinical-lens-view');
    const { container } = render(<ClinicalLensView patientId="p1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-clinical-quality]')).not.toBeNull());
    const text = container.textContent ?? '';
    expect(text).toContain('0 / 1'); // 결과 의사 확인 — 분모 병기
    expect(text).toContain('표본 없음');
    expect(text).toContain('결과 미확인');
    expect(text).toContain('접수 대기');
    expect(text).toContain('의사 확인');
    expect(text).toContain('—'); // 시각 없는 단계
    expect(text).toContain('채취 기록이 없는 과거 검사는 검사실 접수 순간이');
    expect(text).toContain('이른'); // 예정보다 이른 투약 중앙값
    expect(text).toContain('사후 확인');
    expect(text).toContain('미확인');
    expect(get).toHaveBeenCalledWith('/api/v1/journey/p1/clinical-lens', expect.objectContaining({ from: expect.any(String) }));
  });
  it('미확인·접수 대기만 거르기 · 부서 필터', async () => {
    get.mockResolvedValue({ data: LENS });
    const { ClinicalLensView } = await import('@/components/journey/clinical-lens-view');
    const { container } = render(<ClinicalLensView patientId="p1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelectorAll('[data-lens-order]').length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: '영상' }));
    expect(container.querySelectorAll('[data-lens-order]').length).toBe(1);
  });
  it('🔴 조회 실패는 실패로 — 빈 화면이 아니다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { ClinicalLensView } = await import('@/components/journey/clinical-lens-view');
    const { container } = render(<ClinicalLensView patientId="p1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-clinical-quality]')).toBeNull());
    await waitFor(() => expect(container.textContent).not.toContain('이 기간 처방이 없습니다'));
  });
  it('여정 탭에서 두 관점을 오간다', async () => {
    get.mockImplementation(async (url: string) => (url.includes('clinical-lens') ? { data: LENS } : url.includes('/report') ? { data: null } : { data: [], meta: {} }));
    const { JourneyTab } = await import('@/app/(main)/patients/[id]/components/JourneyTab');
    const { container } = render(<JourneyTab patientId="p1" />, { wrapper: wrap });
    fireEvent.click(screen.getByRole('tab', { name: '진료 관점(처방·오더·질관리)' }));
    await waitFor(() => expect(container.querySelector('[data-clinical-lens]')).not.toBeNull());
  });
});

const ANALYTICS = {
  period: { from: '2025-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
  analytes: [{
    key: 'loinc:4548-4', kind: 'LAB', name: 'HbA1c (당화혈색소)', unit: '%', codes: { loinc: '4548-4', code: null },
    n: 3, first: { at: '2026-07-01T00:00:00Z', value: 7.05 }, last: { at: '2026-09-01T00:00:00Z', value: 5.44 },
    delta: -1.61, deltaPct: -22.8, min: 5.44, max: 7.05, median: 6.1, slopePer30d: -0.8,
    range: { low: 4, high: 6, source: 'LAB_REFERENCE' }, inRange: { numerator: 1, denominator: 3 }, abnormal: 2, critical: 0, rangeMove: 'ENTERED',
    excluded: { nonNumeric: 1, otherUnit: 0 },
    series: [{ at: '2026-07-01T00:00:00Z', value: 7.05, flag: 'H', range: 'OUT' }, { at: '2026-08-01T00:00:00Z', value: 6.1, flag: 'H', range: 'OUT' }, { at: '2026-09-01T00:00:00Z', value: 5.44, flag: null, range: 'IN' }],
    medEffects: [{ medId: 'm1', name: '메트포르민', start: '2026-07-15T00:00:00Z', meanBefore: 7.05, nBefore: 2, meanAfter: 5.77, nAfter: 2 }],
  }],
  meds: [{ id: 'm1', name: '메트포르민', status: 'ACTIVE', start: '2026-07-15T00:00:00Z', end: null, endKnown: false, ongoing: true }],
  summary: { analytes: 1, latestOutOfRange: 0, criticalPoints: 0, largestChanges: [{ key: 'loinc:4548-4', name: 'HbA1c (당화혈색소)', deltaPct: -22.8 }] },
  truncated: { labs: false, vitals: false, meds: false },
  vitalsThresholdSource: 'DEFAULT',
};

describe('임상 시계열 분석', () => {
  it('🔴 수치 사실만 — 처음→최근·변화·범위 안(분모)·범위 이동 · 판정 어휘 없음 · 처방 전후는 관련성 판단 아님', async () => {
    get.mockResolvedValue({ data: ANALYTICS });
    const { AnalyticsView } = await import('@/components/record-timeline/AnalyticsView');
    const { container } = render(<AnalyticsView patientId="p1" months={12} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-record-analytics]')).not.toBeNull());
    const text = container.textContent ?? '';
    expect(text).toContain('7.05 → 5.44');
    expect(text).toContain('-1.61');
    expect(text).toContain('1 / 3');
    expect(text).toContain('범위 밖 → 안');
    expect(text).toContain('관련성 판단 아님');
    expect(text).toContain('수치 아님 1');
    expect(text).toContain('처방 기간');
    expect(text).not.toMatch(/호전|악화|개선됨|나빠짐/);
    expect(container.querySelectorAll('svg circle').length).toBe(3);
  });
  it('빈 결과·실패를 구분한다', async () => {
    const { AnalyticsView } = await import('@/components/record-timeline/AnalyticsView');
    get.mockResolvedValue({ data: { ...ANALYTICS, analytes: [] } });
    const a = render(<AnalyticsView patientId="p1" months={12} />, { wrapper: wrap });
    await waitFor(() => expect(a.container.textContent).toContain('분석할 수치 기록이 없습니다'));
    cleanup();
    get.mockRejectedValue(new Error('500'));
    const b = render(<AnalyticsView patientId="p1" months={12} />, { wrapper: wrap });
    await waitFor(() => expect(b.container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(b.container.textContent).not.toContain('분석할 수치 기록이 없습니다');
  });
});
