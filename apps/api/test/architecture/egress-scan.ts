import fs from 'node:fs';
import path from 'node:path';

/**
 * 🔴 외부 전송 호출 지점 스캐너 — **정본 함수 하나**(가드·재주입이 같은 규칙을 쓴다).
 *
 * 무엇을 세나(2026-09-13 실측 규칙): 서버 코드에서 네트워크로 나가는 호출 지점.
 *   - 전역 `fetch(`(`globalThis.fetch(` 포함) · `aiEgressFetch(` · `safeFetch(` (정의 `function …(` 는 제외)
 *   - firebase-admin `sendEachForMulticast(`·`sendMulticast(` · nodemailer `sendMail(`
 *   - `axios.`/`axios(` · `http(s).request(`/`.get(` · Nest `this.http(Service).get|post|…(`
 * 무엇을 세지 않나:
 *   - 주석 안 · 문자열 안(로그 문구에 `fetch(` 가 들어간 경우)
 *   - **첫 인자가 사설망/루프백 URL 리터럴**인 호출(코드가 원내 목적지를 보장 — 대조군)
 * 범위: `apps/api/src/**` (.spec 제외) + web 서버 측(`apps/web/src/app/**\/route.ts` · `apps/web/src/middleware.ts`).
 *   🔴 브라우저에서 나가는 호출은 서버 데이터 소재지 문제가 아니라 여기서 세지 않는다(범위 한계).
 *   🔴 DB·Redis 접속(데이터 저장소 위치)과 백업 사본 위치는 호출 지점이 아니라 여기서 세지 않는다 — 인프라 축.
 *   🔴 `import('https')` 같은 동적 모듈 로드·새 HTTP 클라이언트 라이브러리는 패턴에 없다(2026-09-13 실측 사용처 0) — 도입 시 여기에 먼저 추가.
 *   🔴 별도 앱 `apps/homepage` 는 범위 밖(공개 사이트 — 환자 데이터 경로가 아니다 · 이 가드가 보증하지 않는다).
 */

export interface EgressCallSite {
  file: string; // 저장소 루트 상대
  line: number;
  kind: string;
}

const PATTERNS: [string, RegExp][] = [
  ['fetch', /(?<![\w$.])(?:(?:globalThis|global)\.)?fetch\s*\(/g], // `globalThis.fetch(` 우회도 센다
  ['aiEgressFetch', /(?<![\w$.])aiEgressFetch\s*\(/g],
  ['safeFetch', /(?<![\w$.])safeFetch\s*\(/g],
  ['fcm', /\.(?:sendEachForMulticast|sendMulticast)\s*\(/g],
  ['smtp', /\.sendMail\s*\(/g],
  ['axios', /(?<![\w$.])axios\s*[.(]/g],
  ['nodeHttp', /(?<![\w$.])https?\.(?:request|get)\s*\(/g],
  ['nestHttp', /this\.http(?:Service)?\.(?:get|post|put|patch|delete|request)\s*\(/g],
];

/**
 * 주석 제거 + 문자열 내용 공백화. **길이를 보존**해 두 결과의 인덱스가 같다.
 *  - `withStrings`: 주석만 지운 원문(인자 리터럴을 읽을 때)
 *  - `blanked`: 문자열 내용까지 지운 것(호출 패턴을 찾을 때 — 로그 문구 오탐 방지)
 */
export function stripForScan(src: string): { withStrings: string; blanked: string } {
  const a = src.split('');
  const b = src.split('');
  let i = 0;
  let q: string | null = null;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (q) {
      if (c === '\\') { if (c !== '\n') b[i] = ' '; if (i + 1 < n && src[i + 1] !== '\n') b[i + 1] = ' '; i += 2; continue; }
      if (c === q) { q = null; i++; continue; }
      if (q === '`' && c === '$' && src[i + 1] === '{') { i++; continue; } // 템플릿 보간은 코드로 둔다(근사)
      if (c !== '\n') b[i] = ' ';
      i++;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { q = c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { a[i] = ' '; b[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') { a[i] = ' '; b[i] = ' '; } i++; }
      if (i < n) { a[i] = ' '; b[i] = ' '; a[i + 1] = ' '; b[i + 1] = ' '; i += 2; }
      continue;
    }
    i++;
  }
  return { withStrings: a.join(''), blanked: b.join('') };
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/i;

/** 호출 괄호 뒤 첫 인자가 사설망/루프백 URL 리터럴인가 */
export function firstArgIsPrivateLiteral(code: string, openParenIdx: number): boolean {
  let j = openParenIdx + 1;
  while (j < code.length && /\s/.test(code[j])) j++;
  const q = code[j];
  if (q !== '\'' && q !== '"' && q !== '`') return false;
  const end = code.indexOf(q, j + 1);
  const lit = code.slice(j + 1, end < 0 ? j + 200 : end);
  const m = /^https?:\/\/([^/:?#]+|\[[^\]]+\])/i.exec(lit);
  return !!m && PRIVATE_HOST.test(m[1]);
}

export function scanSource(src: string, rel: string): EgressCallSite[] {
  const { withStrings, blanked } = stripForScan(src);
  const out: EgressCallSite[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(blanked); m; m = re.exec(blanked)) {
      const before = blanked.slice(Math.max(0, m.index - 24), m.index);
      if (/function\s*$/.test(before)) continue; // 래퍼 정의
      const paren = blanked.indexOf('(', m.index);
      if (paren >= 0 && firstArgIsPrivateLiteral(withStrings, paren)) continue;
      out.push({ file: rel, line: blanked.slice(0, m.index).split('\n').length, kind });
    }
  }
  return out;
}

function walk(dir: string, accept: (p: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p, accept, out); }
    else if (accept(p)) out.push(p);
  }
  return out;
}

/** 저장소 전체 스캔 — 루트는 인자(재주입이 사본 트리를 겨눌 수 있게) */
export function scanRepo(root: string): EgressCallSite[] {
  const files = [
    ...walk(path.join(root, 'apps/api/src'), (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts')),
    ...walk(path.join(root, 'apps/web/src/app'), (p) => p.endsWith('/route.ts')),
    ...walk(path.join(root, 'apps/web/src'), (p) => /\/apps\/web\/src\/middleware\.ts$/.test(p)),
  ];
  const sites: EgressCallSite[] = [];
  for (const f of [...new Set(files)]) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    sites.push(...scanSource(fs.readFileSync(f, 'utf-8'), rel));
  }
  return sites;
}

/** 파일별 호출 지점 수 */
export function countByFile(sites: EgressCallSite[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sites) m.set(s.file, (m.get(s.file) ?? 0) + 1);
  return m;
}
