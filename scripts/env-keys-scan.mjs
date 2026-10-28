#!/usr/bin/env node
/**
 * 코드가 읽는 환경변수 키 추출 — `.env.example` ↔ 코드 기계 대조의 **정본 파서**(2026-09-13 · 상용 릴리즈 T4-4).
 *
 * 🔴 왜: 루트 `.env.example` 은 8키였는데 API·web 코드가 읽는 키는 수십 개였다. 설치하는 사람이 무엇을 넣어야
 *    하는지 알 길이 없었고, 비어 있으면 **개발용 가짜값으로 조용히 떨어지는** 키가 섞여 있었다.
 *    가드(`apps/api/test/architecture/env-example-parity.spec.ts`)가 이 파서를 쓴다 — 세는 규칙을 두 곳에 두지 않는다.
 *
 * 세는 것: `process.env.KEY` · `process.env['KEY']` (주석 제외 · spec/test 제외)
 * 범위: apps/api/src · apps/web/src · apps/web/next.config.*
 * 🔴 `NODE_ENV`·`TZ`·`NEXT_RUNTIME` 같은 **런타임/플랫폼이 넣는 키**는 예시 대상이 아니다 — `PLATFORM_KEYS` 로 이름을 대고 뺀다.
 *
 * 사용: `node scripts/env-keys-scan.mjs [--json]`
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.next', '.next-build', 'dist', 'build', 'coverage', '.turbo']);

/** 플랫폼·런타임이 주입하는 키 — 설치하는 사람이 `.env` 에 적는 값이 아니다 */
export const PLATFORM_KEYS = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'npm_package_version', 'CI', 'VERCEL', 'PWD', 'HOME']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e) && !/\.(spec|test)\./.test(e)) out.push(p);
  }
  return out;
}

/** 주석 제거 — 규약을 설명하는 주석의 `process.env.X` 를 세면 없는 키가 필수로 둔갑한다 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * 세 경로를 본다(🔴 첫 판은 ①만 봐서 절반 가까이 놓쳤다 — 실측):
 *   ① `process.env.KEY` · `process.env['KEY']`
 *   ② Nest `ConfigService` — `config.get('KEY')` · `configService.getOrThrow<string>('KEY')`(JITSI·WEBAUTHN·OPENPACS 등)
 *   ③ zod 스키마 `envSchema` 의 키(`DATABASE_URL: z.…`) — `safeParse(process.env)` 로 통째로 읽어 ①에 안 잡힌다
 *   ④ `release-security.ts` 의 `DEV_ONLY_SWITCHES` 배열 — 개발 편의 스위치를 한 함수가 키 이름으로 읽는다
 */
export function keysIn(src) {
  const out = new Set();
  const code = stripComments(src);
  for (const m of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) out.add(m[1] ?? m[2]);
  for (const m of code.matchAll(/\b(?:config|configService|cfg)\s*\.\s*get(?:OrThrow)?\s*(?:<[^>]*>)?\s*\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g)) out.add(m[1]);
  // ④ 모드 정본의 스위치 목록(`DEV_ONLY_SWITCHES = [...]`) — `on(env, k)` 로 동적으로 읽어 ①·②에 안 잡힌다
  const sw = code.match(/export const DEV_ONLY_SWITCHES\s*=\s*\[([\s\S]*?)\]/);
  if (sw) for (const m of sw[1].matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)) out.add(m[1]);
  if (/export const envSchema\s*=\s*z\.object\(/.test(code)) {
    const body = code.slice(code.indexOf('export const envSchema'));
    for (const m of body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:\s*z\s*\./gm)) out.add(m[1]);
  }
  return out;
}

export function scanEnvKeys(root = ROOT) {
  const result = { api: new Map(), web: new Map() };
  const add = (bucket, key, file) => {
    if (PLATFORM_KEYS.has(key)) return;
    if (!bucket.has(key)) bucket.set(key, new Set());
    bucket.get(key).add(relative(root, file));
  };
  for (const f of walk(join(root, 'apps/api/src'))) for (const k of keysIn(readFileSync(f, 'utf8'))) add(result.api, k, f);
  const webFiles = walk(join(root, 'apps/web/src'));
  for (const n of ['next.config.js', 'next.config.mjs', 'next.config.ts']) { const p = join(root, 'apps/web', n); if (existsSync(p)) webFiles.push(p); }
  for (const f of webFiles) for (const k of keysIn(readFileSync(f, 'utf8'))) add(result.web, k, f);
  return result;
}

/** `.env.example` 에 **선언된** 키(주석 처리된 `# KEY=` 선택 키도 선언으로 센다) */
export function exampleKeys(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) out.add(m[1]);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = scanEnvKeys();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      api: Object.fromEntries([...r.api].sort().map(([k, v]) => [k, [...v]])),
      web: Object.fromEntries([...r.web].sort().map(([k, v]) => [k, [...v]])),
    }, null, 1));
  } else {
    console.log(`API ${r.api.size}키: ${[...r.api.keys()].sort().join(' ')}`);
    console.log(`WEB ${r.web.size}키: ${[...r.web.keys()].sort().join(' ')}`);
  }
}
