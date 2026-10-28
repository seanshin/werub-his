/**
 * 요양기관 종별 계산기 화면(2026-10-20).
 *  · 네 종별 열 · 지금 설정 종별 표시(미설정이면 "미설정(실청구는 의원…)") · 🔴 미산정·미등재 줄을 0원으로 그리지 않는다
 *  · 실청구 단가와 다른 줄은 "청구 단가" · 서버 단서(caveats)를 그대로 보인다 · 실패를 결과처럼 그리지 않는다
 *  · 설정 화면: 🔴 "전체 저장"이 종별을 박아 넣지 않는다 · 종별 미설정을 "의원"이라 말하지 않는다 · 안 쓰이는 진찰료 설정값을 보이지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render as rtlRender, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const render = (el: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const line = (o: object) => ({ code: 'AA154', name: '초진', role: 'CONSULTATION', quantity: 1, unitPrice: 18840, amount: 18840, basis: 'GAZETTE', covered: true, copayRate: 0.3, billedUnitPrice: 18840, ...o });
const RESP = {
  data: {
    onDate: '2026-10-20', gazetteEffectiveDate: '2026-06-01', configuredGrade: null, copayCategory: 'NHI',
    caveats: [{ code: 'GRADE_UNSET' }, { code: 'NHI_SINGLE_RATE', value: '30' }],
    results: [
      { grade: 'CLINIC', isConfigured: false, baseCopayRate: 0.3, lines: [line({}), line({ role: 'ITEM', code: 'X1', name: '의원만', unitPrice: 5000, amount: 5000, billedUnitPrice: 5000 })], totalAmount: 23840, patientCopay: 7152, insurerAmount: 16688, excludedLines: 0, billedMismatchLines: 0 },
      { grade: 'HOSPITAL', isConfigured: false, baseCopayRate: 0.3, lines: [line({ code: 'AA155', unitPrice: 17500, amount: 17500, billedUnitPrice: 0 }), line({ role: 'ITEM', code: 'X1', name: '의원만', unitPrice: null, amount: null, basis: 'NOT_BILLABLE_AT_TIER', billedUnitPrice: 5000 })], totalAmount: 17500, patientCopay: 5250, insurerAmount: 12250, excludedLines: 1, billedMismatchLines: 1 },
      { grade: 'GENERAL', isConfigured: false, baseCopayRate: 0.3, lines: [line({ code: 'AA156', unitPrice: 19470, amount: 19470, billedUnitPrice: null }), line({ role: 'ITEM', code: 'X1', unitPrice: null, amount: null, basis: 'NOT_BILLABLE_AT_TIER' })], totalAmount: 19470, patientCopay: 5841, insurerAmount: 13629, excludedLines: 1, billedMismatchLines: 0 },
      { grade: 'TERTIARY', isConfigured: false, baseCopayRate: 0.3, lines: [line({ code: 'AA157', unitPrice: 21440, amount: 21440, billedUnitPrice: null }), line({ role: 'ITEM', code: 'X1', unitPrice: null, amount: null, basis: 'NOT_LISTED' })], totalAmount: 21440, patientCopay: 6432, insurerAmount: 15008, excludedLines: 1, billedMismatchLines: 0 },
    ],
  },
};
beforeEach(() => {
  cleanup(); api.get.mockReset(); api.post.mockReset();
  // 화면 표시 설정(UI settings) 조회는 빈 응답 — 금액 표기는 기본 규칙
  api.get.mockImplementation(async (url: string) => (url.includes('codes/procedure') ? { data: [{ code: 'X1', nameKo: '의원만' }] } : { data: [] }));
});

describe('🔴 종별 계산기 패널', () => {
  it('코드 찾아 담고 계산 → 네 종별 · 미설정 표시 · 미산정은 0원이 아니다 · 청구 단가 차이 · 단서', async () => {
    api.post.mockResolvedValue(RESP);
    const { GradeCalculatorPanel } = await import('@/app/(main)/admin/billing-calc/grade-calculator');
    const v = render(<GradeCalculatorPanel />);
    fireEvent.change(v.container.querySelector('[data-grade-calc-search]')!, { target: { value: 'X1' } });
    fireEvent.keyDown(v.container.querySelector('[data-grade-calc-search]')!, { key: 'Enter' });
    await waitFor(() => expect(v.container.textContent).toContain('의원만'));
    fireEvent.click([...v.container.querySelectorAll('ul button')].find((b) => b.textContent?.includes('X1'))!);
    fireEvent.click(v.container.querySelector('[data-grade-calc-run]')!);
    await waitFor(() => expect(v.container.querySelector('[data-grade-calc-result]')).not.toBeNull());
    expect(api.post).toHaveBeenCalledWith('/api/v1/billing/grade-calculator', { visitKind: 'INITIAL', copayCategory: 'NHI', items: [{ code: 'X1', quantity: 1 }] });
    expect(v.container.querySelectorAll('[data-grade-col]').length).toBe(4);
    expect(v.container.querySelector('[data-grade-calc-configured]')!.textContent).toContain('미설정');
    const unpriced = [...v.container.querySelectorAll('[data-grade-calc-unpriced]')].map((e) => e.textContent);
    expect(unpriced).toEqual(['이 종별 미산정', '이 종별 미산정', '고시 미등재']);
    expect(v.container.querySelector('[data-grade-total="HOSPITAL"]')!.textContent).toContain('17,500');
    expect(v.container.querySelector('[data-grade-excluded="HOSPITAL"]')!.textContent).toBe('1');
    expect(v.container.querySelectorAll('[data-grade-calc-master-diff]').length).toBe(1);
    const cav = v.container.querySelector('[data-grade-calc-caveats]')!.textContent!;
    expect(cav).toContain('종별이 설정되지 않았습니다');
    expect(cav).toContain('30%');
    expect(cav).not.toMatch(/GRADE_UNSET|NHI_SINGLE_RATE/);
  });
  it('실패는 실패로 — 결과 표를 그리지 않는다 · 진찰료도 항목도 없으면 계산 버튼이 잠긴다', async () => {
    api.post.mockRejectedValue(new Error('500'));
    const { GradeCalculatorPanel } = await import('@/app/(main)/admin/billing-calc/grade-calculator');
    const v = render(<GradeCalculatorPanel />);
    fireEvent.click(v.container.querySelector('[data-grade-calc-run]')!);
    await waitFor(() => expect(v.container.querySelector('[data-grade-calc-error]')).not.toBeNull());
    expect(v.container.querySelector('[data-grade-calc-result]')).toBeNull();
    fireEvent.change(v.container.querySelector('[data-grade-calc-visit]')!, { target: { value: 'NONE' } });
    expect((v.container.querySelector('[data-grade-calc-run]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('🔴 수가 계산 설정 화면', () => {
  const src = readFileSync('src/app/(main)/admin/billing-calc/page.tsx', 'utf8');
  it('계산기를 탑재했다 · 전체 저장이 종별을 건너뛴다 · 종별 미설정을 의원이라 말하지 않는다 · 안 쓰이는 진찰료 설정값을 보이지 않는다', () => {
    expect(src).toMatch(/<GradeCalculatorPanel \/>/);
    // 전용 패널 설정(종별·건보 율 종별 차등)은 전체 저장도, 범용 목록도 건드리지 않는다
    expect(src).toMatch(/if \(PANEL_ONLY_KEYS\.has\(config\.key\)\) continue;/);
    expect(src).toMatch(/PANEL_ONLY_KEYS = new Set\(\['billing\.institution\.grade', 'billing\.copay\.nhi\.outpatient\.byGrade'\]\)/);
    expect(src).toMatch(/configs\.filter\(\(c\) => !PANEL_ONLY_KEYS\.has\(c\.key\)\)/);
    expect(src).not.toMatch(/editValues\['billing\.institution\.grade'\] \?\? 'CLINIC'/);
    expect(src).toContain('미설정(의원으로 청구)');
    // 🔴 목록은 카탈로그 기본값('CLINIC')도 value 로 싣는다 — 출처가 default 면 미설정이다(v4.100.0 은 value 만 봐서 "의원"이라 말할 뻔했다)
    expect(src).toMatch(/c\.key === 'billing\.institution\.grade' && c\.source !== 'default'/);
    const detail = readFileSync('src/app/(main)/billing/[id]/page.tsx', 'utf8');
    expect(detail).toMatch(/c\.key === 'billing\.institution\.grade' && c\.source !== 'default'/);
    expect(detail).not.toMatch(/cfgMap\['billing\.institution\.grade'\] \?\? 'CLINIC'/);
    expect(src).not.toMatch(/editValues\['billing\.fee\.consultation\.initial'\]/);
  });
});
