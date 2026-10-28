/**
 * 임상 도구 점수표 — 부분 합은 그 점수가 아니다(2026-10-10).
 *  · 🔴 점수표 실행기가 일부만 고른 합계를 총점으로 내보내, 환자 차트에 "Braden 9점(고위험)" 같은 값으로 저장됐다
 *    (서버가 Braden 부분 합을 400 으로 거절하게 된 뒤에는 진료 화면이 그 실패를 삼켰다)
 *  · 다 고르기 전: 총점·판정 없이 `incomplete { answered, required }` 만 · 다 고르면 종전 그대로
 *  · 진료 화면: 다 고르지 않은 점수표는 보내지 않고 몇 건인지 말한다 · 저장 실패도 몇 건인지 말한다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getChart } from '@/lib/clinical-charts';
import type { ClinicalChartValue } from '@/components/clinical-charts/ClinicalChartRunner';

vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => cleanup());

async function runBraden() {
  const def = getChart('BRADEN')!;
  expect(def.archetype).toBe('scoring');
  const { ClinicalChartRunner } = await import('@/components/clinical-charts/ClinicalChartRunner');
  const seen: ClinicalChartValue[] = [];
  const view = render(<ClinicalChartRunner def={def} onChange={(v) => seen.push(v)} />, { wrapper: wrap });
  const cats = (def as Extract<typeof def, { archetype: 'scoring' }>).categories;
  // 각 항목의 첫 선택지 버튼 — 선택지 라벨로 찾는다
  const pickFirst = (i: number) => {
    const label = cats[i].options[0].label;
    const btn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.startsWith(label));
    expect(btn, label).toBeTruthy();
    fireEvent.click(btn!);
  };
  return { seen, cats, pickFirst };
}

describe('점수표 실행기 — 다 고르기 전에는 총점을 내보내지 않는다', () => {
  it('🔴 일부만 고르면 총점·판정 없음 + 몇 개 골랐는지', async () => {
    const { seen, cats, pickFirst } = await runBraden();
    pickFirst(0);
    pickFirst(1);
    const last = seen[seen.length - 1];
    expect(last.result.total).toBeUndefined();
    expect(last.result.label).toBeUndefined();
    expect(last.result.incomplete).toEqual({ answered: 2, required: cats.length });
    expect(last.inputs).toHaveProperty('idx'); // 입력은 남는다(복원)
  });

  it('대조군 — 다 고르면 총점·판정이 나오고 incomplete 는 없다', async () => {
    const { seen, cats, pickFirst } = await runBraden();
    for (let i = 0; i < cats.length; i++) pickFirst(i);
    const last = seen[seen.length - 1];
    expect(typeof last.result.total).toBe('number');
    expect(last.result.incomplete).toBeUndefined();
  });
});

describe('진료 화면 — 임상 도구 영속', () => {
  const src = readFileSync(join(__dirname, '../../src/app/(main)/patients/[id]/encounter/new/page.tsx'), 'utf8');
  const block = src.slice(src.indexOf('const persistClinicalResults'), src.indexOf('const handleSaveDraft'));
  it('🔴 다 고르지 않은 점수표는 보내지 않는다 · 실패를 삼키지 않고 건수를 말한다', () => {
    expect(block).toContain('!r.incomplete');
    expect(block).toContain('Promise.allSettled');
    expect(block).toMatch(/toast\.warning\(`임상 도구 결과 \$\{failed\}건/);
    expect(block).toMatch(/toast\.warning\(`다 고르지 않은 점수표 \$\{incomplete\}건/);
    expect(block).not.toMatch(/catch\s*\{\s*\/\*/);
  });
});
