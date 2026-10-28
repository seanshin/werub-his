/**
 * 간호차트 검토 보완(2026-10-07).
 *  · 차트 '간호기록' 탭: 서버 필드명(admitDate·bed.ward.name)으로 날짜·병동 · 입원 상태 어휘(취소·전출을 퇴원으로 말하지 않음)
 *    · SOAP·SBAR 본문이 형식대로 · 미서명·정정 원본 표지 · 관찰 시각 · 하위 조회 실패는 실패로(404 사정만 "기록 없음") · I/O 최신순
 *  · 간호 스테이션 상세: 입원 기록에 없는 situation 대신 형식대로 · 환자 상세는 간호기록 탭
 *  · 입력 기본값: 워크스테이션 의식 수준 미선택 · 측정 0 보존 · I/O 빈 양 저장 막힘 · 기록 근무조는 병원 경계
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/lib/api-client';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/patients/p1', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const adm = { id: 'a1', status: 'ADMITTED', admitDate: '2026-10-01T00:00:00Z', dischargeDate: null, bed: { roomNumber: '701', ward: { name: '7병동' } } };
const notes = [
  { id: 'n1', noteType: 'SOAP', subjective: '두통 호소', objective: 'BT 38.2', assessment: '고열', plan: '해열제', status: 'SIGNED', recordedAt: '2026-10-06T22:00:00Z', createdAt: '2026-10-07T01:00:00Z' },
  { id: 'n2', noteType: 'SBAR', focus: '흉통', data: 'MI 병력', action: 'ECG', response: '보고', status: 'DRAFT', recordedAt: '2026-10-06T10:00:00Z', createdAt: '2026-10-06T10:00:00Z' },
];
function route(o: { notesFail?: boolean; assess404?: boolean; admissions?: unknown[] } = {}) {
  get.mockImplementation((url: string) => {
    if (url.includes('/inpatient/patient/')) return Promise.resolve({ data: o.admissions ?? [adm, { ...adm, id: 'a0', status: 'CANCELLED' }] });
    if (url.includes('/nursing-assessment')) return o.assess404 ? Promise.reject(new ApiError('Not Found', 'Nursing assessment not found')) : Promise.resolve({ data: null });
    if (url.includes('/nursing-notes') && url.includes('/admissions/')) return o.notesFail ? Promise.reject(new Error('boom')) : Promise.resolve({ data: notes });
    if (url.includes('/intake-outputs')) return Promise.resolve({ data: [{ id: 'i1', recordedAt: '2026-10-01T01:00:00Z', intakeAmount: 100 }, { id: 'i2', recordedAt: '2026-10-06T01:00:00Z', outputAmount: 300 }] });
    return Promise.resolve({ data: [] });
  });
}
async function tab() {
  useAuthStore.setState({ user: { id: 'u1', role: 'NURSE' } as never, isAuthenticated: true });
  const { NursingRecordTab } = await import('@/app/(main)/patients/[id]/components/NursingRecordTab');
  return render(<NursingRecordTab patientId="p1" />, { wrapper: wrap });
}
beforeEach(() => { cleanup(); get.mockReset(); });

describe('차트 간호기록 탭', () => {
  it('🔴 입원 날짜·병동은 서버 필드명 · 취소 입원을 "퇴원"이라 하지 않는다', async () => {
    route();
    const { container } = await tab();
    await waitFor(() => expect(container.querySelector('[data-nursing-adm-status="ADMITTED"]')).toBeTruthy());
    expect(container.querySelector('[data-nursing-adm-date]')!.textContent).toContain('2026-10-01');
    expect(container.textContent).toContain('7병동');
    expect(container.querySelector('[data-nursing-adm-status="CANCELLED"]')!.textContent).not.toContain('퇴원');
  });
  it('🔴 SOAP·SBAR 본문이 형식대로 · 미서명 표지 · 404 사정은 "기록 없음"', async () => {
    route({ assess404: true });
    const { container } = await tab();
    await waitFor(() => expect(container.querySelector('[data-nursing-adm-status="ADMITTED"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-nursing-adm-status="ADMITTED"]')!.closest('button')!);
    await waitFor(() => expect(container.querySelector('[data-nursing-note="n1"]')).toBeTruthy());
    expect(container.querySelector('[data-nursing-note="n1"]')!.textContent).toContain('S: 두통 호소');
    expect(container.querySelector('[data-nursing-note="n2"]')!.textContent).toContain('B: MI 병력');
    expect(container.querySelector('[data-nursing-note-status="DRAFT"]')).toBeTruthy();
    expect(container.textContent).toContain('간호 사정 기록 없음');
  });
  it('🔴 노트 조회 실패는 "간호 노트 없음"이 아니다', async () => {
    route({ notesFail: true });
    const { container } = await tab();
    await waitFor(() => expect(container.querySelector('[data-nursing-adm-status="ADMITTED"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-nursing-adm-status="ADMITTED"]')!.closest('button')!);
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('/nursing-notes'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).not.toContain('간호 노트 없음');
  });
});

describe('스테이션·입력 기본값(구조)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
  it('🔴 간호 스테이션 상세는 situation 을 읽지 않고 형식대로 · 환자 상세는 간호기록 탭', () => {
    const s = read('app/(main)/nurse-station/page.tsx');
    expect(s).not.toMatch(/\.situation \?\? n\.content/);
    expect(s).toMatch(/noteLine\(notes\[0\]\)/);
    expect(s).toMatch(/\/patients\/\$\{admission\.patientId\}\?tab=nursing/);
  });
  it('🔴 워크스테이션 의식 수준 미선택 시작 · 측정 0 보존 · I/O 빈 양 막힘 · 기록 근무조는 병원 경계', () => {
    const ws = read('app/(main)/workstation/nursing/page.tsx');
    expect(ws).not.toMatch(/consciousness: 'ALERT'/);
    expect(ws).not.toMatch(/Number\(form\.painScale\) \|\| undefined/);
    const io = read('app/(main)/inpatient/[admissionId]/nursing/io/page.tsx');
    expect(io).not.toMatch(/\|\| 0;/);
    expect(io).toMatch(/disabled=\{createMutation\.isPending \|\| !amountValid\}/);
    const notesPage = read('app/(main)/inpatient/[admissionId]/nursing/notes/page.tsx');
    expect(notesPage).not.toMatch(/shiftType: 'DAY'/);
  });
});

describe('인계 등록 폼 — 인수자 후보', () => {
  async function form(next: unknown, all: unknown[]) {
    get.mockImplementation((url: string) => {
      if (url.includes('/next-shift-nurses')) return Promise.resolve({ data: next });
      if (url.includes('/users?role=NURSE')) return Promise.resolve({ data: all });
      if (url.includes('/inpatient?')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    useAuthStore.setState({ user: { id: 'me', role: 'NURSE' } as never, isAuthenticated: true });
    const { NewHandoffForm } = await import('@/app/(main)/handoffs/new-handoff-form');
    const u = render(<NewHandoffForm />, { wrapper: wrap });
    fireEvent.click(u.container.querySelector('button')!);
    return u;
  }
  it('🔴 서버 응답 {nextShift, entries} 를 읽어 제안(★) + 전체 간호사 — 종전엔 늘 빈 목록이라 등록 불가', async () => {
    const { container } = await form({ nextShift: 'NIGHT', entries: [{ staffId: 'n9', staffName: '김야간' }] }, [{ id: 'n9', familyName: '김', givenName: '야간' }, { id: 'n2', familyName: '이', givenName: '주간' }]);
    await waitFor(() => expect(container.querySelector('[data-handoff-suggest="1"]')).toBeTruthy());
    const opts = [...container.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    expect(opts).toEqual(expect.arrayContaining(['n9', 'n2']));
    expect(opts.filter((v) => v === 'n9').length).toBe(1);
  });
  it('🔴 근무표 제안이 없어도 전체 간호사로 고를 수 있다', async () => {
    const { container } = await form({ nextShift: 'DAY', entries: [] }, [{ id: 'n2', familyName: '이', givenName: '주간' }]);
    await waitFor(() => expect(container.querySelector('[data-handoff-suggest="none"]')).toBeTruthy());
    await waitFor(() => expect([...container.querySelectorAll('option')].some((o) => o.getAttribute('value') === 'n2')).toBe(true));
  });
});
