/**
 * 통합 상황판 디자인 강화(2026-10-02) — A 색은 상태만 · B 경보 구성 · E 직전 갱신 대비 변화 · D 관제 모드(이름 가림).
 *  · 카드 상태 5가지(위험·조회 실패·주의·기준 초과 없음·데이터 없음)로 윗선·배지·정렬 — 부서 색 띠 없음
 *  · "기준 초과 없음"을 "정상"이라 하지 않는다 · 조회 실패는 위험 다음(숨기지 않는다)
 *  · 0·측정 없음 칸은 한 줄로 접되 이름은 남긴다
 *  · 머리 띠 경보 = 조치 목록과 같은 원천(위험·주의 종류·건수) · '경고 총합' 칸 중복 제거
 *  · 변화는 양쪽에 있는 값만(실패 섹션으로 변화를 지어내지 않는다)
 *  · 관제 모드: 환자 이름 첫 글자만·등록번호·병실 없음·환자 링크 없음
 * 재주입: 상태 정렬을 지우면, 이름 가림을 지우면, 실패 섹션을 변화에 넣으면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  boardStatus, sortByStatus, alertComposition, numericSnapshot, numericDelta, wallMaskName, criticalActions,
} from '@/app/(main)/command-center/command-center-view';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => null } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: { user: { role: string } }) => unknown) => sel({ user: { role: 'ADMIN' } }) }));
vi.mock('@/app/(main)/command-center/Building3DSection', () => ({ Building3DSection: () => null }));
vi.mock('@/app/(main)/executive/finance-benchmark/FinanceBenchmarkCard', () => ({ FinanceBenchmarkCard: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/command-center' }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const SECTIONS = {
  nursing: { ok: true, summary: { total: 5, highRisk: 1, medsOverdue: 0, unsignedNotes: 1, isolated: 0, handoffPending: 0 } },
  pharmacy: { ok: true, summary: { pending: 2, verifyWait: 0, verifyWaitExternal: 0, dispensedToday: 0, lowStockCount: 0 } },
  bed: { ok: false, error: 'boom' },
  receptionBilling: { ok: true, summary: { waiting: 3, eligUnchecked: 1, todayPaidCount: 0, todayPaidAmount: 0, outstandingCount: 0, outstandingAmount: 0, docPending: 0 } },
};

describe('상태 판정·정렬(순수)', () => {
  const actions = criticalActions(SECTIONS);
  it('🔴 위험 → 조회 실패 → 주의 → 기준 초과 없음 · 실패는 숨기지 않고 위험 다음', () => {
    expect(boardStatus('nursing', SECTIONS.nursing, actions)).toBe('DANGER'); // 고위험 EWS
    expect(boardStatus('bed', SECTIONS.bed, actions)).toBe('FAILED');
    expect(boardStatus('receptionBilling', SECTIONS.receptionBilling, actions)).toBe('WARN'); // 자격 미확인
    expect(boardStatus('pharmacy', SECTIONS.pharmacy, actions)).toBe('CLEAR');
    expect(boardStatus('emergency', undefined, actions)).toBe('NO_DATA');
    const order = sortByStatus(['pharmacy', 'receptionBilling', 'bed', 'nursing'].map((key) => ({ key })), (k) => boardStatus(k, SECTIONS[k as keyof typeof SECTIONS], actions));
    expect(order.map((x) => x.key)).toEqual(['nursing', 'bed', 'receptionBilling', 'pharmacy']);
  });

  it('경보 구성 = 조치 목록과 같은 원천', () => {
    expect(alertComposition(actions)).toEqual({ dangerKinds: 1, dangerCount: 1, warnKinds: 1, warnCount: 1 });
  });

  it('🔴 변화는 양쪽에 있는 값만 — 직전에 실패한 섹션은 변화로 지어내지 않는다 · 0 변화 없음', () => {
    const prev = numericSnapshot({ kpi: { census: 5 }, sections: { nursing: { ok: true, summary: { total: 5 } }, bed: { ok: false } } });
    const cur = numericSnapshot({ kpi: { census: 7 }, sections: { nursing: { ok: true, summary: { total: 5 } }, bed: { ok: true, summary: { occupied: 9 } } } });
    expect(numericDelta(prev, cur)).toEqual({ 'kpi.census': 2 });
    expect(numericDelta(null, cur)).toEqual({});
  });

  it('이름 가림은 첫 글자만', () => {
    expect(wallMaskName('홍길동')).toBe('홍○○');
    expect(wallMaskName('Бат-Эрдэнэ')).toBe('Б○○');
    expect(wallMaskName('')).toBe('○○');
  });
});

describe('화면', () => {
  beforeEach(() => {
    cleanup(); get.mockReset();
    window.history.replaceState(null, '', '/command-center');
    get.mockImplementation((url: string) => {
      if (url.includes('/command-center/summary')) {
        return Promise.resolve({ data: { sections: SECTIONS, kpi: { census: 5, erActive: 0, criticalPending: 0, occupancyRate: null, bedAlert: 0, alertsTotal: 337, alertsUnavailable: ['bed'] }, generatedAt: '2026-10-02T01:00:00Z' } });
      }
      if (url.includes('/journey-console/board')) {
        return Promise.resolve({ data: { asOf: '2026-10-02T01:00:00Z', opd: [], ipd: [] } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it('🔴 카드는 상태순·상태 배지 · 부서 색 띠 없음 · 경보 구성과 부분 집계 · 경고 총합 칸 없음', async () => {
    const { default: Page } = await import('@/app/(main)/command-center/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelectorAll('[data-board]').length).toBe(4));
    expect([...container.querySelectorAll('[data-board]')].map((e) => e.getAttribute('data-board-status'))).toEqual(['DANGER', 'FAILED', 'WARN', 'CLEAR']);
    expect(container.querySelector('[data-board="pharmacy"] [data-status-badge]')!.textContent).toBe('기준 초과 없음');
    expect(container.innerHTML).not.toMatch(/bg-gradient-to-r from-(teal|rose|blue|violet|cyan|amber|fuchsia)-/);
    const comp = container.querySelector('[data-alert-composition]')!;
    expect(comp.textContent).toContain('위험 1종 1건');
    expect(comp.textContent).toContain('주의 1종 1건');
    expect(container.textContent).toContain('부분 집계');
    // 0 칸은 한 줄로 접힘(이름은 남는다)
    expect(container.querySelector('[data-board="pharmacy"] [data-muted-fields]')!.textContent).toContain('금일 조제');
  });

  it('🔴 관제 모드 — 이름 첫 글자만·등록번호 없음·환자 링크 없음 · 끄면 되돌아온다', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/journey-console/board')) {
        return Promise.resolve({ data: { asOf: '2026-10-02T01:00:00Z', ipd: [], opd: [{ patientId: 'p1', name: '홍길동', mrn: 'P2026-0001', stage: 'RECEPTION', dept: '내과', place: '301호', minutes: 300, flags: ['RECEPTION_DELAY'] }] } });
      }
      return Promise.resolve({ data: { sections: SECTIONS, kpi: { census: 5, alertsTotal: 3, bedAlert: 0 }, generatedAt: '2026-10-02T01:00:00Z' } });
    });
    const { default: Page } = await import('@/app/(main)/command-center/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-patient-name]')).not.toBeNull());
    expect(container.querySelector('[data-patient-name]')!.textContent).toBe('홍길동');
    fireEvent.click(container.querySelector('[data-wall-toggle]')!);
    await waitFor(() => expect(container.querySelector('[data-wall="1"]')).not.toBeNull());
    expect(container.querySelector('[data-patient-name]')!.textContent).toBe('홍○○');
    expect(container.textContent).not.toContain('P2026-0001');
    expect(container.textContent).not.toContain('301호');
    expect(container.querySelector('a[href="/patients/p1"]')).toBeNull();
    expect(container.querySelector('[data-wall-badge]')).not.toBeNull();
    expect(window.location.search).toContain('wall=1');
    fireEvent.click(container.querySelector('[data-wall-toggle]')!);
    await waitFor(() => expect(container.querySelector('[data-patient-name]')!.textContent).toBe('홍길동'));
  });

  it('부서 정의에 색 띠·강조색이 되살아나지 않는다(색은 상태만)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/command-center/page.tsx'), 'utf8');
    expect(src).not.toMatch(/bar: 'from-/);
    // 🔴 지표 칸은 페이지 바탕 위에 바로 놓인다 — 반투명 바탕은 관제 모드(어두운 바탕)에서 회색으로 비쳐 붉은 값이 안 읽혔다
    expect(src).toContain("danger ? 'border-rose-200 bg-rose-50' : warn ? 'border-amber-200 bg-amber-50'");
  });
});
