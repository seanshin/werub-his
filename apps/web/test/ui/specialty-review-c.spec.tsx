/**
 * 전문진료 2차 C 묶음(2026-10-10) — 원장에 있는데 화면에 없던 것.
 *  · 호스피스: 사전연명의료 문서(AD·POLST)가 화면에 없었다 → 카드 · '없음'과 '조회 실패'를 구분 · 등록 DNR 칸과 다르면 말함
 *  · 신경외과: NIHSS·ASIA 가 저장되는데 입력 칸·부서 표에 없었다 → 입력(미선택 시작) · 표 칸 · 🔴 GCS 가 E4V5M6(=15)로 시작
 *    · 차트 탭 GCS 가 `?? 0` 합산(V 미측정 = 과소평가)
 *  · 분만: 진행 원장 전체를 보는 곳이 없었다 → 파토그래프(시간 0 출처 · 미측정 점 없음 · 경고/행동선 없음)
 * 재주입: 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildPartograph } from '@/lib/partograph';

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('파토그래프 점', () => {
  it('🔴 시간 0 = 진통 시작(있으면) · 미측정은 null(0 cm 아님) · 개대 점 수', () => {
    const g = buildPartograph([
      { recordedAt: '2026-10-10T04:00:00Z', cervicalDilation: 6, fetalHeartRate: 140 },
      { recordedAt: '2026-10-10T02:00:00Z', cervicalDilation: 4 },
      { recordedAt: '2026-10-10T05:00:00Z', fetalHeartRate: 150 },
    ], '2026-10-10T00:00:00Z');
    expect(g.origin).toBe('LABOR_ONSET');
    expect(g.points.map((p) => [p.h, p.dilation])).toEqual([[2, 4], [4, 6], [5, null]]);
    expect(g.dilationCount).toBe(2);
    expect(g.spanH).toBe(12);
  });
  it('진통 시작이 없거나 첫 기록보다 늦으면(입력 오류) 첫 기록이 0 — 음수 시간을 만들지 않는다', () => {
    const rows = [{ recordedAt: '2026-10-10T02:00:00Z', cervicalDilation: 3 }];
    expect(buildPartograph(rows, null)).toMatchObject({ origin: 'FIRST_RECORD', points: [{ h: 0 }] });
    expect(buildPartograph(rows, '2026-10-10T05:00:00Z')).toMatchObject({ origin: 'FIRST_RECORD', points: [{ h: 0 }] });
    expect(buildPartograph([], null).points).toEqual([]);
  });
  it('🔴 경고선·행동선을 그리지 않는다(원내 기준 미정) · 화면이 FHR 기준 숫자를 두지 않는다', () => {
    const s = src('app/(main)/obgyn/DeliveryBoard.tsx');
    expect(s).toContain('경고선·행동선은 원내 기준이 정해지지 않아 그리지 않습니다');
    expect(s).not.toMatch(/alertLine|actionLine|p\.fhr < 110/);
  });
  it('분만 상세 EP 를 읽어 그린다 · 기록 없으면 그릴 수 없다고', async () => {
    const { LaborPartograph } = await import('@/app/(main)/obgyn/DeliveryBoard');
    get.mockResolvedValueOnce({ data: { laborOnsetAt: '2026-10-10T00:00:00Z', laborProgress: [{ recordedAt: '2026-10-10T02:00:00Z', cervicalDilation: 4 }, { recordedAt: '2026-10-10T04:00:00Z', cervicalDilation: 7 }] } });
    const a = render(<LaborPartograph deliveryId="d1" />, { wrapper: wrap });
    await waitFor(() => expect(a.container.querySelector('[data-partograph="DRAWN"]')).not.toBeNull());
    expect(get).toHaveBeenCalledWith('/api/v1/obgyn/deliveries/d1');
    expect(a.container.querySelectorAll('circle').length).toBe(2);
    cleanup();
    get.mockResolvedValueOnce({ data: { laborOnsetAt: null, laborProgress: [] } });
    const b = render(<LaborPartograph deliveryId="d2" />, { wrapper: wrap });
    await waitFor(() => expect(b.container.querySelector('[data-partograph="EMPTY"]')).not.toBeNull());
  });
});

describe('호스피스 사전연명의료 카드', () => {
  const doc = { id: 'ad1', documentType: 'POLST', registeredAt: '2026-10-01T00:00:00Z', status: 'ACTIVE', cprDecision: 'DNR', ventilatorDecision: null, patientSignedAt: '2026-10-01T00:00:00Z' };
  const mount = async (dnr?: boolean) => {
    const { AdvanceDirectiveCard } = await import('@/app/(main)/hospice/AdvanceDirectiveCard');
    return render(<AdvanceDirectiveCard patientId="p1" registrationDnr={dnr} />, { wrapper: wrap });
  };
  it('🔴 조회 실패는 "문서 없음"이 아니다', async () => {
    get.mockRejectedValue(new Error('down'));
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-advance-directive="ERROR"]')).not.toBeNull());
    expect(r.container.textContent).not.toContain('유효한 사전연명의료 문서가 없습니다');
  });
  it('대조군 — 0건이면 없다고(병원 등록분 기준임을 함께)', async () => {
    get.mockResolvedValue({ data: [] });
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-advance-directive="NONE"]')).not.toBeNull());
    expect(get).toHaveBeenCalledWith('/api/v1/hospice/directives/p1?includeRevoked=1');
  });
  it('문서 · 저장 원문 · 빈 항목은 — · 등록 DNR 칸과 다르면 확인 필요', async () => {
    get.mockResolvedValue({ data: [doc] });
    const r = await mount(false);
    await waitFor(() => expect(r.container.querySelector('[data-advance-directive="PRESENT"]')).not.toBeNull());
    expect(r.container.textContent).toContain('연명의료계획서');
    expect(r.container.textContent).toContain('DNR');
    expect(r.container.textContent).toContain('확인이 필요합니다');
    cleanup();
    const same = await mount(true);
    await waitFor(() => expect(same.container.querySelector('[data-advance-directive="PRESENT"]')).not.toBeNull());
    expect(same.container.textContent).not.toContain('확인이 필요합니다');
  });
  it('호스피스 상세가 카드를 그린다', () => {
    expect(src('app/(main)/hospice/page.tsx')).toContain('<AdvanceDirectiveCard patientId={detail.patient.id}');
  });
});

describe('신경외과 검사 입력', () => {
  const mount = async () => {
    const { NeurosurgeryEncounterLayout } = await import('@/app/(main)/patients/[id]/encounter/new/components/NeurosurgeryEncounterLayout');
    return render(<NeurosurgeryEncounterLayout patientId="p1" encounterId="e1" onStartEncounter={() => {}} patient={{}} onSaveDraft={() => {}} onSignAndBill={() => {}} isSaving={false} isSigning={false} />, { wrapper: wrap });
  };
  it('🔴 GCS·NIHSS·ASIA 는 미선택으로 시작 — 고르지 않고 저장하면 그 칸을 보내지 않는다', async () => {
    post.mockResolvedValue({ data: {} });
    const r = await mount();
    const selects = Array.from(r.container.querySelectorAll('select')).slice(0, 3) as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual(['', '', '']);
    expect((r.container.querySelector('[data-asia-select]') as HTMLSelectElement).value).toBe('');
    fireEvent.click(Array.from(r.container.querySelectorAll('button')).find((b) => b.textContent?.includes('검사 기록 저장'))!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    for (const k of ['gcsEye', 'gcsVerbal', 'gcsMotor', 'gcsTotal', 'nihss', 'asiaScale']) expect(k in body).toBe(false);
  });
  it('고르면 보낸다 · 총점은 셋 다 골랐을 때만 · NIHSS 범위 밖은 저장 불가', async () => {
    post.mockResolvedValue({ data: {} });
    const r = await mount();
    const selects = Array.from(r.container.querySelectorAll('select')).slice(0, 3) as HTMLSelectElement[];
    fireEvent.change(selects[0], { target: { value: '3' } });
    fireEvent.change(selects[2], { target: { value: '5' } });
    fireEvent.change(r.container.querySelector('[data-asia-select]')!, { target: { value: 'C' } });
    const nihss = r.container.querySelector('[data-nihss-input]') as HTMLInputElement;
    const save = () => Array.from(r.container.querySelectorAll('button')).find((b) => b.textContent?.includes('검사 기록 저장')) as HTMLButtonElement;
    fireEvent.change(nihss, { target: { value: '43' } });
    expect(save().disabled).toBe(true);
    fireEvent.change(nihss, { target: { value: '7' } });
    fireEvent.click(save());
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ gcsEye: 3, gcsMotor: 5, nihss: 7, asiaScale: 'C' });
    expect('gcsVerbal' in body).toBe(false);
    expect('gcsTotal' in body).toBe(false);
  });
  it('🔴 차트 탭 GCS 는 저장 총점 정본 — `?? 0` 합산 없음 · 부서 표에 NIHSS·ASIA 칸', () => {
    const tab = src('app/(main)/patients/[id]/components/NeurosurgeryTab.tsx');
    expect(tab).not.toMatch(/\(e \?\? 0\) \+ \(v \?\? 0\)/);
    expect(tab).toContain('const stored = typeof it.gcsTotal');
    const page = src('app/(main)/neurosurgery/page.tsx');
    expect(page).toContain('data-nihss');
    expect(page).toContain('data-asia');
  });
});
