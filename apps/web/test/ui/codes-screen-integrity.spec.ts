import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 `/admin/codes` 실측(2026-08-26 사람 신고)
 *  ① '자동매핑' 탭에서 **`Cannot GET /api/v1/codes/auto-mapping` 404** 가 화면 전체를 덮었다 —
 *     탭 키를 그대로 경로에 넣는데(`/api/v1/codes/${tab}`) 그 탭은 목록 EP 가 아니다.
 *  ② 관리 화면 110개 중 역할을 검사하는 것이 4개뿐이고 공통 가드가 없어,
 *     **nav 에서 숨겨도 URL 로 들어가면 열렸고** 안에서 EP 마다 403(`Forbidden resource`)을 만났다.
 */
const PAGE = join(process.cwd(), 'src/app/(main)/admin/codes/page.tsx');
const LAYOUT = join(process.cwd(), 'src/app/(main)/admin/layout.tsx');

describe('코드 마스터 화면', () => {
  const page = readFileSync(PAGE, 'utf8');

  it('🔴 목록 EP 가 아닌 탭에서는 목록을 조회하지 않는다', () => {
    expect(page).toContain('const LIST_TABS');
    expect(page).toMatch(/enabled: listEnabled/);
  });

  it("자동매핑 탭이 목록 탭 목록에 없다(그래야 '/codes/auto-mapping' 을 부르지 않는다)", () => {
    const i = page.indexOf('const LIST_TABS');
    expect(page.slice(i, i + 160)).not.toContain('auto-mapping');
  });

  it('🔴 목록 조회 실패가 다른 탭 화면까지 덮지 않는다', () => {
    expect(page).toMatch(/listEnabled && isError/);
  });

  it('대조군 — 목록 탭에서는 여전히 조회하고 실패도 말한다', () => {
    const i = page.indexOf('const LIST_TABS');
    expect(page.slice(i, i + 160)).toContain('diagnosis');
    expect(page).toContain('QueryErrorFallback');
  });
});

describe('관리 화면 접근 가드', () => {
  const layout = readFileSync(LAYOUT, 'utf8');

  it('사이드바 선언(NAV_SECTIONS)을 정본으로 읽는다 — 역할을 또 적지 않는다', () => {
    expect(layout).toContain('NAV_SECTIONS');
    expect(layout).toMatch(/i\.href === pathname/);
  });

  it('🔴 일괄 ADMIN 차단이 아니다 — 선언된 역할로 판정한다', () => {
    expect(layout).toMatch(/allowed\.includes\(user\.role\)/);
    expect(layout).not.toMatch(/user\.role !== 'ADMIN'/);
  });

  it('🔴 선언이 없는 화면은 막지 않는다(등재 안 된 화면을 조용히 지우지 않는다)', () => {
    expect(layout).toMatch(/!allowed\) return <>\{children\}<\/>/);
  });

  it('막을 때 이유와 갈 곳을 말한다', () => {
    expect(layout).toContain('권한이 없습니다');
    expect(layout).toContain('지금 계정의 권한은');
    expect(layout).toContain('/dashboard');
  });
});
