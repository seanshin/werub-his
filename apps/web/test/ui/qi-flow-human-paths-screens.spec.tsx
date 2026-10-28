/**
 * 사람 경로 화면(2026-10-09)
 *  · 경보 승인 칸 — 승인 후 코드가 바뀌면 "재승인 필요" · 근거 5자 전 저장 잠김 · 관리자 아니면 버튼 없음
 *  · 결정 현황 — 관리자 직접 변경을 위원회 의결처럼 그리지 않는다
 *  · 설정 화면 — QI 설정은 허용 값만 고르게 하고 위원회 결정에 묶였다고 말한다
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { get, role } = vi.hoisted(() => ({ get: vi.fn(), role: { v: 'ADMIN' } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (p: string) => get(p), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: role.v } }) }));

import { AlertRegistryPanel } from '../../src/app/(main)/admin/safety-gates/alert-registry-panel';
import QiFlowOps from '../../src/app/(main)/quality/QiFlowOps';

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const item = (code: string, status: string) => ({
  code, label: code, domain: 'SAFETY', tier: 2, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: 24, actionHref: '/quality', approvedBy: 'UNAPPROVED', reviewDue: '2027-01-01', budgetClass: 'WORKFLOW', emitters: [],
  fired: 0, read: 0, medianReadMin: null, unreadOver24h: 0, reviewOverdue: false, approval: { status, approvedAt: null, basis: null, approvedBy: null },
});
const report = (items: unknown[]) => ({ data: { windowDays: 30, generatedAt: '2026-10-09T00:00:00Z', items, unregistered: { sinceBoot: '2026-10-09T00:00:00Z', seen: [], inDb: [] }, retentionDays: { read: 90, unread: 180, override: null }, summary: { registered: items.length, unapproved: 1, changedSinceApproval: 1, withoutDedup: 0, attendingRouted: 0, unregisteredCodesInDb: 0 } } });

beforeEach(() => { get.mockReset(); role.v = 'ADMIN'; });

describe('경보 승인 칸', () => {
  it('🔴 승인 후 코드가 바뀐 경보는 재승인 필요로 · 근거 5자 전 저장 잠김', async () => {
    get.mockResolvedValue(report([item('A_ONE', 'CHANGED'), item('B_TWO', 'APPROVED')]));
    const { container } = render(wrap(<AlertRegistryPanel />));
    await waitFor(() => expect(container.querySelector('[data-alert-approval="CHANGED"]')).not.toBeNull());
    expect(container.querySelector('[data-alert-approval="CHANGED"]')!.textContent).toContain('재승인 필요');
    expect(container.querySelector('[data-alert-approve="B_TWO"]')).toBeNull(); // 이미 승인 — 승인 버튼 없음
    fireEvent.click(container.querySelector('[data-alert-approve="A_ONE"]')!);
    const save = container.querySelector('[data-alert-approval-save]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
  it('🔴 관리자가 아니면(경영진) 보기만 — 기록 버튼 없음', async () => {
    role.v = 'EXECUTIVE';
    get.mockResolvedValue(report([item('A_ONE', 'UNAPPROVED')]));
    const { container } = render(wrap(<AlertRegistryPanel />));
    await waitFor(() => expect(container.querySelector('[data-alert-approval="UNAPPROVED"]')).not.toBeNull());
    expect(container.querySelector('[data-alert-approve]')).toBeNull();
  });
});

describe('결정 현황 출처', () => {
  it('🔴 관리자 직접 변경은 위원회 의결이 아니라고 말한다', async () => {
    get.mockResolvedValue({ data: { rows: [
      { key: 'qi.autoManual.precedence', decisionKey: 'qi.autoManual.precedence', value: 'AUTO', source: 'db', provenance: { by: 'DIRECT', at: '2026-10-09T01:00:00Z' } },
      { key: 'safety.incident.anonymous', decisionKey: 'safety.anonymousReport', value: true, source: 'db', provenance: { by: 'ENACTED', at: '2026-10-09T01:00:00Z', decisionNo: 'SAFE-2026-03' } },
    ], harmLevels: null, accreditationFrameworks: [] } });
    const { container } = render(wrap(<QiFlowOps />));
    fireEvent.click(container.querySelector('[data-qi-ops-tab="settings"]')!);
    await waitFor(() => expect(container.querySelector('[data-qi-setting-provenance="DIRECT"]')).not.toBeNull());
    expect(container.querySelector('[data-qi-setting-provenance="DIRECT"]')!.textContent).toContain('위원회 의결 아님');
    expect(container.querySelector('[data-qi-setting-provenance="ENACTED"]')!.textContent).toContain('SAFE-2026-03');
  });
});

describe('설정 화면', () => {
  it('🔴 QI 설정은 허용 값 선택지 · 빈 선택은 미설정(null) · 위원회 결정 묶임 안내', () => {
    const s = readFileSync(resolve(__dirname, '../../src/app/(main)/admin/ai-settings/page.tsx'), 'utf8');
    expect(s).toContain('...QI_FLOW_SELECT,');
    expect(s).toContain("if ((key in QI_FLOW_SETTING_ALLOWED || key in DECIDED_SETTING_ALLOWED) && val === '') val = null;");
    expect(s).toContain('data-config-committee-bound');
  });
  it('🔴 결정 등록부 배치 10-F 어휘 설정도 허용 값 선택지(2026-10-10) — 정수 범위 키는 고르기 대상이 아니다', async () => {
    const s = readFileSync(resolve(__dirname, '../../src/app/(main)/admin/ai-settings/page.tsx'), 'utf8');
    expect(s).toContain('...DECIDED_SELECT,');
    const { DECIDED_SETTING_ALLOWED } = await import('@hospital-run/shared');
    const vocab = Object.entries(DECIDED_SETTING_ALLOWED).filter(([, r]) => Array.isArray(r) && r.every((v) => typeof v === 'string')).map(([k]) => k).sort();
    // +1 2026-10-11 결정 엔진 보호 게이트(OFF/WARN/BLOCK) — 설정 화면에서도 허용 값만 고른다(BLOCK 이면 실결정과 다른 값은 서버가 막는다)
    // +1 2026-10-20 요양기관 종별(CLINIC·HOSPITAL·GENERAL·TERTIARY) — 표 밖 값(오타)이 저장되면 진찰료 코드를 못 고른다 · 결정에 묶인 설정이라 보호 게이트가 이력을 남긴다
    expect(vocab).toEqual(['billing.institution.grade', 'documents.fee.billingLink', 'governance.decisionConfigGuard', 'nursing.initialAssessment.bradenInput', 'pediatrics.growth.reference']);
  });
});
