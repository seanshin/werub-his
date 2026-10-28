/**
 * 🔴 (2026-09-14 P6) 공개 사이트 앱(apps/homepage)은 격리 빌드라 web·api tsc 가 보지 않는다.
 *    "의존성 부재로 오류 73건"이라던 기록은 틀렸다 — 실측은 4개 페이지의 **JSX 구문 오류** 73건(`typecheck.mjs` 머리말).
 * 지키는 것: ① 측정이 실제로 됐다(측정 불가를 0 으로 세지 않는다) ② 오류는 파일별 기준선을 넘지 않는다(여유 0 — 고치면 낮춘다)
 *           ③ 새로 생긴 오류가 구문 외 종류(모듈 없음 등)면 기준선과 따로 실패한다
 * 🔴 tsc 는 **구문 오류가 하나라도 있으면 의미 검사(모듈 없음·타입 불일치)를 내지 않는다** — 그래서 기준선이 구문 오류로 차 있던 동안
 *    이 가드는 없는 모듈 import 를 넣어도 통과했다. 2026-09-14 Q6 에서 4파일 구문 오류를 고쳐 기준선 0 → 이제 의미 오류 한 건도 실패다.
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../../homepage/scripts/typecheck.mjs');

// 🔴 (2026-09-14 Q6) 4페이지 구문 오류 교정(JSX 주석을 `map(s => (` 괄호 밖으로 — 주석 한 줄 이동뿐) → 0.
//    구문 오류가 사라져 의미 검사 층이 드러났고, 드러난 의미 오류도 0 이었다(없는 모듈·타입 불일치 주입 시 TS2307·TS2322 검출로 확인).
const BASELINE: Record<string, number> = {};

describe('apps/homepage 타입 검사 기준선', () => {
  it('측정되고, 오류가 0 이다(구문·의미 모두 — 구문 오류가 없어 의미 검사가 실제로 돈다)', { timeout: 240_000 }, () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', timeout: 230_000 });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { total: number; byFile: Record<string, number>; byCode: Record<string, number>; syntaxOnly: boolean };
    expect(out.byFile, JSON.stringify(out.byCode)).toEqual(BASELINE);
    expect(out.total).toBe(0);
  });
});
