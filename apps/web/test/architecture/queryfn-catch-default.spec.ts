/**
 * 🔴 queryFn 안의 실패 삼킴 — `.catch(() => 기본값)`·`try {} catch { return 기본값 }`
 *
 * 규칙(CLAUDE.md 판정 규칙 1): queryFn 안에서 실패를 기본값으로 resolve 하면 `isError` 가 영원히 false 가 되어
 * `QueryErrorFallback` 이 도달 불가 코드가 되고, 화면은 "없음/기본 모드"를 사실처럼 말한다.
 *
 * 기존 `clinical-ux-rules.spec.ts` 는 앱 전역의 `.catch(() => [({[]` **패턴 수**(146 이하)를 센다 — queryFn 밖도 섞이고
 * 여유가 있어 신규 위반을 흡수할 수 있다. 이 가드는 **queryFn 본문 안만** 보고, 남은 자리를 **목록으로 동결**한다
 * (수로 동결하면 하나 고치고 하나 만들어도 통과한다).
 *
 * 2026-09-14 전수 14 → 결함 4 교정 · 정당 판정 10 + 404 만 접는 교정본 2 = 12 동결.
 *  - 교정: ErArrivalBanner(설정 조회 실패 → 배너 조용히 사라짐)·ErpLauncher(조회 실패 → erp.enabled 기본 true 로 런처 노출)·
 *          SignatureBadge·SignatureStatusIndicator(403·500 도 "서명 필요" — 404 만 NONE)
 *  - 정당: 키별/환자별/날짜별 부분 실패를 `ok:false` 로 들고 나가 화면이 말하는 자리(er-beds·nurse-station×3·therapy),
 *          403 을 forbidden 3상태로 두고 나머지 재throw(use-widget-query), 404 만 접고 재throw(OpNotePanel·서명 2),
 *          표시 선호의 로컬 폴백 체인(dashboard-config·ChartBoard 레이아웃), 렌더 표면 없는 표시 설정 훅(ui-settings — 기본값=현행 표기)
 * 세는 규칙·분류 근거: docs/05-reference/swallowed-failure-scan.md §3차
 * 한계: queryFn 이 **다른 파일의 헬퍼**를 부르고 그 헬퍼가 삼키는 모양은 보지 않는다(인라인 본문만).
 *   → `lib`·`hooks` 헬퍼는 `helper-swallow-list.spec.ts` 가 파일별 동결 · `components/**` 헬퍼 훅은 2026-09-15 1회 전수(45)로
 *     확정 2곳 교정(`test/ui/component-helper-swallow.spec.tsx`) — components 쪽은 **동결하지 않았다**(신규는 이 가드들이 못 본다).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 주석을 같은 길이 공백으로 — 줄 번호 보존 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, (m, a: string) => a + ' '.repeat(m.length - a.length));
}

export interface QueryFnCatchHit { file: string; kind: 'catch' | 'try'; rethrows: boolean }

/** queryFn: 뒤 식(깊이 0 의 `,`/닫는 괄호까지) 안의 `.catch(` 와 `catch {` */
export function scanQueryFnCatches(source: string, file: string): QueryFnCatchHit[] {
  const s = stripComments(source);
  const hits: QueryFnCatchHit[] = [];
  const re = /\bqueryFn\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    let j = start;
    for (; j < s.length; j++) {
      const c = s[j];
      if (quote) { if (c === '\\') { j++; continue; } if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
    }
    const body = s.slice(start, j);
    const push = (idx: number, kind: 'catch' | 'try') => {
      const seg = body.slice(idx, idx + 260);
      hits.push({ file, kind, rethrows: /\bthrow\b/.test(seg) });
    };
    for (const c of body.matchAll(/\.catch\(/g)) push(c.index!, 'catch');
    for (const t of body.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) push(t.index!, 'try');
  }
  return hits;
}

const hitsOf = () => walk(SRC).flatMap((f) => scanQueryFnCatches(readFileSync(f, 'utf8'), relative(SRC, f)));
const key = (h: QueryFnCatchHit) => `${h.file} · ${h.kind}${h.rethrows ? ' · rethrow' : ''}`;

/** 동결 목록 — 늘면 새 삼킴, 줄면 회수(목록에서도 지운다) */
const FROZEN: readonly string[] = [
  'app/(main)/admin/er-beds/page.tsx · try',
  'app/(main)/dashboard/hooks/use-dashboard-config.ts · try',
  'app/(main)/dashboard/hooks/use-widget-query.ts · try · rethrow',
  'app/(main)/nurse-station/page.tsx · catch',
  'app/(main)/nurse-station/page.tsx · catch',
  'app/(main)/nurse-station/page.tsx · catch',
  'app/(main)/patients/[id]/components/board/ChartBoard.tsx · catch',
  'app/(main)/surgery/components/OpNotePanel.tsx · catch · rethrow',
  'app/(main)/workstation/therapy/TherapyCalendarView.tsx · catch',
  // 2026-10-07 판정: 정당 — 재원 환자 AI 위험 예측을 차례로 셋 부르며 항목마다 {failed, busy} 를 명시(실패를 '없음'으로 바꾸지 않고 ?·⏳ 로 그린다 · 한 항목 실패가 다른 항목을 지우지 않게)
  'components/inpatient/AiRiskBadges.tsx · try',
  'components/signature/SignatureBadge.tsx · catch · rethrow',
  'components/signature/SignatureStatusIndicator.tsx · catch · rethrow',
  'lib/ui-settings.tsx · catch',
];

describe('queryFn 안 실패 삼킴 — 목록 동결', () => {
  it('대조군 — 탐지기가 인라인 .catch·try/catch 를 잡고, 주석·queryFn 밖·재throw 를 구분한다', () => {
    const src = [
      "useQuery({ queryKey: ['a'], queryFn: () => api.get('/x').catch(() => []) });",
      "useQuery({ queryKey: ['b'], queryFn: async () => { try { return await api.get('/y'); } catch { return null; } } });",
      "useQuery({ queryKey: ['c'], queryFn: () => api.get('/z').catch((e) => { if (nf(e)) return null; throw e; }) });",
      "// useQuery({ queryFn: () => api.get('/c').catch(() => []) })",
      "const outside = api.get('/w').catch(() => []);",
    ].join('\n');
    const hits = scanQueryFnCatches(src, 'fixture.tsx');
    expect(hits.map(key)).toEqual(['fixture.tsx · catch', 'fixture.tsx · try', 'fixture.tsx · catch · rethrow']);
  });

  it('남은 자리가 동결 목록과 정확히 같다(여유 0)', () => {
    expect(hitsOf().map(key).sort()).toEqual([...FROZEN].sort());
  });

  it('교정한 4곳이 되살아나지 않는다 — 실패를 기본값/열린 상태로 접지 않는다', () => {
    const read = (p: string) => stripComments(readFileSync(join(SRC, p), 'utf8'));
    expect(read('app/(main)/reception/components/ErArrivalBanner.tsx')).toMatch(/cfgQ\.isError/);
    expect(read('components/layout/ErpLauncher.tsx')).toMatch(/if \(isError \|\| data === undefined\) return null/);
    for (const p of ['components/signature/SignatureBadge.tsx', 'components/signature/SignatureStatusIndicator.tsx']) {
      const code = read(p);
      expect(code).not.toMatch(/\.catch\(\(\)\s*=>\s*\(\{\s*status:\s*'NONE'/);
      expect(code).toMatch(/if \(isError\)/);
    }
  });
});
