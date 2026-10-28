/**
 * 누가·언제·왜(2026-10-10).
 *  · 호스피스 사전연명의료 카드 — 철회 기록(사유 필수 · 기록자는 서버가 로그인 사용자로) · 철회된 문서 목록(기록자·사유 없으면 "기록 없음")
 *  · 협진 — 종결된 협진에 "종결: 누구 · 언제" · 그 전 종결은 기록 없음(지어내지 않는다)
 * 재주입: 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); });

const active = { id: 'ad1', documentType: 'AD', registeredAt: '2026-10-01T00:00:00Z', status: 'ACTIVE', cprDecision: 'DNR' };
const revokedNew = { id: 'ad2', documentType: 'POLST', registeredAt: '2026-09-01T00:00:00Z', status: 'REVOKED', revokedAt: '2026-09-20T00:00:00Z', revokeReason: '본인 철회', revokedBy: { familyName: '김', givenName: '간호' } };
const revokedOld = { id: 'ad3', documentType: 'AD', registeredAt: '2026-08-01T00:00:00Z', status: 'REVOKED', revokedAt: '2026-08-02T00:00:00Z', revokeReason: null, revokedBy: null };

describe('사전연명의료 카드 — 철회', () => {
  const mount = async () => {
    const { AdvanceDirectiveCard } = await import('@/app/(main)/hospice/AdvanceDirectiveCard');
    return render(<AdvanceDirectiveCard patientId="p1" />, { wrapper: wrap });
  };
  it('철회된 문서도 받아 유효/철회를 나눈다 · 유효 0 이면 "없음" + 철회 목록', async () => {
    get.mockResolvedValue({ data: [revokedNew] });
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-advance-directive="NONE"]')).not.toBeNull());
    expect(get).toHaveBeenCalledWith('/api/v1/hospice/directives/p1?includeRevoked=1');
    expect(r.container.querySelector('[data-directive-revoked-count="1"]')).not.toBeNull();
  });
  it('🔴 철회 기록자·사유 — 있으면 그대로 · 없으면(옛 철회) 기록 없음(지어내지 않는다)', async () => {
    get.mockResolvedValue({ data: [active, revokedNew, revokedOld] });
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-advance-directive="PRESENT"]')).not.toBeNull());
    const nw = r.container.querySelector('[data-directive-revoked="ad2"]')!.textContent!;
    expect(nw).toContain('김간호');
    expect(nw).toContain('본인 철회');
    const old = r.container.querySelector('[data-directive-revoked="ad3"]')!.textContent!;
    expect(old).toContain('기록 없음');
    expect(r.container.querySelector('[data-directive-revoked="ad3"] [data-directive-revoke-reason]')!.textContent).toContain('기록 없음');
    expect(old).not.toContain('김간호');
    // 유효 문서에만 철회 버튼
    expect(r.container.querySelector('[data-directive-revoke-open="ad1"]')).not.toBeNull();
    expect(r.container.querySelector('[data-directive-revoke-open="ad2"]')).toBeNull();
  });
  it('🔴 사유를 쓰기 전엔 철회를 보낼 수 없다 · 보낼 때 사유만(기록자는 서버가)', async () => {
    get.mockResolvedValue({ data: [active] });
    patch.mockResolvedValue({ data: {} });
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-directive-revoke-open="ad1"]')).not.toBeNull());
    fireEvent.click(r.container.querySelector('[data-directive-revoke-open="ad1"]')!);
    const btn = r.container.querySelector('[data-directive-revoke-submit="ad1"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain('min-h-[44px]');
    fireEvent.change(r.container.querySelector('[data-directive-revoke-form="ad1"] textarea')!, { target: { value: '  본인 구두 철회  ' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/hospice/directives/ad1/revoke', { reason: '본인 구두 철회' }));
  });
  it('안전 표시줄은 유효 문서만(키·URL 이 다르다 — 같은 키에 모양 둘이면 갈라진다)', () => {
    const bar = src('app/(main)/patients/[id]/components/PatientSafetyBar.tsx');
    expect(bar).toContain('`/api/v1/hospice/directives/${patientId}`)');
    expect(src('app/(main)/hospice/AdvanceDirectiveCard.tsx')).toContain("queryKey: ['hospice-directives', patientId, 'with-revoked']");
  });
});

describe('협진 종결자 표시', () => {
  it('🔴 차트 의뢰/회신 탭·협진 화면 둘 다 종결된 협진에 누구·언제 · 미기록은 UNRECORDED', () => {
    for (const f of ['app/(main)/patients/[id]/components/ReferralTab.tsx', 'app/(main)/consultations/page.tsx']) {
      const s = src(f);
      expect(s).toMatch(/status === 'CLOSED' && \(\s*<p[^>]*data-consult-closed=/);
      expect(s).toMatch(/<StaffName familyName=\{\w\.closedBy\?\.familyName\} givenName=\{\w\.closedBy\?\.givenName\} \/>/);
      expect(s).toMatch(/<KDate value=\{\w\.closedAt\} mode="datetime" unknown="UNRECORDED" \/>/);
    }
  });
  it('StaffName·KDate 는 값이 없으면 "기록 없음"(— 로 뭉개지 않는다)', async () => {
    const { StaffName, KDate } = await import('@/components/ui/display');
    const r = render(<p><StaffName familyName={null} givenName={null} /> · <KDate value={null} mode="datetime" unknown="UNRECORDED" /></p>, { wrapper: wrap });
    expect(r.container.textContent).toContain('기록 없음');
    expect(r.container.textContent).not.toContain('-');
  });
});
