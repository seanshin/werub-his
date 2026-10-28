import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `@Cron` 핸들러 계측 — **무엇이 조용히 죽을 수 있는가**를 센다(2026-09-16 E4).
 *
 * 이 저장소의 이력: 모듈 등록 누락으로 크론이 사라졌는데 화면은 "위반 0건"이었고,
 * 실행 비트 하나가 정기 백업을 89일 막았다(무음 실패). 그래서 세는 것은 세 가지다.
 *
 *  · `swallows`   — 빈 `catch {}` 나 `.catch(() => {})` 로 **실패를 없앤다**
 *                   (로그도 원장도 없이 삼키면, 크론이 매번 실패해도 화면은 초록이다)
 *  · `unhandled`  — try/catch 가 아예 없다. 실패는 스케줄러로 새어 **unhandledRejection 으로만** 보인다
 *                   (삼키는 것과는 다른 사실이다 — pm2 로그에는 남지만 원장·화면에는 없고 **작업은 중간에 끊긴다**)
 *  · `logsOnly`   — 실패가 로그에만 남는다(운영에서 아무도 안 본다 — 원장·감시자와 구분한다)
 *  · `recorded`   — 실패가 DB 원장(CronRun·outbox·감사 등)이나 감시자에 남는다
 *
 * 🔴 **`unhandled`·`logsOnly` 가 곧 결함은 아니다.** 부수적 정리 작업은 그것으로 충분하다.
 *    되돌릴 수 없는 것(대외 발신·청구·법정 보고)만 원장이 필요하다 — 한 건씩 봐야 안다.
 *    🔴 첫 판은 이 둘을 `swallows` 로 합쳐 세어 **21건이 실패를 삼킨다**고 말할 뻔했다(오답).
 *    가드가 지키는 것은 **삼키는 자리가 늘지 않는다** 하나다.
 */
export interface CronRow {
  file: string;
  line: number;
  /** 메서드명 */
  name: string;
  /** `@Cron(...)` 인자 원문 */
  schedule: string;
  /** 실패가 어디에 남는가 — **catch 블록 안**을 본다 */
  failure: 'swallows' | 'unhandled' | 'logsOnly' | 'recorded';
  /** 같은 잡이 겹쳐 돌지 않게 막는가(인스턴스 플래그·advisory lock·DB 선점) */
  overlapGuarded: boolean;
}

const CRON = /@Cron\(/g;
/**
 * 🔴 실패가 어디에 남는지는 **catch 블록 안**을 봐야 안다.
 *    첫 판은 메서드 본문 전체에서 `prisma.*.create` 를 찾아 '원장 기록'이라 셌다 — 그러면
 *    본문이 DB 를 쓰기만 하면 실패를 로그로만 남겨도 '기록됨'이 된다(audit 앵커링이 그렇게 잘못 분류됐다).
 */
const RECORDS_IN_CATCH = /prisma\.\w+\.(create|update|upsert)|recordFailure|cronRun|outbox|auditLog|emit\w*Failure/i;
const LOGS_IN_CATCH = /logger\.(error|warn)|console\.(error|warn)/;
/** 겹침 방지 — 인스턴스 플래그·advisory lock·조건부 선점 */
const OVERLAP = /private\s+\w*[Rr]unning|advisory_lock|pg_try_advisory|updateMany\(\{[\s\S]{0,400}?where:[\s\S]{0,200}?status:/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 괄호 균형으로 인자 블록을 뽑는다 */
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

/**
 * 🔴 주석을 지운다 — **이 가드가 처음 틀린 이유**다(2026-09-16).
 *    E4 가 삼킴을 고치면서 주석에 `종전 \`.catch(() => undefined)\`` 라고 **왜 고쳤는지**를 적었더니,
 *    스캐너가 그 주석 문자열을 코드로 읽어 **고친 파일을 여전히 삼킨다**고 셌다.
 *    (저장소 이력: v4.11.0 에서 같은 함정으로 가드 9건이 다른 이유로 통과·실패했다)
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 중괄호 균형으로 메서드 본문을 뽑는다 */
function methodBody(src: string, fromIdx: number): { name: string; body: string } {
  const after = src.slice(fromIdx);
  const sig = after.match(/\n\s{2}(?:private |public |protected )?(?:async )?([\w$]+)\s*\(/);
  if (!sig || sig.index == null) return { name: '?', body: after.slice(0, 2000) };
  const bodyStart = after.indexOf('{', sig.index + sig[0].length);
  if (bodyStart < 0) return { name: sig[1], body: after.slice(0, 2000) };
  let depth = 0;
  for (let i = bodyStart; i < after.length; i++) {
    if (after[i] === '{') depth++;
    else if (after[i] === '}') {
      depth--;
      if (depth === 0) return { name: sig[1], body: after.slice(bodyStart, i + 1) };
    }
  }
  return { name: sig[1], body: after.slice(bodyStart, bodyStart + 4000) };
}

/**
 * catch 블록들의 내용을 뽑는다(주석 제거).
 * 🔴 주석만 있는 catch 는 **빈 것**이다 — "실패는 무시"라고 적어둔 자리를 세지 않으면 이 축이 통째로 안 보인다.
 */
function catchBodies(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]{0,600}?)\}/g)) {
    out.push(m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim());
  }
  // `.catch(() => {})` · `.catch(() => undefined)` 형태도 삼키는 것이다
  //
  // 🔴 단 **설정 조회의 폴백은 제외한다** — `config.get('x').catch(() => null) ?? 기본값` 은 이 저장소의
  //    문서화된 규약이고(미설정과 조회 실패를 같은 기본값으로 접는 것이 의도), 여기 섞으면 기준선이
  //    설정 읽기로 가득 차 **진짜 작업 경로의 삼킴이 묻힌다**(첫 판이 그래서 8건 중 6건이 설정 읽기였다).
  const CONFIG_READ = /(config\w*|configRuntime)\??\.get\([^)]*\)\s*$/i;
  for (const m of body.matchAll(/\.catch\(\s*\(?[\w$]*\)?\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\)/g)) {
    const before = body.slice(Math.max(0, m.index! - 120), m.index!);
    if (CONFIG_READ.test(before.trim())) continue;
    out.push('');
  }
  return out;
}

export function scanCrons(srcDir: string): CronRow[] {
  const rows: CronRow[] = [];
  for (const f of walk(srcDir)) {
    const src = readFileSync(f, 'utf8');
    CRON.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CRON.exec(src))) {
      const openIdx = CRON.lastIndex - 1;
      const schedule = callArgs(src, openIdx).split('\n')[0].trim();
      const { name, body: rawBody } = methodBody(src, openIdx);
      const body = stripComments(rawBody);
      // 클래스 전체를 봐야 알 수 있는 것(인스턴스 플래그 선언)은 파일 단위로 본다
      const overlapGuarded = OVERLAP.test(body) || OVERLAP.test(src);

      const catches = catchBodies(body);
      // 🔴 빈 catch 가 **먼저**다 — 원장에 쓰는 크론이라도 실패를 삼키면 그게 사실이다
      const failure: CronRow['failure'] = catches.some((c) => c === '')
        ? 'swallows'
        : catches.length === 0
          ? 'unhandled'
          : catches.some((c) => RECORDS_IN_CATCH.test(c))
            ? 'recorded'
            : catches.some((c) => LOGS_IN_CATCH.test(c))
              ? 'logsOnly'
              : 'logsOnly';

      rows.push({
        file: relative(srcDir, f),
        line: src.slice(0, m.index).split('\n').length,
        name,
        schedule,
        failure,
        overlapGuarded,
      });
    }
  }
  return rows;
}

/** 실패를 삼키는 크론 — 파일별 수 */
export function swallowingByFile(rows: CronRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.failure === 'swallows') out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
}

/** try/catch 가 없어 실패가 스케줄러로 새는 크론 — 파일별 수 */
export function unhandledByFile(rows: CronRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.failure === 'unhandled') out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
}
