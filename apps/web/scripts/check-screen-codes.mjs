#!/usr/bin/env node
// 화면번호 검증 (CI 게이트) — 중복 코드·미고정(freeze 누락)·고아 frozen·존재하지 않는 라우트 검출
//
// 🔴 2026-08-21: 종전엔 "nav 에 없는 frozen" 을 **경고(tombstone)** 로만 냈다. 그런데 실제로는
//    `/compounding`·`/workstation/triage`·`/admin/reference-ranges` 처럼 **살아 있는 화면**이 그 자리에 있었고,
//    레지스트리가 nav 만 훑는 탓에 코드가 있어도 번호 이동이 조용히 실패했다. 이제 정의 목록은
//    NAV_SECTIONS ∪ OFF_NAV_SCREENS 이며, 둘 중 어디에도 없는 frozen 은 **오류**다(tombstone 은 주석으로 남긴다).
// 사용: node scripts/check-screen-codes.mjs  (실패 시 exit 1)
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sidebar = readFileSync(join(root, 'src/components/layout/Sidebar.tsx'), 'utf8');
const frozenSrc = readFileSync(join(root, 'src/components/layout/screen-codes.frozen.ts'), 'utf8');

// 1) NAV_SECTIONS에서 (섹션순서, href) 추출 → 위치기반 코드
const navStart = sidebar.indexOf('export const NAV_SECTIONS');
const navRegion = sidebar.slice(navStart, sidebar.indexOf('\n];', navStart));
const navHrefs = [];
let si = -1, ii = 0;
for (const ln of navRegion.split('\n')) {
  if (/title:\s*['"]/.test(ln)) { si++; ii = 0; continue; }
  const h = ln.match(/href:\s*['"]([^'"]+)['"]/);
  if (h && si >= 0) { navHrefs.push({ href: h[1], derived: String((10 + si) * 100 + ii) }); ii++; }
}

// 1-b) OFF_NAV_SCREENS(사이드바 밖·진입점 있는 화면) 추출 — 레지스트리 정본의 나머지 절반
const offStart = sidebar.indexOf('export const OFF_NAV_SCREENS');
const offHrefs = [];
if (offStart >= 0) {
  const offRegion = sidebar.slice(offStart, sidebar.indexOf('\n];', offStart));
  for (const m of offRegion.matchAll(/href:\s*['"]([^'"]+)['"]/g)) offHrefs.push(m[1]);
}

// 1-c) 실제 라우트 목록(page.tsx) — 라우트 그룹 `(x)` 는 URL 에 없다
const routes = new Set();
const walk = (dir, url) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      const seg = /^\(.*\)$/.test(e.name) ? '' : `/${e.name}`;
      walk(join(dir, e.name), url + seg);
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(e.name)) {
      routes.add(url || '/');
    }
  }
};
walk(join(root, 'src/app'), '');

// 2) frozen 맵 추출
const frozen = {};
for (const m of frozenSrc.matchAll(/['"]([^'"]+)['"]\s*:\s*['"](\d+)['"]/g)) frozen[m[1]] = m[2];

const errors = [], warns = [];

// 3) frozen 내 중복 코드
const byCode = {};
for (const [href, code] of Object.entries(frozen)) {
  if (byCode[code]) errors.push(`중복 코드 ${code}: ${byCode[code]} ↔ ${href}`);
  else byCode[code] = href;
}

// 4) NAV 항목 중 frozen 누락(신규 화면 → freeze 추가 필요)
const seenHref = new Set();
for (const { href } of navHrefs) {
  if (seenHref.has(href)) continue; // 별칭 중복 href 무시
  seenHref.add(href);
  if (!(href in frozen)) errors.push(`미고정(freeze 누락): ${href} — screen-codes.frozen.ts에 코드 추가 필요`);
}

// 4-b) OFF_NAV 항목 중 frozen 누락
for (const href of offHrefs) {
  if (seenHref.has(href)) { warns.push(`OFF_NAV 중복(이미 nav 에 있음): ${href}`); continue; }
  seenHref.add(href);
  if (!(href in frozen)) errors.push(`미고정(freeze 누락): ${href} — OFF_NAV_SCREENS 에 있으나 코드가 없다`);
}

// 5) 🔴 frozen 에 있으나 정의 목록(NAV ∪ OFF_NAV)에 없는 코드 = **번호 이동이 조용히 실패하는 코드**
for (const href of Object.keys(frozen)) {
  if (!seenHref.has(href)) {
    errors.push(`고아 frozen(레지스트리 미등재 — 번호를 쳐도 이동하지 않는다): ${href}=${frozen[href]} — Sidebar 의 NAV_SECTIONS 또는 OFF_NAV_SCREENS 에 등재하거나, 폐기 화면이면 맵에서 지우고 주석 tombstone 으로 남길 것`);
  }
}

// 6) 🔴 정의된 화면의 라우트가 실제로 존재하는가 — 없으면 번호가 404 로 보낸다
for (const href of seenHref) {
  if (href.startsWith('http')) continue;
  if (!routes.has(href)) errors.push(`라우트 없음(page.tsx 부재 — 번호가 404 로 보낸다): ${href}=${frozen[href] ?? '?'}`);
}

console.log(`화면번호 검증: 정의 ${seenHref.size}건(NAV ${navHrefs.length} · OFF_NAV ${offHrefs.length}) · frozen ${Object.keys(frozen).length}건 · 라우트 ${routes.size}건`);
if (warns.length) { console.log('\n⚠️  경고:'); warns.forEach((w) => console.log('  -', w)); }
if (errors.length) {
  console.error('\n❌ 오류:'); errors.forEach((e) => console.error('  -', e));
  console.error(`\n검증 실패 (${errors.length}건). 머지 전 수정 필요.`);
  process.exit(1);
}
console.log('\n✅ 통과 — 중복 0, 미고정 0');
