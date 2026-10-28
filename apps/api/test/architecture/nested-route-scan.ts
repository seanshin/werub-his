import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 중첩 경로 스캐너 — `@Controller` **클래스 경계**를 따라 전체 경로를 만든다.
 *
 * 🔴 D2(2026-09-16)의 첫 스캔은 71자리라고 셌고 **오답**이었다: 한 파일에 `@Controller` 클래스가 여럿인데
 *    파일의 첫 prefix 를 전부에 붙여 `admissions/:admissionId/:id/administer` 같은 **없는 경로**를 만들었다.
 *    그래서 여기서는 클래스 선언마다 prefix 를 새로 잡는다 — 스캐너 자신을 먼저 검사한다(`nested-route-scan.spec`).
 */

export interface RouteRow {
  file: string;
  cls: string;
  method: string;
  /** 컨트롤러 prefix + 핸들러 경로 */
  path: string;
  /** 경로 파라미터(선언 순서) */
  params: string[];
  /** 핸들러 이름 */
  handler: string;
  /** 핸들러 시그니처의 줄 번호(1-based) — 동명 핸들러가 한 파일에 여럿이라 이름으로 찾으면 다른 메서드를 본다 */
  handlerLine: number;
}

const HTTP = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/;
const CLASS = /@Controller\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/;
const HANDLER = /^\s*(?:async\s+)?(\w+)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const join2 = (a: string, b: string) => [a, b].filter(Boolean).join('/').replace(/\/+/g, '/');

export function scanRoutes(modulesDir: string): RouteRow[] {
  const rows: RouteRow[] = [];
  for (const f of walk(modulesDir)) {
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n');
    let prefix: string | null = null;
    let cls = '';
    for (let i = 0; i < lines.length; i++) {
      const c = CLASS.exec(lines[i]);
      if (c) {
        prefix = c[1] ?? c[2] ?? c[3] ?? '';
        // 다음 줄들에서 클래스 이름을 찾는다(데코레이터가 여러 줄일 수 있다)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const m = /export class (\w+)/.exec(lines[j]);
          if (m) { cls = m[1]; break; }
        }
        continue;
      }
      const h = HTTP.exec(lines[i]);
      if (!h || prefix === null) continue;
      const sub = h[2] ?? h[3] ?? h[4] ?? '';
      const path = join2(prefix, sub);
      // 핸들러 이름 — 데코레이터 줄들을 넘어 첫 메서드 시그니처
      let handler = '';
      let handlerLine = 0;
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        if (/^\s*@/.test(lines[j])) continue;
        const m = HANDLER.exec(lines[j]);
        if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) {
          handler = m[1];
          handlerLine = j + 1;
          break;
        }
      }
      rows.push({
        file: relative(modulesDir, f),
        cls,
        method: h[1].toUpperCase(),
        path,
        params: [...path.matchAll(/:(\w+)/g)].map((m) => m[1]),
        handler,
        handlerLine,
      });
    }
  }
  return rows;
}

/** 경로 파라미터가 2개 이상 — 부모(그리고 부모의 부모)까지 사슬로 대조해야 하는 자리 */
export const nestedRoutes = (rows: RouteRow[]) => rows.filter((r) => r.params.length >= 2);
