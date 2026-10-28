import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 언어별 랜딩이 **자기를 한국어라고 선언**하고 있었다(2026-08-28 실측).
 *    루트 layout 만 `<html>` 을 렌더하므로 `lang="ko"` 가 `/en`·`/ja`·`/zh` 에도 그대로 적용됐다.
 *    스크린리더가 영어 문장을 한국어 음성으로 읽고, 검색엔진이 언어를 잘못 판정한다.
 *
 * 🔴 루트에서 경로를 읽어 고치면(`headers()`) **앱 전체가 동적 렌더**가 된다 —
 *    대가가 크므로 HTML 표준대로 **하위 트리에 lang 을 건다**.
 */
const APP = join(process.cwd(), 'src/app');
const CASES: Array<[string, string]> = [['en', 'en'], ['ja', 'ja'], ['zh', 'zh-Hans']];

describe('언어별 랜딩은 자기 언어를 선언한다', () => {
  for (const [dir, code] of CASES) {
    it(`/${dir} 레이아웃이 lang="${code}" 를 건다`, () => {
      const src = readFileSync(join(APP, dir, 'layout.tsx'), 'utf8');
      expect(src).toMatch(new RegExp(`lang="${code}"`));
    });

    it(`/${dir} 이 hreflang 대체 링크를 선언한다(대조군 — 이미 있던 것)`, () => {
      const src = readFileSync(join(APP, dir, 'layout.tsx'), 'utf8');
      expect(src).toMatch(/alternates:\s*\{\s*languages/);
    });
  }

  it('🔴 루트는 여전히 ko 다 — 여기서 고치면 앱 전체가 동적 렌더가 된다(의도된 상태)', () => {
    const root = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    expect(root).toContain('<html lang="ko">');
  });
});
