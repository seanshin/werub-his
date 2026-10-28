import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 Next.js App Router 의 `page.tsx`/`layout.tsx` 는 **정해진 export 만** 허용한다.
 *
 * 2026-08-18 실측: `safety/page.tsx` 가 `export function useCanReviewSafety()` 를 두어
 * **운영 배포의 `next build` 가 실패**했다.
 *   Type error: "useCanReviewSafety" is not a valid Page export field.
 *
 * 🔴 이 결함은 **`tsc --noEmit` 도 vitest 도 잡지 못한다** — Next.js 빌드 타임 검사이기 때문이다.
 *    즉 "tsc 0 · 테스트 전건 통과"가 **배포 가능을 보장하지 않는다.**
 *    전체 `next build` 는 수 분이 걸려 매 변경마다 돌릴 수 없으므로, 그 검사의 핵심만 여기서 앞당긴다.
 *
 * 재현 방법: 아무 page.tsx 에 `export function foo() {}` 를 추가하면 이 테스트가 실패해야 한다.
 */

const APP_DIR = join(process.cwd(), 'src', 'app');

/** Next.js 15 App Router 가 page/layout 에서 허용하는 export (그 외는 빌드 실패) */
const ALLOWED = new Set([
  'default',
  'metadata', 'generateMetadata',
  'viewport', 'generateViewport',
  'generateStaticParams',
  'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
  'preferredRegion', 'maxDuration', 'experimental_ppr',
]);

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/^(page|layout|template|error|loading|not-found)\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** 이름 있는 export 를 뽑는다. 주석은 코드가 아니므로 먼저 걷어낸다(주석을 코드로 읽은 선례가 있다). */
function namedExports(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const names: string[] = [];
  for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.push(m[1]);
  }
  // `export { a, b }` 형태
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const alias = part.includes(' as ') ? part.split(' as ')[1] : part;
      const name = alias.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('Next.js App Router — page/layout 은 허용된 export 만 한다', () => {
  const files = walk(APP_DIR);

  it('스캔 대상을 찾는다(경로가 바뀌면 조용히 통과하지 않도록)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('🔴 허용되지 않은 이름 export 가 없다 — 있으면 `next build` 가 실패한다(tsc 는 못 잡는다)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const name of namedExports(readFileSync(f, 'utf8'))) {
        // 타입 전용 export 는 런타임 export 가 아니므로 제외 대상이 아니다(정규식이 type 을 잡지 않는다)
        if (!ALLOWED.has(name)) {
          offenders.push(`${f.replace(process.cwd(), '.')}: export ${name}`);
        }
      }
    }
    expect(
      offenders,
      `Next.js page/layout 에서 허용되지 않는 export 다 — 훅·헬퍼는 별도 파일로 옮겨라:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
