import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORMULARY_PRESETS } from '@hospital-run/shared';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, stripI18nKeys, koFragments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 운영·행정 화면 2 의 UI 언어 배선 가드 (2026-09-11 §12-B · 카탈로그 `admin10`).
 *    facility · him · extensions · drug-explain · formulary · blockchain-cert · analytics · dashboard-templates
 *
 * 이 축의 결함은 "카탈로그가 비어서"가 아니라 **문장이 i18n 층을 지나지 않아서** 생겼다 —
 * 토스트·confirm·보간 문장(`총 {N}병상`·`등재 {N}건 중 실제 설치 {M}건.`)·부품 prop(SummaryCard label)이
 * 생문자열로 렌더돼 어떤 언어를 골라도 한국어였다. 그리고 숫자+단위를 `${n}${tAttr('건')}` 조각으로
 * 배선한 자리는 영어에서 `12items` 가 됐다(`1750people` 과 같은 결함).
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a)  화면별 한글 잔여 조각 수 — 스캐너 정본 수와 **정확 일치**(여유 0).
 *   (a') 🔴 같은 수를 **보간 키까지 걷어내고** 다시 센 값 — 정확 일치.
 *        스캐너의 `stripI18nKeys` 는 `<T k>`·`tAttr(` 만 걷고 `<Tf k>`·`tfAttr(` 는 걷지 않는다(2026-09-11 실측).
 *        그래서 (a) 는 보간 배선을 **잔여로 센다** — 보간으로 옮기면 (a) 가 오히려 오른다. (a) 만 두면
 *        "보간 키를 생한글로 되돌려도" 수가 같게 남는 자리가 생긴다. (a') 가 그 구멍을 막는다.
 *   (b)  화면별 `<T>`/`tAttr` 배선 수(스캐너) · `<Tf>`/`tfAttr` 보간 배선 수 — 하한.
 *   (c)  화면이 i18n 층에 넘기는 **한국어 키가 어느 카탈로그엔가 있다**(없으면 `EN×` 거짓 티).
 *        정적 키(`<T k="…">`·`tAttr('…')`·`<Tf k="…">`·`tfAttr('…')`)와 **동적 키의 원천 리터럴**
 *        (`<T k={조건 ? '…' : '…'}>` 안의 리터럴 · 라벨 맵 값 · EmptyState/Section 의 title·hint)을 함께 본다.
 *   (c') 🔴 자리표시자(`{이름}`)가 든 키를 `<T>`/`tAttr` 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다.
 *   (d)  🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 admin10 이 다시 정의하지 않는다.
 *   (e)  🔴 고아 키 0 — admin10 의 모든 키가 소유 화면이 **i18n 층에 실제로 넘기는 키**다(원문이 소스 어딘가에
 *        있다는 것만으로는 부족하다 — `생성@시각` 의 `생성` 은 아무 데나 있다).
 *   (f)  세 언어 키 집합 동일 · 빈 값 0 · 🔴 **번역문이 키와 같은 자리표시자를 갖는다**
 *        (하나를 빠뜨리면 그 값이 조용히 사라진다 — `{설치} of {등재}` 에서 `{등재}` 를 잃는 식).
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를 읽어서 만든다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 */
const OWNED = [
  '(main)/admin/facility/page.tsx',
  '(main)/admin/him/page.tsx',
  '(main)/admin/extensions/page.tsx',
  '(main)/admin/drug-explain/page.tsx',
  '(main)/admin/formulary/page.tsx',
  '(main)/admin/blockchain-cert/page.tsx',
  '(main)/admin/analytics/page.tsx',
  '(main)/admin/dashboard-templates/page.tsx',
  // 2026-09-14 R5 — 포뮬러리 CSV 일괄 등재 패널(formulary 화면의 하위 부품)
  '(main)/admin/formulary/FormularyCsvImport.tsx',
] as const;

/**
 * 2026-09-11 배선 후 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / rows[].t).
 * `ko`   = 스캐너가 센 남은 한글 조각(유니크) — 보간 키를 잔여로 세는 수(위 (a') 참조).
 * `koTf` = 같은 규칙에 `<Tf k>`·`tfAttr(` 키까지 걷어낸 잔여 — **표시 문구의 상한**이다. 여기 남은 것은
 *          `<T k={맵[x]}>` 로 배선된 라벨 맵 정의·저장값(안건 본문)·법령 표기·`<b>`/`<Unit>` 이 걸린 문장
 *          (사유는 `packages/shared/src/i18n/messages/admin10.ts` 머리 주석 ①~⑤).
 * `t`    = `<T` + `tAttr(` 출현 수(스캐너) · `tf` = `<Tf` + `tfAttr(` 출현 수.
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 */
// (2026-09-11 §12-H) 스캐너가 `<Tf>`/`tfAttr` 키를 벗기게 되면서 스캐너 `ko` 가 이 가드의 `koTf` 와 **8화면 전부 같아졌다**
//    — 독립된 두 계측이 일치한 것이다. `ko` 는 낮췄고, `koTf` 는 스캐너가 다시 틀어질 때를 대비한 대조로 남긴다.
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; koTf: number; t: number; tf: number }> = {
  '(main)/admin/facility/page.tsx': { ko: 7, koTf: 7, t: 26, tf: 5 },
  '(main)/admin/him/page.tsx': { ko: 6, koTf: 6, t: 19, tf: 4 },
  '(main)/admin/extensions/page.tsx': { ko: 3, koTf: 3, t: 12, tf: 1 },
  '(main)/admin/drug-explain/page.tsx': { ko: 4, koTf: 4, t: 25, tf: 5 },
  // 2026-09-14 R5 — 프리셋 목록(치료 18·활동 17 이름)을 shared `FORMULARY_PRESETS` 정본으로 옮겨 이 화면의 한글 리터럴 35 가 빠졌다(50→15). 이름은 여전히 <T k={p.name}> 로 넘긴다.
  '(main)/admin/formulary/page.tsx': { ko: 15, koTf: 15, t: 94, tf: 16 },
  // CSV 패널 — 남은 13 은 오류 사유·판정 라벨 맵 정의(<T k={맵[x]}> 로 렌더)
  '(main)/admin/formulary/FormularyCsvImport.tsx': { ko: 13, koTf: 13, t: 19, tf: 3 },
  '(main)/admin/blockchain-cert/page.tsx': { ko: 83, koTf: 83, t: 266, tf: 10 },
  '(main)/admin/analytics/page.tsx': { ko: 39, koTf: 39, t: 77, tf: 8 },
  '(main)/admin/dashboard-templates/page.tsx': { ko: 8, koTf: 8, t: 27, tf: 2 },
};

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

/** registry.ts 가 `registerCatalog` 로 등록하는 순서 — `t()` 의 우선순위 정본 */
function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // 🔴 common 은 t.ts 가 직접 등록한다(registry 에 registerCatalog 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}

/**
 * 카탈로그 파일의 키 집합 — 네 가지 표기(`'키': […]`·`['키', …]`·`"키": […]`·`["키", …]`)를 모두 읽는다.
 * 🔴 큰따옴표 키를 빼먹으면 죽은 키 검사가 **조용히 통과한다**(2026-09-11 실측: admin7 의
 *    `"왼쪽에서 등재하거나 '사용 실적 일괄 등재'를 실행하세요"` 를 이 갈래가 사본으로 등재했는데
 *    작은따옴표만 읽던 대조가 못 보고, shared 충돌 가드가 잡았다).
 */
function keysOf(file: string, dir = MSG): Set<string> {
  // 파서 정본은 스캐너(`catalogKeysOf`) — 가드마다 두면 표기 하나를 빠뜨려 갈라진다(§12-H)
  return catalogKeysOf(read(join(dir, file)));
}

/** 추가 언어 팩(zh·ru·vi·kk·mn·th) — 등재부 `packs/index.ts` 에서 파생(수기 목록 금지) */
const PACKS_DIR = join(ROOT, 'packages/shared/src/i18n/packs');
function packFiles(): string[] {
  const idx = read(join(PACKS_DIR, 'index.ts'));
  return [...new Set([...idx.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`))];
}

/**
 * 🔴 의도적 미등재 — 화면은 i18n 층에 넘기지만 **일부러** 카탈로그에 넣지 않은 키.
 *    문맥 키인데 등재하면 추가 언어 팩에 문맥 결손을 만들고(팩은 이 갈래 소유가 아니다),
 *    맨 키로 바꾸면 뜻이 거짓이 된다 → 원문+EN× 로 두는 것이 정직하다(사유: admin10.ts 머리 주석 ⑥).
 *    집합이 늘거나 줄면 실패한다 — 조용히 등재되는 것도, 새로 미등재가 느는 것도 드러난다.
 */
const INTENTIONALLY_UNREGISTERED = ['사용중@처방집'];

/** admin10 의 [en, ja, ar] 튜플 — 세 언어 대조용 */
function admin10Rows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'admin10.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1].replace(/\\'/g, "'"),
    v: [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'")),
  }));
}

/* ── 화면 소스에서 i18n 층으로 넘어가는 키 추출 ────────────────────────────── */

/** `name(` 호출의 괄호 안 전체(중첩 괄호 포함) — `tAttr(ROLES.find((r) => …)?.l ?? x)` 같은 자리 */
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
/** 문자열 리터럴 — 작은/큰따옴표 모두, **소스 순서대로**(키에 `'` 가 든 원문을 큰따옴표로 쓴 자리가 있다.
 *  따옴표 종류별로 따로 훑으면 `"'{항목}' 을(를)…"` 안의 `'{항목}'` 을 첫 리터럴로 잘못 집는다) */
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

interface Used { plain: Set<string>; interp: Set<string>; all: Set<string> }
function usedKeys(file: string): Used {
  const src = stripComments(read(join(APP, file)));
  const plain = new Set<string>();
  const interp = new Set<string>();
  // 정적 키
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k="((?:\\.|[^"\\])+)"/g)) plain.add(m[1]);
  for (const m of src.matchAll(/<Tf\s+(?:className="[^"]*"\s+)?k="((?:\\.|[^"\\])+)"/g)) interp.add(m[1]);
  // 동적 키 — `<T k={…}>` 안의 리터럴(조건식 양쪽)
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) plain.add(l);
  // tAttr(…) / tfAttr(…) — 첫 인자와 조건식 안의 리터럴. tfAttr 는 params 객체 뒤를 보지 않는다(첫 리터럴만)
  for (const b of callBodies(src, 'tAttr')) for (const l of literals(b)) plain.add(l);
  for (const b of callBodies(src, 'tfAttr')) { const l = literals(b)[0]; if (l) interp.add(l); }
  // 라벨 맵·목록 리터럴 — 전부 `<T k={x.label}>`/`tAttr(맵[x])` 로 렌더된다(소유 8화면 실측).
  //   🔴 `law:`(법령 표기)·`key:`·`v:`(코드값)은 여기 넣지 않는다 — 번역 대상이 아니다.
  for (const m of src.matchAll(/\b(?:label|desc|name|q|a|doc|staff|patient|multi|l|[A-Z][A-Z_]+):\s*'((?:\\.|[^'\\\n])*)'/g)) plain.add(m[1].replace(/\\'/g, "'"));
  // 프리셋 이름 — shared `FORMULARY_PRESETS` 정본을 가져와 `<T k={p.name}>` 로 넘기는 화면(formulary). 정본에서 파생한다(수기 목록 금지).
  if (/\bFORMULARY_PRESETS\b/.test(src)) for (const list of Object.values(FORMULARY_PRESETS)) for (const p of list) plain.add(p.name);
  // `['…', '…'].map(tAttr)` — 배열 리터럴을 통째로 넘기는 자리(analytics 청구 막대 라벨)
  for (const m of src.matchAll(/\[([^\[\]]*)\]\.map\(tAttr\)/g)) for (const l of literals(m[1])) plain.add(l);
  // 부품 prop — EmptyState/Section/ListSection title·hint, SummaryCard label·changeSuffix, Ratio unavailableHint
  for (const m of src.matchAll(/\b(?:title|hint|label|changeSuffix|unavailableHint)="([^"]*)"/g)) plain.add(m[1]);
  const keep = (s: Set<string>) => new Set([...s].filter((k) => HAN.test(k)));
  const p = keep(plain);
  const i = keep(interp);
  return { plain: p, interp: i, all: new Set([...p, ...i]) };
}

const tfResidual = (file: string) => {
  const noc = stripComments(read(join(APP, file)));
  const s = noc
    .replace(/<Tf\s+(?:className="[^"]*"\s+)?k=(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, '<Tf k=""')
    .replace(/tfAttr\(\s*(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, 'tfAttr(');
  return koFragments(stripI18nKeys(s)).size;
};
const tfCount = (file: string) => {
  const noc = stripComments(read(join(APP, file)));
  return (noc.match(/<Tf[\s>]/g) || []).length + (noc.match(/\btfAttr\(/g) || []).length;
};

const ORDER = registeredOrder();
const AT = ORDER.indexOf('admin10.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = admin10Rows();
const USED = OWNED.map((f) => ({ f, u: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { u } of USED) for (const k of u.all) USED_ALL.add(k);

describe('🔴 운영·행정 화면 2 i18n 배선 (admin10)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(AT, 'registry 에서 admin10 을 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(ROWS.length, 'admin10 표 파싱이 깨졌다').toBeGreaterThan(150);
    expect(ROWS.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(CAT.get('admin10.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(400);
    // 추출기 대조군 — 보간 키·동적 리터럴·큰따옴표 키를 실제로 잡는다
    expect(USED_ALL.has('병동/병상 현황 (총 {병상}병상)')).toBe(true); // <Tf k>
    expect(USED_ALL.has('책임자 {수}명에게 독촉 알림 발송')).toBe(true); // tfAttr
    expect(USED_ALL.has('앵커링 완료')).toBe(true); // <T k={조건식}>
    expect(USED_ALL.has("'{항목}' 을(를) 처방집에서 제거할까요?")).toBe(true); // 큰따옴표 tfAttr
    expect(USED_ALL.has('등록된 병동이 없습니다')).toBe(true); // EmptyState title
  });

  it('(a) 화면별 한글 잔여(스캐너 정본)가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.ko]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko])));
  });

  it("🔴 (a') 보간 키까지 걷어낸 잔여도 **정확히** 일치한다 — 보간 배선을 생한글로 되돌리면 여기서 걸린다", () => {
    const actual = Object.fromEntries(OWNED.map((f) => [f, tfResidual(f)]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].koTf])));
  });

  it('(b) 화면마다 <T>/tAttr 배선과 <Tf>/tfAttr 보간 배선이 기준선 이상이다', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number }>;
    for (const f of OWNED) {
      expect(rows.find((r) => r.file === f)!.t, `${f} <T>/tAttr 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
      expect(tfCount(f), `${f} 보간 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].tf);
    }
    // 하한이 0 이면 이 검사는 아무것도 보증하지 않는다
    expect(OWNED.filter((f) => BASELINE[f].tf > 0).length, '보간 배선 하한이 전부 0').toBeGreaterThanOrEqual(7);
  });

  it('(c) 화면이 i18n 층에 넘기는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const missing: string[] = [];
    for (const { f, u } of USED) {
      for (const k of u.all) {
        if (!ALL_KEYS.has(k) && !INTENTIONALLY_UNREGISTERED.includes(k)) missing.push(`${f.split('/')[2]}: ${k}`);
      }
    }
    expect(missing.sort(), `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
    // 의도적 미등재 집합 — 화면이 실제로 부르고(=배선돼 있고) 어느 카탈로그에도 없다. 늘거나 줄면 실패.
    expect(INTENTIONALLY_UNREGISTERED.filter((k) => USED_ALL.has(k) && !ALL_KEYS.has(k))).toEqual(INTENTIONALLY_UNREGISTERED);
  });

  it("🔴 (c') 자리표시자가 든 키를 <T>/tAttr 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다", () => {
    const bad: string[] = [];
    for (const { f, u } of USED) for (const k of u.plain) if (paramsOf(k).length) bad.push(`${f.split('/')[2]}: ${k}`);
    expect(bad, `<Tf>/tfAttr 로 옮겨야 하는 자리:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 admin10 이 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, AT);
    const dead = [...CAT.get('admin10.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — admin10 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다', () => {
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
    expect(ROWS.filter((r) => paramsOf(r.key).length).length, '보간 키 대조군이 0').toBeGreaterThan(30);
  });

  it('🔴 (g) admin10 의 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다(팩은 이 갈래 소유가 아니다)', () => {
    // 코어가 `원문@문맥` 을 새로 가지면, 무문맥 `원문` 만 가진 팩에서 그 자리가 결손이 된다
    // (shared `packContextGaps` · 가드 i18n-coverage-honesty GAP_BASELINE). 팩을 못 채우는 갈래는 만들지 않는다.
    const files = packFiles();
    expect(files.length, '팩 등재부 파싱이 깨졌다').toBeGreaterThanOrEqual(6);
    const packKeys = new Map(files.map((f) => [f, keysOf(f, PACKS_DIR)]));
    for (const [f, ks] of packKeys) expect(ks.size, `${f} 키 파싱이 깨졌다`).toBeGreaterThan(300);
    const gaps: string[] = [];
    for (const { key } of ROWS) {
      const at = key.lastIndexOf('@');
      if (at <= 0) continue;
      const bare = key.slice(0, at);
      for (const [f, ks] of packKeys) if (ks.has(bare) && !ks.has(key)) gaps.push(`${f}: ${key}`);
    }
    expect(gaps, `팩 결손을 만드는 문맥 키(팩과 함께 하거나 문맥 키를 쓰지 않는다):\n${gaps.join('\n')}`).toEqual([]);
    // 대조군 — 결손 판정기가 살아 있다: 이미 알려진 결손(`판정@검사`)을 이 판정기도 본다
    expect([...packKeys.values()].some((ks) => ks.has('판정') && !ks.has('판정@검사'))).toBe(true);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED) 를 코드가 임의로 선언하지 않는다', () => {
    expect(read(join(MSG, 'admin10.ts'))).toMatch(/ADMIN10_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'admin10.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '중복 회피를 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(block, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
    // 🔴 정직성 문구 두 개(<b> 가 걸려 못 옮긴 것)는 이름을 대고 남겨 둔다 — 잊히면 영원히 한국어다
    expect(block).toContain('확인 불가');
    expect(block).toContain('표시 전용');
  });
});
