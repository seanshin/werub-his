import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

import { ChartSearchPanel, CHART_SEARCH_TYPE_META } from '../../src/app/(main)/patients/[id]/components/ChartSearchPanel';
import { VisitComparisonPanel, VITAL_ROWS } from '../../src/app/(main)/patients/[id]/components/VisitComparisonPanel';

/**
 * 차트 내 검색(C4)·직전 방문 대비(C7) — patient-chart-refinement.
 *
 * 🔴 지키는 것
 *  ① 검색은 서버 정본(`/api/v1/medical-records/search`)에 **환자 id 를 실어** 부른다 — 패널이 따로 긁어 모으지 않는다
 *  ② 자르면 잘랐다고 말한다(truncated) · 예비 검사 결과는 예비라고 말한다
 *  ③ 서버 headline 을 HTML 로 그리지 않는다(원문에 태그가 섞여도 텍스트)
 *  ④ 직전 방문이 없으면 비교표 없이 "비교할 이전 방문 없음"
 *  ⑤ 한쪽 미측정은 `-` — 0 을 그리지 않는다 · 판정 문구(악화·호전·증량·감량)를 그리지 않는다
 *  ⑥ 두 패널이 넘기는 한국어 키가 전부 카탈로그에 있다
 */

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const PID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => get.mockReset());

/** 화면 표시 설정(`useUiSettings` 의 `/api/v1/config?category=ui`) 조회는 이 가드의 관심 밖 — 대상 EP 호출만 센다 */
const respond = (body: unknown) => get.mockImplementation((url: string) =>
  Promise.resolve(String(url).startsWith('/api/v1/config') ? { data: [] } : body));
const calls = (prefix: string) => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));

describe('차트 내 검색 패널', () => {
  it('①② 환자 id 를 실어 정본 검색을 부르고, 잘림·예비 결과를 말한다', async () => {
    respond({
      data: {
        total: 42, truncated: true, generatedAt: '2026-09-14T01:00:00Z',
        results: [
          { id: 'l1', type: 'lab_result', headline: '<mark>HbA1c</mark> 7.2 %', doctorName: '검사자', recordedAt: '2026-09-01T01:00:00Z', status: 'COMPLETED' },
        ],
      },
    });
    const { container } = wrap(<ChartSearchPanel patientId={PID} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'HbA1c' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await screen.findByTestId('chart-search-results');
    const url = calls('/api/v1/medical-records/search?')[0];
    expect(url).toBeDefined();
    expect(url).toContain(`patientId=${PID}`);
    const t = container.textContent ?? '';
    expect(t).toMatch(/42/);
    expect(t).toContain('예비 결과');
  });

  it('③ headline 의 태그를 HTML 로 그리지 않는다', async () => {
    respond({
      data: { total: 1, truncated: false, results: [{ id: 'e1', type: 'encounter', headline: '<img src=x onerror=alert(1)> <mark>두통</mark>', doctorName: '', recordedAt: '2026-09-01T01:00:00Z', status: null }] },
    });
    const { container } = wrap(<ChartSearchPanel patientId={PID} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '두통' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await screen.findByTestId('chart-search-results');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('두 글자 미만이면 조회하지 않는다', async () => {
    respond({ data: { total: 0, results: [] } });
    wrap(<ChartSearchPanel patientId={PID} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '두' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await screen.findByText(/두 글자 이상/);
    expect(calls('/api/v1/medical-records/search')).toEqual([]);
  });
});

const EMPTY_VITALS = { current: null, previous: null };

describe('직전 방문 대비 패널', () => {
  it('④ 직전 방문이 없으면 비교표 대신 "비교할 이전 방문 없음"', async () => {
    respond({
      data: { reason: 'NO_PREVIOUS_VISIT', current: { id: 'c', createdAt: '2026-09-10T01:00:00Z', status: 'DRAFT', visitType: null, doctorName: null }, previous: null, vitals: EMPTY_VITALS, diagnoses: [], medications: [], labs: [], truncated: false },
    });
    const { container } = wrap(<VisitComparisonPanel patientId={PID} encounterId="c" />);
    await screen.findByText(/비교할 이전 방문 없음/);
    expect(container.querySelector('table')).toBeNull();
    expect(calls(`/api/v1/patients/${PID}/visit-comparison?encounterId=c`)).toHaveLength(1);
  });

  it('⑤ 한쪽 미측정은 `-`(0 아님) · 판정 문구 없음', async () => {
    respond({
      data: {
        reason: null,
        current: { id: 'c', createdAt: '2026-09-10T01:00:00Z', status: 'SIGNED', visitType: null, doctorName: null },
        previous: { id: 'p', createdAt: '2026-08-10T01:00:00Z', status: 'SIGNED', visitType: null, doctorName: null },
        vitals: {
          current: { measuredAt: '2026-09-10T00:50:00Z', systolicBp: 150, diastolicBp: null, heartRate: null, temperature: null, spo2: null, respiratoryRate: null, painScore: null, weight: null, bmi: null },
          previous: null,
        },
        diagnoses: [],
        medications: [{ key: 'm1', nameKo: '아스피린', nameEn: null, ingredient: null, current: { dosage: '100mg', frequency: 'QD', duration: null, route: null, count: 1 }, previous: { dosage: '50mg', frequency: 'QD', duration: null, route: null, count: 1 } }],
        labs: [],
        truncated: false,
      },
    });
    const { container } = wrap(<VisitComparisonPanel patientId={PID} encounterId="c" />);
    await screen.findByTestId('visit-comparison-panel');
    const firstRow = container.querySelector('tbody tr')!;
    const cells = [...firstRow.querySelectorAll('td')].map((td) => td.textContent?.trim());
    expect(cells[1]).toBe('-'); // 직전 방문엔 측정 없음
    expect(cells[2]).toMatch(/150/);
    const t = container.textContent ?? '';
    expect(t).not.toMatch(/악화|호전|증량|감량|개선|↑|↓/);
    expect(t).toContain('100mg');
    expect(t).toContain('50mg');
  });
});

describe('⑥ 두 패널의 한국어 키가 전부 카탈로그에 있다', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
  const read = (p: string) => readFileSync(p, 'utf-8');
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...new Set(['common.ts', ...[...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`)])];
  const ALL = new Set<string>();
  for (const f of files) for (const k of catalogKeysOf(read(join(MSG, f))) as Set<string>) ALL.add(k);

  const COMP = join(ROOT, 'apps/web/src/app/(main)/patients/[id]/components');
  function used(file: string): string[] {
    const src = stripComments(read(join(COMP, file)));
    const out = new Set<string>();
    for (const m of src.matchAll(/<Tf?\s+k="((?:\\.|[^"\\])+)"/g)) out.add(m[1]);
    for (const m of src.matchAll(/\btAttr\(\s*'((?:\\.|[^'\\])*)'/g)) out.add(m[1]);
    for (const m of src.matchAll(/\b(?:title|hint)="([^"]*)"/g)) out.add(m[1]);
    for (const m of src.matchAll(/<Section title="([^"]*)"/g)) out.add(m[1]);
    return [...out].filter((k) => /[가-힣]/.test(k));
  }

  it('ChartSearchPanel · VisitComparisonPanel · 비교 버튼', () => {
    const keys = [
      ...used('ChartSearchPanel.tsx'),
      ...used('VisitComparisonPanel.tsx'),
      ...Object.values(CHART_SEARCH_TYPE_META).map((m) => m.label),
      ...VITAL_ROWS.map((r) => r.label),
      '↔ 직전 방문과 비교',
    ];
    expect(keys.length).toBeGreaterThan(30); // 추출이 죽으면 빈 검사가 된다
    const missing = keys.filter((k) => !ALL.has(k));
    expect(missing).toEqual([]);
    expect(read(join(COMP, 'EncounterHistoryTab.tsx'))).toContain('<T k="↔ 직전 방문과 비교" />');
  });
});
