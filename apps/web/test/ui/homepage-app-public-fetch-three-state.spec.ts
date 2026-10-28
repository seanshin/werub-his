/**
 * 🔴 (2026-09-14) 격리 빌드 공개 사이트 앱 `apps/homepage` 도 web `(homepage)` 와 같은 결함을 갖고 있었다 —
 *    `publicFetch(...) ?? []` 로 받아 API 장애 순간이 "등록된 채용 공고가 없습니다"·"의료진 정보를 찾을 수 없습니다"로 그려졌다.
 *    R6 은 web 소비처와 헬퍼 사본만 고쳤고 앱 소비처 15곳은 종전 모양이었다.
 * 지키는 것:
 *  ① 앱 목록·상세 소비처 8곳이 `publicFetchResult` 로 실패를 따로 그린다(`?? []` 로 삼키지 않는다)
 *  ② 종전 `publicFetch` 소비처는 "없음"을 주장하지 않는 자리만 — 목록 동결(사유 필수)
 *  ③ 앱 `PublicLoadFailed` 는 web 정본과 글자 단위로 같다(격리 빌드 사본)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(__dirname, '../../../homepage/src');
const WEB = path.resolve(__dirname, '../../src');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '');
const read = (rel: string) => strip(fs.readFileSync(path.join(APP, rel), 'utf8'));

const CORRECTED = [
  'app/news/recruit/page.tsx',
  'app/news/page.tsx',
  'app/health-info/page.tsx',
  'app/care/doctors/page.tsx',
  'app/care/departments/page.tsx',
  'app/care/centers/page.tsx',
  'app/care/departments/[slug]/page.tsx',
  'app/care/doctors/[userId]/page.tsx',
] as const;

/** 종전 publicFetch 를 그대로 쓰는 자리 — 표시가 "없음"을 주장하지 않는다 */
const LEGACY_OK: Record<string, string> = {
  'app/layout.tsx': '내비게이션 진료과 목록 — 실패 시 메뉴 항목 생략(없다고 말하지 않음)',
  'app/home/page.tsx': '홈 섹션 — 실패·없음이면 섹션 자체를 생략',
  'app/health-info/[slug]/layout.tsx': 'SEO 메타 폴백',
  'app/news/[slug]/layout.tsx': 'SEO 메타 폴백',
  'app/about/page.tsx': '수치 카드 — 실패 시 카드 생략',
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('apps/homepage 소비처 — 실패를 없음으로 그리지 않는다', () => {
  it.each(CORRECTED)('① %s 는 3상태를 쓰고 ?? [] 로 삼키지 않는다', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/publicFetchResult</);
    expect(src).not.toMatch(/publicFetch<[^>]*>\([^)]*\)\s*\?\?\s*\[\]/);
    expect(src).toMatch(/PublicLoadFailed|reason === 'UNAVAILABLE'/);
  });

  it('② 종전 publicFetch 소비처는 동결 목록과 정확히 같다(사유 필수)', () => {
    const found = walk(APP)
      .filter((f) => !f.endsWith(path.join('lib', 'public-fetch.ts')))
      .filter((f) => /\bpublicFetch</.test(strip(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(APP, f).split(path.sep).join('/'))
      .sort();
    expect(found).toEqual(Object.keys(LEGACY_OK).sort());
    for (const why of Object.values(LEGACY_OK)) expect(why.trim().length).toBeGreaterThan(0);
  });

  it('③ 앱 PublicLoadFailed 는 web 정본 사본', () => {
    const canon = fs.readFileSync(path.join(WEB, 'components/homepage/PublicLoadFailed.tsx'), 'utf8');
    const copy = fs.readFileSync(path.join(APP, 'components/homepage/PublicLoadFailed.tsx'), 'utf8');
    expect(copy).toBe(canon);
  });
});
