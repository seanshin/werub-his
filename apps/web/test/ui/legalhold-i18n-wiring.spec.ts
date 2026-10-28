import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **T10(보유·파기·보존명령·외부 전송) 신규 화면**의 UI 언어 배선 가드 (2026-09-13 · 카탈로그 `legalhold`).
 *
 * 실측 경위: `/admin/legal-hold` 는 스캐너 기준 `ko 0 · t 40` — **"배선 완료"로 보였다.**
 *   그런데 화면이 넘기는 36키 중 **28키가 어느 카탈로그에도 없었다** → 영어 화면에 원문+`EN×` 가 나갔다.
 *   🔴 배선 수(t)는 등재를 보증하지 않는다. 스캐너가 못 보는 그 틈을 (b) 가 막는다.
 *   `/admin/retention` 은 T10-10 두 기산점 집계가 건수를 `${n}건` 템플릿으로 찍고 있었다(4곳 · 단위 꼬리 한국어 고정).
 *
 * 못박는 것:
 *   (a) 화면별 ko·koExpr·t — **정확 일치**(여유 0 · 줄면 내리고 늘면 실패).
 *   (b) 화면이 i18n 층에 넘기는 한국어 키가 어느 카탈로그엔가 있다.
 *   (c) 🔴 고아 키 0 — legalhold 의 모든 키를 소유 화면이 실제로 넘긴다.
 *   (d) 🔴 죽은 키 0 — 앞 카탈로그가 가진 원문을 다시 정의하지 않는다.
 *   (e) 세 언어 키 집합 동일 · 빈 값 0 · 자리표시자 일치.
 *   (f) 🔴 retention 의 T10 건수 4곳이 `<Tf k="{건수}건">` 을 지난다 — 템플릿 `${…}건` 으로 되돌리면 실패.
 *   (g) 대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다.
 */

const ROOT = resolve(__dirname, '../../../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf-8');
const HAN = /[가-힣]/;

const OWNED = [
  '(main)/admin/legal-hold/page.tsx',
  '(main)/admin/retention/page.tsx',
  '(main)/admin/outbound-channels/EgressInventorySection.tsx',
];

/**
 * 2026-09-13 배선 후 실측(재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * 남은 `ko` 는 표시 문구가 아니다 — 라벨 맵 **정의**(`<T k={맵[x]}>` 로 렌더).
 * retention 의 `koExpr 4`(`건`·`건은`·`일(`·`일).`)는 T10 이전 코드(파기 승인 대기 배지·요청 확인 문장)다 — 이 갈래 밖.
 */
const BASELINE: Record<string, { ko: number; koExpr: number; t: number }> = {
  '(main)/admin/legal-hold/page.tsx': { ko: 0, koExpr: 0, t: 40 },
  // t 92→100(2026-09-23 D6): 기간 출처 배지·산출 불가 2종·분모 3종이 <T> 로 들어왔다. ko·koExpr 은 불변 = 새 원문 노출 0.
  '(main)/admin/retention/page.tsx': { ko: 7, koExpr: 4, t: 100 },
  '(main)/admin/outbound-channels/EgressInventorySection.tsx': { ko: 8, koExpr: 0, t: 12 },
};

function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  return [...new Set(['common.ts', ...files])];
}
const keysOf = (file: string) => catalogKeysOf(read(join(MSG, file))) as Set<string>;

const ORDER = registeredOrder();
const AT = ORDER.indexOf('legalhold.ts');
const MINE = keysOf('legalhold.ts');
const BEFORE = new Set<string>();
for (const f of ORDER.slice(0, AT)) for (const k of keysOf(f)) BEFORE.add(k);
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of keysOf(f)) ALL_KEYS.add(k);

function rowsOf(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'legalhold.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  const out: Array<{ key: string; v: string[] }> = [];
  for (const m of body.matchAll(/^ {2}'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)) {
    const vals = [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
    out.push({ key: m[1].replace(/\\'/g, "'"), v: vals });
  }
  return out;
}

function literals(expr: string): string[] {
  return [...expr.matchAll(/'((?:\\.|[^'\\\n])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))
    .concat([...expr.matchAll(/"((?:\\.|[^"\\\n])*)"/g)].map((m) => m[1]));
}
function usedKeys(file: string): Set<string> {
  const src = stripComments(read(join(APP, file)));
  const out = new Set<string>();
  const attrs = String.raw`(?:className=(?:"[^"]*"|\{[^{}]*\})\s+)?`;
  for (const m of src.matchAll(new RegExp(String.raw`<T\s+${attrs}k="((?:\\.|[^"\\])+)"`, 'g'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`<Tf\s+${attrs}[\s\S]{0,4}?k="((?:\\.|[^"\\])+)"`, 'g'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`<Tf?\s+${attrs}k=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}`, 'g'))) for (const l of literals(m[1])) out.add(l);
  for (const m of src.matchAll(/\bt(?:Attr|fAttr)\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) for (const l of literals(m[1])) out.add(l);
  for (const m of src.matchAll(/\blabel:\s*'((?:\\.|[^'\\\n])*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\b(?:title|hint)="([^"]*)"/g)) out.add(m[1]);
  return new Set([...out].map((k) => k.replace(/&quot;/g, '"')).filter((k) => HAN.test(k)));
}

const USED = OWNED.map((f) => ({ f, keys: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { keys } of USED) for (const k of keys) USED_ALL.add(k);

describe('🔴 T10 신규 화면 i18n 배선 (legalhold)', () => {
  it('(g) 대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(AT, 'registry 에서 legalhold 를 찾지 못했다').toBeGreaterThan(0);
    expect(MINE.size, 'legalhold 표 파싱이 깨졌다').toBeGreaterThan(20);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.has('활성 보존명령')).toBe(true); // <T k="…">
    expect(USED_ALL.has('보존명령을 설정했습니다')).toBe(true); // tAttr
    expect(USED_ALL.has('활성 보존명령이 없습니다')).toBe(true); // EmptyState title prop
    expect(USED_ALL.has('{건수}건')).toBe(true); // <Tf k="…">
    expect(USED_ALL.has('환자정보(PHI)')).toBe(true); // 라벨 맵 값
  });

  it('(a) 화면별 한글 잔여·식 옆 텍스트·배선 수가 기준선과 정확히 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number; koExpr: number; t: number }>;
    const actual: Record<string, { ko: number; koExpr: number; t: number }> = {};
    for (const f of OWNED) {
      const r = rows.find((x) => x.file === f)!;
      actual[f] = { ko: r.ko, koExpr: r.koExpr, t: r.t };
    }
    expect(actual).toEqual(BASELINE);
  });

  it('(b) 🔴 화면이 넘기는 한국어 키가 카탈로그에 있다 — 배선 수(t)만으로는 등재를 알 수 없다', () => {
    const missing: string[] = [];
    for (const { f, keys } of USED) for (const k of keys) if (!ALL_KEYS.has(k)) missing.push(`${f}: ${k}`);
    expect(missing, `미등록 키(원문+EN× 로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it('(c) 🔴 고아 키 0 — legalhold 의 모든 키를 소유 화면이 실제로 넘긴다', () => {
    const orphan = [...MINE].filter((k) => !USED_ALL.has(k));
    expect(orphan, `소유 화면이 부르지 않는 키:\n${orphan.join('\n')}`).toEqual([]);
  });

  it('(d) 🔴 죽은 키 0 — 앞 카탈로그가 이미 가진 원문을 다시 정의하지 않는다', () => {
    const dup = [...MINE].filter((k) => BEFORE.has(k));
    expect(dup, `앞 카탈로그와 중복:\n${dup.join('\n')}`).toEqual([]);
  });

  it('(e) 세 언어 키 집합 동일 · 빈 값 0 · 자리표시자 일치', () => {
    const rows = rowsOf();
    expect(rows.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(MINE.size);
    const bad: string[] = [];
    for (const { key, v } of rows) {
      if (v.length !== 3) { bad.push(`${key}: 언어 ${v.length}개`); continue; }
      if (v.some((x) => !x.trim())) bad.push(`${key}: 빈 값`);
      const want = [...key.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort().join(',');
      for (const [i, x] of v.entries()) {
        const got = [...x.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort().join(',');
        if (got !== want) bad.push(`${key}[${['en', 'ja', 'ar'][i]}]: 자리표시자 ${got || '(없음)'} ≠ ${want || '(없음)'}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('(f) 🔴 retention T10 건수 4곳이 `{건수}건` 을 지난다 — 템플릿 꼬리로 되돌리면 실패', () => {
    const src = stripComments(read(join(APP, '(main)/admin/retention/page.tsx')));
    for (const v of ['p.lastCandidates', 'r.candidates', 'r.candidatesByLastEncounterAt', 'k.total']) {
      const esc = v.replace(/\./g, '\\.');
      expect(src, `${v}: <Tf k="{건수}건"> 배선이 없다`).toMatch(new RegExp(String.raw`<Tf k="\{건수\}건" params=\{\{ 건수: ${esc} \}\} />`));
      expect(src, `${v}: 단위 꼬리가 한국어로 박혔다`).not.toMatch(new RegExp(String.raw`\{?\$?\{${esc}\}건`));
    }
  });
});
