/**
 * 대시보드 ↔ 통합 상황판 역할 분리(2026-10-02).
 *  · 대시보드 = **내 업무** · 상황판 = **병원 전체 지금** · 경영 화면 = **기간 추이·경영**
 *  · 🔴 같은 사실에 정본 하나 — 대시보드의 병원 상황 요약은 상황판과 **같은 응답·같은 판정 함수**만 쓴다
 *  · 임상·관리자 기본 배치에 병원 전체(HOSPITAL)·추이(ANALYTICS) 위젯이 없다 · 요약 한 칸이 있다
 *  · 🔴 저장된 배치는 보존 — 설정 버전을 올리지 않는다(올리면 모두의 편집이 기본으로 덮인다)
 *  · 저장된 배치에 남은 범위 위젯엔 표식 — 상황판을 못 여는 역할에겐 링크 없이
 *  · 상황판에 연 단위 경영 카드 없음
 * 재주입: 요약 위젯이 다른 EP 를 부르면, 기본 배치에 병원 전체 위젯을 되살리면, 버전을 올리면, 링크 게이트를 지우면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getDefaultConfig, DASHBOARD_CONFIG_VERSION } from '@/app/(main)/dashboard/components/default-layouts';
import { WIDGET_REGISTRY } from '@/app/(main)/dashboard/components/widget-registry';
import { COMMAND_CENTER_ROLES } from '@/app/(main)/command-center/journey-access';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => null } }));
let role = 'DOCTOR';
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const st = { user: { role } }; return sel ? sel(st) : st; } }));
vi.mock('@/app/(main)/dashboard/stores/dashboard-store', () => ({ useDashboardStore: () => ({ hideWidget: vi.fn() }) }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const WEB = join(__dirname, '../..');

describe('기본 배치 — 내 업무만', () => {
  const ids = (r: string) => getDefaultConfig(r).layouts.lg.map((l) => l.i);

  it('🔴 임상·관리자 기본 배치에 병원 전체·추이 위젯이 없고 병원 상황 요약 한 칸이 있다', () => {
    for (const r of COMMAND_CENTER_ROLES) {
      const list = ids(r);
      expect(list, r).toContain('hospital-status');
      const leaked = list.filter((i) => WIDGET_REGISTRY[i]?.scope === 'HOSPITAL' || WIDGET_REGISTRY[i]?.scope === 'ANALYTICS');
      expect(leaked, `${r} 기본 배치에 범위 밖 위젯`).toEqual([]);
    }
    expect(getDefaultConfig('NURSE', '원무과').layouts.lg.map((l) => l.i)).toContain('hospital-status');
  });

  it('상황판을 못 여는 역할의 기본 배치엔 요약 위젯이 없다(403 을 그리지 않는다)', () => {
    for (const r of ['EXECUTIVE', 'RECEPTIONIST', 'CRM_MANAGER', 'READ']) expect(ids(r), r).not.toContain('hospital-status');
    expect([...WIDGET_REGISTRY['hospital-status'].roles].sort()).toEqual([...COMMAND_CENTER_ROLES].sort());
  });

  it('🔴 저장된 배치를 덮지 않는다 — 설정 버전 그대로(3)', () => {
    expect(DASHBOARD_CONFIG_VERSION).toBe(3);
  });

  it('범위 분류를 실제로 했다(가드가 헛돌지 않게)', () => {
    const scopes = Object.values(WIDGET_REGISTRY).map((w) => w.scope);
    expect(scopes.filter((s) => s === 'HOSPITAL').length).toBeGreaterThanOrEqual(10);
    expect(scopes.filter((s) => s === 'ANALYTICS').length).toBeGreaterThanOrEqual(8);
    expect(WIDGET_REGISTRY['my-queue'].scope).toBe('MINE');
  });
});

describe('병원 상황 요약 — 상황판과 같은 정본', () => {
  beforeEach(() => { cleanup(); get.mockReset(); role = 'DOCTOR'; });

  it('🔴 상황판 요약 EP·criticalActions 만 쓴다(자기 데이터로 따로 그리지 않는다)', () => {
    const src = readFileSync(join(WEB, 'src/app/(main)/dashboard/components/widgets/HospitalStatusWidget.tsx'), 'utf8');
    const eps = [...src.matchAll(/'\/api\/v1\/[^']+'/g)].map((m) => m[0]);
    expect(eps).toEqual(["'/api/v1/command-center/summary'"]);
    expect(src).toContain('criticalActions(');
    expect(src).toContain("queryKey: ['command-center-summary']");
  });

  it('위험·주의 구성 · 상위 항목 · 상황판 링크 / 실패는 "이상 없음"이 아니라 확인 불가', async () => {
    get.mockResolvedValue({ data: { sections: { nursing: { ok: true, summary: { highRisk: 2, unsignedNotes: 1 } } }, kpi: {}, generatedAt: 'x' } });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/HospitalStatusWidget');
    const { container } = render(<W />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-hospital-status="ok"]')).not.toBeNull());
    expect(container.textContent).toContain('위험 1종 2건');
    expect(container.textContent).toContain('주의 1종 1건');
    expect(container.querySelector('a[data-hs-link]')!.getAttribute('href')).toBe('/command-center');
    cleanup();
    get.mockRejectedValue(new Error('500'));
    const r2 = render(<W />, { wrapper: wrap });
    // 위젯은 상황판과 같이 retry 1 — 재시도 지연을 기다린다
    await waitFor(() => expect(r2.container.querySelector('[data-hospital-status="error"]')).not.toBeNull(), { timeout: 5000 });
    expect(r2.container.textContent).not.toContain('항목 없음');
  });
});

describe('저장된 배치에 남은 범위 위젯 표식', () => {
  beforeEach(() => { cleanup(); });
  async function renderWrapper(id: string) {
    const { default: WidgetWrapper } = await import('@/app/(main)/dashboard/components/WidgetWrapper');
    return render(<WidgetWrapper id={id} definition={WIDGET_REGISTRY[id]} isEditing={false}><div /></WidgetWrapper>, { wrapper: wrap });
  }
  it('🔴 상황판을 여는 역할 = 링크 · 못 여는 역할 = 표식만', async () => {
    role = 'DOCTOR';
    let r = await renderWrapper('er-status');
    expect(r.container.querySelector('a[data-widget-scope="HOSPITAL"]')!.getAttribute('href')).toBe('/command-center');
    cleanup();
    role = 'EXECUTIVE';
    r = await renderWrapper('bed-status');
    expect(r.container.querySelector('a[data-widget-scope]')).toBeNull();
    expect(r.container.querySelector('[data-widget-scope="HOSPITAL"]')).not.toBeNull();
    cleanup();
    r = await renderWrapper('chart-weekly');
    expect(r.container.querySelector('a[data-widget-scope="ANALYTICS"]')!.getAttribute('href')).toBe('/executive');
    cleanup();
    r = await renderWrapper('my-queue');
    expect(r.container.querySelector('[data-widget-scope]')).toBeNull();
  });
});

describe('상황판', () => {
  it('연 단위 경영 카드가 없다 · 대시보드로 가는 역할 안내가 있다', () => {
    const src = readFileSync(join(WEB, 'src/app/(main)/command-center/page.tsx'), 'utf8');
    expect(src).not.toMatch(/<FinanceBenchmarkCard/);
    expect(src).toContain('href="/dashboard"');
    const line = readFileSync(join(WEB, 'src/app/(main)/dashboard/components/DashboardRoleLine.tsx'), 'utf8');
    expect(line).toMatch(/canSeeCommandCenter\(role\) && \(\s*<Link href="\/command-center"/);
    expect(readFileSync(join(WEB, 'src/app/(main)/dashboard/page.tsx'), 'utf8')).toContain('<DashboardRoleLine');
  });
});
