/**
 * 허용 인쇄(sanctionedPrint) ↔ 인쇄 전용 문서 — 2026-10-12.
 *  · 🔴 공용 문서 CSS 가 인쇄 루트 없이도 body 직계를 숨겨 인쇄 버튼 12곳이 빈 종이였다(사용자 신고 · 결정 대장)
 *  · 이제 인쇄 버튼이 있는 파일은 인쇄 전용 문서(.doc-print-root — PrintDoc·PrintRaw·DocumentFrame·*Print 부품·print 프롭)를 그린다
 *  · 예외는 이유와 함께 — 인쇄 문서를 부모가 그리는 버튼 부품
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '../../src');
function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
}
const PRINT_DOC = /PrintDoc|PrintRaw|DocumentFrame|doc-print-root|<[A-Z][A-Za-z]*Print\b|\bprint=\{\{/;
/** 인쇄 문서를 부모가 그리는 버튼 부품 → 부모 파일 */
const PARENT: Record<string, string> = {
  'app/(main)/patients/[id]/components/BoardHeaderBar.tsx': 'app/(main)/patients/[id]/page.tsx', // 큰 화면 보기 머리 — 차트 인쇄본은 차트 화면이 한 번 그린다
};
/** 정의 파일 — PrintGuard(sanctionedPrint) · 결정 인쇄본 발급 훅(usePrintIssue — 문서는 그 훅을 쓰는 화면이 그린다) */
const DEFINES = new Set(['components/print/PrintGuard.tsx', 'components/print/usePrintIssue.tsx']);
/** 인쇄 호출 — 직접 호출(인자 있음 포함) 또는 발급 후 인쇄 훅(2026-10-12 기획 P0 — 결정 대장·의사결정서) */
const CALL = /sanctionedPrint\(|usePrintIssue\(/;

describe('🔴 허용 인쇄 버튼은 인쇄 전용 문서를 그린다(빈 종이 방지)', () => {
  const callers = walk(SRC).filter((f) => CALL.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f)).filter((f) => !DEFINES.has(f));
  it('호출처가 있다(대상 0 으로 헛돌지 않는다)', () => {
    expect(callers.length).toBeGreaterThanOrEqual(12);
  });
  it('모든 호출처(또는 지정 부모)가 인쇄 문서를 그린다', () => {
    const bad = callers.filter((f) => !PRINT_DOC.test(readFileSync(join(SRC, PARENT[f] ?? f), 'utf8')));
    expect(bad).toEqual([]);
  });
  it('🔴 발급 후 인쇄 화면(결정 대장·의사결정서)도 호출처로 센다 — 훅으로 옮겨 가드 밖으로 빠지지 않게', () => {
    expect(callers).toEqual(expect.arrayContaining(['app/(main)/admin/decisions/register/page.tsx', 'app/(main)/admin/decisions/[key]/page.tsx', 'components/golive/GoLiveBriefing.tsx', 'app/(main)/admin/duty-schedule/page.tsx', 'app/(main)/print/qi-report/[id]/page.tsx']));
  });
  it('예외 부모 지정은 실제 호출처다', () => {
    for (const f of Object.keys(PARENT)) expect(callers).toContain(f);
  });
});
