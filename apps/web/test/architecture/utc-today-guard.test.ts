import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 UTC "오늘" 관용구 금지(2026-09-01) — `new Date().toISOString().slice(0,10)` 은 UTC 날짜라
 *    KST 00~09시에 어제를 준다. 56곳(간호 태블릿 급식·입원 타임라인·플로시트·검진 접수 조회 키와
 *    장비 점검일·식이 시작일 등 쓰기 기본값)이 새벽마다 하루 밀렸다 → 정본 kstToday()/kstTodayPlus().
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!['node_modules', '.next'].includes(f)) walk(p, out); }
    else if (/\.(tsx|ts)$/.test(f) && !/\.(test|spec)\./.test(f)) out.push(p);
  }
  return out;
}
const RX = /new Date\(\)\.toISOString\(\)\.(slice\(0,\s*10\)|split\('T'\)\[0\])/;
// 주석 제거 — 주석 속 관용구 인용(교훈 기록)을 소비처로 세지 않는다(스캐너가 주석을 셈 함정)
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('UTC-오늘 관용구 금지(기준선 0)', () => {
  it("new Date().toISOString().slice(0,10) 을 쓰는 파일이 없다 — kstToday() 를 쓴다", () => {
    const hits = walk(join(process.cwd(), 'src'))
      .filter((f) => !f.endsWith('kst-today.ts') && RX.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(process.cwd(), ''));
    expect(hits, 'KST 00~09시에 어제가 된다 — @/lib/kst-today 정본을 쓸 것').toEqual([]);
  });
  it('대조군 — 정본 소비처가 실제로 있다(치환이 무동작이 아니다)', () => {
    const users = walk(join(process.cwd(), 'src'))
      .filter((f) => /from '@\/lib\/kst-today'/.test(readFileSync(f, 'utf8')));
    expect(users.length).toBeGreaterThan(30);
  });
});
