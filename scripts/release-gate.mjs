#!/usr/bin/env node
/**
 * 상용 릴리즈 기계 게이트 — `docs/01-plan/features/commercial-release-v1-freeze.plan.md` §3 (T5-1 · T5-2).
 *
 * 🔴 이 스크립트가 하는 일은 **판정**이지 서명이 아니다. 사람 게이트(G1 범위 선언 · G2 개시 전 결정 · G13 법무 ·
 *    G14 문서 검토)는 여기서 세지 않는다 — 기계가 셀 수 없는 것을 PASS 로 그리면 그것이 가짜 게이트다.
 * 🔴 **SKIP 은 PASS 가 아니다.** 돌리지 않은 게이트(`--quick`·도구 없음·산출물 경로 미지정)는 SKIP(사유)로 남고,
 *    SKIP 이 하나라도 있으면 전체 판정은 `INCOMPLETE` 다(PASS 는 전 게이트 PASS 일 때만).
 *
 * 사용:
 *   node scripts/release-gate.mjs                 # 전체(무거움 — tsc 3층·전체 테스트)
 *   node scripts/release-gate.mjs --quick         # 무거운 단계(tsc·테스트) SKIP — 결과에 SKIP 으로 남는다
 *   node scripts/release-gate.mjs --boot          # G4 API 부트 검증 실행(DB·Redis 연결 필요)
 *   node scripts/release-gate.mjs --next-build    # G4 `next build` 실행
 *   node scripts/release-gate.mjs --artifact <dir> # G12 REAL 산출물에서 시드 문자열 grep
 *   node scripts/release-gate.mjs --json          # 기계 판독용
 *   node scripts/release-gate.mjs --snapshot v5.0.0  # 게이트 PASS·워크트리 0·dirty 0 에서만 `release-snapshot/v5.0.0.json` 기록
 * 종료 코드: 0=PASS · 1=FAIL · 2=INCOMPLETE(SKIP 있음)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─────────────────────────────────────────────────────────── 판정 어휘(순수 함수 — 테스트가 직접 부른다)

/** @typedef {'PASS'|'FAIL'|'SKIP'} GateStatus */
/** @typedef {{ id: string, title: string, status: GateStatus, detail: string }} GateResult */

export const pass = (id, title, detail = '') => ({ id, title, status: 'PASS', detail });
export const fail = (id, title, detail) => ({ id, title, status: 'FAIL', detail });
/** 🔴 SKIP 에는 사유가 필수다 — 왜 안 돌렸는지 없는 SKIP 은 "확인했다"로 오독된다 */
export const skip = (id, title, reason) => {
  if (!reason || !String(reason).trim()) throw new Error(`${id}: SKIP 에는 사유가 필요하다`);
  return { id, title, status: 'SKIP', detail: reason };
};

/** 전체 판정 — FAIL 이 하나라도 있으면 FAIL, 아니고 SKIP 이 하나라도 있으면 INCOMPLETE, 전부 PASS 일 때만 PASS */
export function verdictOf(results) {
  if (!Array.isArray(results) || results.length === 0) return 'INCOMPLETE'; // 아무것도 안 돌렸으면 통과가 아니다
  if (results.some((r) => r.status === 'FAIL')) return 'FAIL';
  if (results.some((r) => r.status !== 'PASS')) return 'INCOMPLETE';
  return 'PASS';
}

/** 집계 — SKIP 을 PASS 칸에 더하지 않는다 */
export function summarize(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  return { total: results.length, pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP'), verdict: verdictOf(results) };
}

export const EXIT_CODE = { PASS: 0, FAIL: 1, INCOMPLETE: 2 };

// ─────────────────────────────────────────────────────────── 실행 유틸

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const tail = (s, n = 400) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

/** vitest 요약줄에서 통과·실패 수를 뽑는다 — 못 뽑으면 null(0 으로 지어내지 않는다) */
export function parseVitestSummary(out) {
  const m = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/.exec(out);
  if (!m) return null;
  return { failed: Number(m[1] ?? 0), passed: Number(m[2]) };
}

/** 소스 파일에서 정본 상수값 읽기(버전 등) */
function readHisVersion() {
  const src = readFileSync(join(ROOT, 'packages/shared/src/constants.ts'), 'utf8');
  return /HIS_VERSION\s*=\s*'([^']+)'/.exec(src)?.[1] ?? null;
}

function grepTree(dir, needles, exts = ['.ts', '.tsx', '.js', '.mjs', '.json', '.html']) {
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (['node_modules', '.git', '.claude', 'coverage'].includes(e)) continue;
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (exts.some((x) => p.endsWith(x)) && st.size < 20 * 1024 * 1024) {
        const s = readFileSync(p, 'utf8');
        for (const n of needles) if (s.includes(n)) hits.push(`${p.slice(ROOT.length + 1)}: ${n}`);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return hits;
}

/**
 * G10 — 공개된 개발용 비밀 폴백 스캔.
 *
 * 🔴 종전 G10 은 리터럴 두 개를 apps/api/src 전체에서 찾았다. 그런데 그 리터럴은 T4 에서 **정본 상수 한 곳**
 *    (`release-security.ts` `DEV_SECRET_LITERALS` — REAL 부팅 거부와 짝)으로 모였고, 게이트는 **그 정본 자신**을
 *    위반으로 세어 영구 FAIL 이었다. 동시에 apps/web 의 `REVALIDATE_SECRET || '<리터럴>'` 은 스캔 범위 밖이라 못 봤다.
 *
 * 그래서 두 가지를 본다(정본 파일만 제외 — 사유: 목록 자체가 거기 있어야 부팅 판정·가드가 기계 대조한다)
 *   ① 정본 리터럴 값이 정본 밖 소스에 적혀 있다(폴백이 둘이 된다 — 부팅 거부를 우회한다)
 *   ② 비밀 성격 env(`*SECRET*`·`*TOKEN*`·`*PASSWORD*`·`*_KEY*`)가 비어 있지 않은 문자열 리터럴로 떨어진다
 *      (`process.env.X || 'lit'` · `?? 'lit'` · `config.get('X') || 'lit'` · `config.get('X', 'lit')`)
 *   리터럴 목록은 정본 파일에서 읽는다(여기 다시 적으면 정본이 둘이 된다). 못 읽으면 PASS 가 아니라 FAIL.
 *   주석 줄은 세지 않는다(폴백이 **있었다**는 서술이 걸린다).
 */
export const DEV_SECRET_CANON = 'apps/api/src/common/release-security.ts';
const G10_DIRS = ['apps/api/src', 'apps/web/src', 'apps/homepage/src', 'packages/shared/src'];
// 🔴 2026-09-22: `OPENPACS_PASS` 를 못 봤다(PASSWORD 는 잡고 PASS 는 못 잡았다) — 외부 점검 이 사람 눈으로 찾아 준 자리다.
//    자격 이름의 변형(PASS·PWD·CREDENTIAL)을 함께 본다. BYPASS 처럼 자격이 아닌 말은 앞에 `_` 나 줄 시작을 요구해 걸러낸다.
const SECRET_NAME = '[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|(?<![A-Z])PASS|PWD|CREDENTIAL|_KEY)[A-Z0-9_]*';
const STR = '([\'"`])(?:(?!\\1).)+\\1';
// 🔴 `process.env.X?.trim() || 'lit'` 처럼 사이에 메서드 체인이 끼면 종전 정규식이 못 봤다(재주입으로 확인 — 2026-09-13)
const CHAIN = '(?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*\\s*\\([^()]*\\))*';
const G10_FALLBACK_RES = [
  new RegExp(`process\\.env(?:\\.${SECRET_NAME}|\\[\\s*['"]${SECRET_NAME}['"]\\s*\\])${CHAIN}\\s*(?:\\|\\||\\?\\?)\\s*${STR}`),
  new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*['"]${SECRET_NAME}['"]\\s*\\)${CHAIN}\\s*(?:\\|\\||\\?\\?)\\s*${STR}`),
  new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*['"]${SECRET_NAME}['"]\\s*,\\s*${STR}`),
];
// 🔴 ③ 같은 파일 지역 상수를 거친 폴백(`const t = 'lit'; process.env.X_SECRET || t`) — ②는 리터럴이 그 자리에 있어야만 봤다(2026-09-13 사각지대).
//    식별자 뒤에 `(`·`[` 가 오면(함수 호출·인덱스) 상수가 아니므로 보지 않는다. 빈 문자열 상수는 폴백이 아니다(`|| ''` 와 같다).
// 🔴 ④ (2026-09-14) 남아 있던 사각지대 넷:
//    - 다른 파일에서 import 한 상수(`import { DEV_X } from './consts'` → `?? DEV_X`) — 상대경로 import 를 1단계만 따라가 `export const X = 'lit'` 를 읽는다
//    - 객체 속성 상수(`const DEFAULTS = { secret: 'lit' }` → `?? DEFAULTS.secret`, import 한 객체 포함) — 단 **정본 `DEV_SECRET_LITERALS.*` 는 예외**
//      (그 참조가 REAL 부팅 거부와 짝인 유일한 정당 경로 · 정본 리터럴 자체는 ①이 본다)
//    - `??=`·`||=`·직접 대입(`process.env.X_SECRET = 'lit'` — 부팅 시 env 자체를 덮어써 이후 모든 조회가 폴백을 "설정됨"으로 읽는다)
//    - 구조분해 기본값(`const { X_SECRET = 'lit' } = process.env`)
//    spread 객체는 따라가지 않는다(한계 — 잡지 못한 것을 0 이라 말하지 않도록 여기 적는다).
// 🔴 ⑤ (2026-09-14) alias import(`@/…` — 가장 가까운 tsconfig.json 의 `paths` 로 해석)와 재수출 사슬
//    (`export { X } from './y'`·`export { X as Y } from '…'`·`export * from '…'`)을 **깊이 3** 까지 따라간다.
//    깊이를 넘는 사슬·해석 못 한 alias 는 따라가지 않는다(한계 — 위와 같은 이유로 적는다).
const IDENT = '([A-Za-z_$][\\w$]*)(?![\\w$.(\\[])';
const MEMBER = '([A-Za-z_$][\\w$]*\\.[A-Za-z_$][\\w$]*)(?![\\w$.(\\[])';
const ENV_SECRET = `process\\.env(?:\\.${SECRET_NAME}|\\[\\s*['"]${SECRET_NAME}['"]\\s*\\])`;
const G10_IDENT_FALLBACK_RES = [
  new RegExp(`${ENV_SECRET}${CHAIN}\\s*(?:\\|\\||\\?\\?|\\|\\|=|\\?\\?=|=(?!=))\\s*${IDENT}`, 'g'),
  new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*['"]${SECRET_NAME}['"]\\s*\\)${CHAIN}\\s*(?:\\|\\||\\?\\?)\\s*${IDENT}`, 'g'),
  new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*['"]${SECRET_NAME}['"]\\s*,\\s*${IDENT}`, 'g'),
];
const G10_MEMBER_FALLBACK_RES = [
  new RegExp(`${ENV_SECRET}${CHAIN}\\s*(?:\\|\\||\\?\\?|\\|\\|=|\\?\\?=|=(?!=))\\s*${MEMBER}`, 'g'),
  new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*['"]${SECRET_NAME}['"]\\s*\\)${CHAIN}\\s*(?:\\|\\||\\?\\?)\\s*${MEMBER}`, 'g'),
  new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*['"]${SECRET_NAME}['"]\\s*,\\s*${MEMBER}`, 'g'),
];
// `process.env.X_SECRET ??= 'lit'` · `||= 'lit'` · `= 'lit'`(리터럴) — ②의 `||`/`??` 만으로는 대입 모양을 못 봤다
const G10_ASSIGN_LITERAL_RE = new RegExp(`${ENV_SECRET}\\s*(?:\\|\\|=|\\?\\?=|=(?!=))\\s*${STR}`);
// `const { X_SECRET = 'lit', Y } = process.env` — 줄을 넘는 구조분해도 본다(소스 전체 정규식)
const STR_NB = "(?:'[^'\\n]+'|\"[^\"\\n]+\"|`[^`\\n]+`)"; // 역참조 없는 문자열(합성 정규식 안에서 그룹 번호가 밀려도 안전)
const G10_DESTRUCTURE_RE = new RegExp(`\\{[^}]*?\\b(${SECRET_NAME})\\s*=\\s*(?:${STR_NB}|${IDENT}|${MEMBER})[^}]*\\}\\s*=\\s*process\\.env\\b`, 'g');
const LOCAL_STR_CONST_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*(['"`])((?:(?!\2)[^\\]|\\.)+)\2\s*(?:;|,|$)/gm;
const OBJ_CONST_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;{]+)?=\s*\{([^{}]*)\}/g;
const OBJ_PROP_RE = /(?:^|[,{\s])(?:(['"])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*:\s*(['"`])((?:(?!\4)[^\\]|\\.)+)\4/g;

/** 파일 안 `const NAME = '<비어 있지 않은 문자열>'` 목록(주석 줄 제외) */
export function localStringConstsOf(source) {
  const out = new Map();
  for (const line of source.split('\n')) {
    if (isCommentLine(line)) continue;
    for (const m of line.matchAll(LOCAL_STR_CONST_RE)) if (!(m[2] === '`' && m[3].includes('${'))) out.set(m[1], m[3]); // 보간 템플릿은 상수가 아니다
  }
  return out;
}

/** 파일 안 `const OBJ = { key: '<비어 있지 않은 문자열>' }` → `OBJ.key` 목록(1단계 객체만 · 중첩·spread 는 안 본다) */
export function localObjectStringPropsOf(source) {
  const out = new Map();
  const noComments = source.split('\n').map((l) => (isCommentLine(l) ? '' : l)).join('\n');
  for (const m of noComments.matchAll(OBJ_CONST_RE)) {
    for (const pm of m[2].matchAll(OBJ_PROP_RE)) {
      const key = pm[2] ?? pm[3];
      if (!(pm[4] === '`' && pm[5].includes('${'))) out.set(`${m[1]}.${key}`, pm[5]);
    }
  }
  return out;
}

/** `export const X = 'lit'` · `export const OBJ = {…}` · `export { a, b }`(지역 상수 재수출) — import 추적이 읽는 한 파일의 수출 목록 */
export function exportedStringConstsOf(source) {
  const strs = localStringConstsOf(source);
  const objs = localObjectStringPropsOf(source);
  const exported = new Set();
  for (const line of source.split('\n')) {
    if (isCommentLine(line)) continue;
    const m = line.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (m) exported.add(m[1]);
  }
  for (const m of source.matchAll(/^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const part of m[1].split(',')) {
      const [local, alias] = part.trim().split(/\s+as\s+/);
      if (local) exported.add(alias ?? local);
      if (local && alias && strs.has(local)) strs.set(alias, strs.get(local));
      if (local && alias) for (const [k, v] of objs) if (k.startsWith(`${local}.`)) objs.set(`${alias}.${k.slice(local.length + 1)}`, v);
    }
  }
  const consts = new Map([...strs].filter(([k]) => exported.has(k)));
  const props = new Map([...objs].filter(([k]) => exported.has(k.split('.')[0])));
  return { consts, props };
}

/** `import { A, B as C } from './x'` · `from '@/x'` (type-only 제외) → [{ names: [[A,A],[B,C]], from }] */
export function relativeImportsOf(source) {
  const out = [];
  const re = /^\s*import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]((?:\.{1,2}|@)\/[^'"]+)['"]/gm;
  for (const m of source.matchAll(re)) {
    if (m[1]) continue;
    const names = m[2].split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !x.startsWith('type ')).map((x) => {
      const [orig, alias] = x.split(/\s+as\s+/);
      return [orig.trim(), (alias ?? orig).trim()];
    });
    if (names.length) out.push({ names, from: m[3] });
  }
  return out;
}

const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.mjs'];
const firstFile = (base) => {
  const cands = [base, ...RESOLVE_EXTS.map((e) => base + e), ...RESOLVE_EXTS.map((e) => join(base, 'index' + e))];
  return cands.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
};

/** 가장 가까운 tsconfig.json 의 `"@/*": ["./src/*"]` → alias 기준 디렉터리(없거나 못 읽으면 null) */
const aliasBaseCache = new Map();
function aliasBaseFor(fromFile) {
  let d = dirname(resolve(fromFile));
  const seen = [];
  for (let i = 0; i < 12; i++) {
    if (aliasBaseCache.has(d)) { const v = aliasBaseCache.get(d); seen.forEach((s) => aliasBaseCache.set(s, v)); return v; }
    seen.push(d);
    const ts = join(d, 'tsconfig.json');
    if (existsSync(ts)) {
      const m = readFileSync(ts, 'utf8').match(/["']@\/\*["']\s*:\s*\[\s*["']([^"']+)\*["']/);
      const v = m ? resolve(d, m[1]) : null;
      seen.forEach((s) => aliasBaseCache.set(s, v));
      return v;
    }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  seen.forEach((s) => aliasBaseCache.set(s, null));
  return null;
}

/** 상대 경로·`@/` alias 를 실제 파일로 — 못 풀면 null(지어내지 않는다) */
export function resolveRelativeImport(fromFile, spec) {
  const clean = spec.replace(/\.js$/, '');
  if (clean.startsWith('@/')) {
    const base = aliasBaseFor(fromFile);
    return base ? firstFile(join(base, clean.slice(2))) : null;
  }
  return firstFile(resolve(dirname(fromFile), clean));
}

const REEXPORT_DEPTH = 3;
/** 한 파일의 수출 목록 + 재수출 사슬(`export { X as Y } from`·`export * from`) — 깊이 REEXPORT_DEPTH 까지 */
export function exportedStringConstsDeep(absFile, { readFile = (p) => readFileSync(p, 'utf8'), canonAbs = null, cache = null, depth = 0 } = {}) {
  const key = `${absFile}#${depth}`;
  if (cache?.has(key)) return cache.get(key);
  let src;
  try { src = readFile(absFile); } catch { return null; }
  const ex = exportedStringConstsOf(src);
  if (depth < REEXPORT_DEPTH) {
    const next = (spec) => {
      const t = resolveRelativeImport(absFile, spec);
      if (!t || (canonAbs && resolve(t) === resolve(canonAbs))) return null;
      return exportedStringConstsDeep(t, { readFile, canonAbs, cache, depth: depth + 1 });
    };
    for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}\s*from\s*['"]((?:\.{1,2}|@)\/[^'"]+)['"]/gm)) {
      const sub = next(m[2]);
      if (!sub) continue;
      for (const part of m[1].split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type '))) {
        const [orig, alias] = part.split(/\s+as\s+/).map((x) => x.trim());
        const name = alias ?? orig;
        if (sub.consts.has(orig)) ex.consts.set(name, sub.consts.get(orig));
        for (const [k, v] of sub.props) if (k.startsWith(`${orig}.`)) ex.props.set(`${name}.${k.slice(orig.length + 1)}`, v);
      }
    }
    for (const m of src.matchAll(/^\s*export\s*\*\s*from\s*['"]((?:\.{1,2}|@)\/[^'"]+)['"]/gm)) {
      const sub = next(m[1]);
      if (!sub) continue;
      for (const [k, v] of sub.consts) if (!ex.consts.has(k)) ex.consts.set(k, v);
      for (const [k, v] of sub.props) if (!ex.props.has(k)) ex.props.set(k, v);
    }
  }
  cache?.set(key, ex);
  return ex;
}

/**
 * 한 파일이 import 한 이름 중 문자열 상수·문자열 속성 객체(1단계) — `readFile(absPath)` 로 대상 파일을 읽는다.
 * 🔴 정본 파일(DEV_SECRET_CANON)에서 온 이름은 제외한다 — `DEV_SECRET_LITERALS.X` 참조는 REAL 부팅 거부와 짝인 정당 경로다.
 *    재수출 사슬을 거쳐 정본에 닿는 경우도 제외된다(사슬 중간에서 정본을 만나면 따라가지 않는다).
 */
export function importedStringConstsOf(absFile, source, { readFile = (p) => readFileSync(p, 'utf8'), canonAbs = null, cache = null } = {}) {
  const consts = new Map();
  const props = new Map();
  for (const { names, from } of relativeImportsOf(source)) {
    const target = resolveRelativeImport(absFile, from);
    if (!target || (canonAbs && resolve(target) === resolve(canonAbs))) continue;
    const ex = exportedStringConstsDeep(target, { readFile, canonAbs, cache });
    if (!ex) continue;
    for (const [orig, alias] of names) {
      if (ex.consts.has(orig)) consts.set(alias, ex.consts.get(orig));
      for (const [k, v] of ex.props) if (k.startsWith(`${orig}.`)) props.set(`${alias}.${k.slice(orig.length + 1)}`, v);
    }
  }
  return { consts, props };
}

export function devSecretLiteralsOf(canonSource) {
  const m = canonSource.match(/export const DEV_SECRET_LITERALS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!m) return null;
  const vals = [...m[1].matchAll(/^\s*[A-Z0-9_]+\s*:\s*'([^']+)'/gm)].map((x) => x[1]);
  return vals.length ? vals : null;
}

const isCommentLine = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

/**
 * 한 파일 본문의 G10 위반 — 순수 함수(테스트가 픽스처로 부른다).
 * @param imported import 추적 결과 `{ consts: Map<name,str>, props: Map<'OBJ.key',str> }` — 없으면 같은 파일 안의 것만 본다
 */
export function devSecretFallbackHits(rel, source, literals, imported = { consts: new Map(), props: new Map() }) {
  const hits = [];
  const consts = new Map([...localStringConstsOf(source), ...imported.consts]);
  const props = new Map([...localObjectStringPropsOf(source), ...imported.props]);
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    for (const lit of literals) {
      if (line.includes(`'${lit}'`) || line.includes(`"${lit}"`) || line.includes(`\`${lit}\``)) hits.push(`${rel}:${i + 1}: 정본 리터럴 ${lit}`);
    }
    if (G10_FALLBACK_RES.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}: 비밀 env 리터럴 폴백 — ${line.trim().slice(0, 100)}`);
    else if (G10_ASSIGN_LITERAL_RE.test(line)) hits.push(`${rel}:${i + 1}: 비밀 env 리터럴 대입(??=·||=·=) — ${line.trim().slice(0, 100)}`);
    for (const re of G10_IDENT_FALLBACK_RES) {
      for (const m of line.matchAll(re)) {
        const name = m[m.length - 1];
        if (consts.has(name)) hits.push(`${rel}:${i + 1}: 비밀 env 상수 폴백(${name}${imported.consts.has(name) ? ' · import' : ''}) — ${line.trim().slice(0, 100)}`);
      }
    }
    for (const re of G10_MEMBER_FALLBACK_RES) {
      for (const m of line.matchAll(re)) {
        const name = m[m.length - 1];
        if (props.has(name)) hits.push(`${rel}:${i + 1}: 비밀 env 객체 속성 폴백(${name}${imported.props.has(name) ? ' · import' : ''}) — ${line.trim().slice(0, 100)}`);
      }
    }
  });
  // 구조분해 기본값 — 줄을 넘을 수 있어 소스 전체에서 찾고 줄 번호로 되돌린다(주석 줄은 비워 둔 사본에서)
  const noComments = lines.map((l) => (isCommentLine(l) ? '' : l)).join('\n');
  for (const m of noComments.matchAll(G10_DESTRUCTURE_RE)) {
    const seg = m[0];
    const inner = seg.match(new RegExp(`\\b(${SECRET_NAME})\\s*=\\s*(${STR_NB}|${IDENT}|${MEMBER})`));
    if (!inner) continue;
    const val = inner[2];
    const isLit = /^['"`]/.test(val);
    const ok = isLit ? val.length > 2 : consts.has(val) || props.has(val);
    if (!ok) continue;
    const lineNo = noComments.slice(0, m.index + seg.indexOf(inner[0])).split('\n').length;
    hits.push(`${rel}:${lineNo}: 비밀 env 구조분해 기본값(${inner[1]} = ${val}) — ${lines[lineNo - 1].trim().slice(0, 100)}`);
  }
  return hits;
}

export function scanDevSecretFallbacks(root) {
  const canonPath = join(root, DEV_SECRET_CANON);
  if (!existsSync(canonPath)) return { hits: [], literals: [], error: `정본 파일 없음: ${DEV_SECRET_CANON} — 리터럴 목록을 모르면 통과라고 말하지 않는다` };
  const literals = devSecretLiteralsOf(readFileSync(canonPath, 'utf8'));
  if (!literals) return { hits: [], literals: [], error: `정본 ${DEV_SECRET_CANON} 에서 DEV_SECRET_LITERALS 를 읽지 못했다 — 통과라고 말하지 않는다` };
  const hits = [];
  const cache = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (['node_modules', '.git', '.claude', '.next', 'dist', 'coverage'].includes(e)) continue;
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(p)) {
        const rel = p.slice(root.length + 1);
        if (rel === DEV_SECRET_CANON) continue;
        const src = readFileSync(p, 'utf8');
        hits.push(...devSecretFallbackHits(rel, src, literals, importedStringConstsOf(p, src, { canonAbs: canonPath, cache })));
      }
    }
  };
  for (const d of G10_DIRS) if (existsSync(join(root, d))) walk(join(root, d));
  return { hits, literals, error: null };
}

// ─────────────────────────────────────────────────────────── 게이트

function runGates(opts) {
  /** @type {GateResult[]} */
  const R = [];
  const heavySkip = '`--quick` 로 건너뜀(돌리지 않았다 — 통과가 아니다)';

  // G3-a tsc 3층
  if (opts.quick) R.push(skip('G3-tsc', 'tsc 3층(api·web·shared) 0', heavySkip));
  else {
    const layers = [['api', 'apps/api'], ['web', 'apps/web'], ['shared', 'packages/shared']];
    const bad = [];
    for (const [name, dir] of layers) {
      const r = sh('npx tsc --noEmit', { cwd: join(ROOT, dir) });
      if (r.code !== 0) bad.push(`${name}: ${tail(r.out, 200)}`);
    }
    R.push(bad.length ? fail('G3-tsc', 'tsc 3층(api·web·shared) 0', bad.join(' | ')) : pass('G3-tsc', 'tsc 3층(api·web·shared) 0', 'api·web·shared 오류 0'));
  }

  // G3-b 전체 테스트 — 🔴 api 는 `vitest run test` 가 아니라 include 전체(`vitest run`)
  const tests = {};
  if (opts.quick) R.push(skip('G3-test', '전체 테스트 통과(web·shared·api include 전체)', heavySkip));
  else {
    const bad = [];
    for (const [name, dir] of [['web', 'apps/web'], ['shared', 'packages/shared'], ['api', 'apps/api']]) {
      const r = sh('npx vitest run', { cwd: join(ROOT, dir) });
      const s = parseVitestSummary(r.out);
      tests[name] = s;
      if (r.code !== 0 || !s || s.failed > 0) bad.push(`${name}: ${s ? `실패 ${s.failed}` : '요약 판독 불가'}`);
    }
    const detail = Object.entries(tests).map(([k, v]) => `${k} ${v ? v.passed : '?'}`).join(' · ');
    R.push(bad.length ? fail('G3-test', '전체 테스트 통과(web·shared·api include 전체)', `${bad.join(' | ')} (${detail})`) : pass('G3-test', '전체 테스트 통과(web·shared·api include 전체)', detail));
  }

  // G5 동결형 가드 — 별도 실행기가 없다: 가드는 테스트 스위트 안에 있으므로 G3-test 결과를 따른다(따로 PASS 를 만들지 않는다)
  const g3 = R.find((r) => r.id === 'G3-test');
  if (g3.status === 'SKIP') R.push(skip('G5', '동결형 가드 전부 통과', 'G3-test 를 돌리지 않아 가드도 확인하지 않았다'));
  else if (g3.status === 'FAIL') R.push(fail('G5', '동결형 가드 전부 통과', 'G3-test 실패 — 가드 실패 여부를 개별 확인하라'));
  else R.push(pass('G5', '동결형 가드 전부 통과', 'G3-test 에 포함(🔴 재주입 기록은 사람이 릴리즈 노트에서 확인)'));

  // G4 부트 검증 + next build
  if (!opts.boot) R.push(skip('G4-boot', 'API 부트 검증(NestFactory.create → close)', '`--boot` 미지정 — DB·Redis 연결이 필요해 기본 실행하지 않는다'));
  else {
    const dist = join(ROOT, 'apps/api/dist/app.module.js');
    if (!existsSync(dist)) R.push(fail('G4-boot', 'API 부트 검증(NestFactory.create → close)', '`apps/api/dist/app.module.js` 없음 — `nest build` 먼저'));
    else {
      const code = "const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module');NestFactory.create(AppModule,{logger:false}).then(a=>a.close()).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})";
      const r = sh(`node -e "${code}"`, { cwd: join(ROOT, 'apps/api'), timeout: 180_000 });
      R.push(r.code === 0 ? pass('G4-boot', 'API 부트 검증(NestFactory.create → close)', '부트·종료 성공') : fail('G4-boot', 'API 부트 검증(NestFactory.create → close)', tail(r.out)));
    }
  }
  if (!opts.nextBuild) R.push(skip('G4-next', '`next build` 성공', '`--next-build` 미지정 — 무거워 기본 실행하지 않는다(🔴 tsc·테스트가 못 잡는 층)'));
  else {
    const r = sh("NEXT_PUBLIC_API_URL='' npx next build", { cwd: join(ROOT, 'apps/web'), timeout: 1_800_000 });
    R.push(r.code === 0 ? pass('G4-next', '`next build` 성공', 'build 성공') : fail('G4-next', '`next build` 성공', tail(r.out)));
  }

  // G6 System Scale · 워크트리 0 · dirty 0
  {
    const r = sh('node scripts/system-scale.mjs --check');
    R.push(r.code === 0 ? pass('G6-scale', 'System Scale `--check` 일치', 'lock 과 일치') : fail('G6-scale', 'System Scale `--check` 일치', tail(r.out, 300)));
    const wt = sh('git worktree list').out.trim().split('\n').filter(Boolean);
    R.push(wt.length === 1 ? pass('G6-worktree', '병행 워크트리 0(동결 수치 오염 방지)', '본선 1개') : fail('G6-worktree', '병행 워크트리 0(동결 수치 오염 방지)', `워크트리 ${wt.length}개 — 병합·정리 후 동결`));
    const dirty = sh('git status --porcelain').out.trim().split('\n').filter(Boolean);
    R.push(dirty.length === 0 ? pass('G6-dirty', '커밋되지 않은 변경 0', 'clean') : fail('G6-dirty', '커밋되지 않은 변경 0', `${dirty.length}개 파일 — 산출물이 커밋을 증명하지 못한다`));
  }

  // G7 버전 정본·package.json·CHANGELOG
  const version = readHisVersion();
  {
    const sync = join(ROOT, 'scripts/sync-version.mjs');
    if (!existsSync(sync)) R.push(skip('G7-version', '버전 정본 ↔ package.json 일치', '`scripts/sync-version.mjs` 없음(트랙 T1-1 미병합) — 확인하지 않았다'));
    else {
      const r = sh('node scripts/sync-version.mjs --check');
      R.push(r.code === 0 ? pass('G7-version', '버전 정본 ↔ package.json 일치', `HIS_VERSION ${version}`) : fail('G7-version', '버전 정본 ↔ package.json 일치', tail(r.out, 300)));
    }
    const cl = join(ROOT, 'CHANGELOG.md');
    if (!existsSync(cl)) R.push(fail('G7-changelog', 'CHANGELOG 에 현재 버전 절이 있다', 'CHANGELOG.md 없음'));
    else {
      const bare = (version ?? '').replace(/^v/, '');
      const has = version && readFileSync(cl, 'utf8').includes(bare);
      R.push(has ? pass('G7-changelog', 'CHANGELOG 에 현재 버전 절이 있다', version) : fail('G7-changelog', 'CHANGELOG 에 현재 버전 절이 있다', `${version} 절 없음`));
    }
  }

  // G8 태그 = HEAD
  {
    const tags = sh('git tag --points-at HEAD').out.trim().split('\n').filter(Boolean);
    if (!version) R.push(fail('G8-tag', 'HEAD 에 현재 버전 태그', 'HIS_VERSION 판독 불가'));
    else R.push(tags.includes(version) ? pass('G8-tag', 'HEAD 에 현재 버전 태그', version) : fail('G8-tag', 'HEAD 에 현재 버전 태그', `HEAD 태그 [${tags.join(', ') || '없음'}] ≠ ${version} — 산출물이 어느 릴리즈인지 증명할 수 없다`));
  }

  // G10 공개된 개발용 비밀 폴백(정적) — 정본 밖에 리터럴이 남거나, 비밀 env 가 리터럴로 떨어지면 판매본이 그 비밀을 쓴다
  {
    const title = '공개된 개발용 비밀 폴백 0(api·web·homepage·shared 소스)';
    const { hits, literals, error } = scanDevSecretFallbacks(ROOT);
    if (error) R.push(fail('G10-secrets', title, error));
    else R.push(hits.length ? fail('G10-secrets', title, hits.join(' | ')) : pass('G10-secrets', title, `정본 리터럴 ${literals.length}종은 ${DEV_SECRET_CANON} 에만 · env 비밀 리터럴 폴백 0건 · 🔴 정본 리터럴을 쓰는 경로의 REAL 부팅 거부는 G4-boot·W1 가드가 본다`));
  }

  // G11 법정 서식 데모 상수
  {
    const hits = grepTree(join(ROOT, 'apps/web/src'), ['WRB-DEMO-0001', 'DEV_HOSPITAL_PROFILE'], ['.ts', '.tsx']);
    R.push(hits.length ? fail('G11-demoProfile', '법정 서식 데모 기관 상수 0', `${hits.length}건 — 예: ${hits.slice(0, 3).join(' | ')}`) : pass('G11-demoProfile', '법정 서식 데모 기관 상수 0', '0건'));
  }

  // G12 REAL 산출물 시드 문자열(real-mode-cutover.md §3) — 바늘은 시드 로그인 정본에서 파생(SEED_CANON)
  if (!opts.artifact) R.push(skip('G12-seedStrings', 'REAL 산출물 시드 문자열 0', '`--artifact <dir>[,<dir>]` 미지정 — 산출물을 보지 않았다'));
  else {
    const T = 'REAL 산출물 시드 문자열 0';
    const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);
    const { needles, errors, excluded } = seedNeedlesOf({ accounts: read(SEED_CANON.accounts), patients: read(SEED_CANON.patients), devEnv: read(SEED_CANON.devEnv) });
    if (errors.length || !needles.length) R.push(fail('G12-seedStrings', T, `바늘을 정본에서 만들지 못했다 — ${errors.join(' | ') || '바늘 0'}`));
    else {
      const problems = [];
      const notes = [];
      let scanned = 0;
      for (const d of String(opts.artifact).split(',').map((x) => x.trim()).filter(Boolean).map((x) => resolve(x))) {
        const r = scanArtifactForSeeds(d, needles);
        if (r.error) { problems.push(r.error); continue; }
        scanned += r.scanned;
        if (r.unreadable.length) problems.push(`${d}: 못 읽은 파일 ${r.unreadable.length}개(예: ${r.unreadable[0]})`);
        for (const h of r.hits) problems.push(`${h.file}: ${h.value}(${h.source})`);
        if (r.skipped.cache || r.skipped.sourcemap) notes.push(`캐시 ${r.skipped.cache}·소스맵 ${r.skipped.sourcemap} 제외`);
      }
      if (!problems.length && scanned === 0) problems.push('검사한 파일 0 — 산출물 경로가 비었거나 텍스트 파일이 없다');
      R.push(problems.length
        ? fail('G12-seedStrings', T, `${problems.length}건 — ${problems.slice(0, 5).join(' | ')}`)
        : pass('G12-seedStrings', T, `바늘 ${needles.length}종(정본 파생) · 파일 ${scanned}개 · 0건 · 제외: ${excluded.join('; ')}${notes.length ? ` · ${notes.join(' · ')}` : ''}`));
    }
  }

  // G15 CI — gh 가 없거나 이 커밋에 실행이 없으면 SKIP(초록이라고 말하지 않는다)
  {
    const head = sh('git rev-parse HEAD').out.trim();
    const r = sh(`gh run list --commit ${head} --workflow ci.yml --json conclusion,status --limit 5`);
    if (r.code !== 0) R.push(skip('G15-ci', 'CI 가 이 커밋에서 초록', `gh 조회 불가 — ${tail(r.out, 120)}`));
    else {
      let runs = [];
      try { runs = JSON.parse(r.out); } catch { runs = null; }
      if (!Array.isArray(runs)) R.push(skip('G15-ci', 'CI 가 이 커밋에서 초록', 'gh 응답 판독 불가'));
      else if (runs.length === 0) R.push(skip('G15-ci', 'CI 가 이 커밋에서 초록', '이 커밋에 CI 실행 기록이 없다(돌지 않았다 — 초록이 아니다)'));
      else if (runs.some((x) => x.conclusion === 'success')) R.push(pass('G15-ci', 'CI 가 이 커밋에서 초록', `success (${runs.length}회 중)`));
      else R.push(fail('G15-ci', 'CI 가 이 커밋에서 초록', runs.map((x) => x.conclusion || x.status).join('·')));
    }
  }

  return { results: R, tests };
}

// ─────────────────────────────────────────────────────────── 스냅샷(T5-2)

/** 기준선 동결값을 가드 파일에서 읽는다 — 손으로 옮기면 갈라진다 */
const BASELINE_SOURCES = [
  { name: 'dateRawCallFiles', file: 'apps/web/test/architecture/clinical-ux-rules.spec.ts', re: /raw 날짜 포맷 직접 호출이 늘어나지 않는다[\s\S]*?const BASELINE = (\d+)/ },
  { name: 'dateLocaleLiteralCalls', file: 'apps/web/test/architecture/date-locale-literal-guard.spec.ts', re: /const BASELINE = (\d+)/ },
  { name: 'inlineBodyDto', file: 'apps/api/test/architecture/inline-body-dto-guard.spec.ts', re: /const TOTAL_BASELINE = (\d+)/ },
];

export function buildSnapshot({ version, head, results, tests, readFile = (p) => readFileSync(join(ROOT, p), 'utf8') }) {
  const baselines = {};
  for (const b of BASELINE_SOURCES) {
    try { baselines[b.name] = Number(b.re.exec(readFile(b.file))?.[1] ?? NaN); } catch { baselines[b.name] = null; }
    if (Number.isNaN(baselines[b.name])) baselines[b.name] = null; // 못 읽었으면 null — 0 으로 지어내지 않는다
  }
  let systemScale = null;
  try { systemScale = JSON.parse(readFile('scripts/system-scale.lock.json')); } catch { systemScale = null; }
  return {
    schema: 'release-snapshot/1',
    version,
    commit: head,
    generatedAt: new Date().toISOString(),
    gates: summarize(results),
    tests: tests ?? null,
    baselines,
    systemScale,
  };
}

/**
 * G12 — REAL 산출물 시드 문자열.
 *
 * 🔴 (2026-09-14) 종전 G12 는 수기 목록 3개(`cho.ganho@hospital.example.org`·`1958-03-15`·`dealer1234`)를 들고 있었고
 *    `--artifact` 를 준 적이 없어 **한 번도 돌지 않았다**. 수기 목록은 시드 모듈이 바뀌면 조용히 낡는다 —
 *    그래서 바늘을 **시드 로그인 정본에서 파생**한다(REAL 빌드가 stub 으로 치환하는 바로 그 모듈들):
 *      - `apps/web/src/lib/test-accounts.ts`  직원 시드 계정 이메일 전부
 *      - `apps/web/src/lib/test-patients.ts`  시드 환자 생년월일(MRN+생년월일이 본인확인 자격 — 생년월일이 비공개 쪽)
 *      - `apps/web/.env.development`          `NEXT_PUBLIC_DEALER_TEST_ACCOUNTS` 딜러 계정 이메일·비밀번호
 *    정본을 못 읽거나 바늘이 0 이면 PASS 가 아니다(바늘 없는 검사는 빈 검사다).
 *
 *  - 직원 공용 비밀번호 `TEST_PASSWORD` — 🔴 (2026-09-14) 종전엔 제외했다(관리자 직원 등록 화면의 '초기 비밀번호 기본값'이
 *    같은 문자열이라). 그 기본값을 없애고 서버 일회용 발급으로 바꿨으므로 **바늘에 넣는다** — 산출물에 이 문자열이 있으면
 *    어디서 왔든 시드 자격 한쪽이 번들에 남은 것이다.
 * 제외(사유를 결과에 싣는다):
 *  - `.next/cache` — 빌드 캐시(다른 모드 빌드의 모듈이 남는다·서빙되지 않는다) · `*.map` — 소스맵(원문·주석 포함·서빙 안 함).
 * 🔴 `.next` 인데 `BUILD_ID` 가 없으면 개발 실행 산출물이라 판정하지 않는다(FAIL). 못 읽은 파일은 조용히 넘기지 않는다.
 */
export const SEED_CANON = {
  accounts: 'apps/web/src/lib/test-accounts.ts',
  patients: 'apps/web/src/lib/test-patients.ts',
  devEnv: 'apps/web/.env.development',
};

export function seedNeedlesOf({ accounts, patients, devEnv }) {
  const needles = [];
  const errors = [];
  const excluded = [];
  const add = (value, source) => { if (value && !needles.some((n) => n.value === value)) needles.push({ value, source }); };
  if (accounts == null) errors.push(`${SEED_CANON.accounts} 를 읽지 못했다`);
  else {
    const emails = [...accounts.matchAll(/email:\s*'([^']+@[^']+)'/g)].map((m) => m[1]);
    if (!emails.length) errors.push(`${SEED_CANON.accounts} 에서 계정 이메일을 찾지 못했다`);
    for (const e of emails) add(e, 'test-accounts');
    const pw = accounts.match(/TEST_PASSWORD\s*=\s*'([^']+)'/);
    if (!pw) errors.push(`${SEED_CANON.accounts} 에서 TEST_PASSWORD 를 찾지 못했다`);
    else add(pw[1], 'test-accounts-password');
  }
  if (patients == null) errors.push(`${SEED_CANON.patients} 를 읽지 못했다`);
  else {
    const dobs = [...patients.matchAll(/dob:\s*'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
    if (!dobs.length) errors.push(`${SEED_CANON.patients} 에서 생년월일을 찾지 못했다`);
    for (const d of dobs) add(d, 'test-patients');
  }
  if (devEnv == null) errors.push(`${SEED_CANON.devEnv} 를 읽지 못했다`);
  else {
    const line = devEnv.match(/^NEXT_PUBLIC_DEALER_TEST_ACCOUNTS=(.*)$/m);
    if (!line) errors.push(`${SEED_CANON.devEnv} 에 NEXT_PUBLIC_DEALER_TEST_ACCOUNTS 가 없다`);
    else {
      try {
        const list = JSON.parse(line[1]);
        if (!Array.isArray(list) || !list.length) errors.push('딜러 시드 계정 목록이 비었다');
        else for (const a of list) { add(a.email, 'dealer-env'); add(a.password, 'dealer-env'); }
      } catch (e) {
        errors.push(`NEXT_PUBLIC_DEALER_TEST_ACCOUNTS JSON 파싱 실패: ${e.message}`);
      }
    }
  }
  return { needles, errors, excluded };
}

const ARTIFACT_TEXT_EXT = ['.js', '.mjs', '.cjs', '.json', '.html', '.rsc', '.body', '.txt', '.css', '.meta'];

export function scanArtifactForSeeds(dir, needles) {
  const hits = [];
  const skipped = { cache: 0, sourcemap: 0 };
  const unreadable = [];
  let scanned = 0;
  if (!existsSync(dir)) return { error: `산출물 경로 없음: ${dir}`, hits, skipped, unreadable, scanned };
  const isNext = dir.replace(/[\\/]+$/, '').endsWith('.next');
  if (isNext && !existsSync(join(dir, 'BUILD_ID'))) {
    return { error: '.next 에 BUILD_ID 가 없다 — 개발 실행 산출물이라 운영 산출물로 판정하지 않는다', hits, skipped, unreadable, scanned };
  }
  const walk = (d, rel) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const r = rel ? `${rel}/${e}` : e;
      let st;
      try { st = statSync(p); } catch { unreadable.push(r); continue; }
      if (st.isDirectory()) {
        if (isNext && r === 'cache') { skipped.cache++; continue; }
        if (e === 'node_modules') continue;
        walk(p, r);
      } else if (p.endsWith('.map')) skipped.sourcemap++;
      else if (ARTIFACT_TEXT_EXT.some((x) => p.endsWith(x))) {
        let s;
        try { s = readFileSync(p, 'utf8'); } catch { unreadable.push(r); continue; }
        scanned++;
        for (const n of needles) if (s.includes(n.value)) hits.push({ file: r, value: n.value, source: n.source });
      }
    }
  };
  walk(dir, '');
  return { error: null, hits, skipped, unreadable, scanned };
}

// ─────────────────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const o = { quick: false, json: false, boot: false, nextBuild: false, artifact: null, snapshot: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') o.quick = true;
    else if (a === '--json') o.json = true;
    else if (a === '--boot') o.boot = true;
    else if (a === '--next-build') o.nextBuild = true;
    else if (a === '--artifact') o.artifact = argv[++i];
    else if (a === '--snapshot') o.snapshot = argv[++i];
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const { results, tests } = runGates(opts);
  const sum = summarize(results);
  if (opts.json) console.log(JSON.stringify({ summary: sum, results }, null, 2));
  else {
    for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.id.padEnd(16)} ${r.title}${r.detail ? ` — ${r.detail}` : ''}`);
    console.log(`\n판정 ${sum.verdict} · PASS ${sum.pass} · FAIL ${sum.fail} · SKIP ${sum.skip} / ${sum.total}` +
      (sum.skip ? ' — 🔴 SKIP 은 확인하지 않은 것이다(PASS 로 세지 않음)' : '') +
      '\n사람 게이트(G1 범위 선언·G2 개시 전 결정·G9 설치 리허설 확인·G13 법무·G14 문서)는 이 스크립트가 세지 않는다.');
  }
  if (opts.snapshot) {
    // 🔴 동결은 전 게이트 PASS 에서만 — SKIP·FAIL 이 섞인 수치를 동결하면 다음 릴리즈의 비교 기준이 거짓이 된다
    if (sum.verdict !== 'PASS') {
      console.error(`스냅샷 거부: 판정 ${sum.verdict}(전 게이트 PASS 여야 동결한다)`);
      process.exit(EXIT_CODE[sum.verdict]);
    }
    const head = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    const snap = buildSnapshot({ version: opts.snapshot, head, results, tests });
    mkdirSync(join(ROOT, 'release-snapshot'), { recursive: true });
    const out = join(ROOT, 'release-snapshot', `${opts.snapshot}.json`);
    writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`);
    console.log(`스냅샷 기록: ${out.slice(ROOT.length + 1)}`);
  }
  process.exit(EXIT_CODE[sum.verdict]);
}
