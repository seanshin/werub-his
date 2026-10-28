/**
 * 처방 중단(DISCONTINUED) 화면 — 2026-09-30 오더 중단 설계.
 *  1. 중단 창 — 사유가 비면 보내지 않는다 · 사유와 함께 중단 EP 를 부른다
 *  2. 투약 이력 탭 — 중단된 약은 '투여 중'·상호작용 점검에서 빠지고 '중단' 배지로 남는다
 *  3. 시계열 레인 — 중단된 처방은 진행 중이 아니다
 *  4. 진료 화면 — 취소가 PRESCRIPTION_TOOK_EFFECT 로 거부되면 중단 창을 연다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/stores/auth-store', () => { const s = { user: { id: 'u', role: 'DOCTOR', permissions: [] } }; const f = (sel?: (x: typeof s) => unknown) => (sel ? sel(s) : s); return { useAuthStore: Object.assign(f, { getState: () => s }) }; });

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('중단 창', () => {
  it('사유가 비면 보내지 않는다 · 사유와 함께 중단 EP', async () => {
    post.mockResolvedValue({ data: { alreadyDiscontinued: false, cancelledOrders: 1, removedFutureMar: 2 } });
    const { DiscontinueDialog } = await import('@/components/prescription/DiscontinueDialog');
    const onDone = vi.fn();
    const { container } = render(<DiscontinueDialog prescriptionId="rx1" name="세프트리악손" onClose={() => {}} onDone={onDone} />, { wrapper: wrap });
    const btn = container.querySelector('[data-discontinue-submit]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-discontinue-reason]')!, { target: { value: '부작용(발진)' } });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/prescriptions/rx1/discontinue', { reason: '부작용(발진)' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith({ cancelledOrders: 1, removedFutureMar: 2, alreadyDiscontinued: false }));
  });
});

describe('투약 이력 탭', () => {
  it('🔴 중단된 약은 투여 중·상호작용 점검에서 빠지고 중단 배지로 남는다', async () => {
    const now = new Date().toISOString();
    get.mockResolvedValue({ data: [
      { id: 'a', type: 'MEDICATION', status: 'ACTIVE', createdAt: now, duration: 30, medicationCode: { nameKo: '활성약' } },
      // 서버 dosing 이 중단을 모르는 옛 응답이어도(투여 중으로 옴) 상태가 이긴다 — 상태 필터 자체를 겨눈다
      { id: 'b', type: 'MEDICATION', status: 'DISCONTINUED', createdAt: now, duration: 30, discontinuedAt: now, discontinueReason: '부작용', medicationCode: { nameKo: '중단약' },
        dosing: { state: 'DOSING', endsAt: new Date(Date.now() + 20 * 86400000).toISOString(), daysSinceEnd: null, durationDays: 30 } },
    ] });
    post.mockResolvedValue({ data: { interactions: [] } });
    const { MedicationTab } = await import('@/app/(main)/patients/[id]/components/MedicationTab');
    const { container, findByText } = render(<MedicationTab patientId="p1" />, { wrapper: wrap });
    await vi.waitFor(() => expect(container.querySelector('[data-rx-stop="a"]')).toBeTruthy(), { timeout: 10_000 });
    // 기본 탭(투여 중) 목록에 중단 처방 행이 없다(타임라인은 이력이라 둘 다 그린다)
    expect(container.querySelector('[data-rx-discontinued]')).toBeNull();
    expect(container.querySelector('[data-rx-stop="b"]')).toBeNull();
    // 상호작용 점검은 2종 이상일 때만 — 중단약을 빼면 1종이라 호출하지 않는다
    expect(post).not.toHaveBeenCalled();
    // 활성 처방에는 중단 버튼(의사)
    expect(container.querySelector('[data-rx-stop="a"]')).toBeTruthy();
    fireEvent.click((await findByText(/기간 종료·중단/)).closest('button')!);
    await vi.waitFor(() => expect(container.querySelector('[data-rx-discontinued]')).toBeTruthy());
    expect(container.textContent).toContain('부작용');
  }, 20_000);
});

describe('시계열 레인', () => {
  it('중단된 처방은 기간이 남았어도 진행 중이 아니다 · 대조군 활성은 진행 중', async () => {
    const { buildLanes } = await import('@/components/record-timeline/prescription-lanes');
    const nowMs = Date.parse('2026-09-30T12:00:00Z');
    const at = '2026-09-28T00:00:00Z';
    const stopped = buildLanes([{ id: 'x', at, title: '약가', duration: 30, status: 'DISCONTINUED', rxType: 'MEDICATION' } as never], nowMs);
    expect(stopped.lanes[0].ongoing).toBe(false);
    const active = buildLanes([{ id: 'y', at, title: '약가', duration: 30, status: 'ACTIVE', rxType: 'MEDICATION' } as never], nowMs);
    expect(active.lanes[0].ongoing).toBe(true);
  });
});

describe('진료 화면 — 발효된 처방의 취소 거부 → 중단', () => {
  it('취소 실패 코드가 PRESCRIPTION_TOOK_EFFECT 면 중단 창을 연다 · 중단된 행은 읽기 전용', () => {
    const s = readFileSync(join(process.cwd(), 'src/app/(main)/patients/[id]/encounter/new/page.tsx'), 'utf8');
    expect(s).toMatch(/code === 'PRESCRIPTION_TOOK_EFFECT'[\s\S]{0,120}setDiscontinueTarget/);
    expect(s).toMatch(/\{rx\.status !== 'DISCONTINUED' && <button/);
  });
});
