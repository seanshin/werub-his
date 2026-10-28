import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { buildExportText, tsQuote } from '../../src/modules/i18n-review/export-shape';
import { emptyState, makeService, overrideRow, realTranslatedKey } from './i18n-review-fixture';
import { TranslationOverrideStatus } from '@prisma/client';

/**
 * 🔴 **내보낸 텍스트는 카탈로그 파일 형식과 같다 — 붙여넣으면 컴파일된다**
 *    (정본 `i18n-human-review.plan.md` §2.5 · §4).
 *
 * 왜 "컴파일된다"를 실제로 확인하는가: 이 텍스트는 **코드로 수렴하는 유일한 경로**다.
 * 문자열 이스케이프가 한 군데 새면 개발자가 붙여넣는 순간 카탈로그 파일이 깨지거나 —
 * 더 나쁘게는 **컴파일은 되는데 값이 달라진다**(따옴표·역슬래시·개행이 든 문구가 실제로 있다).
 * 그래서 파싱만 보지 않고 **transpile 후 실행해 값까지 대조**한다.
 */

/** 내보낸 텍스트를 실제로 TS 로 컴파일하고 실행해, 선언된 카탈로그 객체를 되돌려 받는다 */
function compileAndRun(text: string): Record<string, Record<string, string>> {
  const parsed = ts.createSourceFile('overlay.ts', text, ts.ScriptTarget.ES2020, true);
  const diags = (parsed as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  expect(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), '내보낸 텍스트가 TS 문법 오류다').toEqual([]);
  const out = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exportsObj: Record<string, unknown> = {};
  // `import type` 은 transpile 에서 지워진다 — 남아 있으면 여기서 즉시 드러난다
  expect(out.outputText).not.toContain('require(');
  new Function('exports', out.outputText)(exportsObj);
  const catalogKey = Object.keys(exportsObj).find((k) => !k.endsWith('_VERIFIED'));
  expect(catalogKey, '카탈로그 상수를 내보내지 않았다').toBeTruthy();
  return exportsObj[catalogKey!] as Record<string, Record<string, string>>;
}

describe('🔴 내보내기 형식 — 붙여넣으면 컴파일되고 값이 그대로다', () => {
  /** 🔴 실제로 카탈로그에 있는 문구 + 이스케이프가 필요한 실제 형태들 */
  const NASTY: Array<{ key: string; value: string }> = [
    { key: '화면 언어', value: "It's a 'quoted' value" },
    { key: '경고\\주의', value: 'back\\slash' },
    { key: '줄바꿈', value: '첫 줄\n둘째 줄\r셋째' },
    // 🔴 U+2028/U+2029 는 **JS 소스에서 줄바꿈으로 읽히는** 문자다 — 이스케이프하지 않으면 리터럴이 깨진다.
    //    보이지 않는 문자라 소스에 그대로 두면 편집 중 사라져 검사가 무동작이 된다 — 이스케이프로 적는다.
    { key: '유니코드 구분자', value: 'a\u2028b\u2029c' },
    { key: '따옴표"둘', value: '"double" and `tick` and ${notATemplate}' },
  ];

  it('스캐너 오라클 — 실제 카탈로그 키로도 만든다(합성 문자열만 보고 통과하지 않는다)', () => {
    const { key, value } = realTranslatedKey('en');
    const text = buildExportText({ locale: 'en', area: 'ALL', entries: [{ key, value }], generatedAt: 'now', alreadyInCode: 0 });
    const obj = compileAndRun(text);
    expect(obj.en[key]).toBe(value);
  });

  it('따옴표·역슬래시·개행이 들어가도 컴파일되고 값이 왜곡되지 않는다', () => {
    const text = buildExportText({ locale: 'ja', area: 'nav', entries: NASTY, generatedAt: 'now', alreadyInCode: 1 });
    const obj = compileAndRun(text);
    for (const { key, value } of NASTY) expect(obj.ja[key], `키 ${JSON.stringify(key)}`).toBe(value);
  });

  it('tsQuote 는 TS 문자열 리터럴 하나를 만든다(리터럴을 깨고 나가지 않는다)', () => {
    for (const { value } of NASTY) {
      const lit = tsQuote(value);
      expect(lit.startsWith("'") && lit.endsWith("'")).toBe(true);
      expect(new Function(`return ${lit}`)()).toBe(value);
    }
  });

  it('카탈로그 형식 그대로다 — MessageCatalog 타입·locale 층·_VERIFIED 집합', () => {
    const text = buildExportText({ locale: 'ja', area: 'nav', entries: [{ key: 'A', value: 'B' }], generatedAt: 'now', alreadyInCode: 0 });
    expect(text).toContain("import type { MessageCatalog } from '../t';");
    expect(text).toMatch(/export const REVIEW_OVERLAY_JA_NAV: MessageCatalog = \{/);
    expect(text).toMatch(/export const REVIEW_OVERLAY_JA_NAV_VERIFIED: ReadonlySet<string> = new Set\(\[/);
    // 🔴 자동 커밋하지 않는다는 사실을 텍스트 자체가 말한다(사람이 반영해야 정본이 된다)
    expect(text).toContain('자동 커밋은 하지 않는다');
    expect(text).toContain('0건은 **이미 코드 값과 같다**');
  });

  it('빈 승인분도 컴파일되는 텍스트를 만든다(0건을 깨진 파일로 만들지 않는다)', () => {
    const text = buildExportText({ locale: 'th', area: 'ALL', entries: [], generatedAt: 'now', alreadyInCode: 0 });
    const obj = compileAndRun(text);
    expect(obj.th).toEqual({});
  });

  it('서비스 경로로 내보내도 같다 — 승인분만 담고 "코드에 이미 있는 것"을 함께 센다', async () => {
    const { key, value } = realTranslatedKey('en');
    const state = emptyState({
      overrides: [
        overrideRow({ locale: 'en', key, status: TranslationOverrideStatus.APPROVED, draftValue: value }), // 코드와 같음
        overrideRow({ id: 'x2', locale: 'en', key: `${key}@문맥`, status: TranslationOverrideStatus.APPROVED, draftValue: '새 번역' }),
        overrideRow({ id: 'x3', locale: 'en', key: '없는키', status: TranslationOverrideStatus.PROPOSED, draftValue: '미승인' }),
      ],
    });
    const r = await makeService(state).exportText('en');
    expect(r.count).toBe(2); // 미승인은 담기지 않는다
    expect(r.alreadyInCode).toBe(1); // 🔴 분모 정직성 — 이미 코드에 있는 것을 "새로 반영할 것"처럼 세지 않는다
    const obj = compileAndRun(r.text);
    expect(obj.en[`${key}@문맥`]).toBe('새 번역');
    expect(r.text).not.toContain('미승인');
  });
});
