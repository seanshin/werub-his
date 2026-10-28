#!/usr/bin/env node
/**
 * i18n 번역 초안 생성기 — UI 크롬 언어 P1-E (ui-locale-i18n.plan.md §2.6)
 *
 * 사용법:
 *   node scripts/i18n-draft.mjs <메시지파일경로> --locale en|ja|ar --base <API베이스> --token <JWT>
 *   예) node scripts/i18n-draft.mjs packages/shared/src/i18n/messages/nav.ts \
 *         --locale en --base https://his.example.org --token "$JWT"
 *
 * 동작:
 *   대상 카탈로그 파일(*_MESSAGES)에서 대상 언어의 **빈/누락 키**(값이 없거나 '' —
 *   키 전집은 파일 내 en/ja/ar 합집합)를 찾아 온프레미스 번역 EP
 *   POST {base}/api/v1/i18n/translate {text, target} 로 초안을 만들고,
 *   결과를 **stdout 에 TypeScript 객체 조각으로 출력만** 한다.
 *
 * 🔴 파일을 직접 쓰지 않는다 — 사람이 검토 후 카탈로그 파일에 붙여넣는 흐름.
 * 🔴 엔진 실패는 실패로 남긴다(fallback 문자열 생성 금지) — 서버가 fallback:true 로
 *    원문을 돌려주면 그것은 번역이 아니므로 failed 로 센다.
 * 🔴 키 전집은 파일이 스스로 밝히는 범위다 — 정본(NAV_SECTIONS 등)에서 키를 지어내지 않는다.
 *    카탈로그가 비어 있으면 대상 0건이 정직한 결과다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const TARGET_LOCALES = ['en', 'ja', 'ar'];

function usageExit(msg) {
  if (msg) console.error(`오류: ${msg}`);
  console.error('사용법: node scripts/i18n-draft.mjs <메시지파일경로> --locale en|ja|ar --base <API베이스> --token <JWT>');
  process.exit(1);
}

// ---- 인자 파싱 ----
const argv = process.argv.slice(2);
let filePath = null;
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--locale' || a === '--base' || a === '--token') {
    opts[a.slice(2)] = argv[++i];
  } else if (a.startsWith('--')) {
    usageExit(`알 수 없는 옵션 ${a}`);
  } else if (!filePath) {
    filePath = a;
  } else {
    usageExit(`인자가 남습니다: ${a}`);
  }
}
if (!filePath) usageExit('메시지 파일 경로가 필요합니다');
if (!TARGET_LOCALES.includes(opts.locale)) usageExit('--locale 은 en|ja|ar 중 하나여야 합니다');
if (!opts.base) usageExit('--base <API베이스> 가 필요합니다');
if (!opts.token) usageExit('--token <JWT> 가 필요합니다');
const locale = opts.locale;
const base = opts.base.replace(/\/+$/, '');

// ---- 카탈로그 로드 (TS 소스를 구조적으로 평가 — dist 빌드에 의존하지 않는다) ----
function loadCatalogs(absPath) {
  const src = readFileSync(absPath, 'utf8');
  // 메시지 파일은 리터럴 카탈로그만 담는 규약(import type + export const). 그 범위만 평가한다.
  const js = src
    .replace(/^import[^\n]*$/gm, '') // import type 등 — 메시지 파일은 값 import 가 없다
    .replace(/^export\s+const\s+(\w+)\s*(?::\s*[^=]+)?=/gm, '__exports.$1 =')
    .replace(/\bsatisfies\s+\w+/g, '')
    .replace(/\bas\s+const\b/g, '');
  const __exports = {};
  try {
    vm.runInNewContext(js, { __exports, Set }, { timeout: 5000, filename: absPath });
  } catch (e) {
    console.error(`카탈로그 평가 실패(${absPath}): ${e.message}`);
    console.error('메시지 파일은 리터럴 카탈로그(export const *_MESSAGES = {…})만 담아야 이 스크립트가 읽을 수 있습니다.');
    process.exit(1);
  }
  const catalogs = Object.entries(__exports)
    .filter(([name, v]) => name.endsWith('_MESSAGES') && v && typeof v === 'object')
    .map(([name, v]) => ({ name, catalog: v }));
  if (catalogs.length === 0) {
    console.error(`파일에서 *_MESSAGES export 를 찾지 못했습니다: ${absPath}`);
    process.exit(1);
  }
  return catalogs;
}

const abs = resolve(process.cwd(), filePath);
const catalogs = loadCatalogs(abs);

// ---- 빈/누락 키 산출: 전집 = 파일 내 en/ja/ar 키 합집합, 대상 = 전집 중 locale 값이 없거나 '' ----
const targets = []; // { catalogName, key }
for (const { name, catalog } of catalogs) {
  const union = new Set();
  for (const lang of TARGET_LOCALES) {
    for (const k of Object.keys(catalog[lang] ?? {})) union.add(k);
  }
  const mine = catalog[locale] ?? {};
  for (const key of union) {
    const v = mine[key];
    if (v == null || v === '') targets.push({ catalogName: name, key });
  }
}

if (targets.length === 0) {
  console.log(`// i18n-draft: 대상 0건 — ${filePath} 의 ${locale} 카탈로그에 빈/누락 키가 없습니다.`);
  console.log('// (카탈로그가 전부 비어 있으면 전집도 0 — 키 등재는 영역 소유 커밋의 몫이며 이 스크립트는 키를 지어내지 않습니다.)');
  console.error(JSON.stringify({ attempted: 0, translated: 0, failed: [] }));
  process.exit(0);
}

// ---- 번역 호출 (순차 — EP 스로틀 120/분 준수·실패는 실패로) ----
/** `원문@문맥` 키의 번역 입력은 @ 앞 원문만 (t.ts displayOf 와 동일 규칙) */
function displayOf(key) {
  const i = key.lastIndexOf('@');
  return i > 0 ? key.slice(0, i) : key;
}
function tsQuote(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
}

async function translateOne(text) {
  let res;
  try {
    res = await fetch(`${base}/api/v1/i18n/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ text, target: locale }),
    });
  } catch (e) {
    return { ok: false, reason: `NETWORK: ${e.message}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'BAD_JSON' };
  }
  const d = body?.data;
  if (!d || typeof d.translated !== 'string') return { ok: false, reason: 'BAD_SHAPE' };
  // 🔴 fallback=true 는 translated 가 **원문**이라는 뜻 — 번역 실패다. 초안으로 내보내지 않는다.
  if (d.fallback || d.reason === 'ENGINE_FAILED' || d.reason === 'UNSUPPORTED_LANG') {
    return { ok: false, reason: d.reason || 'FALLBACK' };
  }
  if (!d.translated.trim()) return { ok: false, reason: 'EMPTY_RESULT' };
  return { ok: true, translated: d.translated.trim() };
}

const results = []; // { catalogName, key, translated }
const failed = []; // { key, reason }
for (const t of targets) {
  const r = await translateOne(displayOf(t.key));
  if (r.ok) results.push({ ...t, translated: r.translated });
  else failed.push({ key: t.key, reason: r.reason });
}

// ---- 출력: stdout = 붙여넣기용 TS 조각(카탈로그별·locale 블록) · 요약 병기 ----
const stamp = new Date().toISOString().slice(0, 10);
console.log(`// ── i18n-draft ${stamp} · locale=${locale} · 파일=${filePath}`);
console.log(`// ── 🔴 AI 초안(미검수) — 사람이 검토 후 해당 카탈로그의 ${locale}: { … } 안에 붙여넣으세요.`);
console.log(`// ── 검수 완료 시 VERIFIED 집합에 키 추가는 별도 커밋(이 조각은 검수가 아닙니다).`);
for (const { name } of catalogs) {
  const mine = results.filter((r) => r.catalogName === name);
  if (mine.length === 0) continue;
  console.log(`\n// ${name} → ${locale}: { … } 에 추가`);
  for (const r of mine) console.log(`  ${tsQuote(r.key)}: ${tsQuote(r.translated)},`);
}
const summary = { attempted: targets.length, translated: results.length, failed };
console.log(`\n// 요약 ${JSON.stringify(summary)}`);
console.error(JSON.stringify(summary));
if (failed.length > 0) process.exitCode = 2; // 실패는 실패로 — 부분 성공도 종료코드로 드러낸다
