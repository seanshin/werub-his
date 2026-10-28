/**
 * 항암 점검 우회 이력(2026-10-10) — nadir 게이트를 넘겨 시작한 사이클을 누가·언제·왜.
 *  · 조회 실패 ≠ 0건 · 잘림 고지 · 🔴 누가·왜가 남지 않은 시작은 '기록 없음'(지어내지 않는다)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => {
  const real = (await orig()) as object;
  return { ...real, apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn() } };
});
vi.mock('@/components/ui/PatientSelector', () => ({ default: () => null }));

import GateOverrideHistory, { type GateOverrideItem } from '@/app/(main)/chemo/GateOverrideHistory';

const row = (o: Partial<GateOverrideItem>): GateOverrideItem => ({
  cycleId: 'c1', courseId: 'k1', cycleNumber: 2, status: 'IN_PROGRESS', startedAt: '2026-10-10T01:00:00Z',
  patientId: 'p1', patientMrn: 'M1', patientName: '김환자', regimenCode: 'FOLFOX', regimenName: 'FOLFOX',
  mode: 'BLOCK', failedChecks: [{ name: '혈소판', value: '80', unit: '10^3/uL', min: 100000, reason: '기준 미만' }],
  recorded: true, override: true, reason: '종양내과 판단 — 감량 투여', byId: 'u1', byName: '이의사', ...o,
});
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateOverrideHistory /></QueryClientProvider>,
);

describe('점검 우회 이력 패널', () => {
  beforeEach(() => { cleanup(); get.mockReset(); });

  it('누가·사유·미통과 항목을 그대로', async () => {
    get.mockResolvedValue({ data: { items: [row({})], total: 1, limit: 200, truncated: false } });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-gate-override-row="recorded"]')).not.toBeNull());
    expect(container.textContent).toContain('이의사');
    expect(container.textContent).toContain('종양내과 판단');
    expect(container.textContent).toContain('혈소판');
    expect(get.mock.calls[0][0]).toBe('/api/v1/chemo/gate-overrides');
  });

  it('🔴 조회 실패는 "없습니다"가 아니다', async () => {
    get.mockRejectedValue(new Error('서버 오류 503'));
    const { container } = mount();
    await waitFor(() => expect(container.textContent).not.toContain('불러오는 중'));
    expect(container.textContent).not.toContain('시작한 사이클이 없습니다');
  });

  it('🔴 기록 없는 시작은 사람·사유를 지어내지 않는다 · 잘림 고지', async () => {
    get.mockResolvedValue({ data: { items: [row({ recorded: false, override: null, reason: null, byId: null, byName: null })], total: 350, limit: 200, truncated: true } });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-gate-override-row="unrecorded"]')).not.toBeNull());
    expect(container.textContent).toContain('기록 없음');
    expect(container.querySelector('[data-gate-override-by]')!.textContent).toBe('기록 없음');
    expect(container.querySelector('[data-gate-override-truncated]')).not.toBeNull();
    expect(container.textContent).toContain('350');
  });

  it('항암 화면 탭으로 들어간다', () => {
    const page = readFileSync(resolve(__dirname, '../../src/app/(main)/chemo/page.tsx'), 'utf8');
    expect(page).toContain("['overrides', '점검 우회 이력']");
    expect(page).toContain('<GateOverrideHistory />');
  });
});
