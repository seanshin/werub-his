import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { stripForScan } from './egress-scan';

/**
 * 재시도·멱등 계측 — **분모를 먼저 세는 도구**다(2026-09-16 J4).
 *
 * 세는 것: 서비스 메서드 안에서 **결과가 남는 모델**(처방·오더·청구·재고·투약·조제·발송·법정보고)에
 * `create`/`createMany` 를 부르는 자리. 사용자가 버튼을 **다시 누르거나** 크론·웹훅이 재전송하면
 * 그 행이 **한 벌 더** 생길 수 있다(이 저장소 이력: 사전처방 재승인 → 처방·오더 한 벌 더,
 * 재고 부서청구 재승인 → 이중 차감, outbox 재시도 표시 실패 → 같은 발송 영원히 반복).
 *
 * 🔴 **`무방비` 가 곧 결함은 아니다.** 처음 한 번만 만들 수 있는 자리(생성 EP), 상태 전이가 이미
 *    두 번째 호출을 막는 자리, 자연키에 DB 유니크가 걸린 자리가 섞여 있다. 한 건씩 봐야 안다 —
 *    그래서 "N건이 결함"이라고 말하지 않는다. 지키는 것은 **조용히 늘지 않는다** 하나다.
 *
 * 🔴 주석·문자열은 정본 `stripForScan`(길이 보존)으로 지운다. 이 저장소는 자체 제거기로 네 번 틀렸다
 *    (D4 문자열 속 `(system/​*)`·E4 자기 주석 속 `.catch`·I4 정규식 리터럴을 나눗셈으로·G2 `else if` 안쪽).
 */
export interface IdempotencyRow {
  file: string;
  method: string;
  line: number;
  /** 이 메서드가 만드는 결과 모델(중복되면 아픈 것만) */
  models: string[];
  /** 중복을 막는 장치 — 없으면 빈 배열 */
  guards: GuardKind[];
}

export type GuardKind =
  /** 만들기 전에 이미 있는지 본다(findUnique·findFirst·count) */
  | 'preCheck'
  /** upsert — 자연키로 한 행을 보장한다 */
  | 'upsert'
  /** 상태 전이를 강제한다(두 번째 호출은 전이 불가로 막힌다) */
  | 'transition'
  /** 조건부 갱신(where 에 상태)로 경합을 DB 가 판정한다 */
  | 'conditionalUpdate'
  /** 멱등키·중복키를 명시적으로 쓴다 */
  | 'idemKey'
  /**
   * 이미 만들어진 것을 읽어 **건너뛰고 이어서** 만든다(부분 성공 재개).
   * 🔴 `findMany` 하나만으로는 가드라 볼 수 없다(조회 목적이 대부분이다) — 건너뛰기(`Set`·`has(`)와
   *    함께 있을 때만 인정한다. 이렇게 좁히지 않으면 가드가 헐거워져 진짜 무방비를 흡수한다.
   */
  | 'resumeSkip';

/**
 * 중복되면 아픈 모델 — 금전·재고·투약·법정보고·대외발신.
 * 🔴 로그·감사·이력처럼 **여러 벌이 정상인 것**은 세지 않는다(세면 분모가 거짓으로 부푼다).
 */
const CONSEQUENTIAL = new RegExp(
  [
    'prescription', 'order(?!Item)', 'billing', 'billingItem', 'claim', 'payment', 'installment',
    'dispensing', 'compounding', 'compoundingOrder', 'medicationAdministration',
    'inventory', 'stock', 'stockTransaction', 'departmentRequest',
    // 🔴 (2026-09-28 재판정 a13360) CSSD 재고 원장 — `instrumentItem.stock` 과 짝으로 움직이므로
    //    "여러 벌이 정상인 로그"가 아니다(발주 입고 이중 계상이 이 모델에 남았다). 종전엔 빠져 있었다.
    'supplyTransaction',
    'voucher', 'voucherIssue', 'transfusion', 'bloodRequest',
    'integrationOutbox', 'externalReport', 'nimsReport', 'infectionReport',
    'leaveRequest', 'leaveBalance', 'attendance',
  ].join('|'),
  'i',
);

/**
 * 🔴 (2026-09-28 재판정 a13360) 트랜잭션 클라이언트 이름을 `tx`·`trx` 로 **못박아** 두었다가
 *    `$transaction(async (txc) => …)` 한 자리(CSSD 발주 입고)의 쓰기를 통째로 못 봤다. 이름 하나 바꾸면
 *    계측이 조용히 눈을 감는다 — `tx` 로 시작하는 식별자를 전부 받는다(대조군: 스펙의 `txc` 픽스처).
 */
const WRITE_CREATE = /\b(?:this\.prisma|this\.tx|prisma|trx|tx\w*)\.(\w+)\.(create|createMany)\s*\(/g;

/**
 * 🔴 교차 서비스 생성도 센다(2026-09-16 J4). 첫 판은 `prisma.*.create` 만 보아 **항암 사이클 개시가
 *    `this.compounding.createOrder()` 로 조제 지시를 만드는 것을 못 봤다** — I2 가 기록만 남긴 바로 그
 *    자리이고, 이 저장소가 반복해 당한 "헬퍼 뒤에 숨은 쓰기"다(I2 자신도 CSSD 원장 3경로에서 같은 것을 겪었다).
 *    주입 서비스(`this.<이름>`)의 생성형 메서드 호출을 `svc:<이름>.<메서드>` 로 남긴다.
 */
const WRITE_VIA_SERVICE =
  /\bthis\.(\w+)\.(create\w*|issue\w*|generate\w*|submit\w*|enqueue\w*|dispatch\w*)\s*\(/g;
/** 주입 서비스가 아닌 것(자기 유틸·prisma·로거)은 뺀다 */
const NOT_A_SERVICE = /^(prisma|tx|trx|logger|config|configService|eventEmitter|events|jwt|http)$/;

const GUARD_PATTERNS: ReadonlyArray<readonly [GuardKind, RegExp]> = [
  ['preCheck', /\.(findUnique|findFirst|count)\s*\(/],
  ['upsert', /\.upsert\s*\(/],
  ['transition', /assert\w*Transition|assertStateTransition|canTransition\w*/],
  ['conditionalUpdate', /updateMany\s*\(\s*\{[\s\S]{0,400}?where\s*:[\s\S]{0,300}?status\s*:/],
  ['idemKey', /idempotenc|idemKey|dedupKey|dedupHours|\bref\s*:\s*[`'"]/i],
  ['resumeSkip', /\.findMany\s*\([\s\S]{0,600}?(?:new Set\s*\(|\.has\s*\()/],
];

const METHOD_START = /^ {2}(?:private |public |protected )?(?:static )?(?:async )?(?:\*\s*)?([\w$]+)\s*[(<]/gm;

/**
 * 🔴 (2026-09-28 재판정 a13360) 메서드 경계 정규식은 **2칸 들여쓰기 + 이름 + `(`** 만 본다 — 그래서 모듈 최상위
 *    함수 안의 `  if (…)`·`  for (…)` 를 **메서드 이름으로 읽었다**. 그중 `checkup.service.ts` 의 `if` 하나는
 *    클래스 전체를 자기 본문으로 삼아 허수 한 줄(`method:'if'`)을 기준선에 올려 두고 있었다.
 *    🔴 이 줄을 빼면 총계가 준다 — "줄었으니 고쳐졌다"가 아니라 **허수가 빠진 것**이다.
 */
const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else', 'try', 'with']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/**
 * 메서드 본문의 끝 인덱스(못 닫으면 src.length).
 *
 * 🔴 첫 판은 메서드 시작 뒤 **첫 `{`** 를 본문 시작으로 삼았다가, 파라미터 안의 타입 리터럴
 *    (`opts?: { overrideGate?: boolean }`)을 잡아 **본문을 통째로 건너뛰었다** — 항암 `startCycle` 이
 *    그래서 스캔에서 사라졌다(이 갈래가 겨눈 바로 그 자리다). 파라미터 괄호를 먼저 균형으로 닫고,
 *    그 뒤의 `{` 부터 본문으로 센다.
 */
function methodEnd(src: string, from: number): number {
  const paren = src.indexOf('(', from);
  let afterParams = from;
  if (paren >= 0) {
    let d = 0;
    for (let i = paren; i < src.length; i++) {
      if (src[i] === '(') d++;
      else if (src[i] === ')') {
        d--;
        if (d === 0) { afterParams = i; break; }
      }
    }
  }
  /**
   * 🔴 (2026-09-16 K2) 파라미터 뒤 **첫 `{`** 를 본문으로 삼으면 이번엔 **반환 타입**에 걸린다 —
   *    `): Promise<{ recorded: boolean; … }> {` 의 `{` 를 본문 시작으로 읽어 본문이 타입 리터럴로 잘리고,
   *    그 안의 `create` 가 통째로 안 보인다. J4 가 파라미터 쪽(`opts?: { … }`)만 고치고 남겨둔 짝이며,
   *    실제로 이 갈래에서 `enqueueNims`·`createInpatientStayBilling` 이 스캐너에서 **사라졌다**
   *    (가드가 "무방비가 줄었다"고 거짓 안심을 말하는 자리다).
   *
   *    본문 `{` = **꺾쇠 안이 아니고**(`Promise<{…}>` 제외), 바로 앞 글자가 `:`·`|`·`&` 가 아닌 것
   *    (타입 리터럴은 언제나 그 뒤에 온다). 들여쓰기·줄수로 고르면 한 줄 본문(`) {}` 인 생성자)이
   *    **다음 메서드를 삼킨다** — 첫 판이 실제로 그랬다.
   */
  let angle = 0;
  for (let i = afterParams + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '<') angle++;
    else if (ch === '>') { if (angle > 0) angle--; }
    else if (ch === '{') {
      if (angle > 0) continue; // 제네릭 안의 타입 리터럴
      const prev = src.slice(0, i).replace(/\s+$/, '').slice(-1);
      if (prev === ':' || prev === '|' || prev === '&') continue; // 반환 타입 리터럴
      let depth = 0;
      for (let k = i; k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}') {
          depth--;
          if (depth === 0) return k;
        }
      }
      return src.length;
    }
  }
  return src.length;
}

/** 메서드 경계(제어문 제외) — 클래스 안 2칸 들여쓰기 규약 */
function methodBounds(blanked: string): { name: string; start: number; end: number }[] {
  const bounds: { name: string; start: number; end: number }[] = [];
  METHOD_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_START.exec(blanked))) {
    if (JS_KEYWORDS.has(m[1])) continue; // 제어문은 메서드가 아니다
    bounds.push({ name: m[1], start: m.index, end: methodEnd(blanked, m.index) });
  }
  return bounds;
}

export function scanIdempotency(modulesDir: string): IdempotencyRow[] {
  const rows: IdempotencyRow[] = [];
  for (const f of walk(modulesDir)) {
    if (!f.endsWith('.service.ts')) continue;
    rows.push(...scanIdempotencySource(relative(modulesDir, f), readFileSync(f, 'utf8')));
  }
  return rows;
}

/** 파일 하나를 센다 — 스캐너 자신을 픽스처로 검사하는 대조군이 이 입구를 쓴다 */
export function scanIdempotencySource(file: string, raw: string): IdempotencyRow[] {
  const rows: IdempotencyRow[] = [];
  const { blanked } = stripForScan(raw);
  const bounds = methodBounds(blanked);

  for (const b of bounds) {
    const body = blanked.slice(b.start, b.end);
    const models = new Set<string>();
    WRITE_CREATE.lastIndex = 0;
    let w: RegExpExecArray | null;
    while ((w = WRITE_CREATE.exec(body))) {
      if (CONSEQUENTIAL.test(w[1])) models.add(w[1]);
    }
    WRITE_VIA_SERVICE.lastIndex = 0;
    while ((w = WRITE_VIA_SERVICE.exec(body))) {
      if (NOT_A_SERVICE.test(w[1])) continue;
      if (CONSEQUENTIAL.test(w[1]) || CONSEQUENTIAL.test(w[2])) models.add(`svc:${w[1]}.${w[2]}`);
    }
    if (models.size === 0) continue;

    const guards: GuardKind[] = [];
    for (const [kind, re] of GUARD_PATTERNS) if (re.test(body)) guards.push(kind);

    rows.push({
      file,
      method: b.name,
      line: blanked.slice(0, b.start).split('\n').length,
      models: [...models].sort(),
      guards,
    });
  }
  return rows;
}

/**
 * 이름으로 메서드 **본문**을 잘라낸다 — 주석은 지우고 문자열은 남긴 판(`withStrings`)으로 돌려준다.
 *
 * 🔴 왜 본문인가 — 판정의 코드 앵커를 **파일 전체**에서 찾으면 다른 메서드의 같은 코드가 대신 통과한다
 *    (`code: data.code` 는 inventory 의 createItem·createStorage·createSupplier 셋에 있다).
 * 🔴 왜 주석을 지우는가 — 주석에 적어 둔 옛 코드가 앵커를 대신 만족시킨다(캠페인 계측 사각 #8).
 * 🔴 동명 메서드가 둘 이상이면 **고르지 않고 null** — 이름으로 엉뚱한 메서드를 집는 것이 사각 #3 이었다.
 */
export function methodBodyOf(src: string, method: string): string | null {
  const { withStrings, blanked } = stripForScan(src);
  const hits = methodBounds(blanked).filter((b) => b.name === method);
  if (hits.length !== 1) return null;
  return withStrings.slice(hits[0].start, hits[0].end);
}

/** 무방비(가드 0) 자리를 파일별로 센다 */
export function unguardedByFile(rows: IdempotencyRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.guards.length === 0) out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
}
