import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 화면이 부르는 EP × 서버 라우트 표 — **없는 경로를 부르는 호출**을 찾는다.
 *
 * 🔴 발굴 25회차(2026-08-30)에서 이 스캐너가 **여섯 번 틀렸다.** 전부 실측이 교정했다:
 *   ① 문자열 안의 `/*`(`'… system/*) …'`)를 주석 시작으로 읽어 FHIR 컨트롤러의
 *      **뒷부분 전체가 사라졌다** — 라우트 5종이 없는 것처럼 보였다.
 *   ② `@Controller()`(빈 prefix·핸들러에 전체 경로)를 못 읽어 clinic-schedule 10라우트 누락.
 *   ③ `src/modules` 만 훑어 `src/common` 컨트롤러 누락.
 *   ④ 중첩 템플릿(`${c ? `?a=${b}` : ''}`)에서 문자열을 중간에 잘랐다.
 *   ⑤ `/items${q ? '?a=1' : ''}` 의 조건부 **쿼리스트링**을 경로 세그먼트로 읽었다.
 *   ⑥ `apiClient.fetch` 의 `method` 를 뒤 500자에서 찾아 **다음 호출의 `method:'POST'`** 를
 *      주워왔다(GET 4건을 POST 로 오판).
 *   그리고 한 번은 오탐을 없애려다 `:x` 로 끝나는 **정상 호출 378개**를 통째로 뺐다 —
 *   빼지 않고 `pending`(판정 보류)으로 가른다.
 */
export function stripComments(src: string): string {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < n) {
        const e = src[i];
        if (e === '\\') { out += e + (src[i + 1] ?? ''); i += 2; continue; }
        out += e; i++;
        if (e === q) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

export interface Route { m: string; p: string; file: string }

export function serverRoutes(apiSrc = join(process.cwd(), 'src')): Route[] {
  const out: Route[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) { walk(f); continue; }
      if (!e.endsWith('.controller.ts')) continue;
      const s = stripComments(readFileSync(f, 'utf8'));
      const marks = [...s.matchAll(/@Controller\(\s*(?:'([^']*)')?\s*\)/g)];   // ②
      for (let i = 0; i < marks.length; i++) {
        const at = marks[i].index!;
        const seg = s.slice(at, i + 1 < marks.length ? marks[i + 1].index! : s.length);
        const prefix = '/' + (marks[i][1] ?? '').replace(/^\//, '');
        for (const m of seg.matchAll(/@(Get|Post|Put|Patch|Delete|Sse)\(\s*'?([^')]*)'?\s*\)/g)) {
          // 🔴 `@Sse()` 는 전송 방식일 뿐 **HTTP 메서드는 GET** 이다 — SSE 로 담으면
          //    화면의 `fetch(...)`(GET)와 안 맞아 오탐이 된다(command-center 스트림에서 확인).
          const meth = m[1].toUpperCase() === 'SSE' ? 'GET' : m[1].toUpperCase();
          out.push({ m: meth, p: (prefix + '/' + (m[2] || '')).replace(/\/+/g, '/').replace(/\/$/, ''), file: f });
        }
      }
    }
  };
  walk(apiSrc);   // ③
  return out;
}

/** 따옴표 깊이를 세며 리터럴을 끝까지 읽는다 — 중첩 템플릿(④)에서 잘리지 않게 */
// 🔴 반환 out 은 보간을 축약한 **정규화 문자열**이라 out.length ≠ 소스 길이다.
//    소스 오프셋이 필요한 호출부(⑥ method 탐색)를 위해 닫는 따옴표의 **소스 인덱스**를 함께 준다 —
//    종전엔 lit.length 로 오프셋을 계산해 보간이 긴 리터럴(`${(c as any).type}`)에서 arg 창이
//    리터럴 중간으로 밀려 method:'PUT' 을 못 보고 GET 으로 오독했다(2026-09-01 실증).
function readLiteral(s: string, i: number): { val: string; end: number } | null {
  const q = s[i];
  if (!'`\'"'.includes(q)) return null;
  let out = '', depth = 0;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { out += c + s[j + 1]; j++; continue; }
    if (q === '`' && c === '$' && s[j + 1] === '{') { depth++; out += '${'; j++; continue; }
    if (depth > 0) {
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) out += '}'; continue; }
      if (c === '`') {                       // 보간 안쪽의 중첩 템플릿을 통째로 건너뛴다
        let k = j + 1, nd = 0;
        for (; k < s.length; k++) {
          const cc = s[k];
          if (cc === '\\') { k++; continue; }
          if (cc === '$' && s[k + 1] === '{') { nd++; k++; continue; }
          if (nd > 0) { if (cc === '}') nd--; continue; }
          if (cc === '`') break;
        }
        j = k; continue;
      }
      continue;
    }
    if (c === q) return { val: out, end: j };
    out += c;
  }
  return null;
}

export interface Call { meth: string; path: string; file: string; line: number }

/**
 * 🔴 **web 만 훑으면 절반이다** — 모바일 환자앱(74호출)·홈페이지 앱(16호출)도 같은 서버를 부르고,
 *    web 안에도 `apiClient` 를 안 쓰는 **원시 `fetch()` 90여 곳**이 있다. 표면을 다 센다.
 */
export const CALL_SURFACES = [
  ['web', join(process.cwd(), '..', 'web', 'src')],
  ['mobile', join(process.cwd(), '..', 'mobile')],
  ['homepage', join(process.cwd(), '..', 'homepage', 'src')],
] as const;

export function clientCalls(webSrc?: string): Call[] {
  if (webSrc) return callsIn(webSrc);
  return CALL_SURFACES.flatMap(([, dir]) => callsIn(dir));
}

function callsIn(webSrc: string): Call[] {
  const calls: Call[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) { if (!['node_modules', '.next', 'dist'].includes(e)) walk(f); continue; }
      if (!/\.(tsx|ts)$/.test(e)) continue;
      const s = stripComments(readFileSync(f, 'utf8'));
      // `apiClient.*` 뿐 아니라 원시 `fetch(...)`·홈페이지의 `fetchJson(...)` 도 센다
      for (const m of s.matchAll(/(?:apiClient\.(get|post|patch|put|del|fetch)|fetchJson|\bfetch)\s*<?[^(]*\(\s*/g)) {
        const at = m.index! + m[0].length;
        const read = readLiteral(s, at);
        if (read === null) continue;
        const lit = read.val;
        let meth = (m[1] ?? 'GET').toUpperCase();
        if (meth === 'DEL') meth = 'DELETE';
        if (!m[1] || meth === 'FETCH') {                                     // ⑥ 이 호출의 인자 안에서만
          let k = read.end + 1, depth = 0, arg = '';
          for (; k < s.length && k < read.end + 1200; k++) {
            const c = s[k];
            if (c === '(') depth++;
            if (c === ')') { if (depth === 0) break; depth--; }
            arg += c;
          }
          meth = arg.match(/method:\s*'(\w+)'/)?.[1] ?? 'GET';
        }
        let path = lit.replace(/\$\{[^}]*\}/g, '\u0000');
        // 🔴 선두 보간 프리픽스(`${API_URL}/api/v1/...`) — 종전엔 `:x/api/...` 가 되어
        //    startsWith('/api/v1/') 에서 **통째로 스킵**됐다(홈페이지 booking 의 404 3종이
        //    이 구멍으로 가드를 지나갔다 — 2026-09-01 실증). 프리픽스만 벗긴다.
        path = path.replace(/^\u0000(?=\/(api|fhir)\/)/, '');
        path = path.replace(/([^/])\u0000.*$/, '$1');               // ⑤ 세그먼트 중간 보간 = 쿼리
        path = path.replace(/\u0000/g, ':x').split('?')[0].replace(/\/+/g, '/').replace(/\/$/, '');
        if (!path.startsWith('/api/v1/') && !path.startsWith('/fhir/')) continue;
        if (/^\s*\+/.test(s.slice(read.end + 1, read.end + 7))) continue;  // 문자열 연결
        calls.push({ meth, path, file: f, line: s.slice(0, m.index).split('\n').length });
      }
    }
  };
  walk(webSrc);
  return calls;
}

const rx = (p: string) =>
  new RegExp('^' + p.replace(/:[^/]+/g, '§').split('§').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');

/** 계산된 세그먼트가 어떤 리터럴도 될 수 있으므로 **양방향**으로 겹치는지 본다 */
export function routeExists(c: Call, routes: Route[]): boolean {
  const cRe = rx(c.path.replace(/:x/g, ':p'));
  return routes.some((r) => r.m === c.meth &&
    (rx(r.p).test(c.path.replace(/:x/g, 'P')) || cRe.test(r.p.replace(/:[^/]+/g, 'P'))));
}

export interface ScanResult { missing: string[]; pending: string[] }

export function scanPhantomEndpoints(): ScanResult {
  const routes = serverRoutes();
  const calls = clientCalls();
  const unmatched = calls.filter((c) => !routeExists(c, routes));
  /** 변수 하나가 여러 세그먼트를 담을 수 있는 호출 — 정적으로는 판정 불가라 **보류**로 가른다 */
  const held = (c: Call) => c.path.endsWith(':x') &&
    routes.some((r) => r.m === c.meth && r.p.startsWith(c.path.replace(/\/:x$/, '') + '/'));
  const key = (c: Call) => `${c.meth} ${c.path}`;
  return {
    missing: [...new Set(unmatched.filter((c) => !held(c)).map(key))].sort(),
    pending: [...new Set(unmatched.filter(held).map(key))].sort(),
  };
}
