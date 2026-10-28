import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// 계측 규칙 정본은 스캐너 하나 — 주석·문자열 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **실패를 삼킨 바로 뒤에서 성공을 말하는 화면 코드**(P16) — API 가드(`apps/api/test/architecture/
 * swallowed-failure-success-claim.spec.ts`)의 web·mobile 판.
 *
 * 2026-09-14 전수: web 후보 4 → 확정 0(전부 `!res.ok` 분기 안의 오류 본문 파싱 베스트에포트거나, 성공 문구가
 * 삼킨 동작이 아니라 별도 요청의 성공을 말한다) · mobile 후보 0. **결함 0 도 유효한 결과다** — 억지 가드를
 * 만들지 않되, 새 자리가 생기면 여기서 드러나도록 목록을 동결한다(수가 아니라 — 수로 동결하면 하나 고치고
 * 하나 만들어도 통과한다).
 *
 * 🔴 **상한이지 전수가 아니다** — 성공 신호를 어휘(toast 완료·`ok: true`·`setSaved(true)` …)로 찾는다.
 *    `queryFn` 안의 `.catch(() => 기본값)` 은 다른 축(`QueryErrorFallback` 도달 불가)이라 여기서 세지 않는다.
 */
const WEB_SRC = path.join(__dirname, '..', '..', 'src');
const MOBILE_ROOTS = ['src', 'app'].map((d) => path.join(__dirname, '..', '..', '..', 'mobile', d));
const WINDOW_LINES = 10;

const SWALLOW = /\.catch\(\s*(?:\([^)]*\)|\w+)?\s*=>\s*(?:\{\s*\}|undefined|null|void\s+0|false|\[\]|0)\s*\)|\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const SUCCESS = /toast(?:\.success)?\s*\(\s*(?:[^;]*?)(완료|성공|저장되었|되었습니다|success|saved|done|sent|발송|전송됨|등록되었|삭제되었)|set(?:Status|State|Step|Phase|Mode)\s*\(\s*['"](?:done|success|sent|saved|completed|complete|ok)['"]|set(?:Saved|Done|Sent|Success|Submitted|Completed|Confirmed)\s*\(\s*true\s*\)|(?:ok|success|sent|saved|done|applied|synced):\s*true|status:\s*['"](?:OK|SENT|DONE|SUCCESS|COMPLETED|SAVED)['"]|Alert\.alert\s*\([^;]*?(완료|성공|되었습니다)/i;

function srcFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (/^(node_modules|\.next|dist|__tests__|test)$/.test(e.name)) continue; out.push(...srcFiles(p)); }
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.(spec|test)\./.test(e.name)) out.push(p);
  }
  return out;
}

/** 순수 스캐너 — 코드 문자열에서 "삼킨 catch 뒤 WINDOW 줄 안의 성공 신호" 를 찾는다. 키 = 삼킨 줄의 정규화 텍스트 */
export function scanSwallowThenSuccess(source: string): string[] {
  const code = stripComments(source) as string;
  const lines = code.split('\n');
  const keys: string[] = [];
  for (const m of code.matchAll(SWALLOW)) {
    const startLine = code.slice(0, m.index).split('\n').length - 1;
    const endIdx = (m.index ?? 0) + m[0].length;
    const endLine = code.slice(0, endIdx).split('\n').length - 1;
    const tail = [code.slice(endIdx).split('\n')[0], ...lines.slice(endLine + 1, endLine + 1 + WINDOW_LINES)].join('\n');
    if (SUCCESS.test(tail)) keys.push(lines[startLine].trim().replace(/\s+/g, ' ').slice(0, 160));
  }
  return keys;
}

function scanTree(root: string, label: string): string[] {
  const hits: string[] = [];
  for (const f of srcFiles(root)) {
    const rel = `${label}/${path.relative(root, f).split(path.sep).join('/')}`;
    for (const k of scanSwallowThenSuccess(fs.readFileSync(f, 'utf8'))) hits.push(`${rel} :: ${k}`);
  }
  return hits.sort();
}

/**
 * 2026-09-14 실측 — 전부 읽고 정당으로 분류한 자리.
 *  homepage/media · homepage/popups   `!res.ok` 분기 안의 오류 본문 파싱(못 읽어도 HTTP 상태로 throw) — 성공 toast 는 ok 분기에서만
 *  location-stations                  목록 재조회 실패를 삼킨다(빈 목록 — P1 축의 개선 여지) · 성공 toast 는 **별도 POST** 의 성공
 *  portal/imaging                     응답 본문 파싱 베스트에포트 · `success: true` 는 `res.ok` 분기에서만
 *  lib/ai-stream-read (2026-10-07)    오류 이벤트로 **이미 실패 판정**한 스트림의 나머지 취소 — 뒤의 `ok: true` 는 실패 분기를 지나지 않은 경로
 */
const WEB_BASELINE = [
  "web/app/(main)/admin/homepage/media/page.tsx :: const body = await res.json().catch(() => null);",
  "web/app/(main)/admin/homepage/popups/page.tsx :: const body = await res.json().catch(() => null);",
  "web/app/(main)/admin/location-stations/page.tsx :: apiClient.get<{ data: Station[] }>('/api/v1/admin/location-stations').then((r) => setStations(r.data ?? [])).catch(() => {});",
  'web/app/portal/imaging/page.tsx :: const body = await res.json().catch(() => null);',
  'web/lib/ai-stream-read.ts :: await reader.cancel().catch(() => undefined);',
].sort();
const MOBILE_BASELINE: string[] = [];

describe('🔴 삼킨 실패 뒤 성공 주장(P16) — web·mobile 목록 동결', () => {
  it('대조군 — 탐지기가 대표 모양을 실제로 잡는다(0 이면 스캐너가 죽은 것)', () => {
    const bad = [
      'await api.post(url).catch(() => {});',
      "toast.success('저장 완료');",
      'try { await save(); } catch {}',
      'setSaved(true);',
    ].join('\n');
    expect(scanSwallowThenSuccess(bad)).toHaveLength(2);
  });

  it('대조군 — 실패를 알리는 catch 는 잡지 않는다', () => {
    const good = [
      "await api.post(url).catch((e) => toast.error(e.message));",
      "toast.success('저장 완료');",
    ].join('\n');
    expect(scanSwallowThenSuccess(good)).toEqual([]);
  });

  it('주석 속 모양은 세지 않는다', () => {
    expect(scanSwallowThenSuccess("// x.catch(() => {});\n// toast.success('완료');")).toEqual([]);
  });

  it('web src 의 자리가 목록과 정확히 같다(늘면 실패 · 줄면 목록에서 지운다)', () => {
    const hits = scanTree(WEB_SRC, 'web');
    expect(hits.length).toBeGreaterThan(0); // 하한 — 대상이 0 이면 조준이 빗나간 것이다
    expect(hits).toEqual(WEB_BASELINE);
  });

  it('mobile 의 자리가 목록과 정확히 같다(2026-09-14 실측 0 — 대상이 0 이라 하한은 두지 않는다 · 파일 수로 스캔 생존을 본다)', () => {
    const files = MOBILE_ROOTS.flatMap((r) => srcFiles(r));
    expect(files.length).toBeGreaterThan(20);
    expect(MOBILE_ROOTS.flatMap((r) => scanTree(r, 'mobile'))).toEqual(MOBILE_BASELINE);
  });
});
