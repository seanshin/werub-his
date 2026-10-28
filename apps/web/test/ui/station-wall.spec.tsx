/**
 * ⑩ 간호 스테이션 벽걸이(TV) 화면(2026-10-04).
 *  🔴 마스킹은 서버가 한다 — 이 화면은 받은 것만 그린다(원문 이름 필드를 읽는 코드가 없어야 한다)
 *  · 병동은 주소(?ward=)로 고정 · 자동 갱신 · 위급값·투약 지연·격리·NPO·수술 시각 · 담당은 마스킹된 이름
 * 재주입: 서버 벽걸이 EP 대신 보드 EP 를 부르거나, 병동 주소를 무시하면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/station-wall', useSearchParams: () => new URLSearchParams() }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const SRC = readFileSync(join(process.cwd(), 'src/app/station-wall/page.tsx'), 'utf8');

const wall = {
  shift: { current: 'DAY', start: '2026-10-03T22:00:00Z', end: '2026-10-04T06:00:00Z' }, wardName: '7병동', generatedAt: new Date().toISOString(),
  patients: [
    { room: '701', bed: '1', ward: '7병동', name: '김○나', highRisk: true, ewsRisk: 'HIGH', ewsStale: false, fallRisk: 'HIGH', isolation: ['CONTACT'], medsOverdue: 2, criticalOpen: 1, surgeryAt: null, surgeryInProgress: false, npo: true, expectedDischargeAt: null, transferPending: false, nurse: '박○이', handoffUnacked: true },
    { room: '702', bed: '2', ward: '7병동', name: '이○', highRisk: false, ewsRisk: null, ewsStale: true, fallRisk: null, isolation: [], medsOverdue: 0, criticalOpen: 0, surgeryAt: null, surgeryInProgress: true, npo: false, expectedDischargeAt: null, transferPending: true, nurse: null, handoffUnacked: false },
  ],
  summary: { total: 2, highRisk: 1, medsOverdue: 1, criticalOpenPatients: 1, npo: 1, surgeryUpcoming: 1, dischargeToday: 0 },
};

beforeEach(() => { cleanup(); get.mockReset(); window.history.replaceState({}, '', '/station-wall?ward=w7'); });

describe('벽걸이 화면', () => {
  it('🔴 서버 벽걸이 EP 를 주소의 병동으로 부른다 · 받은 마스킹 이름만 그린다', async () => {
    get.mockResolvedValue({ data: wall });
    const { default: Page } = await import('@/app/station-wall/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('김○나'));
    expect(get).toHaveBeenCalledWith('/api/v1/nursing/station-board/wall?wardId=w7');
    expect(container.textContent).toMatch(/위급값 미확인 1/);
    expect(container.textContent).toMatch(/투약 지연 2/);
    expect(container.textContent).toContain('NPO');
    expect(container.textContent).toContain('수술 중');
    expect(container.textContent).toContain('EWS 24시간 경과');
    expect(container.textContent).toContain('담당 박○이');
    expect(container.textContent).toContain('담당 배정 없음');
    expect(container.textContent).toContain('인계 메모·검사값은 이 화면에 나오지 않습니다');
  });

  it('🔴 보드 EP(원문 이름·메모 포함)를 부르지 않는다 · 원문 필드(mrn·familyName·memo)를 읽는 코드가 없다', () => {
    expect(SRC).not.toMatch(/station-board[`'?]/);
    expect(SRC).toMatch(/station-board\/wall/);
    expect(SRC).not.toMatch(/\.mrn\b|familyName|\.memo\b|patientSummary/);
  });

  it('조회 실패를 "재원 환자 없음"으로 말하지 않는다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { default: Page } = await import('@/app/station-wall/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).not.toContain('불러오는 중'));
    expect(container.textContent).not.toContain('재원 환자가 없습니다.');
  });
});
