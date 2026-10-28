/**
 * 🔴 등록부가 화면으로 보내는 링크는 **실재하는 라우트**여야 한다 — 2026-08-27 신설.
 *
 * 실측 배경: `/admin/go-live` 는 각 항목에 `<a href={it.drillDown}>상세 →</a>` 를 그대로 렌더한다
 * (`admin/go-live/page.tsx:151,240`). 그런데 등록부 41개 중 2개가 **없는 라우트**를 가리키고 있었다:
 *   · `/admin/consent-templates` → 실재는 `/consent/templates`
 *   · `/admin/eapproval`         → 그런 화면이 없다(전자결재 현황은 `/admin/approvals-dashboard`)
 * 개시 준비 화면에서 "상세 →"를 누른 사람은 **404 를 자기 실수로 읽는다**(화면번호 축과 같은 유형).
 *
 * 재주입: 아무 `drillDown` 을 없는 경로로 바꾸면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = path.join(__dirname, '..', '..');
const APP_DIR = path.join(API_ROOT, '..', 'web', 'src', 'app');
const REGISTRY = path.join(API_ROOT, 'src', 'modules', 'go-live', 'go-live.registry.ts');

/** Next App Router 라우트 실재 판정 — 라우트 그룹`(x)`·동적 세그먼트`[id]`를 감안한다 */
function routeExists(route: string): boolean {
  const parts = route.replace(/^\/+/, '').split('/').filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (!fs.existsSync(dir)) return false;
    if (rest.length === 0) return ['page.tsx', 'page.ts', 'route.ts'].some((f) => fs.existsSync(path.join(dir, f)));
    const [head, ...tail] = rest;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of entries) {
      // 정확히 일치 · 라우트 그룹(투명) · 동적 세그먼트
      if (e.name === head && walk(path.join(dir, e.name), tail)) return true;
      if (/^\(.*\)$/.test(e.name) && walk(path.join(dir, e.name), rest)) return true;
      if (/^\[.*\]$/.test(e.name) && walk(path.join(dir, e.name), tail)) return true;
    }
    return false;
  };
  return walk(APP_DIR, parts);
}

describe('개시 준비 등록부 — "상세 →" 가 실재하는 화면으로 간다', () => {
  const src = fs.readFileSync(REGISTRY, 'utf8');
  const routes = [...src.matchAll(/drillDown:\s*'([^']+)'/g)].map((m) => m[1]);

  it('🔴 drillDown 이 전부 실재하는 Next 라우트다', () => {
    // 표본이 사라지면 조용히 통과한다 — 하한을 건다(2026-08-27 실측 41)
    expect(routes.length, 'drillDown 추출 실패').toBeGreaterThanOrEqual(35);
    const missing = [...new Set(routes)].filter((r) => r.startsWith('/') && !routeExists(r));
    expect(missing, `등록부가 없는 화면으로 보낸다(누르면 404):\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('대조군 — 판정 함수가 실제로 파일시스템을 읽는다(무조건 참이 아니다)', () => {
    expect(routeExists('/admin/go-live')).toBe(true);       // 실재
    expect(routeExists('/consent/templates')).toBe(true);   // 라우트 그룹 `(main)` 을 통과해 찾는다
    expect(routeExists('/admin/no-such-screen-xyz')).toBe(false);
  });
});
