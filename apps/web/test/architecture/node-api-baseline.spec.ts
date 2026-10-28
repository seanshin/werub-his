import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Node 실행 기준선 가드 — 2026-09-08.
 *
 * 🔴 **로컬에서만 있는 API 를 쓰면 로컬에서만 초록이다.**
 *    `fs.globSync` 는 Node 22+ 전용인데 이 저장소의 실행 기준선은
 *    `package.json engines: ">=20.0.0"` 이다(개발 머신은 Node 25).
 *    그래서 두 가드(`stat-card-alignment` · `bidi-isolation`)가 로컬에서는 통과한 채
 *    Node 20 환경에서는 `TypeError: globSync is not a function` 으로 **닷새(09-03~09-08) 죽어 있었다.**
 *    가드가 죽은 것을 아무도 몰랐고, 그 뒤에 붙은 검사들도 함께 멎었다.
 *
 * 이 가드는 그 실행 기준선을 소스에서 동결한다.
 * 🔴 **조사한 것만 적는다** — 실제로 이 저장소에서 겪은 API 만 넣는다(넓게 잡으면 오탐이 가드를 죽인다).
 *    기준선을 22 이상으로 올린다면(engines 를 함께 올린다) 여기서 지운다.
 */
const ROOT = join(process.cwd(), '..', '..');
const SCAN = ['apps/web/src', 'apps/web/test', 'apps/api/src', 'packages/shared/src'];
const EXT = /\.(ts|tsx|mts|cts|js|mjs)$/;

/** Node 22+ 에만 있는 API(실제로 겪은 것만). 값은 사람이 읽을 설명. */
const NODE22_ONLY: Array<[RegExp, string]> = [
  [/\bglobSync\s*\(/, 'fs.globSync 는 Node 22+ — readdirSync 재귀로 훑는다'],
  [/\bfrom\s+'node:fs'[^\n]*\bglob\b/, 'node:fs 의 glob/globSync 는 Node 22+'],
  [/\bimport\s*\(\s*'node:fs'\s*\)[^\n]*\bglob/, 'node:fs 의 glob/globSync 는 Node 22+'],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

describe('Node 실행 기준선(engines)', () => {
  it('🔴 engines 가 선언한 하한을 넘는 API 를 쓰지 않는다 — 로컬에서만 초록이 된다', () => {
    const engines = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines?.node as string | undefined;
    // 🔴 기준선이 사라지면 이 검사는 아무것도 보증하지 않는다 — 먼저 확인한다
    expect(engines, 'package.json engines.node 가 없습니다 — 이 가드의 기준이 사라집니다').toBeDefined();
    // 하한 = 첫 번째 숫자(`>=22.0.0 <23.0.0` → 22). `replace(/[^\d.]/g)` 로 합치면 상한 숫자까지 붙어 틀린다.
    const major = Number(/(\d+)/.exec(String(engines))?.[1]);
    expect(Number.isFinite(major), `engines(${engines}) 에서 하한을 읽지 못했습니다`).toBe(true);

    const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
    // 🔴 대상이 0 이면 검사가 헛돈다 — 실제로 훑었는지 먼저 본다
    expect(files.length, '스캔 대상을 찾지 못했습니다 — 검사가 헛돕니다').toBeGreaterThan(2000);

    /**
     * 🔴 (2026-09-13 상용 릴리즈 T2-6) engines 를 `>=22.0.0 <23.0.0` 로 올렸다(서버 v22.22.1 · CI 도 22 로 맞춘다).
     *    기준선이 22 이상이면 Node 22 전용 API 는 더 이상 위반이 아니다 — 이 가드가 적어 둔 규칙대로 그 검사를 끈다.
     *    다만 가드는 지우지 않는다: engines 를 다시 20 대로 내리면 검사가 되살아나야 한다(대조: 아래 분기).
     *    🔴 전제 — CI·서버가 **실제로** 22 여야 이 완화가 사실이다(ci.yml NODE_VERSION · deploy.sh HIS_NODE_MAJOR 가 그 값을 강제한다).
     */
    if (major >= 22) return;

    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const [re, why] of NODE22_ONLY) {
        const m = re.exec(src);
        if (m) hits.push(`${relative(ROOT, f)}: ${m[0].trim().slice(0, 80)} — ${why}`);
      }
    }
    expect(hits, `Node ${major} 환경에서 TypeError 로 죽습니다:\n  ${hits.join('\n  ')}`).toEqual([]);
  });
});
