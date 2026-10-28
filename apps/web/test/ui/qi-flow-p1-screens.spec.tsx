/**
 * 의료질관리 흐름 P1~P3 화면(2026-10-08) — 고리를 화면까지 잇는다.
 *  · 자동 산출 미리보기: 산출 불가는 이유와 분자(대조 근거)를 말한다 — 0 으로 접지 않는다
 *  · 결정 현황: "정해짐"과 "아무도 정하지 않아 기본값"·"읽기 실패"를 가른다 · 바꾸는 버튼 없음
 *  · 기구일수: 결정 전엔 입력이 닫혀 있다 · 폼은 미선택으로 시작
 *  · 인증: 체계 미정이면 등록 닫힘 · 확인 전엔 "자가 평가"
 *  · 직접 수정 가드: 사유 5자 전엔 등재 버튼이 잠긴다 · AGENDA_ONLY 면 등록·정의 버튼이 없다
 *  · 사고 보고: 유형·중증도 미선택 시작 · 익명은 허용됐을 때만 · 위해 척도 미정이면 그 사실
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { get, post, role } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: { v: 'ADMIN' } }));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (p: string) => get(p), post: (p: string, b?: unknown) => post(p, b), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: role.v, permissions: [] } }),
}));

import QiFlowPanel from '../../src/app/(main)/quality/QiFlowPanel';
import QiFlowOps from '../../src/app/(main)/quality/QiFlowOps';

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');

const IND = {
  id: '11111111-1111-4111-8111-111111111111', name: '낙상발생률', category: '환자안전', unit: '‰', direction: 'LOWER_IS_BETTER',
  directionSource: 'COLUMN', registeredDirection: 'LOWER_IS_BETTER', registeredUnit: '‰', registeredValueScale: 1000, valueScale: 1000, valueScaleKnown: true,
  targetValue: 1, latestValue: 3, latestPeriod: '2026-09', meetTarget: false, achievementPercent: null,
} as never;

const settings = (over: Record<string, { value: unknown; source: string }> = {}) => ({
  data: {
    rows: [
      'qi.autoMeasure.enabled', 'qi.autoMeasure.incidentDenominator', 'qi.deviceDays.source', 'qi.autoManual.precedence',
      'qi.indicator.directEdit', 'safety.incident.anonymous', 'safety.harmLevelScale', 'accreditation.framework',
    ].map((key) => ({ key, decisionKey: key, ...(over[key] ?? { value: null, source: 'default' }) })),
    harmLevels: null, accreditationFrameworks: [],
  },
});

beforeEach(() => { get.mockReset(); post.mockReset(); role.v = 'ADMIN'; });

describe('지표 흐름 패널', () => {
  it('🔴 고르기 전엔 아무것도 부르지 않는다', () => {
    render(withQuery(<QiFlowPanel indicator={IND} />));
    expect(get).not.toHaveBeenCalled();
  });
  it('🔴 산출 불가는 이유와 분자를 말한다 — 0 으로 접지 않는다', async () => {
    get.mockResolvedValue({ data: {
      indicator: { id: 'x', name: '낙상발생률', supplierKey: 'FALL_RATE', unit: '‰', valueScale: 1000 }, period: '2026-09',
      supply: { available: false, supplierKey: 'FALL_RATE', reason: 'DENOMINATOR_UNSET', numerator: 4 }, ledger: [],
    } });
    render(withQuery(<QiFlowPanel indicator={IND} />));
    fireEvent.click(document.querySelector('[data-qi-flow-tab="preview"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-unavailable="DENOMINATOR_UNSET"]')).not.toBeNull());
    expect(screen.getByText(/분모가 정해지지 않았습니다/)).toBeTruthy();
    expect(document.querySelector('[data-qi-preview]')!.textContent).toContain('4');
    expect(document.querySelector('[data-qi-preview]')!.textContent).not.toMatch(/0\.00/);
  });
  it('산출되면 값과 분자/분모 · 원장 행은 출처 배지와 함께', async () => {
    get.mockResolvedValue({ data: {
      indicator: { id: 'x', name: '낙상발생률', supplierKey: 'FALL_RATE', unit: '‰', valueScale: 1000 }, period: '2026-09',
      supply: { available: true, supplierKey: 'FALL_RATE', numerator: 3, denominator: 1000, evidence: {} },
      ledger: [{ id: 'm1', source: 'MANUAL', sourceKey: 'MANUAL', numerator: 2, denominator: 1000, value: 2 }],
    } });
    render(withQuery(<QiFlowPanel indicator={IND} />));
    fireEvent.click(document.querySelector('[data-qi-flow-tab="preview"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-preview="AVAILABLE"]')).not.toBeNull());
    expect(document.querySelector('[data-qi-preview]')!.textContent).toContain('(3/1000)');
    expect(document.querySelector('[data-qi-source="MANUAL"]')).not.toBeNull();
  });
  it('🔴 목표 안건 — 후보는 빈칸으로 시작하고 비어 있으면 올릴 수 없다', () => {
    render(withQuery(<QiFlowPanel indicator={IND} />));
    fireEvent.click(document.querySelector('[data-qi-flow-tab="agenda"]')!);
    const btn = document.querySelector('[data-qi-target-agenda-submit]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const inputs = document.querySelectorAll('[data-qi-target-agenda] input');
    expect([...inputs].every((i) => (i as HTMLInputElement).value === '')).toBe(true);
  });
});

describe('운영 패널', () => {
  it('🔴 결정 현황 — 기본값으로 떨어진 것·읽기 실패·정해진 것을 가른다', async () => {
    get.mockResolvedValue(settings({
      'qi.autoManual.precedence': { value: 'BOTH', source: 'default' },
      'safety.incident.anonymous': { value: true, source: 'db' },
      'accreditation.framework': { value: null, source: 'error' },
    }));
    render(withQuery(<QiFlowOps />));
    fireEvent.click(document.querySelector('[data-qi-ops-tab="settings"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-flow-settings]')).not.toBeNull());
    expect(document.querySelector('[data-qi-setting="qi.autoManual.precedence"]')!.textContent).toContain('아무도 정하지 않아 기본값');
    expect(document.querySelector('[data-qi-setting="safety.incident.anonymous"]')!.textContent).not.toContain('기본값');
    expect(document.querySelector('[data-qi-setting="accreditation.framework"]')!.textContent).toContain('읽기 실패');
    expect(document.querySelector('[data-qi-flow-settings] button')).toBeNull(); // 바꾸는 버튼 없음
  });
  it('🔴 기구일수 — 결정 전엔 입력이 닫혀 있다', async () => {
    get.mockResolvedValue({ data: { period: '2026-09', source: null, accepting: false, wards: [], rows: [] } });
    render(withQuery(<QiFlowOps />));
    fireEvent.click(document.querySelector('[data-qi-ops-tab="device"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-device-days-closed]')).not.toBeNull());
    expect(document.querySelector('[data-qi-device-days-form]')).toBeNull();
  });
  it('대조군 — MANUAL 이면 폼이 열리고 기구는 미선택으로 시작한다', async () => {
    get.mockResolvedValue({ data: { period: '2026-09', source: 'MANUAL', accepting: true, wards: [], rows: [] } });
    render(withQuery(<QiFlowOps />));
    fireEvent.click(document.querySelector('[data-qi-ops-tab="device"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-device-days-form]')).not.toBeNull());
    expect((document.querySelector('[data-qi-device-days-save]') as HTMLButtonElement).disabled).toBe(true);
    const sel = document.querySelectorAll('[data-qi-device-days-form] select')[1] as HTMLSelectElement;
    expect(sel.value).toBe('');
  });
  it('🔴 인증 — 체계 미정이면 등록 닫힘', async () => {
    get.mockResolvedValue({ data: { setting: null, allowed: [], standards: [] } });
    render(withQuery(<QiFlowOps />));
    fireEvent.click(document.querySelector('[data-qi-ops-tab="accreditation"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-accr-closed]')).not.toBeNull());
    expect(document.querySelector('[data-qi-accr-create]')).toBeNull();
  });
  it('🔴 인증 — 확인 전엔 자가 평가로 그린다', async () => {
    get.mockResolvedValue({ data: { setting: 'KOIHA', allowed: ['KOIHA'], standards: [
      { id: 's1', framework: 'KOIHA', chapter: '1', code: '1.1', title: 't', measurableElement: null, sourceRef: null,
        latest: { id: 'a1', cycle: '2026', judgment: 'MET', evidenceText: null, assessedBy: 'u2', assessedAt: '2026-10-01T00:00:00Z', verifiedAt: null, verifiedBy: null, dueDate: null } },
    ] } });
    render(withQuery(<QiFlowOps />));
    fireEvent.click(document.querySelector('[data-qi-ops-tab="accreditation"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-accr-verified="no"]')).not.toBeNull());
    expect(document.querySelector('[data-qi-accr-verified="no"]')!.textContent).toContain('자가 평가');
  });
  it('보고서 — 인쇄 경로·제출 상태', async () => {
    get.mockResolvedValue({ data: [{ id: 'r1', period: '2026-09', title: 'QI 보고서 2026-09', status: 'SUBMITTED', createdAt: '2026-10-02T00:00:00Z', submittedAt: '2026-10-02T01:00:00Z', agendaId: 'ag', sha256: 'a'.repeat(64) }] });
    render(withQuery(<QiFlowOps />));
    fireEvent.click(document.querySelector('[data-qi-ops-tab="reports"]')!);
    await waitFor(() => expect(document.querySelector('[data-qi-report="r1"]')).not.toBeNull());
    expect(document.querySelector('a[href="/print/qi-report/r1"]')).not.toBeNull();
    expect(document.querySelector('[data-qi-report-submit="r1"]')).toBeNull(); // 이미 제출됨
  });
});

describe('구조 — 직접 수정 가드·사고 보고 폼', () => {
  it('🔴 지표 등록·정의는 사유 5자 전엔 잠기고 AGENDA_ONLY 면 버튼이 없다', () => {
    const s = src('app/(main)/quality/page.tsx');
    expect(s).toContain("!reasonOk(draft.changeReason)");
    expect(s).toContain("!reasonOk(edit.changeReason)");
    expect(s).toContain('isAdmin && !agendaOnly && (');
    expect(s).toContain('<QiFlowPanel indicator={q} />');
  });
  it('🔴 사고 보고는 유형·중증도 미선택으로 시작하고 발생 시각을 UTC 로 채우지 않는다', () => {
    const s = src('app/(main)/safety/page.tsx');
    expect(s).toContain("defaultValues: { type: '', severity: ''");
    expect(s).not.toContain("occurredAt: new Date().toISOString().slice(0, 16)");
    expect(s).toContain('localDateTimeInput(new Date())');
  });
  it('🔴 익명 체크는 결정이 허용했을 때만 · 위해 척도 미정이면 그 사실', () => {
    const s = src('app/(main)/safety/page.tsx');
    expect(s).toContain('{anonymousAllowed && (');
    expect(s).toContain('data-safety-report-harm="unset"');
  });
});
