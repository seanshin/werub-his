import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 배선 0 화면 16 의 UI 언어 배선 가드 (2026-09-11 §12 잔여 · 카탈로그 `admin11`).
 *    ai-oversight(page·parts) · codes 패널 6 · homepage CMS 8(centers·csr·departments·gallery·health-info·health-tv·news·recruit)
 *
 * 이 16화면은 스캐너 기준 `<T>`/`tAttr` 배선이 **0** 이었다 — 어떤 언어를 골라도 제목·표 머리·토스트·confirm·
 * 설명 문단이 전부 한국어였다. 부품 prop(`CountCard title`·`CategoryCmsPage title`)은 생문자열로 그려져
 * 카탈로그를 채워도 바뀌지 않는 자리였다.
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a)  화면별 한글 잔여 조각 수(스캐너 `ko`) — **정확 일치**(여유 0).
 *   (a') 화면별 식 옆 JSX 텍스트 조각 수(스캐너 `koExpr`) — **정확 일치**. `{n}건 중 {m}건` 류 문장 뼈대는 `ko` 가
 *        세지 않는다(§12-H ①) — 보간 키를 생한글 조각으로 되돌리면 여기서 걸린다.
 *   (b)  화면별 `<T>`/`tAttr`(스캐너 `t`) · `<Tf>`/`tfAttr` 보간 배선 수 — 하한(전 화면 > 0).
 *   (c)  화면이 i18n 층에 넘기는 한국어 키가 **어느 카탈로그엔가 있다**(없으면 `EN×` 거짓 티).
 *        정적 키 · 동적 키의 원천 리터럴(`<T k={조건 ? '…' : '…'}>`) · 라벨 맵 값 · 부품 prop(EmptyState·CountCard…)을 함께 본다.
 *   (c') 🔴 자리표시자(`{이름}`)가 든 키를 `<T>`/`tAttr` 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다.
 *        자리표시자 값을 가진 **라벨 맵**(`SOURCE_LABEL` 의 `{AI표기} 자동`)은 `tfAttr(맵[…]` 로만 소비된다.
 *   (d)  🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 admin11 이 다시 정의하지 않는다.
 *   (e)  🔴 고아 키 0 — admin11 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다.
 *   (f)  세 언어 키 집합 동일 · 빈 값 0 · 🔴 번역문이 키와 같은 자리표시자를 갖는다.
 *   (g)  🔴 admin11 의 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다.
 *   (h)  🔴 저장값은 번역하지 않는다 — option `value`·CMS subType `value` 가 `tAttr` 를 지나지 않는다.
 *
 * ko 출력의 글자 단위 동일성은 배선 시점에 HEAD 사본과 같은 픽스처로 16화면을 그려 대조했다(textContent·토스트 —
 * 공백 하나를 지우면 잡히는 것까지 확인). 그 대조는 사본이 필요해 여기 두지 않았다 — 이 가드는 **배선 형태**를 못박는다.
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를, 파서는 스캐너의 `catalogKeysOf` 를 쓴다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 */
const OWNED = [
  '(main)/admin/ai-oversight/page.tsx',
  '(main)/admin/ai-oversight/parts.tsx',
  '(main)/admin/codes/category-derive-panel.tsx',
  '(main)/admin/codes/code-detail-panel.tsx',
  '(main)/admin/codes/code-import-panel.tsx',
  '(main)/admin/codes/code-maintenance-panel.tsx',
  '(main)/admin/codes/code-search-notice.tsx',
  '(main)/admin/codes/code-synonym-panel.tsx',
  '(main)/admin/homepage/centers/page.tsx',
  '(main)/admin/homepage/csr/page.tsx',
  '(main)/admin/homepage/departments/page.tsx',
  '(main)/admin/homepage/gallery/page.tsx',
  '(main)/admin/homepage/health-info/page.tsx',
  '(main)/admin/homepage/health-tv/page.tsx',
  '(main)/admin/homepage/news/page.tsx',
  '(main)/admin/homepage/recruit/page.tsx',
] as const;

/**
 * 2026-09-11 배선 후 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * 배선 전: 16화면 전부 `t=0` · ko 합 283 · koExpr 합 44.
 * `ko` 에 남은 것(사유는 `packages/shared/src/i18n/messages/admin11.ts` 머리 주석 ①~④):
 *   · 부품 prop 원문(EmptyState·CountCard·RateCard·AxisTable 의 title/hint/subtitle) — 부품 **안에서** `<T>` 로 그린다
 *   · 라벨 맵 값(`KIND_LABEL`·`STATUS_LABEL`·`TABLES`·`SUB_TYPES` …) — `<T k={맵[x]}>`/`tAttr(맵[x])` 로 그린다
 *   · 데이터 예시(`맹장염`·`“벼락”`·`“일반 성인 의학적 검사”`)·CSV 형식 견본 placeholder — 의도적 미등재
 *   · 🔴 스캐너 오탐: `<Tf params={{ 가: <b/>, 나: <b/> }}>` 에서 `</b>, 나: <b` 사이의 `, 나:` 를 JSX 텍스트로 센다
 *     (code-import 1 · code-maintenance 3 · code-synonym 7) — 자리표시자 이름이 한글이라 생긴다. 표시 문구가 아니다.
 * `t` = `<T`·`<Tf` + `t(f)Attr(` 출현 수(스캐너) · `tf` = `<Tf` + `tfAttr(` 출현 수.
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 */
// (2026-09-11 §12-H) 스캐너가 노드 params 사이 객체 키(`, 나:`)를 텍스트로 세던 오탐을 걷었다 — import 10→9 · maintenance 9→7 · synonym 26→19
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; koExpr: number; t: number; tf: number }> = {
  '(main)/admin/ai-oversight/page.tsx': { ko: 21, koExpr: 0, t: 17, tf: 5 },
  '(main)/admin/ai-oversight/parts.tsx': { ko: 1, koExpr: 0, t: 37, tf: 10 },
  '(main)/admin/codes/category-derive-panel.tsx': { ko: 0, koExpr: 0, t: 21, tf: 6 },
  '(main)/admin/codes/code-detail-panel.tsx': { ko: 18, koExpr: 0, t: 31, tf: 12 },
  '(main)/admin/codes/code-import-panel.tsx': { ko: 9, koExpr: 0, t: 25, tf: 10 },
  // (2026-09-11) 건수 상수 '166,744' 를 문장에서 뺐다(시간이 지나면 거짓) — ko 10→9 · 안쪽 <Tf> 하나 제거 t 29→28·tf 15→14
  '(main)/admin/codes/code-maintenance-panel.tsx': { ko: 7, koExpr: 0, t: 28, tf: 14 },
  '(main)/admin/codes/code-search-notice.tsx': { ko: 5, koExpr: 0, t: 11, tf: 3 },
  '(main)/admin/codes/code-synonym-panel.tsx': { ko: 17, koExpr: 0, t: 40, tf: 6 },
  '(main)/admin/homepage/centers/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
  '(main)/admin/homepage/csr/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
  '(main)/admin/homepage/departments/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
  '(main)/admin/homepage/gallery/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
  '(main)/admin/homepage/health-info/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
  '(main)/admin/homepage/health-tv/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
  '(main)/admin/homepage/news/page.tsx': { ko: 4, koExpr: 0, t: 3, tf: 0 },
  '(main)/admin/homepage/recruit/page.tsx': { ko: 0, koExpr: 0, t: 2, tf: 0 },
};

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

/** registry.ts 가 `registerCatalog` 로 등록하는 순서 — `t()` 의 우선순위 정본 */
function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // 🔴 common 은 t.ts 가 직접 등록한다(registry 에 registerCatalog 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}

/** 파서 정본은 스캐너(`catalogKeysOf` — 네 표기) — 가드마다 두면 표기 하나를 빠뜨려 갈라진다(§12-H ③) */
const keysOf = (file: string, dir = MSG) => catalogKeysOf(read(join(dir, file))) as Set<string>;

/** 추가 언어 팩(zh·ru·vi·kk·mn·th) — 등재부 `packs/index.ts` 에서 파생(수기 목록 금지) */
const PACKS_DIR = join(ROOT, 'packages/shared/src/i18n/packs');
function packFiles(): string[] {
  const idx = read(join(PACKS_DIR, 'index.ts'));
  return [...new Set([...idx.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`))];
}

/** admin11 의 [en, ja, ar] 튜플 — 세 언어 대조용 */
function admin11Rows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'admin11.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1].replace(/\\'/g, "'"),
    v: [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'")),
  }));
}

/* ── 화면 소스에서 i18n 층으로 넘어가는 키 추출 ────────────────────────────── */

/** `name(` 호출의 괄호 안 전체(중첩 괄호 포함) */
function callBodies(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${name}\\(`, 'g');
  for (const m of src.matchAll(re)) {
    let i = m.index! + m[0].length;
    let depth = 1;
    const start = i;
    let q: string | null = null;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}
/** 문자열 리터럴 — 작은/큰따옴표 모두, 소스 순서대로 */
function literals(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g)) {
    out.push(m[1] !== undefined ? m[1].replace(/\\'/g, "'") : m[2]);
  }
  return out;
}

const HAN = /[가-힣]/;
const PARAM = /\{([^{}\s]+)\}/g;
const paramsOf = (s: string) => [...s.matchAll(PARAM)].map((m) => m[1]).sort();

/**
 * plain  = `<T k>`·`tAttr(` 로 부르는 키(자리표시자가 있으면 안 된다)
 * interp = `<Tf k>`·`tfAttr(` 로 부르는 키
 * label  = 라벨 맵 값·부품 prop 원문 — 존재·고아 검사에만 쓴다(소비 방식은 (c') 의 맵 검사가 따로 본다)
 */
interface Used { plain: Set<string>; interp: Set<string>; label: Set<string>; all: Set<string> }
function usedKeys(file: string): Used {
  const src = stripComments(read(join(APP, file)));
  const plain = new Set<string>();
  const interp = new Set<string>();
  const label = new Set<string>();
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k="((?:\\.|[^"\\])+)"/g)) plain.add(m[1]);
  for (const m of src.matchAll(/<Tf\s+(?:className="[^"]*"\s+)?k="((?:\\.|[^"\\])+)"/g)) interp.add(m[1]);
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) plain.add(l);
  for (const b of callBodies(src, 'tAttr')) for (const l of literals(b)) plain.add(l);
  for (const b of callBodies(src, 'tfAttr')) { const l = literals(b)[0]; if (l) interp.add(l); }
  // 라벨 맵·목록 리터럴(`equivalent: '동등@매핑'`·`label: '진단'`) — 소유 16화면에서 한글 값을 가진 `이름: '…'` 은 전부 i18n 키다(실측)
  for (const m of src.matchAll(/\b[A-Za-z_]+:\s*'((?:\\.|[^'\\\n])*)'/g)) label.add(m[1].replace(/\\'/g, "'"));
  // 부품 prop — EmptyState/CountCard/RateCard/AxisTable 의 title·hint·subtitle·emptyHint, Ratio 의 unavailableHint
  for (const m of src.matchAll(/\b(?:title|hint|subtitle|emptyHint|unavailableHint|label)="([^"]*)"/g)) label.add(m[1]);
  /**
   * 🔴 **중괄호 한 겹을 넘는다.** 종전 `[^{}]*?` 는 값 안에 중첩 중괄호가 생기면 통째로 놓쳤다 —
   *    서버 사유를 `<Data>{x}</Data>` 로 감싸자(2026-09-12 거짓 `EN×` 회수) `관측 0건` 폴백 키가
   *    추출에서 사라져 "고아 키"로 잡혔다. `<T k={…}>` 규칙(위)과 같은 깊이를 허용한다.
   */
  for (const m of src.matchAll(/\b(?:unavailableHint|title|hint)=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) for (const l of literals(m[1])) label.add(l);
  const keep = (s: Set<string>) => new Set([...s].filter((k) => HAN.test(k)));
  const p = keep(plain);
  const i = keep(interp);
  const l = keep(label);
  return { plain: p, interp: i, label: l, all: new Set([...p, ...i, ...l]) };
}

const tfCount = (file: string) => {
  const noc = stripComments(read(join(APP, file)));
  return (noc.match(/<Tf[\s>]/g) || []).length + (noc.match(/\btfAttr\(/g) || []).length;
};

const ORDER = registeredOrder();
const AT = ORDER.indexOf('admin11.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = admin11Rows();
const USED = OWNED.map((f) => ({ f, u: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { u } of USED) for (const k of u.all) USED_ALL.add(k);
const short = (f: string) => f.split('/').slice(2).join('/');

describe('🔴 배선 0 화면 16 i18n 배선 (admin11)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(AT, 'registry 에서 admin11 을 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(ROWS.length, 'admin11 표 파싱이 깨졌다').toBeGreaterThan(200);
    expect(ROWS.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(CAT.get('admin11.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(250);
    // 추출기 대조군 — 경로마다 실제로 잡는다
    expect(USED_ALL.has('앞 200건만 표시했습니다 — 전체 {전체}건')).toBe(true); // <Tf k>
    expect(USED_ALL.has('전체 {전체}건 · 이번 장 {이번}건 (한 장 {한장}건)')).toBe(true); // 여러 줄 <Tf\n k>
    expect(USED_ALL.has('{종류} {수}건을 시행일 {시행일} 로 반영합니다. 진행할까요?')).toBe(true); // tfAttr(confirm)
    expect(USED_ALL.has('CSV 내보내기')).toBe(true); // <T k={조건식}>
    expect(USED_ALL.has('채용정보 관리')).toBe(true); // tAttr → 부품 prop
    expect(USED_ALL.has('동등@매핑')).toBe(true); // 라벨 맵 값
    expect(USED_ALL.has('승인·수정량 미측정')).toBe(true); // CountCard title prop
    expect(USED_ALL.has('표본 0')).toBe(true); // unavailableHint={hint ?? '…'}
  });

  it('(a) 화면별 한글 잔여(스캐너 `ko`)가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.ko]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko])));
  });

  it("🔴 (a') 식 옆 JSX 텍스트(스캐너 `koExpr`)도 **정확히** 일치한다 — 보간 키를 생한글 조각으로 되돌리면 여기서 걸린다", () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; koExpr: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.koExpr]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].koExpr])));
  });

  it('(b) 화면마다 <T>/tAttr 배선과 <Tf>/tfAttr 보간 배선이 기준선 이상이다(전 화면 배선 > 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number }>;
    for (const f of OWNED) {
      const t = rows.find((r) => r.file === f)!.t;
      expect(t, `${f} 배선이 0 이다(원래 상태로 되돌아갔다)`).toBeGreaterThan(0);
      expect(t, `${f} <T>/tAttr 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
      expect(tfCount(f), `${f} 보간 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].tf);
    }
    // 하한이 0 이면 이 검사는 아무것도 보증하지 않는다
    expect(OWNED.filter((f) => BASELINE[f].tf > 0).length, '보간 배선 하한이 전부 0').toBeGreaterThanOrEqual(8);
  });

  it('(c) 화면이 i18n 층에 넘기는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const missing: string[] = [];
    for (const { f, u } of USED) for (const k of u.all) if (!ALL_KEYS.has(k)) missing.push(`${short(f)}: ${k}`);
    expect(missing.sort(), `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it("🔴 (c') 자리표시자가 든 키를 <T>/tAttr 로 부르지 않는다 · 자리표시자 라벨 맵은 tfAttr 로만 소비한다", () => {
    const bad: string[] = [];
    for (const { f, u } of USED) for (const k of u.plain) if (paramsOf(k).length) bad.push(`${short(f)}: ${k}`);
    expect(bad, `<Tf>/tfAttr 로 옮겨야 하는 자리:\n${bad.join('\n')}`).toEqual([]);
    // 자리표시자 값을 가진 라벨 맵 — 맵 이름을 소스에서 찾아 소비 방식을 본다
    const mapBad: string[] = [];
    let placeholderMaps = 0;
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      for (const m of src.matchAll(/const\s+([A-Z_]+)\s*:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\};/g)) {
        const vals = literals(m[2]).filter((v) => HAN.test(v));
        if (!vals.some((v) => paramsOf(v).length)) continue;
        placeholderMaps++;
        const name = m[1];
        if (new RegExp(`\\btAttr\\(${name}\\[`).test(src) || new RegExp(`<T\\s+k=\\{${name}\\[`).test(src)) mapBad.push(`${short(f)}: ${name} 을 <T>/tAttr 로 부른다`);
        if (!new RegExp(`\\btfAttr\\(${name}\\[`).test(src)) mapBad.push(`${short(f)}: ${name} 을 tfAttr 로 부르는 자리가 없다`);
      }
    }
    expect(mapBad).toEqual([]);
    expect(placeholderMaps, '자리표시자 라벨 맵 대조군(code-detail SOURCE_LABEL)이 0').toBeGreaterThanOrEqual(1);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 admin11 이 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, AT);
    const dead = [...CAT.get('admin11.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — admin11 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다', () => {
    const orphan = ROWS.map((r) => r.key).filter((k) => !USED_ALL.has(k)).sort();
    expect(orphan, `소유 화면이 부르지 않는 키:\n${orphan.join('\n')}`).toEqual([]);
    // `@` 로 시작하는 키는 표시 원문이 빈 문자열이 된다 — 어떤 검사든 빠져나가는 형태라 따로 막는다(§12-F ③)
    expect(ROWS.filter((r) => r.key.lastIndexOf('@') === 0).map((r) => r.key)).toEqual([]);
  });

  it('(f) 세 언어 키 집합이 같고 빈 값이 없으며, 🔴 번역문이 키와 같은 자리표시자를 갖는다', () => {
    const bad = ROWS.filter((r) => r.v.length !== 3 || r.v.some((x) => !x.trim())).map((r) => r.key);
    expect(bad, `en/ja/ar 중 빠지거나 빈 값:\n${bad.join('\n')}`).toEqual([]);
    const lost: string[] = [];
    for (const r of ROWS) {
      const want = paramsOf(r.key).join(',');
      r.v.forEach((x, i) => { if (paramsOf(x).join(',') !== want) lost.push(`${['en', 'ja', 'ar'][i]}: ${r.key} → ${x}`); });
    }
    expect(lost, `자리표시자가 어긋난 번역(값이 사라지거나 {이름} 이 그대로 찍힌다):\n${lost.join('\n')}`).toEqual([]);
    expect(ROWS.filter((r) => paramsOf(r.key).length).length, '보간 키 대조군이 0').toBeGreaterThan(50);
  });

  it('🔴 (g) admin11 의 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다(팩은 이 갈래 소유가 아니다)', () => {
    const files = packFiles();
    expect(files.length, '팩 등재부 파싱이 깨졌다').toBeGreaterThanOrEqual(6);
    const packKeys = new Map(files.map((f) => [f, keysOf(f, PACKS_DIR)]));
    for (const [f, ks] of packKeys) expect(ks.size, `${f} 키 파싱이 깨졌다`).toBeGreaterThan(300);
    const gaps: string[] = [];
    let contextKeys = 0;
    for (const { key } of ROWS) {
      const at = key.lastIndexOf('@');
      if (at <= 0) continue;
      contextKeys++;
      const bare = key.slice(0, at);
      for (const [f, ks] of packKeys) if (ks.has(bare) && !ks.has(key)) gaps.push(`${f}: ${key}`);
    }
    expect(gaps, `팩 결손을 만드는 문맥 키(팩과 함께 하거나 문맥 키를 쓰지 않는다):\n${gaps.join('\n')}`).toEqual([]);
    expect(contextKeys, '문맥 키 대조군(`시행일@고시`)이 0').toBeGreaterThanOrEqual(1);
    // 대조군 — 결손 판정기가 살아 있다: 이미 알려진 결손(`판정@검사`)을 이 판정기도 본다
    expect([...packKeys.values()].some((ks) => ks.has('판정') && !ks.has('판정@검사'))).toBe(true);
  });

  it('🔴 (h) 저장값은 번역하지 않는다 — option value·CMS subType value 가 tAttr 를 지나지 않는다', () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      if (/\bvalue=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value={tAttr(…)}`);
      if (/\bvalue:\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value: tAttr(…)`);
    }
    expect(bad).toEqual([]);
    // 대조군 — news 의 유형 라벨은 번역하고 value 는 그대로 넘긴다(이 형태가 사라지면 검사 대상이 없다)
    const news = stripComments(read(join(APP, '(main)/admin/homepage/news/page.tsx')));
    expect(news).toMatch(/value:\s*s\.value,\s*label:\s*tAttr\(s\.label\)/);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED) 를 코드가 임의로 선언하지 않는다', () => {
    expect(read(join(MSG, 'admin11.ts'))).toMatch(/ADMIN11_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'admin11.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '중복 회피를 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(block, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(block, '서버 조립 문장을 적지 않았다').toMatch(/서버가 조립한 문장은 등재하지 않았다/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
    // 🔴 데이터 예시(검색어·코드명)를 번역하지 않은 이유는 이름을 대고 남긴다 — 잊히면 누군가 "번역 누락"으로 채운다
    expect(block).toContain('맹장염');
    expect(block).toContain('CategoryCmsPage');
  });
});
