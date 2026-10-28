import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as fs from 'fs';
import * as path from 'path';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

import FacilityInfoPage from '../../src/app/(main)/facility-info/page';

/**
 * 🔴 (2026-09-14) 시설 안내 주요 카드(주차·식당·장례식장)는 CMS 공개 행만 — 3상태.
 * 원 결함: 카드 4장이 'B1~B3 총 320대'·'A한식 6,000원'·'1층 메디치노 07~20시'·'별관 1층 · 빈소 5실' 을 코드 상수로 그렸다.
 * CMS 에 PARKING/DINING/FUNERAL 카테고리가 이미 있는데 이 화면만 그 정본을 지나지 않았다(P12).
 * 목은 정본 EP 의 실제 반환 모양(`GET /api/v1/public/hospital-info?category=` → `{ data: 행[] }`).
 */
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const CARD_CONSTANTS = ['B1~B3 총 320대', '이후 30분 1,000원', 'A한식 6,000원', '직원식 4,500원', '1층 메디치노 07~20시', 'CU 편의점 06~23시', '별관 1층 · 빈소 5실'];

describe('시설 안내 — 주요 카드는 CMS 공개 행만(3상태)', () => {
  beforeEach(() => get.mockReset());

  it('🔴 행이 없으면 "등록된 안내 없음" — 상수를 그리지 않는다', async () => {
    get.mockResolvedValue({ data: [] });
    wrap(<FacilityInfoPage />);
    await waitFor(() => expect(screen.getAllByText(/등록된 안내 없음/)).toHaveLength(3));
    const guideCalls = get.mock.calls.filter((c) => c[0] === '/api/v1/public/hospital-info');
    const cats = guideCalls.map((c) => (c[1] as { category: string }).category).sort();
    expect(cats).toEqual(['DINING', 'FUNERAL', 'PARKING']);
  });

  it('행이 있으면 CMS 제목·본문을 그린다(대조군)', async () => {
    get.mockImplementation(async (p: string, q?: { category?: string }) =>
      p === '/api/v1/public/hospital-info' ? { data: [{ id: q?.category, title: `센티넬-${q?.category}`, content: '센티넬 본문 42' }] } : { data: null });
    wrap(<FacilityInfoPage />);
    expect(await screen.findByText('센티넬-PARKING')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('센티넬 본문 42')).toHaveLength(3));
    expect(screen.queryByText(/등록된 안내 없음/)).toBeNull();
  });

  it('🔴 조회 실패를 "없음"으로 그리지 않는다 — 실패로 말한다', async () => {
    get.mockImplementation(async (p: string) => { if (p === '/api/v1/public/hospital-info') throw new Error('500'); return { data: null }; });
    wrap(<FacilityInfoPage />);
    await waitFor(() => expect(screen.getAllByText(/안내를 불러오지 못했습니다/)).toHaveLength(3));
    expect(screen.queryByText(/등록된 안내 없음/)).toBeNull();
  });

  it('소스에 카드 상수가 남지 않는다(주석 제외 — 층별 안내 예시 FLOORS 는 별개 축)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/(main)/facility-info/page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const c of CARD_CONSTANTS) expect(src, `카드 상수 '${c}'`).not.toContain(c);
  });
});
