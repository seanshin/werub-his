/**
 * 수술방 차트(2026-10-05).
 *  · 권한 밖 역할은 차트 EP 를 부르지 않는다(서버 @Roles DOCTOR·NURSE·ADMIN 과 같은 판정)
 *  · 배치는 기기 구성 × 역할로 불러오고, `?screen=` 이 몇 번째 화면인지 고른다(그 화면의 패널만)
 *  · 활력: 원장 기록 + 이전 마취 기록 점을 합쳐 그린다 · 둘 다 없으면 "수술 중 활력 기록 없음"
 *  · 기록된 단계는 시각(버튼 아님) · 안 된 단계만 버튼 · 무효 줄은 기본 숨김
 *  · 차트 조회 실패 ≠ 빈 차트
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultOrLayout, surgeryFlowOf, intraopSummaryOf, SURGERY_PHASES } from '@hospital-run/shared';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn(), del: vi.fn(), getToken: () => 'x' } }));
const post = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/or-chart/s1',
  useSearchParams: () => search, useParams: () => ({ surgeryId: 's1' }),
}));
vi.mock('@/components/clinical/allergy-status', () => ({ AllergyStatusBadge: () => <span>ALLERGY</span> }));
vi.mock('@/app/(main)/surgery/components/SurgicalChecklistPanel', () => ({ SurgicalChecklistPanel: () => <div>CHECKLIST_STUB</div> }));
vi.mock('@/app/(main)/surgery/components/OpNotePanel', () => ({ default: () => <div>OPNOTE_STUB</div> }));
const startSurgery = vi.fn();
const closeVoice = vi.fn(async () => undefined);
vi.mock('@/lib/voice-api', () => ({ voiceApi: { startSurgery: (...a: unknown[]) => startSurgery(...a), chunk: vi.fn(), close: (...a: unknown[]) => closeVoice(...(a as [])) } }));
const begin = vi.fn(async () => undefined);
vi.mock('@/components/voice-emr/useVoiceCommand', () => ({ useVoiceCommand: () => ({ begin, end: vi.fn(async () => undefined), ptt: false }) }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const NOW = new Date().toISOString();
const ev = (over: Record<string, unknown>) => ({
  id: Math.random().toString(36), kind: 'NOTE', occurredAt: NOW, occurredAtSource: 'RECORDED', payload: {}, recordedAt: NOW,
  recordedBy: { id: 'u1', name: '조간호' }, voidedAt: null, voidedBy: null, voidReason: null, lateEntry: false, ...over,
});
const chart = (over: Record<string, unknown> = {}) => ({
  surgery: {
    id: 's1', status: 'IN_PROGRESS', procedureName: '복강경 담낭절제', bodySite: null, laterality: null, scheduledAt: NOW,
    startedAt: NOW, endedAt: null, anesthesiaType: 'GENERAL', asaClass: '2', airwayType: null,
    patient: { id: 'p1', name: '김하나', mrn: 'M1', dateOfBirth: '1980-01-01', gender: 'FEMALE' }, surgeon: '박외과',
    scrubNurse: null, circulatingNurse: null,
  },
  phases: { INDUCTION: NOW, INTUBATION: null, INCISION: null, CLOSURE: null, EXTUBATION: null, START: NOW, END: null },
  anesthesiaRecordPresent: true, legacyVitals: null, checklist: null,
  events: [],
  suggestedRole: 'CIRCULATING',
  writePolicy: { mode: 'REHEARSAL', teamOnly: false, onTeam: true, canWrite: true },
  flow: surgeryFlowOf({ ...Object.fromEntries(SURGERY_PHASES.map((k) => [k, null])), SIGN_IN: NOW, START: NOW } as never),
  summary: intraopSummaryOf([], { induction: null, extubation: null, incision: null, closure: null, start: null, end: null }),
  ...over,
});

function route(c: unknown, layout = defaultOrLayout('CIRCULATING', 'TABLET')) {
  get.mockImplementation((url: string) => {
    if (url.includes('/intraop')) return c instanceof Error ? Promise.reject(c) : Promise.resolve({ data: c });
    if (url.includes('/or-chart/layouts')) {
      const u = new URL(url, 'http://x');
      return Promise.resolve({ data: { profile: u.searchParams.get('profile'), role: u.searchParams.get('role'), layout, source: 'DEFAULT', updatedAt: null } });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => {
  cleanup(); get.mockReset(); post.mockReset(); search = new URLSearchParams(); startSurgery.mockReset(); begin.mockClear(); closeVoice.mockClear();
  try { window.localStorage.clear(); } catch { /* */ }
  useAuthStore.setState({ user: { id: 'u1', role: 'NURSE' } as never, isAuthenticated: true });
});

async function mount() {
  const { default: P } = await import('@/app/or-chart/[surgeryId]/page');
  return render(<P />, { wrapper: wrap });
}

describe('수술방 차트', () => {
  it('🔴 권한 밖 역할은 차트 EP 를 부르지 않는다', async () => {
    useAuthStore.setState({ user: { id: 'u9', role: 'RECEPTIONIST' } as never, isAuthenticated: true });
    route(chart());
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-or-forbidden]')).toBeTruthy());
    expect(get).not.toHaveBeenCalled();
  });

  it('배치를 기기 구성 × 역할로 부르고(제안 역할 기본) · 기록된 단계는 시각 · 활력 없으면 그 사실', async () => {
    route(chart());
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-or-phases]')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/api/v1/surgery/s1/intraop');
    expect(get).toHaveBeenCalledWith('/api/v1/or-chart/layouts?profile=TABLET&role=CIRCULATING');
    const phases = container.querySelector('[data-or-phases]')!;
    // 마취 유도는 기록됨 → 버튼이 아니다 · 나머지 4개만 버튼
    expect(phases.querySelectorAll('button').length).toBe(4);
    expect(container.textContent).toContain('CHECKLIST_STUB');
    // CIRCULATING 기본 배치에 vitals 가 있다
    expect(container.textContent).toContain('수술 중 활력 기록 없음');
  });

  it('🔴 활력 = 원장 + 이전 마취 기록 점 · 무효 줄은 그래프·흐름에서 빠진다', async () => {
    route(chart({
      legacyVitals: [{ at: NOW, heartRate: 80, systolicBp: 120, diastolicBp: 70, spo2: 99, etco2: null, temperature: null }],
      events: [
        ev({ kind: 'VITALS', payload: { heartRate: 91 } }),
        ev({ kind: 'VITALS', payload: { heartRate: 150 }, voidedAt: NOW, voidReason: '오입력', voidedBy: { id: 'u1', name: '조간호' } }),
        ev({ kind: 'NOTE', payload: { text: '지혈 확인' } }),
      ],
    }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-or-vitals-latest]')).toBeTruthy());
    expect(container.textContent).not.toContain('수술 중 활력 기록 없음');
    expect(container.textContent).toContain('이전 마취 기록의 활력 1점 포함');
    const svg = container.querySelector('svg[aria-label="vitals"]')!;
    // HR 점: 이전 기록 1 + 원장 1 = 2 (무효 150 은 빠진다)
    expect(svg.querySelectorAll('circle[fill="#e11d48"]').length).toBe(2);
    const tl = container.querySelector('[data-or-timeline]')!;
    expect(tl.textContent).toContain('지혈 확인');
    expect(tl.textContent).not.toContain('HR 150');
  });

  it('🔴 ?screen=2 는 두 번째 화면의 패널만 그린다(모니터 2대)', async () => {
    window.localStorage.setItem('orChart.deviceProfile', 'MONITOR_2');
    search = new URLSearchParams('screen=2');
    const layout = { screens: [{ panels: ['header', 'phases'], columns: 1 }, { panels: ['header', 'timeline'], columns: 1 }] };
    route(chart(), layout as never);
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-or-screen="2"]')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/api/v1/or-chart/layouts?profile=MONITOR_2&role=CIRCULATING');
    expect(container.querySelector('[data-or-timeline]') ?? container.textContent).toBeTruthy();
    expect(container.textContent).toContain('아직 기록이 없습니다.');
    expect(container.querySelector('[data-or-phases]')).toBeNull();
    expect(container.querySelector('[data-or-header]')).toBeTruthy();
  });

  it('🔴 차트 조회 실패는 빈 차트가 아니다', async () => {
    route(new Error('boom'));
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).not.toBe(''));
    await waitFor(() => expect(container.querySelector('[data-or-phases]')).toBeNull());
    await waitFor(() => expect(container.textContent).not.toContain('아직 기록이 없습니다.'));
    await waitFor(() => expect(container.textContent).toMatch(/다시|오류|실패|불러오지/));
  });

  it('🔴 구술이 꺼져 있으면 그 이유를 말하고 캡처를 열지 않는다(조회 모드로 돌아가지 않는다)', async () => {
    const { ApiError } = await import('@/lib/api-client');
    startSurgery.mockRejectedValue(new ApiError('VOICE_DICTATE_OFF', '구술 비활성'));
    route(chart());
    const { container, findByText } = await mount();
    const btn = await findByText('음성 입력');
    btn.closest('button')!.click();
    await waitFor(() => expect(container.querySelector('[data-or-voice="blocked"]')).toBeTruthy());
    expect(container.textContent).toContain('voiceEmr.dictate.enabled');
    expect(startSurgery).toHaveBeenCalledTimes(1);
    expect(startSurgery).toHaveBeenCalledWith('s1');
    expect(begin).not.toHaveBeenCalled();
  });

  it('세션이 열리면 캡처를 연다 · 음성 출처 메모는 흐름에 "음성" 표식', async () => {
    startSurgery.mockResolvedValue({ id: 'vs1', mode: 'DICTATE', patient: { name: '김하나', mrn: 'M1' } });
    route(chart({ events: [ev({ kind: 'NOTE', payload: { text: '거즈 계수 맞음', inputMethod: 'VOICE' } })] }));
    const { container, findByText } = await mount();
    const tl = await waitFor(() => { const x = container.querySelector('[data-or-timeline]'); expect(x).toBeTruthy(); return x!; });
    expect(tl.textContent).toMatch(/음성\s*거즈 계수 맞음/);
    (await findByText('음성 입력')).closest('button')!.click();
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
  });

  it('🔴 순회 간호 맡기는 간호사에게만(의사 화면엔 버튼 없음) · 맡은 사람 이름은 누구나 본다', async () => {
    useAuthStore.setState({ user: { id: 'd1', role: 'DOCTOR' } as never, isAuthenticated: true });
    route(chart({ surgery: { ...chart().surgery, circulatingNurse: { id: 'n2', name: '조간호' } } }));
    const { container } = await mount();
    const slot = await waitFor(() => { const x = container.querySelector('[data-or-circulating]'); expect(x).toBeTruthy(); return x!; });
    expect(slot.textContent).toContain('조간호');
    expect(slot.querySelector('button')).toBeNull();
    cleanup();
    useAuthStore.setState({ user: { id: 'u1', role: 'NURSE' } as never, isAuthenticated: true });
    const r2 = await mount();
    const slot2 = await waitFor(() => { const x = r2.container.querySelector('[data-or-circulating]'); expect(x).toBeTruthy(); return x!; });
    expect(slot2.textContent).toContain('교대로 맡기');
  });

  it('🔴 머리는 상태·성별을 코드가 아니라 표시 정본으로(IN_PROGRESS·FEMALE 노출 금지)', async () => {
    route(chart());
    const { container } = await mount();
    const h = await waitFor(() => { const x = container.querySelector('[data-or-header]'); expect(x).toBeTruthy(); return x!; });
    expect(h.textContent).toContain('진행중');
    expect(h.textContent).not.toContain('IN_PROGRESS');
    expect(h.textContent).toMatch(/세 · 여/);
    expect(h.textContent).not.toContain('FEMALE');
  });

  it('🔴 역할 배치가 뺀 패널을 말한다(참관 배치엔 약물·안전·수술 기록·메모가 없다) · 다 있으면 말하지 않는다', async () => {
    route(chart({ suggestedRole: null }), defaultOrLayout('OBSERVER', 'TABLET'));
    const { container } = await mount();
    const m = await waitFor(() => { const x = container.querySelector('[data-or-missing]'); expect(x).toBeTruthy(); return x!; });
    for (const k of ['약물·수액·배출', '안전 체크리스트', '수술 기록', '메모']) expect(m.textContent).toContain(k);
    expect(m.textContent).not.toContain('활력');
    cleanup();
    const all = { screens: [{ panels: ['header', 'phases', 'vitals', 'meds', 'timeline', 'safety', 'opnote', 'notes', 'summary'], columns: 2 }] };
    route(chart(), all as never);
    const r2 = await mount();
    await waitFor(() => expect(r2.container.querySelector('[data-or-phases]')).toBeTruthy());
    expect(r2.container.querySelector('[data-or-missing]')).toBeNull();
    // 열마다 따로 쌓는다 — 2열이면 열 묶음 2개
    expect(r2.container.querySelector('[data-or-screen="1"]')!.children.length).toBe(2);
  });

  it('🔴 흐름 띠 — 10단계 · 마지막 기록 단계 · 앞의 빈 단계는 "기록 없음"(지났다고 칠하지 않는다) · 다음 단계', async () => {
    route(chart());
    const { container } = await mount();
    const strip = await waitFor(() => { const x = container.querySelector('[data-or-flow]'); expect(x).toBeTruthy(); return x!; });
    expect(strip.querySelectorAll('[data-flow-step]').length).toBe(10);
    expect(strip.querySelector('[data-flow-step="START"]')!.getAttribute('data-flow-state')).toBe('last');
    expect(strip.querySelector('[data-flow-step="INDUCTION"]')!.getAttribute('data-flow-state')).toBe('gap');
    expect(strip.querySelector('[data-flow-step="INCISION"]')!.getAttribute('data-flow-state')).toBe('next');
    expect(strip.querySelector('[data-flow-step="PACU_OUT"]')!.getAttribute('data-flow-state')).toBe('todo');
  });

  it('🔴 다른 날의 단계는 날짜도 보인다(시각만 보이면 같은 흐름으로 읽힌다)', async () => {
    const flow = surgeryFlowOf({ ...Object.fromEntries(SURGERY_PHASES.map((k) => [k, null])), START: '2026-09-30T08:58:00Z', INCISION: '2026-10-05T05:27:00Z' } as never);
    route(chart({ flow }));
    const { container } = await mount();
    const strip = await waitFor(() => { const x = container.querySelector('[data-or-flow]'); expect(x).toBeTruthy(); return x!; });
    expect(strip.querySelector('[data-flow-step="INCISION"]')!.getAttribute('data-flow-otherday')).toBe('true');
    expect(strip.querySelector('[data-flow-step="START"]')!.getAttribute('data-flow-otherday')).toBeNull();
  });

  it('🔴 요약은 기록 없음을 0 으로 쓰지 않는다 · AI 는 누를 때만 · 기록에 없는 수치를 표시', async () => {
    const summary = intraopSummaryOf([{ kind: 'FLUID', occurredAt: NOW, payload: { name: 'NS', volumeMl: 500 } }], { induction: null, extubation: null, incision: null, closure: null, start: null, end: null });
    route(chart({ summary }), { screens: [{ panels: ['header', 'summary'], columns: 1 }] } as never);
    post.mockResolvedValue({ data: { source: 'AI', reason: null, text: '수액 500 mL, 실혈 300 mL.', facts: ['수액 합: 500 mL'], unverifiedNumbers: ['300'], languageMixed: false } });
    const { container, findByText } = await mount();
    const sum = await waitFor(() => { const x = container.querySelector('[data-or-summary]'); expect(x).toBeTruthy(); return x!; });
    expect(sum.textContent).toContain('500 mL');
    expect(sum.textContent).toMatch(/실혈기록 없음/);
    expect(sum.textContent).not.toMatch(/실혈0/);
    expect(post).not.toHaveBeenCalled();
    (await findByText('AI 경과 요약 초안')).closest('button')!.click();
    await waitFor(() => expect(container.querySelector('[data-or-ai-text]')).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/api/v1/surgery/s1/intraop/ai-narrative', {});
    expect(container.querySelector('[data-or-ai="AI"]')!.textContent).toMatch(/기록에 없는 수치.*300/);
    expect(container.textContent).toContain('초안 — 확인 전');
  });

  it('🔴 AI 가 답하지 못하면 문장 없이 그 사실 · 권한 밖(원무)은 버튼이 없다', async () => {
    route(chart(), { screens: [{ panels: ['header', 'summary'], columns: 1 }] } as never);
    post.mockResolvedValue({ data: { source: 'UNAVAILABLE', reason: 'AI_EMPTY', text: null, facts: [], unverifiedNumbers: [], languageMixed: false } });
    const { container, findByText } = await mount();
    (await findByText('AI 경과 요약 초안')).closest('button')!.click();
    await waitFor(() => expect(container.querySelector('[data-or-ai="UNAVAILABLE"]')).toBeTruthy());
    expect(container.querySelector('[data-or-ai-text]')).toBeNull();
    expect(container.textContent).toContain('대신 문장을 만들지 않습니다');
  });

  it('AI 버튼 역할 게이트가 호출부 파일에 있다', () => {
    const src = readFileSync(join(__dirname, '../../src/app/or-chart/[surgeryId]/flow-summary.tsx'), 'utf8');
    expect(src).toMatch(/const canAi = useHasRole\('DOCTOR', 'NURSE'\)/);
    expect(src).toMatch(/\{canAi && \(/);
  });

  it('🔴 구술 중 화면을 떠나면 열린 음성 세션을 닫는다', async () => {
    startSurgery.mockResolvedValue({ id: 'vs9', mode: 'DICTATE', patient: { name: 'x', mrn: 'M1' } });
    route(chart());
    const r = await mount();
    (await r.findByText('음성 입력')).closest('button')!.click();
    await waitFor(() => expect(begin).toHaveBeenCalled());
    r.unmount();
    expect(closeVoice).toHaveBeenCalledWith('vs9');
  });

  it('🔴 수술 목록은 행마다 AI 위험도를 자동으로 부르지 않는다(누를 때만)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/surgery/page.tsx'), 'utf8');
    expect(src).not.toMatch(/\/ai-risk/);
  });

  it('🔴 운영(리얼)·수술팀 아님 → 읽기 전용 고지 · 단계 버튼·활력 입력·메모·음성이 없다', async () => {
    const all = { screens: [{ panels: ['header', 'phases', 'vitals', 'meds', 'notes'], columns: 1 }] };
    route(chart({ suggestedRole: null, writePolicy: { mode: 'REAL', teamOnly: true, onTeam: false, canWrite: false } }), all as never);
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-or-write="readonly"]')).toBeTruthy());
    expect(container.querySelector('[data-or-phases]')!.querySelectorAll('button').length).toBe(0);
    expect(container.querySelector('input[aria-label="HR"]')).toBeNull();
    // 🔴 기록이 없는 수액·실혈은 '기록 없음'(0 mL 아님 — 요약 패널과 같은 정본)
    expect(container.textContent).not.toMatch(/수액0 mL|실혈0 mL/);
    expect(container.querySelector('[data-or-voice]')).toBeNull();
    expect(container.querySelector('[data-or-readonly-notes]')).toBeTruthy();
  });

  it('리허설·수술팀 아님 → 쓸 수 있고 "리허설 — 누구나" 고지(운영은 수술팀만) · 수술팀이면 고지 없음', async () => {
    const all = { screens: [{ panels: ['header', 'phases', 'notes'], columns: 1 }] };
    route(chart({ suggestedRole: null, writePolicy: { mode: 'REHEARSAL', teamOnly: false, onTeam: false, canWrite: true } }), all as never);
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-or-write="rehearsal-open"]')).toBeTruthy());
    expect(r.container.querySelector('[data-or-phases]')!.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(r.container.querySelector('[data-or-voice]')).toBeTruthy();
    cleanup();
    route(chart(), all as never);
    const r2 = await mount();
    await waitFor(() => expect(r2.container.querySelector('[data-or-phases]')).toBeTruthy());
    expect(r2.container.querySelector('[data-or-write]')).toBeNull();
  });

  it('호출부 역할 게이트가 화면 파일에 있다(역할×EP 스캐너가 본다)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/or-chart/[surgeryId]/page.tsx'), 'utf8');
    expect(src).toMatch(/useHasRole\('DOCTOR', 'NURSE'\)/);
    expect(src).toMatch(/enabled: ready && canUse/);
  });
});
