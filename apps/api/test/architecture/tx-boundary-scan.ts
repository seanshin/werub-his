import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { stripForScan } from './egress-scan';

/**
 * 트랜잭션 경계 계측 — **분모를 먼저 세는 도구**다(2026-09-16 F3).
 *
 * 세는 것: 한 메서드 안에서 `prisma.<model>.<create|update|delete|upsert|…>` 를 **2회 이상** 부르는데
 * 그 쓰기가 `$transaction` 밖인 자리. 중간에 실패하면 **반쪽 상태**가 남는다
 * (재고는 빠졌는데 불출 기록이 없다 / 상태는 바뀌었는데 원장이 없다).
 *
 * 🔴 **`다중쓰기` 가 곧 결함은 아니다.** 감사·알림·히트카운트처럼 실패해도 본 작업이 유효한
 *    베스트에포트와, 이미 멱등·복구 경로가 있는 것이 섞여 있다. 한 건씩 봐야 안다 —
 *    그래서 "N건이 결함"이라고 말하지 않는다. 지키는 것은 **늘지 않는다** 하나다.
 *
 * 🔴 주석·문자열은 정본 `stripForScan`(길이 보존)으로 지운다. 이 저장소는 자체 정규식 제거기로
 *    두 번 틀렸다 — D4 는 문자열 속 `(system/​*)` 를 주석 시작으로 읽어 9,057자를 지웠고(라우트 4개 증발),
 *    E4 는 **자기 주석 속 `.catch(() => undefined)`** 를 코드로 세었다.
 */
export interface TxMethodRow {
  file: string;
  method: string;
  line: number;
  /** `$transaction` 밖 쓰기 수 */
  writes: number;
  /** 같은 메서드가 `$transaction` 을 쓰기도 하는가(일부만 묶인 자리) */
  partialTx: boolean;
  models: string[];
}

/** `$transaction` 콜백 안에서 `tx` 가 아니라 바깥 `prisma` 로 쓰는 자리 — 트랜잭션을 빠져나간다 */
export interface TxEscapeRow {
  file: string;
  line: number;
  model: string;
}

const WRITE_OPS = 'create|createMany|update|updateMany|upsert|delete|deleteMany';
/** 수신자까지 잡는다 — `tx.` 는 트랜잭션 안, `this.prisma.`/`prisma.` 는 밖 */
const WRITE_CALL = new RegExp(
  String.raw`\b(this\.prisma|this\.tx|prisma|tx|trx)\.(\w+)\.(${WRITE_OPS})\s*\(`,
  'g',
);
/**
 * 🔴 (2026-09-16 K4) 쓰기가 **헬퍼 뒤로 들어가면 이 스캐너에서 사라진다**(I2·J1 이 이미 남긴 한계).
 *    게이트 위반 원장을 정본 `recordGateViolation(this.prisma, …)` 으로 수렴시키자 inventory 의
 *    **의도된 tx 이탈 1건이 통째로 안 보이게 됐다** — 가드가 지키던 사실이 리팩터로 조용히 사라진 것이다.
 *    정본 헬퍼에 `this.prisma` 를 넘기는 호출은 같은 이탈로 센다(모델은 헬퍼가 쓰는 원장 하나로 고정).
 */
const CANON_WRITE_HELPERS: Array<{ re: RegExp; model: string }> = [
  { re: /\brecordGateViolation\(\s*this\.prisma\b/g, model: 'gateViolationLog' },
];
const METHOD_START = /^ {2}(?:private |public |protected )?(?:static )?(?:async )?(?:\*\s*)?([\w$]+)\s*[(<]/gm;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** `open` 위치의 괄호/중괄호를 균형으로 닫아 그 끝 인덱스를 돌려준다(못 닫으면 -1) */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[src[open]];
  if (!close) return -1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * `<` 위치의 제네릭 인자를 균형으로 닫는다(못 닫으면 -1).
 * 🔴 `matchBracket` 은 `<` 를 모른다 — 처음 이 파서를 그것으로 쓰자 제네릭 반환 타입 메서드가 **통째로 드롭**돼
 *    분모가 197 → 190 으로 **줄어** 보였다(고쳐서 준 것이 아니라 눈이 먼 것). 화살표 `=>` 는 닫는 괄호가 아니다.
 */
function matchAngle(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '<') depth++;
    else if (c === '>') {
      if (src[i - 1] === '=') continue; // `=>`
      depth--;
      if (depth === 0) return i;
    } else if (c === '{' || c === '(' || c === '[') {
      const e = matchBracket(src, i);
      if (e < 0) return -1;
      i = e;
    } else if (c === '}' || c === ';') return -1; // 타입 안에 올 수 없다 — 잘못 들어왔다
  }
  return -1;
}

interface Span { start: number; end: number; name: string; params?: string }

/**
 * 파라미터 목록 뒤의 **본문 `{`** 위치 — 반환 타입 주석을 끝까지 소비한 뒤의 `{` 다(못 찾으면 -1).
 *
 * 🔴 (2026-09-17 L1) 종전 판정은 `)` 뒤 **첫 `{`** 를 본문으로 삼고, 그 사이 문자가 타입처럼 보이면
 *    그대로 받아들였다. 그래서 `): Promise<{ ok: boolean }> {` 는 **제네릭 안의 `{`** 를 본문으로 잡아
 *    본문이 `{ ok: boolean }` 로 끝났고, 진짜 본문의 쓰기는 **한 건도 세지 않았다**.
 *    K2 가 멱등 스캐너에서 같은 함정을 찾아 `enqueueNims`·`createInpatientStayBilling` 두 메서드가
 *    통째로 안 보이던 것을 밝혔고(94→96), 이 축도 같은 방식으로 눈이 멀어 있었다.
 *    합성 확인: `plain`·`): Promise<{…}>`·`): { … }` 세 메서드 중 **첫 하나만** 보였다.
 *
 * 타입 표현을 원자·연산자로 소비한다. 원자 뒤에 곧바로 `{` 가 오면 그것이 본문이다
 * (타입끼리는 연산자 없이 중괄호로 이어지지 않는다). 파싱이 끝나지 않으면 -1 —
 * **본문을 지어내지 않는다**(잘못 잡으면 남의 메서드 쓰기를 제 것으로 센다).
 */
function findBodyBrace(src: string, parenEnd: number): number {
  let i = parenEnd + 1;
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  skipWs();
  if (src[i] !== ':') return src[i] === '{' ? i : -1; // 반환 타입 없음
  i++;
  let expectAtom = true;
  while (i < src.length) {
    skipWs();
    const c = src[i];
    if (!c) return -1;
    if (expectAtom) {
      if (c === '{' || c === '(' || c === '[') {
        const end = matchBracket(src, i);
        if (end < 0) return -1;
        i = end + 1;
        expectAtom = false;
        continue;
      }
      if (/[\w$'"`.]/.test(c)) {
        while (i < src.length && /[\w$'"`.]/.test(src[i])) i++;
        skipWs();
        if (src[i] === '<') { // 제네릭 인자
          const end = matchAngle(src, i);
          if (end < 0) return -1;
          i = end + 1;
        }
        expectAtom = false;
        continue;
      }
      return -1;
    }
    // 원자 뒤 — 본문이거나 타입 연산자다
    if (c === '{') return i;
    if (c === ';') return -1; // 오버로드 선언(본문 없음)
    if (c === '[') { // 배열 타입 `X[]`
      const end = matchBracket(src, i);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === '|' || c === '&' || c === '?' || c === ':' || c === ',') { i++; expectAtom = true; continue; }
    if (c === '=' && src[i + 1] === '>') { i += 2; expectAtom = true; continue; } // 함수 타입
    if (/[\w$]/.test(c)) { // `extends`·`is`·`keyof` 같은 타입 키워드
      while (i < src.length && /[\w$]/.test(src[i])) i++;
      expectAtom = true;
      continue;
    }
    return -1;
  }
  return -1;
}

/** 클래스 메서드 본문 구간 — 시작 `{` 부터 짝 `}` 까지 */
function methodSpans(blanked: string): Span[] {
  const spans: Span[] = [];
  METHOD_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_START.exec(blanked))) {
    const name = m[1];
    if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue;
    // 파라미터 목록을 닫고 본문 `{` 를 찾는다
    const paren = blanked.indexOf('(', m.index);
    if (paren < 0) continue;
    const parenEnd = matchBracket(blanked, paren);
    if (parenEnd < 0) continue;
    const brace = findBodyBrace(blanked, parenEnd);
    if (brace < 0) continue;
    const end = matchBracket(blanked, brace);
    if (end < 0) continue;
    spans.push({ start: brace, end, name, params: blanked.slice(paren + 1, parenEnd) });
  }
  return spans;
}

/**
 * `$transaction` 인자 구간 — 두 형태 모두 트랜잭션이다.
 *  · 콜백형 `$transaction(async (tx) => { … })` — 안에서 `tx.` 로 쓴다
 *  · 배열형 `$transaction([ … ])` **또는 배열을 내는 식** `$transaction(affected.map((c) => this.prisma.x.update(…)))`
 *    — 바깥 `prisma` 수신자라도 한 트랜잭션이다.
 *
 * 🔴 (첫 판 오답) 배열형을 `[` 로만 봤더니 `.map()` 으로 만든 배열형 5자리를 "트랜잭션을 빠져나간다"고 셌다
 *    (chemo·compounding 2·claim·dermatology). **배열형이 아니라 콜백형인지**로 판정한다 —
 *    `async` 로 시작하거나, `(` 로 시작하고 그 짝 뒤에 `=>` 가 오는 것만 콜백이다.
 */
function isCallbackForm(arg: string): boolean {
  const s = arg.trimStart();
  if (s.startsWith('[')) return false;
  if (/^async\b/.test(s)) return true;
  if (/^[\w$]+\s*=>/.test(s)) return true;
  if (s.startsWith('(')) {
    const close = matchBracket(s, 0);
    return close > 0 && /^\s*(?::[^=]*)?=>/.test(s.slice(close + 1));
  }
  return false;
}

/**
 * `$transaction` 을 **감싸는 정본 헬퍼** — 이 콜백 안의 `tx.` 도 트랜잭션이다.
 *
 * 🔴 면제는 이름만으로 두지 않는다. `tx-boundary-scan.spec` 이 각 헬퍼 소스에 `$transaction(` 이
 *    실재하는지 확인한다 — 헬퍼가 나중에 트랜잭션을 걷어내면 이 면제가 **조용한 구멍**이 되기 때문이다
 *    (E2 에서 면제를 이름으로만 뒀다가 그 자리의 대조를 지워도 가드가 통과한 적이 있다).
 */
export const TX_WRAPPERS: { fn: string; source: string }[] = [
  { fn: 'withAdvisoryLock', source: 'src/common/util/advisory-lock.ts' },
  { fn: 'withDoctorLock', source: 'src/modules/schedule/schedule.service.ts' },
];

function txSpans(blanked: string): { span: Span; isArray: boolean }[] {
  const out: { span: Span; isArray: boolean }[] = [];
  const re = new RegExp(String.raw`(?:\$transaction|\b(?:${TX_WRAPPERS.map((w) => w.fn).join('|')}))\s*\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked))) {
    const open = re.lastIndex - 1;
    const end = matchBracket(blanked, open);
    if (end < 0) continue;
    const arg = blanked.slice(open + 1, end);
    out.push({ span: { start: open, end, name: '$transaction' }, isArray: !isCallbackForm(arg) });
  }
  return out;
}

const inSpan = (i: number, s: Span) => i > s.start && i < s.end;

export function scanTxBoundaries(modulesDir: string): { rows: TxMethodRow[]; escapes: TxEscapeRow[] } {
  const rows: TxMethodRow[] = [];
  const escapes: TxEscapeRow[] = [];

  for (const f of walk(modulesDir)) {
    const src = readFileSync(f, 'utf8');
    const { blanked } = stripForScan(src);
    const file = relative(modulesDir, f);
    const methods = methodSpans(blanked);
    const txs = txSpans(blanked);

    for (const mth of methods) {
      const body = blanked.slice(mth.start, mth.end);
      WRITE_CALL.lastIndex = 0;
      let w: RegExpExecArray | null;
      const outside: string[] = [];
      let insideTx = 0;
      // 정본 헬퍼 경유 쓰기도 같은 규칙으로 센다(헬퍼 뒤에 숨지 않게)
      for (const helper of CANON_WRITE_HELPERS) {
        helper.re.lastIndex = 0;
        let h: RegExpExecArray | null;
        while ((h = helper.re.exec(body))) {
          const abs = mth.start + h.index;
          const enclosing = txs.find((t) => inSpan(abs, t.span));
          if (enclosing && !enclosing.isArray) {
            // 콜백 안인데 헬퍼가 바깥 prisma 로 쓴다 — 직접 쓰기와 같은 이탈
            escapes.push({ file, line: src.slice(0, abs).split('\n').length, model: helper.model });
          }
          // 🔴 tx 안이든 밖이든 **쓰기는 쓰기다** — 헬퍼로 옮겼다고 다중쓰기 수가 줄면
          //    "고쳐서 줄었다"와 "안 보이게 돼서 줄었다"를 구분할 수 없다.
          outside.push(helper.model);
        }
      }
      while ((w = WRITE_CALL.exec(body))) {
        const abs = mth.start + w.index;
        const receiver = w[1];
        const model = w[2];
        const enclosing = txs.find((t) => inSpan(abs, t.span));
        const viaTxParam = receiver === 'tx' || receiver === 'this.tx' || receiver === 'trx';
        if (enclosing && (enclosing.isArray || viaTxParam)) { insideTx++; continue; }
        if (enclosing && !viaTxParam) {
          // 콜백 안인데 바깥 prisma 로 쓴다 — 이 쓰기만 트랜잭션 밖으로 샌다
          escapes.push({ file, line: src.slice(0, abs).split('\n').length, model });
          outside.push(model);
          continue;
        }
        /**
         * `$transaction` 밖의 `tx.` — **그 메서드가 실제로 tx 를 받을 때만** 트랜잭션으로 친다
         * (호출자가 트랜잭션을 쥐고 넘겨주는 헬퍼: `private async foo(tx: Prisma.TransactionClient)`).
         *
         * 🔴 (재주입이 잡은 결함) 종전엔 이름이 `tx` 이기만 하면 트랜잭션으로 쳤다. 그래서
         *    `$transaction(async (tx) => …)` 를 `(async (tx) => …)` 로 바꿔 **트랜잭션을 통째로 벗겨도**
         *    가드가 통과했다 — 재주입 5건이 전부 "통과"로 나와서야 드러났다.
         *    가드는 결함을 되돌려 넣었을 때 실패해야 가드다.
         */
        if (viaTxParam && /\b(tx|trx)\s*[:,)]/.test(mth.params ?? '')) { insideTx++; continue; }
        outside.push(model);
      }
      if (outside.length >= 2) {
        rows.push({
          file,
          method: mth.name,
          line: src.slice(0, mth.start).split('\n').length,
          writes: outside.length,
          partialTx: insideTx > 0,
          models: [...new Set(outside)],
        });
      }
    }
  }
  return { rows, escapes };
}

export function writesByFile(rows: TxMethodRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
}
