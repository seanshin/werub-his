/**
 * 간호 스테이션 — 결함 1~10 + 상·하번 교대(2026-09-30).
 *  · MAR: 오늘 + 지난 미처리(carriedOver) · 거부를 '예정'으로 말하지 않는다(shared 정본 배지) · 중단 처방은 투여 버튼 없음
 *  · 입원 일차: 서버 stayDays(입원 당일 = 1일차) · 병동 보드: 병상 상태가 정본(내 담당만이어도 점유 병상을 빈 병상으로 말하지 않는다)
 *  · 쓰기 폼 미선택 · 조회 실패 ≠ 기록 없음 · QA 실패 ≠ 비활성 · 인계 작성자는 서버
 *  · 근무조 마감: 담당 0 은 "모두 완료"가 아니다 · 상번 인수 확인 + 담당 인수
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/nurse-station', useSearchParams: () => new URLSearchParams() }));

const SRC = readFileSync(join(process.cwd(), 'src/app/(main)/nurse-station/page.tsx'), 'utf8');
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const adm = (id: string, bedId: string, extra: Record<string, unknown> = {}) => ({
  id, patientId: `p-${id}`, patient: { id: `p-${id}`, familyName: '김', givenName: id, mrn: `M-${id}` },
  bed: { id: bedId, roomNumber: '701', bedLabel: '1', ward: { id: 'w7', name: '7병동' } }, admitDate: '2026-09-30T01:00:00Z', stayDays: 1, ...extra,
});

type Routes = Record<string, unknown>;
function routes(r: Routes) {
  get.mockImplementation(async (url: string) => {
    for (const [k, v] of Object.entries(r)) if (url.startsWith(k)) { if (v instanceof Error) throw v; return v; }
    return { data: [] };
  });
}

async function mount() {
  const { default: Page } = await import('@/app/(main)/nurse-station/page');
  return render(<Page />, { wrapper: wrap });
}

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); patch.mockReset(); });

describe('MAR — 오늘 + 지난 미처리 · 상태 정본', () => {
  it('🔴 투약 조회는 date + includeOverdue 로 부른다(날짜 없는 전 기간 조회 금지)', () => {
    expect(SRC.match(/medication-schedule\?date=\$\{kstToday\(\)\}&includeOverdue=true/g)?.length).toBe(2);
    expect(SRC).not.toMatch(/medication-schedule`\)/);
  });
  it('🔴 거부(REFUSED)를 "예정"으로 그리지 않는다 · 지난 날짜 표식 · 중단 처방은 투여 버튼 없음', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/admissions/a1/medication-schedule': { data: [
        { id: 'm-old', scheduledAt: '2026-09-29T00:00:00Z', status: 'SCHEDULED', carriedOver: true, prescription: { status: 'ACTIVE', medicationCode: { nameKo: '어제약' } } },
        { id: 'm-ref', scheduledAt: '2026-09-30T00:00:00Z', status: 'REFUSED', carriedOver: false, prescription: { status: 'ACTIVE', medicationCode: { nameKo: '거부약' } } },
        { id: 'm-dc', scheduledAt: '2026-09-30T01:00:00Z', status: 'SCHEDULED', carriedOver: false, prescription: { status: 'DISCONTINUED', medicationCode: { nameKo: '중단약' } } },
      ] },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('투약 관리'));
    await waitFor(() => expect(container.textContent).toContain('거부약'));
    const row = (name: string) => [...container.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(name))!;
    expect(row('거부약').textContent).toContain('거부');
    expect(row('거부약').textContent).not.toContain('예정');
    expect(row('어제약').textContent).toContain('지난 날짜');
    expect(row('어제약').textContent).toContain('투약(스캔)');
    // 중단 처방 — 투여 버튼 대신 안내
    expect(row('중단약').textContent).not.toContain('투약(스캔)');
    expect(row('중단약').textContent).toContain('처방이 중단돼 투여하지 않습니다');
  });
});

describe('환자 목록 — 서버 정본 값', () => {
  it('🔴 입원 일차는 서버 stayDays · 지난 미기록 투약 배지', async () => {
    routes({ '/api/v1/admissions/active/list': { data: [adm('a1', 'b1', { stayDays: 1, carriedOverMedCount: 2, pendingMedCount: 3 })] } });
    const { container } = await mount();
    await waitFor(() => expect(container.textContent).toContain('입원 1일차'));
    expect(container.textContent).toContain('지난 미기록 2건');
    expect(container.textContent).toContain('오늘 투약 3건');
    expect(SRC).not.toMatch(/function daysSince/);
  });
});

describe('병동 보드 — 병상 상태가 정본', () => {
  it('🔴 점유 병상인데 목록에 환자가 없으면 "빈 병상"이 아니라 "사용 중 — 환자 정보 없음"', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/beds/list': { data: [
        { id: 'b1', roomNumber: '701', bedNumber: '1', status: 'OCCUPIED', ward: { name: '7병동' } },
        { id: 'b2', roomNumber: '701', bedNumber: '2', status: 'OCCUPIED', ward: { name: '7병동' } },
        { id: 'b3', roomNumber: '702', bedNumber: '1', status: 'AVAILABLE', ward: { name: '7병동' } },
      ] },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('병동 보드'));
    await waitFor(() => expect(container.textContent).toContain('사용 중 — 환자 정보 없음'));
    expect(container.textContent).toContain('701호 2');
    expect(container.textContent).toContain('빈 병상');
    expect(container.textContent).toContain('김a1');
  });
  it('보드는 전체 재원 목록을 받는다(내 담당만 필터와 무관)', () => {
    expect(SRC).toContain('<WardBoardTab admissions={allAdmissions} wardId={selectedWardId} />');
  });
});

describe('쓰기 폼·실패 정직성', () => {
  it('🔴 활력·I/O·간호기록 입력창이 첫 환자로 시작하지 않는다', () => {
    expect(SRC).not.toMatch(/useState\(admissions\[0\]/);
    expect(SRC).not.toMatch(/initialAdmissionId \|\| admissions\[0\]/);
  });
  it('🔴 QA 요청 실패를 "비활성"으로 말하지 않는다', () => {
    expect(SRC).not.toMatch(/catch \{ setQa\(\{ enabled: false \}\); \}/);
    expect(SRC).toContain('setQa({ failed: true })');
  });
  it('🔴 간호 기록 조회 실패는 "기록 없음"이 아니다 · 시각은 UTC 문자열 자르기 금지', () => {
    expect(SRC).toMatch(/notesIsError \? \(/);
    expect(SRC).not.toMatch(/\{at\.slice\(11, 16\)\}/);
    expect(SRC).not.toMatch(/\(n\.recordedAt \?\? n\.createdAt\)\.slice\(0, 10\)/);
  });
  it('🔴 인계 작성자를 화면이 보내지 않는다(서버가 로그인 사용자로)', () => {
    expect(SRC).not.toMatch(/fromDoctorId: useAuthStore/);
  });
  it('🔴 담당 배정은 근무조를 보낸다(서버 기본 DAY 로 떨어지지 않게)', () => {
    expect(SRC).toMatch(/assignments', \{ nurseId: user\?\.id, admissionId: admission\.id, shiftType: shiftOf\(/);
  });
});

describe('근무조 마감(하번)', () => {
  it('🔴 담당 0 은 "모두 완료"가 아니다 — 배정이 없다고 말한다', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [] },
      '/api/v1/nursing/shift-closeout': { data: { shift: 'DAY', start: '2026-09-29T22:00:00Z', end: '2026-09-30T06:00:00Z', assignments: 0, items: [], summary: { withoutMyNote: 0, withoutVitals: 0, pendingMeds: 0, withoutHandoff: 0 } } },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('근무조 마감'));
    await waitFor(() => expect(container.textContent).toContain('담당으로 배정된 재원 환자가 없습니다.'));
  });
  it('환자별 빈칸을 보여 주고 인계 쓰기로 넘긴다', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/nursing/shift-closeout': { data: {
        shift: 'DAY', start: '2026-09-29T22:00:00Z', end: '2026-09-30T06:00:00Z', assignments: 1,
        items: [{ assignmentId: 's1', admissionId: 'a1', patient: { id: 'p-a1', familyName: '김', givenName: 'a1', mrn: 'M-a1' }, bed: null,
          notes: { mine: 0, total: 1, myDrafts: 0 }, vitals: 0, io: 0, meds: { dueSoFar: 2, pending: 1 }, handoff: null }],
        summary: { withoutMyNote: 1, withoutVitals: 1, pendingMeds: 1, withoutHandoff: 1 },
      } },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('근무조 마감'));
    await waitFor(() => expect(container.textContent).toContain('내 기록 없음 1명'));
    expect(container.textContent).toContain('미기록 1/2');
    expect(container.textContent).toContain('다른 간호사 1건');
    fireEvent.click(screen.getByText('인계 쓰기'));
    await waitFor(() => expect(container.textContent).toContain('인계 작성 (하번)'));
    const sel = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'a1')) as HTMLSelectElement;
    expect(sel.value).toBe('a1');
  });
  it('🔴 조회 실패는 실패로', async () => {
    routes({ '/api/v1/admissions/active/list': { data: [] }, '/api/v1/nursing/shift-closeout': new Error('500') });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('근무조 마감'));
    await waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/));
    expect(container.textContent).not.toContain('담당으로 배정된 재원 환자가 없습니다.');
  });
});

describe('상번 — 인수 확인 + 담당 인수', () => {
  it('🔴 확인이 먼저 · 그다음 담당 인수(근무조 동봉)', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [] },
      '/api/v1/handoffs/next-shift-nurses': { data: { nextShift: 'EVENING', entries: [] } },
      '/api/v1/handoffs/pending': { data: [{ id: 'h1', type: 'NURSING_SHIFT', admissionId: 'a1', summary: 's', createdAt: '2026-09-30T00:00:00Z', patient: { familyName: '김', givenName: 'a1' } }] },
      // 인수 방식 원내 규정(2026-10-26) — 둘 다 제공(코드 기본값)일 때 두 단추
      '/api/v1/nursing-rules': { data: { handoffAckMode: { mode: 'OFFER_BOTH', source: 'CODE_DEFAULT' } } },
    });
    patch.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: {} });
    await mount();
    fireEvent.click(await screen.findByText('인계(상·하번)'));
    fireEvent.click(await screen.findByText('인수 확인 + 담당 인수'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/api/v1/handoffs/h1/acknowledge');
    expect(post.mock.calls[0][0]).toBe('/api/v1/nurse-station/assignments/take-over');
    expect(post.mock.calls[0][1]).toMatchObject({ admissionId: 'a1', shiftType: expect.stringMatching(/DAY|EVENING|NIGHT/) });
    expect(patch.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
  });
  it('확인이 실패하면 담당을 넘기지 않는다', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [] },
      '/api/v1/handoffs/next-shift-nurses': { data: { nextShift: 'EVENING', entries: [] } },
      '/api/v1/handoffs/pending': { data: [{ id: 'h1', type: 'NURSING_SHIFT', admissionId: 'a1', summary: 's', createdAt: '2026-09-30T00:00:00Z' }] },
      '/api/v1/nursing-rules': { data: { handoffAckMode: { mode: 'OFFER_BOTH', source: 'CODE_DEFAULT' } } },
    });
    patch.mockRejectedValue(new Error('403'));
    await mount();
    fireEvent.click(await screen.findByText('인계(상·하번)'));
    fireEvent.click(await screen.findByText('인수 확인 + 담당 인수'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
  });
});

describe('🔴 인수 방식 원내 규정(2026-10-26)', () => {
  const PENDING = { data: [{ id: 'h1', type: 'NURSING_SHIFT', admissionId: 'a1', summary: 's', createdAt: '2026-09-30T00:00:00Z' }] };
  const NEXT = { data: { nextShift: 'EVENING', entries: [] } };
  it('늘 묶음 → 단추 하나("인수 확인 + 담당 인수")가 확인만 부른다(담당 인수는 서버) · 화면이 take-over 를 따로 부르지 않는다', async () => {
    routes({ '/api/v1/admissions/active/list': { data: [] }, '/api/v1/handoffs/next-shift-nurses': NEXT, '/api/v1/handoffs/pending': PENDING, '/api/v1/nursing-rules': { data: { handoffAckMode: { mode: 'ALWAYS_BUNDLED', source: 'CONFIGURED' } } } });
    patch.mockResolvedValue({ data: { data: { takeOver: { mode: 'ALWAYS_BUNDLED', done: true, reason: null } } } });
    await mount();
    fireEvent.click(await screen.findByText('인계(상·하번)'));
    await waitFor(() => expect(screen.getAllByText('인수 확인 + 담당 인수').length).toBe(1));
    expect(screen.queryByText('인수 확인')).toBeNull();
    fireEvent.click(screen.getByText('인수 확인 + 담당 인수'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/handoffs/h1/acknowledge'));
    expect(post).not.toHaveBeenCalled();
  });
  it('🔴 규정 조회 실패 → 인수 확인만(담당 인수 단추 없음) · 묶지 않음 → 안내', async () => {
    routes({ '/api/v1/admissions/active/list': { data: [] }, '/api/v1/handoffs/next-shift-nurses': NEXT, '/api/v1/handoffs/pending': PENDING, '/api/v1/nursing-rules': new Error('500') });
    const v = await mount();
    fireEvent.click(await screen.findByText('인계(상·하번)'));
    await waitFor(() => expect(v.container.querySelector('[data-ack-mode-hint="UNKNOWN"]')).not.toBeNull());
    expect(screen.queryByText('인수 확인 + 담당 인수')).toBeNull();
    cleanup();
    routes({ '/api/v1/admissions/active/list': { data: [] }, '/api/v1/handoffs/next-shift-nurses': NEXT, '/api/v1/handoffs/pending': PENDING, '/api/v1/nursing-rules': { data: { handoffAckMode: { mode: 'SEPARATE', source: 'CONFIGURED' } } } });
    const w = await mount();
    fireEvent.click(await screen.findByText('인계(상·하번)'));
    await waitFor(() => expect(w.container.querySelector('[data-ack-mode-hint="SEPARATE"]')).not.toBeNull());
    expect(screen.queryByText('인수 확인 + 담당 인수')).toBeNull();
  });
});

describe('활력 — 서버 필드명·서버 판정(2026-10-01)', () => {
  it('🔴 체온·SpO2 를 서버 이름(temperature·spo2)으로 읽는다 · 이상 표시는 서버 flags', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/nurse-station/vitals/patient/': { data: [
        { id: 'v1', measuredAt: '2026-09-30T01:00:00Z', temperature: 38.6, spo2: 93, systolicBp: 120, diastolicBp: 80, heartRate: 88, respiratoryRate: 26, painScore: 2,
          flags: { temperature: 'CRITICAL', spo2: 'WARNING', systolicBp: 'NORMAL', diastolicBp: 'NORMAL', heartRate: 'NORMAL', respiratoryRate: 'WARNING', painScore: 'NORMAL' } },
      ], meta: { vitalsRule: { source: 'DEFAULT', droppedKeys: [], invertedKeys: [] } } },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('활력징후'));
    await waitFor(() => expect(container.textContent).toContain('38.6'));
    const row = [...container.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('38.6'))!;
    // 2026-10-07 활력 표시 부품 정본(VitalRowCells)으로 이관 — 이상 색은 서버 병합 임계(응답 flags 와 같은 기준) · 단위는 머리줄
    const val = (k: string) => row.querySelector(`[data-vital="${k}"]`)!;
    expect(val('temperature').textContent).toContain('38.6');
    expect(val('temperature').getAttribute('data-vital-flag')).toBe('CRITICAL');
    expect(val('spo2').getAttribute('data-vital-flag')).toBe('WARNING');
    expect(val('respiratoryRate').getAttribute('data-vital-flag')).toBe('WARNING');
    expect(val('heartRate').getAttribute('data-vital-flag')).toBe('NORMAL');
    expect(container.textContent).toContain('이상 표시 기준: 코드 기본값(원내 개정 없음)');
  });
  it('🔴 화면에 임계 숫자를 두지 않는다(4번째 정본 회수)', () => {
    expect(SRC).not.toMatch(/function isAbnormalVital/);
    expect(SRC).not.toMatch(/val > 140|val < 95|val > 38/);
    expect(SRC).not.toMatch(/\.bodyTemperature|\.spO2\b/);
  });
  it('개정 키가 버려졌으면 그 사실을 말한다', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/nurse-station/vitals/patient/': { data: [{ id: 'v1', measuredAt: '2026-09-30T01:00:00Z', heartRate: 70, flags: { heartRate: 'NORMAL' } }], meta: { vitalsRule: { source: 'DEFAULT', droppedKeys: ['sbp'], invertedKeys: [] } } },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('활력징후'));
    await waitFor(() => expect(container.textContent).toContain('적용되지 않은 개정 항목: sbp'));
  });
});

describe('늦은 기록 유예 — 원내 규정', () => {
  it('🔴 미설정이면 "유예 규정 미설정"이라 말한다(0분을 규정인 척하지 않는다)', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/config/nursing.lateEntry.graceMinutes': { data: null },
      '/api/v1/admissions/a1/nursing-notes': { data: [] },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('간호 기록'));
    const sel = await waitFor(() => [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'a1')) as HTMLSelectElement);
    fireEvent.change(sel, { target: { value: 'a1' } });
    await waitFor(() => expect(container.textContent).toContain('늦은 기록 기준: 근무조 종료 시각(유예 규정 미설정)'));
  });
  it('설정되면 그 분을 밝힌다', async () => {
    routes({
      '/api/v1/admissions/active/list': { data: [adm('a1', 'b1')] },
      '/api/v1/config/nursing.lateEntry.graceMinutes': { data: 30 },
      '/api/v1/admissions/a1/nursing-notes': { data: [] },
    });
    const { container } = await mount();
    fireEvent.click(await screen.findByText('간호 기록'));
    const sel = await waitFor(() => [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'a1')) as HTMLSelectElement);
    fireEvent.change(sel, { target: { value: 'a1' } });
    await waitFor(() => expect(container.textContent).toContain('늦은 기록 기준: 근무조 종료 후 30분(원내 규정)'));
  });
});
