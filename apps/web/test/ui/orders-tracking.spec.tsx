/**
 * 오더 실시간 추적 보드·환자별 매트릭스(2026-10-06).
 *  · 권한 밖 역할은 부르지 않는다(서버 @Roles 와 같은 판정)
 *  · 서버 국면 그대로 칸에 놓는다 · 결과 미확인 칸은 검사·영상만(약제·치료는 '해당 없음')
 *  · 주의 기준이 없으면 "기준 미설정"(0 이 아니다) · 잘렸으면 말한다 · 표본 0 중앙값은 "산출 불가"
 *  · 매트릭스: 오더 없는 칸은 비운다(0 을 그리지 않는다) · 칸을 누르면 그 환자·부서 오더의 단계 줄
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const NOW = '2026-10-06T03:00:00.000Z';
const phases = { WAITING: 0, IN_PROCESS: 0, RESULT_UNACK: 0, DONE: 0, CANCELLED: 0 };
const stagesOf = (keys: string[], at: (string | null)[]) => keys.map((k, i) => ({ key: k, at: at[i] ?? null }));
const ord = (over: Record<string, unknown>) => ({
  id: 'o1', department: 'LAB', name: 'CBC', priority: 'ROUTINE', status: 'ORDERED', phase: 'WAITING', careContext: 'INPATIENT',
  patient: { id: 'p1', name: '김하나', mrn: 'M1' }, doctor: '박의사', createdAt: NOW,
  stages: stagesOf(['ORDERED', 'RECEIVED', 'COLLECTED', 'RESULTED', 'VERIFIED', 'ACKNOWLEDGED'], [NOW]),
  current: { key: 'ORDERED', at: NOW }, next: 'RECEIVED', inStageMin: 25, sinceOrderedMin: 25, totalMin: null,
  critical: false, abnormal: false, attention: null, carriedOver: false, ...over,
});
const tracking = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-06', now: NOW, population: 'DAY_ISSUED_PLUS_ACTIVE', truncated: false, total: 2,
  attention: { configured: false, thresholds: null },
  summary: { active: 2, waiting: 1, inProcess: 0, resultUnack: 0, done: 0, cancelled: 0, statActive: 1, critical: 0, attention: null, carriedOver: 0 },
  lanes: ['LAB', 'IMAGING', 'PHARMACY', 'THERAPY'].map((d) => ({ department: d, total: d === 'LAB' ? 1 : d === 'IMAGING' ? 1 : 0, byPhase: phases, stat: d === 'IMAGING' ? 1 : 0, oldestWaitingMin: d === 'LAB' ? 25 : null, turnaroundMin: { value: null, n: 0 } })),
  orders: [
    ord({}),
    ord({ id: 'o2', department: 'IMAGING', name: 'Chest CT', priority: 'STAT', status: 'RECEIVED', phase: 'IN_PROCESS', patient: { id: 'p2', name: 'Бат-Эрдэнэ Сарнай', koreanName: '사르나이', mrn: 'FT-4' }, careContext: 'ER', current: { key: 'RECEIVED', at: NOW } }),
  ],
  matrix: [
    { patient: { id: 'p2', name: 'Бат-Эрдэнэ Сарнай', koreanName: '사르나이', mrn: 'FT-4', age: 36, gender: 'FEMALE' }, careContext: 'ER', total: 1, active: 1, stat: 1, critical: 0, oldestActiveMin: 25,
      location: { ward: '5층 내과병동', room: '501', bed: 'A' }, doctors: ['박의사'], notes: [{ code: 'STAT_ACTIVE', level: 'URGENT', count: 1, minutes: 25 }],
      cells: { LAB: null, IMAGING: { total: 1, byPhase: { ...phases, IN_PROCESS: 1 }, stat: 1, critical: 0, attention: 0, oldestActiveMin: 25, orderIds: ['o2'] }, PHARMACY: null, THERAPY: null } },
    { patient: { id: 'p1', name: '김하나', mrn: 'M1' }, careContext: 'INPATIENT', total: 1, active: 1, stat: 0, critical: 0, oldestActiveMin: 25, notes: [],
      cells: { LAB: { total: 1, byPhase: { ...phases, WAITING: 1 }, stat: 0, critical: 0, attention: 0, oldestActiveMin: 25, orderIds: ['o1'] }, IMAGING: null, PHARMACY: null, THERAPY: null } },
  ],
  ...over,
});
const F = { dept: '' as const, care: '', statOnly: false, search: '' };

beforeEach(() => { cleanup(); get.mockReset(); useAuthStore.setState({ user: { id: 'u1', role: 'NURSE' } as never, isAuthenticated: true }); });

async function board(t: unknown, filters = F) {
  get.mockResolvedValue({ data: t });
  const { OrderTrackingBoard } = await import('@/app/(main)/orders/OrderTrackingBoard');
  return render(<OrderTrackingBoard date="2026-10-06" filters={filters} />, { wrapper: wrap });
}
async function matrix(t: unknown) {
  get.mockResolvedValue({ data: t });
  const { OrderPatientMatrix } = await import('@/app/(main)/orders/OrderPatientMatrix');
  return render(<OrderPatientMatrix date="2026-10-06" filters={F} />, { wrapper: wrap });
}

describe('오더 실시간 추적 보드', () => {
  it('🔴 권한 밖 역할(원무)은 추적 EP 를 부르지 않는다', async () => {
    useAuthStore.setState({ user: { id: 'r', role: 'RECEPTIONIST' } as never, isAuthenticated: true });
    const { container } = await board(tracking());
    expect(container.textContent).toContain('의사·간호사·약사·임상병리사가 봅니다');
    expect(get).not.toHaveBeenCalled();
  });

  it('🔴 서버 국면 그대로 칸에 · 결과 미확인은 검사·영상만 · 주의 기준 미설정은 "기준 미설정"(0 아님) · 표본 0 중앙값 "산출 불가"', async () => {
    const { container } = await board(tracking());
    await waitFor(() => expect(container.querySelector('[data-track-board]')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/api/v1/orders/tracking?date=2026-10-06');
    expect(container.querySelector('[data-track-cell="LAB-WAITING"] [data-track-card="o1"]')).toBeTruthy();
    expect(container.querySelector('[data-track-cell="IMAGING-IN_PROCESS"] [data-track-card="o2"]')).toBeTruthy();
    expect(container.querySelector('[data-track-cell="PHARMACY-RESULT_UNACK"]')).toBeNull();
    expect(container.querySelectorAll('[data-track-na]').length).toBe(2);
    const att = container.querySelector('[data-track-kpi="attention"]')!;
    expect(att.textContent).toContain('기준 미설정');
    expect(att.textContent).not.toMatch(/\b0\b/);
    expect(container.querySelector('[data-track-lane="LAB"] [data-track-tat]')!.textContent).toMatch(/산출 불가.*표본 없음/);
  });

  it('잘렸으면 전체 중 몇 건인지 말한다 · STAT 필터 · 카드를 누르면 단계 줄', async () => {
    const { container } = await board(tracking({ truncated: true, total: 900 }), { ...F, statOnly: true });
    await waitFor(() => expect(container.querySelector('[data-track-board]')).toBeTruthy());
    expect(container.querySelector('[data-track-population]')!.textContent).toContain('900');
    expect(container.querySelector('[data-track-card="o1"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-track-card="o2"]')!);
    expect(container.querySelector('[data-track-detail="o2"] [data-track-stages]')).toBeTruthy();
  });
});

describe('환자별 매트릭스', () => {
  it('🔴 오더 없는 칸은 비운다(0 을 그리지 않는다) · 서버 순서(STAT 환자 먼저) · 칸을 누르면 그 오더 단계', async () => {
    const { container } = await matrix(tracking());
    await waitFor(() => expect(container.querySelector('[data-track-matrix]')).toBeTruthy());
    const rows = [...container.querySelectorAll('[data-track-row]')].map((r) => r.getAttribute('data-track-row'));
    expect(rows).toEqual(['p2', 'p1']);
    expect(container.querySelector('[data-track-matrix-cell="p2-LAB"]')!.textContent).toBe('·');
    const cell = container.querySelector('[data-track-matrix-cell="p2-IMAGING"]')!;
    expect(cell.querySelector('[data-track-cell-order="o2"]')!.textContent).toMatch(/Chest CT.*STAT.*접수/);
    // 🔴 외국인 — 원어 이름과 한국식 호칭을 함께 · 위치·진료의
    const row = container.querySelector('[data-track-row="p2"]')!;
    expect(row.textContent).toContain('Бат-Эрдэнэ Сарнай');
    expect(row.querySelector('[data-patient-korean-name]')!.textContent).toBe('(사르나이)');
    expect(row.textContent).toContain('501-A');
    expect(row.textContent).toContain('박의사');
    // 🔴 확인 사항 — 규칙으로 센 사실 · 없으면 "확인 사항 없음"(빈 칸 아님) · 면책 문구
    expect(row.querySelector('[data-track-note="STAT_ACTIVE"]')!.textContent).toContain('STAT 1건 처리 중');
    expect(container.querySelector('[data-track-row="p1"] [data-track-notes="none"]')).toBeTruthy();
    expect(container.querySelector('[data-track-notes-disclaimer]')!.textContent).toContain('임상 판단이나 처방 권고가 아닙니다');
    fireEvent.click(container.querySelector('[data-track-matrix-cell="p2-IMAGING"] button')!);
    const det = container.querySelector('[data-track-matrix-detail]')!;
    expect(det.textContent).toContain('Chest CT');
    expect(det.querySelector('[data-track-stages]')).toBeTruthy();
  });

  it('호출부 역할 게이트가 두 화면 파일에 있다(역할×EP 스캐너가 본다)', () => {
    for (const f of ['OrderTrackingBoard.tsx', 'OrderPatientMatrix.tsx']) {
      const src = readFileSync(join(__dirname, '../../src/app/(main)/orders', f), 'utf8');
      expect(src, f).toMatch(/useHasRole\('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH'\)/);
    }
  });
});
