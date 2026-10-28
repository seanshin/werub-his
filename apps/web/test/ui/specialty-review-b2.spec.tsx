/**
 * 전문진료 2차 B(2026-10-10).
 *  · 방사선: 목록에 선량이 없고 계획 상세 EP 를 부르는 화면이 0 → 서버 요약(doseSummary)만 그린다 · 처방 총선량 없으면 산출 불가
 *  · 이식: TDM EP·서버 판정은 있었는데 화면 0 → 이력·기록 폼(미선택 시작 · 약물·채혈 시각 필수 · 목표 미기재는 판정 불가)
 *  · 항암: 조회 4개가 isError 를 안 봐 실패를 "코스가 없습니다"·영구 "불러오는 중"으로 말했다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DoseSummaryText, doseSummaryOf } from '@/app/(main)/radiation/radiation-dose';
import { buildTdmBody, emptyTdmForm, TdmBadge } from '@/app/(main)/transplant/transplant-tdm';

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');

describe('방사선 누적선량 — 서버 요약만', () => {
  beforeEach(() => cleanup());
  it('누적 / 처방 (비율) Gy', () => {
    const { container } = render(<DoseSummaryText summary={{ deliveredGy: 18, recordedFractions: 10, prescribedGy: 50 }} />);
    expect(container.textContent).toContain('18 / 50');
    expect(container.textContent).toContain('Gy');
    expect(container.querySelector('[data-ratio="unavailable"]')).toBeNull();
  });
  it('🔴 처방 총선량이 없으면 산출 불가 — 0% 로 그리지 않는다', () => {
    const { container } = render(<DoseSummaryText summary={{ deliveredGy: 4, recordedFractions: 2, prescribedGy: null }} />);
    expect(container.querySelector('[data-ratio="unavailable"]')).not.toBeNull();
    expect(container.textContent).not.toContain('0%');
  });
  it('요약이 없으면 없다고 — 화면이 더해 만들지 않는다', () => {
    expect(doseSummaryOf({ fractions: [{ deliveredDose: '2' }] })).toBeNull();
    const page = src('app/(main)/radiation/page.tsx');
    expect(page).toContain('<DoseSummaryText summary={doseSummaryOf(p)} />');
    expect(page).toContain('<PlanFractionsPanel planId=');
    expect(src('app/(main)/radiation/radiation-dose.tsx')).toContain('/api/v1/radiation/plans/${planId}');
    expect(src('app/(main)/patients/[id]/components/RadiationTab.tsx')).toContain('doseSummaryOf(p)');
  });
});

describe('이식 TDM 기록 폼', () => {
  it('🔴 미선택으로 시작 — 약물·채혈 시각이 없으면 저장 본문 없음', () => {
    const f = emptyTdmForm();
    expect(f).toEqual({ drug: '', troughLevel: '', targetLow: '', targetHigh: '', sampledAt: '', doseAdjustment: '' });
    expect(buildTdmBody(f)).toBeNull();
    expect(buildTdmBody({ ...f, drug: 'tacrolimus' })).toBeNull();
    expect(buildTdmBody({ ...f, sampledAt: '2026-10-10T06:30' })).toBeNull();
  });
  it('빈 칸은 보내지 않는다(0 과 미입력을 섞지 않는다) · 측정 0 은 보낸다', () => {
    const b = buildTdmBody({ ...emptyTdmForm(), drug: ' tacrolimus ', sampledAt: '2026-10-10T06:30', troughLevel: '0' })!;
    expect(b.drug).toBe('tacrolimus');
    expect(b.troughLevel).toBe(0);
    expect('targetLow' in b).toBe(false);
    expect(typeof b.sampledAt).toBe('string');
  });
  it('🔴 목표 미기재(inRange null)는 정상이 아니라 판정 불가', () => {
    const { container } = render(<TdmBadge inRange={null} />);
    expect(container.textContent).toContain('판정 불가');
    cleanup();
    expect(render(<TdmBadge inRange={false} />).container.textContent).toContain('목표 범위 밖');
  });
  it('이식 기록 탭에서 TDM 패널을 연다 · 기증자·기록 조회 실패는 실패로', () => {
    const page = src('app/(main)/transplant/page.tsx');
    expect(page).toContain('<TransplantTdmPanel recordId={r.id} />');
    expect((page.match(/if \(isError\) return <QueryErrorFallback/g) ?? []).length).toBe(3);
  });
});

vi.mock('@/lib/api-client', async (orig) => {
  const real = await orig<typeof import('@/lib/api-client')>();
  return { ...real, apiClient: { get: vi.fn(async () => { throw new Error('서버 오류 503'); }), post: vi.fn(), patch: vi.fn() } };
});
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: () => true }));

describe('항암 — 조회 실패는 실패로', () => {
  beforeEach(() => cleanup());
  it('🔴 4개 조회 모두 isError 를 본다', () => {
    const page = src('app/(main)/chemo/page.tsx');
    for (const k of ['coursesIsError', 'regimensIsError', 'courseIsError']) expect(page).toContain(k);
    expect((page.match(/regimensIsError \?|\{regimensIsError &&/g) ?? []).length).toBe(2);
    expect(page).toContain('if (courseIsError) return <QueryErrorFallback');
  });
  it('🔴 코스 목록 조회 실패에 "코스가 없습니다"를 그리지 않는다', async () => {
    const { default: Page } = await import('@/app/(main)/chemo/page');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><Page /></QueryClientProvider>);
    await waitFor(() => expect(container.textContent).not.toContain('불러오는 중'));
    expect(container.textContent).not.toContain('코스가 없습니다');
    expect(container.textContent).toContain('서버 오류 503');
  });
});
