import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 🔴 날짜·시각 호출에 **로케일 리터럴을 박는 자리**를 센다 — 2026-09-13.
 *
 * 사각지대: 기존 `clinical-ux-rules` 의 날짜 가드는 `\.toLocale(Date|Time)String\(` 만 셌다.
 *   ① `toLocaleString(` 은 아예 안 셌는데, `toLocaleString('ko')` 54곳 중 약 50곳이 **날짜**였다(수신자 실측).
 *   ② 파일 단위라 한 파일에 원시 호출이 남아 있으면 그 파일의 다른 회수·재발이 수에 안 드러났다
 *      (재주입이 `rounds/page.tsx` 에서 "통과해 버린" 사례 — 4차 날짜 회수).
 *   ③ 네 차례 회수가 모두 `'ko-KR'` 리터럴만 겨눠 `'ko'` 로 적은 123곳이 빠졌다.
 * 그 자리들은 어떤 UI 언어에서도 `2026. 9. 12. 오전 9:05:00` 을 그렸고, 관리자 표기 정책(`ui.dateStyle`·`ui.time24h`)도 우회했다.
 * 정본은 `lib/ui-settings` 의 `kdate`/`useKdate`/`<KDate>`(모드 `KDateMode`).
 *
 * 세는 규칙(**호출 단위** · 주석 제외):
 *   - `.toLocaleDateString('ko'|'ko-KR' …)` · `.toLocaleTimeString('ko'|'ko-KR' …)` — 전부 날짜/시각이다.
 *   - `.toLocaleString('ko'|'ko-KR' …)` — **수신자가 날짜일 때만**: `new Date(…)` 이거나 마지막 식별자가
 *     `…At`·`…Date`·`date`·`…Time`·`time` 로 끝나는 경우. 숫자(`count.toLocaleString('ko-KR')` 천단위)는 세지 않는다.
 * 🔴 휴리스틱이라 **놓칠 수는 있어도(수신자가 `d`·`x` 같은 이름) 숫자를 날짜로 세지는 않게** 좁혔다 — 대조군이 지킨다.
 * 🔴 여유 0 — 늘면 실패, 줄면 기준선을 낮춘다(병행 회수 F2·F3 병합 후 본선이 재계측한다).
 */

const SRC = path.resolve(__dirname, '../../src');
const SCAN_ROOTS = [path.join(SRC, 'app'), path.join(SRC, 'components')];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 주석 제거 — 규약을 적어 둔 주석을 위반으로 세지 않는다(문자열 안의 `//` 는 드물어 감수) */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LOCALE_ARG = String.raw`\(\s*(['"])ko(?:-KR)?\1`;
const DATE_TIME_CALL = new RegExp(String.raw`\.toLocale(?:Date|Time)String${LOCALE_ARG}`, 'g');
const STRING_CALL = new RegExp(String.raw`\.toLocaleString${LOCALE_ARG}`, 'g');
/**
 * 날짜로 볼 수 있는 수신자 끝 식별자. `dt` 는 이름 전체가 일치할 때만(실측: `const dt = new Date(…)` 2곳).
 * 🔴 `d` 는 넣지 않았다 — 같은 이름이 날짜(VitalsTab)와 숫자(sentinel 증감)로 둘 다 쓰인다. 놓치는 쪽을 택한다.
 */
const DATE_IDENT = /(?:At|Date|date|Time|time)$|^dt$/;

/** `.toLocaleString(` 앞 수신자가 날짜인가 */
export function isDateReceiver(src: string, dot: number): boolean {
  const before = src.slice(0, dot);
  if (before.endsWith(')')) {
    let depth = 0;
    for (let j = before.length - 1; j >= 0; j--) {
      if (before[j] === ')') depth++;
      else if (before[j] === '(') {
        depth--;
        if (depth === 0) return /new\s+Date$/.test(before.slice(0, j));
      }
    }
    return false;
  }
  const m = /([A-Za-z_$][\w$]*)[?!]?$/.exec(before);
  return !!m && DATE_IDENT.test(m[1]);
}

export function countDateLocaleLiterals(raw: string): number {
  const src = stripComments(raw);
  let n = (src.match(DATE_TIME_CALL) ?? []).length;
  for (const m of src.matchAll(STRING_CALL)) if (isDateReceiver(src, m.index!)) n++;
  return n;
}

const FILES = SCAN_ROOTS.flatMap((r) => walk(r));
const total = () => FILES.reduce((n, f) => n + countDateLocaleLiterals(fs.readFileSync(f, 'utf-8')), 0);

/**
 * 2026-09-13 F1+F2+F3 병합 후 본선 재계측 **87**(F1 트리 단독 163 → F2 53곳·F3 23곳 반영).
 * 🔴 병행 갈래가 각자 기준선을 박으면 병합 순간 틀린다 — 기준선은 합친 트리에서 한 번만 잰다.
 */
// 2026-09-13 (W6 · T9 마감) 87 → **31**: 옵션 없는 `new Date(…).toLocaleString('ko'|'ko-KR')`(초까지 찍던 서명·수납·동의 철회·오더 단계 시각)
//   52곳/35파일 → 정본 `datetimeSec` · `EctSection` 2(`dateStyle/timeStyle short`) → `datetime` · `VitalsTab` 차트 축 → `dateShortYear`.
//   남은 31: display/**·(homepage)·print(축 결정) · 수신자가 `new Date(…)` 가 아닌 식(휴리스틱이 날짜로 판정한 이름) 등.
// 2026-09-13 (갈래 g · dayPeriod) 31 → **15**: Linux Node 22 가 ko-KR 12시간제를 `AM`/`PM` 으로 내는 결함(본선 95a91ca9) —
//   시각이 들어간 원시 호출 16곳을 shared `localeTimeText`/`localeDateTimeText`(고정 서식: 전광판·인쇄·예약) 또는 `kdate`(표시 정책)로.
const BASELINE = 15;

describe('🔴 날짜·시각 호출의 로케일 리터럴 — 호출 단위 동결', () => {
  it('대조군 — 판정기가 날짜 호출을 세고 숫자·주석은 세지 않는다', () => {
    expect(countDateLocaleLiterals(`const a = new Date(x).toLocaleString('ko');`)).toBe(1);
    expect(countDateLocaleLiterals(`const a = row.createdAt.toLocaleString('ko-KR');`)).toBe(1);
    expect(countDateLocaleLiterals(`const a = d.toLocaleDateString("ko", { month: 'long' });`)).toBe(1);
    expect(countDateLocaleLiterals(`const a = new Date().toLocaleTimeString('ko-KR');`)).toBe(1);
    // 🔴 숫자 천단위는 날짜가 아니다
    expect(countDateLocaleLiterals(`const a = total.toLocaleString('ko-KR'); const b = Number(x).toLocaleString('ko');`)).toBe(0);
    // 🔴 (2026-09-13 W6) 원무 보드의 금액 `won = (n) => \`${n.toLocaleString('ko')}원\`` 은 날짜가 아니다 — 초 단위 회수에서 남긴 자리
    expect(countDateLocaleLiterals("const won = (n: number) => `${n.toLocaleString('ko')}원`;")).toBe(0);
    // 🔴 주석은 세지 않는다 · 로케일을 넘기지 않는 호출(정본 내부·다른 로케일)은 세지 않는다
    expect(countDateLocaleLiterals(`// new Date(x).toLocaleString('ko')\nconst t = d.toLocaleDateString(localeTag);`)).toBe(0);
    expect(FILES.length, '스캔 대상이 사라졌다').toBeGreaterThan(500);
  });

  it('🔴 호출 수가 기준선과 정확히 같다(늘면 실패 · 줄면 낮춘다)', () => {
    const n = total();
    expect(n, `날짜·시각 호출에 로케일 리터럴을 박은 자리 ${n}건(기준선 ${BASELINE}) — 정본 \`kdate\`/\`useKdate\` 를 쓰세요`).toBe(BASELINE);
  });
});
