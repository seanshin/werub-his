/**
 * 🔴 (2026-09-14) 공개 홈페이지 `publicFetch` 가 네트워크 실패·5xx·404·`data:null` 을 전부 `null` 로 돌려줘,
 *    `?? []` 로 받은 목록이 API 장애 순간 "등록된 채용 공고가 없습니다"·"검색 결과가 없습니다"로,
 *    상세가 "의료진 정보를 찾을 수 없습니다"로 그려졌다(ISR 이라 그 거짓 페이지가 revalidate 창 동안 캐시).
 * 지키는 것:
 *  ① `publicFetchResult` 3상태 — 실패(UNAVAILABLE)·404(NOT_FOUND)·성공(data null 포함)을 가른다
 *  ② 목록·상세 소비처 8곳은 3상태를 쓰고 실패를 따로 그린다(`?? []` 로 삼키지 않는다)
 *  ③ 종전 `publicFetch` 를 쓰는 곳은 "없음"을 주장하지 않는 자리만 — 목록 동결(사유 필수)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicFetch, publicFetchResult } from '@/lib/public-fetch';

const HOME = path.resolve(__dirname, '../../src/app/(homepage)');
const read = (rel: string) => fs.readFileSync(path.join(HOME, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '');

function mockFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('publicFetchResult 3상태', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('네트워크 실패 → UNAVAILABLE', async () => {
    mockFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await publicFetchResult('/x')).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  });
  it('5xx → UNAVAILABLE(상태 병기)', async () => {
    mockFetch(() => Promise.resolve(new Response('boom', { status: 503 })));
    expect(await publicFetchResult('/x')).toEqual({ ok: false, reason: 'UNAVAILABLE', status: 503 });
  });
  it('404 → NOT_FOUND(없는 대상이 사실인 경우)', async () => {
    mockFetch(() => Promise.resolve(new Response('{}', { status: 404 })));
    expect(await publicFetchResult('/x')).toEqual({ ok: false, reason: 'NOT_FOUND', status: 404 });
  });
  it('본문 해석 실패 → UNAVAILABLE', async () => {
    mockFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await publicFetchResult('/x')).toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
  });
  it('대조군 — 200 은 성공이고 data null 도 성공(서버가 없음이라고 말한 것)', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200 })));
    expect(await publicFetchResult('/x')).toEqual({ ok: true, data: [{ id: 1 }] });
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ data: null }), { status: 200 })));
    expect(await publicFetchResult('/x')).toEqual({ ok: true, data: null });
  });
  it('종전 publicFetch 는 모양 유지(실패·없음 모두 null)', async () => {
    mockFetch(() => Promise.reject(new Error('down')));
    expect(await publicFetch('/x')).toBeNull();
  });
});

describe('공개 홈페이지 소비처 — 실패를 없음으로 그리지 않는다', () => {
  const MIGRATED = [
    'news/recruit/page.tsx', 'news/page.tsx', 'health-info/page.tsx',
    'care/doctors/page.tsx', 'care/departments/page.tsx', 'care/centers/page.tsx',
    'care/departments/[slug]/page.tsx', 'care/doctors/[userId]/page.tsx',
  ];

  it.each(MIGRATED)('② %s 는 3상태로 받고 실패를 따로 그린다', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/publicFetchResult</);
    expect(src, '종전 publicFetch 로 되돌아갔다').not.toMatch(/\bpublicFetch</);
    expect(src).toMatch(/PublicLoadFailed|reason === 'UNAVAILABLE'/);
  });

  it('③ 종전 publicFetch 소비처는 "없음"을 주장하지 않는 자리만(목록 동결)', () => {
    const ALLOWED: Record<string, string> = {
      'layout.tsx': 'JSON-LD 구조화 데이터 — 화면에 "없음"을 그리지 않는다',
      'home/page.tsx': '홈 섹션은 데이터가 없으면 섹션을 빼고 "없음" 문구를 그리지 않는다',
      'about/page.tsx': '수치 카드는 null 이면 카드를 뺀다(0 을 그리지 않는다)',
      'international/page.tsx': '수치 카드는 null 이면 뺀다',
      'health-info/[slug]/layout.tsx': 'SEO 메타 폴백 제목',
      'news/[slug]/layout.tsx': 'SEO 메타 폴백 제목',
    };
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && /\bpublicFetch</.test(fs.readFileSync(p, 'utf8'))) found.push(path.relative(HOME, p));
      }
    };
    walk(HOME);
    expect(found.sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const reason of Object.values(ALLOWED)) expect(reason.length).toBeGreaterThan(0);
  });
});
