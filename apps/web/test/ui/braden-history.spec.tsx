/**
 * 간호 위험 평가 이력 — Braden(2026-10-10).
 *  · 이력 표: 시각·총점·하위 6항목·등급·평가자·출처 · 🔴 범위 밖·누락·합 불일치 = "확인 필요" · 초기평가는 하위 칸 '—'(점검 아님)
 *  · 🔴 재평가 폼이 전 항목 최고점(23 = 저위험)·Morse 0 으로 열리던 것 → 미선택 시작 · 전 항목 전엔 저장 불가
 *  · 🔴 워크스테이션 Braden "저장 위치 없음" → 임상 도구 결과 원장(BRADEN) · 등급 경계는 shared 정본
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

const FULL = { sensory: 3, moisture: 2, activity: 2, mobility: 3, nutrition: 2, friction: 2 };
const history = (braden: unknown) => ({ data: {
  patientId: 'p1', news2: { items: [], total: 0, truncated: false, monitoringReference: null, monitoringSource: '' },
  fall: { items: [], total: 0, truncated: false }, braden, schedules: [],
} });

describe('Braden 이력 표', () => {
  it('하위 6항목·등급·평가자·출처 · 초기평가는 하위 칸 — · 추이 점', async () => {
    get.mockResolvedValue(history({ total: 2, truncated: false, needsReview: 0, items: [
      { id: 'c1', source: 'REASSESSMENT', assessedAt: '2026-10-04T00:00:00Z', total: 14, subscores: FULL, riskLevel: 'MODERATE', checks: [], assessor: { id: 'n2', name: '이둘' } },
      { id: 'na1', source: 'NURSING_ASSESSMENT', assessedAt: '2026-10-02T00:00:00Z', total: 16, subscores: null, riskLevel: 'LOW', checks: [], assessor: { id: 'n1', name: '김하나' } },
    ] }));
    const { RiskHistoryPanel } = await import('@/components/nursing/RiskHistoryPanel');
    const { container } = render(<RiskHistoryPanel admissionId="a1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-braden-row="REASSESSMENT"]')).not.toBeNull());
    const re = container.querySelector('[data-braden-row="REASSESSMENT"]')!.textContent!;
    expect(re).toContain('14'); expect(re).toContain('중위험'); expect(re).toContain('이둘'); expect(re).toContain('재평가');
    const init = container.querySelector('[data-braden-row="NURSING_ASSESSMENT"]')!;
    expect(init.querySelectorAll('td')[2].textContent).toBe('—');
    expect(container.querySelectorAll('[data-braden-point]')).toHaveLength(2);
    expect(container.querySelector('[data-braden-needs-review]')).toBeNull();
  });
  it('🔴 확인 필요 — 범위 밖은 등급 없이 · 사유를 말한다', async () => {
    get.mockResolvedValue(history({ total: 1, truncated: false, needsReview: 1, items: [
      { id: 'x', source: 'NURSING_ASSESSMENT', assessedAt: '2026-10-02T00:00:00Z', total: 40, subscores: null, riskLevel: null, checks: ['OUT_OF_RANGE'], assessor: { id: 'n1', name: null } },
    ] }));
    const { RiskHistoryPanel } = await import('@/components/nursing/RiskHistoryPanel');
    const { container } = render(<RiskHistoryPanel admissionId="a1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-braden-needs-review="1"]')).not.toBeNull());
    const row = container.querySelector('[data-braden-checks="OUT_OF_RANGE"]')!.textContent!;
    expect(row).toContain('확인 필요'); expect(row).toContain('6~23 밖'); expect(row).toContain('미상');
    expect(row).not.toContain('위험');
  });
  it('없으면 없다고 · 잘림 고지', async () => {
    get.mockResolvedValue(history({ total: 0, truncated: false, needsReview: 0, items: [] }));
    const { RiskHistoryPanel } = await import('@/components/nursing/RiskHistoryPanel');
    const { container } = render(<RiskHistoryPanel admissionId="a1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-braden-empty]')).not.toBeNull());
  });
});

const src = (p: string) => readFileSync(join(__dirname, '../../src/app/(main)', p), 'utf8');

describe('🔴 재평가 폼 — 미선택 시작', () => {
  const s = src('admin/risk-reassessment/page.tsx');
  it('전 항목 최고점·0 으로 미리 채우지 않는다', () => {
    expect(s).not.toMatch(/sensoryPerception:\s*4/);
    expect(s).not.toMatch(/fallHistory:\s*0,\s*secondaryDiagnosis:\s*0/);
    expect(s).toMatch(/useState<Record<string, number>>\(\{\}\)/);
  });
  it('전 항목을 고르기 전엔 저장 버튼이 닫힌다 · 44px', () => {
    expect(s).toMatch(/disabled=\{assessMut\.isPending \|\| !assessComplete\}/);
    expect(s).toMatch(/if \(!assessModalId \|\| !assessComplete\) return;/);
    expect(s).toMatch(/data-assess-submit[\s\S]{0,80}min-h-\[44px\]/);
  });
});

describe('워크스테이션 Braden 저장', () => {
  const s = src('workstation/nursing/page.tsx');
  it('임상 도구 결과 원장(BRADEN)에 항목 점수로 · "저장 위치 없음" 제거 · 등급은 shared 정본', () => {
    expect(s).toMatch(/clinical-chart-results[\s\S]{0,120}chartId: 'BRADEN'/);
    expect(s).toContain('inputs: { scores: bradenValues }');
    expect(s).not.toContain('저장 위치 없음');
    expect(s).toContain('bradenRiskLevel(bradenTotal)');
    expect(s).not.toContain('19+ 정상');
  });
});
