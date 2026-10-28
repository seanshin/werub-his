/**
 * 임상 규칙·템플릿 P2 — 카탈로그 생애주기 화면(2026-10-21 · A3).
 *  · 저장 결과: 사용 중 → "새 판(vN) 초안" · 승인 단계 → "초안으로 되돌림" · 평범한 저장은 null
 *  · 사용 중으로: 이전 판 폐기 수 · 이전 판을 가리키는 임상경로 수 · 🔴 경로 조회 실패(null)는 "확인하지 못함"(0 아님)
 *  · 편집 창 안내 — 사용 중/승인 단계에서 저장이 무엇을 일으키는지
 *  · 🔴 승인 기록 남기기 — 관리자만 · 근거 4자 전엔 잠김 · 보낸 근거 그대로 · 사용 중·승인 없음 행만
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activationNotices, editModeHint, editResultNotice } from '@/components/governance/catalog-lifecycle-feedback';

const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
let role = 'ADMIN';
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role } }; return sel ? sel(st) : st; };
  return { useAuthStore };
});
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); post.mockReset(); post.mockResolvedValue({ data: {} }); role = 'ADMIN'; });

describe('저장·상태 결과 문장', () => {
  it('새 판 · 승인 초기화 · 평범한 저장(봉투 유무 모두)', () => {
    expect(editResultNotice({ data: { editMode: 'NEW_VERSION', version: 3 } })).toMatchObject({ params: { 판: 3 } });
    expect(editResultNotice({ data: { data: { editMode: 'RESET_APPROVAL' } } })?.k).toMatch(/초안으로 되돌렸습니다/);
    expect(editResultNotice({ data: { editMode: 'IN_PLACE' } })).toBeNull();
  });
  it('🔴 이전 판 폐기 · 경로 수 · 경로 조회 실패는 확인 못 함(0 이 아님) · 폐기 없으면 침묵', () => {
    expect(activationNotices({ data: { supersededIds: ['a'], pathwayLinksToSuperseded: 2 } }).map((n) => n.params)).toEqual([{ 수: 1 }, { 수: 2 }]);
    expect(activationNotices({ data: { supersededIds: ['a'], pathwayLinksToSuperseded: null } })[1].k).toMatch(/확인하지 못했습니다/);
    expect(activationNotices({ data: { supersededIds: [], pathwayLinksToSuperseded: 0 } })).toEqual([]);
  });
  it('편집 안내 — 사용 중·승인 단계만', () => {
    expect(editModeHint('ACTIVE')).toMatch(/새 판/);
    expect(editModeHint('APPROVED')).toMatch(/다시 승인/);
    expect(editModeHint('DRAFT')).toBeNull();
    expect(editModeHint(undefined)).toBeNull();
  });
  it('🔴 구조 가드 — 두 화면이 저장·상태 결과를 이 정본으로 읽고 편집 안내를 그린다', () => {
    const SRC = join(__dirname, '../../src/app/(main)/admin');
    for (const f of ['order-sets/page.tsx', 'treatment-templates/page.tsx']) {
      const s = readFileSync(join(SRC, f), 'utf8');
      expect(s, f).toMatch(/editResultNotice\(/);
      expect(s, f).toMatch(/activationNotices\(/);
      expect(s, f).toMatch(/data-edit-mode-hint/);
      expect(s, f).toMatch(/recordPath=\{\(id\) => `\/api\/v1\/[a-z-]+\/\$\{id\}\/approval-record`\}/);
    }
  });
});

describe('🔴 승인 기록 남기기', () => {
  const ITEMS = [{ id: 's1', name: '세트1', status: 'ACTIVE' }, { id: 's2', name: '세트2', status: 'ACTIVE', approvedBy: 'x' }, { id: 's3', name: '세트3', status: 'DRAFT' }];
  async function mount() {
    const { ApprovalRecordNotice } = await import('@/components/governance/ApprovalRecordNotice');
    return render(<ApprovalRecordNotice items={ITEMS} what="약속처방" recordPath={(id) => `/api/v1/order-sets/${id}/approval-record`} />, { wrapper: wrap });
  }
  it('사용 중·승인 없음 행만 · 근거 4자 전엔 잠김 · 보낸 근거 그대로', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-approval-open]')!);
    expect([...container.querySelectorAll('[data-approval-row]')].map((e) => e.getAttribute('data-approval-row'))).toEqual(['s1']);
    const save = container.querySelector('[data-approval-save="s1"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-approval-basis="s1"]')!, { target: { value: 'DTC 2026-3' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/order-sets/s1/approval-record', { basis: 'DTC 2026-3' }));
  });
  it('관리자가 아니면 기록 단추 없음(고지는 그대로)', async () => {
    role = 'DOCTOR';
    const { container } = await mount();
    expect(container.querySelector('[data-approval-missing]')).toBeTruthy();
    expect(container.querySelector('[data-approval-open]')).toBeNull();
  });
});

describe('🔴 P3 — 처방의 지정 규칙 화면이 위임 처방은 결정 사항이라고 말한다', () => {
  it('고지와 결정 화면 링크(등록부 키) · 토글보다 먼저', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/admin/prescriber-rules/page.tsx'), 'utf8');
    expect(src).toMatch(/data-delegate-decision/);
    expect(src).toMatch(/href="\/admin\/decisions\/prescription\.delegatePolicy"/);
    expect(src.indexOf('data-delegate-decision')).toBeLessThan(src.indexOf('<Toggle on={r.allowDelegate}'));
  });
});

