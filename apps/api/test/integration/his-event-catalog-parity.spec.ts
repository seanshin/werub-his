import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HIS_EVENT_CATALOG } from '../../src/modules/integration/integration-outbox.service';

/**
 * 🔴 HIS 발신 이벤트 카탈로그 ↔ **실제 발신** 기계 대조 — 외부(ERP) 실측 §3(2026-09-21).
 *
 * `HIS_EVENT_CATALOG` 는 구독 등록 DTO 의 `@IsIn` 어휘다 — 여기 없는 이벤트는 **이름으로 구독할 수 없다**(400).
 * 실측: 발신 28 · 카탈로그 19 — 9종을 ERP 가 핸들러까지 갖추고도 이름을 적을 수 없었다.
 *
 * 이 가드는 손으로 센 목록을 다시 적지 않는다(그러면 정본이 둘이 된다). 두 방향을 본다:
 *   · 카탈로그 ⊆ 발신 — `outbox.enqueue()` 호출을 전수 스캔해 **도출한 집합**과 대조한다(죽은 어휘).
 *   · 발신 ⊆ 카탈로그 — 같은 도출값으로 대조하고, 그것을 **컴파일 시점에** 보장하는 타입(`event: HisEvent`)이
 *     `string` 으로 풀리지 않았는지도 본다(타입이 풀리면 tsc 는 아무것도 잡지 않는다).
 *
 * 🔴 **못 푼 자리는 통과가 아니라 실패다.** 이벤트 인자가 변수인데 출처를 추적하지 못하면 "발신이 없다"가
 *    아니라 "모른다"이고, 모르는 것을 초록으로 그리지 않는다.
 */

const API_SRC = resolve(process.cwd(), 'src');
const OUTBOX = join(API_SRC, 'modules', 'integration', 'integration-outbox.service.ts');

function walk(dir: string, out: string[] = []): string[] {
  // 🔴 `fs.globSync` 는 Node 22+ 다 — CI(engines 20)에서 조용히 죽는다. 재귀 순회로 쓴다.
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 메서드 선언처럼 보이지만 아닌 것들 — 역방향 탐색이 여기 걸리면 엉뚱한 이름을 잡는다 */
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'typeof', 'function', 'constructor']);

interface Site { file: string; line: number; raw: string }

/** enqueue 호출의 2번째 인자(이벤트)를 모은다 — 리터럴은 그대로, 변수는 같은 파일 안에서 푼다 */
export function collectEmittedEvents(): { events: Set<string>; unresolved: string[]; sites: Site[] } {
  const events = new Set<string>();
  const unresolved: string[] = [];
  const sites: Site[] = [];
  const call = /\.enqueue\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,/gs;

  for (const file of walk(API_SRC)) {
    const rawSrc = readFileSync(file, 'utf8');
    if (!rawSrc.includes('.enqueue(')) continue;
    if (file === OUTBOX) continue; // 정본 서비스 자신은 발신부가 아니다(선언이 여기 있다)
    const src = stripComments(rawSrc);

    for (const m of src.matchAll(call)) {
      const arg = m[2].trim();
      const line = src.slice(0, m.index ?? 0).split('\n').length;
      sites.push({ file, line, raw: arg });

      const lit = arg.match(/^'([^']+)'$/);
      if (lit) { events.add(lit[1]); continue; }

      // ① 같은 파일 안의 `const <id>(: 타입)? = … '리터럴' …;` — 삼항 등
      const assign = new RegExp(`const\\s+${arg}\\s*(?::\\s*[A-Za-z_][\\w.<>\\[\\]| ]*)?=([^;]+);`).exec(src);
      if (assign) {
        const lits = [...assign[1].matchAll(/'([a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*)'/g)].map((x) => x[1]);
        if (lits.length) { lits.forEach((l) => events.add(l)); continue; }
      }

      // ② 이 호출을 감싼 **발신 헬퍼**의 호출부 — `private emitX(event, …) { … enqueue(d, event, …) }`
      const before = src.slice(0, m.index ?? 0);
      const decls = [...before.matchAll(/(?:^|\n)\s*(?:private|protected|public)?\s*(?:async\s+)?([A-Za-z_]\w*)\s*\(/g)];
      const helper = decls.reverse().map((d) => d[1]).find((n) => !NOT_A_METHOD.has(n));
      if (helper) {
        const callers = [...src.matchAll(new RegExp(`this\\.${helper}\\(\\s*'([^']+)'`, 'g'))].map((x) => x[1]);
        if (callers.length) { callers.forEach((c) => events.add(c)); continue; }
      }

      unresolved.push(`${file}:${line} — enqueue 의 이벤트 인자 '${arg}' 를 추적하지 못했다`);
    }
  }
  return { events, unresolved, sites };
}

describe('HIS_EVENT_CATALOG ↔ 실제 발신(§3) — 도출값과 기계 대조', () => {
  const { events, unresolved, sites } = collectEmittedEvents();
  const catalog = HIS_EVENT_CATALOG as readonly string[];

  it('대조군 — 스캐너가 실제로 무언가를 찾는다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(20);
    expect(events.size).toBeGreaterThanOrEqual(25);
    expect(events.has('billing.line_recorded')).toBe(true); // 직접 리터럴
    expect(events.has('staff.created')).toBe(true); // 헬퍼 경유(hr.emitStaff)
    expect(events.has('equipment.acquired')).toBe(true); // 헬퍼 경유(equipment.erpEvent)
    expect(events.has('voucher.settled')).toBe(true); // 삼항 상수(voucher-billing)
  });

  it('🔴 추적하지 못한 발신 자리가 없다(모르는 것을 통과로 읽지 않는다)', () => {
    expect(unresolved).toEqual([]);
  });

  it('🔴 발신하는데 카탈로그에 없는 이벤트가 없다 — 있으면 이름으로 구독할 수 없다', () => {
    const missing = [...events].filter((e) => !catalog.includes(e)).sort();
    expect(missing).toEqual([]);
  });

  it('🔴 카탈로그에 있는데 아무도 발신하지 않는 이벤트가 없다(죽은 어휘 — 손으로 채운 흔적)', () => {
    const dead = catalog.filter((e) => !events.has(e)).sort();
    expect(dead).toEqual([]);
  });

  it('카탈로그에 중복이 없다', () => {
    expect(new Set(catalog).size).toBe(catalog.length);
  });

  /**
   * 🔴 "발신 ⊆ 카탈로그" 의 컴파일 시점 보장 — `enqueue` 와 발신 헬퍼가 `HisEvent` 타입을 받아야
   *    카탈로그 밖 이벤트가 tsc 에서 죽는다. 누가 `event: string` 으로 되돌리면 tsc 는 침묵하고
   *    이 스캔만 남는다 — 그 퇴행을 여기서 잡는다.
   */
  it('🔴 enqueue 와 모든 발신 헬퍼가 event 를 HisEvent 타입으로 받는다(string 으로 풀리면 tsc 보장이 사라진다)', () => {
    const outbox = stripComments(readFileSync(OUTBOX, 'utf8'));
    expect(outbox).toMatch(/async enqueue\(\s*domain: string,\s*event: HisEvent,/);
    expect(outbox).toMatch(/export type HisEvent = \(typeof HIS_EVENT_CATALOG\)\[number\]/);

    // 변수 인자로 enqueue 를 부르는 파일 = 헬퍼가 있는 파일. 그 헬퍼 선언(또는 상수)이 HisEvent 로 묶여 있어야 한다.
    const helperFiles = [...new Set(sites.filter((s) => !/^'/.test(s.raw)).map((s) => s.file))];
    expect(helperFiles.length).toBeGreaterThanOrEqual(5); // hr·equipment·inpatient·distributor·voucher-billing
    const loose = helperFiles.filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'));
      return !/\b(?:event|eventType)\s*:\s*HisEvent\b/.test(src);
    });
    expect(loose, '이 파일의 발신 헬퍼가 event 를 string 으로 받는다 — 카탈로그 밖 이벤트가 tsc 를 지나간다').toEqual([]);
  });
});
