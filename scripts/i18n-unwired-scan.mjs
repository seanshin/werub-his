#!/usr/bin/env node
/**
 * i18n 미배선 화면 계측 — **"구멍(누락)"과 "의도적 제외"를 가르는 수치의 재현 정본**.
 *
 * 사용: node scripts/i18n-unwired-scan.mjs [--json] [--safety] [--file <경로조각>]
 *
 * 🔴 **이 스캐너가 답하는 질문은 하나다**: 화면에 남은 한국어가
 *    ① 아무도 안 봐서 남은 것(누락)인가 ② 오역이 위험해서 일부러 남긴 것(제외)인가.
 *    기획 `docs/01-plan/features/parallel-output-review.plan.md` §2 기전 6 · §4 V2.
 *
 * 🔴 **제외 사유는 어휘 단위(카탈로그 헤더)로 적히고, 구멍은 화면 단위로 생긴다.**
 *    둘은 같은 축이 아니라서 기계적으로 대조되지 않는다. 그래서 이 스캐너는
 *    "제외인지"를 판정하지 않고 **제외가 아님을 반증할 수 있는 것만** 판정한다:
 *      · `<T>`/`tAttr` 배선이 **0** 인 화면 → 카탈로그 저자가 그 화면을 본 적이 없다.
 *        그 화면에 대해 "일부러 뺐다"고 말할 근거가 어디에도 없다 → **누락**.
 *      · 그 화면이 `common` 영역의 **무해 공통 크롬 키**(취소·닫기·저장·불러오는 중…)를
 *        생한글로 그리고 있으면 → "안전해서 한국어로 뒀다"는 주장이 **반증된다**.
 *        아무도 환자안전을 이유로 '취소' 버튼을 한국어로 두지 않는다.
 *
 * 세는 규칙(🔴 기전 7 — 규칙을 안 적으면 재측정이 어긋나고 어느 쪽이 맞는지 판정할 수 없다)
 *   대상   : apps/web/src/app/**\/*.tsx (라우트 화면). `components/**` 는 별도 축이라 제외.
 *   ①      : 주석 제거(블록/라인 — 문자열 안의 `//` 는 살린다). 한국어 주석을 문구로 세지 않는다.
 *   ②      : i18n 키 인자 제거 — `<T k="…">` `<T k={…}>` `tAttr('…')` `t('…')`.
 *            등재·배선된 키를 미배선으로 세지 않기 위해서다.
 *   ③ ko   : 남은 한글 조각 = (a) JSX 텍스트 노드 `>…한글…<` (b) 문자열/템플릿 리터럴 중 한글 포함분.
 *            파일 내 중복은 1로 센다(유니크 조각). 🔴 이 수는 **표시 문구의 상한**이다 —
 *            비교값·Record 키 등 화면에 안 뜨는 리터럴도 포함된다. 화면 단위 판정(`<T>`=0)만이
 *            조각 세는 규칙과 무관하게 성립한다.
 *   ④ t    : `<T` 출현수 + `tAttr(` 출현수(주석 제거 후).
 *   안전 축: 경로 패턴에서 **파생**한다(수기 목록 금지 — 새 안전 화면이 자동으로 시야에 든다).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 🔴 안전 축 — 오역·미번역이 임상 위해가 되는 경로. 목록이 아니라 패턴이라 새 화면이 자동 포함된다. */
export const SAFETY_PATH = /nursing\/|nurse-station|blood-bank|transfusion|code-blue|\/mar\/|specimen|critical/i;

const HAN = /[가-힣]/;

/**
 * 🔴 정규식 리터럴을 인식해야 한다(2026-09-09 실측 결함). `/filename="?([^"]+)"?/` 같은 정규식 안의
 *    따옴표를 문자열 시작으로 읽으면, 따옴표 수가 홀수일 때 **파일 끝까지 문자열로 간주**돼 그 파일의
 *    ko·t 집계가 통째로 무의미해진다(실제로 pharmacist-activity 에서 배선 대상 112건 중 3건만 잡혔다).
 *    "기준선이 초록"이 "그 화면이 배선됐다"를 뜻하지 않게 되는 자리다.
 * 판정: 직전 유의미 문자가 값이 끝나는 문자(식별자·닫는 괄호·리터럴)면 나눗셈, 아니면 정규식 시작.
 */
// 🔴 `<` 를 넣으면 안 된다 — JSX 닫는 태그 `</span>` 의 `/` 를 정규식 시작으로 읽는다(2026-09-09 실측).
//    그러면 다음 `/` 까지(예: `<T k="DUR/CDSS만" />` 안의 `/`) 통째로 삼키고, 남은 따옴표가 문자열 모드를
//    열어 **그 뒤 300줄의 주석이 코드로 남는다**(orders/page.tsx 511행에서 실제로 그랬다).
//    `>` 는 남긴다 — `() => /re/.test(x)` 가 실제 패턴이다.
const REGEX_ALLOWED_PREV = /[=(,:[!&|?{};+\-*%~^>]/;
function prevMeaningful(out) {
  for (let k = out.length - 1; k >= 0; k--) {
    const ch = out[k];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return ch;
  }
  return '';
}

export function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | sq | dq | tpl | re | recls
  /**
   * 🔴 템플릿 리터럴의 `${...}` 안은 **코드**다(주석도 들어간다 — rbac 화면에 실제로 있다).
   * 중첩을 세지 않으면 그 주석이 코드로 남아 한글 잔여로 계상된다. 스택으로 되돌아온다.
   */
  const tplStack = [];
  let braceDepth = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = 'block'; i += 2; continue; }
      // 🔴 JSX 자기닫기 `/>` 는 정규식이 아니다 — `<T k={label} />` 의 `}` 뒤 `/` 를 정규식 시작으로 읽으면
      //    다음 `/`(예: 키 안의 `식별자/바코드`)까지 삼키고 남은 따옴표가 문자열 모드를 열어 주석이 코드로 남는다.
      if (c === '/' && c2 === '>') { out += c; i++; continue; }
      if (c === '/') {
        const p = prevMeaningful(out);
        // 값이 끝난 자리 뒤의 `/` 는 나눗셈, 그 밖(문두·연산자·여는 괄호 뒤)은 정규식 시작
        if (p === '' || REGEX_ALLOWED_PREV.test(p)) { mode = 're'; out += c; i++; continue; }
      }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '{') braceDepth++;
      else if (c === '}') {
        if (tplStack.length && braceDepth === tplStack[tplStack.length - 1]) {
          braceDepth = tplStack.pop(); mode = 'tpl'; out += c; i++; continue; // ${...} 끝 → 템플릿으로 복귀
        }
        braceDepth = Math.max(0, braceDepth - 1);
      }
      out += c; i++; continue;
    }
    if (mode === 're' || mode === 'recls') {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
      if (mode === 're' && c === '[') mode = 'recls';
      else if (mode === 'recls' && c === ']') mode = 're';
      else if (mode === 're' && c === '/') mode = 'code';
      // 닫히지 않은 채 줄이 끝나거나 백틱을 만나면 정규식이 아니었다 — 코드로 되돌린다.
      // (JSX 본문의 `{a} / {b}` 처럼 `}` 뒤의 나눗셈·슬래시 텍스트가 정규식으로 오인되는 자리)
      else if (c === '\n') mode = 'code';
      // 백틱을 만났다면 그 `/` 는 정규식이 아니었고, 여기서 **템플릿이 열린다**.
      // 코드로만 되돌리면 짝이 맞는 닫는 백틱이 템플릿을 '여는' 것이 되어 그 뒤가 통째로 삼켜진다
      // (crm/campaigns 의 `{a} / {b} {c ? `/ ${d}` : ''}` 가 실제로 그랬다).
      else if (c === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && c2 === '/') { mode = 'code'; i += 2; } else i++; continue; }
    if (mode === 'tpl' && c === '$' && c2 === '{') {
      tplStack.push(braceDepth); mode = 'code'; out += '${'; i += 2; continue; // 보간 시작 → 코드로
    }
    out += c;
    if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
    // 🔴 JS 문자열은 줄을 넘지 못한다 — 안 닫힌 채 줄이 끝나면 문자열이 아니었다는 뜻이다.
    //    이 되돌림이 없으면 오탐 하나가 **파일 끝까지** 삼켜 그 파일의 계측이 통째로 무의미해진다(§11 의 원 사고).
    if ((mode === 'sq' || mode === 'dq') && c === '\n') { mode = 'code'; i++; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    i++;
  }
  return out;
}

/**
 * 🔴 (2026-09-11 §12-H) 종전 규칙은 ① `<T` 바로 뒤에 `k=` 가 올 때만 벗겼다 — `<T className="…" k="…">` 는 키가
 *    한글 잔여로 남았다 ② `<Tf k>`·`tfAttr('…')`(보간) 키를 몰라서 **보간으로 옮기면 ko 가 오히려 올랐다**
 *    (배선할수록 나빠 보이는 계측). 속성 순서와 무관하게, 보간 부품까지 벗긴다.
 */
const JSX_ATTRS = String.raw`(?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*?`;
const T_KEY_STR = new RegExp(String.raw`<Tf?\b${JSX_ATTRS}\s+k=(["'])(?:\\.|(?!\1)[\s\S])*?\1`, 'g');
const T_KEY_EXPR = new RegExp(String.raw`<Tf?\b${JSX_ATTRS}\s+k=\{[^{}]*\}`, 'g');
/**
 * 🔴 (2026-09-12) **스스로 번역하는 부품의 문자열 prop 은 배선이다.** `EmptyState`(title·hint·description·actionLabel)·
 *    `Ratio`(unavailableHint)는 문자열을 카탈로그 키로 받아 부품 안에서 `<T>`/`<PT>` 로 조회한다(문자열=키·노드=그대로 계약).
 *    종전 스캐너는 그 prop 의 한국어를 **잔여(`ko`)** 로 세고 배선(`t`)으로는 안 셌다 — 그래서 호출부가 `title={tAttr('…')}` 로
 *    **미리 번역해 넘기는 285곳**이 생겼고(그래야 스캐너가 배선으로 봤다), 그 자리에서 AI 초안 표식이 탈락했다.
 *    계측이 잘못된 계약을 강요한 것이다. 이 규칙은 그 prop 의 한국어 리터럴을 ① `ko` 에서 빼고 ② `t` 로 센다.
 *    🔴 `title={tAttr('…')}` 는 tAttr 규칙이 먼저 비우므로 여기서 다시 세지 않는다(이중 계수 없음 → 껍데기를 벗겨도 수가 안 변한다).
 *    🔴 대상은 **이 두 부품뿐**이다 — `<div title="…">` 같은 일반 속성은 여전히 잔여다(넓히면 미배선이 배선으로 둔갑한다).
 */
const SELF_TRANSLATING = { EmptyState: ['title', 'hint', 'description', 'actionLabel'], Ratio: ['unavailableHint'] };
/** 여는 태그의 `>` 위치 — 따옴표·중괄호 깊이를 센다(`/>` 문자열 검색은 다른 JSX 를 삼킨다 — 2026-09-12 실측) */
function openTagEnd(s, i) {
  let j = i + 1, depth = 0, q = null;
  while (j < s.length) {
    const c = s[j];
    if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; }
    else if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return j;
    j++;
  }
  return -1;
}
/** prop 값 하나를 자른다 — `"…"`·`'…'`·`{…}`(중괄호 균형) */
function propValue(tag, from) {
  const c = tag[from];
  if (c === '"' || c === "'") { const e = tag.indexOf(c, from + 1); return e < 0 ? tag.slice(from) : tag.slice(from, e + 1); }
  if (c === '{') { let d = 0; for (let j = from; j < tag.length; j++) { if (tag[j] === '{') d++; else if (tag[j] === '}') { d--; if (d === 0) return tag.slice(from, j + 1); } } }
  return '';
}
const PROP_RE = new RegExp(String.raw`\b(${[...new Set(Object.values(SELF_TRANSLATING).flat())].join('|')})=`, 'g');
/**
 * 스스로 번역하는 부품의 문자열 prop 을 **비우고**, 한국어 키를 담고 있던 prop 수를 함께 돌려준다.
 * 입력은 tAttr/t() 규칙이 이미 지나간 텍스트여야 한다(그래야 `title={tAttr('…')}` 를 다시 세지 않는다).
 */
export function blankSelfTranslatingProps(src) {
  let out = ''; let last = 0; let count = 0;
  const tagRe = new RegExp(String.raw`<(${Object.keys(SELF_TRANSLATING).join('|')})\b`, 'g');
  for (const m of src.matchAll(tagRe)) {
    if (m.index < last) continue;
    const end = openTagEnd(src, m.index);
    if (end < 0) continue;
    const allowed = SELF_TRANSLATING[m[1]];
    let tag = src.slice(m.index, end + 1);
    let rebuilt = ''; let cursor = 0;
    for (const pm of tag.matchAll(PROP_RE)) {
      if (!allowed.includes(pm[1]) || pm.index < cursor) continue;
      const val = propValue(tag, pm.index + pm[0].length);
      if (!val) continue;
      const blanked = val.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (lit) => { if (HAN.test(lit)) { count++; return lit[0] + lit[lit.length - 1]; } return lit; });
      rebuilt += tag.slice(cursor, pm.index + pm[0].length) + blanked;
      cursor = pm.index + pm[0].length + val.length;
    }
    tag = rebuilt + tag.slice(cursor);
    out += src.slice(last, m.index) + tag; last = end + 1;
  }
  return { text: out + src.slice(last), count };
}

export function stripI18nKeys(src) {
  const base = src
    .replace(T_KEY_STR, '<T k=""')
    .replace(T_KEY_EXPR, '<T k={}')
    .replace(/\bt(f?)Attr(\w*)\(\s*(["'])(?:\\.|(?!\3)[\s\S])*?\3/g, 't$1Attr$2(')
    .replace(/\bt\(\s*(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, 't(');
  return blankSelfTranslatingProps(base).text;
}
/** 스스로 번역하는 부품에 넘긴 한국어 키 수(=배선) — `scanScreens` 의 `t` 에 더해진다 */
export function countSelfTranslating(src) {
  const base = src
    .replace(/\bt(f?)Attr(\w*)\(\s*(["'])(?:\\.|(?!\3)[\s\S])*?\3/g, 't$1Attr$2(')
    .replace(/\bt\(\s*(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, 't(');
  return blankSelfTranslatingProps(base).count;
}

/** 문자열·템플릿 리터럴의 **내용**을 비운다 — JSX 텍스트 규칙이 코드 속 문자열을 텍스트로 읽지 않게(문자열은 따로 센다) */
function blankLiterals(src) {
  return src.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) => m[0] + m[m.length - 1]);
}

/**
 * 🔴 (2026-09-11 §12-H) **식 옆 JSX 텍스트** — `<p>표본 {n}개는 산출 불가</p>` 의 `표본`·`개는 산출 불가`.
 *    `koFragments` 의 JSX 규칙은 `>…<` 사이(중괄호 없음)만 봐서 **숫자·변수가 낀 문장은 한 글자도 세지 않았다**.
 *    §12-B 문장 뼈대가 스캐너에 안 잡힌 이유가 이것이다. 기존 `ko` 의 정의(기준선 13종이 걸려 있다)를 바꾸지 않고
 *    **따로 센다** — 한쪽이라도 `{`/`}` 에 닿은 조각만(양쪽이 `>`·`<` 인 것은 이미 `ko` 에 있다).
 */
/**
 * `}` 와 `{` 사이는 JSX 텍스트만이 아니라 **코드**일 수도 있다(정규식 리터럴 속 한글 `if (/주차/.test(msg))` 등).
 * 문장 표지(줄 끝 세미콜론·선언·제어문·`.test(`)가 있으면 코드로 본다. 🔴 HTML 엔티티(`&middot;`)의 `;` 는 표지가 아니다 —
 * 첫 실측에서 `님 &middot;`·`예약 &rarr;` 3건이 그것으로 잘못 빠졌다.
 */
const CODE_MARK = /(?<!&[a-zA-Z]{1,10}|&#\d{1,6});\s*(\n|$)|\b(const|let|var|return|throw|await|function)\s|\bif\s*\(|\.test\(|=>\s*\{/;
export function koExprFragments(src) {
  const frags = new Set();
  const b = blankLiterals(src);
  for (const m of b.matchAll(/([>}])([^<>{}]*[가-힣][^<>{}]*)(?=([<{]))/g)) {
    if (m[1] === '>' && m[3] === '<') continue; // 종전 규칙이 이미 센 자리
    const s = m[2].trim();
    if (s && !CODE_MARK.test(s) && !PARAM_KEY_FRAG.test(s)) frags.add(s);
  }
  return frags;
}

/**
 * 🔴 (2026-09-11) `<Tf params={{ 가: <b>x</b>, 나: <b>y</b> }} />` 의 `, 나:` 는 JSX 텍스트가 아니라 **노드 사이의 객체 키**다
 *    (`</b>` 의 `>` 와 다음 `<b` 의 `<` 사이에 끼어 텍스트 규칙에 걸렸다 — admin11 갈래가 11건 발견).
 *    쉼표로 시작해 한글 식별자+콜론으로 끝나는 조각만 뺀다(`, 나이 미상` 같은 진짜 텍스트는 콜론으로 끝나지 않는다).
 */
const PARAM_KEY_FRAG = /^,\s*[가-힣][가-힣\w]*\s*:$/;
export function koFragments(src) {
  const frags = new Set();
  for (const m of src.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) {
    const s = m[1].trim();
    if (s && !PARAM_KEY_FRAG.test(s)) frags.add(s);
  }
  for (const re of [/'((?:\\.|[^'\\])*)'/g, /"((?:\\.|[^"\\])*)"/g, /`((?:\\.|[^`\\])*)`/g]) {
    for (const m of src.matchAll(re)) {
      const s = m[1].trim();
      if (s && HAN.test(s)) frags.add(s);
    }
  }
  return frags;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 화면 스캔 — appDir 는 인자다(재주입 역검증이 사본 트리를 겨눌 수 있어야 한다) */
export function scanScreens(appDir, baseForRelative = appDir) {
  const rows = [];
  for (const f of walk(appDir)) {
    const noc = stripComments(readFileSync(f, 'utf8'));
    // `<Tf`·`tfAttr(` 도 배선이다(보간 부품) — 세지 않으면 보간으로 옮긴 화면이 "배선 0"으로 읽힌다
    // 🔴 첫 판은 `;` 뒤에 `+ countSelfTranslating(noc)` 를 붙여 **무동작 문장**이 됐고, 단위 가드가 함수만 보고
    //    scanScreens 를 안 봐서 통과했다(285곳 회수 후 t 가 4 줄어서야 드러남). 종단 가드가 이제 이 합을 본다.
    const t = (noc.match(/<Tf?[\s>]/g) || []).length + (noc.match(/\bt(?:f)?Attr\w*\(/g) || []).length
      + countSelfTranslating(noc); // 스스로 번역하는 부품의 문자열 prop(2026-09-12 규칙)
    const stripped = stripI18nKeys(noc);
    const frags = [...koFragments(stripped)];
    const exprFrags = [...koExprFragments(stripped)];
    rows.push({ file: relative(baseForRelative, f), t, ko: frags.length, frags, koExpr: exprFrags.length, exprFrags });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));
  return rows;
}

/**
 * `common` 영역의 무해 공통 크롬 키 — **정본(common.ts 소스)에서 파생**한다(베껴 적지 않는다).
 * 이 키들은 정본 번역이 이미 있고 안전 어휘가 아니다. 화면이 그것을 생한글로 그리면
 * "안전해서 일부러 한국어" 라는 주장이 그 화면에서 **반증된다**.
 */
export function commonChromeKeys(sharedMessagesDir) {
  const src = readFileSync(join(sharedMessagesDir, 'common.ts'), 'utf8');
  const en = src.slice(src.indexOf('en: {'), src.indexOf("ja: {"));
  const keys = new Set();
  for (const m of en.matchAll(/^\s*'((?:\\.|[^'\\])+)':/gm)) keys.add(m[1]);
  return keys;
}

/**
 * 카탈로그 소스의 **키 집합** — 네 가지 표기(`'키': […]` · `["키", …]` 류 · 작은/큰따옴표)를 모두 읽는다.
 * 🔴 (2026-09-11 §12-H) 가드 3종이 각자 파서를 갖고 있었고 둘은 **작은따옴표 키만** 읽었다 — admin7·comp2 는
 *    큰따옴표 키라 그 카탈로그의 사본을 그 가드들이 못 봤다(admin10 갈래가 실제로 사본을 넣었다가 shared 충돌 가드에 잡혔다).
 *    파서를 한 곳에 둔다.
 * 키는 **소스 표기 그대로** 돌려준다(`\\n` 등 이스케이프를 풀지 않는다) — 가드가 대조하는 화면 소스도 같은 표기라서다.
 *    실측: 40 카탈로그 전 키가 실제 카탈로그 객체와 일치(이스케이프 표기 차이 2건만 — admin5·admin10 의 `\\n` 든 확인 문장).
 */
export function catalogKeysOf(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*[\['"]/gm)) out.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/^\s*\['((?:\\.|[^'\\])+)',/gm)) out.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/^\s*"((?:\\.|[^"\\])+)":\s*[\['"]/gm)) out.add(m[1].replace(/\\"/g, '"'));
  for (const m of src.matchAll(/^\s*\["((?:\\.|[^"\\])+)",/gm)) out.add(m[1].replace(/\\"/g, '"'));
  return out;
}

/** registry.ts 에 실제로 등록된 영역 카탈로그 파일 — 수기 목록 금지(기전 2) */
export function registeredCatalogFiles(sharedMessagesDir) {
  const reg = readFileSync(join(sharedMessagesDir, 'registry.ts'), 'utf8');
  const files = new Set();
  for (const m of reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)) files.add(`${m[1]}.ts`);
  return [...files].sort();
}

/**
 * 카탈로그 헤더가 **제외 사유**를 적었는가.
 * 🔴 "중복 등재 금지"(정본이 둘이면 갈라진다)는 제외 사유가 **아니다** — 그건 어디에
 *    등재할지의 문제고, 왜 한국어로 남기는지를 말하지 않는다. 범위 선언("고빈도 우선")도
 *    "안 했다"는 말이지 "일부러 뒀다"는 말이 아니다. 그래서 어휘를 좁게 잡는다.
 */
export function hasExclusionReason(catalogSrc) {
  const head = catalogSrc.slice(0, catalogSrc.indexOf('*/') + 2);
  return /의도적\s*미등재|뺀\s*것|뺀\s*키|등재하지\s*않았다|전환하지\s*않았다|확신[^\n]*없[^\n]*등재하지/.test(head);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const APP = join(ROOT, 'apps/web/src/app');
  const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
  const rows = scanScreens(APP, ROOT);
  const withKo = rows.filter((r) => r.ko > 0);
  const chrome = commonChromeKeys(MSG);
  const safety = withKo.filter((r) => SAFETY_PATH.test(r.file));
  const unwiredSafety = safety.filter((r) => r.t === 0);
  const falsified = unwiredSafety.filter((r) => r.frags.some((f) => chrome.has(f)));
  const cats = registeredCatalogFiles(MSG);
  const noReason = cats.filter((f) => !hasExclusionReason(readFileSync(join(MSG, f), 'utf8')));

  if (args.includes('--json')) {
    console.log(JSON.stringify({ rows, safety, unwiredSafety, falsified, cats, noReason }, null, 1));
  } else {
    console.log(`화면(app/**/*.tsx)            ${rows.length}`);
    console.log(`  한글 잔여                    ${withKo.length}  (조각 상한 ${withKo.reduce((a, r) => a + r.ko, 0)})`);
    console.log(`  <T>/tAttr 배선 0 · 한글>0    ${withKo.filter((r) => r.t === 0).length}   ← B 누락`);
    console.log(`  부분 배선 · 한글>0           ${withKo.filter((r) => r.t > 0).length}   ← C 판정 불가`);
    // 🔴 (2026-09-11) 식 옆 JSX 텍스트(koExpr)까지 넣은 수 — 종전 규칙이 못 보던 자리가 얼마인지 따로 말한다
    const withAny = rows.filter((r) => r.ko + r.koExpr > 0);
    console.log(`  식 옆 텍스트 포함 한글>0     ${withAny.length}  (식 옆 조각 ${rows.reduce((a, r) => a + r.koExpr, 0)} · 그것만 있는 화면 ${rows.filter((r) => r.ko === 0 && r.koExpr > 0).length})`);
    console.log(`    그중 배선 0                ${withAny.filter((r) => r.t === 0).length}   ← B 누락(식 옆 텍스트 포함)`);
    console.log(`안전 축(경로 파생)             ${safety.length}`);
    console.log(`  그중 배선 0                  ${unwiredSafety.length}`);
    console.log(`  🔴 "안전해서 제외" 반증됨     ${falsified.length}  (무해 공통 크롬 키를 생한글로 렌더)`);
    console.log(`영역 카탈로그(registry 등록)   ${cats.length}`);
    console.log(`  제외 사유 헤더 있음          ${cats.length - noReason.length} / ${cats.length}`);
    console.log(`  없음                         ${noReason.join(' · ')}`);
    if (args.includes('--safety')) for (const r of unwiredSafety) {
      const hit = r.frags.filter((f) => chrome.has(f));
      console.log(`   ${hit.length ? '✗반증' : ' 보류'}  ko=${String(r.ko).padStart(3)}  ${r.file}${hit.length ? '  ← ' + hit.join(', ') : ''}`);
    }
  }
}
