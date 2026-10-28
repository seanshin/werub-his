import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 상태 쓰기 계측 — **분모를 먼저 세는 도구**다(2026-09-15 D1).
 *
 * 세는 것: `prisma|tx.<model>.update|updateMany|upsert` 의 `data` 안에 상태 필드(status·state·*Status·*State)가 든 호출.
 * 분류(휴리스틱 — 상한이지 확정이 아니다):
 *  · `정본`   — 같은 메서드 안에서 전이 정본(assert*Transition·canTransition*·*OrThrow 등)을 부른다
 *  · `조건부` — `where` 에 상태를 걸어 DB 가 경합을 판정한다(`updateMany({ where: { id, status } })`)
 *  · `선행검사` — 상태를 읽어 비교하고 예외를 던지거나 `{ …: false }` 로 미적용을 돌려주는 코드가 같은 메서드 안에 있다
 *  · `검사안함` — 위 어느 것도 아니다(= 읽지 않고 쓴다)
 *
 * 🔴 **`검사안함` 이 곧 결함은 아니다.** 생성 직후 첫 전이·관리 설정 토글·크론 일괄 갱신처럼 정당한 것이 섞여 있다.
 *    한 건씩 봐야 안다 — 그래서 "N건이 결함"이라고 말하지 않는다. 지키는 것은 **늘지 않는다** 하나다.
 */
export interface StatusWriteRow {
  file: string;
  line: number;
  model: string;
  op: 'update' | 'updateMany' | 'upsert';
  cls: '정본' | '조건부' | '선행검사' | '검사안함';
}

const STATUS_FIELD = /(^|[\s{,])(status|state|[a-zA-Z]+Status|[a-zA-Z]+State)\s*:/;
/**
 * 🔴 (2026-10-01 사각 봉합) 종전 수신자는 `tx|prisma|this.prisma|this.tx` 넷으로 **고정**이었다 — 트랜잭션 콜백을 `t`·`trx`·`db` 로 받거나
 *    `const db = client ?? this.prisma` 처럼 별칭을 두면 그 쓰기는 **세어지지도 않았다**(기준선이 늘지 않으니 가드가 침묵).
 *    이제 수신자는 아무 식별자(·`this.` 사슬)나 받되, **둘째 마디가 스키마의 모델 이름**일 때만 센다(`this.service.update` 같은 것은 모델이 아니다).
 *    2026-10-01 실측: 별칭 수신자의 상태 쓰기 0건 — 지금 새는 것은 없고, 앞으로 새지 않게 한다.
 */
const CALL = /(?<![\w$.])((?:this\.)?[A-Za-z_$][\w$]*)\.(\w+)\.(update|updateMany|upsert)\s*\(/g;
const CANON = /assert\w*Transition|VALID_\w+_TRANSITIONS|canTransition\w*|\w+OrThrow\(|assertActive\w*|ensure\w+\(|assertStateTransition/;
const READS_STATUS = /\.(status|state|\w+Status|\w+State)\s*(===|!==|==|!=)|\b(status|state)\s*(===|!==)/;
const THROWS = /throw new \w+Exception|throw new Error/;
/**
 * 🔴 (2026-09-16) 던지지 않고 **바뀐 것이 없다는 사실을 돌려주는** 가드도 선행검사다 —
 *    D3 가 인증서 승인 P16 을 고치며 `status !== 'PENDING'` 이면 `{ approved: false, reason }` 을 돌려주게 했는데,
 *    이 스캐너가 "예외를 던져야 검사"라고만 보아 **고친 자리를 '검사안함' 으로 셌다**(기준선이 늘어 실패).
 *    좁게 인식한다 — 상태를 읽고 `…: false` 로 미적용을 말하는 반환. 넓히면 아무 return 이나 통과한다.
 */
const RETURNS_UNCHANGED = /return\s*\{[^}]*\b(approved|applied|changed|updated|recorded|reset)\s*:\s*false/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 괄호 균형으로 호출 인자 블록을 뽑는다(중첩 객체·화살표 함수를 넘기기 위해) */
function callArgs(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return '';
}

/** 메서드 시작 추정 — 2칸 들여쓴 클래스 메서드 또는 최상위 함수 */
function methodStart(src: string, idx: number): number {
  const before = src.slice(0, idx);
  const lines = before.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^ {2}(?:private |public |protected )?(?:static )?(?:async )?[\w$]+\s*[(<]/.test(lines[i]) || /^export (?:async )?function /.test(lines[i])) {
      return before.length - lines.slice(i).join('\n').length;
    }
  }
  return Math.max(0, idx - 3000);
}

/** 스키마의 모델 이름(소문자 시작 — Prisma 클라이언트 위임 이름) */
export function prismaModelNames(schemaPath: string): Set<string> {
  const names = [...readFileSync(schemaPath, 'utf8').matchAll(/^model (\w+) \{/gm)].map((x) => x[1][0].toLowerCase() + x[1].slice(1));
  return new Set(names);
}

/** 소스 하나에서 상태 쓰기를 찾는다(테스트 대조군이 합성 소스로 부른다) */
export function scanStatusWritesInSource(src: string, file: string, models: Set<string>): StatusWriteRow[] {
  const rows: StatusWriteRow[] = [];
  CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL.exec(src))) {
    if (!models.has(m[2])) continue;
    const row = classify(src, m, file);
    if (row) rows.push(row);
  }
  return rows;
}

export function scanStatusWrites(modulesDir: string, schemaPath = join(modulesDir, '..', '..', 'prisma', 'schema.prisma')): StatusWriteRow[] {
  const models = prismaModelNames(schemaPath);
  const rows: StatusWriteRow[] = [];
  for (const f of walk(modulesDir)) rows.push(...scanStatusWritesInSource(readFileSync(f, 'utf8'), relative(modulesDir, f), models));
  return rows;
}

function classify(src: string, m: RegExpExecArray, file: string): StatusWriteRow | null {
  const openIdx = CALL.lastIndex - 1;
  const args = callArgs(src, openIdx);
  const dataIdx = args.indexOf('data:');
  const dataBlock = dataIdx >= 0 ? args.slice(dataIdx) : args;
  if (!STATUS_FIELD.test(dataBlock)) return null;

  const ctx = src.slice(methodStart(src, m.index), m.index);
  const whereBlock = args.slice(0, dataIdx >= 0 ? dataIdx : args.length);
  const cls: StatusWriteRow['cls'] = CANON.test(ctx)
    ? '정본'
    : /where\s*:[\s\S]*?\b(status|state|\w+Status|\w+State)\s*:/.test(whereBlock)
      ? '조건부'
      : READS_STATUS.test(ctx) && (THROWS.test(ctx) || RETURNS_UNCHANGED.test(ctx))
        ? '선행검사'
        : '검사안함';

  return {
    file,
    line: src.slice(0, m.index).split('\n').length,
    model: m[2],
    op: m[3] as StatusWriteRow['op'],
    cls,
  };
}

/**
 * 🔴 (2026-10-01) 두 번째 사각 — **원문 SQL 의 상태 쓰기**(`UPDATE <표> SET … status = …`)는 위 스캐너가 보지 못한다.
 *    실측 0건(주석 1·날짜 롤·분류 열·updated_at 은 상태가 아니다). 0 으로 동결한다 — 생기면 이 목록이 알린다.
 */
const RAW_STATUS_UPDATE = /UPDATE\s+"?[a-z_]+"?\s+SET\b[^;`]*?\b("?(?:status|state|[a-z_]+_status|[a-z_]+_state)"?)\s*=/gi;
export function scanRawStatusUpdates(modulesDir: string, strip: (s: string) => string): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  for (const f of walk(modulesDir)) {
    const src = strip(readFileSync(f, 'utf8'));
    RAW_STATUS_UPDATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RAW_STATUS_UPDATE.exec(src))) out.push({ file: relative(modulesDir, f), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

export function uncheckedByFile(rows: StatusWriteRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.cls === '검사안함') out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
}
