/**
 * 수술실 실시간 모니터·질 지표 화면(2026-10-05).
 *  · 단계: 기록된 시각만 채운다(없는 단계는 '—' · 지났다고 그리지 않는다) · 지금 단계 강조
 *  · 활력: 마취 기록 점이 없으면 "수술 중 활력 기록 없음" · 예상 없으면 초과 판정 안 함
 *  · 질 지표: 수술 안전은 정본 qi EP 를 부른다 · 정시 기준 미설정이면 정시율 대신 그 사실 · 조회 실패 ≠ 0
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/surgery', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const NOW = new Date().toISOString();
const ph = (over: Record<string, string | null>) => ['SIGN_IN', 'INDUCTION', 'TIME_OUT', 'START', 'INCISION', 'CLOSURE', 'SIGN_OUT', 'END', 'PACU_IN', 'PACU_OUT'].map((key) => ({ key, at: over[key] ?? null }));
const liveCase = (over: Record<string, unknown> = {}) => ({
  id: 's1', status: 'IN_PROGRESS', procedureName: '복강경 담낭절제', bodySite: null, laterality: null,
  scheduledAt: NOW, startedAt: new Date(Date.now() - 90 * 60_000).toISOString(), endedAt: null,
  patient: { id: 'p1', name: '김하나', mrn: 'M1' }, surgeon: '박외과', anesthesiaType: 'GENERAL',
  phases: ph({ SIGN_IN: NOW, TIME_OUT: NOW, START: NOW }), lastPhase: 'START',
  runMin: 90, estimatedMin: 60, overrunMin: 30,
  safety: { checklistPresent: true, signIn: true, timeOut: true, signOut: false, countStatus: null, countUnresolved: false, lateralitySet: false },
  preAnesthesia: null, asaClass: '2',
  anesthesia: { inductionAt: null, intubationAt: null, extubationAt: null, ebl: null, urineOutput: null, vitals: null, vitalsTotal: null, vitalsTruncated: false, lastVitalAt: null },
  ebl: null, pacu: null, slot: { startTime: '10:00', endTime: '11:00', estimatedDuration: 60, plannedStart: NOW, plannedEnd: new Date(Date.now() + 3600_000).toISOString() },
  ...over,
});
const board = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-05', now: NOW,
  rooms: [{ id: 'r1', name: 'OR-1', floor: '3F', roomType: 'GENERAL', state: 'IN_USE', currentCaseId: 's1', nextCaseId: null, cases: [liveCase()] }],
  unassigned: [],
  summary: { rooms: 1, inUse: 1, inProgress: 1, scheduled: 0, completed: 0, overrun: 1, staleInProgress: 1 },
  ...over,
});

beforeEach(() => { cleanup(); get.mockReset(); });

async function live(data: unknown) {
  get.mockResolvedValue({ data });
  const { default: C } = await import('@/app/(main)/surgery/components/SurgeryLiveBoard');
  return render(<C />, { wrapper: wrap });
}

describe('실시간 모니터', () => {
  it('🔴 기록 없는 단계는 "—"(지났다고 그리지 않는다) · 예상 초과 · 활력 기록 없음 · 종료 누락 의심 고지', async () => {
    const { container } = await live(board());
    await waitFor(() => expect(container.textContent).toContain('복강경 담낭절제'));
    expect(get).toHaveBeenCalledWith('/api/v1/surgery/live-board');
    const phases = container.querySelector('ol')!;
    expect(phases.textContent).toMatch(/마취 유도—/);
    expect(phases.textContent).toMatch(/절개—/);
    expect(container.textContent).toMatch(/\+30분 초과/);
    expect(container.textContent).toContain('수술 중 활력 기록 없음');
    expect(container.textContent).toContain("아직 '진행 중'인 수술 1건");
    expect(container.textContent).toContain('오늘 수술방 일정');
  });

  it('예상이 없으면 초과를 판정하지 않는다고 말한다 · 활력 점이 있으면 마지막 값', async () => {
    const vit = [{ at: NOW, heartRate: 88, systolicBp: 120, diastolicBp: 70, spo2: 98, etco2: 35 }, { at: NOW, heartRate: 92, systolicBp: 118, diastolicBp: 72, spo2: 99, etco2: 36 }];
    const { container } = await live(board({ rooms: [{ id: 'r1', name: 'OR-1', floor: null, roomType: 'G', state: 'IN_USE', currentCaseId: 's1', nextCaseId: null,
      cases: [liveCase({ estimatedMin: null, overrunMin: null, anesthesia: { inductionAt: null, intubationAt: null, extubationAt: null, ebl: null, urineOutput: null, vitals: vit, vitalsTotal: 2, vitalsTruncated: false, lastVitalAt: NOW } })] }] }));
    await waitFor(() => expect(container.querySelector('[data-intraop-vitals]')).toBeTruthy());
    expect(container.textContent).toContain('예상 소요 없음 — 초과를 판정하지 않습니다');
    expect(container.querySelector('[data-intraop-vitals]')!.textContent).toMatch(/99.*118\/72.*92.*36/);
  });

  it('🔴 조회 실패를 "수술 없음"으로 말하지 않는다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { default: C } = await import('@/app/(main)/surgery/components/SurgeryLiveBoard');
    const { container } = render(<C />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).not.toBe(''));
    expect(container.textContent).not.toContain('진행 중인 수술 없음');
  });
});

describe('질 지표', () => {
  const quality = {
    period: { from: '2026-10-01', to: '2026-10-05' },
    volume: { scheduled: 5, performed: 4, completed: 3, cancelled: { numerator: 1, denominator: 5 } },
    firstCaseStart: { n: 2, median: 15, p90: 40, onTime: null, toleranceMin: null, roomDays: 3, noStartRecord: 1, cancelledFirst: 0 },
    turnover: { n: 0, median: null, p90: null, excluded: 1 },
    durationVsEstimate: { n: 2, median: 10, p90: 25, over: 2, under: 0 },
    documentation: { opNote: { numerator: 3, denominator: 3 }, incisionClosure: { numerator: 2, denominator: 3 }, ebl: { numerator: 2, denominator: 3 }, prophylacticAbx: { numerator: 1, denominator: 3 }, vteProphylaxis: { numerator: 1, denominator: 3 }, anesthesiaRecord: { numerator: 3, denominator: 3 }, intraopVitals: { numerator: 0, denominator: 3 }, preAnesthesiaCompleted: { numerator: 3, denominator: 3 } },
    complications: { surgeryRecorded: { numerator: 0, denominator: 3 }, pacuRecorded: { numerator: 0, denominator: 0 } },
    pacu: { n: 0, median: null, p90: null, prolonged: null, prolongedMin: null, prolongedSource: 'UNAVAILABLE', overrideDischarge: { numerator: 0, denominator: 0 }, stillIn: 0 },
  };
  const safety = { available: true, reason: null, checklist: { denominator: 4, complete: 3, byPhase: [{ phase: 'SIGN_OUT', label: 'Sign-Out', missing: 1 }] }, siteVerification: { lateralityRequired: 0, gaps: 0, lateralityUndetermined: 0 }, count: { denominator: 4, mismatchUnresolved: 0 } };

  it('🔴 수술 안전은 정본 qi EP · 정시 기준 미설정이면 정시율 대신 그 사실 · 표본 0 은 산출 불가 · 합병증 0 은 기록 없음', async () => {
    get.mockImplementation(async (url: string) => (url.startsWith('/api/v1/qi/surgery-safety/summary') ? { data: safety } : { data: quality }));
    const { default: C } = await import('@/app/(main)/surgery/components/SurgeryQualityPanel');
    const { container } = render(<C />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('첫 수술 시작 지연'));
    expect(get.mock.calls.some((c) => String(c[0]).startsWith('/api/v1/qi/surgery-safety/summary?from='))).toBe(true);
    expect(container.textContent).toContain('정시 허용 지연이 원내 설정에 없어 정시율은 내지 않습니다');
    expect(container.textContent).toMatch(/수술방 회전 시간산출 불가 — 표본 없음/);
    expect(container.textContent).toContain("0 은 '없었다'가 아니라 '기록이 없다'입니다");
    expect(container.textContent).toContain('회복실 지연 기준을 확인할 수 없어 지연 수를 내지 않습니다.');
  });

  it('🔴 화면이 수술 안전 이행률을 스스로 세지 않는다 · 백분율은 정본(ratioOf·Ratio)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/surgery/components/SurgeryQualityPanel.tsx'), 'utf8');
    expect(src).not.toMatch(/surgicalChecklist|signInCompletedAt/);
    expect(src).not.toMatch(/toFixed|Math\.round/);
    expect(src).toMatch(/ratioOf\(/);
  });
});
