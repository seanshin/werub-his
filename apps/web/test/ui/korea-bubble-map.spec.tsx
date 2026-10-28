import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSido, shortHospitalName } from '../../src/app/(main)/executive/finance-benchmark/KoreaBubbleMap';

/**
 * 경영성과 벤치마크 지도(2026-09-28) — 시도·시군구 경계 위 버블.
 * 경계 자료: 통계청 SGIS 2018(공공누리 제1유형) 단순화본 — 출처 표기가 파일에 남아 있어야 한다.
 */
const GEO = join(__dirname, '../../public/geo');

describe('경계 자료', () => {
  it('시도 17 · 시군구는 시도별 파일 17 · 출처(공공누리 제1유형) 표기 · WGS84', () => {
    const prov = JSON.parse(readFileSync(join(GEO, 'kr-provinces-2018.json'), 'utf8'));
    expect(prov.provinces).toHaveLength(17);
    expect(prov.source).toMatch(/공공누리 제1유형/);
    expect(prov.crs).toMatch(/WGS84/);
    const files = readdirSync(join(GEO, 'kr-sgg-2018'));
    expect(files).toHaveLength(17);
    for (const p of prov.provinces) expect(existsSync(join(GEO, 'kr-sgg-2018', `${p.code}.json`))).toBe(true);
    const seoul = JSON.parse(readFileSync(join(GEO, 'kr-sgg-2018', '11.json'), 'utf8'));
    expect(seoul.municipalities).toHaveLength(25);
    expect(seoul.source).toMatch(/공공누리 제1유형/);
  });
});

describe('이름', () => {
  it('지도 이름표는 법인 접두어·재단명을 뗀다', () => {
    expect(shortHospitalName('의료법인성광의료재단일산차병원')).toBe('일산차병원');
    expect(shortHospitalName('의료법인명지의료재단명지병원')).toBe('명지병원');
    expect(shortHospitalName('가상암센터')).toBe('가상암센터');
    expect(shortHospitalName('(의)나사렛의료재단 나사렛국제병원')).toBe('나사렛국제병원');
  });
  it('개칭된 시도 이름은 2018 경계 이름으로', () => {
    expect(normalizeSido('강원특별자치도')).toBe('강원도');
    expect(normalizeSido('전북특별자치도')).toBe('전라북도');
    expect(normalizeSido('경기도')).toBe('경기도');
    expect(normalizeSido(null)).toBeNull();
  });
});

import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { KoreaBubbleMap, type MapPoint } from '../../src/app/(main)/executive/finance-benchmark/KoreaBubbleMap';

describe('🔴 병원명 이름표 — 기관 수와 무관하게 나온다(종전: 15곳 이하일 때만)', () => {
  const prov = { provinces: [{ code: '31', name: '경기도', rings: [[[126, 36], [128, 36], [128, 38], [126, 38], [126, 36]]] }] };
  const pts: MapPoint[] = Array.from({ length: 20 }, (_, i) => ({
    name: `테스트병원${i + 1}`, self: false, sido: '경기도', sigungu: '가시', // 격자로 흩어 겹치지 않게
    lat: 36.1 + Math.floor(i / 4) * 0.4, lng: 126.1 + (i % 4) * 0.5, medicalProfit: (i % 2 ? 1 : -1) * 1e9 * (i + 1),
  }));
  it('20곳이어도 이름표가 붙고 · 선택한 기관은 항상 붙는다 · 확대 버튼이 있다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => prov })));
    const { container, getByLabelText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <KoreaBubbleMap points={pts} sido="" sigungu="" selected="테스트병원7" onPick={() => {}} onPickSido={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelectorAll('path').length).toBeGreaterThan(0));
    const texts = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    expect(texts.length).toBeGreaterThan(15);
    expect(texts).toContain('테스트병원7');
    expect(getByLabelText('확대')).toBeTruthy();
    expect(getByLabelText('축소')).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe('🔴 좌표 없는 기관(공시 원자료) — 시군구 중심에 "위치 근사"로 · 못 맞추면 빼고 수를 밝힌다', () => {
  it('중심점 표 — 출처(공공누리 제1유형) · 시도 17 · 서울 25 구', () => {
    const c = JSON.parse(readFileSync(join(GEO, 'kr-sgg-2018-centroids.json'), 'utf8'));
    expect(c.source).toMatch(/공공누리 제1유형/);
    expect(c.source).toMatch(/위치 근사/);
    expect(Object.keys(c.sido)).toHaveLength(17);
    expect(Object.keys(c.sido['서울특별시'])).toHaveLength(25);
  });

  const prov = { provinces: [{ code: '31', name: '경기도', rings: [[[126, 36], [128, 36], [128, 38], [126, 38], [126, 36]]] }] };
  const cen = { source: 'x', sido: { 경기도: { 수원시장안구: [127.0, 37.3], 수원시권선구: [127.0, 37.2], 가평군: [127.5, 37.8] } } };
  const base = { self: false, sido: '경기도', medicalProfit: 1e9 };
  const pts: MapPoint[] = [
    { ...base, name: '좌표병원', sigungu: '가평군', lat: 37.8, lng: 127.5 },
    { ...base, name: '근사병원A', sigungu: '수원시', lat: null, lng: null }, // 구가 있는 시 → 그 구들의 평균
    { ...base, name: '근사병원B', sigungu: '수원시', lat: null, lng: null },
    { ...base, name: '모름병원', sigungu: '없는군', lat: null, lng: null },
  ];
  it('근사 2곳은 점선 원 · 같은 중심의 둘은 겹치지 않게 벌리고 · 모르는 1곳은 빼고 수를 말한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => ({ ok: true, json: async () => (String(u).includes('centroids') ? cen : prov) })));
    const { container, findByText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <KoreaBubbleMap points={pts} sido="" sigungu="" selected={null} onPick={() => {}} onPickSido={() => {}} clusterOff />
      </QueryClientProvider>,
    );
    await findByText(/점선 원 2곳/);
    await findByText(/위치를 알 수 없는 1곳/);
    const marks = [...container.querySelectorAll('svg [data-marker]')];
    expect(marks).toHaveLength(3);
    const dashed = marks.filter((g) => g.getAttribute('data-approx') === '1');
    expect(dashed).toHaveLength(2);
    expect(dashed.every((g) => g.querySelector('path[stroke-dasharray]'))).toBe(true);
    const [a, b] = dashed.map((g) => g.getAttribute('transform'));
    expect(a).not.toBe(b);
    vi.unstubAllGlobals();
  });
});

import { mapLevel, SGG_PPD, EMD_PPD } from '../../src/app/(main)/executive/finance-benchmark/KoreaBubbleMap';

describe('상세 수준 — 확대할수록 시도 → 시군구 → 읍면동', () => {
  it('읍면동 경계 파일 — 시도별 17 · 출처(공공누리 제1유형) · 서울 424 동', () => {
    const files = readdirSync(join(GEO, 'kr-emd-2018'));
    expect(files).toHaveLength(17);
    const seoul = JSON.parse(readFileSync(join(GEO, 'kr-emd-2018', '11.json'), 'utf8'));
    expect(seoul.source).toMatch(/공공누리 제1유형/);
    expect(seoul.submunicipalities.length).toBe(424);
    expect(seoul.submunicipalities.every((e: { code: string }) => e.code.startsWith('11'))).toBe(true);
  });
  it('수준 판정 — 전국 맞춤은 시도 · 확대하면 시군구 · 더 확대하면 읍면동 · 시도/시군구를 고르면 한 단계씩 먼저', () => {
    expect(mapLevel(80, false, false)).toBe('sido');
    expect(mapLevel(SGG_PPD, false, false)).toBe('sgg');
    expect(mapLevel(EMD_PPD, false, false)).toBe('emd');
    expect(mapLevel(80, true, false)).toBe('sgg');
    expect(mapLevel(80, true, true)).toBe('emd');
  });
  it('시군구를 고르면 그 시도의 시군구·읍면동 경계를 받아 그린다(다른 시도 파일은 받지 않는다)', async () => {
    const prov = { provinces: [
      { code: '31', name: '경기도', rings: [[[126, 36], [128, 36], [128, 38], [126, 38], [126, 36]]] },
      { code: '11', name: '서울특별시', rings: [[[130, 40], [131, 40], [131, 41], [130, 41], [130, 40]]] },
    ] };
    const sgg = { municipalities: [{ code: '31011', name: '수원시장안구', rings: [[[126.9, 37.2], [127.1, 37.2], [127.1, 37.4], [126.9, 37.4], [126.9, 37.2]]] }] };
    const emd = { submunicipalities: [{ code: '3101151', name: '파장동', rings: [[[126.95, 37.25], [127.0, 37.25], [127.0, 37.3], [126.95, 37.3], [126.95, 37.25]]] }] };
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(String(u));
      const body = String(u).includes('kr-emd-2018') ? emd : String(u).includes('kr-sgg-2018/') ? sgg : String(u).includes('centroids') ? { sido: {} } : prov;
      return { ok: true, json: async () => body };
    }));
    const pts: MapPoint[] = [{ name: '가병원', self: false, sido: '경기도', sigungu: '수원시', lat: 37.3, lng: 127.0, medicalProfit: 1e9 }];
    const { container, findByText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <KoreaBubbleMap points={pts} sido="경기도" sigungu="수원시" selected={null} onPick={() => {}} onPickSido={() => {}} />
      </QueryClientProvider>,
    );
    await findByText(/표시 수준: 읍면동/);
    await waitFor(() => expect(urls).toContain('/geo/kr-emd-2018/31.json'));
    expect(urls.some((u) => u.includes('/11.json'))).toBe(false);
    await waitFor(() => expect([...container.querySelectorAll('path')].some((p) => p.getAttribute('stroke') === '#c7d2fe')).toBe(true));
    vi.unstubAllGlobals();
  });
});

import { CLUSTER_OFF_PPD, clusterByGrid, marginBin, marginColor, markerShape, sizeRatio, MARGIN_NA_COLOR } from '../../src/app/(main)/executive/finance-benchmark/finance-map';

describe('지도 부호화 정본(finance-map) — 크기=규모 · 색=의료이익률 6단 · 모양=종별', () => {
  it('이익률 칸 경계 — 0% 는 흑자 쪽 · −10%/−3%/3%/10% 는 위 칸 · 산출 불가는 회색', () => {
    expect([-0.2, -0.1, -0.05, -0.03, -0.001, 0, 0.029, 0.03, 0.099, 0.1, 0.5].map(marginBin))
      .toEqual(['m10', 'm3', 'm3', 'm0', 'm0', 'p3', 'p3', 'p10', 'p10', 'p10+', 'p10+']);
    expect(marginBin(null)).toBe('na');
    expect(marginBin(Number.NaN)).toBe('na');
    expect(marginColor(null)).toBe(MARGIN_NA_COLOR);
    expect(marginColor(0)).not.toBe(MARGIN_NA_COLOR); // 0% 는 산출 불가가 아니다
  });
  it('규모 — √ 척도 · 의료수익 없음/0 이하는 null(규모를 지어내지 않는다)', () => {
    expect(sizeRatio(25, 100)).toBeCloseTo(0.5);
    expect(sizeRatio(100, 100)).toBe(1);
    expect(sizeRatio(null, 100)).toBeNull();
    expect(sizeRatio(0, 100)).toBeNull();
  });
  it('종별 모양 — 공시 종별 6 + 그 밖', () => {
    expect(['상급종합병원', '종합병원', '병원', '요양병원', '정신병원', '한방병원', '치과병원', null].map(markerShape))
      .toEqual(['tertiary', 'general', 'hospital', 'longterm', 'psych', 'kmed', 'other', 'other']);
  });
  it('묶음 — 같은 칸만 · 고정(선택) 표식은 묶지 않는다 · 흑자 분모는 의료이익을 아는 기관만', () => {
    const it = (key: string, x: number, y: number, surplus: boolean | null, pinned = false) => ({ key, x, y, surplus, pinned });
    const { clusters, singles } = clusterByGrid([it('a', 1, 1, true), it('b', 5, 5, false), it('c', 10, 10, null), it('d', 12, 12, true, true), it('e', 200, 200, true)], 46);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ n: 3, surplusK: 1, surplusN: 2 });
    expect(singles.map((s) => s.key).sort()).toEqual(['d', 'e']);
    expect(CLUSTER_OFF_PPD).toBeGreaterThan(1000);
  });
});

describe('2D 표식 — 묶음 원(n · 흑자 k/n) · 확대하면 풀린다', () => {
  it('가까운 3곳은 묶음 하나(n=3) · 누르면 확대', async () => {
    const prov = { provinces: [{ code: '31', name: '경기도', rings: [[[126, 36], [128, 36], [128, 38], [126, 38], [126, 36]]] }] };
    vi.stubGlobal('fetch', vi.fn(async (u: string) => ({ ok: true, json: async () => (String(u).includes('centroids') ? { sido: {} } : prov) })));
    const base = { self: false, sido: '경기도', sigungu: '가시' };
    const pts: MapPoint[] = [
      { ...base, name: '가', lat: 37.0, lng: 127.0, medicalProfit: 1, medicalRevenue: 100, hospitalType: '종합병원', ratios: { medicalProfitMargin: 0.01, ordinaryMargin: 0.01 } },
      { ...base, name: '나', lat: 37.001, lng: 127.001, medicalProfit: -1, medicalRevenue: 50, hospitalType: '요양병원', ratios: { medicalProfitMargin: -0.02, ordinaryMargin: 0 } },
      { ...base, name: '다', lat: 37.002, lng: 127.0, medicalProfit: 2, medicalRevenue: 80, hospitalType: '병원', ratios: { medicalProfitMargin: 0.02, ordinaryMargin: 0 } },
      { ...base, name: '라', lat: 36.2, lng: 127.8, medicalProfit: 2, medicalRevenue: 80, hospitalType: '상급종합병원', ratios: { medicalProfitMargin: 0.2, ordinaryMargin: 0 } },
    ];
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <KoreaBubbleMap points={pts} sido="" sigungu="" selected={null} onPick={() => {}} onPickSido={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelector('[data-cluster]')).toBeTruthy());
    expect(container.querySelector('[data-cluster]')!.getAttribute('data-cluster')).toBe('3');
    expect([...container.querySelectorAll('[data-marker]')].map((g) => g.getAttribute('data-marker'))).toEqual(['tertiary']);
    // 이름표에 이익률 칩
    expect(container.textContent).toContain('+20.0%');
    vi.unstubAllGlobals();
  });
});

import { emdCandidates, matchEmd } from '../../src/app/(main)/executive/finance-benchmark/finance-map';

describe('🔴 위치 근사 — 땅 안의 점 · 주소 읍면동까지(2026-09-29 실화면: 섬 많은 시군구의 면적 중심이 바다였다)', () => {
  const inside = (x: number, y: number, r: [number, number][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  it('시군구 근사점 250곳이 전부 자기 시군구 경계 안(바다·다른 시군구가 아니다)', () => {
    const prov = JSON.parse(readFileSync(join(GEO, 'kr-provinces-2018.json'), 'utf8')).provinces as { code: string; name: string }[];
    const cen = JSON.parse(readFileSync(join(GEO, 'kr-sgg-2018-centroids.json'), 'utf8')).sido;
    const out: string[] = [];
    let n = 0;
    for (const f of readdirSync(join(GEO, 'kr-sgg-2018'))) {
      const j = JSON.parse(readFileSync(join(GEO, 'kr-sgg-2018', f), 'utf8'));
      const s = prov.find((p) => p.code === j.sidoCode)!.name;
      for (const m of j.municipalities) {
        n++;
        const pt = cen[s][m.name];
        if (!pt || !m.rings.some((r: [number, number][]) => inside(pt[0], pt[1], r))) out.push(`${s} ${m.name}`);
      }
    }
    expect(n).toBe(250);
    expect(out).toEqual([]);
  });
  it('여수시(섬이 흩어진 시) 근사점은 땅 안 · 효드림요양병원 주소 (미평동) → 미평동 안의 점', () => {
    const emd = JSON.parse(readFileSync(join(GEO, 'kr-emd-2018-points.json'), 'utf8')).sido;
    const cands = emdCandidates('전라남도 여수시 미평9길 21(미평동)');
    expect(cands).toContain('미평동');
    expect(matchEmd(emd['전라남도']['여수시'], cands)).toEqual(emd['전라남도']['여수시']['미평동']);
  });
  it('주소 읍면동 — 괄호·어절에서 찾고, 법정동(풍납동)은 행정동(풍납1·2동) 평균으로 · 못 찾으면 null', () => {
    expect(emdCandidates('서울특별시 송파구 올림픽로43길 88 & #40;풍납동 388-1& #41;')).toContain('풍납동');
    expect(emdCandidates('충청남도 아산시 배방읍 휴대세교길 101')).toContain('배방읍');
    expect(matchEmd({ 풍납1동: [1, 1], 풍납2동: [3, 3], 잠실동: [9, 9] }, ['풍납동'])).toEqual([2, 2]);
    expect(matchEmd({ 잠실동: [9, 9] }, ['풍납동'])).toBeNull();
  });
});

describe('목록에서 고르면 지도가 그 기관으로 옮겨 간다', () => {
  it('🔴 화면 밖 기관을 고르면(selected 변경) 그 표식이 지도 가운데로 온다', async () => {
    const prov = { provinces: [{ code: '31', name: '경기도', rings: [[[126, 36], [128, 36], [128, 38], [126, 38], [126, 36]]] }] };
    vi.stubGlobal('fetch', vi.fn(async (u: string) => ({ ok: true, json: async () => (String(u).includes('centroids') || String(u).includes('points') ? { sido: {} } : prov) })));
    const pts: MapPoint[] = [
      { name: '가', self: false, sido: '경기도', sigungu: 'x', lat: 36.1, lng: 126.1, medicalProfit: 1 },
      { name: '나', self: false, sido: '경기도', sigungu: 'y', lat: 37.9, lng: 127.9, medicalProfit: 1 },
    ];
    const ui = (sel: string | null) => (
      <QueryClientProvider client={qc}>
        <KoreaBubbleMap points={pts} sido="" sigungu="" selected={sel} onPick={() => {}} onPickSido={() => {}} clusterOff />
      </QueryClientProvider>
    );
    const qc = new QueryClient();
    const { container, rerender } = render(ui(null));
    await waitFor(() => expect(container.querySelectorAll('[data-marker]').length).toBe(2));
    rerender(ui('나'));
    await waitFor(() => {
      const g = [...container.querySelectorAll('[data-marker]')].find((m) => m.querySelector('circle')); // 선택 고리가 있는 표식
      const [x, y] = (g?.getAttribute('transform') ?? '').match(/-?[\d.]+/g)!.map(Number);
      expect(Math.abs(x - 280)).toBeLessThan(2);
      expect(Math.abs(y - 310)).toBeLessThan(2);
    }, { timeout: 2000 });
    vi.unstubAllGlobals();
  });
});
