/**
 * 차트 개요 안전 배너 — 약물 상호작용 AI 점검은 요청할 때만(2026-10-03).
 *  🔴 종전: 차트를 열 때마다 `/ai/drug-interactions` 자동 호출
 *     · EP 는 의사·약사 전용인데 간호사·관리자도 개요를 연다 → 늘 403 → "약물 상호작용(DUR)을 확인하지 못했습니다" 상시
 *     · 기간이 끝난 약까지 넣음(투약 탭 정본 `isScreenedForInteraction` 과 갈라짐 — 거짓 경보)
 *     · AI 결과를 AI 표기 없이 "DUR:" 로 그림(약국 DUR 과 구분 불가)
 *  투약 탭도 같은 403 을 "AI 응답을 받지 못했습니다"로 말하고 있었다.
 * 재주입: 자동 호출·ADMIN 통과(useHasRole)·끝난 약 포함·AI 표기 제거·역할 목록 드리프트를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => null } }));
let role = 'DOCTOR';
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: (...roles: string[]) => role === 'ADMIN' || roles.includes(role) }));

import { useAuthStore } from '@/stores/auth-store';
import { screenDrugsForInteraction, DRUG_INTERACTION_AI_ROLES, canRequestDrugInteractionAi } from '@/lib/drug-interaction-screen';

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const P = '00000000-0000-4000-a000-000000d00480';
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const setRole = (r: string) => { role = r; useAuthStore.setState({ user: { id: 'u', email: 'u@x', familyName: '', givenName: '', role: r, permissions: [] } }); };

const rx = [
  { id: 'a', type: 'MEDICATION', status: 'ACTIVE', createdAt: ago(2), duration: 28, medicationCode: { nameKo: '와파린' } },
  { id: 'b', type: 'MEDICATION', status: 'ACTIVE', createdAt: ago(1), duration: null, medicationCode: { nameKo: '아스피린' } },
  { id: 'c', type: 'MEDICATION', status: 'ACTIVE', createdAt: ago(90), duration: 7, medicationCode: { nameKo: '이부프로펜' } }, // 기간 끝남
  { id: 'd', type: 'IMAGING', status: 'ACTIVE', createdAt: ago(1), duration: null, procedureCode: { nameKo: '흉부 X선' } },
];

const routes = async (u: string) => {
  if (u.includes('/prescriptions/patient/')) return { data: rx };
  if (u.includes('/ai/brief/')) return { data: { computedAt: ago(0), basis: [], activeMedications: [], medicationDetails: [], activeProblems: [], recordDiagnoses: [], recentLabs: [], abnormalLabCount: 0, unavailable: [] } };
  if (u.includes('/record-timeline/analytics')) return { data: { analytes: [] } };
  return { data: [] };
};

const renderOverview = async () => {
  const { OverviewTab } = await import('@/app/(main)/patients/[id]/components/OverviewTab');
  return wrap(<OverviewTab patientId={P} recentEncounters={[]} encountersLoading={false} billings={[]} billingsLoading={false} totalBillingAmount={0} paidBillings={0} onTabChange={() => {}} userRole={role} />);
};
const aiCalls = () => post.mock.calls.filter((c) => String(c[0]).includes('/ai/drug-interactions'));

beforeEach(() => { get.mockReset(); post.mockReset(); get.mockImplementation(routes); setRole('DOCTOR'); });
afterEach(() => cleanup());

describe('점검 대상 — 투약 탭과 같은 규칙', () => {
  it('🔴 끝난 약은 빼고 기간 미상은 넣는다 · 약만 · 분모', () => {
    const r = screenDrugsForInteraction(rx);
    expect(r.names).toEqual(['와파린', '아스피린']);
    expect(r.endedExcluded).toBe(1);
    expect(r.unknownIncluded).toBe(1);
  });
});

describe('개요 안전 배너', () => {
  it('🔴 의사: 차트를 열어도 AI 를 부르지 않는다 · 요청하면 대상 약만 보내고 결과에 AI 표기', async () => {
    post.mockResolvedValue({ data: { interactions: [{ drug_a: '와파린', drug_b: '아스피린', severity: 'HIGH', description: '출혈 위험' }] } });
    const { container } = await renderOverview();
    await waitFor(() => expect(container.querySelector('[data-interaction-ai]')).not.toBeNull());
    expect(container.querySelector('[data-interaction-ai]')!.textContent).toMatch(/2종.*미기재 1건.*종료 1건 제외/);
    expect(aiCalls()).toHaveLength(0);
    fireEvent.click(container.querySelector('[data-ask-interaction-ai]')!);
    await waitFor(() => expect(container.querySelector('[data-interaction-ai-result]')).not.toBeNull());
    expect(aiCalls()).toHaveLength(1);
    expect(aiCalls()[0][1]).toEqual({ drugs: ['와파린', '아스피린'] });
    const out = container.querySelector('[data-interaction-ai-result]')!.textContent!;
    expect(out).toContain(AI_ORIGIN_TEXT);
    expect(out).toContain('와파린 + 아스피린');
    expect(container.textContent).not.toMatch(/DUR: /);
  });

  it('보고된 상호작용 0건을 "이상 없음"이라 말하지 않는다', async () => {
    post.mockResolvedValue({ data: { interactions: [] } });
    const { container } = await renderOverview();
    await waitFor(() => expect(container.querySelector('[data-ask-interaction-ai]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-ask-interaction-ai]')!);
    await waitFor(() => expect(container.querySelector('[data-interaction-ai-none]')).not.toBeNull());
    expect(container.querySelector('[data-interaction-ai-none]')!.textContent).toContain('안전을 확인한 것은 아닙니다');
  });

  it.each(['NURSE', 'ADMIN'])('🔴 %s: 부르지 않고 "확인하지 못했습니다"도 띄우지 않는다(403 을 실패로 말하던 것)', async (r) => {
    setRole(r);
    const { container } = await renderOverview();
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 20));
    expect(aiCalls()).toHaveLength(0);
    expect(container.querySelector('[data-interaction-ai]')).toBeNull();
    expect(container.textContent).not.toContain('약물 상호작용(DUR)');
  });
});

describe('투약 탭', () => {
  it('🔴 간호사: 부르지 않고 권한 밖임을 말한다(점검하지 않음 ≠ 이상 없음)', async () => {
    setRole('NURSE');
    const { MedicationTab } = await import('@/app/(main)/patients/[id]/components/MedicationTab');
    const { container } = wrap(<MedicationTab patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-interaction-gated]')).not.toBeNull());
    expect(aiCalls()).toHaveLength(0);
  });

  it('대조군 — 의사는 투약 탭에서 점검이 돈다', async () => {
    post.mockResolvedValue({ data: { interactions: [] } });
    const { MedicationTab } = await import('@/app/(main)/patients/[id]/components/MedicationTab');
    wrap(<MedicationTab patientId={P} />);
    await waitFor(() => expect(aiCalls()).toHaveLength(1));
  });
});

describe('역할 목록 — 서버 @Roles 와 기계 대조', () => {
  it('🔴 drugInteractions 의 @Roles 와 같은 집합 · ADMIN 은 통과시키지 않는다', () => {
    const src = readFileSync(join(process.cwd(), '../api/src/modules/medical-ai/medical-ai.controller.ts'), 'utf8');
    const m = src.match(/@Post\('drug-interactions'\)\s*@Roles\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const server = [...m![1].matchAll(/UserRole\.(\w+)/g)].map((x) => x[1]).sort();
    expect([...DRUG_INTERACTION_AI_ROLES].sort()).toEqual(server);
    expect(canRequestDrugInteractionAi('ADMIN')).toBe(server.includes('ADMIN'));
  });
});
