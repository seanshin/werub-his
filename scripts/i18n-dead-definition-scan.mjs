#!/usr/bin/env node
/**
 * scripts/i18n-dead-definition-scan.mjs — **죽은 정의(역방향) 계측기**
 *
 * 기획 정본: `docs/01-plan/features/parallel-output-review.plan.md` §3 R2 · §4 V1
 * 리포트:   `docs/03-analysis/i18n-dead-definition-2026-09-07.md`
 *
 * 무엇을 재는가
 *   정방향("`<T>` 가 쓰는데 카탈로그에 없다")은 이미 0으로 확인됐다. 이 스크립트는 **역방향**을
 *   잰다 — **카탈로그에 등재됐는데 어떤 화면도 그 키로 조회하지 않는 키**.
 *
 * 🔴 이 스크립트는 **계측만 한다.** 카탈로그도 화면도 고치지 않는다.
 * 🔴 **"죽었다"고 단정하지 않는다.** 정적 분석이 못 보는 동적 경로가 실재하므로
 *    판정은 A/B/C/D 네 갈래이고, **D 는 "모르겠다"** 다(0 으로도 사망으로도 세지 않는다).
 *
 * ── 세는 규칙 (여기 못박는다 — 손으로 세거나 델타만 반영하지 말 것) ─────────────────
 *
 * [축] 카탈로그는 **두 축**이고 서로 별개다(합치지 않는다 — 언어 집합이 다르다).
 *   · staff  = `packages/shared/src/i18n/messages/*` (`AREA_CATALOGS`) · 조회 `tOf` · 렌더 `<T>`/`tAttr`
 *   · portal = `apps/web/src/lib/i18n/portal-i18n.ts` CATALOG(+`portal-messages-p2c.ts`)
 *              · 조회 `trOf` · 렌더 `<PT>`/`usePortalTAttr`
 *
 * [분모]
 *   · staff  분모 = AREA_CATALOGS 전 영역의 **en 값이 비어 있지 않은 키**의 합집합.
 *     (ja/ar 은 en 의 부분집합임이 가드로 보장된다 — `i18n-pack.spec.ts`)
 *     🔴 카탈로그 **소스 형식이 둘**(`'키': [en,ja,ar]` 객체형 · `['키',en,ja,ar]` 튜플 배열형)이라
 *        텍스트 파싱은 한쪽을 통째로 놓친다(P2c-1 이 그래서 45건을 오판했다).
 *        그래서 여기서는 **소스를 esbuild 로 그 자리에서 번들해 런타임 객체를 읽는다** —
 *        형식이 몇 가지든 컴파일 결과는 하나다. `dist` 는 읽지 않는다(빌드 스냅샷은 낡는다).
 *   · portal 분모 = CATALOG 의 en/zh/ja 키 합집합(빈 값 제외).
 *   · 분모는 **키 단위**(영역 간 중복 등재는 1키). 영역별 분해는 별도로 낸다.
 *
 * [사용처 — 4경로를 전부 본다. 하나라도 빼면 살아 있는 키를 죽었다고 오판한다]
 *   P1 정적:      `<T k="원문" />` · `<T k={'원문'} />` · `tAttr('원문')`
 *                 (portal: `<PT k="원문" />` · `tAttr('원문')` — 파일이 어느 훅을 import 했는지로 축을 가른다)
 *   P2 동적:      `<T k={식}` / `tAttr(식)` — 식 안의 **문자열 리터럴**과 **식별자가 가리키는 라벨 표**를 푼다.
 *                 · 같은 파일 최상위 `const X = {…}` / `= […]` → 그 리터럴의 한글 문자열
 *                 · shared export 이름 → 번들에서 그 값의 한글 문자열
 *                 · 템플릿 리터럴(`` `${X[k]}@감사` ``) → 값 + 접두/접미 결합
 *                 · **풀 수 없는 식**(루프 변수 `t.label` 등)은 **미해소**로 기록한다(D 판정의 근거)
 *   P3 StatusBadge: `tOf('라벨@상태')` → 없으면 `tOf('라벨')` 로 **선조회**한다.
 *                 라벨 집합 = StatusBadge.tsx `DEFAULT_CONFIG` + `fromLabels()` 에 넘긴 shared *_LABEL 전량
 *                 + `<StatusBadge>` 를 렌더하는 파일의 `label: '한글'` 리터럴(로컬 config 오버라이드).
 *   P4 포털 축:   위 P1/P2 를 portal 축 파일에 대해 동일 적용.
 *
 * [판정 — 4갈래. 🔴 D 를 B 에 섞지 않는다]
 *   A 사용됨      : 위 4경로 중 하나로 그 **키 문자열 그대로** 조회된다.
 *   B 원문조차 없음: 그 키의 원문(`원문@문맥` 이면 `@` 앞)이 스캔 범위 소스 어디에도 문자열로 없다.
 *                   → **죽은 정의의 가장 강한 신호**(화면이 그 말을 아예 하지 않는다).
 *   C 생출력만    : 원문은 소스에 있는데 T 경로를 지나지 않는다.
 *                   → 정의는 있으나 **그 자리는 번역되지 않는다**(등재가 무용).
 *   D 모르겠다    : 원문이, **미해소 동적 T 식을 가진 파일 안**에 있다.
 *                   → 그 동적 식이 이 값을 넘길 수 있다. 정적으로는 판정 불가.
 *
 * [스캔 범위] `apps/web/src/**\/*.{ts,tsx}` 전부(빌드 산출물 제외). 카탈로그 정의 파일
 *   (`lib/i18n/portal-i18n.ts`·`portal-messages-p2c.ts`)은 **원문 존재 판정에서 제외**한다
 *   (자기 자신에 있다고 "화면에 있다"가 되면 C 가 전부 거짓이 된다).
 *   주석은 제거하고 센다(주석 속 한글이 "화면에 있다"로 읽히지 않게).
 *
 * [팩 고아] 추가 언어 팩(zh/ru/vi/kk/mn/th)이 코어(en)에 없는 키를 갖고 있는가. 0 이면 0 이라 적는다.
 *
 * [라벨 상수 T 경로] shared 의 한글 라벨 표(Record<string,string> · 배열의 label 필드)마다
 *   ① T 경로로 렌더되는가 ② 생출력인가 ③ 소비처가 0인가 를 가른다.
 *   그리고 **그 표의 값 중 몇 개가 카탈로그에 등재돼 있는가**를 병기한다 —
 *   T 경로가 없는 표의 등재분은 **자기 렌더 자리를 못 가진 정의**다(기전 3).
 *
 * 사용법
 *   node scripts/i18n-dead-definition-scan.mjs                # 요약표
 *   node scripts/i18n-dead-definition-scan.mjs --json         # 기계 판독
 *   node scripts/i18n-dead-definition-scan.mjs --list B       # 판정별 키 전량(A/B/C/D)
 *   node scripts/i18n-dead-definition-scan.mjs --list B --area admin4
 *   node scripts/i18n-dead-definition-scan.mjs --labels       # 라벨 상수 전수 판정
 *   node scripts/i18n-dead-definition-scan.mjs --unresolved   # 미해소 동적 식 목록(D 의 근거)
 *   node scripts/i18n-dead-definition-scan.mjs --freeze/--check   # 동결·대조(양방향 실패)
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(ROOT, 'package.json'));
const { build } = require_('esbuild');

const SHARED_SRC = join(ROOT, 'packages/shared/src');
const WEB_SRC = join(ROOT, 'apps/web/src');
const LOCK = join(ROOT, 'scripts', 'i18n-dead-definition.lock.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const optOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '.git', 'build', 'out', '.expo']);
const HANGUL = /[가-힣]/;

/** `원문@문맥` → 표시 원문(조회 키는 전체 문자열이다 — 표시만 잘린다) */
const displayOf = (k) => { const i = k.lastIndexOf('@'); return i > 0 ? k.slice(0, i) : k; };

// ───────────────────────────────────────────────────────────── 파일 유틸

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * 소스 토크나이저 — 주석 제거 + 문자열 리터럴 수집을 **한 번에** 한다.
 *
 * 🔴 정규식으로 리터럴을 긁으면 조용히 어긋난다. 실제로 겪었다: `` `의료법 ${AI_ORIGIN_TEXT}` ``
 *    같은 **보간 템플릿**에서 정규식 스캔이 어긋나 그 뒤 라인의 `'검진권'` 을 통째로 놓쳤고,
 *    살아 있는 nav 라벨이 "원문조차 없음(B)"으로 찍혔다. **살아 있는 키를 죽었다고 말하는**
 *    바로 그 오판이다. 그래서 문자 단위로 읽는다.
 *
 * 규칙
 *  · `'`/`"` 문자열은 **같은 줄에서 닫혀야** 문자열이다(JS 규칙). 안 닫히면 그 따옴표는
 *    평범한 글자로 본다 — JSX 텍스트의 홑따옴표(`'대기' 상태`)가 뒤를 통째로 삼키는 것을 막는다.
 *  · 템플릿(`` ` ``)은 줄을 넘고 `${…}` 를 중첩까지 건너뛴다. **보간이 있으면 리터럴로 수집하지 않는다**
 *    (그 문자열은 런타임에야 정해지므로 키가 아니다).
 */
function tokenize(src) {
  let out = '';
  const literals = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; out += '\n'; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2; out += ' '; continue;
    }
    if (c === "'" || c === '"') {
      // 같은 줄에서 닫히는지 먼저 본다(닫히지 않으면 문자열이 아니다)
      let j = i + 1, buf = '', closed = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { buf += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === c) { closed = true; break; }
        buf += src[j]; j++;
      }
      if (!closed) { out += c; i++; continue; }
      out += c + buf + c;
      literals.push(unesc(buf));
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, buf = '', interpolated = false, closed = false;
      while (j < n) {
        if (src[j] === '\\') { buf += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === '`') { closed = true; break; }
        if (src[j] === '$' && src[j + 1] === '{') {
          interpolated = true;
          // `${…}` 중첩 건너뛰기(안쪽 문자열·중괄호 포함)
          let d = 0; let k = j + 1;
          for (; k < n; k++) {
            const ch = src[k];
            if (ch === "'" || ch === '"' || ch === '`') { const q = ch; k++; while (k < n) { if (src[k] === '\\') { k += 2; continue; } if (src[k] === q) break; k++; } continue; }
            if (ch === '{') d++;
            else if (ch === '}') { d--; if (d === 0) break; }
          }
          buf += src.slice(j, k + 1); j = k + 1; continue;
        }
        buf += src[j]; j++;
      }
      if (!closed) { out += c; i++; continue; }
      out += '`' + buf + '`';
      if (!interpolated) literals.push(unesc(buf));
      i = j + 1; continue;
    }
    out += c; i++;
  }
  return { stripped: out, literals };
}

/** src[start] 가 여는 괄호일 때 짝이 맞는 닫는 괄호 위치(문자열/주석 인식). 실패는 -1 */
function matchBracket(src, start) {
  const open = src[start];
  const close = { '{': '}', '(': ')', '[': ']' }[open];
  if (!close) return -1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) break; i++; }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 리터럴 이스케이프 해제 — 🔴 소스의 `\'` 는 화면·카탈로그에서 `'` 다.
 *    이걸 빼먹으면 멀쩡히 등재된 키가 "카탈로그에 없다"로 뜬다(첫 실행에서 실제로 1건 겪었다).
 */
const unesc = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

/** 문자열 리터럴 전량(보간 없는 템플릿 포함) — 토크나이저로만 뽑는다(정규식 금지) */
const stringLiterals = (src) => tokenize(src).literals;

// ───────────────────────────────────────────────── 1. 정의 수집 (분모)

const tmp = mkdtempSync(join(tmpdir(), 'i18n-dead-'));
let SH, AREA_CATALOGS, PACKS_ALL, PORTAL_P2C;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, [
    `export { AREA_CATALOGS } from ${JSON.stringify(join(SHARED_SRC, 'i18n/messages/registry'))};`,
    `export * from ${JSON.stringify(join(SHARED_SRC, 'i18n/pack'))};`,
    `import ${JSON.stringify(join(SHARED_SRC, 'i18n/packs/index'))};`,
    `export * as SH from ${JSON.stringify(join(SHARED_SRC, 'index'))};`,
    `export { PORTAL_P2C_MESSAGES } from ${JSON.stringify(join(WEB_SRC, 'lib/i18n/portal-messages-p2c'))};`,
  ].join('\n'));
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  const m = await import(pathToFileURL(out).href);
  SH = m.SH; AREA_CATALOGS = m.AREA_CATALOGS; PORTAL_P2C = m.PORTAL_P2C_MESSAGES;
  PACKS_ALL = m.allLocalePacks().map((p) => ({ code: p.code, status: p.status, keys: Object.keys(p.messages).filter((k) => p.messages[k]) }));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/** staff 분모 + 영역 귀속(한 키가 여러 영역이면 **먼저 등록된 영역이 이긴다** = 실제 조회 승자) */
const staffKeys = new Set();
const staffAreaOf = new Map();
const staffAreaCount = [];
for (const a of AREA_CATALOGS) {
  const keys = Object.keys(a.c.en ?? {}).filter((k) => a.c.en[k]);
  staffAreaCount.push({ area: a.area, keys: keys.length });
  for (const k of keys) { staffKeys.add(k); if (!staffAreaOf.has(k)) staffAreaOf.set(k, a.area); }
}

/** portal 분모 — CATALOG 리터럴을 그 자리에서 평가한다(형식 가정 없이) */
const portalSrc = readFileSync(join(WEB_SRC, 'lib/i18n/portal-i18n.ts'), 'utf8');
const catIdx = portalSrc.indexOf('const CATALOG');
const braceIdx = portalSrc.indexOf('{', portalSrc.indexOf('=', catIdx));
const catEnd = matchBracket(portalSrc, braceIdx);
if (catIdx < 0 || catEnd < 0) { console.error('🔴 portal CATALOG 리터럴을 찾지 못했다 — 파서를 고쳐라(추정하지 않는다).'); process.exit(1); }
const PORTAL_CATALOG = vm.runInNewContext(`(${portalSrc.slice(braceIdx, catEnd + 1)})`, { PORTAL_P2C_MESSAGES: PORTAL_P2C });
const portalKeys = new Set();
const portalLangCount = {};
for (const [lang, rec] of Object.entries(PORTAL_CATALOG)) {
  const ks = Object.keys(rec).filter((k) => rec[k]);
  portalLangCount[lang] = ks.length;
  ks.forEach((k) => portalKeys.add(k));
}

// ───────────────────────────────────────────────── 2. 소스 수집

const webFiles = walk(WEB_SRC);
const FILES = webFiles.map((p) => { const t = tokenize(readFileSync(p, 'utf8')); return { p, src: t.stripped, lits: t.literals }; });

/**
 * **원문 존재** 판정용 소스 — 화면(web) + **shared 정본 상수**.
 *
 * 🔴 shared 를 빼면 거짓 B 가 무더기로 난다. 상태 라벨(`오더됨`·`투여 중` …)은
 *    `packages/shared` 의 `*_LABEL` 안에 살고, 화면은 그 상수를 렌더한다 —
 *    apps/web 소스에는 그 한국어가 **한 글자도 없다**. web 만 보면 "원문조차 없다(B)"가 되는데
 *    실제로는 화면에 그대로 떠 있다(= 생출력 C). 정반대 판정이다.
 * 🔴 카탈로그 정의 파일은 제외한다(자기 자신에 있다고 "화면에 있다"가 되면 C 가 전부 거짓).
 */
const sharedFiles = walk(SHARED_SRC).filter((p) => !p.includes(join('src', 'i18n')));
const DEF_FILES = new Set([
  join(WEB_SRC, 'lib/i18n/portal-i18n.ts'),
  join(WEB_SRC, 'lib/i18n/portal-messages-p2c.ts'),
]);
const TEXT_FILES = [
  ...FILES.filter((f) => !DEF_FILES.has(f.p)),
  ...sharedFiles.map((p) => { const t = tokenize(readFileSync(p, 'utf8')); return { p, src: t.stripped, lits: t.literals }; }),
];

/**
 * JSX 텍스트 노드 — `<th>HR</th>` 처럼 **문자열 리터럴이 아닌** 화면 문구.
 * 🔴 이걸 빼면 `HR`·`SOFA`·`FiO₂` 같은 표 머리글이 "원문조차 없음"으로 찍힌다(실제로 겪었다).
 */
function jsxTexts(stripped) {
  const out = [];
  // `>텍스트<` 뿐 아니라 `}텍스트<` · `>텍스트{` 도 잡는다 —
  // `{n}/{m} 항목 선택 — …` 처럼 **식과 붙어 있는 텍스트 조각**이 실제로 화면에 뜬다.
  for (const m of stripped.matchAll(/[>}]([^<>{}]{1,200})[<{]/g)) {
    const s = m[1].trim();
    if (s && !/^[\s{}]*$/.test(s)) out.push(s);
  }
  return out;
}

// ───────────────────────────────────────────────── 3. 사용처 4경로

const usedStaff = new Map();   // key -> Set<경로태그>
const usedPortal = new Map();
const addUse = (map, k, tag) => { if (!k) return; if (!map.has(k)) map.set(k, new Set()); map.get(k).add(tag); };

/** 미해소 동적 식 — D 판정의 근거이자 이 계측의 한계 목록 */
const unresolved = [];
/** 미해소 동적 식을 가진 파일 집합(축별) */
const dynFuzzyFiles = { staff: new Set(), portal: new Set() };

/**
 * 식별자 → 그 식별자가 실어 나르는 **한글 문자열 값**들.
 *
 * 🔴 표의 **필드를 가리지 않는다**(label 만 뽑지 않고 그 표의 한글 값 전량).
 *    과대 인정(살아 있다고 넉넉히 보는 쪽)은 안전한 오차다 — 반대 방향(살아 있는 키를
 *    죽었다고 말하는 것)이 이 계측을 무용지물로 만든다.
 */
function resolveIdent(name, fileSrc, depth = 0, seen = new Set()) {
  if (depth > 4 || seen.has(name)) return null;
  seen.add(name);
  // (a) 같은 파일 const 의 객체·배열 리터럴
  const re = new RegExp(`\\bconst\\s+${name}\\b[^=;]*=\\s*`, 'g');
  let m;
  const rhsRoots = [];
  while ((m = re.exec(fileSrc))) {
    let i = m.index + m[0].length;
    while (i < fileSrc.length && /\s/.test(fileSrc[i])) i++;
    if (fileSrc[i] === '{' || fileSrc[i] === '[') {
      const end = matchBracket(fileSrc, i);
      if (end > 0) return stringLiterals(fileSrc.slice(i, end + 1)).filter((s) => HANGUL.test(s));
    }
    // (c) `const X = OTHER.map(…)` 처럼 다른 식별자에서 파생된 값 → 그 뿌리로 거슬러 올라간다
    const rhs = fileSrc.slice(i, i + 200);
    const root = (rhs.match(/^[A-Za-z_$][\w$]*/) ?? [])[0];
    if (root) rhsRoots.push(root);
  }
  // (b) shared export
  const v = SH?.[name];
  if (v && typeof v === 'object') {
    const out = [];
    const walkVal = (x, d = 0) => {
      if (d > 4) return;
      if (typeof x === 'string') { if (HANGUL.test(x)) out.push(x); return; }
      if (Array.isArray(x)) return x.forEach((y) => walkVal(y, d + 1));
      if (x && typeof x === 'object') return Object.values(x).forEach((y) => walkVal(y, d + 1));
    };
    walkVal(v);
    if (out.length) return out;
  }
  for (const r of rhsRoots) {
    const got = resolveIdent(r, fileSrc, depth + 1, seen);
    if (got && got.length) return got;
  }
  /**
   * (d) **루프 변수**를 되짚는다 — `<T k={item.label}>` 의 `item` 은 선언이 아니라
   *     `SOMETHING.map(item => …)` 의 매개변수다. 이걸 안 풀면 nav 사이드바처럼
   *     "표는 살아 있는데 정적으로는 안 보이는" 자리가 통째로 미해소가 된다.
   */
  const bind = new RegExp(`([A-Za-z_$][\\w$.\\[\\]]*)\\s*(?:\\.[A-Za-z_$][\\w$]*\\([^()]*\\)\\s*)*\\.\\s*(?:map|flatMap|forEach|filter|find|some|every|sort)\\s*\\(\\s*\\(?\\s*${name}\\b`, 'g');
  let b;
  while ((b = bind.exec(fileSrc))) {
    const chainRoot = (b[1].match(/^[A-Za-z_$][\w$]*/) ?? [])[0];
    if (!chainRoot) continue;
    const got = resolveIdent(chainRoot, fileSrc, depth + 1, seen);
    if (got && got.length) return got;
  }
  const forOf = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${name}\\s+of\\s+([A-Za-z_$][\\w$]*)`, 'g');
  let f;
  while ((f = forOf.exec(fileSrc))) {
    const got = resolveIdent(f[1], fileSrc, depth + 1, seen);
    if (got && got.length) return got;
  }
  /**
   * (e) **인라인 배열 리터럴의 map** — `[{label:'모드'},…].map(({label}) => <T k={label}/>)`.
   *     이 형태가 남은 미해소의 최다 유형이었다(ICU·응급 등). 수신자가 바로 앞 `[...]` 리터럴이므로
   *     그 리터럴에서 값을 그대로 읽는다.
   */
  const call = /\.\s*(?:map|flatMap|forEach|filter|find)\s*\(/g;
  let cm;
  while ((cm = call.exec(fileSrc))) {
    const openArg = call.lastIndex - 1;
    const endArg = matchBracket(fileSrc, openArg);
    if (endArg < 0) continue;
    const head = fileSrc.slice(openArg + 1, Math.min(endArg, openArg + 200));
    const params = head.slice(0, head.indexOf('=>') < 0 ? 0 : head.indexOf('=>'));
    if (!params || !new RegExp(`\\b${name}\\b`).test(params)) continue;
    // 수신자: `.` 바로 앞이 `]` 면 그 배열 리터럴
    let j = cm.index - 1;
    while (j >= 0 && /\s/.test(fileSrc[j])) j--;
    if (fileSrc[j] !== ']') continue;
    let d2 = 0, k2 = j;
    for (; k2 >= 0; k2--) {
      if (fileSrc[k2] === ']') d2++;
      else if (fileSrc[k2] === '[') { d2--; if (d2 === 0) break; }
    }
    if (k2 < 0) continue;
    const vals = stringLiterals(fileSrc.slice(k2, j + 1)).filter((s) => HANGUL.test(s) || /^[A-Za-z0-9₂₀-₉()% ]+$/.test(s));
    if (vals.length) return vals;
  }
  return null;
}

/**
 * 식을 **값이 나오는 자리**로 쪼갠다 — 조건은 버린다.
 *
 * 🔴 `saving ? '저장중...' : '저장'` 을 "식별자(saving)를 못 풀었다"고 미해소로 두면,
 *    그 파일 전체가 "동적 미해소"가 되어 그 안의 모든 원문이 D(모르겠다)로 밀린다.
 *    조건절은 화면에 나오지 않는다 — **결과 자리만** 본다.
 */
function resultBranches(expr) {
  const s = expr.trim();
  // 최상위 삼항: cond ? a : b  → [a, b]
  let d = 0, q = 0, qi = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { const qq = c; i++; while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === qq) break; i++; } continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === '?' && d === 0 && s[i + 1] !== '.' && s[i + 1] !== '?' && s[i - 1] !== '?') { qi = i; break; }
  }
  if (qi >= 0) {
    for (let i = qi + 1; i < s.length; i++) {
      const c = s[i];
      if (c === "'" || c === '"' || c === '`') { const qq = c; i++; while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === qq) break; i++; } continue; }
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) d--;
      else if (c === '?' && d === 0 && s[i + 1] !== '.' && s[i + 1] !== '?') q++;
      else if (c === ':' && d === 0) { if (q === 0) return [...resultBranches(s.slice(qi + 1, i)), ...resultBranches(s.slice(i + 1))]; q--; }
    }
  }
  // 최상위 `??` / `||` — 양쪽 다 결과 자리다
  for (const op of ['??', '||']) {
    let dd = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "'" || c === '"' || c === '`') { const qq = c; i++; while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === qq) break; i++; } continue; }
      if ('([{'.includes(c)) dd++;
      else if (')]}'.includes(c)) dd--;
      else if (dd === 0 && s.startsWith(op, i)) return [...resultBranches(s.slice(0, i)), ...resultBranches(s.slice(i + op.length))];
    }
  }
  return [s];
}

/** 동적 식 하나를 푼다 → {keys, resolved} */
function resolveExpr(expr0, fileSrc) {
  const keys = [];
  // ⓪ 결과 자리로 쪼갠 뒤, **각 자리를 따로** 판정한다(하나라도 못 풀면 미해소)
  const branches = resultBranches(expr0);
  if (branches.length > 1) {
    let allResolved = true;
    for (const b of branches) {
      const r = resolveExpr(b, fileSrc);
      keys.push(...r.keys);
      if (!r.resolved) allResolved = false;
    }
    return { keys, resolved: allResolved };
  }
  const expr = expr0;
  // ① 식 안의 문자열 리터럴(보간 없는 것)
  for (const s of stringLiterals(expr)) if (s.trim()) keys.push(s);
  // ② 템플릿 리터럴 `${식}접미` / `접두${식}` — 값 + 고정부 결합
  const tpl = /`((?:[^`\\]|\\.)*)`/g;
  let tm; let tplResolved = false;
  while ((tm = tpl.exec(expr))) {
    const body = tm[1];
    if (!body.includes('${')) continue;
    const parts = body.split(/\$\{[^}]*\}/);
    const holes = body.match(/\$\{([^}]*)\}/g) ?? [];
    if (holes.length !== 1) continue;
    const inner = holes[0].slice(2, -1);
    const root = (inner.match(/[A-Za-z_$][\w$]*/) ?? [])[0];
    const vals = root ? resolveIdent(root, fileSrc) : null;
    if (vals) { for (const v of vals) keys.push(`${parts[0] ?? ''}${v}${parts[1] ?? ''}`); tplResolved = true; }
  }
  // ③ 식별자 → 라벨 표
  const identRoots = new Set();
  const cleaned = expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, ' ');
  for (const mm of cleaned.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const before = cleaned[mm.index - 1];
    if (before === '.' || before === '?') continue;   // 멤버 접근의 오른쪽은 루트가 아니다
    identRoots.add(mm[0]);
  }
  let identResolved = false;
  for (const name of identRoots) {
    if (/^(undefined|null|true|false|String|Number|Array|Object|Math|JSON)$/.test(name)) continue;
    const vals = resolveIdent(name, fileSrc);
    if (vals && vals.length) { vals.forEach((v) => keys.push(v)); identResolved = true; }
  }
  const hadIdent = [...identRoots].some((n) => !/^(undefined|null|true|false)$/.test(n));
  // 식별자가 있는데 하나도 못 풀었으면 미해소(문자열만 있는 삼항은 완전 해소로 본다)
  const resolved = !hadIdent || identResolved || tplResolved;
  return { keys, resolved };
}

/** 파일이 어느 축인지 — import 로 가른다(추정하지 않는다) */
function axisOfTAttr(src) {
  const staff = /useTAttr\b/.test(src);
  const portal = /usePortalTAttr\b/.test(src);
  if (staff && !portal) return 'staff';
  if (portal && !staff) return 'portal';
  if (staff && portal) return 'both';
  return null;
}

for (const { p, src } of FILES) {
  const tAttrAxis = axisOfTAttr(src);

  // ── P1/P2: <T k=…> · <PT k=…>
  for (const tag of ['T', 'PT']) {
    const axis = tag === 'T' ? 'staff' : 'portal';
    const map = axis === 'staff' ? usedStaff : usedPortal;
    const re = new RegExp(`<${tag}\\s+k=`, 'g');
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '"' || src[i] === "'") {
        const q = src[i]; let j = i + 1, buf = '';
        while (j < src.length && src[j] !== q) { if (src[j] === '\\') { buf += src[j] + src[j + 1]; j += 2; continue; } buf += src[j++]; }
        addUse(map, unesc(buf), 'P1정적<T>');
        continue;
      }
      if (src[i] !== '{') continue;
      const end = matchBracket(src, i);
      if (end < 0) continue;
      const expr = src.slice(i + 1, end).trim();
      // `{'문자열'}` 은 정적과 같다
      const lit = expr.match(/^'((?:[^'\\]|\\.)*)'$|^"((?:[^"\\]|\\.)*)"$|^`((?:[^`\\$]|\\.)*)`$/);
      if (lit) { addUse(map, unesc(lit[1] ?? lit[2] ?? lit[3]), 'P1정적<T>'); continue; }
      const { keys, resolved } = resolveExpr(expr, src);
      keys.forEach((k) => addUse(map, k, resolved ? 'P2동적(해소)' : 'P2동적(부분해소)'));
      if (!resolved) {
        unresolved.push({ file: relative(ROOT, p), axis, expr: expr.replace(/\s+/g, ' ').slice(0, 120) });
        dynFuzzyFiles[axis].add(p);
      }
    }
  }

  // ── P1/P2: tAttr(…)  (축은 import 로 판정 · both/미상은 양쪽에 넣지 않고 미해소로 남긴다)
  const reA = /\btAttr\s*\(/g;
  let ma;
  while ((ma = reA.exec(src))) {
    const open = reA.lastIndex - 1;
    const end = matchBracket(src, open);
    if (end < 0) continue;
    const expr = src.slice(open + 1, end).trim();
    const targets = tAttrAxis === 'staff' ? ['staff'] : tAttrAxis === 'portal' ? ['portal'] : tAttrAxis === 'both' ? ['staff', 'portal'] : [];
    if (!targets.length) { unresolved.push({ file: relative(ROOT, p), axis: '?', expr: `tAttr(${expr.slice(0, 80)}) — 축 미상(훅 import 없음)` }); continue; }
    const lit = expr.match(/^'((?:[^'\\]|\\.)*)'$|^"((?:[^"\\]|\\.)*)"$|^`((?:[^`\\$]|\\.)*)`$/);
    for (const ax of targets) {
      const map = ax === 'staff' ? usedStaff : usedPortal;
      if (lit) { addUse(map, unesc(lit[1] ?? lit[2] ?? lit[3]), 'P1정적tAttr'); continue; }
      const { keys, resolved } = resolveExpr(expr, src);
      keys.forEach((k) => addUse(map, k, resolved ? 'P2동적(해소)' : 'P2동적(부분해소)'));
      if (!resolved) { unresolved.push({ file: relative(ROOT, p), axis: ax, expr: `tAttr(${expr.replace(/\s+/g, ' ').slice(0, 110)})` }); dynFuzzyFiles[ax].add(p); }
    }
  }
}

// ── P3: StatusBadge 선조회(`라벨@상태` → 없으면 `라벨`)
const sbPath = join(WEB_SRC, 'components/ui/StatusBadge.tsx');
const sbSrc = tokenize(readFileSync(sbPath, 'utf8')).stripped;
const statusLabels = new Set();
// (a) DEFAULT_CONFIG + 파일 내 label 리터럴
for (const mm of sbSrc.matchAll(/label:\s*'((?:[^'\\]|\\.)*)'/g)) if (HANGUL.test(mm[1])) statusLabels.add(mm[1]);
// (b) fromLabels(X, …) 로 넘어간 shared 라벨 표 전량
const domainLabelConsts = new Set();
for (const mm of sbSrc.matchAll(/fromLabels\(\s*([A-Z][A-Z0-9_]*)/g)) domainLabelConsts.add(mm[1]);
for (const name of domainLabelConsts) {
  const rec = SH?.[name];
  if (rec && typeof rec === 'object') for (const v of Object.values(rec)) if (typeof v === 'string' && HANGUL.test(v)) statusLabels.add(v);
}
// (c) <StatusBadge> 를 렌더하는 파일의 로컬 config 오버라이드 label 리터럴
const sbCallFiles = FILES.filter((f) => /<StatusBadge[\s/>]/.test(f.src));
for (const f of sbCallFiles) for (const mm of f.src.matchAll(/label:\s*'((?:[^'\\]|\\.)*)'/g)) if (HANGUL.test(mm[1])) statusLabels.add(mm[1]);
for (const L of statusLabels) { addUse(usedStaff, `${L}@상태`, 'P3배지'); addUse(usedStaff, L, 'P3배지'); }

// ───────────────────────────────────────────────── 4. 판정 (A/B/C/D)

/**
 * 원문 존재 인덱스 — 문자열 리터럴 **+ JSX 텍스트 노드**, web + shared 정본.
 * 🔴 한글이 없는 키(`HR`·`SOFA`·`FiO₂`)도 카탈로그에 있으므로 한글 필터를 걸지 않는다.
 */
const literalFiles = new Map();  // 원문 -> Set<파일경로>
for (const { p, src, lits } of TEXT_FILES) {
  for (const s of [...lits, ...jsxTexts(src)]) {
    if (!s) continue;
    if (!literalFiles.has(s)) literalFiles.set(s, new Set());
    literalFiles.get(s).add(p);
  }
}

function judge(key, usedMap, axis) {
  const via = usedMap.get(key);
  if (via) return { verdict: 'A', via: [...via].join('+') };
  const text = displayOf(key);
  const where = literalFiles.get(text);
  if (!where || where.size === 0) return { verdict: 'B', via: '' };
  for (const f of where) if (dynFuzzyFiles[axis].has(f)) return { verdict: 'D', via: relative(ROOT, f) };
  return { verdict: 'C', via: relative(ROOT, [...where][0]) };
}

const staffVerdict = new Map();
for (const k of staffKeys) staffVerdict.set(k, judge(k, usedStaff, 'staff'));
const portalVerdict = new Map();
for (const k of portalKeys) portalVerdict.set(k, judge(k, usedPortal, 'portal'));

const tally = (vm_) => { const t = { A: 0, B: 0, C: 0, D: 0 }; for (const v of vm_.values()) t[v.verdict]++; return t; };
const staffTally = tally(staffVerdict);
const portalTally = tally(portalVerdict);

/** 영역별 분해(staff) — 귀속은 "이기는 영역"(먼저 등록된 쪽) */
const byArea = new Map();
for (const [k, v] of staffVerdict) {
  const a = staffAreaOf.get(k) ?? '(미상)';
  if (!byArea.has(a)) byArea.set(a, { area: a, total: 0, A: 0, B: 0, C: 0, D: 0 });
  const r = byArea.get(a); r.total++; r[v.verdict]++;
}

/**
 * ── 대조군: 정방향(화면이 쓰는데 카탈로그에 없다)
 * 🔴 `<T>`/`<PT>` 와 `tAttr` 을 **갈라 센다.** `<T>` 는 미등재가 곧 화면의 `EN×` 티라 0 이어야 하지만,
 *    `tAttr`(placeholder·aria-label)은 티를 그릴 수 없는 자리라 **미등재가 정상일 수 있다**.
 *    한 숫자로 합치면 "정방향 0"이라는 기존 판정이 거짓으로 보인다.
 */
const fwdMiss = (map, defs, tag) => [...map.entries()]
  .filter(([k, tags]) => tags.has(tag) && !defs.has(k) && HANGUL.test(k)).map(([k]) => k);
const fwdMissingStaff = fwdMiss(usedStaff, staffKeys, 'P1정적<T>');
const fwdMissingPortal = fwdMiss(usedPortal, portalKeys, 'P1정적<T>');
const fwdMissingStaffAttr = fwdMiss(usedStaff, staffKeys, 'P1정적tAttr');
const fwdMissingPortalAttr = fwdMiss(usedPortal, portalKeys, 'P1정적tAttr');

// ── 팩 고아
const coreKeys = new Set(PACKS_ALL.find((p) => p.code === 'en')?.keys ?? []);
const packOrphans = PACKS_ALL.map((p) => ({ code: p.code, status: p.status, total: p.keys.length, orphan: p.keys.filter((k) => !coreKeys.has(k)) }));

// ───────────────────────────────────────────────── 5. 라벨 상수 T 경로 감사

/** shared 한글 라벨 표 전수 — Record<string,string> 또는 배열(label/l 필드) */
function sharedLabelConstants() {
  const out = [];
  for (const [name, v] of Object.entries(SH ?? {})) {
    if (!v || typeof v !== 'object') continue;
    let values = null;
    if (!Array.isArray(v)) {
      const vals = Object.values(v);
      if (vals.length >= 2 && vals.every((x) => typeof x === 'string') && vals.some((x) => HANGUL.test(x))) values = vals;
    } else if (v.length >= 2 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const labels = v.map((x) => x.label ?? x.l ?? x.name ?? x.title).filter((x) => typeof x === 'string');
      if (labels.length === v.length && labels.some((x) => HANGUL.test(x))) values = labels;
    }
    if (values) out.push({ name, values: values.filter((x) => HANGUL.test(x)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 식별자가 T 식(동적 k / tAttr) 안에 등장하는가 */
const tExprIdents = new Set();
for (const { src } of FILES) {
  for (const tag of ['T', 'PT']) {
    const re = new RegExp(`<${tag}\\s+k=\\s*\\{`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const open = src.indexOf('{', m.index + tag.length + 3);
      const end = matchBracket(src, open);
      if (end < 0) continue;
      for (const mm of src.slice(open, end).matchAll(/[A-Za-z_$][\w$]*/g)) tExprIdents.add(mm[0]);
    }
  }
  const reA = /\btAttr\s*\(/g;
  let ma;
  while ((ma = reA.exec(src))) {
    const open = reA.lastIndex - 1;
    const end = matchBracket(src, open);
    if (end < 0) continue;
    for (const mm of src.slice(open, end).matchAll(/[A-Za-z_$][\w$]*/g)) tExprIdents.add(mm[0]);
  }
}

const apiSrcFiles = walk(join(ROOT, 'apps/api/src'));
const apiSrc = apiSrcFiles.map((p) => readFileSync(p, 'utf8'));
function consumerCount(name) {
  const re = new RegExp(`\\b${name}\\b`);
  let web = 0, api = 0;
  for (const { src } of FILES) if (re.test(src)) web++;
  for (const s of apiSrc) if (re.test(s)) api++;
  return { web, api };
}

const labelAudit = sharedLabelConstants().map((c) => {
  const cons = consumerCount(c.name);
  const inT = tExprIdents.has(c.name);
  const inStatusBadge = domainLabelConsts.has(c.name);
  const registered = c.values.filter((v) => staffKeys.has(v) || staffKeys.has(`${v}@상태`)).length;
  const verdict = inT || inStatusBadge ? 'T경로있음' : cons.web === 0 ? '소비처0(web)' : '생출력';
  return {
    name: c.name, values: c.values.length, registered,
    webFiles: cons.web, apiFiles: cons.api,
    path: inStatusBadge ? 'StatusBadge' : inT ? 'T식' : '없음',
    verdict,
  };
});

// ───────────────────────────────────────────────── 6. 출력

const result = {
  measuredAt: new Date().toISOString().slice(0, 10),
  staff: {
    denominator: staffKeys.size, areas: staffAreaCount, tally: staffTally,
    byArea: [...byArea.values()].sort((a, b) => b.B + b.C - (a.B + a.C)),
  },
  portal: { denominator: portalKeys.size, langs: portalLangCount, tally: portalTally },
  statusBadgeLabels: statusLabels.size,
  forward: {
    staffMissing: fwdMissingStaff.length, portalMissing: fwdMissingPortal.length,
    staffMissingAttr: fwdMissingStaffAttr.length, portalMissingAttr: fwdMissingPortalAttr.length,
  },
  packOrphans: packOrphans.map((p) => ({ code: p.code, status: p.status, total: p.total, orphan: p.orphan.length })),
  unresolvedDynamic: { sites: unresolved.length, staffFiles: dynFuzzyFiles.staff.size, portalFiles: dynFuzzyFiles.portal.size },
  labelConstants: {
    total: labelAudit.length,
    T경로있음: labelAudit.filter((l) => l.verdict === 'T경로있음').length,
    생출력: labelAudit.filter((l) => l.verdict === '생출력').length,
    소비처0: labelAudit.filter((l) => l.verdict === '소비처0(web)').length,
    등재값_T경로없음: labelAudit.filter((l) => l.verdict !== 'T경로있음').reduce((s, l) => s + l.registered, 0),
  },
};

if (has('--json')) { console.log(JSON.stringify({ ...result, labelAudit, unresolved }, null, 2)); process.exit(0); }

if (has('--list')) {
  const want = (optOf('--list') ?? 'B').toUpperCase();
  const area = optOf('--area');
  const rows = [...staffVerdict.entries()]
    .filter(([k, v]) => v.verdict === want && (!area || staffAreaOf.get(k) === area))
    .sort((a, b) => (staffAreaOf.get(a[0]) ?? '').localeCompare(staffAreaOf.get(b[0]) ?? '') || a[0].localeCompare(b[0]));
  console.log(`# staff 축 판정 ${want} — ${rows.length}건 / 분모 ${staffKeys.size}${area ? ` (영역 ${area})` : ''}`);
  for (const [k, v] of rows) console.log(`${(staffAreaOf.get(k) ?? '?').padEnd(12)} ${k}${v.via ? `   ← ${v.via}` : ''}`);
  const prows = [...portalVerdict.entries()].filter(([, v]) => v.verdict === want).sort();
  console.log(`\n# portal 축 판정 ${want} — ${prows.length}건 / 분모 ${portalKeys.size}`);
  for (const [k, v] of prows) console.log(`  ${k}${v.via ? `   ← ${v.via}` : ''}`);
  process.exit(0);
}

if (has('--labels')) {
  console.log(`# shared 한글 라벨 상수 전수 판정 — ${labelAudit.length}종`);
  console.log('name / 값수 / 카탈로그등재 / web소비파일 / api소비파일 / 경로 / 판정');
  for (const l of labelAudit.sort((a, b) => a.verdict.localeCompare(b.verdict) || b.registered - a.registered)) {
    console.log(`${l.name.padEnd(38)} ${String(l.values).padStart(4)} ${String(l.registered).padStart(5)} ${String(l.webFiles).padStart(5)} ${String(l.apiFiles).padStart(5)}  ${l.path.padEnd(12)} ${l.verdict}`);
  }
  process.exit(0);
}

/**
 * 🔴 자기검사(재주입 역검증) — **통과하는 계측기는 아무것도 보증하지 않을 수 있다.**
 *    카탈로그도 소스도 건드리지 않고, 메모리 위에서 결함을 주입해 판정이 실제로 뒤집히는지 본다.
 *    주입이 무동작이면 "통과"를 증거로 읽게 되므로 **주입 성공을 먼저 단언**한다.
 */
if (has('--selftest')) {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  // ① 지어낸 키는 B 여야 한다(원문이 소스 어디에도 없다)
  const fake = '이문구는저장소어디에도없다ZZ자기검사';
  ok(!literalFiles.has(fake), '주입 전제 실패: 자기검사용 문구가 이미 소스에 있다');
  ok(judge(fake, usedStaff, 'staff').verdict === 'B', '① 지어낸 키가 B 로 안 나온다 — B 판정이 죽었다');

  // ② 살아 있는 키의 사용처를 지우면 A 가 아니어야 한다(경로 감지가 실제로 작동하는 증거)
  const liveStatic = [...usedStaff.entries()].find(([k, t]) => t.has('P1정적<T>') && t.size === 1 && staffKeys.has(k));
  ok(!!liveStatic, '주입 전제 실패: 정적 <T> 로만 쓰이는 키를 못 찾았다');
  if (liveStatic) {
    const [k] = liveStatic;
    ok(judge(k, usedStaff, 'staff').verdict === 'A', `주입 전제 실패: '${k}' 가 원래 A 가 아니다`);
    const saved = usedStaff.get(k); usedStaff.delete(k);
    ok(judge(k, usedStaff, 'staff').verdict !== 'A', `② 사용처를 지웠는데도 '${k}' 가 A 다 — 사용처 감지가 헛돈다`);
    usedStaff.set(k, saved);
  }

  // ③ 🔴 **카탈로그 형식 두 가지가 모두 분모에 들어왔는가**
  //    (`'키': [en,ja,ar]` 객체형 · `['키',en,ja,ar]` 튜플 배열형 — 한쪽만 가정한 대조는 대조가 아니다)
  const objArea = AREA_CATALOGS.find((a) => a.area === 'status');
  const tupArea = AREA_CATALOGS.find((a) => a.area === 'crm2');
  ok(!!objArea && !!tupArea, '주입 전제 실패: status/crm2 영역을 못 찾았다');
  if (objArea && tupArea) {
    const oSrc = readFileSync(join(SHARED_SRC, 'i18n/messages/status.ts'), 'utf8');
    const tSrc = readFileSync(join(SHARED_SRC, 'i18n/messages/crm2.ts'), 'utf8');
    ok(/^\s*'[^']+':\s*\[/m.test(oSrc), "주입 전제 실패: status.ts 가 더 이상 객체형('키': [..])이 아니다");
    ok(/^\s*\['[^']+',/m.test(tSrc), "주입 전제 실패: crm2.ts 가 더 이상 튜플형(['키', ..])이 아니다");
    ok(Object.keys(objArea.c.en ?? {}).length > 100, '③ 객체형 카탈로그(status)가 분모에 안 들어왔다');
    ok(Object.keys(tupArea.c.en ?? {}).length > 100, '③ 튜플형 카탈로그(crm2)가 분모에 안 들어왔다 — 형식을 하나만 가정했다');
  }

  // ④ 토크나이저: 보간 템플릿 뒤의 리터럴을 놓치지 않는다(실제로 겪은 회귀)
  const t4 = tokenize("const a = `의료법 ${X}`;\nconst b = { title: '검진권' };");
  ok(t4.literals.includes('검진권'), '④ 보간 템플릿 뒤 리터럴을 놓친다 — 살아 있는 키를 B 로 오판하게 된다');
  ok(!t4.literals.includes('의료법 ${X}'), '④ 보간 템플릿을 리터럴로 잘못 수집한다');

  // ⑤ 대조군: 성공을 실패로 말하지 않는다
  ok(judge([...staffKeys][0], usedStaff, 'staff').verdict.length === 1, '⑤ 판정이 한 글자(A/B/C/D)가 아니다');

  if (fails.length) { console.error(`FAIL — 자기검사 ${fails.length}건:\n` + fails.map((f) => `  · ${f}`).join('\n')); process.exit(1); }
  console.log('OK — 자기검사 5축 통과(지어낸 키 B · 사용처 제거 시 A 이탈 · 카탈로그 2형식 · 토크나이저 회귀 · 대조군)');
  process.exit(0);
}

if (has('--unresolved')) {
  console.log(`# 미해소 동적 식 — ${unresolved.length}건 (D 판정의 근거이자 이 계측의 한계)`);
  for (const u of unresolved) console.log(`[${u.axis}] ${u.file}\n    ${u.expr}`);
  process.exit(0);
}

if (has('--freeze')) {
  writeFileSync(LOCK, JSON.stringify({
    frozenAt: new Date().toISOString().slice(0, 10),
    note: 'i18n-dead-definition-scan.mjs --check 의 동결값. 많아도 적어도 실패한다. 🔴 A 가 줄거나 B/C 가 늘면 죽은 정의가 는 것이다.',
    values: {
      staffDenominator: result.staff.denominator, staffA: staffTally.A, staffB: staffTally.B, staffC: staffTally.C, staffD: staffTally.D,
      portalDenominator: result.portal.denominator, portalA: portalTally.A, portalB: portalTally.B, portalC: portalTally.C, portalD: portalTally.D,
      forwardStaffMissing: fwdMissingStaff.length, forwardPortalMissing: fwdMissingPortal.length,
      forwardStaffMissingAttr: fwdMissingStaffAttr.length, forwardPortalMissingAttr: fwdMissingPortalAttr.length,
      packOrphanTotal: packOrphans.reduce((s, p) => s + p.orphan.length, 0),
      labelTotal: result.labelConstants.total, labelNoTPath: result.labelConstants.생출력 + result.labelConstants.소비처0,
    },
  }, null, 2) + '\n');
  console.log(`동결했다 → ${relative(ROOT, LOCK)}`);
  process.exit(0);
}

if (has('--check')) {
  if (!existsSync(LOCK)) { console.error('동결값이 없다. 먼저 --freeze 하라.'); process.exit(1); }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const now = {
    staffDenominator: result.staff.denominator, staffA: staffTally.A, staffB: staffTally.B, staffC: staffTally.C, staffD: staffTally.D,
    portalDenominator: result.portal.denominator, portalA: portalTally.A, portalB: portalTally.B, portalC: portalTally.C, portalD: portalTally.D,
    forwardStaffMissing: fwdMissingStaff.length, forwardPortalMissing: fwdMissingPortal.length,
      forwardStaffMissingAttr: fwdMissingStaffAttr.length, forwardPortalMissingAttr: fwdMissingPortalAttr.length,
    packOrphanTotal: packOrphans.reduce((s, p) => s + p.orphan.length, 0),
    labelTotal: result.labelConstants.total, labelNoTPath: result.labelConstants.생출력 + result.labelConstants.소비처0,
  };
  const diffs = [];
  for (const k of new Set([...Object.keys(lock.values), ...Object.keys(now)])) {
    if (lock.values[k] !== now[k]) diffs.push(`  ${k}: 동결 ${lock.values[k]} → 현재 ${now[k]}`);
  }
  if (!diffs.length) { console.log(`OK — 동결값(${lock.frozenAt})과 일치한다.`); process.exit(0); }
  console.error(`FAIL — 동결값(${lock.frozenAt})과 어긋난다 (${diffs.length}건):\n${diffs.join('\n')}`);
  process.exit(1);
}

// ── 기본: 요약표
const pct = (n, d) => (d === 0 ? '산출 불가' : `${((n / d) * 100).toFixed(1)}%`);
console.log('# i18n 죽은 정의(역방향) 스캔 — 관측 전용(고치지 않는다)\n');
console.log(`측정일 ${result.measuredAt}\n`);
console.log('## 판정 어휘');
console.log('  A 사용됨 · B 원문조차 없음(죽은 정의 강한 신호) · C 생출력만(T 경로 없음) · D 모르겠다(미해소 동적 식 파일 안에 원문 존재)\n');
console.log('## staff 축 (shared AREA_CATALOGS · <T>/tAttr/StatusBadge)');
console.log(`  분모(en 등재 키 · 영역 ${staffAreaCount.length}) : ${staffKeys.size}`);
for (const v of ['A', 'B', 'C', 'D']) console.log(`  ${v} : ${String(staffTally[v]).padStart(5)}  (${pct(staffTally[v], staffKeys.size)})`);
console.log('\n## portal 축 (portal-i18n CATALOG · <PT>/usePortalTAttr)');
console.log(`  분모(en/zh/ja 합집합) : ${portalKeys.size}   [${Object.entries(portalLangCount).map(([l, n]) => `${l} ${n}`).join(' · ')}]`);
for (const v of ['A', 'B', 'C', 'D']) console.log(`  ${v} : ${String(portalTally[v]).padStart(5)}  (${pct(portalTally[v], portalKeys.size)})`);
console.log('\n## 영역별 분해(staff · 귀속=이기는 영역)');
console.log('  영역          분모     A     B     C     D');
for (const r of [...byArea.values()].sort((a, b) => (b.B + b.C) - (a.B + a.C))) {
  console.log(`  ${r.area.padEnd(12)} ${String(r.total).padStart(5)} ${String(r.A).padStart(5)} ${String(r.B).padStart(5)} ${String(r.C).padStart(5)} ${String(r.D).padStart(5)}`);
}
console.log('\n## 대조군 — 정방향(화면이 쓰는데 카탈로그에 없다)');
console.log(`  <T>  staff  : ${fwdMissingStaff.length}${fwdMissingStaff.length ? ` — ${fwdMissingStaff.slice(0, 5).join(' · ')}` : ' (0 이어야 정상 — 미등재는 EN× 티가 된다)'}`);
console.log(`  <PT> portal : ${fwdMissingPortal.length}${fwdMissingPortal.length ? ` — ${fwdMissingPortal.slice(0, 5).join(' · ')}` : ''}`);
console.log(`  tAttr staff ${fwdMissingStaffAttr.length} · portal ${fwdMissingPortalAttr.length}  ← 티를 못 그리는 자리라 미등재가 결함이 아닐 수 있다(별개 수치)`);
console.log('\n## 팩 고아(코어 en 에 없는데 팩이 가진 키)');
for (const p of packOrphans) console.log(`  ${p.code.padEnd(4)} ${p.status.padEnd(9)} total ${String(p.total).padStart(5)}  orphan ${p.orphan.length}`);
console.log('\n## 라벨 상수 T 경로 (shared 한글 라벨 표)');
console.log(`  전수 ${result.labelConstants.total}종 — T경로있음 ${result.labelConstants.T경로있음} · 생출력 ${result.labelConstants.생출력} · 소비처0(web) ${result.labelConstants.소비처0}`);
console.log(`  🔴 T 경로 없는 표의 값 중 카탈로그 등재분 : ${result.labelConstants.등재값_T경로없음}키 (자기 렌더 자리를 못 가진 정의)`);
console.log('\n## 🔴 이 계측이 못 보는 것');
console.log(`  미해소 동적 식 ${unresolved.length}곳 (staff 파일 ${dynFuzzyFiles.staff.size} · portal 파일 ${dynFuzzyFiles.portal.size})`);
console.log('  → 그 파일 안에 원문이 있는 키는 D 로 뺐다. D 는 "죽었다"도 "살았다"도 아니다.');
console.log('\n(--list A|B|C|D · --labels · --unresolved · --json · --freeze/--check)');
