import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 `?date=today` 금지(2026-09-01) — 서버 schedule 에 'today' 특례가 있었지만
 *    전역 DateQueryPipe(YYYY-MM-DD 강제)가 컨트롤러 **앞**에서 400 으로 거른다(파이프는 가드 뒤,
 *    컨트롤러 앞). 의사 "오늘 예약" 위젯 3곳이 파이프 도입 시점부터 죽어 있었다(운영 실증).
 *    FE 는 실날짜(KST: toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}))를 보낸다.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!['node_modules', '.next'].includes(f)) walk(p, out); }
    else if (/\.(tsx|ts)$/.test(f)) out.push(p);
  }
  return out;
}

describe('date=today 리터럴 금지', () => {
  it('API 호출에 date=today 를 보내는 파일이 없다', () => {
    const hits: string[] = [];
    for (const f of walk(join(process.cwd(), 'src'))) {
      const s = readFileSync(f, 'utf8');
      if (/api\/[^\n`'"]*[?&]date=today\b/.test(s)) hits.push(f.replace(process.cwd(), ''));
    }
    expect(hits, 'DateQueryPipe 가 400 으로 거른다 — 실날짜(KST)로 보낼 것').toEqual([]);
  });
  it('대조군 — 스캔이 실제 API 호출 파일을 읽고 있다', () => {
    const files = walk(join(process.cwd(), 'src'));
    const withApi = files.filter((f) => /api\/v1\//.test(readFileSync(f, 'utf8')));
    expect(withApi.length).toBeGreaterThan(100);
  });
});
