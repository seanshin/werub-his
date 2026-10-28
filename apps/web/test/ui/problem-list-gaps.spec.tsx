/**
 * 문제 목록 ↔ 진료 진단(2026-10-03).
 *  🔴 진료 전 요약은 문제 목록이 **완전히 비었을 때만** "정리되지 않음"을 말했다 · 문제 추가 EP 는 있었는데 부르는 화면이 없었다
 *  · 요약: 진단마다 등재 여부 · 일부만 정리돼도 말한다 · 모르면 모른다고
 *  · 문제목록 탭: 진단 중 문제 목록에 없는 것 · 상태·중증도를 **골라야** 올린다(서버 기본값 MODERATE 가 조용히 박히지 않게) · 의사·관리자만
 * 재주입: 일부 누락 침묵·고르기 전 저장·역할 게이트·본문을 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => null } }));
let role = 'DOCTOR';
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: (...roles: string[]) => role === 'ADMIN' || roles.includes(role) }));

const P = '00000000-0000-4000-a000-000000d00001';
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const brief = (dx: unknown[]) => ({ computedAt: new Date().toISOString(), basis: [], activeMedications: [], medicationDetails: [], activeProblems: ['요통'], recordDiagnoses: dx, recentLabs: [], abnormalLabCount: 0, unavailable: [] });
const DX = [
  { code: 'I10', name: '본태성 고혈압', lastAt: '2026-08-01T00:00:00Z', encounters: 2, diagnosisCodeId: 'dc-i', onProblemList: false },
  { code: 'M54.5', name: '요통', lastAt: '2026-08-02T00:00:00Z', encounters: 1, diagnosisCodeId: 'dc-m', onProblemList: true },
];

beforeEach(() => { get.mockReset(); post.mockReset(); role = 'DOCTOR'; });
afterEach(() => cleanup());

const routes = (dx: unknown[]) => async (u: string) => (u.includes('/ai/brief/') ? { data: brief(dx) } : { data: [] });

describe('진료 전 요약', () => {
  it('🔴 일부만 정리돼도 말한다 · 진단마다 표시 · 모르면(null) 모른다고', async () => {
    get.mockImplementation(routes(DX));
    const { PatientBriefCard } = await import('@/app/(main)/patients/[id]/components/PatientBriefCard');
    const onTab = vi.fn();
    const r = wrap(<PatientBriefCard patientId={P} onTabChange={onTab} />);
    await waitFor(() => expect(r.container.querySelector('[data-brief-dx-gap]')).not.toBeNull());
    expect(r.container.querySelector('[data-brief-dx-gap]')!.textContent).toContain('2개 중 1개가 문제 목록에 없습니다');
    expect(r.container.querySelector('[data-brief-dx="I10"]')!.textContent).toContain('문제 목록에 없음');
    expect(r.container.querySelector('[data-brief-dx="M54.5"]')!.textContent).not.toContain('문제 목록에 없음');
    fireEvent.click(r.container.querySelector('[data-brief-dx-gap] button')!);
    expect(onTab).toHaveBeenCalledWith('problems');
    cleanup();
    get.mockImplementation(routes([{ ...DX[0], onProblemList: null }]));
    const r2 = wrap(<PatientBriefCard patientId={P} onTabChange={() => {}} />);
    await waitFor(() => expect(r2.container.textContent).toContain('문제 목록을 읽지 못해'));
    expect(r2.container.querySelector('[data-brief-dx-gap]')).toBeNull();
  });
});

describe('문제목록 탭 — 진단에서 올리기', () => {
  it('🔴 상태·중증도를 고르기 전엔 저장 불가 · 본문은 그 진단 코드·이름·고른 값', async () => {
    get.mockImplementation(routes(DX));
    post.mockResolvedValue({ data: { id: 'p9' } });
    const { ProblemListTab } = await import('@/app/(main)/patients/[id]/components/ProblemListTab');
    const r = wrap(<ProblemListTab patientId={P} />);
    await waitFor(() => expect(r.container.querySelector('[data-problem-gaps]')).not.toBeNull());
    expect(r.container.querySelectorAll('[data-problem-gap]').length).toBe(1);
    fireEvent.click(r.container.querySelector('[data-problem-gap-open="I10"]')!);
    const save = () => r.container.querySelector('[data-problem-gap-save]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(r.container.querySelector('[data-problem-gap-status]')!, { target: { value: 'CHRONIC' } });
    expect(save().disabled).toBe(true); // 중증도도 골라야
    fireEvent.change(r.container.querySelector('[data-problem-gap-severity]')!, { target: { value: 'MILD' } });
    fireEvent.click(save());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual([`/api/v1/patients/${P}/problems`, { diagnosisCodeId: 'dc-i', description: '본태성 고혈압', status: 'CHRONIC', severity: 'MILD' }]);
    await waitFor(() => expect(get.mock.calls.some((c) => c[0] === `/api/v1/ai/brief/${P}?refresh=1`)).toBe(true));
  });

  it('🔴 간호사는 목록만 보고 올리지 못한다(서버 POST 는 의사·관리자) · 대조군: 빠진 진단이 없으면 패널이 없다', async () => {
    role = 'NURSE';
    get.mockImplementation(routes(DX));
    const { ProblemListTab } = await import('@/app/(main)/patients/[id]/components/ProblemListTab');
    const r = wrap(<ProblemListTab patientId={P} />);
    await waitFor(() => expect(r.container.querySelector('[data-problem-gaps]')).not.toBeNull());
    expect(r.container.querySelector('[data-problem-gap-open]')).toBeNull();
    expect(r.container.textContent).toContain('의사·관리자');
    cleanup();
    role = 'DOCTOR';
    get.mockImplementation(routes([DX[1]]));
    const r2 = wrap(<ProblemListTab patientId={P} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 20));
    expect(r2.container.querySelector('[data-problem-gaps]')).toBeNull();
  });
});
