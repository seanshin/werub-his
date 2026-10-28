import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 협진·전원·청구·접수 화면 17 의 UI 언어 배선 가드 (2026-09-12 §12 잔여 · 카탈로그 `collab2`).
 *    mdt · consult(desk·lead·admin) · consultations(목록·의뢰서·의뢰폼) · transfer(4) ·
 *    claims/[id](상세·삭감조정) · reception 자격조회 모달 · schedule/new · handoffs 폼 · rounds
 *
 * 이 17화면은 어떤 언어를 골라도 제목·표 머리·토스트·confirm·placeholder 가 전부 한국어였다.
 * 배선만으로는 화면이 바뀌지 않는다 — 카탈로그에 키가 없으면 `EN×` 티를 단 한국어가 그대로 나간다.
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a)  화면별 한글 잔여 조각 수(스캐너 `ko`) — **정확 일치**(여유 0).
 *   (a') 화면별 식 옆 JSX 텍스트 조각 수(스캐너 `koExpr`) — **정확 일치**.
 *        🔴 전 화면 0 이다. 문장을 `<T k="대기 중 "/>{n}<T k="건"/>` 처럼 **조각으로 되돌리면** 여기서 걸린다.
 *   (b)  화면별 `<T>`/`tAttr` 배선 수 · `<Tf>`/`tfAttr` 보간 배선 수 — 하한(전 화면 > 0).
 *   (c)  화면이 i18n 층에 넘기는 한국어 키가 **어느 카탈로그엔가 있다** — 단 아래 `UNREGISTERED` 3키만 예외이고,
 *        그 집합은 **정확 일치**다(말없이 늘리거나, 등재하면서 지우지 않는 것 둘 다 실패한다).
 *   (c') 🔴 자리표시자(`{이름}`)가 든 키를 `<T>`/`tAttr` 로 부르지 않는다 — 보간 없이 `{건수}` 가 그대로 찍힌다.
 *        자리표시자가 든 **라벨 목록**(consult/lead 통계 라벨)은 `<Tf k={…}>` 로만 소비한다.
 *   (d)  🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 collab2 가 다시 정의하지 않는다.
 *   (e)  🔴 고아 키 0 — collab2 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다.
 *   (f)  세 언어 키 집합 동일 · 빈 값 0 · 🔴 번역문이 키와 같은 자리표시자를 갖는다.
 *   (g)  🔴 collab2 는 문맥 키(`원문@문맥`)를 만들지 않는다 — 추가 언어 팩에 문맥 결손을 만들지 않기 위해서다.
 *   (h)  🔴 저장값·전송값은 번역하지 않는다 — `<option value>`·제안 원장 `clientContext` 가 `tAttr` 를 지나지 않는다.
 *   (i)  🔴 자가번역 부품(EmptyState·Ratio)에는 **생키**를 넘긴다 — `tAttr()` 로 미리 번역해 넘기면 부품 안에서 두 번 찾는다.
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를, 파서는 스캐너의 `catalogKeysOf` 를 쓴다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 */
const OWNED = [
  '(main)/mdt/page.tsx',
  '(main)/consult/page.tsx',
  '(main)/consult/lead/page.tsx',
  '(main)/consult/admin/page.tsx',
  '(main)/consultations/page.tsx',
  '(main)/consultations/letters/page.tsx',
  '(main)/consultations/new-consultation-form.tsx',
  '(main)/transfer/page.tsx',
  '(main)/transfer/[id]/page.tsx',
  '(main)/transfer/history/page.tsx',
  '(main)/transfer/incoming/page.tsx',
  '(main)/claims/[id]/page.tsx',
  '(main)/claims/[id]/ClaimAdjustmentSection.tsx',
  '(main)/reception/components/EligibilityVerifyModal.tsx',
  '(main)/schedule/new/page.tsx',
  '(main)/handoffs/new-handoff-form.tsx',
  '(main)/rounds/page.tsx',
] as const;

/**
 * 🔴 화면이 i18n 층에 넘기지만 **일부러 등재하지 않은** 키 — 사유는 `collab2.ts` 머리 주석에 적혀 있다.
 *    셋 다 한국 제도 전속 어휘라 직역이 거짓 등가가 된다(자격조회 본인부담 구분).
 *    이 집합은 정확 일치다 — 새 미등록 키가 생기면 실패하고, 등재했는데 여기 남겨둬도 실패한다.
 */
const UNREGISTERED = ['산정특례', '자동차', '차상위'];

/**
 * 2026-09-12 배선 후 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * 배선 전: 17화면 전부 `t=0`.
 * `ko` 에 남은 것(사유는 `packages/shared/src/i18n/messages/collab2.ts` 머리 주석):
 *   · 라벨 맵·목록 값(`STATUS_LABEL`·`TYPE_LABEL`·`COPAY_LABEL`·`HANDOFF_TYPES[].label` …) — `<T k={맵[x]}>`/`tAttr(맵[x])` 로 그린다
 *   · 자가번역 부품 prop 원문(`EmptyState title/hint`·`Ratio unavailableHint`) — 부품 **안에서** 그린다
 *   · 저장·전송값(제안 원장 `clientContext`)·언어 endonym(`한국어`)·경과 시간 단위(`${s}초`) — 의도적 미등재
 *   · 미등재 3키(위 `UNREGISTERED`)
 * `t` = `<T`·`<Tf` + `t(f)Attr(` 출현 수(스캐너) · `tf` = `<Tf` + `tfAttr(` 출현 수.
 * 🔴 ko·koExpr 는 여유 0 — 늘면 실패, 줄면 이 표를 내린다. t·tf 는 하한.
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; koExpr: number; t: number; tf: number }> = {
  '(main)/mdt/page.tsx': { ko: 41, koExpr: 0, t: 146, tf: 16 },
  '(main)/consult/page.tsx': { ko: 17, koExpr: 0, t: 56, tf: 10 },
  '(main)/consult/lead/page.tsx': { ko: 18, koExpr: 0, t: 37, tf: 9 },
  '(main)/consult/admin/page.tsx': { ko: 7, koExpr: 0, t: 36, tf: 5 },
  '(main)/consultations/page.tsx': { ko: 12, koExpr: 0, t: 31, tf: 4 },
  '(main)/consultations/letters/page.tsx': { ko: 13, koExpr: 0, t: 18, tf: 6 },
  '(main)/consultations/new-consultation-form.tsx': { ko: 6, koExpr: 0, t: 18, tf: 0 },
  '(main)/transfer/page.tsx': { ko: 16, koExpr: 0, t: 22, tf: 0 },
  '(main)/transfer/[id]/page.tsx': { ko: 7, koExpr: 0, t: 28, tf: 1 },
  '(main)/transfer/history/page.tsx': { ko: 7, koExpr: 0, t: 22, tf: 1 },
  '(main)/transfer/incoming/page.tsx': { ko: 0, koExpr: 0, t: 21, tf: 3 },
  // claims/[id] ko 16→3 2026-10-14 P4-3 — 법정 항목 표를 shared 정본(RECEIPT_CLASSES)으로
  '(main)/claims/[id]/page.tsx': { ko: 3, koExpr: 0, t: 44, tf: 3 },
  '(main)/claims/[id]/ClaimAdjustmentSection.tsx': { ko: 5, koExpr: 0, t: 21, tf: 3 },
  '(main)/reception/components/EligibilityVerifyModal.tsx': { ko: 11, koExpr: 0, t: 28, tf: 1 },
  '(main)/schedule/new/page.tsx': { ko: 4, koExpr: 0, t: 28, tf: 3 },
  '(main)/handoffs/new-handoff-form.tsx': { ko: 11, koExpr: 0, t: 19, tf: 0 },
  '(main)/rounds/page.tsx': { ko: 0, koExpr: 0, t: 22, tf: 7 },
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

/** collab2 의 [en, ja, ar] 튜플 — 세 언어 대조용(키·값 모두 큰따옴표 표기) */
function collab2Rows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'collab2.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  return [...body.matchAll(/^\s*"((?:\\.|[^"\\])+)":\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1],
    v: [...m[2].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]),
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
 * label  = 라벨 맵·목록 값·자가번역 부품 prop 원문 — 존재·고아 검사에 쓴다
 *
 * 🔴 라벨 맵은 **표시 라벨로 쓰이는 자리만** 본다(`clientContext: 'mdt/요약 저장'` 같은 전송값을 키로 세면
 *    번역해서는 안 될 값이 카탈로그에 들어간다 — 2026-09-12 실측 3건).
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
  for (const m of src.matchAll(/<Tf\s+(?:className="[^"]*"\s+)?k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) interp.add(l);
  for (const b of callBodies(src, 'tAttr')) for (const l of literals(b)) plain.add(l);
  for (const b of callBodies(src, 'tfAttr')) { const l = literals(b)[0]; if (l) interp.add(l); }
  for (const m of src.matchAll(/\b(?:[A-Z][A-Z0-9_]*|label|ko|title|hint):\s*'((?:\\.|[^'\\\n])*)'/g)) label.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\[\s*'((?:\\.|[^'\\\n])*)'\s*,\s*'((?:\\.|[^'\\\n])*)'\s*\]/g)) { label.add(m[1]); label.add(m[2]); }
  for (const m of src.matchAll(/\[\s*'((?:\\.|[^'\\\n])*)'\s*,/g)) label.add(m[1]);
  // 자가번역 부품 prop — 생키를 넘기는 자리(EmptyState title/hint · Ratio unavailableHint …)
  for (const m of src.matchAll(/\b(?:title|hint|subtitle|emptyHint|unavailableHint|label|placeholder)="([^"]*)"/g)) label.add(m[1]);
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
const AT = ORDER.indexOf('collab2.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = collab2Rows();
const USED = OWNED.map((f) => ({ f, u: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { u } of USED) for (const k of u.all) USED_ALL.add(k);
const short = (f: string) => f.replace('(main)/', '');

describe('🔴 협진·전원·청구·접수 화면 17 i18n 배선 (collab2)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(AT, 'registry 에서 collab2 를 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(ROWS.length, 'collab2 표 파싱이 깨졌다').toBeGreaterThan(300);
    expect(ROWS.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(CAT.get('collab2.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(350);
    // 추출기 대조군 — 경로마다 실제로 잡는다
    expect(USED_ALL.has('회의 생성')).toBe(true); // <T k="…">
    expect(USED_ALL.has('미개최 ({일수}일 경과)')).toBe(true); // <Tf k="…">
    expect(USED_ALL.has('자격확인')).toBe(true); // <T k={조건식}>
    expect(USED_ALL.has('{AI표기} 비중')).toBe(true); // <Tf k={목록값}>
    expect(USED_ALL.has('예: T2N1M0')).toBe(true); // tAttr(placeholder)
    expect(USED_ALL.has('{AI표기} 모드 변경 실패')).toBe(true); // tfAttr(toast)
    expect(USED_ALL.has('종양위원회')).toBe(true); // 라벨 맵 값
    expect(USED_ALL.has('등록된 회의가 없습니다')).toBe(true); // EmptyState title prop
    expect(USED_ALL.has('오늘 회진 대상 없음')).toBe(true); // Ratio unavailableHint prop
    // 🔴 전송값은 키로 세지 않는다 — 세면 "번역해서는 안 될 값"이 카탈로그에 들어간다
    expect(USED_ALL.has('mdt/요약 저장')).toBe(false);
  });

  it('(a) 화면별 한글 잔여(스캐너 `ko`)가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.ko]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko])));
  });

  it("🔴 (a') 식 옆 JSX 텍스트(스캐너 `koExpr`)도 **정확히** 일치한다 — 문장을 생한글 조각으로 되돌리면 여기서 걸린다", () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; koExpr: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.koExpr]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].koExpr])));
    // 하한이 전부 0 이라 "조각이 늘면 걸린다"만 보증한다 — 그 판정기가 살아 있는지 대조군으로 확인한다
    expect(Object.values(BASELINE).every((b) => b.koExpr === 0)).toBe(true);
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
    expect(OWNED.filter((f) => BASELINE[f].tf > 0).length, '보간 배선 하한이 전부 0').toBeGreaterThanOrEqual(10);
  });

  it('(c) 화면이 i18n 층에 넘기는 한국어 키가 카탈로그에 있다 — 미등재는 사유가 적힌 3키뿐이다', () => {
    const missing: string[] = [];
    for (const { f, u } of USED) for (const k of u.all) if (!ALL_KEYS.has(k)) missing.push(`${short(f)}: ${k}`);
    const bare = [...new Set(missing.map((m) => m.split(': ').slice(1).join(': ')))].sort();
    // 🔴 정확 일치 — 새 미등록 키가 생겨도, 등재해 놓고 예외 목록에 남겨둬도 실패한다
    expect(bare, `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([...UNREGISTERED].sort());
    // 미등재 3키는 카탈로그에 정말 없어야 한다(예외 목록이 "있는 키"를 가리키면 검사가 헛돈다)
    for (const k of UNREGISTERED) expect(ALL_KEYS.has(k), `${k} 는 이미 등재돼 있다 — 예외 목록에서 지운다`).toBe(false);
  });

  it("🔴 (c') 자리표시자가 든 키를 <T>/tAttr 로 부르지 않는다 · 자리표시자 라벨 목록은 <Tf> 로만 소비한다", () => {
    const bad: string[] = [];
    for (const { f, u } of USED) for (const k of u.plain) if (paramsOf(k).length) bad.push(`${short(f)}: ${k}`);
    expect(bad, `<Tf>/tfAttr 로 옮겨야 하는 자리:\n${bad.join('\n')}`).toEqual([]);
    // 대조군 — 보간 키를 실제로 갖고 있다(0 이면 위 검사는 아무것도 보증하지 않는다)
    const interpKeys = new Set<string>();
    for (const { u } of USED) for (const k of u.interp) if (paramsOf(k).length) interpKeys.add(k);
    expect(interpKeys.size, '보간 키 대조군이 0').toBeGreaterThanOrEqual(50);
    // 🔴 consult/lead 통계 라벨 목록에는 `{AI표기} 비중` 이 섞여 있다 — `<T k={l}>` 로 그리면 `{AI표기}` 가 그대로 찍힌다
    const lead = stripComments(read(join(APP, '(main)/consult/lead/page.tsx')));
    expect(lead, 'lead 통계 라벨을 <Tf> 로 부르지 않는다').toMatch(/<Tf\s+k=\{l\}\s+params=\{\{\s*AI표기:/);
    expect(/<T\s+k=\{l\}/.test(lead), 'lead 통계 라벨을 <T> 로 부른다(자리표시자가 그대로 찍힌다)').toBe(false);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 collab2 가 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, AT);
    expect(earlier.length, 'collab2 앞에 카탈로그가 없다(등록 순서 파싱이 깨졌다)').toBeGreaterThan(30);
    const dead = [...CAT.get('collab2.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — collab2 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다', () => {
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

  it('🔴 (g) collab2 는 문맥 키를 만들지 않는다 — 추가 언어 팩에 문맥 결손을 만들지 않기 위해서다', () => {
    const files = packFiles();
    expect(files.length, '팩 등재부 파싱이 깨졌다').toBeGreaterThanOrEqual(6);
    const packKeys = new Map(files.map((f) => [f, keysOf(f, PACKS_DIR)]));
    for (const [f, ks] of packKeys) expect(ks.size, `${f} 키 파싱이 깨졌다`).toBeGreaterThan(300);
    // collab2 는 `원문@문맥` 을 하나도 만들지 않았다 — 만들면 아래 결손 검사가 대상을 갖는다
    const context = ROWS.map((r) => r.key).filter((k) => k.lastIndexOf('@') > 0);
    const gaps: string[] = [];
    for (const key of context) {
      const bare = key.slice(0, key.lastIndexOf('@'));
      for (const [f, ks] of packKeys) if (ks.has(bare) && !ks.has(key)) gaps.push(`${f}: ${key}`);
    }
    expect(gaps, `팩 결손을 만드는 문맥 키(팩과 함께 하거나 문맥 키를 쓰지 않는다):\n${gaps.join('\n')}`).toEqual([]);
    expect(context, 'collab2 가 문맥 키를 새로 만들었다 — 팩 결손을 확인하고 이 기대값을 갱신한다').toEqual([]);
    // 대조군 — 결손 판정기가 살아 있다: 이미 알려진 결손(`판정@검사`)을 이 판정기도 본다
    expect([...packKeys.values()].some((ks) => ks.has('판정') && !ks.has('판정@검사'))).toBe(true);
  });

  it('🔴 (h) 저장값·전송값은 번역하지 않는다 — option value·제안 원장 clientContext 가 tAttr 를 지나지 않는다', () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      if (/\bvalue=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value={tAttr(…)}`);
      if (/\bvalue:\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value: tAttr(…)`);
      if (/\bclientContext:\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: clientContext: tAttr(…)`);
      if (/markProposalPresented\([^)]*\bt(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: markProposalPresented(tAttr(…))`);
    }
    expect(bad).toEqual([]);
    // 대조군 — 라벨은 번역하고 value 는 그대로 넘기는 형태가 실제로 있다(사라지면 검사 대상이 없다)
    const handoff = stripComments(read(join(APP, '(main)/handoffs/new-handoff-form.tsx')));
    expect(handoff).toMatch(/value=\{t\.value\}>\{tAttr\(t\.label\)\}/);
    const mdt = stripComments(read(join(APP, '(main)/mdt/page.tsx')));
    expect(mdt, '제안 원장 전송값이 생문자열로 남아 있어야 한다').toContain("clientContext: 'mdt/요약 저장'");
  });

  it('🔴 (i) 자가번역 부품(EmptyState·Ratio)에는 생키를 넘긴다 — 미리 번역해 넘기면 부품이 번역문을 키로 찾는다', () => {
    const bad: string[] = [];
    let raw = 0;
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      for (const m of src.matchAll(/<(EmptyState|Ratio)\b[^>]*>/g)) {
        if (/\b(?:title|hint|subtitle|emptyHint|unavailableHint)=\{\s*t(?:f)?Attr\(/.test(m[0])) bad.push(`${short(f)}: ${m[1]}`);
        if (/\b(?:title|unavailableHint)="[^"]*[가-힣]/.test(m[0])) raw++;
      }
    }
    expect(bad, `자가번역 부품에 번역된 문자열을 넘긴다:\n${bad.join('\n')}`).toEqual([]);
    expect(raw, '생키를 넘기는 자가번역 부품 대조군이 0(검사 대상이 없다)').toBeGreaterThanOrEqual(10);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED) 를 코드가 임의로 선언하지 않는다', () => {
    expect(read(join(MSG, 'collab2.ts'))).toMatch(/COLLAB2_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'collab2.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '중복 회피를 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(block, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(block, '서버 조립 문장을 적지 않았다').toMatch(/서버가 조립한 문장은 등재하지 않았다/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
    // 🔴 미등재 3키는 이름을 대고 남긴다 — 잊히면 누군가 "번역 누락"으로 채운다
    for (const k of UNREGISTERED) expect(block, `미등재 사유에 ${k} 가 없다`).toContain(k);
  });
});
