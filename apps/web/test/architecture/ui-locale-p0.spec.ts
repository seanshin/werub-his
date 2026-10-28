import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * UI 크롬 언어 P0 배선 가드 — 기획 ui-locale-i18n.plan.md.
 * "만든 것 ≠ 소비처가 쓰는 것" — 스토어·셀렉트·하이드레이션·lang 속성이 실제로 이어져 있는지 소스로 못박는다.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const body = (s: string) =>
  s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
   .replace(/\/\*[\s\S]*?\*\//g, '')
   .replace(/^\s*\/\/.*$/gm, '');

describe('P0 — 저장 2층·전환 UI 배선', () => {
  it('스토어가 서버(uiLocale)와 기관 기본(hospital.defaultUiLocale)을 순서대로 본다', () => {
    const s = body(read('stores/ui-locale-store.ts'));
    expect(s).toContain("put('/api/v1/users/me/ui-preferences', { uiLocale: l })");
    expect(s).toContain('/api/v1/config/hospital.defaultUiLocale');
    // 서버 저장 실패를 조용히 삼키지 않는다
    expect(s).toContain('이 기기에만 저장');
  });

  it('TopBar 가 셀렉트를 렌더하고, 용어 토글과 나란히 선다(두 축 구분)', () => {
    const s = body(read('components/layout/TopBar.tsx'));
    expect(s).toMatch(/<UiLocaleSelect[\s/>]/);
    expect(s).toMatch(/<TermLangToggle[\s/>]/);
  });

  it('셀렉트가 축 구분 힌트를 들고, 아랍어는 선택지에 없다(별도 트랙 §8)', () => {
    const s = read('components/layout/UiLocaleSelect.tsx');
    expect(s).toContain('화면 언어');
    // 🔴 RTL 레이아웃도 검수자도 없는 언어를 고르게 두지 않는다(반쪽을 완성인 척 금지)
    expect(s).not.toContain('UI_LOCALE_DIR');
  });

  it('🔴 문자열 방향 안전망(dir=auto)은 유지한다 — 비용 0·별도 트랙 복귀 시 그대로 쓰인다', () => {
    const t = body(read('components/ui/i18n-text.tsx'));
    const badge = body(read('components/ui/StatusBadge.tsx'));
    expect(t).toContain('dir="auto"');
    expect(badge).toMatch(/dir: 'auto'/);
    // ko 는 DOM 동일성 규약 — 속성을 붙이지 않는다
    expect(t).toMatch(/locale === 'ko'\) return <span className=\{className\}>/);
  });

  it('빈 키·비한글 키에 미번역 티를 달지 않는다(동적 키 방어 — 2026-09-07 실측 회수)', () => {
    const t = body(read('components/ui/i18n-text.tsx'));
    expect(t).toMatch(/if \(typeof k !== 'string' \|\| !k\.trim\(\)\) return null;/);
    expect(t).toMatch(/HAS_KO\.test\(k\)/);
  });

  /**
   * 🔴 위 가드는 **다른 이유로 통과하고 있었다** — 방어 문장이 존재하는지만 봤고 **어디에 있는지**는 보지 않았다.
   *    실제 코드에서 그 문장은 `tOf(k, locale)` **뒤**에 있어 아무것도 막지 못했고, 동적 키가 `undefined` 인
   *    화면(`/admin/organizations` · `org.type`/`orgType` 계약 불일치)이 `key.lastIndexOf('@')` 로 통째로 죽었다
   *    (2026-09-13 외부 실측 S18). 이제 **순서**를 본다 — `T`·`Tf` 모두 방어가 첫 `tOf` 호출보다 먼저 와야 한다.
   *    재주입: 두 줄의 순서를 다시 뒤집으면 이 검사가 실패해야 한다(주석은 `body()` 가 지우므로 설명문은 안 걸린다).
   */
  it('🔴 빈 키 방어가 tOf 호출보다 **앞에** 있다 — T·Tf 각각(S18 재발 방지)', () => {
    const t = body(read('components/ui/i18n-text.tsx'));
    const fnOf = (head: string) => {
      const start = t.indexOf(head);
      expect(start, `${head} 를 찾지 못했다`).toBeGreaterThan(-1);
      const rest = t.slice(start + head.length);
      const next = rest.search(/\nexport function /);
      return rest.slice(0, next === -1 ? undefined : next);
    };
    for (const head of ['export function T(', 'export function Tf(']) {
      const fn = fnOf(head);
      const guardAt = fn.indexOf("typeof k !== 'string'");
      const callAt = fn.indexOf('tOf(k, locale)');
      expect(guardAt, `${head} 빈 키 방어가 없다`).toBeGreaterThan(-1);
      expect(callAt, `${head} tOf 호출이 없다`).toBeGreaterThan(-1);
      expect(guardAt, `${head} 방어가 tOf 뒤에 있다 — 아무것도 막지 못한다`).toBeLessThan(callAt);
    }
  });

  it('(main) 레이아웃이 하이드레이션과 lang 속성을 배선한다', () => {
    const s = read('app/(main)/layout.tsx');
    expect(body(s)).toMatch(/useHydrateUiLocale\(\)/);
    expect(body(s)).toMatch(/<div lang=\{uiLocale\}/);
  });

  it('🔴 print 경로에 로케일이 침투하지 않는다(법정 서식 불변 — §0)', () => {
    const printPage = read('app/print/[issueNo]/page.tsx');
    expect(printPage).not.toContain('useUiLocale');
    expect(printPage).not.toContain('ui-locale-store');
  });
});

describe('P0 — emr.locale 폐기(중복 정본 재발 방지)', () => {
  it('폐기 키가 미배선 고지·옵션표에 남아 있지 않다', () => {
    const s = read('app/(main)/admin/ai-settings/page.tsx');
    expect(s).not.toMatch(/'emr\.locale':/);
  });
});
