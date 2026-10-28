/**
 * 간호 스테이션 보드 상세화 + 상·하번 인계 메모(2026-10-04).
 *  · 근무조 표시(서버 창) · KPI 를 누르면 그 조건으로 걸러 본다 · 카드/표 보기
 *  · 인계 보드: I-PASS 카드(중증도 띠·조치 체크·상황 인식) · 위중→미확인→최신 · 잘렸으면 말한다
 *  · 🔴 중증도: 비면 "미기재"(안정 아님) · 어휘 밖이면 원문 + 어휘 밖(미기재로 접지 않는다)
 *  · 🔴 인수 확인 버튼은 지정 인수자 본인에게만(서버도 본인만 허용) · 구버전 응답을 "인계 0건"으로 말하지 않는다
 *  · 🔴 입원 상세 I-PASS 폼: 개통 이래 저장 0(빈 patientId·toDoctorId·자유 입력 중증도) → 환자·인수자·정본 어휘
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: toastMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/nursing-station', useSearchParams: () => new URLSearchParams() }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const row = (id: string, over: Record<string, unknown> = {}) => ({
  admissionId: id, patientId: `p-${id}`, name: `환자${id}`, mrn: `M-${id}`, ward: '7병동', wardId: 'w7', room: '70' + id.slice(-1), bed: '1', losDays: 2,
  ews: null, fall: null, meds: { due: 0, overdue: 0 }, lastNoteAt: null, unsignedNotes: 0, highRisk: false, isolation: [], handoff: null, nurse: null, ...over,
});
const fh = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'NURSING_SHIFT', admissionId: 'a1', patientId: 'p-a1', illness: 'STABLE', summary: `요약${id}`, patientSummary: null,
  actionList: [{ action: `조치${id}`, status: 'PENDING' }], situationAwareness: null, synthesis: null, pendingItems: null,
  acknowledgedAt: null, createdAt: '2026-10-04T00:30:00Z', fromDoctor: { id: 'n1', familyName: '박', givenName: '하번' }, toDoctor: { id: 'n9', familyName: '최', givenName: '상번' },
  shift: 'DAY', room: '701', bed: '1', ward: '7병동', patientName: '환자a1', mrn: 'M-a1', ...over,
});
const SHIFT = { current: 'DAY', start: '2026-10-03T22:00:00Z', end: '2026-10-04T06:00:00Z', previous: 'NIGHT', previousStart: '2026-10-03T14:00:00Z', now: '2026-10-04T01:00:00Z' };

function board(over: Record<string, unknown> = {}) {
  const resp = {
    wards: [{ id: 'w7', name: '7병동' }],
    patients: [row('a1', { highRisk: true, shiftRecord: { notes: 2, vitals: 0, io: 0, medsDue: 4, medsPending: 3, handoffs: 1 }, nurse: { id: 'n1', name: '박하번', shiftType: 'DAY', assignedAt: '2026-10-03T22:10:00Z', isPrimary: true }, handoff: { id: 'x', at: '2026-10-04T00:30:00Z', acknowledgedAt: null, illness: 'CRITICAL', memo: '흉통 호소', openActions: 2, inWindow: true } }), row('a2', { shiftRecord: { notes: 0, vitals: 0, io: 1, medsDue: 0, medsPending: 0, handoffs: 0 } })],
    summary: { total: 2, highRisk: 1, medsOverdue: 0, unsignedNotes: 0, isolated: 0, handoffPending: 5, handoffsInWindow: 3, handoffsInWindowPending: 2, shiftWithoutNote: 1, shiftWithoutVitals: 2, shiftWithoutHandoff: 1, shiftMedsPending: 3 },
    shift: SHIFT,
    handoffs: {
      items: [
        fh('h-stable', { illness: 'STABLE', createdAt: '2026-10-04T00:50:00Z' }),
        fh('h-crit', { illness: 'CRITICAL', situationAwareness: '야간 흉통 재발 시 즉시 보고', toDoctor: { id: 'me', familyName: '나', givenName: '본인' } }),
        fh('h-off', { illness: '위중', shift: 'NIGHT', acknowledgedAt: '2026-10-03T15:00:00Z' }),
        fh('h-none', { illness: null }),
      ],
      total: 64, truncated: true, since: SHIFT.previousStart, limit: 60,
    },
    staffing: {
      current: { shift: 'DAY', date: '2026-10-04T00:00:00.000Z', roster: [{ userId: 'n1', name: '박하번', department: '간호부 (내과병동)', handoffsToAck: 0 }] },
      next: { shift: 'EVENING', date: '2026-10-04T00:00:00.000Z', roster: [] },
      rosterLatestDate: '2026-08-05T00:00:00.000Z', rosterScope: 'HOSPITAL',
      assignees: [{ userId: 'n1', name: '박하번', patients: 1, handoffsWritten: 3, handoffsUnacked: 2, handoffsToAck: 0 }],
    },
    ...over,
  };
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/nursing/station-board')) return { data: resp };
    if (url.startsWith('/api/v1/users?role=NURSE')) return { data: [{ id: 'n7', familyName: '정', givenName: '배정' }] };
    throw new Error('미배선');
  });
}

async function mount() {
  const { default: Page } = await import('@/app/(main)/nursing-station/page');
  return render(<Page />, { wrapper: wrap });
}

beforeEach(() => {
  cleanup(); get.mockReset(); patch.mockReset(); post.mockReset(); Object.values(toastMock).forEach((f) => f.mockReset());
  useAuthStore.setState({ user: { id: 'me', email: 'n@x', familyName: '나', givenName: '본인', role: 'NURSE', permissions: [] }, isAuthenticated: true });
});

describe('인계 보드', () => {
  it('🔴 위중 → 미확인 → 최신 순 · 중증도 어휘 밖은 원문 + 어휘 밖 · 빈 값은 미기재 · 잘렸음을 말한다', async () => {
    board();
    const { container } = await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 인계 메모' });
    await waitFor(() => expect(panel.textContent).toContain('조치h-crit'));
    const cards = within(panel).getAllByRole('article');
    expect(cards[0].textContent).toContain('조치h-crit'); // 위급이 맨 위
    expect(panel.textContent).toContain('위중');
    expect(panel.textContent).toContain('어휘 밖');
    expect(panel.textContent).toContain('중증도 미기재');
    expect(panel.textContent).toContain('야간 흉통 재발 시 즉시 보고');
    expect(panel.textContent).toMatch(/최근 4건만 표시 — 이 구간 전체 64건/);
    // 근무조 표시
    expect(container.querySelector('[data-shift-now]')?.textContent).toContain('주간');
  });

  it('🔴 인수 확인 버튼은 지정 인수자 본인 카드에만 · 누르면 그 인계를 확인한다', async () => {
    board();
    patch.mockResolvedValue({ data: {} });
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 인계 메모' });
    await waitFor(() => expect(panel.textContent).toContain('조치h-crit'));
    const btns = within(panel).getAllByRole('button', { name: /내 인계 — 인수 확인/ });
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/handoffs/h-crit/acknowledge'));
  });

  it('🔴 조치 항목 체크 — 인계 당사자 카드에만 · 누르면 그 항목 index·글자로 완료 · 완료자·시각 표시', async () => {
    board();
    patch.mockResolvedValue({ data: {} });
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 인계 메모' });
    await waitFor(() => expect(panel.textContent).toContain('조치h-crit'));
    const boxes = within(panel).getAllByRole('checkbox', { name: /조치/ });
    expect(boxes).toHaveLength(1); // 나(me)는 h-crit 의 인수자뿐
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/handoffs/h-crit/actions/0', { status: 'DONE', action: '조치h-crit' }));
  });

  it('완료된 항목은 완료자와 시각을 함께 · 완료자 없는 옛 기록은 지어내지 않는다', async () => {
    board({ handoffs: { items: [fh('h-d', { actionList: [{ action: '끝난 일', status: 'DONE', doneAt: '2026-10-04T00:40:00Z', doneByName: '최상번' }, { action: '옛 완료', status: 'DONE' }] })], total: 1, truncated: false, since: SHIFT.previousStart, limit: 60 } });
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 인계 메모' });
    await waitFor(() => expect(panel.textContent).toContain('끝난 일'));
    expect(panel.textContent).toContain('✓ 최상번');
    expect(panel.textContent).toContain('옛 완료');
  });

  it('근무조 탭·미확인만으로 거른다', async () => {
    board();
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 인계 메모' });
    await waitFor(() => expect(panel.textContent).toContain('조치h-off'));
    fireEvent.click(within(panel).getByRole('button', { name: /이번 주간/ }));
    expect(panel.textContent).not.toContain('조치h-off');
    fireEvent.click(within(panel).getByRole('button', { name: /전체/ }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: '미확인만' }));
    expect(panel.textContent).not.toContain('조치h-off'); // 확인된 인계
    expect(panel.textContent).toContain('조치h-stable');
  });

  it('🔴 구버전 응답(인계 정보 없음)을 "인계 0건"으로 말하지 않는다', async () => {
    board({ shift: undefined, handoffs: undefined });
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('인계 보드를 그릴 수 없습니다'));
    expect(container.textContent).not.toContain('이 구간에 남긴 인계가 없습니다');
  });
});

describe('상·하번 간호사', () => {
  it('🔴 하번 = 이번 근무조 담당(배정 원장) + 근무표 · 상번 근무표가 비면 "근무자 없음"이 아니라 근무표 마지막 입력일', async () => {
    board();
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 간호사' });
    const off = panel.querySelector('[data-staffing="off"]')!;
    const on = panel.querySelector('[data-staffing="on"]')!;
    await waitFor(() => expect(off.textContent).toContain('박하번'));
    expect(off.textContent).toMatch(/담당 1명 · 남긴 인계 3 · 상대 미확인 2/);
    expect(off.textContent).toContain('간호부 (내과병동)');
    expect(on.textContent).toContain('근무표에 이 근무조 간호사가 없습니다.');
    expect(on.textContent).toContain('근무표 마지막 입력일');
    expect(panel.textContent).toContain('병원 전체');
  });

  it('🔴 근무 교대 인계 카드는 인계자=하번 · 인수자=상번 · 다른 유형은 인계·인수', async () => {
    board();
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 인계 메모' });
    await waitFor(() => expect(panel.textContent).toContain('조치h-crit'));
    const card = within(panel).getAllByRole('article')[0];
    expect(card.textContent).toMatch(/하번박하번→상번나본인/);
  });

  it('카드·표에 담당 간호사 — 배정이 없으면 "담당 배정 없음"', async () => {
    board();
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('환자a2'));
    expect(container.textContent).toContain('담당 박하번');
    expect(container.textContent).toContain('담당 배정 없음');
  });

  it('구버전 응답(staffing 없음)을 "근무자 없음"으로 말하지 않는다', async () => {
    board({ staffing: undefined });
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('근무 간호사 정보가 없습니다'));
  });
});

describe('⑧ 근무표 부서 ↔ 병동 연결', () => {
  const st = (over: Record<string, unknown>) => ({
    current: { shift: 'DAY', date: '2026-10-04T00:00:00.000Z', roster: [] }, next: { shift: 'EVENING', date: '2026-10-04T00:00:00.000Z', roster: [] },
    rosterLatestDate: '2026-10-04T00:00:00.000Z', assignees: [], rosterDepartments: ['간호부 (내과병동)', '투석실'], ...over,
  });

  it('🔴 연결된 병동이면 "근무표(이 병동)" + 연결 부서 · 연결 안 된 병동이면 그 사실 · 전체면 병원 전체', async () => {
    board({ staffing: st({ rosterScope: 'WARD', wardDepartments: ['간호부 (내과병동)'], wardUnmapped: false }) });
    const a = await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 간호사' });
    await waitFor(() => expect(panel.textContent).toContain('근무표(이 병동)'));
    expect(panel.textContent).toMatch(/이 병동에 연결된 근무표 부서: 간호부 \(내과병동\)/);
    cleanup();
    board({ staffing: st({ rosterScope: 'HOSPITAL', wardDepartments: null, wardUnmapped: true }) });
    await mount();
    const p2 = await screen.findByRole('region', { name: '상·하번 간호사' });
    await waitFor(() => expect(p2.textContent).toContain('이 병동은 근무표 부서가 연결돼 있지 않아'));
    expect(p2.textContent).toContain('근무표(병원 전체)');
    void a;
  });

  it('🔴 관리자만 연결 편집 — 고른 병동 칸만 바꿔 쓰고 다른 병동 연결은 보존', async () => {
    useAuthStore.setState({ user: { id: 'me', email: 'a@x', familyName: '관', givenName: '리', role: 'ADMIN', permissions: [] }, isAuthenticated: true });
    board({ staffing: st({ rosterScope: 'HOSPITAL', wardDepartments: null, wardUnmapped: true }) });
    const put = vi.fn(async () => ({ data: {} }));
    const { apiClient } = await import('@/lib/api-client');
    (apiClient as any).put = put;
    const prevGet = get.getMockImplementation()!;
    get.mockImplementation(async (url: string) => (url === '/api/v1/config/nursing.roster.wardDepartments' ? { data: { wOther: ['투석실'] } } : prevGet(url)));
    await mount();
    // 병동 고르기
    fireEvent.click(await screen.findByRole('button', { name: '7병동' }));
    const panel = await screen.findByRole('region', { name: '상·하번 간호사' });
    fireEvent.click(await within(panel).findByRole('button', { name: '근무표 부서 연결' }));
    const ed = await screen.findByRole('region', { name: '근무표 부서 연결' });
    fireEvent.click(within(ed).getByRole('checkbox', { name: '간호부 (내과병동)' }));
    fireEvent.click(within(ed).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/v1/config/nursing.roster.wardDepartments', { value: { wOther: ['투석실'], w7: ['간호부 (내과병동)'] } }));
  });

  it('간호사에게는 연결 편집 손잡이가 없다', async () => {
    board({ staffing: st({ rosterScope: 'HOSPITAL', wardDepartments: null, wardUnmapped: true }) });
    await mount();
    const panel = await screen.findByRole('region', { name: '상·하번 간호사' });
    await waitFor(() => expect(panel.textContent).toContain('연결돼 있지 않아'));
    expect(within(panel).queryByRole('button', { name: '근무표 부서 연결' })).toBeNull();
  });
});

describe('⑨ 간호사 1인당 환자', () => {
  const st = (over: Record<string, unknown>) => ({
    current: { shift: 'DAY', date: '2026-10-04T00:00:00.000Z', roster: [] }, next: { shift: 'EVENING', date: '2026-10-04T00:00:00.000Z', roster: [] },
    rosterLatestDate: '2026-10-04T00:00:00.000Z', assignees: [], rosterScope: 'HOSPITAL', wardUnmapped: false, ...over,
  });
  const ratioText = async () => {
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-staffing-ratio]')).toBeTruthy());
    return container.querySelector('[data-staffing-ratio]')!.textContent ?? '';
  };

  it('🔴 배정 기준 = 재원 ÷ 담당 간호사(분모 병기) · 근무표 기준은 병동 연결이 없으면 산출 불가 + 이유', async () => {
    board({ staffing: st({ assignees: [{ userId: 'n1', name: '박', patients: 2, handoffsWritten: 0, handoffsUnacked: 0, handoffsToAck: 0 }] }) });
    const t = await ratioText();
    expect(t).toMatch(/2(\.0)?명/); // 재원 2 ÷ 1
    expect(t).toContain('재원 2명 ÷ 담당 1명');
    expect(t).toContain('산출 불가 — 이 병동 근무표 연결 없음');
    expect(t).toContain('인력 기준 충족 여부는 판정하지 않습니다.');
  });

  it('🔴 분모 0 은 산출 불가(0 이나 무한대로 그리지 않는다) · 담당 없는 환자 수', async () => {
    board({ staffing: st({ rosterScope: 'WARD', wardDepartments: ['간호부'], current: { shift: 'DAY', date: '2026-10-04T00:00:00.000Z', roster: [] } }) });
    const t = await ratioText();
    expect(t).toContain('산출 불가 — 담당 배정 없음');
    expect(t).toContain('산출 불가 — 근무표에 이 근무조 간호사 없음');
    expect(t).not.toMatch(/Infinity|NaN/);
    expect(t).toContain('담당 없는 재원 환자 1명'); // a1 은 담당 있음, a2 는 null
  });

  it('근무표가 병동으로 연결되고 근무자가 있으면 근무표 기준 비율', async () => {
    board({ staffing: st({ rosterScope: 'WARD', wardDepartments: ['간호부'], current: { shift: 'DAY', date: '2026-10-04T00:00:00.000Z', roster: [{ userId: 'n1', name: '박', department: '간호부', handoffsToAck: 0 }, { userId: 'n2', name: '최', department: '간호부', handoffsToAck: 0 }] } }) });
    const t = await ratioText();
    expect(t).toContain('재원 2명 ÷ 근무 2명');
  });
});

describe('④~⑦ 안전·일정 신호', () => {
  const sig = (over: Record<string, unknown> = {}) => board({
    patients: [
      row('a1', { lastVitalsAt: new Date(Date.now() - 5 * 3600_000).toISOString(), criticalOpen: [{ id: 'c1', testName: 'K', value: '6.8', unit: 'mmol/L', status: 'PENDING', notifiedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }], surgery: null, npo: null, expectedDischargeAt: null, transferPending: { id: 't1', targetWard: '9병동', requestedAt: new Date().toISOString() } }),
      row('a2', { lastVitalsAt: null, criticalOpen: [], surgery: { id: 's1', scheduledAt: new Date().toISOString(), procedureName: '복강경 담낭절제', status: 'SCHEDULED' }, npo: { since: null }, expectedDischargeAt: new Date().toISOString(), transferPending: null }),
    ],
    summary: { total: 2, highRisk: 0, medsOverdue: 0, unsignedNotes: 0, criticalOpenPatients: 1, surgeryUpcoming: 1, npo: 1, dischargeToday: 1, transferPending: 1, vitalsNever: 1, vitalsStaleHours: null, vitalsStale: null },
    ...over,
  });

  it('🔴 신호 막대 — 위급값 미확인을 맨 앞에 · 누르면 그 환자만 · 기준 미설정이면 활력은 경과만이라고 말한다', async () => {
    sig();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-signal-bar]')).toBeTruthy());
    const bar = container.querySelector('[data-signal-bar]') as HTMLElement;
    expect(bar.textContent).toMatch(/위급값 미확인 1명.*활력 기록 없음 1명.*오늘·내일 수술 1명.*금식 1명.*오늘 퇴원 예정 1명.*전동 요청 1명/);
    expect(bar.textContent).toContain('활력 경과 강조 기준 미설정 — 경과만 보입니다');
    fireEvent.click(within(bar).getByRole('button', { name: /위급값 미확인/ }));
    expect(container.querySelectorAll('[data-signals]')).toHaveLength(1);
    expect(container.textContent).toMatch(/위급값 K[^·]*6\.8 mmol\/L/); // 검사명은 용어 표시 정본(LabTerm)이 병기
  });

  it('카드 배지 — 수술 시각·술식 · NPO · 오늘 퇴원 예정 · 전동 받는 병동 · 활력 기록 없음', async () => {
    sig();
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('복강경 담낭절제'));
    expect(container.textContent).toContain('NPO');
    expect(container.textContent).toContain('오늘 퇴원 예정');
    expect(container.textContent).toMatch(/전동 요청 → 9병동/);
    expect(container.textContent).toContain('활력 기록 없음');
  });

  it('🔴 활력 강조는 원내 기준이 있을 때만 — 미설정이면 5시간 경과도 강조하지 않는다 · 기준 4시간이면 강조', async () => {
    sig();
    const a = await mount();
    await waitFor(() => expect(a.container.textContent).toContain('5시간 전'));
    expect(a.container.querySelector('[data-vitals-stale]')).toBeNull();
    cleanup();
    sig({ summary: { total: 2, highRisk: 0, medsOverdue: 0, unsignedNotes: 0, criticalOpenPatients: 1, surgeryUpcoming: 1, npo: 1, dischargeToday: 1, transferPending: 1, vitalsNever: 1, vitalsStaleHours: 4, vitalsStale: 1 } });
    const b = await mount();
    await waitFor(() => expect(b.container.querySelector('[data-vitals-stale]')).toBeTruthy());
    expect(b.container.textContent).toMatch(/활력 4시간 넘으면 강조 · 해당 1명/);
  });

  it('🔴 구버전 응답은 신호 막대·배지를 그리지 않는다', async () => {
    board({ patients: [row('a1')], summary: { total: 1, highRisk: 0, medsOverdue: 0, unsignedNotes: 0 } });
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('환자a1'));
    expect(container.querySelector('[data-signal-bar]')).toBeNull();
    expect(container.querySelector('[data-signals]')).toBeNull();
  });
});

describe('병동 근무조 마감', () => {
  it('🔴 막대 = 기록 없는 환자 수 · 누르면 거른다 · 유무만이라고 말한다 · 카드 칩', async () => {
    board();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-closeout]')).toBeTruthy());
    const bar = container.querySelector('[data-closeout]') as HTMLElement;
    expect(bar.textContent).toMatch(/간호기록 없음 1명/);
    expect(bar.textContent).toMatch(/미처리 투약 3건/);
    expect(bar.textContent).toContain('충분한지는 판정하지 않습니다');
    fireEvent.click(within(bar).getByRole('button', { name: /간호기록 없음/ }));
    expect(container.textContent).toMatch(/걸러 보는 중 — 1명 \/ 전체 2명/);
    // 환자 카드는 기록 없는 a2 하나뿐(이름은 인계 보드에도 있어 카드 칩 수로 센다)
    expect(container.querySelectorAll('[data-shift-record]')).toHaveLength(1);
    const chips = container.querySelector('[data-shift-record]')!;
    expect(chips.textContent).toContain('○ 간호기록');
  });

  it('카드 칩 — 투약은 지금까지 예정분 중 미처리를 분모와 함께', async () => {
    board();
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('투약 미처리 3/4'));
  });

  it('🔴 구버전 응답(shiftRecord 없음)은 막대·칩을 그리지 않는다 — 모르는 것을 "없음"으로 세지 않는다', async () => {
    board({ patients: [row('a1')], summary: { total: 1, highRisk: 0, medsOverdue: 0, unsignedNotes: 0 } });
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('환자a1'));
    expect(container.querySelector('[data-closeout]')).toBeNull();
    expect(container.querySelector('[data-shift-record]')).toBeNull();
  });
});

describe('담당 배정', () => {
  const as = (role: string) => useAuthStore.setState({ user: { id: 'me', email: 'n@x', familyName: '나', givenName: '본인', role, permissions: [] }, isAuthenticated: true });

  it('🔴 내가 담당 — 간호사에게만 · 서버가 준 지금 근무조로 take-over(브라우저 시계·기본값 DAY 아님)', async () => {
    board({ shift: { ...SHIFT, current: 'EVENING' } });
    post.mockResolvedValue({ data: {} });
    await mount();
    const btns = await screen.findAllByRole('button', { name: '내가 담당' });
    expect(btns).toHaveLength(2); // 두 환자 모두 내 담당이 아니다
    fireEvent.click(btns[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/nurse-station/assignments/take-over', { admissionId: 'a1', shiftType: 'EVENING' }));
  });

  it('🔴 의사는 배정 손잡이가 없다(서버 @Roles NURSE·ADMIN) · 관리자는 선택 배정만(넘겨받기 없음)', async () => {
    as('DOCTOR');
    board();
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('환자a2'));
    expect(screen.queryByRole('button', { name: '내가 담당' })).toBeNull();
    expect(screen.queryByRole('button', { name: '담당 배정' })).toBeNull();
    cleanup();
    as('ADMIN');
    board();
    const r2 = await mount();
    await waitFor(() => expect(r2.container.textContent).toContain('환자a2'));
    expect(screen.queryByRole('button', { name: '내가 담당' })).toBeNull();
    expect(screen.getByRole('button', { name: '담당 배정' })).toBeTruthy();
  });

  it('🔴 선택 배정 — 고른 환자마다 보내고 일부 실패를 완료로 접지 않는다 · 근무조 = 서버 근무조', async () => {
    board();
    post.mockImplementation(async (_u: string, b: any) => { if (b.admissionId === 'a2') throw new Error('재원 중인 환자만 배정할 수 있습니다'); return { data: {} }; });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: '담당 배정' }));
    const bar = await screen.findByRole('region', { name: '담당 배정' });
    fireEvent.click(screen.getByRole('checkbox', { name: /701-1 환자a1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /702-1 환자a2/ }));
    await waitFor(() => expect(within(bar).getAllByRole('option').length).toBeGreaterThan(2));
    // 근무표 후보(★) 먼저 · 간호사 전체
    fireEvent.change(within(bar).getByRole('combobox'), { target: { value: 'n7' } });
    fireEvent.click(within(bar).getByRole('button', { name: '배정' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/nurse-station/assignments', { nurseId: 'n7', admissionId: 'a1', shiftType: 'DAY', isPrimary: true });
    expect(post).toHaveBeenCalledTimes(2);
    expect(String(toastMock.error.mock.calls[0][0])).toMatch(/1명 배정 · 1명 실패/);
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('환자 보기', () => {
  it('🔴 KPI 를 누르면 그 조건으로 거른다 · 카드에 마지막 인계 메모와 남은 조치', async () => {
    board();
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('환자a2'));
    expect(container.textContent).toContain('흉통 호소');
    expect(container.textContent).toContain('남은 조치 2');
    fireEvent.click(screen.getByRole('button', { name: /고위험\(EWS\)/ }));
    expect(container.textContent).toMatch(/걸러 보는 중 — 1명 \/ 전체 2명/);
    expect(container.textContent).not.toContain('환자a2');
  });

  it('카드에 인계가 없으면 "인계 기록 없음" — 안정으로 그리지 않는다', async () => {
    board();
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('인계 기록 없음'));
  });
});

describe('입원 상세 I-PASS 폼 — 개통 이래 저장 0 봉합(소스 대조)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/(main)/inpatient/[admissionId]/page.tsx'), 'utf8');
  const form = SRC.slice(SRC.indexOf('function HandoffSection'), SRC.indexOf('function HandoffSection') + 9000);
  it('🔴 빈 patientId·toDoctorId 를 보내지 않는다 · 자유 입력 중증도 없음', () => {
    expect(form).not.toMatch(/patientId: ''/);
    expect(form).not.toMatch(/toDoctorId: ''/);
    expect(form).not.toMatch(/예: 안정 \/ 주의 \/ 위중/);
    expect(form).toMatch(/toDoctorId: form\.toUserId/);
    expect(form).toMatch(/HANDOFF_ILLNESS\.map/);
  });
  it('🔴 I-PASS 다섯 칸을 필드로 보낸다 · 저장 버튼은 중증도·인수자·환자가 있어야', () => {
    for (const f of ['illness: form.illness', 'patientSummary: opt(form.patientSummary)', 'situationAwareness: opt(form.situationAwareness)', 'synthesis: opt(form.synthesis)']) expect(form).toContain(f);
    expect(form).toMatch(/disabled=\{createMut\.isPending \|\| !form\.illness \|\| !form\.toUserId \|\| !patientId/);
    expect(form).toMatch(/illness: '', patientSummary: '', actionList: ''/); // 초기값 미선택
  });
});

describe('인수인계 화면 — 어휘 밖을 미기재로 말하지 않는다', () => {
  it('🔴 handoffIllnessOf 로 판정 · 라벨은 shared 정본', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/app/(main)/handoffs/page.tsx'), 'utf8');
    expect(SRC).toMatch(/const iv = handoffIllnessOf\(v\);/);
    expect(SRC).toMatch(/if \(iv\.offVocab\) return \{ label: `\$\{iv\.raw\} · 어휘 밖`/);
    expect(SRC).not.toMatch(/label: '위급'/);
  });
});
